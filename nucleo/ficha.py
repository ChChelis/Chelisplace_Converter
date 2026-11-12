"""Ficha do Obsidian (`Pedido <Cliente>.md`), modelo do /clientrundown (docs/referencia_processo.md §5)."""
from . import orcamento


def _miniatura(id_, largura=110):
    return f"![|{largura}](https://drive.google.com/thumbnail?id={id_}&sz=w300)" if id_ else ""


def _lista(itens):
    """Itens numerados; cada item é um nome ou {nome, id}. Cópias repetidas ficam linha a linha."""
    return "\n".join(f"{i}. {x['nome'] if isinstance(x, dict) else x}" for i, x in enumerate(itens, 1))


def gerar(cliente, telefone, fontes, alteracoes, conclusao, modo, precos, chave_pix="<CHAVE_PIX>", pago=None):
    """fontes: [{titulo, frentes:[...], versos:[...]}]; alteracoes: [{titulo, itens:[{texto, pedido_id, usado_id}]}].

    Devolve (markdown, resumo do orçamento). Tudo antes de '#### Confidencial' vai ao cliente.
    """
    slots = sum(len(f.get("frentes", [])) + len(f.get("versos", [])) for f in fontes)
    r = orcamento.calcular(slots, 0, modo, precos)
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
                mini = " ".join(m for m in (_miniatura(it.get("pedido_id")), _miniatura(it.get("usado_id"))) if m)
                linhas.append(f"{i}. {it['texto']}" + (f"\n   {mini}" if mini else ""))
            L.append("\n".join(linhas))
    if conclusao:
        L += ["#### Conclusão", conclusao]
    pag = r["paginas"]
    col = float((precos or {}).get("colagem", orcamento.COLAGEM_SLOT))
    imp = f"{pag}x{orcamento.IMPRESSAO_PAGINA:g} = {r['impressao']:g}" if modo == "normal" else f"{r['impressao']:g}"
    L += [f"### Valor do pedido: {pago} reais", "#### Confidencial", f"Pago = {pago}", "Custo",
          f"\t- Impressão: {imp}", f"\t- Colagem: {slots}x{col:g} = {r['colagem']}".replace(".", ","),
          "\t- Bulk: 0", f"\t- Lucro: {pago}-{r['impressao']:g}-{r['colagem']} = {pago - r['impressao'] - r['colagem']:g}",
          "### Pix", chave_pix]
    return "\n".join(L) + "\n", r
