# Handoff: página de pedidos do Chelisplace (próxima etapa: Trello e WhatsApp)

Para quem abrir uma conversa nova (contexto zerado). O Chelis (PT-BR, direto, quer resultado funcionando e testado; não gosta que eu aja antes de responder o que perguntou; confere tudo na prática e manda print) vende proxies de Magic em adesivo. A página **única** do pedido (do começo ao fim) está pronta, publicada e em uso real. A próxima etapa é **integrar com Trello e WhatsApp**: o escopo ainda **não foi definido** (comece pelas perguntas da seção 8).

Repositório: `chchelis/chelisplace_converter`, branch **`claude/language-understanding-7egp47`** (é a branch de produção da Cloudflare Pages: cada push publica em ~1 min). **Commit e push ao fim de cada mudança** (regra do usuário; o hook de parada cobra). Nunca crie PR sem pedido.

Leia, nesta ordem: este documento → `docs/site.md` (comportamento detalhado da página, em ordem cronológica) → `docs/nucleo.md` → `docs/referencia_processo.md` (processo e preços) → `docs/drive.md` → `docs/app.md` (bot local) → `docs/memoria_projeto.md` (pipeline do bot). Histórico: `docs/handoff_pagina_final.md`.

> **ESTADO (18/11/2026): a integração está pronta e em uso.** Leia `docs/desenho_trello_whatsapp.md` (decisões) e `docs/worker_avisos.md` (Worker `chelisplace-avisos`, deploy, segredos, regras de prazo, feriados, janela de Finalizados, campos do card). A seção 8 abaixo é histórica (já respondida). Resumo: Trello cria/move card (botão no passo 5 + `/card`), avisos e resumos 10h/17h no Telegram com botão "Encaminhar ao grupo do WhatsApp", mensagens ao cliente por `wa.me`. Pendências: observar resumos/atrasos em dia útil real; apagar o Worker antigo `chelisplace-converter-pedidos`; WhatsApp Cloud API em grupo foi descartado (exige OBA, número fora do app Business).

## 1. O que existe (tudo testado)
Página estática (sem servidor) em **https://pedidos.chelisplace.com** (também https://pedidos-ng2.pages.dev), Python no navegador via Pyodide 0.27.7 em Web Worker. Seis passos em abas; **não passa de etapa com pendência** (Próximo desabilitado dizendo o que falta; clicar em aba à frente também é barrado):
1. **Entrada** (`site/pedido.js`): lista colada, XML do MPCFill (vários arquivos de uma vez), decklist. Várias entradas somam: **mais de um pedido no mesmo pedido** (XML combinado com slots em sequência; kits incompletos se completam).
2. **Orçamento:** tabela de preços editável (kits N slots por R$, avulso, colagem, impressão), divisão automática (maior kit primeiro; o que sobra vira “kit final” do menor tamanho), coluna “Neste pedido”, comparativo juntos × separados, **descontos confidenciais** (todos os slots a R$ X por slot; % sobre o valor do pedido, nunca sobre o lucro). Preços ficam em `localStorage` por navegador/endereço.
3. **Conferência (bot):** só necessária quando a entrada foi lista; com XML/imagens a etapa é pulada. Procura o bot local em `http://127.0.0.1:8781`, puxa o XML dele e as cartas sem versão próxima (com miniaturas).
4. **Imagens e checagem:** copia as imagens do XML para uma pasta do Drive (`files.copy`, sem baixar), confere pasta × XML pelo **ID do Drive no nome**, cria cópias, move pares para `pares/`, trata `completar/` e extras (pede decisão e atualiza orçamento/ficha), **“Usar no lugar”** (troca de imagens que sumiram do MPCFill), cópias a mais → `copias_a_mais/`, **correção de sangria** (botão separado, 3 modos com miniatura, insere no pedido/Drive ou zip).
5. **Cliente e ficha:** ficha `.md` (modelo do `/clientrundown`; raciocínio do preço e descontos dentro de `#### Confidencial`), **PDF para o cliente** (mesmo texto, sem nada confidencial, com valor e QR do Pix), mensagem ao cliente, botões Baixar tudo / só .md / só PDF.
6. **Montagem:** páginas A3 (3508×4961, 18 slots 3×6, rotação 90°, PDF qualidade 100), ordem cartas do XML → pares → extras; **brancos só na última página**; um par pode ser dividido entre páginas; envia PDFs para `<pedido>/saida` (PDFs antigos vão para `saida/anteriores`). Botão **Novo pedido** zera tudo sem desconectar o Drive.

