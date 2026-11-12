"""Orçamento do pedido (fórmulas da skill /clientrundown). Preços ficam em TABELAS, fáceis de mudar."""
import math
from decimal import ROUND_HALF_UP, Decimal

TABELAS = {
    "normal": dict(kit_slots=108, kit_preco=135.0, avulso=1.6667, kit_pag=6),
    "foil": dict(kit_slots=180, kit_preco=330.0, avulso=2.44441, kit_pag=10),
}
IMPRESSAO_PAGINA = 14.0      # normal: R$ por página
FOIL_KIT_IMPRESSAO = 121.99  # foil: por kit de 10 páginas
FOIL_PAGINA_EXTRA = 24.99
COLAGEM_SLOT = 0.13
SLOTS_POR_PAGINA = 18


def inteiro(x):
    """Arredonda para o inteiro mais próximo (meio sobe). Regra assumida; ver docs/nucleo.md."""
    return int(Decimal(str(x)).quantize(Decimal("1"), rounding=ROUND_HALF_UP))


def padrao(modo="normal"):
    """Preços de partida de um modo (cópia editável): kits [{slots, preco}], avulso, impressão e colagem."""
    t = TABELAS[modo]
    d = dict(kits=[dict(slots=t["kit_slots"], preco=t["kit_preco"])], avulso=t["avulso"], colagem=COLAGEM_SLOT)
    if modo == "normal":
        d["impressao_pagina"] = IMPRESSAO_PAGINA
    else:
        d.update(impressao_kit=FOIL_KIT_IMPRESSAO, impressao_pagina_extra=FOIL_PAGINA_EXTRA)
    return d


def calcular(frentes, versos=0, modo="normal", precos=None):
    """frentes/versos = unidades; cada verso distinto conta +1 slot.

    precos (opcional) troca a tabela: kits [{slots, preco}] (usa o maior que cabe, depois o próximo...),
    avulso por slot, colagem por slot e custos de impressão. O que faltar vem de padrao(modo).
    """
    p = {**padrao(modo), **(precos or {})}
    slots = int(frentes) + int(versos)
    paginas = math.ceil(slots / SLOTS_POR_PAGINA)
    kits_def = sorted((k for k in p["kits"] if k["slots"] > 0), key=lambda k: -k["slots"])
    resto, kits, pago, usados = slots, 0, 0.0, []
    for k in kits_def:
        n, resto = divmod(resto, int(k["slots"]))
        if n:
            kits += n
            pago += n * float(k["preco"])
            usados.append(dict(slots=int(k["slots"]), qtd=n, preco=float(k["preco"])))
    pago = inteiro(pago + resto * float(p["avulso"]))
    if modo == "normal":
        impressao = paginas * float(p["impressao_pagina"])
    else:
        pag_kits = sum(u["qtd"] * u["slots"] for u in usados) // SLOTS_POR_PAGINA
        n_kits_base = sum(u["qtd"] for u in usados)
        impressao = n_kits_base * float(p["impressao_kit"]) + max(paginas - pag_kits, 0) * float(p["impressao_pagina_extra"])
    colagem = inteiro(slots * float(p["colagem"]))
    return dict(slots=slots, paginas=paginas, kits=kits, usados=usados, resto=resto, pago=pago,
                impressao=round(impressao, 2), colagem=colagem,
                lucro=round(pago - impressao - colagem, 2))
