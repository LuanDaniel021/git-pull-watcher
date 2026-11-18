import "dotenv/config";
import { spawn } from "node:child_process";
import { readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canPull } from "../modules/watcher/index.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const statePath = path.resolve(__dirname, "../.state.json");

const config = {
  watcherUrl: process.env.WATCHER_URL?.replace(/\/+$/, ""),
  token: process.env.CLIENT_TOKEN,
  repositoryPath: process.env.REPOSITORY_PATH
    ? path.resolve(process.env.REPOSITORY_PATH)
    : null,
  pollInterval: Number(process.env.POLL_INTERVAL_MS || 5000)
};

function validateConfig() {
  const missing = [];

  if (!config.watcherUrl) missing.push("WATCHER_URL");
  if (!config.token) missing.push("CLIENT_TOKEN");
  if (!config.repositoryPath) missing.push("REPOSITORY_PATH");

  if (missing.length) {
    throw new Error(`Variáveis ausentes no .env: ${missing.join(", ")}`);
  }

  if (!Number.isFinite(config.pollInterval) || config.pollInterval < 1000) {
    throw new Error("POLL_INTERVAL_MS deve ser um número igual ou maior que 1000.");
  }
}

async function loadState() {
  try {
    return JSON.parse(await readFile(statePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return { lastEventId: null };
    throw error;
  }
}

async function saveState(eventId) {
  const temporaryPath = `${statePath}.tmp`;
  await writeFile(temporaryPath, JSON.stringify({ lastEventId: eventId }, null, 2));
  await rename(temporaryPath, statePath);
}

async function poll(lastEventId) {
  const url = new URL("/poll", config.watcherUrl);

  if (lastEventId) {
    url.searchParams.set("after", lastEventId);
  }

  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${config.token}`
    }
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Servidor respondeu HTTP ${response.status}: ${body}`);
  }

  return response.json();
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
      else reject(new Error(`git pull terminou com código ${code}`));
    });
  });
}

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function main() {
  validateConfig();

  const state = await loadState();
  let lastEventId = state.lastEventId;

  console.log("Git Pull Watcher Client iniciado.");
  console.log(`Servidor: ${config.watcherUrl}`);
  console.log(`Repositório local: ${config.repositoryPath}`);
  console.log(`Intervalo: ${config.pollInterval}ms`);

  while (true) {
    try {
      if (!(await canPull())) {
        await sleep(config.pollInterval);
        continue;
      }

      const result = await poll(lastEventId);

      if (result.update && result.event) {
        const event = result.event;

        console.log("\nNova atualização recebida.");
        console.log(`Repositório: ${event.repository || "não informado"}`);
        console.log(`Commit: ${event.id}`);

        await runGitPull();
        await saveState(event.id);
        lastEventId = event.id;

        console.log("Repositório atualizado com sucesso.");
      }
    } catch (error) {
      console.error(`Erro: ${error.message}`);
    }

    await sleep(config.pollInterval);
  }
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
