"""Correção de sangria das imagens 'Card Custom' (portado de HANDOFF_SANGRIA.md / bleed.py).

Saída padrão: canvas 816x1110 RGBA, carta de 744x1040 centralizada (36 px de sangria nas laterais, 35 em cima/embaixo),
PNG com 299.9994 dpi (sem essa tag o Photoshop trata a imagem como 72/96 dpi). Nunca sobrescreve a origem.

Modos (por imagem; 'borda' é o padrão):
  borda   : buracos transparentes externos preenchidos com o pixel opaco mais próximo; sangria repete o último pixel.
  branco  : buracos externos e sujeira pequena na franja ficam brancos; a sangria é branca.
  preto   : a faixa da borda (3% da largura) recebe a cor mediana de 2% a 3,5% da borda (preto puro em arte preta); sangria 'borda'.
Transparência interna (ex.: caixa de texto semitransparente) é preservada: só o anel externo é tocado.
Precisa de numpy e scipy (no navegador, o Pyodide os carrega só quando esta função é usada).
"""
import io
from pathlib import Path

from PIL import Image

CW, CH = 816, 1110       # canvas
W, H = 744, 1040         # carta
DPI = 299.9994
# A faca (FACA_CHELISPLACE.pdf, A3 com 18 cartas) corta um retângulo de ~749x1038 px com quinas de raio ~26, praticamente rente à carta de 744x1040
# (raio ~37): o que o corte inclui além da arte é só sangria inventada (estrias e quinas borradas), e a tolerância física do corte (alguns px) a expõe.
# Por isso, nos modos "borda" e "preto" a arte é AMPLIADA por COBERTURA (proporcional, sem distorção) até cobrir a faca com folga de ~6 px (franja de 2 px da borda fica 4 px fora do corte)
# (medido nas quinas, que mandam: 1,6% cobre com 3 px de folga, 2,0% com 5 px, 2,5% com ~6,5 px, 2,8% com 8 px); o que passa da faca é arte de verdade, não preenchimento. "branco" não muda.
COBERTURA = 1.025
FRANJA = 2   # px de arte rente às quinas transparentes que são descartados e refeitos
MODOS = ("borda", "branco", "preto")
LIMITE = (W * 2, H * 2)  # imagens enormes são reduzidas antes (a saída é 744x1040 de qualquer jeito)


def _anel_e_distancia(h, w, np):
    anel = np.zeros((h, w), bool)
    anel[0, :] = anel[-1, :] = anel[:, 0] = anel[:, -1] = True
    yy, xx = np.mgrid[:h, :w]
    dist = np.minimum(np.minimum(xx, w - 1 - xx), np.minimum(yy, h - 1 - yy))
    return anel, dist


def _preencher_suave(arr, valido, alvo, np, ndimage):
    """Cor para os pixels `alvo`: média gaussiana ponderada só pelos pixels `valido` (convolução normalizada), da escala fina para a grossa."""
    rgb, w = arr[:, :, :3].astype(float), valido.astype(float)
    saida = np.zeros(rgb.shape, float)
    falta = alvo.copy()
    for sigma in (1.5, 3, 6, 12, 24, 48, 96):
        den = ndimage.gaussian_filter(w, sigma)
        ok = falta & (den > 0.02)
        if ok.any():
            for c in range(3):
                saida[:, :, c][ok] = ndimage.gaussian_filter(rgb[:, :, c] * w, sigma)[ok] / den[ok]
            falta &= ~ok
        if not falta.any():
            break
    return np.clip(saida[alvo] + 0.5, 0, 255).astype(np.uint8)


