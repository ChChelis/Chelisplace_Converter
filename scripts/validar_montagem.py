"""Compara o resultado do Photoshop com o do núcleo Python (somente leitura nas pastas de origem).

  python scripts/validar_montagem.py imagens <pasta_ps> <pasta_nucleo> <saida>
  python scripts/validar_montagem.py paginas <pdf_ps> <pdf_nucleo> <saida>

Precisa de Pillow, numpy e pymupdf (pip install pillow numpy pymupdf). Grava só em <saida>.
"""
import sys
from pathlib import Path

import numpy as np
from PIL import Image


def diferenca(a, b):
    """(média, p99) da diferença absoluta por pixel, 0-255, depois de igualar o tamanho."""
    if a.size != b.size:
        b = b.resize(a.size, Image.LANCZOS)
    d = np.abs(np.asarray(a.convert("RGB"), dtype=np.int16) - np.asarray(b.convert("RGB"), dtype=np.int16))
    return float(d.mean()), float(np.percentile(d, 99))


def lado_a_lado(a, b, destino, largura=700):
    h = int(largura * a.height / a.width)
    da = Image.fromarray(np.abs(np.asarray(a.convert("RGB").resize((largura, h)), dtype=np.int16)
                                - np.asarray(b.convert("RGB").resize((largura, h)), dtype=np.int16)).clip(0, 255).astype("uint8"))
    folha = Image.new("RGB", (largura * 3 + 20, h), "white")
    for i, im in enumerate((a, b, da)):
        folha.paste(im.convert("RGB").resize((largura, h)), (i * (largura + 10), 0))
    folha.save(destino)


def imagens(ps, nuc, saida):
    saida.mkdir(parents=True, exist_ok=True)
    por_nome = {p.stem.lower(): p for p in Path(nuc).glob("*.png")}
    print("arquivo | tamanho PS | tamanho núcleo | dif. média | dif. p99")
    for p in sorted(Path(ps).glob("*.png")):
        q = por_nome.get(p.stem.lower())
        if not q:
            print(f"{p.name} | sem par no núcleo")
            continue
        with Image.open(p) as a, Image.open(q) as b:
            m, p99 = diferenca(a, b)
            print(f"{p.name} | {a.size} {a.mode} | {b.size} {b.mode} | {m:.2f} | {p99:.0f}")
            lado_a_lado(a, b, saida / f"{p.stem}.png", 350)


def paginas(pdf_ps, pdf_nuc, saida, dpi=50):
    import pymupdf
    saida.mkdir(parents=True, exist_ok=True)
    imgs = []
    for caminho in (pdf_ps, pdf_nuc):
        doc = pymupdf.open(caminho)
        pg = doc[0]
        print(f"{Path(caminho).name}: {Path(caminho).stat().st_size / 1e6:.1f} MB, {pg.rect.width:.2f} x {pg.rect.height:.2f} pt, {len(doc)} pág.")
        pix = pg.get_pixmap(dpi=dpi, alpha=False)
        imgs.append(Image.frombytes("RGB", (pix.width, pix.height), pix.samples))
    m, p99 = diferenca(*imgs)
    print(f"diferença média {m:.2f}, p99 {p99:.0f} (0 = idênticas)")
    lado_a_lado(*imgs, saida / "pagina.png")
    # Se a arte estiver de cabeça para baixo, a versão girada 180° da página do núcleo bate melhor.
    mg, _ = diferenca(imgs[0], imgs[1].rotate(180))
    print(f"com o núcleo girado 180°: {mg:.2f}" + ("  <- a rotação dos slots provavelmente está invertida" if mg < m else ""))


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")  # nomes de carta com acento no console do Windows
    if len(sys.argv) != 5 or sys.argv[1] not in ("imagens", "paginas"):
        sys.exit(__doc__)
    {"imagens": imagens, "paginas": paginas}[sys.argv[1]](sys.argv[2], sys.argv[3], Path(sys.argv[4]))
