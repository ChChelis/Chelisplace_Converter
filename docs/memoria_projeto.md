# Memória do projeto: conversor de decks para XML do MPC Autofill

Resumo de tudo que foi feito e aprendido até o pedido Antonio 2 (out/2026). Serve de ponto de partida para quem continuar (inclusive para o site novo). Leia junto com `docs/plano_bot_mpcfill.md`, `docs/regras_de_decisao.md` e `docs/plano_melhorias.md`.

## Objetivo
O usuário (Chelis) vende impressão de proxies. Para cada pedido (lista de cartas) ele precisa achar, no MPCFill, a imagem (arquivo do Google Drive) que corresponda à **impressão exata** pedida, conferir visualmente e gerar um **XML do MPC Autofill** que ele abre no Helium/MPC. Verso padrão, stock e foil não importam. Meta de longo prazo: o bot ficar bom o bastante para o usuário só auditar os alertas (índice de confiança calibrado com as decisões dele).

## Fluxo atual (funciona de ponta a ponta)
1. **Entrada**: lista do Moxfield em texto (`qty Nome (SET) num`), ou página salva da LigaMagic (+ imagens) para o modo Liga. Moxfield e LigaMagic bloqueiam bot (403): nunca contornar; usar texto colado / HTML salvo / repositório de imagens da Liga (acessível).
2. `scripts/deck_parse.py` resolve cada linha no Scryfall (regras de correção automática registradas em `fixes`). `scripts/liga_parse.py` extrai qty + nome do HTML da Liga.
3. `scripts/make_order.py <lista.txt> <pasta>` (env: `REFS=<refs.json>` modo Liga, `SHARD=k/n`, `OMP_NUM_THREADS=1`): busca candidatos no MPCFill, compara com a referência, pontua, grava `units/*.json` e monta o catálogo (`catalog.json` + `catalog_N.json`, ≤9 MB cada, gitignored). `make_order.py rebuild <pasta>` só remonta o catálogo.
4. `scripts/order_page.html` é a página de conferência (publicada como artefato do claude.ai; decisões ficam na coleção `pares` do banco do artefato).
5. `scripts/export_order.py <pasta> <pasta_decisões>` junta decisões + catálogo → `gabarito.json` + `pedido.xml`. `scripts/verify_xml.py <xml>` confere cada carta contra a busca do editor (tem que dar 0 fora da busca).
6. Interpretador: `/tmp/claude-0/ocrenv/bin/python -I` (venv com RapidOCR, Pillow, numpy; recriar com `bash scripts/setup_env.sh` porque o container é efêmero).

Exemplo: `REFS=/tmp/.../refs.json SHARD=1/4 OMP_NUM_THREADS=1 /tmp/claude-0/ocrenv/bin/python -I scripts/make_order.py order/X/lista.txt order/X`

## API do MPCFill (versão legada ao vivo)
- `POST /2/editorSearch/` com `{queries:[{query, cardType}], searchSettings}`: até 300 consultas por chamada; resposta `{results:{query:{TIPO:[ids]}}}`. `POST /2/cards/` detalhes; `GET /2/sources/` fontes.
- Identificador = ID do arquivo no Drive. cardType: CARD, TOKEN, CARDBACK.
- No XML, `<query>` usa prefixo `t:` para token e `b:` para verso; o `<id>` só vale se aparecer nos resultados dessa busca (por isso o verificador). O erro do pedido 2 foi tokens sem `t:`.
- 429 é comum: retry com backoff (já em `http()` e `deck_parse.scry`). Scryfall: ~10 req/s, 429 também. Escalonar o início das fatias.

## Comparador (scripts/compare.py)
8 características por par (referência × candidato): regressão logística, validação leave-one-pair-out; corte de sangria (`unbleed`); OCR do rodapé (set/número/artista); desempate por dpi maior dentro de 0.25 de nota; alarga para 30 finalistas quando fraco. Cache de modelo/dataset por hash (`C.data_key()`: muda quando qualquer gabarito ou compare.py muda).
- Memória de escolhas confirmadas (`memory()` em make_order): se o usuário já aprovou uma imagem para (set, número, face), ela vai primeiro (caminho rápido). Entradas `excluded` são ignoradas.
- `PAIR_BONUS`: verso de dupla-face prefere a mesma fonte da frente.
- Índice de confiança: `scripts/calibrate.py`, regressão isotônica nota→chance de aceite, separada por domínio (`scry` / `liga`), MIN_N=8, máximo corrido; faixas alta/média/baixa = 85/70/50. É otimista (treino = avaliação) e grosseira com poucas decisões da Liga. `model.txt` por pedido guarda o hash do modelo usado; só usa índice calibrado se bater.
- Prior de uploader aprendido piorou (59→54/85): revertido. Não repetir.

