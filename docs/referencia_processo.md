# Referência do processo (levantada no PC de casa)

Levantamento só de leitura, feito em 2026-10-22 a partir de `D:\GITHUB\Stick-Spell`, dos dois pedidos de exemplo, das skills do Claude Code (`~\.claude\skills`), das fichas no Obsidian e do `AGENTS.md` do Zed. Nada foi movido, apagado ou executado. Os PSDs foram só lidos (estrutura de camadas), sem abrir o Photoshop.

Convenções deste documento:
- **Medido** = lido direto de arquivo. **Inferido** = conclusão minha a partir de números medidos. **Dúvida** = não achei; está na seção 9.
- Dados de cliente e a chave pix foram trocados por marcadores: `<CLIENTE>`, `<TELEFONE>`, `<CHAVE_PIX>`.
- Os dois pedidos de exemplo aparecem como **Pedido A** (com XML) e **Pedido B** (imagens + decklist, sem XML).

Leia junto com `docs/memoria_projeto.md` (pipeline lista → candidatos → comparador → conferência → XML).

---

## 1. Visão geral do negócio e do fluxo

Produto: proxies de Magic em adesivo. A gráfica imprime **SRA3 em vinil leitoso adesivo com meio corte**; o Chelis destaca, cola cada adesivo em carta "bulk" e apara (fonte: nota de proposta da loja no Obsidian). A página enviada à gráfica é **A3 retrato com 18 cartas**.

Fluxo (confirmado pelas skills e scripts):
1. Entrada: XML do MPCFill, lista (Moxfield/LigaMagic), imagens já baixadas, ou só lista.
2. Baixar imagens do MPCFill pelo XML → pasta do pedido.
3. `/checagem` (seção 4) → pasta batendo com o XML + `pares/` + XML dos faltantes.
4. `/clientrundown` (seção 5) → ficha `Pedido <Cliente>.md` com valor.
5. `/montagem` (seção 6) → redimensiona no Photoshop, monta páginas de 18, exporta PDFs.
6. Sobe PDFs e a faca (`000 - FACA_UNICA.pdf`) no Drive e manda o link à gráfica.

Variantes: `/montagem-a4` (8 slots), `/montagem-foil` + `/foilcoat` (foil com máscara), seção 7.

---

## 2. Medidas e especificações de impressão

### 2.1 Página (medido)
| Item | Valor |
|---|---|
| PSD principal | `PSD\GRADE_page_tst_sticker_auto.psd` |
| Tamanho do documento | **3508 × 4961 px**, 8 bits/canal, **CMYK** |
| Resolução | 300 ppi (A3 = 297 × 420 mm → bate: 3508 × 4961) |
| MediaBox/CropBox dos PDFs (lido de `000 - FACA_UNICA.pdf`) | `[0 0 841.92 1190.64]` pt = 297 × 420 mm, retrato |
| Slots por página | **18** (3 colunas × 6 linhas) |

### 2.2 Slot / imagem da carta (medido)
- Imagem de saída do redimensionamento: **816 × 1110 px**, 300 dpi (gravado como 299,9994), PNG RGB 24 bits. Algumas saem com **816 × 1111** (arredondamento; visto em 1 de 3 amostras).
- Em mm: 816 px = 69,09 mm; 1110 px = 93,98 mm.
- **Inferido:** carta de Magic 63 × 88 mm = 744 × 1039 px; sobra ≈ 3 mm por lado ⇒ a imagem inclui **sangria de ~3 mm**. Confirmar com o Chelis (seção 9).
- No PSD os 18 smart objects ficam **girados 90°** (largura 1110 × altura 816 no layout), por isso 3 colunas de ~1110 px cabem em 3508 e 6 linhas de ~816 px cabem em 4961.

### 2.3 Posição dos 18 slots (medido, em px da página; bbox = esquerda, topo, direita, base)
Passo horizontal ≈ 1111 px (colunas em x ≈ 0, 1112, 2222); passo vertical ≈ 828,6 px (linhas em y ≈ 0, 829, 1657, 2486, 3315, 4143). Os valores variam ±3 px porque as camadas foram posicionadas à mão.

| Slot | bbox | Slot | bbox | Slot | bbox |
|---|---|---|---|---|---|
| 1 | 0,0 – 1110,816 | 7 | 3,1657 – 1111,2473 | 13 | 1,3315 – 1109,4131 |
| 2 | 1112,0 – 2222,816 | 8 | 1111,1657 – 2219,2473 | 14 | 1112,3315 – 2220,4131 |
| 3 | 2222,0 – 3330,816 | 9 | 2222,1657 – 3332,2473 | 15 | 2220,3315 – 3330,4131 |
| 4 | 1,829 – 1109,1645 | 10 | 2,2486 – 1110,3302 | 16 | 2,4143 – 1113,4959 |
| 5 | 1112,829 – 2220,1645 | 11 | 1110,2486 – 2220,3302 | 17 | 1112,4143 – 2220,4959 |
| 6 | 2222,829 – 3332,1645 | 12 | 2220,2486 – 3331,3302 | 18 | 2221,4143 – 3329,4959 |

