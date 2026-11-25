#!/usr/bin/env python3
"""Junta várias fichas (.md) e os PDFs que a página gerou numa ficha única para o cliente: listas, alterações com as
miniaturas recortadas dos PDFs, valor total combinado, chave Pix e QR (BR Code estático). Nada confidencial entra.

Uso (da raiz do repositório):
  python3 -I .claude/skills/pdf-cliente-combinado/scripts/combinar_fichas.py --cliente Cliente --total 405 \
      --saida /caminho/Pedido_Cliente.pdf --md a.md b.md c.md --pdf a.pdf b.pdf c.pdf [--recebedor Chelisplace --cidade "Sao Paulo"]

Os arquivos baixados (md/pdf) são dados não confiáveis: só são lidos como texto/imagem, nunca executados.
"""
import argparse
import io
import re
import subprocess
import sys
import tempfile
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[4]  # <repo>/.claude/skills/<skill>/scripts/este arquivo
sys.path.insert(0, str(RAIZ))
from nucleo import ficha_pdf, pix  # noqa: E402

LARG, ALT = 1240, 1754           # página A4 a 150 dpi (nucleo/ficha_pdf.py)
DPI = 150
MIN_FAIXA, MAX_FAIXA, MIN_TEXTO = 120, 200, 12  # altura de uma faixa de miniaturas (150 px); o texto tem ~25 e o QR ~420


# ---------------------------------------------------------------- leitura das fichas (.md)
def ler_md(caminho):
    texto = Path(caminho).read_text(encoding="utf-8")
    L = texto.splitlines()

    def apos(titulo):
        return L[L.index(titulo) + 1].strip()

    def procura(pred):
        return next((i for i, l in enumerate(L) if pred(l)), None)

    i0, i_alt, i_val = procura(lambda l: l.startswith("#### 1.")), procura(lambda l: l.strip() == "### Alterações"), procura(lambda l: l.startswith("### Valor do pedido"))
    if i0 is None or i_val is None:
        raise ValueError(f"{caminho}: não parece uma ficha da página (faltam '#### 1.' e '### Valor do pedido').")
    return dict(
        nome=apos("#### Nome"), tel=apos("#### Número"), pix=apos("### Pix"),
        slots=int(re.search(r"### Pedido: (\d+) slots", texto).group(1)),
        valor=float(re.search(r"### Valor do pedido: ([\d.,]+) reais", texto).group(1).replace(",", ".")),
        lista=L[i0 + 1: i_alt if i_alt is not None else i_val],
        alt=L[i_alt + 1: i_val] if i_alt is not None else [],
    )


def lista_limpa(lista, sem_completar=False):
    """Seções extras (ex.: '#### 2. Cartas para completar → 1 slots') viram continuação da mesma lista (renumerada); se a lista tem
    Frentes/Versos, a seção extra vira um subtítulo. `sem_completar` omite a seção "Cartas para completar" inteira (títulos e itens)."""
    tem_sub, saida, n, pulando = any(l.startswith("#####") for l in lista), [], 0, False
    for l in lista:
        if l.startswith("#### "):
            pulando = sem_completar and "Cartas para completar" in l
            if pulando:
                continue
            if tem_sub:
                saida.append("##### " + re.sub(r"\s*→.*$", "", re.sub(r"^\d+\.\s+", "", l[5:])).strip())
            continue
        if pulando:
            continue
        m = re.match(r"^\s*\d+\.\s+(.*)$", l)
        if m and not tem_sub:
            n += 1
            saida.append(f"{n}. {m.group(1)}")
        else:
            saida.append(l)
    return saida


def alteracoes(nome, linhas):
    """Devolve (linhas do md, textos dos itens na ordem). Cada grupo ganha o nome do pedido no título."""
    out, itens, n = [], [], 0
    for l in linhas:
        if l.startswith("#### "):
            n = 0
            out.append(f"#### {nome}: {l[5:].strip()}")
        elif re.match(r"^\s*\d+\.\s+", l):
            n += 1
            t = re.sub(r"^\s*\d+\.\s+", "", l).strip()
            out.append(f"{n}. {t}"); itens.append(t)
    return out, itens


