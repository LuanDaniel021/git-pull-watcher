require("dotenv").config();

const WebSocket = require("ws");
const { spawn } = require("child_process");
const fs = require("fs").promises;
const path = require("path");
const { URL } = require("url");

const statePath = path.resolve(__dirname, "../.state.json");

const config = {
  watcherUrl: process.env.WATCHER_URL,
  token: process.env.CLIENT_TOKEN,
  repositoryPath: process.env.REPOSITORY_PATH
    ? path.resolve(process.env.REPOSITORY_PATH)
    : null
};

const RECONNECT_INITIAL_MS = 1000;
const RECONNECT_MAX_MS = 30000;
const HEARTBEAT_INTERVAL_MS = 30000;

let lastEventId = null;
let activeSocket = null;
let reconnectTimer = null;
let reconnectDelay = RECONNECT_INITIAL_MS;
let processing = false;
let shuttingDown = false;

const eventQueue = [];
const queuedEventIds = new Set();

function validateConfig() {
  const missing = [];

  if (!config.watcherUrl) missing.push("WATCHER_URL");
  if (!config.token) missing.push("CLIENT_TOKEN");
  if (!config.repositoryPath) missing.push("REPOSITORY_PATH");

  if (missing.length) {
    throw new Error("Variáveis ausentes no .env: " + missing.join(", "));
  }

  const parsedUrl = new URL(config.watcherUrl);
  if (["http:", "https:", "ws:", "wss:"].indexOf(parsedUrl.protocol) === -1) {
    throw new Error("WATCHER_URL deve usar HTTP(S) ou WS(S).");
  }
}

async function loadState() {
  try {
    const state = JSON.parse(await fs.readFile(statePath, "utf8"));
    return { lastEventId: state.lastEventId || null };
  } catch (error) {
    if (error.code === "ENOENT") return { lastEventId: null };
    throw error;
  }
}

async function saveState(eventId) {
  const temporaryPath = statePath + ".tmp";
  await fs.writeFile(temporaryPath, JSON.stringify({ lastEventId: eventId }, null, 2));
  await fs.rename(temporaryPath, statePath);
}

function createWebSocketUrl() {
  const url = new URL("/ws", config.watcherUrl);

  if (url.protocol === "https:") url.protocol = "wss:";
  else if (url.protocol === "http:") url.protocol = "ws:";

  if (lastEventId) {
    url.searchParams.set("after", lastEventId);
  }

  return url;
}

function runGitPull() {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["pull", "--ff-only"], {
      cwd: config.repositoryPath,
      stdio: "inherit",
      shell: false
    });

    child.once("error", reject);
    child.once("close", code => {
      if (code === 0) resolve();
      else reject(new Error("git pull terminou com código " + code));
    });
  });
}

function enqueueEvent(event) {
  if (!event || !event.id || event.id === lastEventId || queuedEventIds.has(event.id)) {
    return;
  }

  queuedEventIds.add(event.id);
  eventQueue.push(event);
  processEventQueue();
}

async function processEventQueue() {
  if (processing || shuttingDown) return;

  processing = true;

  try {
    while (eventQueue.length && !shuttingDown) {
      const event = eventQueue[0];

      if (event.id === lastEventId) {
        eventQueue.shift();
        queuedEventIds.delete(event.id);
        continue;
      }

      console.log("\\nNova atualização recebida.");
      console.log("Repositório: " + (event.repository || "não informado"));
      console.log("Commit: " + event.id);

      try {
        await runGitPull();
        await saveState(event.id);

        lastEventId = event.id;
        eventQueue.shift();
        queuedEventIds.delete(event.id);

        console.log("Repositório atualizado com sucesso.");
      } catch (error) {
        console.error("Falha ao atualizar o repositório: " + error.message);
        console.error("A conexão será reiniciada para tentar recuperar o evento.");

        eventQueue.length = 0;
        queuedEventIds.clear();

        if (activeSocket && activeSocket.readyState === WebSocket.OPEN) {
          activeSocket.close(1011, "git pull failed");
        }
        break;
      }
    }
  } finally {
    processing = false;
  }
}

function scheduleReconnect() {
  if (shuttingDown || reconnectTimer) return;

  const delay = reconnectDelay;
  reconnectDelay = Math.min(reconnectDelay * 2, RECONNECT_MAX_MS);

  console.log("Nova tentativa de conexão em " + Math.ceil(delay / 1000) + "s.");

  reconnectTimer = setTimeout(() => {
    reconnectTimer = null;
    connect();
  }, delay);
}

function connect() {
  if (shuttingDown) return;

  const url = createWebSocketUrl();
  console.log("Conectando ao servidor: " + url.origin);

  let socket;

  try {
    socket = new WebSocket(url.toString(), {
      headers: {
        Authorization: "Bearer " + config.token
      },
      handshakeTimeout: 10000
    });
  } catch (error) {
    console.error("Não foi possível iniciar o WebSocket: " + error.message);
    scheduleReconnect();
    return;
  }

  activeSocket = socket;

  let awaitingPong = false;
  let heartbeatInterval = null;

  socket.on("open", () => {
    reconnectDelay = RECONNECT_INITIAL_MS;
    console.log("Conexão WebSocket estabelecida.");

    heartbeatInterval = setInterval(() => {
      if (socket.readyState !== WebSocket.OPEN) return;

      if (awaitingPong) {
        console.error("Heartbeat expirou. Reconectando...");
        socket.terminate();
        return;
      }

      awaitingPong = true;
      socket.send(JSON.stringify({ type: "ping" }));
    }, HEARTBEAT_INTERVAL_MS);
  });

  socket.on("message", rawMessage => {
    let message;

    try {
      message = JSON.parse(rawMessage.toString());
    } catch (error) {
      console.error("Mensagem inválida recebida do servidor.");
      return;
    }

    if (message.type === "connected") {
      console.log("Watcher conectado e aguardando eventos.");
      return;
    }

    if (message.type === "pong") {
      awaitingPong = false;
      return;
    }

    if (message.type === "update" && message.event) {
      enqueueEvent(message.event);
    }
  });

  socket.on("error", error => {
    console.error("Erro na conexão WebSocket: " + error.message);
  });

  socket.on("close", (code, reason) => {
    if (heartbeatInterval) clearInterval(heartbeatInterval);

    if (activeSocket === socket) {
      activeSocket = null;
    }

    if (shuttingDown) return;

    const reasonText = reason && reason.length ? ", " + reason.toString() : "";
    console.log("Conexão encerrada (código " + code + reasonText + ").");

    scheduleReconnect();
  });
}

async function main() {
  validateConfig();

  const state = await loadState();
  lastEventId = state.lastEventId;

  console.log("Git Pull Watcher Client iniciado.");
  console.log("Servidor: " + config.watcherUrl);
  console.log("Repositório local: " + config.repositoryPath);
  console.log("Último evento processado: " + (lastEventId || "nenhum"));

  connect();
}

function shutdown(signal) {
  if (shuttingDown) return;

  shuttingDown = true;
  console.log("\\nRecebido " + signal + ". Encerrando cliente...");

  if (reconnectTimer) clearTimeout(reconnectTimer);

  if (activeSocket && activeSocket.readyState === WebSocket.OPEN) {
    activeSocket.close(1000, "client shutdown");
  } else if (activeSocket) {
    activeSocket.terminate();
  }
}

process.once("SIGINT", () => shutdown("SIGINT"));
process.once("SIGTERM", () => shutdown("SIGTERM"));

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
