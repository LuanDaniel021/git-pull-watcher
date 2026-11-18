import { get, set, list } from "./index.js";

function parseValue(value) {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function parseOptions(args) {
  const options = {};

  for (let i = 0; i < args.length; i++) {
    const argument = args[i];

    if (!argument.startsWith("--")) {
      throw new Error(`Argumento inválido: ${argument}`);
    }

    const separator = argument.indexOf("=");
    let key;
    let value;

    if (separator !== -1) {
      key = argument.slice(2, separator);
      value = argument.slice(separator + 1);
    } else {
      key = argument.slice(2);
      value = args[++i];

      if (value === undefined || value.startsWith("--")) {
        throw new Error(`Informe um valor para --${key}.`);
      }
    }

    if (!key) {
      throw new Error("O nome da propriedade não pode ficar vazio.");
    }

    options[key] = parseValue(value);
  }

  return options;
}

function showHelp() {
  console.log(`
Git Pull Watcher - Manager

Uso:
  npm run manager -- set --pull=true
  npm run manager -- get --pull
  npm run manager -- list

Comandos:
  set   Altera uma ou mais propriedades do global.json.
  get   Consulta uma ou mais propriedades.
  list  Exibe todas as propriedades.
  help  Exibe esta ajuda.

Valores true, false, null, números, arrays e objetos JSON são interpretados.
`);
}

async function main() {
  const [command, ...args] = process.argv.slice(2);

  if (!command || command === "help" || command === "--help" || command === "-h") {
    showHelp();
    return;
  }

  if (command === "set") {
    const options = parseOptions(args);

    if (Object.keys(options).length === 0) {
      throw new Error("Informe ao menos uma propriedade. Exemplo: set --pull=true");
    }

    for (const [key, value] of Object.entries(options)) {
      await set(key, value);
      console.log(`${key} = ${JSON.stringify(value)}`);
    }

    return;
  }

  if (command === "get") {
    const keys = args.map(argument => {
      if (!argument.startsWith("--") || argument.length === 2) {
        throw new Error(`Propriedade inválida: ${argument}`);
      }

      return argument.slice(2);
    });

    if (keys.length === 0) {
      throw new Error("Informe uma propriedade. Exemplo: get --pull");
    }

    for (const key of keys) {
      console.log(`${key} = ${JSON.stringify(await get(key))}`);
    }

    return;
  }

  if (command === "list") {
    if (args.length > 0) {
      throw new Error("O comando list não recebe argumentos.");
    }

    console.log(JSON.stringify(await list(), null, 2));
    return;
  }

  throw new Error(`Comando desconhecido: ${command}. Use "help" para ver os comandos.`);
}

main().catch(error => {
  console.error(`Erro: ${error.message}`);
  process.exitCode = 1;
});
