"""Pontes para o site (Pyodide): entradas e saídas só com tipos simples (str, int, list, dict)."""
import json
from pathlib import Path

from . import checagem, imagem, montagem, orcamento, xml_mpc


def orcar(frentes, versos, modo):
    return json.dumps(orcamento.calcular(int(frentes), int(versos), modo))


def checar(pasta, xml_path, faltantes_path=None, ignorar=None):
    """Relatório da checagem em JSON. Só lê; as ações são decididas pela página.

    ignorar: IDs de pares que o Chelis mandou ignorar (não são exigidos nem cobrados).
    """
    ignorar = set(ignorar or [])
    total = xml_mpc.ler(xml_path)
    ped = checagem.sem_ids(total, ignorar)
    r = checagem.analisar(pasta, ped, ignorar)
    nomes = checagem.exigido(total)[1]
    nome = lambda i: nomes.get(i, i)
    duplicar = [[r.existentes[i][0], checagem.nome_copia(r.existentes[i][0], n)]
                for i, extra in r.a_duplicar.items() for n in range(1, extra + 1)]
    if faltantes_path and r.faltando:
        checagem.xml_dos_faltantes(ped, r, faltantes_path)
    return json.dumps(dict(
        total=sum(r.exigido.values()), ok=r.ok,
        faltando=[[nome(i), n] for i, n in r.faltando.items()],
        a_duplicar=[[nome(i), n] for i, n in r.a_duplicar.items()],
        excesso=[[nome(i), n] for i, n in r.excesso.items()],
        fora_da_lista=r.fora_da_lista, sem_id=r.sem_id, verso_padrao=r.verso_padrao,
        duplicar=duplicar,
        pares=[[r.existentes[f][0], r.existentes[v][0]] for f, v in r.pares
               if f in r.existentes and v in r.existentes],
        pares_incompletos=[[nome(f), nome(v), f, v] for f, v in r.pares
                           if f not in r.existentes or v not in r.existentes],
        pares_ignorados=[[nome(f), nome(v), f, v] for f, v in checagem.pares(total)
                         if f in ignorar or v in ignorar]))


def redimensionar_pasta(entrada, saida):
    """Redimensiona todas as imagens de `entrada` para `saida`; devolve os nomes gerados."""
    feitos = []
    for f in sorted(Path(entrada).iterdir()):
        if f.suffix.lower() in checagem.EXTENSOES:
            feitos.append(imagem.redimensionar(f, Path(saida) / (f.stem + ".png")).name)
    return feitos


def plano(n_raiz, n_pares):
    """Quantas páginas e o progresso de cada uma (para mostrar antes de montar)."""
    pag = montagem.planejar(["x"] * n_raiz, ["p"] * n_pares)
    return json.dumps(dict(paginas=len(pag), progresso=montagem.progresso(pag)))


def montar(pasta_raiz, pasta_pares, pasta_saida, cliente, xml_path=None):
    """Monta os PDFs; devolve os caminhos. Pares vão para os últimos slots, na ordem do XML se ele vier."""
    lista = lambda p: sorted(x for x in Path(p).iterdir() if x.suffix.lower() == ".png") if Path(p).exists() else []
    pares = lista(pasta_pares)
    if xml_path and pares:
        por_nome = {p.name: p for p in pares}
        ordem = checagem.ordem_pares(xml_mpc.ler(xml_path), list(por_nome))
        pares = [por_nome[n] for n in ordem] + [p for p in pares if p.name not in ordem]
    pdfs = montagem.montar_pedido(lista(pasta_raiz), pasta_saida, cliente, pares=pares)
    return json.dumps([str(p) for p in pdfs])
