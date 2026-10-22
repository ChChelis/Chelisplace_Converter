"""Índice de confiança: chance estimada de o melhor candidato do bot ser aceito pelo usuário.

Calibrado com os pares já conferidos (testset + pedidos): para cada par, o melhor candidato do modelo estava entre os aceitos?
Ajusta uma curva monótona (regressão isotônica) nota -> chance, separada por tipo de referência (Scryfall x Liga),
porque a escala de notas muda. Limite honesto: o modelo foi treinado nesses mesmos pares, então a chance real tende a ser
um pouco menor que o índice; ele melhora conforme entram pedidos novos conferidos.

Uso: venv/bin/python scripts/calibrate.py   (imprime a tabela)
"""
import json, os, sys
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import compare as C

CACHE = C.CACHE
MIN_N = 8


def pav(x, y):
    """Regressão isotônica crescente. Devolve blocos [soma, n, nota_min, nota_max]."""
    o = np.argsort(x)
    st = []
    for xi, yi in zip(np.asarray(x)[o], np.asarray(y, float)[o]):
        st.append([yi, 1, xi, xi])
        while len(st) > 1 and st[-2][0] / st[-2][1] > st[-1][0] / st[-1][1]:
            b2, b1 = st.pop(), st.pop()
            st.append([b1[0] + b2[0], b1[1] + b2[1], b1[2], b2[3]])
    return st


def compute():
    X, y, grp, _ = C.dataset()
    grp = np.array(grp)
    s = C.score(C.fit(X, y), X)
    rows = {"scry": [], "liga": []}
    for k in sorted(set(grp)):
        m = grp == k
        sk = s[m]; i = int(np.argmax(sk))
        rows["liga" if "_liga_" in k else "scry"].append((float(sk[i]), float(y[m][i])))
    out = {"key": C.data_key()}
    for dom, r in rows.items():
        blocks = pav([a for a, _ in r], [b for _, b in r]) if r else []
        merged = []  # blocos com menos de MIN_N pares são pouco confiáveis: junta com o vizinho de nota maior
        for b in blocks:
            if merged and merged[-1][1] < MIN_N:
                a = merged.pop(); b = [a[0] + b[0], a[1] + b[1], a[2], b[3]]
            merged.append(b)
        if len(merged) > 1 and merged[-1][1] < MIN_N:
            b = merged.pop(); a = merged.pop(); merged.append([a[0] + b[0], a[1] + b[1], a[2], b[3]])
        top = 0.0
        out[dom] = []
        for b in merged:
            top = max(top, (b[0] + 1) / (b[1] + 2))  # +1/+2 suaviza; máximo corrido: mais nota nunca baixa o índice
            out[dom].append({"lo": float(b[2]), "hi": float(b[3]), "n": int(b[1]), "hits": float(b[0]), "p": top})
    return out


def load():
    path = os.path.join(CACHE, f"calib_{C.data_key()}.json")
    if os.path.exists(path):
        return json.load(open(path))
    c = compute()
    json.dump(c, open(path, "w"))
    return c


def index(cal, score, dom):
    """Índice 0-100 para a nota do melhor candidato; `dom` = 'liga' ou 'scry'."""
    bl = cal.get(dom) or []
    if not bl:
        return 0
    for b in bl:
        if score <= b["hi"]:
            return int(round(100 * b["p"]))
    return int(round(100 * bl[-1]["p"]))


if __name__ == "__main__":
    c = load()
    for dom in ("scry", "liga"):
        print(f"\n{dom}: nota até -> índice (n pares, aceitos)")
        for b in c[dom]:
            print(f"  {b['hi']:>6.2f} -> {100 * b['p']:>3.0f}%  (n={b['n']}, aceitos={b['hits']:.0f})")
