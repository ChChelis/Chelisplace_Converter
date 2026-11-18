# Worker `chelisplace-avisos` (Trello → Telegram)

Código em `worker/` (`src/prazos.js`, `src/avisos.js`, `src/index.js`). Testes: `node --test worker/test/prazos.test.mjs worker/test/avisos.test.mjs`.

## Publicar (Chelis, na Cloudflare)
1. Workers & Pages → Create → **Import a repository** (`chelisplace_converter`), branch `claude/language-understanding-7egp47`, **Root directory: `worker`**, deploy command `npx wrangler deploy`. (Não mexer no projeto Pages `pedidos`.)
2. Settings → Variables and Secrets. Tipo **Segredo**: `TRELLO_KEY`, `TRELLO_TOKEN`, `TELEGRAM_TOKEN`, `ADMIN_SECRET` (invente uma senha longa, só letras e números). Redeploy depois.
3. Abrir no navegador (trocando `<URL>` e `<SENHA>`):
   - `<URL>/admin/<SENHA>/quadros` → copie o `id` do quadro; guarde em Variables como **Segredo** `TRELLO_BOARD_ID`.
   - `<URL>/admin/<SENHA>/chat-id` (depois de mandar "oi" no grupo) → copie o `id` (negativo) em `TELEGRAM_CHAT_ID` (também como Segredo).
   - `<URL>/admin/<SENHA>/teste` → deve chegar "conectado" no grupo.
   - `<URL>/admin/<SENHA>/registrar-webhook` → liga o aviso de mover card.
   - `<URL>/admin/<SENHA>/resumo` → resumo de teste.
4. Deploy command usado: `npx wrangler deploy --config worker/wrangler.jsonc`. Tudo que o painel guarda como Segredo sobrevive aos deploys; por isso nenhuma variável fica no `wrangler.jsonc`.

## Cards
Título `Cliente · N slots`; descrição com linhas `Cliente:`, `Telefone:`, `Slots:`. Sem telefone, o botão do cliente cai para o seletor de contatos.

## Regras extras
- **Finalizado no resumo:** só aparecem os cards finalizados a partir do 5º dia útil (seg–sex, feriados não contam) mais recente, 00h de Brasília: é o dia em que se paga a colagem. Depois dessa data o resumo começa uma janela nova. Finalizado nunca entra em aviso de atraso.
- **Novo pedido:** card criado (pela página ou à mão) gera "🆕 Novo pedido" no grupo.
- **Segredo da página:** `PAGINA_SECRET` (senha digitada em "Trello" no passo 5 da página).