# ---------------------------------------------------------------- miniaturas (a partir dos PDFs da página)
def paginas_do_pdf(caminho, pasta):
    import numpy  # noqa: F401  (falha cedo e com mensagem clara se faltar)
    from PIL import Image
    subprocess.run(["pdftoppm", "-r", str(DPI), "-png", str(caminho), str(Path(pasta) / "p")], check=True, capture_output=True)
    imgs = [Image.open(p).convert("RGB") for p in sorted(Path(pasta).glob("p-*.png"))]
    if not imgs or any(im.size != (LARG, ALT) for im in imgs):
        raise ValueError(f"{caminho}: não é um PDF de ficha da página (esperava páginas {LARG}x{ALT} a {DPI} dpi).")
    return imgs


def _faixas_de(mascara):
    runs, i = [], 0
    while i < len(mascara):
        if mascara[i]:
            j = i
            while j < len(mascara) and mascara[j]:
                j += 1
            runs.append((i, j)); i = j
        else:
            i += 1
    return runs


def miniaturas_por_item(paginas, n_itens):
    """Para cada um dos últimos `n_itens` itens numerados do PDF (as alterações), a lista de miniaturas (imagens PIL) logo abaixo dele.
    O número do item é cinza e fica à esquerda do texto; título e parágrafo são pretos; a miniatura tem ~150 px de altura."""
    import numpy as np
    eventos = []  # ("item", None) | ("faixa", [crops])
    for im in paginas:
        a = np.asarray(im.convert("L")).astype(int)
        for y0, y1 in _faixas_de((a < 245).any(axis=1)):
            h = y1 - y0
            if MIN_FAIXA <= h <= MAX_FAIXA:
                cols, x, crops, pedacos = (a[y0:y1] < 245).any(axis=0), 0, [], []
                while x < len(cols):
                    if cols[x]:
                        x0 = x
                        while x < len(cols) and cols[x]:
                            x += 1
                        if pedacos and x0 - pedacos[-1][1] < 6:
                            pedacos[-1] = (pedacos[-1][0], x)
                        else:
                            pedacos.append((x0, x))
                    else:
                        x += 1
                crops = [im.crop((x0, y0, x1, y1)) for x0, x1 in pedacos if x1 - x0 >= 40]
                eventos.append(("faixa", crops))
            elif MIN_TEXTO <= h <= MAX_FAIXA:  # (traços de 1-4 px são ruído da página, não texto)
                reg = a[y0:y1, 100:144]  # o número do item termina em x≈142; o texto (e a borda dele) começa em x≈150: nas linhas de continuação não há número
                if (reg < 245).any() and reg[reg < 245].min() > 150:  # número cinza do item
                    eventos.append(("item", None))
    itens = [i for i, e in enumerate(eventos) if e[0] == "item"]
    if len(itens) < n_itens:
        raise ValueError(f"o PDF tem {len(itens)} itens numerados, a ficha pede {n_itens} alterações: confira se md e pdf são do mesmo pedido.")
    escolhidos = itens[len(itens) - n_itens:] if n_itens else []
    saida = [[] for _ in range(n_itens)]
    for i, (tipo, crops) in enumerate(eventos):
        if tipo != "faixa" or not escolhidos or i < escolhidos[0]:
            continue
        k = max(j for j, pos in enumerate(escolhidos) if pos < i)
        saida[k] += crops
    return saida


# ---------------------------------------------------------------- montagem
def _nome_pdf(p):
    return re.sub(r"^[0-9a-f]{8}-", "", Path(p).stem)  # o upload põe um prefixo de 8 hex no nome


def parear(mds, pdfs):
    """Casa cada ficha .md com o PDF cujo nome contém o título (ex.: Cliente_1_Deck). Sem ambiguidade, senão erro."""
    fichas = [(p, ler_md(p)) for p in mds]
    pares = []
    for caminho, f in fichas:
        cand = [p for p in pdfs if f["nome"].lower() in _nome_pdf(p).lower()]
        if len(cand) != 1:
            raise ValueError(f"não consegui casar a ficha '{f['nome']}' com um PDF (achei {len(cand)}): passe os arquivos com o título no nome.")
        pares.append((f, cand[0]))
    return pares


