const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store"
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: JSON_HEADERS
  });
}

function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) {
    return false;
  }

  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function isAuthorized(request, env) {
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";

  return Boolean(env.CLIENT_TOKEN) && safeEqual(token, env.CLIENT_TOKEN);
}

async function verifyGitHubSignature(body, signature, secret) {
  if (!signature?.startsWith("sha256=") || !secret) return false;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(body)
  );

  const expected = "sha256=" + [...new Uint8Array(digest)]
    .map(byte => byte.toString(16).padStart(2, "0"))
    .join("");

  return safeEqual(signature, expected);
}

async function broadcastEvent(event, env) {
  const id = env.WATCHER_HUB.idFromName("global");
  const hub = env.WATCHER_HUB.get(id);

  const response = await hub.fetch("https://watcher-hub/broadcast", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(event)
  });

  if (!response.ok) {
    throw new Error(`Falha ao notificar clientes WebSocket: HTTP ${response.status}`);
  }
}

async function receiveWebhook(request, env) {
  const body = await request.text();
  const valid = await verifyGitHubSignature(
    body,
    request.headers.get("x-hub-signature-256"),
    env.GITHUB_WEBHOOK_SECRET
  );

  if (!valid) return json({ error: "unauthorized" }, 401);

  const eventName = request.headers.get("x-github-event");
  if (eventName !== "push") {
    return json({ accepted: true, ignored: true, event: eventName });
  }

  let payload;
  try {
    payload = JSON.parse(body);
  } catch {
    return json({ error: "invalid_json" }, 400);
  }

  const event = {
    id: payload.after || payload.head_commit?.id || crypto.randomUUID(),
    repository: payload.repository?.full_name || null,
    ref: payload.ref || null,
    commit: payload.head_commit?.message || null,
    received_at: new Date().toISOString()
  };

  await env.WATCHER_KV.put("latest-event", JSON.stringify(event));
  await broadcastEvent(event, env);

  return json({ accepted: true, event });
}

async function poll(request, env) {
  if (!isAuthorized(request, env)) {
    return json({ error: "unauthorized" }, 401);
  }

  const latest = await env.WATCHER_KV.get("latest-event", "json");
  if (!latest) return json({ update: false, event: null });

  const after = new URL(request.url).searchParams.get("after");
  if (after === latest.id) return json({ update: false, event: null });

  return json({ update: true, event: latest });
}

async function connectWebSocket(request, env) {
  if (!isAuthorized(request, env)) {
    return json({ error: "unauthorized" }, 401);
  }

  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
    return json({ error: "websocket_upgrade_required" }, 426);
  }

  const id = env.WATCHER_HUB.idFromName("global");
  const hub = env.WATCHER_HUB.get(id);

  return hub.fetch(request);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return json({
        name: "git-pull-watcher",
        status: "online",
        version: "0.2.0",
        transports: ["http", "websocket"]
      });
    }

    if (request.method === "GET" && url.pathname === "/health") {
      return json({ status: "ok" });
    }

    if (request.method === "POST" && url.pathname === "/github/webhook") {
      return receiveWebhook(request, env);
    }

    if (request.method === "GET" && url.pathname === "/poll") {
      return poll(request, env);
    }

    if (request.method === "GET" && url.pathname === "/ws") {
      return connectWebSocket(request, env);
    }

    return json({ error: "not_found" }, 404);
  }
};

export class WatcherHub {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/broadcast") {
      let event;
      try {
        event = await request.json();
      } catch {
        return json({ error: "invalid_json" }, 400);
      }

      if (!event?.id) {
        return json({ error: "invalid_event" }, 400);
      }

      await this.ctx.storage.put("latest-event", event);

      const message = JSON.stringify({ type: "update", event });
      let delivered = 0;

      for (const socket of this.ctx.getWebSockets()) {
        try {
          socket.send(message);
          delivered++;
        } catch {
          socket.close(1011, "Delivery failed");
        }
      }

      return json({ delivered });
    }

    if (request.method === "GET" && url.pathname === "/ws") {
      const pair = new WebSocketPair();
      const [client, server] = Object.values(pair);

      this.ctx.acceptWebSocket(server);

      server.send(JSON.stringify({ type: "connected" }));

      const after = url.searchParams.get("after");
      const latest = await this.ctx.storage.get("latest-event")
        || await this.env.WATCHER_KV.get("latest-event", "json");

      if (latest && latest.id !== after) {
        server.send(JSON.stringify({ type: "update", event: latest }));
      }

      return new Response(null, {
        status: 101,
        webSocket: client
      });
    }

    return json({ error: "not_found" }, 404);
  }

  async webSocketMessage(socket, message) {
    if (typeof message !== "string") return;

    let data;
    try {
      data = JSON.parse(message);
    } catch {
      return;
    }

    if (data.type === "ping") {
      socket.send(JSON.stringify({ type: "pong" }));
    }
  }

  async webSocketClose() {}

  async webSocketError(socket) {
    try {
      socket.close(1011, "WebSocket error");
    } catch {}
  }
}
