"""Ficha do Obsidian (`Pedido <Cliente>.md`), modelo do /clientrundown (docs/referencia_processo.md §5)."""
from . import orcamento



def _lista(itens):
    """Itens numerados; cada item é um nome ou {nome, id}. Cópias repetidas ficam linha a linha."""
    return "\n".join(f"{i}. {x['nome'] if isinstance(x, dict) else x}" for i, x in enumerate(itens, 1))


def _n(x):
    """Número em pt-BR para a parte confidencial: inteiro sem casas, senão até 4 casas com vírgula."""
    x = float(x)
    return str(int(x)) if x == int(x) else f"{x:.4f}".rstrip("0").rstrip(".").replace(".", ",")


def raciocinio(r, p, slots, descontos, pago):
    """Linhas (confidenciais) que explicam o preço: divisão em kits, descontos possíveis e custo."""
    L = ["Como o valor foi calculado", f"\t- {slots} slots = {r['paginas']} páginas"]
    for u in r["usados"]:
        L.append(f"\t- {u['qtd']} × kit de {u['slots']} slots ({_n(u['qtd'] * u['slots'] / orcamento.SLOTS_POR_PAGINA)} pág.) = {_n(u['qtd'] * u['preco'])}")
    kf = r.get("kit_final")
    if kf:
        if kf["kit"]:
            L.append(f"\t- {kf['qtd']} × kit final de {kf['kit']} slots (sobraram {kf['slots']}) = {_n(kf['preco'])}")
        else:
            L.append(f"\t- {kf['slots']} slots avulsos × {_n(p['avulso'])} = {_n(kf['preco'])}")
    L.append(f"\t- Valor da tabela = {_n(r['pago'])}")
    if pago != r["pago"]:
        L.append(f"\t- Valor cobrado = {_n(pago)} ({'desconto de ' + _n(r['pago'] - pago) if pago < r['pago'] else 'acréscimo de ' + _n(pago - r['pago'])} sobre a tabela)")
    custo = r["impressao"] + r["colagem"]
    lucro_tab = r["pago"] - custo
    kits = [k["preco"] / k["slots"] for k in p["kits"] if k["slots"] > 0]
    d = descontos or {}
    taxa = float(d["slot"]) if d.get("slot") else (min(kits) if kits else 0)
    pct = float(d["pct"]) if d.get("pct") is not None else 10.0
    if taxa:
        preco = orcamento.inteiro(slots * taxa)
        L.append("Descontos possíveis (sobre o valor da tabela)")
        L.append(f"\t- Todos os slots a {_n(round(taxa, 4))}: {slots}x{_n(round(taxa, 4))} = {_n(preco)} (desconto de {_n(r['pago'] - preco)}; lucro {_n(preco - custo)})")
        cede = orcamento.inteiro(max(lucro_tab, 0) * pct / 100)
        L.append(f"\t- Ceder {_n(pct)}% do lucro ({_n(round(max(lucro_tab, 0) * pct / 100, 2))} → {_n(cede)}): {_n(r['pago'] - cede)} (desconto de {_n(cede)}; lucro {_n(lucro_tab - cede)})")
    return L


def gerar(cliente, telefone, fontes, alteracoes, conclusao, modo, precos, chave_pix="<CHAVE_PIX>", pago=None, descontos=None, slots_orc=None):
    """fontes: [{titulo, frentes:[...], versos:[...]}]; alteracoes: [{titulo, itens:[{texto, ...}]}].

    descontos: {slot, pct} (preço por slot do desconto e % do lucro); slots_orc: slots do orçamento (se diferir da lista).
    Devolve (markdown, resumo do orçamento). Tudo antes de '#### Confidencial' vai ao cliente; o raciocínio do preço fica dentro dele.
    """
    slots = sum(len(f.get("frentes", [])) + len(f.get("versos", [])) for f in fontes)
    n_orc = slots_orc if slots_orc is not None else slots
    p = {**orcamento.padrao(modo), **(precos or {})}
    r = orcamento.calcular(n_orc, 0, modo, precos)
    if pago is None:
        pago = r["pago"]
    L = ["#### Nome", cliente, "#### Número", telefone, f"### Pedido: {slots} slots"]
    for n, f in enumerate(fontes, 1):
        fr, ve = f.get("frentes", []), f.get("versos", [])
        L.append(f"#### {n}. {f['titulo']} → {len(fr) + len(ve)} slots")
        if ve:
            L += ["##### Frentes", _lista(fr), "##### Versos", _lista(ve)]
        else:
            L.append(_lista(fr))
    if alteracoes:
        L.append("### Alterações")
        for a in alteracoes:
            L.append(f"#### {a['titulo']}")
            linhas = []
            for i, it in enumerate(a["itens"], 1):
                linhas.append(f"{i}. {it['texto']}")  # texto puro: as miniaturas aparecem só na página e no PDF
            L.append("\n".join(linhas))
    if conclusao:
        L += ["#### Conclusão", conclusao]
    pag = r["paginas"]
    col = float(p["colagem"])
    if modo == "normal":
        imp = f"{pag}x{_n(p['impressao_pagina'])} = {_n(r['impressao'])}"
    else:
        imp = _n(r["impressao"])
    lucro = pago - r["impressao"] - r["colagem"]
    L += [f"### Valor do pedido: {_n(pago)} reais", "#### Confidencial", f"Pago = {_n(pago)}"]
    L += raciocinio(r, p, n_orc, descontos, pago)
    L += ["Custo", f"\t- Impressão: {imp}", f"\t- Colagem: {n_orc}x{_n(col)} = {_n(r['colagem'])}",
          "\t- Bulk: 0", f"\t- Lucro: {_n(pago)}-{_n(r['impressao'])}-{_n(r['colagem'])} = {_n(lucro)}",
          "### Pix", chave_pix]
    return "\n".join(L) + "\n", r