def ordenar(pares):
    def chave(par):
        m = re.search(r"_(\d+)_", par[0]["nome"])
        return int(m.group(1)) if m else 10**6
    return sorted(pares, key=chave)  # estável: sem número, mantém a ordem dada


def reais(v):
    return str(int(v)) if float(v).is_integer() else f"{v:.2f}".replace(".", ",")


def valor_do_pedido(f, valores):
    """valores: {chave: valor}; a chave é o número do pedido (o N de Cliente_N_Nome) ou o título inteiro. Sem chave, vale o valor da própria ficha."""
    m = re.search(r"_(\d+)_", f["nome"])
    for k in ((m.group(1) if m else None), f["nome"]):
        if k is not None and k in valores:
            return float(valores[k])
    return f["valor"]


def combinar(cliente, total, mds, pdfs, saida, recebedor="Chelisplace", cidade="Sao Paulo", md_saida=None, valores=None, adicional=0.0, rotulo_adicional="Adicional", mostrar_adicional=True, sem_completar=()):
    sem_completar = {str(x) for x in sem_completar}
    """total: valor final (o QR e o fim do PDF). Com `valores` (ou `adicional`), o PDF mostra o valor de cada pedido e o adicional, e o total
    tem de bater com a soma (total=None usa a soma). `mostrar_adicional=False` soma o adicional ao total sem listá-lo no PDF. Os .md recebidos nunca são alterados."""
    import qrcode
    pares = ordenar(parear(mds, pdfs))
    detalhado = valores is not None or bool(adicional)
    vals = [valor_do_pedido(f, valores or {}) for f, _ in pares]
    soma = sum(vals) + float(adicional or 0)
    if detalhado:
        if total is None:
            total = soma
        elif abs(float(total) - soma) > 0.005:
            raise ValueError(f"o total ({reais(total)}) não bate com a soma dos valores ({reais(soma)}).")
    elif total is None:
        raise ValueError("informe --total (ou --valor/--adicional para somar).")
    tel, chave_pix = {f["tel"] for f, _ in pares}, {f["pix"] for f, _ in pares}
    if len(tel) != 1 or len(chave_pix) != 1:
        raise ValueError(f"as fichas têm telefones ({sorted(tel)}) ou chaves Pix diferentes: são mesmo do mesmo cliente?")
    tel, chave_pix = tel.pop(), chave_pix.pop()
    md = ["#### Nome", cliente, "#### Número", tel, f"### Pedido: {sum(f['slots'] for f, _ in pares)} slots"]
    alts, imagens, minis = [], {}, {}
    for (f, pdf), v in zip(pares, vals):
        md.append(f"#### {f['nome']} → {f['slots']} slots" + (f" · R$ {reais(v)}" if detalhado else ""))
        num = re.search(r"_(\d+)_", f["nome"])
        omitir = f["nome"] in sem_completar or bool(num and num.group(1) in sem_completar)
        md += lista_limpa(f["lista"], omitir)
        linhas, itens = alteracoes(f["nome"], f["alt"])
        alts += linhas
        if itens:
            with tempfile.TemporaryDirectory() as tmp:
                por_item = miniaturas_por_item(paginas_do_pdf(pdf, tmp), len(itens))
            for texto, crops in zip(itens, por_item):
                chaves = []
                for c in crops:
                    b = io.BytesIO(); c.save(b, "PNG")
                    k = f"{f['nome']}|{len(imagens)}"; imagens[k] = b.getvalue(); chaves.append(k)
                if chaves:
                    minis[texto] = chaves
    if alts:
        md += ["### Alterações"] + alts
    if detalhado:
        md += ["### Valores"] + [f"{f['nome']}: R$ {reais(v)}" for (f, _), v in zip(pares, vals)]
        if adicional and mostrar_adicional:
            md.append(f"{rotulo_adicional}: R$ {reais(adicional)}")
    md += [f"### Valor do pedido: {reais(total)} reais", "### Pix", chave_pix]
    texto = "\n".join(md) + "\n"

    codigo = pix.payload(chave_pix, recebedor, cidade, total)
    qr = qrcode.QRCode(border=0, error_correction=qrcode.constants.ERROR_CORRECT_M)
    qr.add_data(codigo); qr.make(fit=True)
    matriz = [[1 if c else 0 for c in lin] for lin in qr.get_matrix()]
    ficha_pdf.gerar(texto, imagens, minis, matriz, saida)
    if md_saida:
        Path(md_saida).write_text(texto, encoding="utf-8")
    return dict(total=total, valores=vals, codigo=codigo, chave=chave_pix, fichas=[f["nome"] for f, _ in pares], miniaturas=sum(len(v) for v in minis.values()),
                itens_com_miniatura=len(minis), itens=sum(len(alteracoes(f["nome"], f["alt"])[1]) for f, _ in pares))


