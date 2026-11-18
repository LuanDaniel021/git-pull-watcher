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

function isAuthorized(request, env) {
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.startsWith("Bearer ")
    ? authorization.slice(7)
    : "";

  return Boolean(env.CLIENT_TOKEN) && safeEqual(token, env.CLIENT_TOKEN);
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return json({ name: "git-pull-watcher", status: "online", version: "0.1.0" });
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

    return json({ error: "not_found" }, 404);
  }
};
