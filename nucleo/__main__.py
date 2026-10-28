"""Uso: python -m nucleo checagem <pasta> <pedido.xml> | orcamento <frentes> [versos] [normal|foil]
        | redimensionar <pasta_entrada> <pasta_saida> | montar <pasta_imagens_816x1110> <saida> <cliente>"""
import sys
from pathlib import Path

from . import checagem, imagem, montagem, orcamento, xml_mpc


def main(a):
    if not a:
        print(__doc__)
        return 2
    cmd = a[0]
    if cmd == "checagem":
        ped = xml_mpc.ler(a[2])
        r = checagem.analisar(a[1], ped)
        print(f"exigido={sum(r.exigido.values())} ok={r.ok}")
        for t in ("faltando", "a_duplicar", "excesso"):
            print(t, {r.nomes.get(i, i): n for i, n in getattr(r, t).items()})
        for t in ("fora_da_lista", "sem_id", "verso_padrao", "pares"):
            print(t, getattr(r, t))
    elif cmd == "orcamento":
        print(orcamento.calcular(int(a[1]), int(a[2]) if len(a) > 2 else 0, a[3] if len(a) > 3 else "normal"))
    elif cmd == "redimensionar":
        for f in sorted(Path(a[1]).iterdir()):
            if f.suffix.lower() in checagem.EXTENSOES:
                imagem.redimensionar(f, Path(a[2]) / (f.stem + ".png"))
    elif cmd == "montar":
        raiz = sorted(p for p in Path(a[1]).iterdir() if p.suffix.lower() == ".png")
        print(*montagem.montar_pedido(raiz, a[2], a[3]), sep="\n")
    else:
        print(__doc__)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
