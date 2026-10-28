"""Leitura do XML do MPC Autofill. O arquivo é dado não confiável: nada é executado."""
import re
from pathlib import Path
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field


@dataclass
class Carta:
    id: str
    slots: list
    nome: str = ""
    query: str = ""


@dataclass
class Pedido:
    frentes: list = field(default_factory=list)
    versos: list = field(default_factory=list)
    verso_padrao: str = ""
    detalhes: dict = field(default_factory=dict)


def _cartas(no):
    saida = []
    if no is None:
        return saida
    for c in no.findall("card"):
        slots = [int(s) for s in re.split(r"\s*,\s*", (c.findtext("slots") or "").strip()) if s != ""]
        saida.append(Carta((c.findtext("id") or "").strip(), slots,
                           (c.findtext("name") or "").strip(), (c.findtext("query") or "").strip()))
    return saida


def ler(caminho):
    dados = Path(caminho).read_bytes()
    # ElementTree expande entidades: recusar DTD/entidades evita XML bombs.
    if re.search(rb"<!(DOCTYPE|ENTITY)", dados, re.I):
        raise ValueError("XML com DOCTYPE/ENTITY recusado")
    raiz = ET.fromstring(dados)
    det = {c.tag: (c.text or "").strip() for c in (raiz.find("details") or [])}
    return Pedido(_cartas(raiz.find("fronts")), _cartas(raiz.find("backs")),
                  (raiz.findtext("cardback") or "").strip(), det)


def escrever(pedido, caminho):
    raiz = ET.Element("order")
    det = ET.SubElement(raiz, "details")
    for k, v in pedido.detalhes.items():
        ET.SubElement(det, k).text = v
    for tag, cartas in (("fronts", pedido.frentes), ("backs", pedido.versos)):
        no = ET.SubElement(raiz, tag)
        for c in cartas:
            e = ET.SubElement(no, "card")
            ET.SubElement(e, "id").text = c.id
            ET.SubElement(e, "slots").text = ",".join(str(s) for s in c.slots)
            ET.SubElement(e, "name").text = c.nome
            ET.SubElement(e, "query").text = c.query
    ET.SubElement(raiz, "cardback").text = pedido.verso_padrao
    ET.indent(raiz)
    ET.ElementTree(raiz).write(caminho, encoding="utf-8", xml_declaration=True)