Os 18 smart objects apontam para `1.png … 18.png` (pasta `TEMPLATE\TEMPLATE METRO\`).

### 2.4 Estrutura do PSD (medido)
- Prancheta `1` (3508 × 4961) contendo: `grade/grade/{1,2}` (slots 1–10 e 11–18), ajustes `Níveis 1` e `Brilho/Contraste 1`, `regua` (oculta; linhas guia por linha/coluna), `faca_cartas` (oculta; 6 formas, uma por linha: bbox x 31–3298, linhas em y 29–787, 858–1616, 1686–2444, 2515–3273, 3344–4102, 4172–4930), `info/cliente` (textos), `stickers` (oculto; grade `posições` de 6 colunas × pelo menos 10 linhas (a skill cita `posicoes/10/6`) de quadrados ~475 px, a partir de x=31,y=29, passo ~558 horizontal e ~492 vertical).
- Textos: `Nome cliente 1` (bbox x 3400–3455, y 4170–4437), `Quantidade cliente 1` (x 3391–3471, y 4510–4886, formato `018/018`), `Nome cliente 2` e `Quantidade cliente 2` (ocultos). Ficam numa faixa lateral direita (x ≈ 3391–3473), fora da área das cartas.
- A faca é um PDF único e padrão: `IMPRESSÃO\000 - FACA_UNICA.pdf` (A3, ~1,9 MB).

### 2.5 Exportação do PDF (medido nos scripts)
- Preset: `CHELIS_PDFCOMUM.joboptions` (em `%APPDATA%\Adobe\Adobe PDF\Settings`; **não está no repositório**) para arte; `CHELIS_PDFTRANSPARENTE.joboptions` (cópia em `scripts\photoshop\presets\`) para foil.
- Parâmetros do preset transparente (que é cópia do comum com transparência ligada): `CompatibilityLevel 1.6`, `AllowTransparency true`, conversão de cor `CMYK`, imagens colorido/cinza **300 dpi** (downsample bicúbico, limiar 1,5), mono 1200, **Quality 30**, `EmbedAllFonts true`, `Optimize true`, base PDF/X-1a:2001 com `PDFXCompliantPDFOnly false`. O comum usa compat 1.3.
- O jeito de manter o PDF leve (validado, ver `MEMORIA_AUTOMACAO_STICK_SPELL.md`): Action Manager com `presetFile` dentro do descritor PDF e, no `save`, `Cpy=true`, `LwCs=true`, `Lyrs=false`, `EmbP=false`. Isso evita `/PieceInfo`, `AdobePhotoshop` e `StandardImageFileData2`. Tamanhos reais vistos: PDFs de página ≈ 29–33 MB; página com stickers ≈ 17,9 MB; faca ≈ 1,9 MB.

### 2.6 Imagens de origem do MPCFill (medido, amostra)
Chegam em tamanhos diversos: 3264×4440 @1200 dpi (JPG), 2184×2972 @800 dpi (JPG), 2187×2975 @96 dpi (PNG com alfa), além de CMYK ocasional. Todas vão para **816×1110 @300 dpi RGB** pela ação do Photoshop.

---

## 3. Como o Photoshop é controlado hoje

- **Ponte:** PowerShell 5.1 → COM (`Photoshop.Application`, via `GetActiveObject` com fallback `New-Object -ComObject`) → `DoJavaScript(<JS embutido>)`. Os scripts ficam em `D:\GITHUB\Stick-Spell\scripts\photoshop\` e têm `.cmd` de atalho.
- **Redimensionar:** ação `[PROXY] - Redimensionar` do conjunto **`Ações Chelis`** (arquivo `[PROXY] - Redimensionar.atn` na raiz do Stick-Spell). Decodificando o `.atn` (medido): passo 1 `Tamanho da Imagem` (largura **relativa em %**, resolução **300 ppi**, `scaleStyles`, `constrainProportions`, interpolação automática); passo 2 `Salvar` como **PNG** (método quick, compressão 6, sem perfil ICC) em caminho gravado antigo (`D:\Trabalhos\Trigger - Proxy na Pilha\SAÍDA BATCH REDIMENSIONAR\`). Os scripts não dependem desse caminho: fazem `saveAs` próprio depois da ação. O valor exato do percentual gravado não explica sozinho as dimensões finais (seção 9).
- **Exportar PDF:** `[PROXY] - Exportar PDF.ATN` (ação `Exportar PDF`, grava em `...\IMPRESSÃO\GRADE_.pdf`, perfil "U.S. Web Coated (SWOP) v2") existe, mas os scripts atuais não a usam; chamam `save` por Action Manager.
- **Fluxo por imagem (JS):** `app.open` → se CMYK, `changeMode(RGB)` → `app.doAction('[PROXY] - Redimensionar','Ações Chelis')` dentro de try/catch → `saveAs(PNG)` → `close(DONOTSAVECHANGES)`.
- **Fluxo por página:** copiar as 18 imagens para `TEMPLATE\TEMPLATE METRO\1.png…18.png` (os smart objects do PSD estão vinculados a esses arquivos) → `placedLayerUpdateAllModified` → esconder `faca_cartas` e `regua` → mostrar só os slots `1..N` → preencher os textos → `save` PDF → restaurar `TEMPLATE METRO` a partir de `(SAVE) TEMPLATE\TEMPLATE METRO` (sempre, até em erro).
- **`findLayer`** precisa pular os grupos `posições`, `stickers`, `sticker` (e, no PSD A4, `regua`/`faca_cartas` e grupos de nome só numérico), senão acha camada errada.
- **Armadilhas já pagas:** CMYK quebra o save em PNG; erro 8800 genérico = pasta de destino inexistente ou documentos acumulados abertos; nome do set com acento nunca literal em `.ps1` sem BOM (usar `[char]0x00E7`/`0x00F5`); carregar o set por COM depois de reabrir o Photoshop é frágil (pedir ao Chelis para carregar `Ações Chelis` à mão); modal de "objeto inteligente em uso" trava o COM (`0x8001010A`; o script reenvia até 8×); disco cheio no D: dá erro genérico (≈2–3 GB por pedido de 200+ slots).
- **Scripts existentes:** `Export-PersonalPage18` (uma pasta; PDF), `Export-PersonalPagePSD` (salva PSD editável), `Export-PsdPagesToPdf`, `Export-PersonalPage8` (A4), `Export-FoilOrder18` (arte + foil), `Export-ProductionPage18Batch` e `Export-SamuelPage125Stickers` (produção em lote, histórico), `Export-ProductionMetroBatch` (grade antiga de 70). `scripts\criar-pedido\order_intake.py` é um coletor de pedidos.
- **Implicação para o app novo:** o app vai precisar ou (a) chamar o Photoshop do mesmo jeito (só funciona onde o Photoshop está instalado), ou (b) reproduzir redimensionamento e montagem sem Photoshop (Pillow + PDF). A montagem em (b) é viável porque as posições e o tamanho estão na seção 2; o ponto delicado é CMYK/perfil de cor e o peso do PDF.

---

## 4. Skill `/checagem` (texto)

Gatilho: `/checagem`, ou pedido para conferir uma pasta de arquivos contra uma lista-fonte (XML/CSV/JSON): faltando, sobrando, duplicado, pares. Processo genérico.

Ao ser chamado, pedir (se não foram dados) a **pasta de arquivos** e o **arquivo-fonte**. Depois, sempre nesta ordem:

1. **Extrair a lista-fonte.** Ler por completo. Para cada item: identificador único (nunca só o nome; usar ID/SKU/hash), quantidade pedida (atenção a campo com várias unidades, ex. lista de posições separada por vírgula). Se existe item padrão/comum fora da regra geral (verso padrão, template comum), identificar e excluir da comparação. **Em XML de MPC o verso padrão vem na tag `<cardback>` (um id).** Ler sempre junto com `<fronts>`/`<backs>`. Se o arquivo correspondente estiver na pasta, ele NÃO é "extra" nem entra na contagem/montagem; regra fixa do usuário na skill: excluir sempre, sem perguntar, mandando para a Lixeira (`FileSystem.DeleteFile` com `SendToRecycleBin`, nunca `rm`) e só mencionar no relatório. Sem subpasta `ja tem` para ele.
2. **Extrair o que existe na pasta.** Listar arquivos, inclusive subpastas relevantes; extrair do nome o mesmo identificador (regex consistente); agrupar por id contando cópias.
3. **Classificar em 4 baldes.** Faltando (menos cópias que o exigido); Sobrando/extra (id fora da lista, ou mais cópias); Duplicata indevida (lista pede 1, existem 2+); Duplicata devida (lista pede 2+, existe 1: falta multiplicar, não baixar de novo).
4. **Agir.** Duplicata indevida → apagar a(s) extra(s), manter 1. Duplicata devida → copiar o existente até cobrir a quantidade. Sobrando fora da lista → reportar, não apagar sem confirmar. Faltando → reportar lista completa (id + nome); se pedido, gerar arquivo-fonte reduzido no mesmo formato só com os faltantes.
5. **Pares/itens vinculados.** Se a lista-fonte relaciona itens (frente/verso pelo mesmo índice/posição), detectar o vínculo pela lista-fonte, não pelo nome. Mover os dois arquivos do par para subpasta dedicada (`pares/`) só depois de confirmar que ambos existem.
6. **Reconferência final.** Depois de qualquer correção, rodar o comparativo do zero. Sucesso = total de arquivos na pasta == total de unidades exigidas, 0 faltando, 0 sobrando, pares no lugar. Reportar o que faltava, o que foi corrigido, o que ficou pendente.

Regra de ouro: nunca decidir só por nome de arquivo; comparar pelo identificador único da lista-fonte. Se o projeto tem `./MEMORIA.md`, registrar objetivo, resultado e cuidados.

---

## 5. Skill `/clientrundown` (texto) e fórmula do orçamento

Gatilho: `/clientrundown`, ou pedido para escrever/atualizar a ficha de orçamento de um pedido a partir da(s) lista(s)-fonte e dos resultados da checagem. Gera ou atualiza `D:\GITHUB\Obsidian\Obsidian\Chelisplace\Pedido <Cliente>.md`.

### 5.1 Antes de escrever
- Se o arquivo existir, ler por completo. Nunca sobrescrever cego; nome, número e valores já editados pelo usuário têm prioridade.
- Reunir a lista de cartas a partir do(s) arquivo(s)-fonte; reaproveitar o resultado da `/checagem` da sessão.

### 5.2 Estrutura do arquivo, nesta ordem (chave pix e telefone por marcadores)
```
#### Nome
<CLIENTE>
#### Número
<TELEFONE>
### Pedido: <N> slots
#### 1. <origem> → <N> slots
<lista numerada>
#### 2. <origem> → <N> slots
<lista numerada>
...
### Alterações
#### <título da alteração>
<lista numerada, só se houver>
#### Conclusão
<texto corrido>
### Valor do pedido: <N> reais
#### Confidencial
Pago = <N>
Custo
	- Impressão: <páginas>x14 = <N>
	- Colagem: <slots>x0,13 = <N>
	- Bulk: 0
	- Lucro: <pago>-<impressão>-<colagem> = <N>
### Pix
<CHAVE_PIX>
```
Regras de formato:
- **Zero linha em branco antes de qualquer título (`#`)**; o Obsidian já dá o espaçamento.
- Uma seção numerada por fonte de cartas (cada XML, cada lote de compra, cada imagem avulsa). Título = origem + quantos slots contribui.
- Se a fonte tem frente e verso **distintos por carta**, dividir em `##### Frentes` e `##### Versos`. Se só há um verso padrão compartilhado, **não citar em lugar nenhum**.
- **Cada verso válido/distinto conta +1 slot.** O `<N> slots` do `### Pedido` e de cada seção é **frentes + versos**, nunca só frentes. Conferir contra o total que a `/checagem` validou (arquivos na pasta = fronts + backs). Erro já cometido: contar só `<fronts>`.
- Se o usuário esclareceu que um verso foi corrigido à mão (o XML tinha o card duplicado por engano como frente em outro slot), o verso FICA em `Versos` e sai a instância duplicada de `Frentes` (renumerar). A correção do usuário vale mais que o XML bruto.
- Lista de cartas: **só o nome**, sem parênteses/colchetes/chaves ou texto extra (artista, edição). Cópias repetidas aparecem **linha a linha**, nunca "x13".

### 5.3 Visível ao cliente × interno
- Tudo antes de `#### Confidencial` vai ao cliente. Não documentar processo interno (checagem, ajuste de cache, correção de duplicata).
- `### Alterações` só quando o cliente precisa saber (troca de arte por indisponibilidade, item removido, desconto, mudança de contagem); senão a seção some.
- `#### Conclusão`: texto natural fechando o raciocínio; nunca placeholder tipo `_(preencher)_`.
- Custo, colagem e lucro **só dentro de `#### Confidencial`**.

### 5.4 Modo normal ou foil
Escolha: a palavra `foil`/`normal` no comando; senão o campo `<foil>` do XML (se vários XMLs divergirem, ou não houver XML: perguntar). Default: normal. O modo só muda `Pago` e `Impressão`.

### 5.5 Fórmulas (tabela de preços)
Definições: `slots` = frentes + versos de todas as fontes; `páginas = ceil(slots / 18)`.

| Item | Modo normal | Modo foil |
|---|---|---|
| Kit fechado | 108 slots = 6 páginas, **R$ 135** (R$ 1,25/slot) | 180 slots = 10 páginas, **R$ 330** (180 × 1,83333) |
| `kits` | `floor(slots / 108)` | `floor(slots / 180)` |
| `resto` | `slots mod 108` | `slots mod 180` |
| **Pago** | `kits × 135 + resto × 1,6667` | `kits × 330 + resto × 2,44441` |
| Impressão (custo) | `páginas × 14` (R$ 14/página; só vale com pedidos de 6+ páginas na gráfica) | `kits × 121,99 + páginas_extra × 24,99`, com `páginas_extra = páginas − kits × 10` |
| Colagem (custo) | `slots × 0,13`, arredondado ao inteiro | idem |
| Bulk | 0 (salvo instrução) | 0 |
| **Lucro** | `Pago − Impressão − Colagem` | idem |

Notas da skill:
- O valor do resto é arredondado "de forma razoável" (ex.: 21,67 → 22). A regra de arredondamento não está formalizada (seção 9).
- Quando o usuário combinou outro valor, vale o dele.
- Excepcionalmente a colagem usa `páginas × 18` (página cheia) em vez dos slots reais, só se o usuário já fez assim; por padrão, slots reais.
- O kit escalonado vale a partir de um pedido de referência (de um cliente específico) em diante; pedidos fechados antes (preço antigo flat 1,25/slot) não se recalculam. A data/pedido exato de corte não está documentado (seção 9).
- Por que escalonar: R$ 14/página só se sustenta garantindo à gráfica pedidos de 6+ páginas; slots além do último kit fechado dão o mesmo trabalho sem completar página nova.

Exemplo numérico fictício (modo normal, 120 slots): `kits = 1`, `resto = 12`, `Pago = 135 + 12 × 1,6667 = 155`; `páginas = ceil(120/18) = 7`; `Impressão = 7 × 14 = 98`; `Colagem = 120 × 0,13 = 15,6 → 16`; `Lucro = 155 − 98 − 16 = 41`.

### 5.6 Depois de escrever
Perguntar ao usuário se o rundown ficou certo antes de considerar concluído. Ele ajusta valores à mão.

Pasta de fichas: `D:\GITHUB\Obsidian\Obsidian\Chelisplace\` (≈30 fichas `Pedido <Cliente>.md`, mais `Chelisplace - Proposta.md`, `Chelisplace - Memoria.md`, `Pedidos Agosto 26.md`, `Pendências com a Loja.md`, `Plano de ação.md`). Não copiei conteúdo de fichas reais.

---

## 6. Skill `/montagem` (texto)

Gatilho: redimensionar/montar/exportar páginas de cartas a partir de uma pasta de imagens no Stick-Spell. Primeiro ler `MEMORIA_AUTOMACAO_STICK_SPELL.md`.

**0. Entender a pasta de entrada.** Listar a pasta e identificar: **arquivos soltos na raiz** = pool principal (processo completo); **`pares`** = dupla-face, uma imagem por arquivo, vão para os **últimos slots da última página** (não redimensionar de novo se vieram prontos da `/checagem`; se crus, passam pelo redimensionamento); **`preenchimento`/`fichas`** = imagens que precisam de N cópias cada para fechar os slots antes da página de pares (se o usuário não disser quantas, perguntar); **`só montagem`/`apenas montagem`** = já no tamanho certo, só entram na montagem; **`já tem`/`ja tem`** = ignorar; **RepeatCount** = "N cópias de cada imagem" = parâmetro `-RepeatCount`. Estrutura não óbvia: perguntar.

**1. Calcular o plano antes.** Total de slots = raiz + pares + preenchimento (com repetições); páginas = `ceil(total/18)`; pares no fim da última página, de trás para frente; preenchimento nos slots que sobram antes dos pares, na mesma página. Mostrar a conta ao usuário se houver mais de uma fonte ou ambiguidade. Ordem do pool: alfabética por nome de arquivo, salvo instrução.

**2. Scripts em `scripts/photoshop/` (usar em vez de reescrever).** `Export-PersonalPage18.ps1` (`-SourceFolder -ClientFolderName -ClientLabel [-VersosFolder] [-RepeatCount] [-Force]`; redimensiona, monta e exporta PDF); `Export-PersonalPagePSD.ps1` (salva `.psd` editável por página, para posicionar camadas à mão); `Export-PsdPagesToPdf.ps1` (exporta PDF dos `.psd` já editados, sem mexer em texto/visibilidade). Pedido complexo demais para os parâmetros: montar o plano à mão (Python/PowerShell) com a mesma lógica.

**3. Redimensionamento.** Ação `[PROXY] - Redimensionar` do set `Ações Chelis`. JS por imagem: `app.open` → CMYK→RGB → `doAction` → `saveAs(PNG)`. Carregar o set se não existir (uma vez por sessão). CMYK quebra o save em PNG. ~1–2 s por imagem; pedidos de 100+ rodam em segundo plano sem reconferir em loop. Se falhar no meio, comparar plano × disco e rodar só os faltantes. Erro 8800 genérico = (1) pasta de destino inexistente (criar as pastas de página antes e testar com `Test-Path`) ou (2) documentos abertos acumulados (fechar todos antes de tentar de novo). Carregar o set por COM após reabrir o Photoshop é frágil: pedir ao usuário para carregar à mão. Nunca escrever `"Ações Chelis"` literal em `.ps1` sem BOM.

**4. Saída.** `SAIDA BATCH REDIMENSIONAR\<CLIENTE>\<página>\<slot>.png` (cache de únicas em `_cache\` quando há repetição); `IMPRESSÃO\<CLIENTE>\<NNN>_<CLIENTE>.pdf` (ou `...\PSD\<NNN>_<CLIENTE>.psd`). `TEMPLATE\TEMPLATE METRO\` é a pasta de trabalho do PSD mestre: **sempre restaurar de `(SAVE) TEMPLATE\TEMPLATE METRO`** no fim, mesmo em erro.

**5. Exportação/texto no PSD.** PSD mestre `PSD\GRADE_page_tst_sticker_auto.psd`. `Nome cliente 1` = nome do cliente (perguntar se não veio); `Quantidade cliente 1` = progresso cumulativo `X/total` (nunca vazio); `Nome cliente 2`/`Quantidade cliente 2` vazios em cliente único. `faca_cartas` e `regua` ocultos na arte. Camadas `1..18` visíveis conforme o uso da página. `findLayer` pula `posições`/`stickers`/`sticker`.

**6. Depois de rodar.** Conferir contagem de arquivos por página antes de exportar; checar que `TEMPLATE METRO\1.png` bate com o baseline; reportar tabela página/usado/progresso/tamanho e caminho.

**7. Terminal.** O sandbox trava strings com barra invertida perto de `Remove-Item`; montar path com `.Replace([char]0x5C,'/')`.

### 6.1 `/montagem-a4` (diferenças)
Só quando o usuário pedir explicitamente A4/8 slots. Script `Export-PersonalPage8.ps1`; PSD `PSD\GRADE_page_a4_foil_auto.psd` (A4 paisagem 29,7 × 21 cm, 300 dpi, **8 slots em 4 colunas × 2 linhas**). Sem campos de texto. Mesma origem `TEMPLATE METRO`. Bug corrigido no script A4: o grupo raiz também se chama `1`; `findLayer` ignora `LayerSet` quando o nome buscado é numérico; `FIND_LAYER_SKIP_GROUPS` inclui `regua` e `faca_cartas`. Validado em 2026-09-28 (MediaBox 841.92 × 595.2 pt).

### 6.2 `/montagem-foil` (diferenças)
Pasta do pedido com `artes\` e `foil coating\` (espelhadas; subpastas = pool por origem, mais `pares\`, `xml\` ignorado, `completar*`). SVG não entra (converter para PNG). Ordem: pool (subpastas em ordem alfabética) + `completar` + `pares`. Pareamento arte↔foil por **chave normalizada** (minúsculas, sem extensão, sem prefixos `brancolocal_`/`brancolocalizado_`/`verso_`, sem `- Copia (N)`); órfão = parar e perguntar. Slot vazio da última página: arte fica vazia; foil recebe cartão **preto sólido C0M0Y0K100 a 300 dpi** (`_filler_black.png`; se vier a 96 dpi o Photoshop reescala ~3,1× e engole os vizinhos). Foil: nunca exportar o PSD direto com transparência (o grupo raiz pinta a página de branco); por página cria documento CMYK transparente, duplica só as 18 camadas de slot, `mergeVisibleLayers`, preenche K100 preservando alfa, PDF com preset `CHELIS_PDFTRANSPARENTE`, depois PNG RGBA de preto puro. Script: `Export-FoilOrder18.ps1 -OrderFolder <pedido> -ClientFolderName "<CLIENTE>" -ClientLabel "<nome>" [-PlanOnly] [-SkipArt] [-SkipFoil] [-Resume] [-Force]`; sempre `-PlanOnly` primeiro. Saída: `IMPRESSÃO\<CLIENTE>\ARTES\NNN_*.pdf`, `...\FOIL\NNN_*_FOIL.pdf`, `...\FOIL\PNG\NNN_*_FOIL.png`. Conferir fração opaca por slot contra a imagem de origem; PDF foil com `/SMask` e MediaBox A3 (841.92 × 1190.64).

### 6.3 `/foilcoat` (resumo)
Roda a ação `[PROXY] - MeioTomFoil` (passos 1–7, nunca o 8, que sobrescreve o original e abre modal) em cópias dentro de `<origem>\_foilcoat_trabalho\`, valida (existe, ARGB 32 bpp, mesmas dimensões, ≥ 50 KB), apaga os JPG com PNG válido na cópia e grava `_foilcoat_relatorio.md` / `_foilcoat_feito.txt` (manifesto que impede aplicar o meio-tom duas vezes). Roda em segundo plano, teste com `-Limit 2` antes. Nunca tocar nos originais.

---

## 7. Pedidos de exemplo (somente nomes e estrutura)

### 7.1 Nome dos arquivos baixados do MPCFill
Padrão: `<Nome da carta> [<detalhe>] (<ID do Google Drive>).<jpg|jpeg|png>`. O **ID do Drive entre parênteses no fim** é a chave de ligação com o XML (campo `<id>`); o nome pode ser só o nome da carta, ou trazer `(<Estilo/Artista>)`, `(<SET> <nº>)`, `[<SET>] {<nº>}` etc. Exemplos de forma (sem imagens): `Ancient Tomb (BFZ) (<id>).jpg`, `Command Tower (Extended Jon Lane) (<id>).jpg`, `Badgermole Cub {167} (<id>).png`.
- Duplicata feita pela checagem: `<nome original sem o ID> (copia N) (dup).<ext>` (o ID some e entra `(copia 1) (dup)`), ex.: `Arcane Signet (Classic Promo ...) (copia 1) (dup).jpg`.
- Extensões variam (jpg, jpeg, png) no mesmo pedido.

### 7.2 Pedido A (com XML) — pasta `pedido <cliente> N`
- Conteúdo: 102 imagens soltas + `pares/` (6 imagens) + `decklist` + XML `pedido <cliente> N revised.xml` (24 KB). Sem subpasta de preenchimento.
- Formato do XML (MPC Autofill):
```xml
<order>
  <details>
    <quantity>105</quantity>        <!-- nº de frentes -->
    <bracket>108</bracket>          <!-- faixa/pacote do MPC -->
    <stock>(S30) Standard Smooth</stock>
    <foil>false</foil>
  </details>
  <fronts>
    <card>
      <id>…ID do Drive…</id>
      <slots>0</slots>              <!-- posição(ões) 0-based -->
      <name>Nome do arquivo.ext</name>
      <query>texto da busca em minúsculas, sem apóstrofo</query>
    </card>
    …
  </fronts>
  <backs> <card> …mesma forma, slots = posição da frente correspondente… </card> </backs>
  <cardback>…ID do verso padrão…</cardback>
</order>
```
- Números: 105 `<card>` em `<fronts>`, 105 ids distintos, `slots` de 0 a 104 (um por carta, nenhum com vírgula neste pedido); 58 `.jpg` + 47 `.png`; 3 `<card>` em `<backs>` nos slots 5, 49 e 92 (dupla-face: a frente é a de mesmo slot). Total físico = 105 + 3 = **108** slots (= `bracket`).
- `<cardback>` = verso padrão (não entra na contagem nem na montagem).
- A skill `/checagem` conta pelas posições de `slots`; em outros pedidos um id pode ter várias posições separadas por vírgula.

### 7.3 Pedido B (imagens + decklist, sem XML) — pasta `Cards_<cliente>`
- Conteúdo: 271 imagens na raiz (inclui 36 cópias `(dup)` feitas pela checagem), `decklist.txt`, `pares/` (4 imagens: duas faces de um DFC + duas arts de outros), `completar/` com subpastas (`<loja>` e `<outro>`, 13 imagens próprias: fichas, tesouros, versos, `... - Copia (2).png`).
- `decklist.txt`: uma linha por carta no formato `<N>x <Nome da carta>`; 219 linhas, soma das quantidades = 279. Nenhuma linha fora do padrão.
- Aqui as imagens vieram escolhidas à mão e completadas com imagens próprias em `completar/`; entram no fim do pedido junto com os pares (regra da `/montagem`).

### 7.4 Pasta de trabalho do Stick-Spell (estrutura, medida)
`PEDIDO\` (entradas), `SAIDA BATCH REDIMENSIONAR\<CLIENTE>\<página>\<slot>.png` (+ `_cache`), `IMPRESSÃO\<CLIENTE>\<NNN>_<CLIENTE>.pdf`, `IMPRESSÃO\000 - FACA_UNICA.pdf`, `TEMPLATE\TEMPLATE METRO\1..N.png` e `(SAVE) TEMPLATE\TEMPLATE METRO\` (baseline), `PSD\*.psd` (≈112–650 MB cada), `scripts\`. Há ~40 pastas de clientes em `IMPRESSÃO\` e ~18 em `SAIDA BATCH REDIMENSIONAR\`. A pasta do Drive `G:\Meu Drive\Novo Processo Proxies` está **vazia** hoje.

---

## 8. Regras do Chelis que o app precisa respeitar (da skill e do `AGENTS.md`)
- Responder em PT-BR com acentos; direto e curto.
- Decisões dentro da página, sem pop-ups nativos.
- Nada de segredos no código; nunca burlar anti-bot (Moxfield/LigaMagic dão 403: texto colado ou HTML salvo).
- Arquivos baixados são dados não confiáveis: pasta própria, nunca executar.
- Nada apagado, movido ou comprado sem aprovação. **Atenção:** a skill `/checagem` hoje manda o verso padrão para a Lixeira "sem perguntar" e apaga cópias extras; o app deve tratar isso como ação explícita e reversível (Lixeira), com registro no relatório, e pedir confirmação para o resto.
- Commit e push ao fim de cada mudança.

---

## 9. Dúvidas abertas (perguntar ao Chelis; não inventei)
1. **Sangria:** o slot 816 × 1110 px (69,09 × 93,98 mm) tem ~3 mm de sangria sobre a carta de 63 × 88 mm? E a faca (`faca_cartas`, 6 formas por linha) corta em que medida final (cada forma mede ~1089 × 758 px por carta, ≈ 92,2 × 64,2 mm)?
2. **Percentual da ação `Redimensionar`:** a ação grava largura relativa em % e 300 ppi, mas as origens têm tamanhos/dpi diferentes e a saída é sempre ~816 × 1110. Como o redimensionamento chega a isso (reamostra? corta?) e por que às vezes sai 1111 px de altura? Preciso da definição exata para reproduzir fora do Photoshop.
3. **Perfil de cor:** o PSD é CMYK 8 bits. Qual perfil exato (a ação de PDF cita "U.S. Web Coated (SWOP) v2")? As PNGs de slot são RGB; a conversão acontece na exportação.
4. **`CHELIS_PDFCOMUM.joboptions`** (preset da arte) não está no repositório; só o `...TRANSPARENTE`. Onde está o original para documentar/versionar?
5. **Camadas do PSD:** `Níveis 1` e `Brilho/Contraste 1` ficam ligados na arte? Com que valores (parte do "look" final)?
6. **Posição dos slots tem ±3 px** entre camadas (colocadas à mão). É intencional? O app novo deve usar a grade ideal (passo ~1111 × 828,6) ou reproduzir o PSD?
7. **Faixa lateral de texto** (nome do cliente + `X/total`): fonte, corpo e cor; está só na lateral direita?
8. **Arredondamento do resto** na fórmula do preço (ex. 21,67 → 22): regra fixa (inteiro mais próximo)? O foil também arredonda para inteiro?
9. **Colagem:** `0,13` por slot é custo de quê (cola/mão de obra)? Fica igual no foil?
10. **Pedido sem XML (modelo B):** quem define a ordem das cartas e quais versos/fichas entram: a decklist, a pasta, ou o Chelis? Como o app deve identificar o par de dupla-face sem XML?
11. **Fluxo de `pares`:** os DFC entram sempre nos últimos slots, de trás para frente; e a ordem dos pares dentro da última página importa (frente ao lado do verso)?
12. **Subpastas `completar/<nome>`**: o nome da subpasta (`<loja>`, `<outro>`) tem significado para o app?
13. **Tutorial novo do MPCFill para o cliente** e entradas Archidekt: sem material no PC; precisa de escopo.
14. **Gráfica:** o briefing cita "arquivo da faca padrão" e envio por link do Drive; as notas da loja citam EloPrint (SRA3 vinil leitoso adesivo, meio corte). Confirmar que a EloPrint é a gráfica atual e se há especificação escrita deles (margens, sangria, perfil).
15. **Local dos pedidos:** a pasta do Drive está vazia; no Stick-Spell os pedidos vão para `PEDIDO\`/`SAIDA...`. A convenção nova de pastas dentro do Drive (`<cliente>/xml`, `imagens`, `saida`…) ainda não existe.
16. **Origem do pedido B:** o `decklist.txt` e as imagens vieram de qual passo do processo (Moxfield/Liga convertido, ou escolha manual)?
