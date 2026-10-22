"""Redimensionamento sem Photoshop: qualquer origem -> 816x1110, 300 dpi, RGB, PNG."""
from pathlib import Path

from PIL import Image

TAMANHO_SLOT = (816, 1110)
DPI = 300


def preparar(origem, tamanho=TAMANHO_SLOT):
    """Abre (arquivo não confiável, só como imagem), tira CMYK/alfa e reamostra."""
    with Image.open(origem) as im:
        im.load()
        if im.mode in ("RGBA", "LA", "P") and (im.mode != "P" or "transparency" in im.info):
            im = im.convert("RGBA")
            fundo = Image.new("RGB", im.size, "white")  # alfa achatado sobre branco (a confirmar)
            fundo.paste(im, mask=im.getchannel("A"))
            im = fundo
        else:
            im = im.convert("RGB")  # inclui CMYK; sem perfil ICC (a confirmar)
        return im.resize(tamanho, Image.LANCZOS)


def redimensionar(origem, destino, tamanho=TAMANHO_SLOT):
    destino = Path(destino)
    destino.parent.mkdir(parents=True, exist_ok=True)
    preparar(origem, tamanho).save(destino, "PNG", dpi=(DPI, DPI))
    return destino
