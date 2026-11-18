# Server — Cloudflare Workers

API inicial do Git Pull Watcher.

## Endpoints

| Método | Caminho | Descrição |
| --- | --- | --- |
| GET | `/` | Informações e status do serviço |
| GET | `/health` | Health check |
| POST | `/github/webhook` | Recebe eventos push do GitHub |
| GET | `/poll` | Cliente consulta o último evento |

## Configuração no Cloudflare

1. Crie um namespace em **Workers & Pages → KV → Create namespace**. Nome sugerido: `GIT_PULL_WATCHER`.
2. Copie o ID e substitua `REPLACE_WITH_KV_NAMESPACE_ID` em `wrangler.jsonc`.
3. No Worker, abra **Settings → Variables and Secrets** e adicione:
   - `GITHUB_WEBHOOK_SECRET` como Secret.
   - `CLIENT_TOKEN` como Secret.
4. Configure um webhook no repositório GitHub:
   - Payload URL: `https://SEU-WORKER.workers.dev/github/webhook`
   - Content type: `application/json`
   - Secret: o mesmo valor de `GITHUB_WEBHOOK_SECRET`.
   - Evento: **Just the push event**.

## Cloudflare Workers Builds

- Root directory: `server`
- Install command: `npm install`
- Build command: deixe vazio
- Deploy command: `npx wrangler deploy`
- Production branch: `main`

O ID real do KV precisa estar no arquivo de configuração antes do deploy.

## Cliente

Consulta:

```http
GET /poll?after=<id-do-ultimo-evento-processado>
Authorization: Bearer <CLIENT_TOKEN>
```

Na primeira consulta, omita o parâmetro `after`. Se o evento mais recente for diferente, a resposta terá `update: true`.

## Desenvolvimento

```bash
npm install
npm run dev
```

## Limitação desta primeira versão

O KV armazena somente o evento mais recente, não uma fila. Se vários pushes ocorrerem entre duas consultas, o cliente receberá apenas o push mais recente. O cliente local ainda será implementado.
