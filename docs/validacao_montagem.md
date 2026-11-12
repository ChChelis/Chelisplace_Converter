# Validação da montagem: Photoshop × núcleo Python

Executado em 2026-11-11 no PC de casa, seguindo `docs/validacao_passo_a_passo.md` (passos 1 a 8). Nada do Stick-Spell, dos pedidos ou do Drive foi movido, renomeado ou apagado: tudo foi copiado para `D:\teste_validacao\pedido_A\` e processado lá. Cliente indicado como `<CLIENTE>`; as folhas de comparação foram geradas **sem a faixa lateral** (onde o PS escreve o nome).

## Resumo (o que o Chelis precisa saber)
- **Imagens:** o núcleo reproduz as imagens do Photoshop de forma muito próxima: diferença média **1,8** de 255 (mediana 1,6; pior 3,7; nenhuma acima de 4). A referência do passo 5 diz que abaixo de ~2 é indistinguível a olho.
- **Posição e rotação:** corretas. Slots do núcleo caem a ≤ 3 px dos do PS e a rotação está certa.
- **O que ainda difere nas páginas** (diferença média 11,7 por página; 6,0 depois de aplicar só o item 1):
  1. **Cor/tons:** o PS aplica o ajuste "Níveis" do PSD (preto sobe de 0 para 15, gama 1,03) e converte para CMYK. O núcleo sai mais escuro e mais saturado. Dá para corrigir com uma fórmula (item 7).
  2. **Texto lateral:** fonte, tamanho, âncora e formato do progresso diferem (item 5).
  3. **Proporção:** o PS mantém a proporção da origem (altura 1108–1140 px com largura 816); o núcleo achata tudo para 816 × 1110 (item 1).
  4. **Ordem dos pares:** o PS põe cada frente seguida do seu verso, na ordem do XML; o núcleo põe em ordem alfabética invertida (item 9).
  5. **Peso do PDF:** PS 27–29 MB, núcleo 1,2–1,4 MB (qualidade JPEG 30); com qualidade 85 ficaria ~3 MB (item 8).
- **A decisão visual é do Chelis:** olhar `docs/validacao/pagina_1.png`, `pagina_6.png` e `imagens_melhor_mediana_pior.png` (esquerda Photoshop, meio núcleo, direita diferença ×4).

## Passos executados
| Passo | Resultado |
|---|---|
| 1 | Branch atualizada; `pip install pillow numpy pymupdf` ok; `python -m unittest discover -s tests -t .`: **11 testes OK** (Python 3.14.4; usei `python`, que é o mesmo interpretador do `py`). Aviso (não falha): `nucleo/xml_mpc.py:41` usa `elem or []`, que gera `DeprecationWarning`. |
| 2 | Pedido escolhido: o **Pedido A** da preferência do passo (o com XML, em Downloads: 102 imagens + 6 em `pares\`, 108 slots) com resultado do Photoshop em `SAIDA BATCH REDIMENSIONAR\<CLIENTE>\1..6\` (108 PNGs) e 6 PDFs em `IMPRESSÃO\<CLIENTE>\`. A identificação foi confirmada pelas imagens: as 108 batem entre si (itens 1 e 9). |
| 3 | `D:\teste_validacao\pedido_A\` com `originais\` (+ `pares\`), `ps_png\` (108, renomeados pelo nome da origem), `ps_pdf\` (6) e `mapa_ordem_ps.tsv`. |
| 4 | `nucleo redimensionar` das 102 + 6 pares: **~50 s** (≈0,46 s/imagem; o PS leva 1–2 s). `nucleo montar` (via `web.montar` com `pares`): **~5 s** para 6 páginas. |
| 5 | 108 imagens comparadas. |
| 6 | Páginas 1, 3 (meio) e 6 (a dos pares) comparadas. |

### Passo 5: imagens (108)
| Medida | Valor |
|---|---|
| Diferença média | mín 0,96 · mediana 1,60 · média 1,84 · máx 3,74 |
| Faixas | < 2: 79 · 2–4: 29 · 4–8: 0 · ≥ 8: 0 |
| Altura PS = 1110 | 81 imagens, mediana 1,55 |
| Altura PS = 1114 | 20 imagens, mediana 2,93 |
| Altura PS = 1140 | 6 imagens, mediana 1,41 |
| Altura PS = 1108 | 1 imagem, 1,60 |
| PS RGB × RGBA | 82 × 26 (medianas 1,58 × 1,75) |
Escolhidas: melhor = Saruli Caretaker (0,96), mediana = Riptide Shapeshifter (1,6), pior = Gaea's Cradle (3,74) → `docs/validacao/imagens_melhor_mediana_pior.png`.

### Passo 6: páginas (render a 50 dpi no script oficial)
| Página | Peso PS | Peso núcleo | Dif. média | p99 | Girado 180° |
|---|---|---|---|---|---|
| 1 | 29,4 MB | 1,3 MB | 11,78 | 37 | 82,57 (pior: rotação certa) |
| 3 (meio) | 29,5 MB | 1,4 MB | 11,68 | 36 | 82,31 |
| 6 (pares) | 28,2 MB | 1,4 MB | 21,54 | 170 | 88,14 |
Tamanho do PDF: 841,92 × 1190,64 pt nos dois. A página 6 é maior por causa da ordem dos pares (item 9); o p99 de 170 vem dos slots 13–18.

## Passo 7: respostas
1. **Dimensões.** O PS gera sempre **largura 816**, mas a **altura varia**: 1110 (81 imagens), 1114 (20), 1140 (6) e 1108 (1). A altura é `816 ÷ (largura/altura da origem)`: origens com razão 0,7349 → 1110; 0,7326 → 1114; 0,7157 (= carta 63×88 exata) → 1140; 0,7363 → 1108. O núcleo gera **sempre 816 × 1110** (esticando/achatando). Resolução 300 dpi nos dois. O PS mantém o canal alfa (26 PNGs RGBA); o núcleo achata sobre branco e salva RGB; nas 26 imagens com alfa a diferença ficou em linha com as demais (mediana 1,75).
2. **Redimensionamento.** O PS **só reamostra, sem cortar**, mantendo a proporção com largura fixa em 816 (origens de proporções diferentes saem com alturas diferentes, ver item 1). Não vi corte em nenhuma das 108. Pendente: como o smart object do PSD absorve altura ≠ 1110 (ver "Dúvidas" abaixo).
3. **Rotação.** Correta: topo da carta para a esquerda, como no PS (`montagem.GIRAR = 90` está certo). Testando o núcleo girado 180° a diferença sobe de 11,8 para 82,6.
4. **Posição.** Alinhando cada slot por busca de deslocamento (±10 px), o núcleo precisa de dx entre −3 e +2 px e dy entre −1 e 0 px (média −0,1 / −0,2 px). A grade do núcleo (passo 1111 × 828,6) coincide com a do PS; os ±3 px do PSD não importam (≤ 0,25 mm).
5. **Texto lateral** (medido no PDF do PS, que tem **texto real**, não imagem):
   - Fonte **Consolas**, cor preta, lido de baixo para cima (direção 0,−1).
   - Nome do cliente: **20 pt** (83,3 px a 300 dpi), tinta em x 3400–3454; **ancorado embaixo**: o texto começa em y≈4437 e cresce para cima (nome de 16 caracteres ocupou y 3712–4436).
   - Progresso: **24 pt** (100 px), tinta em x 3391–3469; **centralizado** em y≈4697 (caixa do PSD y 4510–4886).
   - **Formato do progresso: `18/108`** (acumulado/total **sem zeros à esquerda**), embora o texto de exemplo do PSD seja `018/018`. O núcleo escreve `018/108`.
   - Núcleo hoje: fonte padrão pequena (tinta de ~41 px de largura em vez de 54/78), começa no **topo** (y 4170 e 4510) e desce, em vez de ancorar embaixo/centralizar. Também não gera texto pesquisável.
   - O nome no PS aparece com espaços (`<CLIENTE>` como rótulo); só o nome do arquivo usa `_`.
6. **Cor.** O PDF do PS é **DeviceCMYK** (3 imagens JPEG, sem OutputIntent nem perfil ICC embutido); o núcleo é **DeviceRGB**. Nas cartas da página 1: média RGB PS (106,8 / 108,9 / 98,3) × núcleo (95,4 / 97,5 / 87,5), ou seja, o PS é ~11 níveis mais claro; preto de PS = 15, núcleo = 0; saturação média PS 0,30 × núcleo 0,37 (o núcleo parece mais vivo). Peles e tons médios: o PS fica +11 a +14 níveis acima do núcleo na faixa 32–128 (curva do item 7); não separei pele de outros tons. Não identifiquei perfil: o PS grava CMYK sem perfil no PDF; o perfil de conversão usado pelo Photoshop continua desconhecido.
7. **Níveis e Brilho/Contraste do PSD** (lidos do arquivo, só leitura): ambos **visíveis na arte** e sem máscara (valem para a grade inteira).
   - **Níveis 1** (canal composto): entrada 0–255, **saída 15–255, gama 1,03**. Predição `y = 15 + 240·(x/255)^(1/1,03)` bate com a medida: 49→63,6 (medido 63,3), 79→92,2 (92,1), 112→122,7 (122,6), 175→181,5 (181,1).
   - **Brilho/Contraste 1:** brilho 0, contraste 0 nos campos básicos do bloco (a biblioteca também mostra um `brightness 2` não confirmado); sem efeito mensurável.
   - Aplicar a fórmula dos Níveis ao RGB do núcleo baixou a diferença média da página 1 de **13,1 para 6,0** (render a 100 dpi); o restante vem de CMYK (menos saturado), do texto e da compressão.
8. **Peso e nitidez.** PS: 26,9–28,7 MB por página (uma imagem CMYK em JPEG de 28,68 MB mais duas de ~0,28 MB). Núcleo: 1,2–1,4 MB (RGB, JPEG qualidade 30). Teste só do JPEG da página 1 do núcleo: qualidade 30 → 1,3 MB (erro médio 4,4); 50 → 1,7 MB (3,6); 70 → 2,3 MB (3,2); **85 → 3,2 MB (2,3)**; 95 → 5,5 MB (1,6). Num recorte de 700 × 400 px da página a 300 dpi, PS e núcleo parecem igualmente nítidos a olho; não testei ampliações maiores nem impressão. Sugestão: qualidade 85–90.
9. **Pares.** A página 6 está cheia (108 = 6 × 18), com os 6 pares nos slots 13–18. Ordem do **PS**: Barkchannel Pathway, Tidechannel Pathway, Hydroelectric Specimen, Hydroelectric Laboratory, Wandering Archaic, Explore the Vastlands, ou seja, **cada frente seguida do seu verso, na ordem de slot do XML (5, 49, 92)**. Ordem do **núcleo** (alfabética invertida): Wandering Archaic, Tidechannel Pathway, Hydroelectric Specimen, Hydroelectric Laboratory, Explore the Vastlands, Barkchannel Pathway: pares separados. Os 102 slots da raiz (páginas 1–6) saem na mesma ordem alfabética nos dois (todas as imagens batem).
10. **Prints** (em `docs/validacao/`, 1,7 MB no total): `pagina_1.png`, `pagina_6.png` (página inteira, sem a faixa lateral) e `imagens_melhor_mediana_pior.png`.

## Ajustes sugeridos ao código (para a sessão da nuvem)
1. `nucleo/imagem.py`: manter a proporção com largura 816 em vez de forçar 816 × 1110 (ou decidir com o Chelis se a altura fixa é desejada; ver "Dúvidas").
2. `nucleo/montagem.py`: aplicar Níveis (`y = 15 + 240·(x/255)^(1/1,03)`) ao RGB antes de salvar o PDF.
3. Texto lateral: Consolas (ou a fonte monoespaçada equivalente disponível), nome 20 pt ancorado embaixo em y≈4437, progresso 24 pt centralizado em y≈4697, progresso **sem zeros à esquerda**.
4. Pares: ordenar por pares (frente, verso) na ordem do XML, em slots consecutivos no fim da última página (hoje `planejar()` coloca de trás para frente, em ordem de arquivo).
5. `exportar_pdf`: qualidade 85–90.
6. `scripts/validar_montagem.py imagens` quebra no console do Windows (cp1252) com nomes de carta como "Baǵa": usar `python -X utf8` ou configurar `sys.stdout.reconfigure(encoding="utf-8")`. Também não pareia pares/subpastas (teve que ser achatado).
7. `nucleo/xml_mpc.py:41`: trocar `raiz.find("details") or []` por teste `is not None`.

## Dúvidas / não consegui responder
- O PS fica com altura 1114/1140 em algumas imagens: **não** medi o que acontece dentro do PSD (se o smart object é redimensionado para caber no slot de 1110 ou se transborda). As posições dos slots ficaram dentro de ±3 px mesmo nesses casos.
- Perfil de cor da conversão RGB→CMYK do PS (não há perfil no PDF).
- `Brilho/Contraste`: leitura inconclusiva (brilho 0/2, contraste 0).
- Qualidade real percebida em impressão (só olhei em tela).

## Ficou fora de `docs/` (só no PC do Chelis)
`D:\teste_validacao\pedido_A\` guarda as cópias, PDFs e folhas completas (`cmp_imagens\`, `cmp_pagina1\`, `cmp_pagina3\`, `cmp_pagina6\`) para consulta; não foi enviada ao repositório por ter imagens de pedido e o nome do cliente.
