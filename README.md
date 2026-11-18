# Git Pull Watcher

Atualiza automaticamente um repositório Git local quando o GitHub recebe um novo push.

O projeto usa um **Cloudflare Worker** como intermediário: o GitHub envia um webhook para o servidor, e o cliente local consulta o servidor periodicamente. Quando encontra um evento novo, o cliente executa `git pull --ff-only` no repositório configurado.

## Arquitetura

```text
GitHub
  │ push (webhook)
  ▼
Cloudflare Worker
  │ grava o último evento no KV
  ▼
Cliente local
  │ consulta GET /poll periodicamente
  ▼
git pull --ff-only
```

O GitHub não precisa conhecer o computador local. O cliente é quem inicia as consultas ao servidor.

## Estrutura

```text
git-pull-watcher/
├── cliente/
│   ├── src/
│   │   └── index.js
│   ├── .env.example
│   ├── .gitignore
│   └── package.json
└── server/
    ├── src/
    │   └── index.js
    ├── wrangler.jsonc
    ├── package.json
    └── README.md
```

## Requisitos

- Node.js 18 ou superior no computador que executará o cliente.
- Git instalado e disponível no PATH.
- Um repositório local já clonado, com acesso ao remoto.
- Uma conta Cloudflare para hospedar o Worker.

## Configuração

### 1. Servidor (Cloudflare Worker)

O servidor fica em `server/` e utiliza Cloudflare Workers + Workers KV.

1. Crie um namespace no **Workers & Pages → KV**.
2. Configure o binding `WATCHER_KV` no `server/wrangler.jsonc`, usando o ID do namespace criado.
3. No Worker, abra **Settings → Variables and Secrets** e configure os secrets de runtime:
   - `GITHUB_WEBHOOK_SECRET`: segredo usado para validar a assinatura dos webhooks do GitHub.
   - `CLIENT_TOKEN`: token que autoriza o cliente local a consultar o servidor.
4. Faça o deploy do Worker.

Para configurar o deploy pelo Cloudflare Workers Builds, use `server` como diretório raiz, `npm install` como comando de instalação e `npx wrangler deploy` como comando de deploy. Não é necessário comando de build.

Consulte [server/README.md](server/README.md) para os detalhes do servidor.

### 2. Webhook do GitHub

No repositório que será monitorado:

1. Acesse **Settings → Webhooks → Add webhook**.
2. Configure a Payload URL como `https://SEU-WORKER.workers.dev/github/webhook`.
3. Selecione o content type `application/json`.
4. Informe como Secret o mesmo valor configurado em `GITHUB_WEBHOOK_SECRET` no Cloudflare.
5. Selecione **Just the push event** e salve.

O webhook deve apontar para o endereço do seu Worker, não para o cliente local.

### 3. Cliente local

No computador que deve receber as atualizações, entre na pasta `cliente/`:

```bash
npm install
```

Copie `.env.example` para `.env` e configure:

```env
WATCHER_URL=https://SEU-WORKER.workers.dev
CLIENT_TOKEN=seu-token
REPOSITORY_PATH=C:/caminho/para/o/repositorio
POLL_INTERVAL_MS=5000
```

- `WATCHER_URL`: endereço público do Worker.
- `CLIENT_TOKEN`: mesmo token configurado como secret no Worker.
- `REPOSITORY_PATH`: caminho da pasta do repositório que receberá o pull.
- `POLL_INTERVAL_MS`: intervalo entre consultas, em milissegundos (padrão: 5000; mínimo: 1000).

Inicie o cliente:

```bash
npm start
```

Mantenha o processo em execução para continuar monitorando o repositório. O arquivo `.env` e o estado local `.state.json` não são versionados.

## Como funciona o fluxo

1. Alguém faz push no repositório do GitHub.
2. O GitHub envia um evento `push` ao endpoint `/github/webhook`.
3. O Worker valida a assinatura e grava os dados do último push no KV.
4. O cliente consulta `/poll` usando o `CLIENT_TOKEN`.
5. Se houver um evento diferente do último processado, o cliente executa `git pull --ff-only`.
6. Após o pull concluir com sucesso, o cliente salva o ID do evento em `.state.json`.

O cliente não imprime cada consulta normal sem atualização. Ele informa inicialização, novas atualizações e erros; a saída do próprio Git também aparece no terminal.

## Endpoints do servidor

| Método | Caminho | Função |
| --- | --- | --- |
| `GET` | `/` | Informações e status do serviço |
| `GET` | `/health` | Verificação de saúde |
| `POST` | `/github/webhook` | Recebe eventos do GitHub |
| `GET` | `/poll` | Consulta o último evento (autenticado) |

## Limitações conhecidas

- O KV guarda somente o evento mais recente, não uma fila. Se vários pushes acontecerem antes da próxima consulta, eles podem ser condensados em um único evento.
- `git pull --ff-only` só atualiza quando o avanço pode ser feito sem merge. Se o repositório local tiver alterações ou divergência que impeçam o avanço, o pull falhará; o cliente registra o erro e tenta novamente nas próximas consultas.
- O cliente precisa permanecer em execução e ter acesso à internet e ao repositório local.

## Segurança

- Não publique os valores de `GITHUB_WEBHOOK_SECRET` ou `CLIENT_TOKEN`.
- Não envie o arquivo `.env` para o Git.
- Use tokens diferentes para ambientes ou instalações diferentes, se necessário.