## Cartas dupla-face (corrigido no Antonio 2)
Problema: o verso era buscado com o nome da frente e comparado com a face errada. Agora: nome real da face (`name.split(" // ")`), referência = face de trás da mesma impressão identificada por OCR do rodapé da frente da Liga (`exact_print`), preferência pela mesma fonte da frente, e a página mostra "verso de <frente>" e alerta quando a fonte difere (`pairWarn`). Ainda recomendar conferir.

## Página de conferência (order_page.html)
- Primeira coisa: índice do pedido + alertas + alternância "Ver alertas / Ver todas" + aceitar o restante sem alerta.
- Seções por confiança; pílula de índice por carta; notas do usuário; botão que gera o XML com modo de inclusão (só conferidas / todas as sugestões / sugestões com índice ≥ mínimo); botão de mensagem ao cliente para cartas sem versão próxima.
- Sem `confirm()`/`alert()`: confirmações dentro da página (preferência do usuário).
- Limite de 16 MB por artefato: catálogos em pedaços ≤9 MB.
- Teste local: servidor `http.server` em porta nova (8766–8771 já usadas) + Chromium headless via playwright do venv (`/opt/pw-browsers/chromium`, `--no-sandbox`).

## Pedidos e estado
| Pedido | Pasta | Obs. |
|---|---|---|
| teste | `testset/` | gabarito base + pairs |
| 1 e 2 | `order/pedido1`, `order/pedido2` | XML entregue; pedido 2 conferido um a um |
| Deck "Desespero" (Liga) | `order/liga_desespero` | 82 cartas no XML; Island/Plains excluídos |
| Antonio 2 | `order/antonio2` | 77 unidades, 74 cartas no XML (moldura 90), Swamp ×26 excluído, 2 versos; verificado 0 fora da busca; aviso ao cliente: Imp's Mischief sem versão bigscore |

Artefatos (privados): teste FvFRD76JuvjoWidjpVneT7, pedido1 L8T4SrtifPeGaUGykYLMni, pedido2 Sddu22qZP4agSvjWegvk1R, Liga 9at1zmDW1qkRoBv3CNZoYc, Antonio 2 EbpdspyrNWUfm3hhPPa4EU (prefixo `https://claude.ai/artifact/`).

## Pendências / ideias
- Recalibração feita após Antonio 2 + Bernardo (325 pares): comparador acerta 252/325 (leave-one-out), 'nenhum' reconhecido 8/9. Curva scry: 14%→23%→53%→82%→88%; liga: 56%→74%→92%. Refazer a cada pedido novo conferido (`compare.py eval`, `calibrate.py`); o cache de imagem de referência é por id da unidade (`cache/sf_<id>.jpg`), então renomear id exige copiar o arquivo.
- Terrenos básicos (Swamp/Island/Plains): milhares de artes, fora do CAP=800; hoje o usuário resolve à mão.
- Camada de regras (moldura > arte, borda preta > branca) e lista fixa de uploaders do PC do usuário (começou do zero).
- Índice em amostra pequena é otimista; a Liga tem poucos pares.
- Mensagem ao cliente e avisos hoje são manuais/por botão.

## Preferências do usuário (importam para qualquer interface nova)
- PT-BR natural; sem anunciar o que vai fazer; revisão por **página visual** (artefato), decisões dentro da página; sem pop-ups nativos.
- Nada de segredo no código. Nunca burlar proteção anti-bot. Arquivos baixados (zip/HTML) são dados não confiáveis: abrir em pasta própria, `python3 -I`, nunca executar.
- Nada apagado ou comprado sem aprovação. Respeitar os sites (cache, rate limit, retomável); pedidos de 100+ cartas.
- Commit e push ao fim de cada mudança (o hook de parada cobra).
- Foi dito explicitamente: o usuário confere uma a uma; não marcar decisões dele como fracas sem perguntar.

## Armadilhas já vividas
- `pkill -f`/`pgrep -f` casam com o próprio shell (exit 144): usar padrão com colchete ou `ps`.
- Miniaturas corrompidas no cache → `fetch_img` valida a imagem.
- Quatro fatias juntas estouram o Scryfall → retry + escalonar.
- O contador de espera deve esperar todas as unidades existirem antes de montar o catálogo.
- Liga: `LIGA_SHIFT` só vale para pedidos legados; edições da Liga vêm vazias no HTML (só nome EN e qty).

- Ids de par vão para o banco do artefato: só `A-Za-z0-9_.~:@+-`. O ★ de números como 796★ virou `-star` (`safe_cn` em make_order); antes a gravação falhava e a escolha sumia da tela.