def corrigir(origem, modo="borda"):
    """origem: caminho ou bytes (arquivo não confiável: só é lido como imagem). Devolve Image RGBA 816x1110."""
    import numpy as np
    from scipy import ndimage
    if modo not in MODOS:
        raise ValueError(f"modo desconhecido: {modo}")
    with Image.open(io.BytesIO(origem) if isinstance(origem, (bytes, bytearray)) else origem) as im:
        im.load()
        im = im.convert("RGBA")
        if im.width > LIMITE[0] or im.height > LIMITE[1]:
            im = im.resize(LIMITE, Image.LANCZOS)
        arr = np.array(im)
    h, w = arr.shape[:2]
    anel, dist = _anel_e_distancia(h, w, np)
    buraco = arr[:, :, 3] < 255
    rot, _ = ndimage.label(buraco)
    tocam = np.unique(rot[anel & buraco])
    externo = np.isin(rot, tocam[tocam > 0])
    preencher = "borda"
    if modo == "branco":
        arr[externo] = 255
        branco = (arr[:, :, :3].astype(int) > 235).all(axis=2)
        nb = ~branco
        l2, n2 = ndimage.label(nb)
        tamanhos = ndimage.sum(nb, l2, range(1, n2 + 1)) if n2 else []
        grande = max(tamanhos) if n2 else 0
        t2 = np.unique(l2[anel & nb])
        lixo = [k for k in t2 if k > 0 and tamanhos[k - 1] < 0.05 * grande]
        if lixo:
            m = ndimage.binary_dilation(np.isin(l2, lixo), iterations=2) & (dist < int(0.06 * w))
            arr[m] = 255
        preencher = "constante"
    elif modo == "preto":
        nucleo = (dist >= int(0.02 * w)) & (dist < int(0.035 * w))
        if nucleo.any():
            med = np.median(arr[nucleo][:, :3], axis=0).astype(np.uint8)
            faixa = dist < int(0.03 * w)
            arr[faixa, :3] = med
            arr[faixa, 3] = 255
    elif externo.any():
        # buraco externo (quinas arredondadas e transparência da franja): média local suave das cores opacas vizinhas, de escala fina para grossa.
        # O "pixel opaco mais próximo" deixava estrias radiais nas quinas; o RGB escondido sob alpha baixo (cinza) nunca é usado.
        # além do buraco, FRANJA px de arte rente a ele também são refeitos: é a franja anti-aliased/clara das quinas arredondadas
        franja = ndimage.binary_dilation(externo, iterations=FRANJA) & ~externo & ~buraco
        alvo = externo | franja
        arr[alvo, :3] = _preencher_suave(arr, ~buraco & ~franja, alvo, np, ndimage)
        arr[alvo, 3] = 255
    img = Image.fromarray(arr, "RGBA")
    if img.size != (W, H):
        img = img.resize((W, H), Image.LANCZOS)
    ampliar = COBERTURA if preencher == "borda" else 1.0
    sw, sh = round(W * ampliar), round(H * ampliar)
    if (sw, sh) != (W, H):
        img = img.resize((sw, sh), Image.LANCZOS)
    oy, ox = (CH - sh) // 2, (CW - sw) // 2
    pads = ((oy, CH - sh - oy), (ox, CW - sw - ox), (0, 0))
    base = np.array(img)
    if preencher == "constante":
        return Image.fromarray(np.pad(base, pads, mode="constant", constant_values=255), "RGBA")
    cheio = np.pad(base, pads, mode="edge")
    # o que sobra além da arte ampliada (só aparece se o corte desregistrar além da folga): o último pixel repetido, suavizado ao longo da borda (sem estrias)
    yy, xx = np.mgrid[:CH, :CW]
    dist = np.maximum.reduce([ox - xx, xx - (ox + sw - 1), oy - yy, yy - (oy + sh - 1)])
    peso = (np.clip(dist / 8.0, 0, 1) * (dist > 0))[:, :, None]
    if peso.any():
        rgb = cheio[:, :, :3].astype(float)
        borrado = np.stack([ndimage.gaussian_filter(rgb[:, :, c], 5) for c in range(3)], -1)
        cheio[:, :, :3] = np.clip(rgb * (1 - peso) + borrado * peso + 0.5, 0, 255).astype(np.uint8)
    return Image.fromarray(cheio, "RGBA")


def salvar(img, destino):
    destino = Path(destino)
    destino.parent.mkdir(parents=True, exist_ok=True)
    img.save(destino, "PNG", dpi=(DPI, DPI))
    return destino


