# Desenho: Trello + avisos (proposta para aprovação, nada codado)

Decisões do Chelis: Trello cria e move cards; ele move os cards de coluna à mão; o Trello avisa um chat interno; o cliente recebe mensagens por `wa.me` (ele clica em enviar); o chat interno é Telegram com link "Encaminhar ao grupo do WhatsApp" em cada aviso (`https://wa.me/?text=…` abre o seletor de contatos). Sem servidor pago: um único **Cloudflare Worker grátis** (com Cron Trigger).

## 1. Colunas do Trello e prazos (ordem informada pelo Chelis)
Os nomes exatos serão lidos do quadro pela API. Fuso America/Sao_Paulo, só dias úteis.

| Coluna | Prazo antes de contar como atrasado |
|---|---|
| Novos pedidos | 1 expediente (10h–17h) |
| Montagem | 1 expediente desde que o card entrou |
| Gráfica | 3 dias úteis, contando das 9h às 18h |
| Retirada | 1 expediente |
| Colagem | 3h de expediente por 108 slots (arredonda para cima; cresce com o pedido) |
| Pronto para entrega | sem prazo |
| Finalizado | sem prazo |

Os prazos ficam numa tabela de configuração do Worker (editável sem mexer em código).

## 2. Peças
1. **Página (pedidos.chelisplace.com):** botão "Criar card no Trello" (passo 5, Cliente e ficha) e, depois, atualização do card quando algo muda (valor, extras, montagem concluída, PDFs enviados). A página só fala com o Worker, nunca com o Trello.
2. **Worker `chelisplace-avisos`:**
   - `POST /card` cria/atualiza o card (CORS só para as origens da página).
   - `POST /trello` recebe o webhook do Trello (card movido) e avisa o Telegram.
   - **Cron** 10h e 17h, seg–sex: resumo por coluna com há quanto tempo cada pedido está parado e os atrasados.
   - Aviso em horário de mudança de coluna ou de atraso (verificação a cada hora útil).
   - Guarda estado mínimo (id do card, entrada na coluna, último aviso) no KV grátis.
3. **Telegram:** bot do Chelis, grupo da equipe. Cada aviso traz o link de encaminhar ao WhatsApp.
4. **Mensagens ao cliente:** montadas pela página (ficha + Pix, cartas sem versão próxima) ou geradas pelo aviso (enviado à gráfica, pronto para retirada). O botão abre `wa.me/<telefone>?text=…`; o PDF o Chelis anexa à mão.

## 3. O que vai em cada card
Título: `<cliente> · <nº de slots> slots`. Descrição: telefone, valor cobrado, total de slots, total de páginas, link da pasta do Drive, link do PDF do cliente, resumo das alterações, etapa da página. Campos extras (slots e páginas) ficam como custom fields ou numa linha fixa da descrição para o Worker ler. **Nunca**: custo, lucro, descontos, chave Pix. Faltou algum dado? Acrescentamos aos poucos (o Chelis avisou que será assim).

## 4. Quando o cliente é avisado (o Chelis revisa e clica)
- Ficha + Pix: após o orçamento/ficha, na página.
- Cartas sem versão próxima: na Conferência, na página.
- Enviado à gráfica: ao mover para Gráfica (aviso no Telegram com botão de mensagem pronta ao cliente).
- Pronto para retirada: ao mover para Retirada, idem.

## 5. Segurança
- Chave e token do Trello, token do bot Telegram e segredo do webhook: só como segredos do Worker, criados pelo formulário seguro de credencial, nunca no repositório, no JS ou no chat.
- O Worker rejeita origens não autorizadas e valida o segredo do webhook; telefone do cliente é dado privado e só trafega entre página, Worker e Trello (quadro privado).

## 6. Etapas de entrega (cada uma testada, com commit e push)
1. Worker: leitura do quadro, colunas, regras de prazo e testes unitários do cálculo de atraso (dias úteis, expediente, colagem).
2. Resumos 10h/17h e avisos no Telegram.
3. Webhook do Trello: mover card avisa o grupo.
4. Página: botão criar/atualizar card e botões `wa.me`.

## 7. Dependências do Chelis
Chave e token do Trello; bot do Telegram (via @BotFather) e grupo; domínio/rota do Worker na conta Cloudflare (deploy pelo wrangler com token seu ou pelo painel). Só o que ele mesmo puder fazer.
