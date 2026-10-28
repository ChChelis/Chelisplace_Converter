"""Montagem de páginas A3 (3508x4961, 300 dpi, 18 slots de 3x6) sem Photoshop.

Posições e rotação vêm de docs/referencia_processo.md (medidas do PSD). Pontos ainda a
confirmar visualmente contra o Photoshop: sentido da rotação, fonte/posição do texto lateral
e o espaçamento exato (o PSD tem ±3 px de variação entre camadas).
"""
import math
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

PAGINA = (3508, 4961)
COLUNAS, LINHAS = 3, 6
POR_PAGINA = COLUNAS * LINHAS
PASSO_X = 1111
PASSO_Y = 828.6
GIRAR = 90  # graus anti-horários; trocar para -90 se a arte sair de cabeça para baixo
TEXTO_X = 3391  # faixa lateral direita do PSD
NOME_Y, PROGRESSO_Y = 4170, 4510


def posicao(slot):
    """Canto superior esquerdo do slot (0-based), em px da página."""
    linha, coluna = divmod(slot, COLUNAS)
    return round(coluna * PASSO_X), round(linha * PASSO_Y)


def planejar(raiz, pares=(), preenchimento=(), por_pagina=POR_PAGINA):
    """Devolve páginas (listas de 18 caminhos ou None).

    raiz: caminhos em ordem alfabética; preenchimento: [(caminho, cópias)] logo depois da raiz;
    pares: nos últimos slots da última página, de trás para frente (1º par = último slot).
    """
    fila = sorted(raiz, key=lambda p: Path(p).name.lower())
    for caminho, copias in preenchimento:
        fila += [caminho] * copias
    pares = list(pares)
    total = len(fila) + len(pares)
    n_pag = max(1, math.ceil(total / por_pagina))
    slots = [None] * (n_pag * por_pagina)
    slots[:len(fila)] = fila
    for i, p in enumerate(pares):
        slots[len(slots) - 1 - i] = p  # total já reserva o espaço: nunca sobrepõe a fila
    return [slots[i:i + por_pagina] for i in range(0, len(slots), por_pagina)]


def progresso(paginas):
    """'XXX/TTT' acumulado ao fim de cada página (formato do PSD: 018/018)."""
    total = sum(1 for p in paginas for s in p if s)
    saida, acum = [], 0
    for p in paginas:
        acum += sum(1 for s in p if s)
        saida.append(f"{acum:03d}/{total:03d}")
    return saida


def _texto_vertical(pagina, texto, x, y, tamanho=56, fonte=None):
    try:
        f = ImageFont.truetype(fonte, tamanho) if fonte else ImageFont.load_default(tamanho)
    except OSError:
        f = ImageFont.load_default(tamanho)
    caixa = f.getbbox(texto)
    img = Image.new("L", (caixa[2] + 4, caixa[3] + 4), 255)
    ImageDraw.Draw(img).text((2, 2), texto, font=f, fill=0)
    pagina.paste(img.rotate(90, expand=True).convert("RGB"), (x, y))


def renderizar(slots, cliente="", progresso_txt="", girar=GIRAR, fonte=None):
    """slots: 18 itens (caminho da imagem 816x1110 pronta, ou None)."""
    pagina = Image.new("RGB", PAGINA, "white")
    for i, caminho in enumerate(slots):
        if not caminho:
            continue
        with Image.open(caminho) as im:
            im = im.convert("RGB").rotate(girar, expand=True)
            pagina.paste(im, posicao(i))
    if cliente:
        _texto_vertical(pagina, cliente, TEXTO_X, NOME_Y, fonte=fonte)
    if progresso_txt:
        _texto_vertical(pagina, progresso_txt, TEXTO_X, PROGRESSO_Y, fonte=fonte)
    return pagina


def exportar_pdf(pagina, destino, qualidade=30):
    """PDF A3 (841,9 x 1190,6 pt). Qualidade 30 imita o preset leve do Photoshop."""
    Path(destino).parent.mkdir(parents=True, exist_ok=True)
    pagina.save(destino, "PDF", resolution=300.0, quality=qualidade)
    return destino


def montar_pedido(raiz, pasta_saida, cliente, pares=(), preenchimento=(), **kw):
    paginas = planejar(raiz, pares, preenchimento)
    prog = progresso(paginas)
    pdfs = []
    for n, (slots, p) in enumerate(zip(paginas, prog), 1):
        img = renderizar(slots, cliente, p, **kw)
        pdfs.append(exportar_pdf(img, Path(pasta_saida) / f"{n:03d}_{cliente}.pdf"))
    return pdfs
