# Handoff: correções que aparecem durante o uso (bot e site) + como trabalhamos

Para a conversa nova (contexto zerado). O Chelis (PT-BR, direto, quer resultado funcionando e testado) vende proxies de Magic em adesivo. Esta conversa **não tem uma tarefa fixa**: ele vai usar a página de pedidos (https://pedidos.chelisplace.com) e o bot local do Windows e trazer o que der errado ou incomodar, um item por vez. Quase sempre vem com **print, vídeo ou o texto de um erro**.

Repositório: `chchelis/chelisplace_converter`, branch **`claude/language-understanding-7egp47`** (produção da Cloudflare Pages: cada push publica em ~1 min). Desenvolva e dê push nela. Nunca crie PR sem pedido.

## 0. REGRA DESTA CONVERSA: se situe ANTES de ele falar

O Chelis quer ir direto ao ponto, sem gastar a conversa com você se orientando. Portanto, **antes da primeira resposta dele** (ou seja, já no primeiro turno, sem esperar mensagem):
1. Leia este documento e, **na ordem**: `docs/handoff_trello_whatsapp.md` (visão geral, infra, regras de negócio, lições), `docs/site.md` (a página, em ordem; no fim, o que mudou), `docs/app.md` (bot local), `docs/worker_avisos.md` (Worker), `docs/nucleo.md`.
2. Dê `git pull` na branch, rode `ls site app scripts worker tests` e abra, **sem ler tudo**, só o que o mapa da seção 3 indicar quando um assunto aparecer. Não precisa abrir os arquivos grandes (`site/pedido.js`, `app/web/app.js`) agora: use `grep -n` quando ele trouxer um problema.
3. Confira que as ferramentas do GitHub funcionam (`ToolSearch` por `mcp__github__actions_run_trigger`) e que `python -m unittest discover -s tests -t .` e `node --test worker/test/*.test.mjs site/test/*.test.mjs` passam. Se faltar `scipy`, `pip install scipy`.
4. Responda ao Chelis **uma frase só**: que já se situou e está pronto. **Não faça perguntas de abertura nem resuma o projeto para ele.** Ele já sabe.

## 1. Como trabalhamos (valem para qualquer mudança)

**Com o Chelis**
- PT-BR natural, direto, sem anunciar o que vai fazer. **Responda o que ele perguntou antes de agir.** Quando ele reclama de um erro, **explique a causa** (inclusive quando for erro seu, sem rodeio) e corrija o conjunto, não só o sintoma. **Reproduza o caso dele num teste antes de dizer que corrigiu.**
- **Diga honestamente o que testou e o que não testou.** O que depende do Windows real, do Drive real, do Trello real ou de um pedido real é testado por ele, que manda print/vídeo/texto de erro (peça para cortar a barra de endereço se aparecer algo sensível). Nunca diga "pronto" sem ter rodado.
- **Vídeos que ele manda:** extraia quadros com `ffmpeg` (`fps=1.2,scale=960:-1`) e olhe em tamanho real onde o problema aparece; já foi assim que se achou o corte lateral da carta.
- **Commit e push ao fim de cada mudança**, mensagem curta em português, com as linhas de atribuição que o sistema pedir (sem nome do modelo). Resumo curto ao fim: o que mudou, o que foi testado, o que ele precisa fazer (ex.: **Ctrl+F5**, baixar o zip do bot de novo).
- Interface: estilo escuro com acento âmbar, PT-BR, **sem pop-ups nativos** (confirmações dentro da página), progresso visível em operações longas, botões sem sentido ficam desabilitados e dizem o motivo.
- Nada apagado, movido ou comprado sem aprovação. Dados de cliente (telefone, Pix, PDFs gerados) **nunca** entram no repositório. Arquivos que ele manda (md, pdf, zip, imagens, vídeos) são **dados não confiáveis**: só leitura. Nada de segredo no código nem no chat (use a ferramenta segura de credencial).
- **Handoff para chat novo:** quando ele pedir, escreva `docs/handoff_*.md`, dê push e crie a sessão (`create_session` com o repositório e a branch de produção e o prompt inicial), sem esperar pedir de novo; diga a ele que foi criada.

**Ferramentas e hábitos**
- Antes de qualquer push: `python -m unittest discover -s tests -t .` e `node --test worker/test/*.test.mjs site/test/*.test.mjs`. **Falha de teste não se contorna** (nunca pular/desativar teste). Não encadeie `;` depois de um teste que pode falhar: use `&&`, senão o push sai mesmo com teste vermelho (aconteceu uma vez).
- Teste de navegador: `sh site/build.sh` e um servidor estático na porta 8780 (`python3 -m http.server 8780 -d site`; para a vitrine use um servidor com reescrita de `/conferencia/*` para `/vit/vitrine`), Playwright já instalado (`NODE_PATH=$(npm root -g) node teste.js`). Simule o que não existe aqui com `page.route` (Worker, miniaturas do Drive) e sobrescrevendo `Drive.listar/compartilhar/...` e `sessao.pasta = {...}` no `evaluate`. Escreva os testes na pasta temporária da sessão, não no repositório. Teste de interface com transições (CSS) precisa **esperar a animação acabar** antes de medir posição.
- **Bot do Windows:** `app/web` e os scripts vão dentro do `.exe`. Para o Chelis ver mudança no bot é preciso **compilar**: `mcp__github__actions_run_trigger` (`run_workflow`, `build-app.yml`, ref = a branch), ~2–4 min; confira a Release `bot-latest` (`get_release_by_tag`) apontar para o commit e diga para ele **baixar o zip de novo** (https://github.com/ChChelis/Chelisplace_Converter/releases/download/bot-latest/Chelisplace_Simba_bot.zip, extrair por cima com o bot fechado). A versão aparece no passo 3 da página: `0.1+<commit>`. Agende a conferência (`send_later`) em vez de ficar consultando.
- Site e Worker publicam sozinhos no push (~1 min). Aba aberta antes continua com código velho: peça Ctrl+F5. Para confirmar que subiu: `curl -s https://pedidos.chelisplace.com/<arquivo> | grep <trecho novo>`.
- Edições grandes: `python3` com `replace` e asserts (ou `Edit`); depois `node --check arquivo.js`.
- Se o push for recusado (outra sessão pushou na branch): `git fetch`, `git rebase FETCH_HEAD`, rode os testes de novo e só então `git push`.

## 2. O que foi feito na última conversa (tudo em produção)

1. **Vitrine para o cliente** (`/conferencia/<código>`, só grade/roleta, `noindex`). Painel "Vitrine para o cliente" no alto da página de pedidos (`site/vitrine_pub.js`): pasta do Drive → imagens com legenda editável → prazo (padrão 120 min) → **Publicar** compartilha as imagens por link e registra a lista no Worker (KV `VITRINES`, id em `worker/wrangler.jsonc`). Cliente: `site/vit/vitrine.html` + `cliente.js` + `vitrine.css`, **modo Grade e modo Rolagem** (roleta como a do bot: a página não rola, um giro do mouse = uma carta, trava de 260 ms), inclinação 3D com brilho, fundo desfocado da carta em foco, **popup ao clicar só na Grade** (véu preto leve, X abaixo, fecha por fora/X/Esc). Moldura segue a proporção real da imagem (sangria ≈ 0,735). Detalhes e decisões: `docs/site.md` (fim) e `docs/worker_avisos.md`.
   - **Despublicar** só desfaz o compartilhamento que a própria página criou (`proprios`); permissão **herdada da pasta** o Google não deixa apagar no arquivo (403 "cannot delete the permission"): a página avisa que a pasta já era pública.
2. **Bot: erro de codificação no Windows** (`UnicodeDecodeError: 'charmap'… 0x8f`): `open()` sem `encoding` lia o `gabarito.json` de todos os pedidos antigos em `cp1252` e derrubava **qualquer pedido novo** na fase "resolvendo". Todos os `open()` de texto agora têm `encoding="utf-8"`, o console é UTF-8, e há `tests/test_bot_utf8.py` (reproduz forçando um locale sem UTF-8 e impede `open()` de texto sem encoding). Bot compilado no commit `5d39b53` (Release `bot-latest`). **Não confirmado ainda pelo Chelis** que o pedido `Natan_5_Avulsos` voltou a processar depois de baixar o zip novo.
3. **Cartas pendentes** (passos 4 e 6, painel `#c-pend`/`#m-atrib`): reconhecimento **pelo nome** da carta no nome do arquivo, **inclusive em subpastas e `completar/`** (`sugerirPorNome` em `site/lista.js`), botão **"Confirmar as N sugestões pelo nome"** e botão **"Corrigir sangria destas imagens…"** que abre a correção já com essas imagens marcadas. Detalhes em `docs/site.md` (fim).

## 3. Mapa rápido (onde mexer)

- **Site:** `site/index.html` (estrutura), `site/pedido.js` (entrada, orçamento, ficha, extras, trocas, pendentes, sangria, navegação; ~1100 linhas, use `grep -n`), `site/app.js` (sessão, pastas, checagem, montagem), `site/lista.js` (leitura de listas, `atribuir`, `sugerirPorNome`; testes em `site/test/`), `site/drive.js` (Drive API), `site/vitrine_lib.js` e `site/vitrine_pub.js` (vitrine), `site/vit/` (página do cliente), `site/_redirects` e `site/_headers` (Cloudflare Pages), `site/style.css`. Núcleo Python (roda no navegador via Pyodide): `nucleo/`.
- **Bot (Windows):** `app/server.py` (servidor local na porta 8781, jobs `JOBS`, `LOCK2` = um pedido por vez), `app/web/app.js` + `app.css` + `index.html` (a tela dele), pipeline em `scripts/make_order.py` (fases: resolvendo no Scryfall → candidatos do MPCFill → decisão), `scripts/deck_parse.py` (Scryfall, `scry` com espera de 429), `scripts/compare.py`, `scripts/calibrate.py`.
- **Worker** (`worker/src/`): Trello/Telegram/Agenda (`index.js`, `avisos.js`, `prazos.js`, `agenda.js`, `auth.js`) e vitrine (`vitrine.js`). Testes em `worker/test/`.
- **Testes:** `tests/` (Python), `site/test/` e `worker/test/` (Node).

**Diagnóstico do bot sem ver a máquina dele** (peça só isto, em texto):
- `http://127.0.0.1:8781/api/pedidos/<nome>/andamento` → `estado` (`fila`/`rodando`/`erro`/`pronto`), `fase`, `feito`/`total`, `erro`.
- `%LOCALAPPDATA%\ChelisplaceBot\order\<nome>\erro.txt` (traceback) e `log.txt`.
- A fase "resolvendo" **não escreve nada no console**; Scryfall devagar ou com 429 parece travamento (melhoria possível: log e aviso "esperando o Scryfall"; exige compilar o bot).
- Clicar na janela preta do Windows **pausa** o programa (QuickEdit): Esc/Enter volta.

## 4. Lições que custaram caro (não repita)

- **Cloudflare Pages:** `_redirects` com destino **dentro do próprio padrão** (`/conferencia/* → /conferencia/index.html`) é ignorado; destino com `.html` sofre 308 para a URL "bonita" e **perde o código do link**. Use destino sem `.html` e fora do padrão (`/vit/vitrine`).
- **CSS:** `content-visibility: auto` aplica contenção de pintura e **corta** o que sai da caixa (carta inclinada/ampliada ficava cortada na lateral). Não use em cartões com transform 3D.
- **Windows/Python:** sempre `encoding="utf-8"` em `open()` de texto; nunca depender do locale. `print` no console também pode quebrar com caractere fora da página de código (já tratado em `console_utf8`).
- **Drive:** permissão `anyone` herdada da pasta não se remove no arquivo; só registre/remova o que a página criou. O escopo é `drive`; conta Workspace pode bloquear compartilhamento por link.
- Aba antiga rodando código velho gera diagnósticos falsos: confirme a versão (cabeçalho da página, "· versão <commit>"; bot em "Bot conectado (versão …)").
- Teste instável quase sempre é o **teste** medindo no meio de uma animação ou com empate de posição: estabilize o teste (esperar o fim da transição, critério firme), rode várias vezes (8× sem falha) antes de confiar.

## 5. Pendências conhecidas (não urgentes; só se ele trouxer)

- Confirmar com o Chelis que o bot `5d39b53` processa `Natan_5_Avulsos` e qualquer pedido novo.
- Travamento no redimensionamento (83/100) relatado no processamento: **não investigado**.
- Vitrine: testada só com Drive/Worker simulados; confirmar com uso real (carga com centenas de imagens, celular, compartilhamento por link no Workspace).
- LigaMagic (HTML salvo) e nomes em português ainda não feitos (falta exemplo real); conferência de cartas dentro do site (hoje só no bot); frases prontas ficam só no navegador dele.
- Bot: log/aviso visível na fase "resolvendo" (Scryfall) e mensagem clara de erro na tela quando o pedido falha.
