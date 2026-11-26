"""PDF da ficha para o cliente: o próprio Markdown da ficha (nucleo/ficha.py) desenhado em A4, igual ao modelo do Chelis.

Pula o bloco `#### Confidencial` (custo, colagem, lucro e o raciocínio do preço); mostra o valor do pedido; o QR do Pix vai ao fim. Miniaturas são opcionais,
penduradas nos itens de Alterações pelo texto do item."""
import io
import re
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

from . import pdf_vetor

DPI = 150
W, H = 1240, 1754                 # A4 a 150 dpi
ESQ, DIR_ = 108, 108              # margens laterais
TOPO1, TOPO, BASE = 150, 77, 90   # topo da 1ª página, das seguintes, margem inferior
RECUO = 42                        # texto da lista em relação à margem
PASSO_BLOCO, PASSO_ITEM, PASSO_PARAG = 63, 41, 38
CINZA = (176, 176, 176)
TAM = {"h3": 36, "h4": 30, "h5": 26, "txt": 24}
_AQUI = Path(__file__).resolve().parent
_BUSCA = [_AQUI / "fontes", _AQUI.parent / "fontes", Path("/usr/share/fonts/truetype/liberation"), Path("/usr/share/fonts/truetype/dejavu")]


def _arquivo_fonte(negrito):
    nomes = ["LiberationSans-Bold.ttf", "DejaVuSans-Bold.ttf"] if negrito else ["LiberationSans-Regular.ttf", "DejaVuSans.ttf"]
    for pasta in _BUSCA:
        for n in nomes:
            if (pasta / n).exists():
                return str(pasta / n)
    return None


_cache = {}


def fonte(tam, negrito=False):
    k = (tam, negrito)
    if k not in _cache:
        arq = _arquivo_fonte(negrito)
        try:
            _cache[k] = ImageFont.truetype(arq, tam) if arq else ImageFont.load_default(size=tam)
        except Exception:  # noqa: BLE001
            _cache[k] = ImageFont.load_default()
    return _cache[k]


def _miniatura(dados, h):
    try:
        im = Image.open(io.BytesIO(dados)).convert("RGB")
    except Exception:  # noqa: BLE001
        return None
    return im.resize((max(1, int(im.width * h / im.height)), h), Image.LANCZOS)


