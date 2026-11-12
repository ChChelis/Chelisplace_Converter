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
NOME_BASE_Y = 4437      # nome ancorado embaixo: o texto cresce para cima a partir daqui
PROGRESSO_CENTRO_Y = 4697
NOME_PT, PROGRESSO_PT = 20, 24  # pontos a 300 dpi (Consolas no PSD)
NIVEIS = (15, 255, 1.03)  # Níveis 1 do PSD: saída 15-255, gama 1,03 (medido no relatório de validação)
QUALIDADE_PDF = 100
FONTES_MONO = (r"C:\Windows\Fonts\consola.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf")


def posicao(slot):
    """Canto superior esquerdo do slot (0-based), em px da página."""
    linha, coluna = divmod(slot, COLUNAS)
    return round(coluna * PASSO_X), round(linha * PASSO_Y)


def planejar(raiz, pares=(), preenchimento=(), extras=(), por_pagina=POR_PAGINA):
    """Devolve páginas (listas de 18 caminhos ou None).

    raiz: caminhos em ordem alfabética; preenchimento: [(caminho, cópias)] logo depois da raiz;
    pares: consecutivos nos últimos slots, na ordem recebida (frente seguida do verso, como no Photoshop).
    extras: imagens que não estão no XML; ficam depois dos pares, também no fim, na ordem recebida.
    Se o total não fecha um múltiplo de 18, os slots em branco ficam entre a raiz e os pares.
    """
    fila = sorted(raiz, key=lambda p: Path(p).name.lower())
    for caminho, copias in preenchimento:
        fila += [caminho] * copias
    pares = list(pares) + list(extras)
    total = len(fila) + len(pares)
    n_pag = max(1, math.ceil(total / por_pagina))
    slots = [None] * (n_pag * por_pagina)
    slots[:len(fila)] = fila
    for i, p in enumerate(pares):
        slots[len(slots) - len(pares) + i] = p  # total já reserva o espaço: nunca sobrepõe a fila
    return [slots[i:i + por_pagina] for i in range(0, len(slots), por_pagina)]


def progresso(paginas):
    """'X/T' acumulado ao fim de cada página, sem zeros à esquerda (como o Photoshop exporta: 18/108)."""
    total = sum(1 for p in paginas for s in p if s)
    saida, acum = [], 0
    for p in paginas:
        acum += sum(1 for s in p if s)
        saida.append(f"{acum}/{total}")
    return saida


def _fonte(tamanho_px, fonte=None):
    for caminho in ([fonte] if fonte else []) + list(FONTES_MONO):
        try:
            return ImageFont.truetype(caminho, tamanho_px)
        except OSError:
            continue
    return ImageFont.load_default(tamanho_px)


def _texto_vertical(pagina, texto, x, y, pt, ancora, fonte=None):
    """Texto lido de baixo para cima. ancora='base': y é a borda de baixo; 'centro': y é o meio."""
    f = _fonte(round(pt * 300 / 72), fonte)
    caixa = f.getbbox(texto)
    img = Image.new("L", (caixa[2] + 4, caixa[3] + 4), 255)
    ImageDraw.Draw(img).text((2, 2), texto, font=f, fill=0)
    img = img.rotate(90, expand=True)
    topo = y - img.height if ancora == "base" else y - img.height // 2
    pagina.paste(img.convert("RGB"), (x, topo))


def aplicar_niveis(im, niveis=NIVEIS):
    """Ajuste de Níveis do PSD (preto de saída sobe, gama), igual nos três canais."""
    preto, branco, gama = niveis
    lut = [round(preto + (branco - preto) * (v / 255) ** (1 / gama)) for v in range(256)]
    return im.point(lut * 3)


def renderizar(slots, cliente="", progresso_txt="", girar=GIRAR, fonte=None):
    """slots: 18 itens (caminho da imagem 816x1110 pronta, ou None)."""
    pagina = Image.new("RGB", PAGINA, "white")
    for i, caminho in enumerate(slots):
        if not caminho:
            continue
        with Image.open(caminho) as im:
            im = im.convert("RGB").rotate(girar, expand=True)
            pagina.paste(im, posicao(i))
    pagina = aplicar_niveis(pagina)
    if cliente:
        _texto_vertical(pagina, cliente, TEXTO_X, NOME_BASE_Y, NOME_PT, "base", fonte)
    if progresso_txt:
        _texto_vertical(pagina, progresso_txt, TEXTO_X, PROGRESSO_CENTRO_Y, PROGRESSO_PT, "centro", fonte)
    return pagina


def exportar_pdf(pagina, destino, qualidade=QUALIDADE_PDF):
    """PDF A3 (841,9 x 1190,6 pt), JPEG sem subamostragem de cor: é para impressão."""
    Path(destino).parent.mkdir(parents=True, exist_ok=True)
    pagina.save(destino, "PDF", resolution=300.0, quality=qualidade, subsampling=0)
    return destino


def montar_pedido(raiz, pasta_saida, cliente, pares=(), preenchimento=(), extras=(), **kw):
    paginas = planejar(raiz, pares, preenchimento, extras)
    prog = progresso(paginas)
    pdfs = []
    for n, (slots, p) in enumerate(zip(paginas, prog), 1):
        img = renderizar(slots, cliente, p, **kw)
        pdfs.append(exportar_pdf(img, Path(pasta_saida) / f"{n:03d}_{cliente}.pdf"))
    return pdfs