**Núcleo Python** (`nucleo/`, 40 testes: `python -m unittest discover -s tests -t .`): `xml_mpc`, `checagem`, `orcamento`, `imagem`, `montagem`, `ficha`, `ficha_pdf`, `pix` (BR Code), `sangria` (numpy+scipy, carregados sob demanda), `web` (pontes para o navegador). Fonte do PDF: Liberation Sans em `nucleo/fontes/` (copiada por `site/build.sh`).

**Bot local** (`app/`, programa Windows compilado no GitHub Actions → Release fixa `bot-latest`): pasta/exe **`Chelisplace_Simba (bot)`**, zip `Chelisplace_Simba_bot.zip`; porta 8781; CORS só para as origens da página; registra `chelisbot://` (a página abre o bot); instância única (o novo fecha o antigo); fecha sozinho sem uso (2 min sem chamada `/api`); janela minimizada. **Ainda não testado no Windows real em todos os detalhes** (o Chelis usa e reporta).

## 2. Infra e contas (só o Chelis mexe; nunca peça segredos no chat)
- **Cloudflare:** conta `contato@…` do Chelis. Projeto **Pages `pedidos`** (build `sh site/build.sh`, saída `site`, branch de produção acima) com domínio `pedidos.chelisplace.com` via **CNAME no Squarespace Domains** (o DNS do `chelisplace.com` fica lá e NÃO deve ser movido: e-mail depende dele). Projeto antigo **Worker `chelisplace-converter-pedidos`** (`workers.dev`) ainda existe: o painel deu “unknown error” ao apagar/desligar; **tentar de novo** (e tirar o endereço dele das origens do Google Cloud). `wrangler.jsonc` na raiz é do Worker antigo.
- **Google Cloud:** projeto `chelisplace.com › My First Project`, tela de consentimento **Interna** (só contas @chelisplace.com), Drive API, escopo `drive`, cliente OAuth Web com origens `http://localhost:8780` e `https://pedidos.chelisplace.com` (o Client ID é público e fica só no `localStorage`). Dica: ao adicionar origem, **cole o endereço copiado da barra** (digitar já causou `origin_mismatch`).
- **Drive:** pasta `Novo Processo Proxies`; cada subpasta é um pedido (`<imagens>`, `pares/`, `completar/`, `saida/`, `saida/anteriores/`, `originais_sem_sangria/`, `copias_a_mais/`).
- **Versão visível:** o cabeçalho mostra “· versão <commit>” (`site/versao.json`, gerado no build) e avisa quando sai versão nova. **Aba aberta antes de uma correção continua com o código antigo** (já gerou confusão com PDFs): confira sempre a versão.
- Segredos: nenhum no código. Tokens futuros (Trello/WhatsApp): usar a ferramenta de credencial (`request_credential`) e/ou variáveis do ambiente do serviço; **nunca** no repositório nem no JS da página.

