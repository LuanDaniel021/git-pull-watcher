import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const globalPath = path.resolve(__dirname, "../../global.json");

export async function canPull() {
  const global = JSON.parse(await readFile(globalPath, "utf8"));

  if (typeof global.pull !== "boolean") {
    throw new Error('A propriedade "pull" em global.json deve ser true ou false.');
  }

  return global.pull;
}