def _qr(matriz, lado):
    n = len(matriz)
    mod = max(1, lado // (n + 8))
    img = Image.new("RGB", ((n + 8) * mod,) * 2, "white")
    d = ImageDraw.Draw(img)
    for y, lin in enumerate(matriz):
        for x, v in enumerate(lin):
            if v:
                d.rectangle([(x + 4) * mod, (y + 4) * mod, (x + 5) * mod - 1, (y + 5) * mod - 1], fill="black")
    return img


class _Folha:
    """Desenha a página em PIL (usada nos testes e na conferência) e GRAVA as mesmas operações em `ops`, de onde sai o PDF com texto de verdade."""

    def __init__(self):
        self.paginas, self.ops = [], []
        self.nova(TOPO1)

    def nova(self, topo=TOPO):
        self.img = Image.new("RGB", (W, H), "white")
        self.d = ImageDraw.Draw(self.img)
        self.y = topo
        self.paginas.append(self.img)
        self.ops.append([])

    def texto(self, x, y, txt, tam, negrito=False, cor="black"):
        f = fonte(tam, negrito)
        self.d.text((x, y), txt, fill=cor, font=f)
        self.ops[-1].append(("texto", x, y + f.getmetrics()[0], txt, tam, negrito, 0.0 if cor == "black" else cor[0] / 255))

    def retangulo(self, x0, y0, x1, y1):
        self.d.rectangle([x0, y0, x1, y1], outline=CINZA)
        self.ops[-1].append(("ret", x0, y0, x1, y1))

    def colar(self, im, x, y):
        self.img.paste(im, (x, y))
        self.ops[-1].append(("img", im, x, y))

    def qr(self, matriz, lado, x, y):
        im = _qr(matriz, lado).resize((lado, lado), Image.NEAREST)
        self.img.paste(im, (x, y))
        n = len(matriz); mod = lado / (n + 8)
        self.ops[-1].append(("qr", [(x + (cx + 4) * mod, y + (cy + 4) * mod, mod, mod) for cy, lin in enumerate(matriz) for cx, v in enumerate(lin) if v]))

    def cabe(self, h):
        if self.y + h > H - BASE:
            self.nova()

    def linha(self, texto, tam, negrito=False, x=ESQ, passo=PASSO_BLOCO, cor="black"):
        self.cabe(passo)
        self.texto(x, self.y, texto, tam, negrito, cor)
        self.y += passo

    def quebrar(self, texto, tam, recuo=0):
        f, largura, linhas, atual = fonte(tam), W - ESQ - DIR_ - recuo, [], ""
        for pal in texto.split():
            teste = (atual + " " + pal).strip()
            if self.d.textlength(teste, font=f) <= largura or not atual:
                atual = teste
            else:
                linhas.append(atual); atual = pal
        return linhas + ([atual] if atual else [])


def gerar(md, imagens=None, miniaturas=None, matriz=None, saida=None):
    """md: texto da ficha. imagens: {url: bytes}. miniaturas: {texto do item: [url, ...]}. matriz: QR (0/1) ou None."""
    folha = _compor(md, imagens, miniaturas, matriz)
    dados = pdf_de_ops(folha.ops)
    if saida:
        Path(saida).write_bytes(dados)
    return dados


def pdf_de_ops(ops_por_pagina):
    """PDF A4 com texto selecionável (fonte embutida), miniaturas em JPEG e QR vetorial, a partir das operações gravadas pelo desenho."""
    doc = pdf_vetor.Documento(W, H)
    chaves = {False: ("FRegular", _arquivo_fonte(False)), True: ("FBold", _arquivo_fonte(True))}
    if not all(a for _, a in chaves.values()):
        raise RuntimeError("fonte Liberation Sans/DejaVu não encontrada para embutir no PDF")
    for k, a in chaves.values():
        doc.fonte(k, a)
    for ops in ops_por_pagina:
        pag = doc.nova_pagina()
        for op in ops:
            if op[0] == "texto":
                _, x, base, txt, tam, neg, cinza = op
                doc.texto(pag, chaves[neg][0], x, base, txt, tam, cinza)
            elif op[0] == "ret":
                doc.retangulo(pag, *op[1:])
            elif op[0] == "img":
                doc.imagem(pag, op[1], op[2], op[3])
            elif op[0] == "qr":
                doc.preenchidos(pag, op[1])
    return doc.salvar()


def desenhar(md, imagens=None, miniaturas=None, matriz=None):
    """Desenha a ficha e devolve as páginas (imagens PIL)."""
    return _compor(md, imagens, miniaturas, matriz).paginas


def _compor(md, imagens=None, miniaturas=None, matriz=None):
    """Monta a ficha: devolve a _Folha com as páginas (PIL) e as operações de desenho gravadas."""
    imagens, miniaturas = imagens or {}, miniaturas or {}
    p = _Folha()
    em_pix = pulando = apos_item = False
    linhas_md = md.splitlines()
    for pos, bruta in enumerate(linhas_md):
        t = bruta.rstrip()
        if t.strip() == "#### Confidencial":
            pulando = True  # custo, colagem e lucro nunca vão ao cliente; volta no próximo "### " (o Pix)
            continue
        if pulando and re.match(r"^###\s", t):
            pulando = False
        if pulando or not t.strip():
            continue
        m = re.match(r"^(#{3,5})\s+(.*)$", t)
        if m:
            if apos_item:
                p.y += PASSO_BLOCO - PASSO_ITEM
                apos_item = False
            nivel = {3: "h3", 4: "h4", 5: "h5"}[len(m.group(1))]
            if matriz and m.group(2).strip() == "Valores":
                n = 0  # a lista de valores por pedido fica inteira, junto do total, do Pix e do QR
                for prox in linhas_md[pos + 1:]:
                    if prox.startswith("###"):
                        break
                    n += bool(prox.strip())
                p.cabe(PASSO_BLOCO * (n + 5) + 420 + 40)
            if matriz and m.group(2).strip().startswith("Valor do pedido"):
                p.cabe(PASSO_BLOCO * 3 + PASSO_PARAG + 420 + 40)  # valor, "Pix", chave e QR ficam juntos na mesma página
            em_pix = m.group(2).strip() == "Pix"
            p.linha(m.group(2), TAM[nivel], True)
            continue
        it = re.match(r"^\s*(\d+)\.\s+(.*)$", t)
        if it:
            num = it.group(1) + "."
            partes = p.quebrar(it.group(2), TAM["txt"], RECUO) or [""]
            p.cabe(len(partes) * PASSO_ITEM + (170 if miniaturas.get(it.group(2).strip()) else 0))  # o texto do item e as miniaturas dele não se separam entre páginas
            for k, parte in enumerate(partes):  # item comprido continua na linha de baixo, alinhado ao texto
                p.cabe(PASSO_ITEM)
                if k == 0:
                    p.texto(ESQ + RECUO - 8 - p.d.textlength(num, font=fonte(TAM["txt"])), p.y, num, TAM["txt"], False, CINZA)
                p.texto(ESQ + RECUO, p.y, parte, TAM["txt"])
                p.y += PASSO_ITEM
            apos_item = True
            urls = [u for u in miniaturas.get(it.group(2).strip(), []) if u]
            if urls:
                alvo = 150
                p.cabe(alvo + 20)
                x = ESQ + RECUO
                for u in urls:
                    mini = _miniatura(imagens[u], alvo) if u in imagens else None
                    if mini:
                        p.colar(mini, x, p.y); x += mini.width + 16
                    else:
                        p.retangulo(x, p.y, x + 108, p.y + alvo)
                        p.texto(x + 10, p.y + alvo // 2 - 10, "sem imagem", 18, False, CINZA)
                        x += 124
                p.y += alvo + 20
            continue
        if t.startswith("\t") or t.startswith("Custo"):
            continue
        apos_item = False
        for l in p.quebrar(t.strip(), TAM["txt"]):
            p.linha(l, TAM["txt"], passo=PASSO_PARAG if not em_pix else PASSO_BLOCO)
        p.y += PASSO_BLOCO - PASSO_PARAG
    if matriz:
        lado = 420
        p.cabe(lado + 20)
        p.y += 10
        p.qr(matriz, lado, ESQ, p.y)
    return p