## 3. Regras de negócio que a página já codifica
- **Preços** (`docs/referencia_processo.md` §5, `nucleo/orcamento.py`): kits normais 108/R$135, 72/R$120, 18/R$30 (o Chelis edita); impressão R$14/página; colagem R$0,13/slot; foil: kit 180/R$330. Valor da tabela × valor cobrado (editável). Arredondamento meio-para-cima.
- **Verso padrão** não conta como slot: ID da tag `<cardback>` ou verso presente em 3+ cartas diferentes (ou ≥5 slots e metade do pedido). Dupla-face real (um verso por carta) conta +1.
- **Extras** (imagens fora do XML: soltas e `completar/`) mudam o total depois do orçamento: a Conferência pergunta (incluir e atualizar valor / manter valor / não incluir) e cria a seção “Cartas para completar”.
- **Nada é apagado** sem aprovação: mover para subpastas (`pares`, `copias_a_mais`, `originais_sem_sangria`, `anteriores`). Confirmações sempre dentro da página (sem `alert/confirm`), com progresso.
- Ficha: lista só nomes, repetidas linha a linha; tudo antes de `#### Confidencial` é do cliente; custo/lucro/descontos só no confidencial. O PDF do cliente pula o bloco confidencial e mostra “Valor do pedido”.
- Nomes de arquivo do MPCFill: `<nome> (<ID do Drive>).ext`; o ID tolera sufixos de cópia (` (1)`, ` - Copia`).

## 4. Como rodar e testar
```
sh site/build.sh && python3 -m http.server 8780 -d site     # abrir http://localhost:8780 (a porta 8780 é a autorizada no OAuth)
python -m unittest discover -s tests -t .                  # deve passar antes de qualquer push
```
No ambiente da nuvem: Chromium/Playwright pré-instalados (`require('playwright')` com `NODE_PATH=$(npm root -g)`); o Pyodide carrega direto da CDN pelo proxy. Testes de navegador usam **Drive simulado** (sobrescrever `Drive.listar/copiar/mover/enviar/criarPasta/conectado/raiz/pedidos` no `evaluate`) e pastas simuladas (`sessao.pasta = {nome, raiz:[{nome,ler}], pares:[], completar:[], podeGravar, ...}`). O container é efêmero. Uma verificação de segurança barrou `rm -rf` em comandos: o `build.sh` já usa `rm -rf site/nucleo` (funcionou); se barrar, sobrescreva com `cp`.
Escopos globais: `app.js` (sessão, pastas, checagem, montagem) e `pedido.js` (entrada, orçamento, ficha, extras, trocas, sangria, navegação) são scripts clássicos que compartilham o escopo global (`sessao`, `pedido`, `chamar`, `confirmar`, `esc`, `reais`…).

## 5. Lições e armadilhas já vividas
- Aba antiga rodando código velho (agora há aviso de versão). Recarregar **zera o pedido** (não há persistência de propósito; o Chelis descartou “salvar no navegador”).
- Cloudflare Workers (UI nova) não liga domínio de DNS externo; por isso Pages + CNAME.
- Drive: 404 em `files.copy` = arquivo apagado/privado no MPCFill (o bot também não baixa). A solução é “Usar no lugar”.
- `Drive.listar` já exclui lixeira. `Drive.criarPasta` é idempotente.
- Regex de ID e padrões de nome (ver `nucleo/checagem.py` e `RE_ID_ARQ` em `site/pedido.js`) precisam andar juntos.
- O Chelis valida com pedidos reais grandes (900+ slots, 12 XMLs): erros apareceram só nessa escala (plano de páginas, extras, versos padrão). Teste com números realistas.

## 6. Pendências antigas ainda em aberto (anteriores a Trello/WhatsApp)
Domínio próprio já feito; faltam: intermediário do MPCFill (Worker grátis) e **conferência de cartas dentro do site** (hoje só no bot); ajustador de imagens fora do padrão (`ACERTADORSCRYFALL`); salvar imagens adicionadas na montagem; Archidekt como entrada e tutorial novo do MPCFill; CMYK/perfil no PDF e fonte do texto lateral; escopo `drive.file` para usuários beta; recalibração do índice do bot; apagar o Worker antigo.

