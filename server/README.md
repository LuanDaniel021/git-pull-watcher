# Server — Cloudflare Workers

Servidor do Git Pull Watcher, responsável por receber eventos do GitHub e notificá-los aos clientes conectados.

## Endpoints

| Método | Caminho | Descrição |
| --- | --- | --- |
| GET | `/` | Informações e status do serviço |
| GET | `/health` | Health check |
| POST | `/github/webhook` | Recebe eventos push do GitHub |
| GET | `/poll` | Consulta HTTP do último evento (compatibilidade) |
| GET | `/ws` | Conexão WebSocket persistente |

## Comunicação WebSocket

O cliente abre uma conexão em:

```
wss://SEU-WORKER.workers.dev/ws?after=<id-do-ultimo-evento-processado>
Authorization: Bearer <CLIENT_TOKEN>
```

O cabeçalho `Authorization` é obrigatório. O cliente deve enviar o ID do último evento processado no parâmetro `after`.

Mensagens enviadas pelo servidor:

- `{"type":"connected"}`: conexão estabelecida.
- `{"type":"update","event":{...}}`: novo evento ou evento pendente encontrado na reconexão.

Heartbeat da aplicação:

- Cliente envia `{"type":"ping"}`.
- Servidor responde `{"type":"pong"}`.

O servidor mantém as conexões no Durable Object `WatcherHub`. Quando recebe um webhook válido, grava o evento no KV, atualiza o estado do Durable Object e transmite o evento às conexões abertas.

Ao reconectar, o servidor compara o parâmetro `after` com o último evento conhecido e reenvia o evento caso ainda não tenha sido processado pelo cliente.

## Configuração no Cloudflare

1. Mantenha o namespace KV existente associado ao binding `WATCHER_KV`.
2. No Worker, abra **Settings → Variables and Secrets** e configure:
   - `GITHUB_WEBHOOK_SECRET` como Secret.
   - `CLIENT_TOKEN` como Secret.
3. O binding `WATCHER_HUB` e a migração SQLite do Durable Object já estão declarados em `wrangler.jsonc`. O Wrangler aplica a migração durante o deploy.
4. Configure o webhook no repositório GitHub:
   - Payload URL: `https://SEU-WORKER.workers.dev/github/webhook`
   - Content type: `application/json`
   - Secret: o mesmo valor de `GITHUB_WEBHOOK_SECRET`.
   - Evento: **Just the push event**.

## Cloudflare Workers Builds

- Root directory: `server`
- Install command: `npm install`
- Build command: deixe vazio
- Deploy command: `npx wrangler deploy`
- Production branch: `master`

## Compatibilidade HTTP

O endpoint `GET /poll?after=<id>` continua disponível e exige:

```http
Authorization: Bearer <CLIENT_TOKEN>
```

Ele retorna `update: true` quando o evento mais recente é diferente do ID informado.

## Desenvolvimento

```bash
npm install
npm run dev
```

## Limitações atuais

- O KV armazena somente o evento mais recente, não uma fila. Se vários pushes ocorrerem entre duas notificações, somente o evento mais recente ficará disponível para recuperação.
- O WebSocket envia eventos em tempo real para clientes conectados; o cliente local ainda precisa ser atualizado para usar esse transporte.
- O cliente deve implementar reconexão automática e heartbeat periódico.
