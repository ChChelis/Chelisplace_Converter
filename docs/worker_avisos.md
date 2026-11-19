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
- **Prazo/previsão por etapa** (uma linha no card e nos avisos do Telegram/WhatsApp, trocada a cada movimento de coluna; nunca na mensagem ao cliente):
  - entrar em **Montagem**: `Prazo limite para montar` (1 expediente da loja, 10h–17h);
  - entrar em **Gráfica**: `Previsão de retirada da gráfica` = 17h do 3º dia útil (o dia da entrada é o dia 1; fim de semana e feriado nacional não contam; entrada após as 18h conta a partir do dia útil seguinte), no mesmo expediente da loja; prazo já vencido parte de "agora"; `Prazo:` manual no card vale enquanto o card estiver na coluna de origem;
  - entrar em **Colagem**: `Prazo máximo de colagem` = 3h a cada 108 slots (pela página inteira: páginas x 18, arredondando para cima) na janela do colador, **10h–23h com almoço 13h–15h (suposição a ajustar)**;
  - Novos pedidos, Retirada, Pronto para entrega e Finalizado: sem previsão (a linha some).
- **Prazo de atraso da Gráfica** = 18h do 3º dia útil (mesma contagem do dia 1). **Colagem** usa a mesma janela do colador.
- **Mensagens internas** (Telegram/WhatsApp do grupo) não trazem o "Valor cobrado" (fica só no card); trazem o "Valor de colagem" = páginas x 18 x R$ 0,13, arredondado, como no orçamento.
- **Texto dos avisos:** sem emojis (colam mal no WhatsApp). Os avisos de novo pedido e de movimento trazem os "Dados do pedido" (a descrição do card, sem as linhas `Entrou na coluna` e `Prazo`, com a previsão atual). O link de encaminhar ao grupo corta o texto para caber no limite de URL do Telegram.
- **Mensagem ao cliente x mensagem do grupo:** a do cliente (botão "Avisar o cliente" do Telegram e botões `wa.me` da página) é um texto curto fixo, **sem nenhum valor** (nem cobrado, nem colagem, nem prazos); a página não coloca valor nem na mensagem de "ficha + Pix" (o pagamento vai no PDF). A do grupo traz os dados do pedido, o valor de colagem e a previsão da etapa, mas **sem telefone** (o telefone só alimenta o link do cliente). Há testes para as duas garantias.
- **Formatação do WhatsApp nas mensagens do grupo:** `*negrito*` e `_itálico_` (título e rótulos em negrito, "Dados do pedido" e nomes de coluna em itálico, linha de prazo/previsão inteira em negrito). Sem emojis: o texto vai por link `wa.me` e o caractere UTF-8 chega certo na URL (testado), mas o Chelis já viu emojis se perderem na caixa do WhatsApp, então ficam de fora. No Telegram o Worker converte esses marcadores para HTML (`<b>`, `<i>`, só em bordas de palavra, para não quebrar links com underscore). A descrição do card (Markdown do Trello) continua em texto puro: lá `*x*` viraria itálico.