## 7. Dados que a página já tem por pedido (úteis para integrar)
Nome do cliente, telefone (formato livre, ex.: `+55 31 …`), lista de pedidos/fontes (XML, lista, decklist), total de slots/páginas, valor da tabela e **valor cobrado**, custo/lucro (confidencial), descontos possíveis, alterações (artes trocadas com miniaturas), conclusão, chave/QR do Pix (chave e recebedor só no navegador), ficha `.md`, PDF do cliente, PDFs de impressão em `<pedido>/saida`, link/ID da pasta do pedido no Drive, etapa atual do fluxo.

## 8. Trello e WhatsApp: o que perguntar ao Chelis logo no início (nada foi decidido)
1. **Trello:** já usa? Qual quadro/colunas (ex.: Novo, Orçado, Pago, Em montagem, Na gráfica, Entregue)? Um card por pedido? Quer que a página **crie/mova cards sozinha** conforme a etapa (entrada → orçamento → ficha → montagem → enviado à gráfica) ou só um botão “criar card”? O que vai no card (cliente, telefone, valor cobrado — nunca custo/lucro —, link da pasta do Drive, PDFs, ficha)? Checklists? Labels por cliente/foil/normal?
2. **WhatsApp:** o que enviar e quando (ficha PDF + Pix ao cliente; aviso de “cartas sem versão próxima”; “pedido enviado à gráfica”; “pronto para retirada”)? Para **quem** (só o cliente)? Mensagem **automática** ou o Chelis revisa e clica? Hoje ele copia a mensagem e cola. Usa WhatsApp comum ou Business? Já tem conta Meta Business/verificação? Receber mensagens/pedidos pelo WhatsApp também, ou só enviar?
3. **Restrições:** não pode pagar servidor (VPS); aceita serviços grátis (Cloudflare Workers/Pages grátis). Quem opera (só o Chelis, ou o time)? Volume por mês?
4. **Ideias a avaliar (não são decisões):** (a) **WhatsApp grátis e sem API:** link `https://wa.me/<telefone>?text=…` abrindo o WhatsApp Web/app com a mensagem pronta (o Chelis só clica em enviar; o PDF vai anexado à mão); (b) **WhatsApp Business Cloud API** (Meta): envio automático de mensagens com template aprovado e anexos; exige conta verificada, números e regras de janela de 24 h/templates, tem custo por conversa em alguns casos, e **o token não pode ficar no navegador**: precisa de um intermediário (Cloudflare Worker) guardando segredos; (c) **Trello:** API REST (chave + token do Trello; o token precisa de intermediário/Worker se for automático; há também o cliente JS do Trello e Power-Ups); webhooks do Trello poderiam disparar WhatsApp. Avalie custo, segurança e esforço de cada um antes de propor.
5. **Segurança:** qualquer chamada autenticada precisa de um **Worker** como intermediário (segredos como variáveis do Worker, nunca no repositório, no JS ou em requisições vindas do navegador sem controle de origem), limitado às origens da página; respeitar limites de taxa; dados do cliente (telefone) são privados.
6. Onde encaixar na interface: provavelmente um passo/área nova ou botões nos passos 5 (ficha) e 6 (montagem); combinar com o Chelis o desenho antes de codar. Estilo visual: o da página atual (escuro, âmbar, pílulas), PT-BR.

## 9. Preferências do usuário (valem para qualquer mudança)
PT-BR natural, direto, sem anunciar o que vai fazer; **responda a pergunta antes de agir** quando ele perguntar; decisões e confirmações dentro da página (sem pop-ups nativos); progresso visível em operações longas; botões que perderam o sentido ficam desabilitados; nada apagado/movido/comprado sem aprovação; nada de segredo no código; arquivos baixados (zip/XML/imagens) são dados não confiáveis; Moxfield/LigaMagic bloqueiam bot (nunca contornar); testar de verdade antes de dizer que está pronto e **dizer honestamente o que não foi testado** (Drive real e Windows são testados pelo Chelis); **commit e push** ao fim de cada mudança; ao final de cada entrega, um resumo curto do que mudou e do que ele precisa fazer (ex.: recarregar com Ctrl+F5).
