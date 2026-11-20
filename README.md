# Git Pull Watcher

Atualiza automaticamente um repositório Git local quando o GitHub recebe um novo push.

O projeto usa um **Cloudflare Worker** como intermediário e **WebSocket** para manter o cliente local conectado ao servidor. Quando chega um push, o cliente recebe a notificação e executa `git pull --ff-only` no repositório configurado.

## Arquitetura

```text
GitHub
  │ push (webhook)
  ▼
Cloudflare Worker
  │ valida o evento e atualiza o estado
  ▼
Durable Object (WatcherHub)
  │ transmite pelo WebSocket
  ▼
Cliente local
  │ executa quando recebe um evento
  ▼
git pull --ff-only
```

O cliente inicia a conexão com o servidor. Não é necessário expor o computador local à internet nem consultar o servidor em intervalos fixos.

## Estrutura

```text
git-pull-watcher/
├── cliente/
│   ├── src/
│   │   └── index.js
│   ├── .env.example
│   ├── .gitignore
│   ├── package.json
│   └── README.md
└── server/
    ├── src/
    │   └── index.js
    ├── wrangler.jsonc
    ├── package.json
    └── README.md
```

## Requisitos

- Node.js 12 ou superior no computador que executará o cliente.
- Git instalado e disponível no PATH.
- Um repositório local já clonado e configurado com o remoto.
- Uma conta Cloudflare para hospedar o Worker.

## Configuração

### 1. Servidor (Cloudflare Worker)

O servidor fica em `server/` e utiliza:

- **Cloudflare Workers** para receber os webhooks e expor os endpoints.
- **Workers KV** para armazenar o evento mais recente.
- **Durable Objects** (`WatcherHub`) para manter e gerenciar as conexões WebSocket.

No Cloudflare:

1. Mantenha o namespace KV associado ao binding `WATCHER_KV` definido em `server/wrangler.jsonc`.
2. No Worker, abra **Settings → Variables and Secrets** e configure:
   - `GITHUB_WEBHOOK_SECRET`: segredo usado para validar a assinatura dos webhooks do GitHub.
   - `CLIENT_TOKEN`: token usado para autenticar o cliente.
3. Configure o deploy pelo GitHub/Cloudflare Workers Builds:
   - Repositório: `LuanDaniel021/git-pull-watcher`
   - Branch de produção: `main`
   - Root directory: `server`
   - Install command: `npm install`
   - Build command: deixe vazio
   - Deploy command: `npx wrangler deploy`

O binding `WATCHER_HUB` e a migração do Durable Object já estão declarados em `server/wrangler.jsonc`. O Wrangler aplica a migração durante o deploy.

Consulte [server/README.md](server/README.md) para detalhes dos endpoints e da configuração do Worker.

### 2. Webhook do GitHub

No repositório que será monitorado:

1. Acesse **Settings → Webhooks → Add webhook**.
2. Configure a Payload URL como `https://SEU-WORKER.workers.dev/github/webhook`.
3. Selecione o content type `application/json`.
4. Informe como Secret o mesmo valor configurado em `GITHUB_WEBHOOK_SECRET` no Cloudflare.
5. Selecione **Just the push event** e salve.

O webhook aponta para o Worker, não para o computador que executa o cliente.

### 3. Cliente local

No computador que receberá as atualizações, entre na pasta `cliente/` e instale as dependências:

```bash
npm install
```

Copie `.env.example` para `.env` e configure:

```env
WATCHER_URL=https://SEU-WORKER.workers.dev
CLIENT_TOKEN=seu-token
REPOSITORY_PATH=C:/caminho/para/o/repositorio
```

- `WATCHER_URL`: endereço HTTP(S) público do Worker. O cliente converte automaticamente para WS(S).
- `CLIENT_TOKEN`: mesmo token configurado como Secret no Worker.
- `REPOSITORY_PATH`: caminho da pasta do repositório local que receberá o pull.

Inicie o cliente:

```bash
npm start
```

Mantenha o processo em execução para continuar recebendo notificações. O arquivo `.env` e o estado local `.state.json` não são versionados.

Consulte [cliente/README.md](cliente/README.md) para detalhes sobre a conexão e o estado local.

## Como funciona

1. Alguém faz push no repositório monitorado.
2. O GitHub envia um evento `push` para `POST /github/webhook`.
3. O Worker valida a assinatura, registra o evento no KV e notifica o `WatcherHub`.
4. O Durable Object transmite o evento aos clientes conectados.
5. O cliente executa `git pull --ff-only`.
6. Depois de um pull bem-sucedido, o cliente salva o ID do evento em `.state.json`.

O cliente mantém a conexão WebSocket aberta, envia mensagens periódicas de heartbeat e tenta reconectar automaticamente quando a conexão cai. Na reconexão, informa o último ID processado para que o servidor possa reenviar o evento mais recente, se necessário.

## Endpoints

| Método | Caminho | Função |
| --- | --- | --- |
| `GET` | `/` | Informações e status do serviço |
| `GET` | `/health` | Verificação de saúde |
| `POST` | `/github/webhook` | Recebe eventos do GitHub |
| `GET` | `/ws` | Conexão WebSocket autenticada |
| `GET` | `/poll` | Consulta HTTP do último evento (compatibilidade) |

A conexão WebSocket usa o cabeçalho `Authorization: Bearer <CLIENT_TOKEN>`. O endpoint HTTP `/poll` permanece disponível para compatibilidade com clientes antigos; o cliente atual utiliza WebSocket.

## Limitações conhecidas

- O KV e o estado de recuperação mantêm somente o evento mais recente, não uma fila completa. Se vários pushes acontecerem enquanto o cliente estiver desconectado, a recuperação pode trazer apenas o último evento.
- `git pull --ff-only` não cria merges. Se houver alterações locais ou divergência que impeçam um avanço direto, o pull falhará.
- O cliente precisa permanecer em execução e ter acesso à internet e ao repositório local.

## Segurança

- Não publique os valores de `GITHUB_WEBHOOK_SECRET` ou `CLIENT_TOKEN`.
- Não envie o arquivo `.env` para o Git.
- Configure os tokens como Secrets no Cloudflare, não como valores escritos no código.
