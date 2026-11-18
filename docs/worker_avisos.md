# Worker `chelisplace-avisos` (Trello → Telegram)

Código em `worker/` (`src/prazos.js`, `src/avisos.js`, `src/index.js`). Testes: `node --test worker/test/prazos.test.mjs worker/test/avisos.test.mjs`.

## Publicar (Chelis, na Cloudflare)
1. Workers & Pages → Create → **Import a repository** (`chelisplace_converter`), branch `claude/language-understanding-7egp47`, **Root directory: `worker`**, deploy command `npx wrangler deploy`. (Não mexer no projeto Pages `pedidos`.)
2. Settings → Variables and Secrets. Tipo **Segredo**: `TRELLO_KEY`, `TRELLO_TOKEN`, `TELEGRAM_TOKEN`, `ADMIN_SECRET` (invente uma senha longa, só letras e números). Redeploy depois.
3. Abrir no navegador (trocando `<URL>` e `<SENHA>`):
   - `<URL>/admin/<SENHA>/quadros` → copie o `id` do quadro; guarde em Variables como texto `TRELLO_BOARD_ID`.
   - `<URL>/admin/<SENHA>/chat-id` (depois de mandar "oi" no grupo) → copie o `id` (negativo) em `TELEGRAM_CHAT_ID`.
   - `<URL>/admin/<SENHA>/teste` → deve chegar "conectado" no grupo.
   - `<URL>/admin/<SENHA>/registrar-webhook` → liga o aviso de mover card.
   - `<URL>/admin/<SENHA>/resumo` → resumo de teste.
4. Variáveis de texto no `wrangler.jsonc` (`vars`) podem ser sobrescritas pelo painel; se o deploy zerar, preencher no `wrangler.jsonc` (não são segredos).

## Cards
Título `Cliente · N slots`; descrição com linhas `Cliente:`, `Telefone:`, `Slots:`. Sem telefone, o botão do cliente cai para o seletor de contatos.
