import { readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const globalPath = path.resolve(__dirname, "../../global.json");

export async function get(key) {
  const data = JSON.parse(await readFile(globalPath, "utf8"));
  return data[key];
}

export async function set(key, value) {
  const data = JSON.parse(await readFile(globalPath, "utf8"));
  data[key] = value;

  const temporaryPath = `${globalPath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await rename(temporaryPath, globalPath);
}

export async function list() {
  return JSON.parse(await readFile(globalPath, "utf8"));
}
