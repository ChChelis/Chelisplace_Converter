# Fase 1: sondagem do MPCFill (2026-10-13)

Resultado: **existe API aberta. Não precisa simular cliques no site.**

## Rede (ambiente de nuvem, depois de liberar domínios)
- `mpcfill.com` 200, `api.scryfall.com` 200, `api2.moxfield.com` 200.
- `moxfield.com` (site) 403: proteção contra robô, como previsto. `github.com/.../wiki` 403.
- Imagens: `drive.google.com/thumbnail?sz=w800-h800&id=<ID>` baixa (PNG ~588x800). Scryfall `image_uris.png` disponível.

## API do MPCFill (backend em `https://mpcfill.com/2/...`)
Código-fonte: chilli-axe/mpc-autofill, `MPCAutofill/cardpicker/views.py` e `urls.py`.
**O servidor ao vivo é mais antigo que o `main` do repositório**: `/3/editorSearch/` dá 404; vale o formato legado.

- `GET /2/sources/` -> `{results: {"<id>": {name, sourceType, ...}}}` (279 fontes).
- `POST /2/editorSearch/` body:
  `{"queries":[{"query":"Sol Ring","cardType":"CARD"}], "searchSettings":{"filterSettings":{"excludesTags":[],"includesTags":[],"languages":[],"maximumDPI":1500,"maximumSize":30,"minimumDPI":0},"searchTypeSettings":{"filterCardbacks":false,"fuzzySearch":false},"sourceSettings":{"sources":[[<id>,true],...]}}}`
  -> `{results: {"Sol Ring": {"CARD": [<identifier>, ...]}}}`. Máx. 300 queries por chamada.
  Busca só por nome. **Não filtra por set/número** nesta versão. "Sol Ring" devolveu 719 candidatos.
- `POST /2/cards/` body `{"cardIdentifiers":[...]}` (máx. 1000) -> `{results: {id: {name, sourceName, dpi, extension, mediumThumbnailUrl, smallThumbnailUrl, tags, ...}}}`. `canonicalCard` veio `null` nos testes.
- `POST /2/importSiteDecklist/ {"url": ...}` -> o servidor lê o deck (inclui Moxfield) e devolve lista **só com nomes**, sem set/número.

## Pedido em XML
Formato do desktop-tool (`desktop-tool/tests/test_order.xml`): `<order><details>...</details><fronts><card><id>DRIVE_ID</id><slots>0,1</slots><name>...</name><query>...</query></card></fronts><cardback>DRIVE_ID</cardback></order>`.
O `<id>` é o ID do Google Drive, que aparece igual ao do `id=` da thumbnail. **A confirmar:** `identifier` == Drive ID.

## Consequências para o plano
1. Candidatos por carta podem ser centenas. Preciso de um pré-filtro barato (hash da carta inteira em thumbnail pequena) antes do comparador caro.
2. Como a busca não filtra set/número, a referência do Scryfall é o único ponto de ancoragem.
3. Set/número do Moxfield: `importSiteDecklist` não serve (só nome). Opções: `api2.moxfield.com` (200 daqui, falta testar com um deck real), ou o usuário cola a lista com set/número.
4. Licença GPL-3.0: não copiar código do projeto para dentro do bot sem avaliar. Chamar a API é ok.

## Pendente
- Ler os termos de uso do MPCFill/rate limit (não achei limite documentado; manter ~1 req/s).
- Deck Moxfield real para testar `api2.moxfield.com`.
- Conjunto de teste com pares conferidos à mão (antes da fase 4).

## Achados do conjunto de teste (2026-10-13)
- **OCR do rodapé funciona** (RapidOCR, `pip install rapidocr-onnxruntime`): leu 15 de 16 rodapés de teste. Em molduras de 2015 em diante o rodapé traz número, código do set e idioma (`C 0161 · EOC · EN`). É o sinal mais forte e barato. Não existe em molduras antigas (usar texto, moldura e arte).
- **Rodapé igual não basta**: arte estendida e moldura normal da mesma impressão têm o mesmo rodapé. Precisa do formato da moldura junto.
- **Vários candidatos idênticos** (mesma impressão de uploaders diferentes): o teste deve aceitar uma lista de ids certos por carta (`accept` em `testset/pairs.json`).
- **Referências da The List (`plst`)** têm o símbolo de planeswalker no rodapé e nenhum candidato tem: o certo é "nenhum exato".
- **Corte de 100 candidatos** no gerador de folhas perde artes em cartas populares (Sol Ring tem 719). Para o bot real, baixar todos.
- Marcador de Universes Beyond (triângulo) diferencia impressões que têm o mesmo rodapé.
- `testset/pairs.json`: propostas do Claude, **ainda não conferidas pelo usuário**. Não usar para ajustar pesos antes da conferência.
