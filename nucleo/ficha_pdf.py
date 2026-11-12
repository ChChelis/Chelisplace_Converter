"""PDF da ficha para o cliente: o próprio Markdown da ficha (nucleo/ficha.py) desenhado em A4, igual ao modelo do Chelis.

Para no `#### Confidencial` e não mostra a linha 'Valor do pedido'; o QR do Pix vai ao fim. Miniaturas são opcionais,
penduradas nos itens de Alterações pelo texto do item."""
import io
import re
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

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
    def __init__(self):
        self.paginas = []
        self.nova(TOPO1)

    def nova(self, topo=TOPO):
        self.img = Image.new("RGB", (W, H), "white")
        self.d = ImageDraw.Draw(self.img)
        self.y = topo
        self.paginas.append(self.img)

    def cabe(self, h):
        if self.y + h > H - BASE:
            self.nova()

    def linha(self, texto, tam, negrito=False, x=ESQ, passo=PASSO_BLOCO, cor="black"):
        self.cabe(passo)
        self.d.text((x, self.y), texto, fill=cor, font=fonte(tam, negrito))
        self.y += passo

    def quebrar(self, texto, tam):
        f, largura, linhas, atual = fonte(tam), W - ESQ - DIR_, [], ""
        for pal in texto.split():
            teste = (atual + " " + pal).strip()
            if self.d.textlength(teste, font=f) <= largura or not atual:
                atual = teste
            else:
                linhas.append(atual); atual = pal
        return linhas + ([atual] if atual else [])


def gerar(md, imagens=None, miniaturas=None, matriz=None, saida=None):
    """md: texto da ficha. imagens: {url: bytes}. miniaturas: {texto do item: [url, ...]}. matriz: QR (0/1) ou None."""
    imagens, miniaturas = imagens or {}, miniaturas or {}
    p = _Folha()
    em_pix = pulando = apos_item = False
    for bruta in md.splitlines():
        t = bruta.rstrip()
        if t.strip() == "#### Confidencial":
            pulando = True  # custo, colagem e lucro nunca vão ao cliente; volta no próximo "### " (o Pix)
            continue
        if pulando and re.match(r"^###\s", t):
            pulando = False
        if pulando or not t.strip() or t.startswith("### Valor do pedido"):
            continue
        m = re.match(r"^(#{3,5})\s+(.*)$", t)
        if m:
            if apos_item:
                p.y += PASSO_BLOCO - PASSO_ITEM
                apos_item = False
            nivel = {3: "h3", 4: "h4", 5: "h5"}[len(m.group(1))]
            em_pix = m.group(2).strip() == "Pix"
            p.linha(m.group(2), TAM[nivel], True)
            continue
        it = re.match(r"^\s*(\d+)\.\s+(.*)$", t)
        if it:
            p.cabe(PASSO_ITEM)
            num = it.group(1) + "."
            p.d.text((ESQ + RECUO - 8 - p.d.textlength(num, font=fonte(TAM["txt"])), p.y), num, fill=CINZA, font=fonte(TAM["txt"]))
            p.d.text((ESQ + RECUO, p.y), it.group(2), fill="black", font=fonte(TAM["txt"]))
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
                        p.img.paste(mini, (x, p.y)); x += mini.width + 16
                    else:
                        p.d.rectangle([x, p.y, x + 108, p.y + alvo], outline=CINZA)
                        p.d.text((x + 10, p.y + alvo // 2 - 10), "sem imagem", fill=CINZA, font=fonte(18))
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
        p.img.paste(_qr(matriz, lado).resize((lado, lado), Image.NEAREST), (ESQ, p.y))
    buf = io.BytesIO()
    p.paginas[0].save(buf, "PDF", resolution=DPI, save_all=True, append_images=p.paginas[1:])
    if saida:
        Path(saida).write_bytes(buf.getvalue())
    return buf.getvalue()