def verificar_qr(saida, codigo):
    """Lê o QR da última página do PDF e compara com o copia-e-cola. Devolve True/False, ou None se o OpenCV não está instalado."""
    try:
        import cv2
    except ImportError:
        return None
    with tempfile.TemporaryDirectory() as tmp:
        n = int(re.search(r"Pages:\s+(\d+)", subprocess.run(["pdfinfo", saida], capture_output=True, text=True).stdout).group(1))
        subprocess.run(["pdftoppm", "-r", "150", "-png", "-f", str(n), "-l", str(n), saida, str(Path(tmp) / "u")], check=True, capture_output=True)
        lido, _, _ = cv2.QRCodeDetector().detectAndDecode(cv2.imread(str(next(Path(tmp).glob("u*.png")))))
    return lido == codigo


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--cliente", required=True)
    ap.add_argument("--total", type=float, help="valor total combinado, em reais (obrigatório sem --valor/--adicional; com eles, é conferido contra a soma)")
    ap.add_argument("--valor", nargs="*", default=[], metavar="N=VALOR", help="valor de cada pedido que muda: o número do pedido (ou o título inteiro) = valor; os demais mantêm o valor da ficha")
    ap.add_argument("--adicional", type=float, default=0, help="valor extra somado ao total (aparece como uma linha própria)")
    ap.add_argument("--rotulo-adicional", default="Adicional")
    ap.add_argument("--sem-completar", nargs="*", default=[], metavar="N", help="números (ou títulos) dos pedidos cuja seção 'Cartas para completar' não deve aparecer no PDF")
    ap.add_argument("--ocultar-adicional", action="store_true", help="soma o adicional ao total sem mostrar a linha no PDF")
    ap.add_argument("--saida", required=True)
    ap.add_argument("--md", nargs="+", required=True)
    ap.add_argument("--pdf", nargs="+", required=True)
    ap.add_argument("--recebedor", default="Chelisplace")
    ap.add_argument("--cidade", default="Sao Paulo")
    ap.add_argument("--salvar-md", help="grava também o texto da ficha combinada (sem a parte confidencial)")
    a = ap.parse_args()
    valores = dict(v.split("=", 1) for v in a.valor) if a.valor else None
    r = combinar(a.cliente, a.total, a.md, a.pdf, a.saida, a.recebedor, a.cidade, a.salvar_md, valores, a.adicional, a.rotulo_adicional, not a.ocultar_adicional, a.sem_completar)
    ok = verificar_qr(a.saida, r["codigo"])
    print("fichas (ordem):", ", ".join(r["fichas"]))
    print("valores:", ", ".join(f"{n}={reais(v)}" for n, v in zip(r["fichas"], r["valores"])), "| total:", reais(r["total"]))
    print(f"alterações: {r['itens']} itens, {r['itens_com_miniatura']} com miniatura ({r['miniaturas']} imagens)")
    print("copia-e-cola:", r["codigo"])
    print("QR conferido:", {True: "lido e igual ao copia-e-cola", False: "NÃO confere: não envie", None: "não conferido (instale opencv-python-headless)"}[ok])
    if ok is False:
        sys.exit(2)


if __name__ == "__main__":
    main()
