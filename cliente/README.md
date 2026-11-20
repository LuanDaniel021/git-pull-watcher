# Cliente

Cliente local do Git Pull Watcher. Mantém uma conexão WebSocket com o servidor e executa `git pull --ff-only` quando recebe um novo evento push.

## Configuração

Crie um arquivo `.env` com:

```env
WATCHER_URL=https://SEU-WORKER.workers.dev
CLIENT_TOKEN=seu-token
REPOSITORY_PATH=C:/caminho/para/seu/repositorio
```

- `WATCHER_URL`: endereço HTTP(S) do Worker. O cliente converte automaticamente para WS(S).
- `CLIENT_TOKEN`: mesmo secret configurado no Worker.
- `REPOSITORY_PATH`: diretório do repositório Git local que será atualizado.

## Instalação e execução

```bash
npm install
npm start
```

O cliente requer Node.js 18 ou superior.

## Funcionamento

1. Carrega o último evento processado de `.state.json`.
2. Abre uma conexão autenticada em `/ws`, enviando o último ID processado no parâmetro `after`.
3. Recebe eventos em tempo real pelo WebSocket.
4. Executa `git pull --ff-only` no diretório configurado.
5. Salva o ID do evento em `.state.json` somente depois que o pull termina com sucesso.

Se a conexão cair, o cliente tenta reconectar automaticamente com espera progressiva, limitada a 30 segundos. Ao reconectar, informa o último evento processado para que o servidor possa reenviar o evento pendente.

O cliente também envia mensagens de heartbeat para manter a conexão monitorada. Se o servidor não responder, a conexão é encerrada e reaberta.

## Estado local

O arquivo `.state.json` é criado automaticamente dentro do diretório `cliente`. Ele guarda o ID do último evento processado e não deve ser removido se você quiser preservar o ponto de sincronização.

## Observações

- O cliente não usa mais polling nem `POLL_INTERVAL_MS`.
- O endpoint HTTP `/poll` continua existindo no servidor para compatibilidade com clientes antigos.
- O servidor armazena somente o evento mais recente. Portanto, se vários pushes ocorrerem enquanto o cliente estiver desconectado, a recuperação pode trazer apenas o último evento.
- O repositório local precisa estar configurado para que `git pull --ff-only` funcione sem interação manual.