def _xadrez(tam, passo=12):
    fundo = Image.new("RGB", tam, (205, 205, 205))
    from PIL import ImageDraw
    d = ImageDraw.Draw(fundo)
    for y in range(0, tam[1], passo):
        for x in range(0, tam[0], passo):
            if (x // passo + y // passo) % 2:
                d.rectangle([x, y, x + passo - 1, y + passo - 1], fill=(160, 160, 160))
    return fundo


def previa(origem, corrigida):
    """PNG antes/depois (transparência em xadrez), com zoom 4x do canto superior esquerdo e do inferior direito. Devolve bytes."""
    with Image.open(io.BytesIO(origem) if isinstance(origem, (bytes, bytearray)) else origem) as im:
        antes = im.convert("RGBA").resize((CW, CH), Image.LANCZOS)
    def sobre_xadrez(i):
        f = _xadrez(i.size)
        f.paste(i, mask=i.getchannel("A"))
        return f
    a, d = sobre_xadrez(antes), sobre_xadrez(corrigida)
    esc = 0.5
    lado, z, rec = (int(CW * esc), int(CH * esc)), 4, 56
    cantos = []
    for img in (a, d):
        topo = img.crop((0, 0, rec, rec)).resize((rec * z, rec * z), Image.NEAREST)
        base = img.crop((CW - rec, CH - rec, CW, CH)).resize((rec * z, rec * z), Image.NEAREST)
        cantos.append((topo, base))
    folha = Image.new("RGB", (lado[0] * 2 + 24, lado[1] + rec * z + 24), "white")
    folha.paste(a.resize(lado, Image.LANCZOS), (0, 0))
    folha.paste(d.resize(lado, Image.LANCZOS), (lado[0] + 24, 0))
    for k, (topo, base) in enumerate(cantos):
        x0 = k * (lado[0] + 24)
        folha.paste(topo.resize((lado[0] // 2, lado[0] // 2), Image.NEAREST), (x0, lado[1] + 24))
        folha.paste(base.resize((lado[0] // 2, lado[0] // 2), Image.NEAREST), (x0 + lado[0] // 2, lado[1] + 24))
    buf = io.BytesIO()
    folha.save(buf, "PNG")
    return buf.getvalue()


def miniatura(img, largura=240):
    """Miniatura de uma imagem RGBA 816x1110 (transparência em xadrez) com zoom 4x do canto superior esquerdo e do inferior direito."""
    f = _xadrez(img.size)
    f.paste(img, mask=img.getchannel("A"))
    alt = int(largura * CH / CW)
    carta = f.resize((largura, alt), Image.LANCZOS)
    rec, meio = 40, largura // 2
    tl = f.crop((0, 0, rec, rec)).resize((meio, meio), Image.NEAREST)
    br = f.crop((CW - rec, CH - rec, CW, CH)).resize((meio, meio), Image.NEAREST)
    folha = Image.new("RGB", (largura, alt + meio + 4), "white")
    folha.paste(carta, (0, 0))
    folha.paste(tl, (0, alt + 4))
    folha.paste(br, (meio, alt + 4))
    buf = io.BytesIO()
    folha.save(buf, "PNG")
    return buf.getvalue()


def gerar_modos(origem, pasta_saida):
    """Gera os três modos (borda, branco, preto) para escolher olhando a miniatura de cada um, e a miniatura da original.
    Grava <modo>.png (a imagem final), prev_<modo>.png e prev_original.png em `pasta_saida`."""
    pasta_saida = Path(pasta_saida)
    with Image.open(io.BytesIO(origem) if isinstance(origem, (bytes, bytearray)) else origem) as im:
        original = im.convert("RGBA").resize((CW, CH), Image.LANCZOS)
    (pasta_saida / "prev_original.png").write_bytes(miniatura(original))
    for modo in MODOS:
        img = corrigir(origem, modo)
        salvar(img, pasta_saida / f"{modo}.png")
        (pasta_saida / f"prev_{modo}.png").write_bytes(miniatura(img))
