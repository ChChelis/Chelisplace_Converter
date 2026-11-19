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
- **Finalizado no resumo:** só aparecem os cards finalizados a partir do 5º dia útil (seg–sex, sem feriados nacionais: fixos, Consciência Negra e Sexta-feira Santa; Carnaval e Corpus Christi não entram) mais recente, 00h de Brasília: é o dia em que se paga a colagem. Depois dessa data o resumo começa uma janela nova. Finalizado nunca entra em aviso de atraso.
- **Novo pedido:** card criado (pela página ou à mão) gera "🆕 Novo pedido" no grupo.
- **Segredo da página:** `PAGINA_SECRET` (senha digitada em "Trello" no passo 5 da página).
- **Feriados nacionais** (mesma lista da janela de Finalizados) param o relógio de todos os prazos e silenciam resumos e alertas no dia.
- **Previsão de entrega** (linha `Previsão de entrega:` no card, recalculada a cada movimento de coluna; Pronto para entrega vira "pronto para entrega" e Finalizado "entregue"): fim da Colagem. Regras: (1) Novos pedidos, Montagem e envio à gráfica acontecem no mesmo expediente da loja (10h–17h); (2) a Gráfica libera ao fim do 3º dia útil, contando o dia da entrada como dia 1 (se entrou depois das 18h ou fora de dia útil, o dia 1 é o próximo dia útil), e a previsão usa 17h desse dia; (3) a retirada é no mesmo expediente da liberação ou no seguinte; (4) soma-se a colagem: 3h a cada 108 slots (arredondando para cima, pelo total da página inteira: páginas x 18), na janela do colador, **10h–23h com almoço 13h–15h (suposição do Chelis para ajustar)**. Prazo vencido na coluna atual: o que falta parte de "agora". Aparece nos avisos do Telegram (e no texto encaminhado ao WhatsApp), nunca na mensagem ao cliente.
- **Prazo de atraso da Gráfica** = 18h do 3º dia útil (mesma contagem do dia 1). **Colagem** usa a mesma janela do colador.
- **Mensagens internas** (Telegram/WhatsApp do grupo) não trazem o "Valor cobrado" (fica só no card); trazem o "Valor de colagem" = páginas x 18 x R$ 0,13, arredondado, como no orçamento.
- **Texto dos avisos:** sem emojis (colam mal no WhatsApp). Os avisos de novo pedido e de movimento trazem os "Dados do pedido" (a descrição do card, sem as linhas `Entrou na coluna` e `Prazo`, com a previsão atual). O link de encaminhar ao grupo corta o texto para caber no limite de URL do Telegram.
