"""Comparador v0: pontua cada candidato do MPCFill contra a referência do Scryfall.

Sinais (por candidato): carta inteira, arte, moldura, borda branca, rodapé (OCR), rodapé ausente.
Pesos ajustados por regressão logística no gabarito (testset/gabarito.json).

Uso (precisa do venv com rapidocr): venv/bin/python scripts/compare.py [ocr|eval]
  ocr  -> lê o rodapé de referências e candidatos e guarda em cache/ocr_*.txt
  eval -> avalia deixando um par de fora por vez
"""
import json, os, re, sys
import numpy as np
from PIL import Image

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..")
TS, CACHE = os.path.join(ROOT, "testset"), os.path.join(ROOT, "cache")
W, H = 64, 88
FEATS = ["inteira", "arte", "moldura", "borda", "rodape", "sem_rodape", "idioma", "simbolo"]


def load(path):
    return Image.open(path).convert("RGB")


def small(im):
    return np.asarray(im.resize((W, H)), dtype=np.float32) / 255


def blur(g):  # média 3x3 sem scipy
    p = np.pad(g, 1, mode="edge")
    return sum(p[i:i + g.shape[0], j:j + g.shape[1]] for i in range(3) for j in range(3)) / 9


def grad(g):
    g = blur(g)
    return np.hypot(np.abs(np.diff(g, axis=1, prepend=g[:, :1])), np.abs(np.diff(g, axis=0, prepend=g[:1, :])))


def rowprof(a):
    """Perfil por linha das arestas horizontais (linha do tipo, topo da caixa de texto), normalizado."""
    g = blur(a.mean(axis=2))
    p = np.abs(np.diff(g, axis=0)).mean(axis=1)[30:]
    return p / (p.max() + 1e-6)


def symwin(im):
    g = np.asarray(im.resize((160, 220)).convert("L"), dtype=np.float32) / 255
    return g


def simbolo(ref, cand):
    """Símbolo do set: janela da referência (fim da linha do tipo) procurada na candidata com deslocamento de +-8 px."""
    a, b = symwin(ref), symwin(cand)
    t = a[112:134, 132:150]; t = t - t.mean()
    best = -1.0
    for dy in range(-8, 9, 2):
        for dx in range(-8, 9, 2):
            c = b[112 + dy:134 + dy, 132 + dx:150 + dx]; c = c - c.mean()
            d = np.sqrt((t * t).sum() * (c * c).sum())
            if d > 1e-6: best = max(best, float((t * c).sum() / d))
    return max(best, 0.0)


def ring_white(a):
    """Maior luminância média de um anel a 0-8% da borda: detecta borda branca mesmo com sangria preta."""
    g = a.mean(axis=2)
    best = 0.0
    for o in range(0, 6):
        ring = np.concatenate([g[o, o:W - o], g[H - 1 - o, o:W - o], g[o:H - o, o], g[o:H - o, W - 1 - o]])
        best = max(best, float(ring.mean()))
    return best


def tokens(text):
    out = set()
    for t in re.findall(r"[A-Z0-9]+", text.upper()):
        if any(c.isdigit() for c in t):
            out.add(t.lstrip("0") or "0")
        elif len(t) in (2, 3):
            out.add(t)
    return out


def ocr_path(key):
    return os.path.join(CACHE, f"ocr_{key}.txt")


def footer_text(key):
    p = ocr_path(key)
    return open(p, encoding="utf-8").read() if os.path.exists(p) else ""


def features(ref, rtok, cand, ctok):
    a, b = small(ref), small(cand)
    inteira = 1 - float(np.abs(a - b).mean())
    arte = 1 - float(np.abs(a[9:48, 5:59] - b[9:48, 5:59]).mean())
    moldura = 1 - float(np.abs(rowprof(a) - rowprof(b)).mean())
    borda = 1 - abs(ring_white(a) - ring_white(b))
    sem = 1.0 if not ctok else 0.0
    rodape = len(rtok & ctok) / len(rtok | ctok) if rtok and ctok else 0.0
    idioma = 0.5 if not ctok else (1.0 if "EN" in ctok else 0.0)
    return [inteira, arte, moldura, borda, rodape, sem, idioma, simbolo(ref, cand)]


def pairs():
    g = json.load(open(os.path.join(TS, "gabarito.json")))
    for k in sorted(g):
        meta = json.load(open(os.path.join(TS, k, "candidates.json")))
        yield k, g[k], meta["candidates"], os.path.join(TS, k, "ref.jpg")


_ocr = None


def ocr_footer(path, key):
    """Lê o rodapé da imagem e guarda em cache/ocr_<key>.txt (não repete)."""
    global _ocr
    if os.path.exists(ocr_path(key)):
        return
    if _ocr is None:
        from rapidocr_onnxruntime import RapidOCR
        _ocr = RapidOCR()
    im = load(path)
    w, h = im.size
    c = im.crop((0, int(h * .90), int(w * .6), h))
    r, _ = _ocr(np.asarray(c.resize((c.size[0] * 2, c.size[1] * 2))))
    open(ocr_path(key), "w", encoding="utf-8").write(" | ".join(t[1] for t in (r or [])))


