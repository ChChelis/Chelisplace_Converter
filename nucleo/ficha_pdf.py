"""PDF da ficha para o cliente (A4): pedido, alterações com miniaturas, valor e Pix. Sem nada confidencial."""
import io

from PIL import Image, ImageDraw, ImageFont

W, H, M = 1240, 1754, 90  # A4 a 150 dpi
FRENTE_COLUNAS = 3


def _fonte(n):
    try:
        return ImageFont.load_default(size=n)
    except TypeError:
        return ImageFont.load_default()


class _Pagina:
    def __init__(self):
        self.paginas = []
        self.nova()

    def nova(self):
        self.img = Image.new("RGB", (W, H), "white")
        self.d = ImageDraw.Draw(self.img)
        self.y = M
        self.paginas.append(self.img)

    def espaco(self, h):
        if self.y + h > H - M:
            self.nova()

    def texto(self, t, n=30, negrito=False, x=M, avanco=None):
        self.espaco(n + 14)
        self.d.text((x, self.y), t, fill="black", font=_fonte(n + (4 if negrito else 0)))
        self.y += avanco or n + 14


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


def gerar(dados, imagens, matriz=None, codigo=None, saida=None):
    """dados: {cliente, fontes[{titulo,frentes,versos}], alteracoes[{titulo,itens[{texto,pedido_img,usado_img}]}], conclusao, pago};
    imagens: {url: bytes} das miniaturas que a página conseguiu baixar. Devolve os bytes do PDF."""
    p = _Pagina()
    p.texto("Pedido de " + dados["cliente"], 44, True, avanco=80)
    slots = sum(len(f["frentes"]) + len(f.get("versos", [])) for f in dados["fontes"])
    p.texto(f"{slots} slots · {-(-slots // 18)} páginas A3", 28, avanco=60)
    for n, f in enumerate(dados["fontes"], 1):
        nomes = list(f["frentes"]) + list(f.get("versos", []))
        p.texto(f"{n}. {f['titulo']} → {len(nomes)} slots", 32, True, avanco=54)
        col = (W - 2 * M) // FRENTE_COLUNAS
        for i in range(0, len(nomes), FRENTE_COLUNAS):
            p.espaco(36)
            for j, nome in enumerate(nomes[i:i + FRENTE_COLUNAS]):
                p.d.text((M + j * col, p.y), nome[:30], fill="black", font=_fonte(22))
            p.y += 34
        p.y += 20
    if dados.get("alteracoes"):
        p.texto("Alterações", 38, True, avanco=64)
        for a in dados["alteracoes"]:
            p.texto(a["titulo"], 30, True, avanco=50)
            for it in a["itens"]:
                alvo = 220
                p.espaco(alvo + 20)
                x = M
                for url, rot in ((it.get("pedido_img"), "pedido"), (it.get("usado_img"), "usado")):
                    mini = _miniatura(imagens[url], alvo) if url in imagens else None
                    if url:
                        if mini:
                            p.img.paste(mini, (x, p.y))
                            p.d.text((x, p.y + alvo + 2), rot, fill="gray", font=_fonte(18))
                            x += mini.width + 20
                        else:
                            p.d.rectangle([x, p.y, x + 150, p.y + alvo], outline="gray")
                            p.d.text((x + 20, p.y + alvo // 2), "sem imagem", fill="gray", font=_fonte(18))
                            x += 170
                p.d.text((x + 10, p.y + alvo // 2 - 14), it["texto"], fill="black", font=_fonte(24))
                p.y += alvo + 40
    if dados.get("conclusao"):
        p.y += 20
        for linha in dados["conclusao"].splitlines():
            p.texto(linha, 28)
    p.y += 20
    p.texto("Valor do pedido: R$ " + f"{float(dados['pago']):.2f}".replace(".", ","), 40, True, avanco=70)
    if matriz and codigo:
        p.espaco(760)
        p.texto("Pagamento via Pix", 32, True, avanco=50)
        p.img.paste(_qr(matriz, 520), (M, p.y))
        for i in range(0, len(codigo), 38):
            p.d.text((M + 580, p.y + 20 + 34 * (i // 38)), codigo[i:i + 38], fill="black", font=_fonte(22))
        p.y += 540
    buf = io.BytesIO()
    p.paginas[0].save(buf, "PDF", resolution=150, save_all=True, append_images=p.paginas[1:])
    if saida:
        open(saida, "wb").write(buf.getvalue())
    return buf.getvalue()
