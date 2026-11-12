# Validação da montagem: Photoshop × núcleo Python

Objetivo: provar, com um pedido real, que `nucleo/` (sem Photoshop) gera páginas equivalentes às do Photoshop. Critério combinado com o Chelis: **comparação visual lado a lado** (ele aprova a olho), mais os números abaixo para apontar o que ajustar.

Quem executa: a **sessão local do Claude Code no PC de casa** (a que enxerga `D:\GITHUB\Stick-Spell`). Ela só lê os arquivos originais e grava numa pasta de teste nova.

## Regras
- Não mover, renomear nem apagar nada do Stick-Spell, dos pedidos ou do Drive. Trabalhar em cópias numa pasta nova.
- Não executar nada baixado; abrir imagens e PDFs só como dados.
- Commit e push no fim, na branch `claude/language-understanding-7egp47`. Não colocar nome, telefone ou pix de cliente nos relatórios (usar `<CLIENTE>`).

## Passo 1: pegar o código
```
cd <pasta do repositório chelisplace_converter>
git fetch origin claude/language-understanding-7egp47
git checkout claude/language-understanding-7egp47
git pull origin claude/language-understanding-7egp47
py -m pip install pillow numpy pymupdf
py -m unittest discover -s tests -t .
```
Os testes precisam passar (11 testes) antes de seguir.

## Passo 2: escolher o pedido de teste
Procurar um pedido que tenha **os três**: imagens originais baixadas, imagens redimensionadas pelo Photoshop (`SAIDA BATCH REDIMENSIONAR\<CLIENTE>\<página>\<slot>.png`) e PDFs prontos (`IMPRESSÃO\<CLIENTE>\NNN_<CLIENTE>.pdf`).
Preferência: "pedido guilhermao 2" (102 imagens + 3 pares, 108 slots). Se não houver resultado do Photoshop dele, usar um pedido pequeno (1 a 2 páginas) que tenha. Dizer ao Chelis qual foi escolhido.

## Passo 3: pasta de teste (cópias)
Criar `D:\teste_validacao\<pedido>\` com:
- `originais\`: cópia das imagens originais do pedido, na mesma ordem usada na montagem real (a montagem ordena por nome de arquivo). Se existir `pares\`, copiar também;
- `ps_png\`: cópia dos PNGs 816×1110 que o Photoshop gerou;
- `ps_pdf\`: cópia dos PDFs do Photoshop.

## Passo 4: gerar com o núcleo
```
py -m nucleo redimensionar D:\teste_validacao\<pedido>\originais D:\teste_validacao\<pedido>\nuc_png
py -m nucleo montar D:\teste_validacao\<pedido>\nuc_png D:\teste_validacao\<pedido>\nuc_pdf <CLIENTE>
```
Se houver `pares\`, redimensionar também essa subpasta para `nuc_png\pares` e montar com os pares (`py -c "from nucleo import web; print(web.montar('nuc_png','nuc_png_pares','nuc_pdf','<CLIENTE>'))"`, ajustando os caminhos).
Atenção à ordem: o Photoshop usou a ordem das pastas de página (`<página>\<slot>.png`). Se a ordem dos slots for diferente da alfabética, montar o núcleo na mesma ordem (renomear as cópias com prefixo numérico).

## Passo 5: comparar imagens (uma a uma)
```
py scripts\validar_montagem.py imagens D:\teste_validacao\<pedido>\ps_png D:\teste_validacao\<pedido>\nuc_png D:\teste_validacao\<pedido>\cmp_imagens
```
Para cada arquivo: tamanho (816×1110? o PS às vezes dá 1111), modo, diferença média e p99. Referência: diferença média abaixo de ~2 é indistinguível a olho; acima de ~8 há diferença visível (corte, nitidez, cor). Guardar as folhas lado a lado de 3 imagens (a mais parecida, a mediana, a pior).

## Passo 6: comparar páginas
```
py scripts\validar_montagem.py paginas D:\teste_validacao\<pedido>\ps_pdf\001_<CLIENTE>.pdf D:\teste_validacao\<pedido>\nuc_pdf\001_<CLIENTE>.pdf D:\teste_validacao\<pedido>\cmp_pagina1
```
Repetir para a última página (a dos pares) e uma do meio. O script informa peso, tamanho, diferença média e se a rotação parece invertida. Abrir `pagina.png` (esquerda Photoshop, meio núcleo, direita diferença).

## Passo 7: o que anotar (em `docs/validacao_montagem.md`)
1. **Dimensões** das imagens do PS (816×1110 sempre? quais deram 1111?) e se o núcleo bate.
2. **Redimensionamento:** a ação corta ou só reamostra? Origens de proporções diferentes saem iguais?
3. **Rotação** dos slots: sentido correto? (`montagem.GIRAR`).
4. **Posição:** os slots do núcleo coincidem com os do PS (a diferença de ±3 px do PSD importa?).
5. **Texto lateral:** fonte, corpo, cor, posição e sentido do nome e do `XXX/TTT`. Medir no PDF do PS e dizer os valores.
6. **Cor:** o PDF do PS é CMYK? Perfil? O núcleo (RGB) parece mais vivo ou mais apagado? Olhar preto e tons de pele.
7. **Níveis e Brilho/Contraste** do PSD: ligados na arte? Valores? (afeta o "look" final.)
8. **Peso:** PDF do PS (17–33 MB) × núcleo; se o do núcleo é bem menor, dizer se a nitidez aguenta ao ampliar.
9. **Pares:** ordem dos pares nos últimos slots igual à do PS?
10. Prints lado a lado de 1 página inteira e das 3 imagens escolhidas.

## Passo 8: relatório e envio
Escrever as respostas e as tabelas em `docs/validacao_montagem.md`, copiar os prints para `docs/validacao/` (só PNG pequenos, no máximo uns 2 MB no total, nada de imagem de cliente identificável além de cartas) e:
```
git add docs/validacao_montagem.md docs/validacao
git commit -m "Validação da montagem contra o Photoshop"
git push -u origin claude/language-understanding-7egp47
```
Depois, avisar o Chelis para voltar à conversa da nuvem e dizer "validação pronta". Ele decide visualmente se a montagem sem Photoshop é aceita; a sessão da nuvem ajusta o código com base no relatório.