def cmd_ocr():
    n = 0
    for k, _, cands, refp in pairs():
        ocr_footer(refp, "ref_" + k)
        for c in cands:
            ocr_footer(os.path.join(CACHE, f"mpc_{c['id']}.jpg"), c["id"])
            n += 1
    print("ocr ok:", n, "candidatos")


def dataset():
    X, y, grp, idx = [], [], [], []
    for k, g, cands, refp in pairs():
        ref, rtok = load(refp), tokens(footer_text("ref_" + k))
        acc = set(g["accept"])
        for c in cands:
            try:
                im = load(os.path.join(CACHE, f"mpc_{c['id']}.jpg"))
            except Exception:
                continue
            X.append(features(ref, rtok, im, tokens(footer_text(c["id"]))))
            y.append(1.0 if c["n"] in acc else 0.0)
            grp.append(k); idx.append(c["n"])
    return np.array(X), np.array(y), grp, idx


def fit(X, y, l2=0.05, iters=3000, lr=0.3):
    mu, sd = X.mean(0), X.std(0) + 1e-6
    Z = (X - mu) / sd
    w, b = np.zeros(Z.shape[1]), 0.0
    pw = (1 - y.mean()) / max(y.mean(), 1e-6)  # positivos são raros: pesa mais
    sw = np.where(y == 1, pw, 1.0)
    for _ in range(iters):
        p = 1 / (1 + np.exp(-(Z @ w + b)))
        g = (p - y) * sw
        w -= lr * (Z.T @ g / len(y) + l2 * w); b -= lr * g.mean()
    return mu, sd, w, b


def score(model, X):
    mu, sd, w, b = model
    return ((X - mu) / sd) @ w + b


def decide(scores, T):
    i = int(np.argmax(scores))
    return i, scores[i] >= T


def best_of(model, X, y, grp, g):
    """Por par: (maior nota, o melhor candidato está entre os certos?, status)."""
    out = []
    for k in sorted(set(grp)):
        m = grp == k
        s = score(model, X[m]); i = int(np.argmax(s))
        out.append((float(s[i]), bool(y[m][i]), g[k]["status"]))
    return out


def pick_threshold(rows):
    """Limiar que mais pares decide certo: 'ok' = nota >= T e melhor é certo; 'nenhum' = nota < T."""
    cands = sorted({r[0] for r in rows}) + [9.0]
    return max(cands, key=lambda T: sum((r[0] >= T and r[1]) if r[2] == "ok" else (r[0] < T) for r in rows))


def cmd_eval():
    X, y, grp, idx = dataset()
    g = json.load(open(os.path.join(TS, "gabarito.json")))
    grp = np.array(grp); idx = np.array(idx); keys = sorted(set(grp))
    print("amostras:", len(y), "| positivos:", int(y.sum()), "| pares:", len(keys))
    res = {"baseline": [0, 0, 0, 0], "fit": [0, 0, 0, 0]}; fails = []
    for k in keys:
        te, tr = grp == k, grp != k
        model = fit(X[tr], y[tr])
        T = pick_threshold(best_of(model, X[tr], y[tr], grp[tr], g))
        for mode in ("baseline", "fit"):
            s = X[te][:, 0] if mode == "baseline" else score(model, X[te])
            i = int(np.argmax(s)); passed = True if mode == "baseline" else bool(s[i] >= T)
            r = res[mode]
            if g[k]["status"] == "ok":
                r[1] += 1; good = bool(y[te][i]) and passed; r[0] += good
                if mode == "fit" and not good: fails.append((k, "esperava %s" % g[k]["accept"], "escolheu #%d%s" % (idx[te][i], "" if passed else " (abaixo do limiar: alerta)")))
            else:
                r[3] += 1; good = (not passed) and mode == "fit"; r[2] += good
                if mode == "fit" and not good: fails.append((k, "esperava nenhum", "escolheu #%d (nota %.2f >= %.2f)" % (idx[te][i], s[i], T)))
    held = []  # (nota, acertou se escolhido, status) de cada par deixado de fora
    for k in keys:
        te, tr = grp == k, grp != k
        sc = score(fit(X[tr], y[tr]), X[te]); i = int(np.argmax(sc))
        held.append((float(sc[i]), bool(y[te][i]), g[k]["status"]))
    print("\nlimiar -> escolhe sozinho / erra entre os que escolhe sozinho / vai para revisão:")
    for T in sorted({round(h[0], 2) for h in held})[::4] + [9.0]:
        auto = [h for h in held if h[0] >= T]
        wrong = sum((not h[1]) if h[2] == "ok" else True for h in auto)
        print(f"  T={T:>5}: {len(auto):>2} sozinhos, {wrong:>2} errados | {len(held) - len(auto):>2} para revisão")
    for mode, label in (("baseline", "só 'inteira' (pré-filtro grosso)"), ("fit", "comparador v0")):
        r = res[mode]
        print(f"{label}: certo acertado {r[0]}/{r[1]}" + (f" | 'nenhum' reconhecido {r[2]}/{r[3]}" if mode == "fit" else " | (não decide 'nenhum')"))
    for f in fails: print("  falha:", *f)
    print("pesos finais (padronizados):", {n: round(float(v), 2) for n, v in zip(FEATS, fit(X, y)[2])})


if __name__ == "__main__":
    {"ocr": cmd_ocr, "eval": cmd_eval}[sys.argv[1]]()
