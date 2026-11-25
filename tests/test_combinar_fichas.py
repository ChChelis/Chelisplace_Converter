"""Skill pdf-cliente-combinado: junta fichas (.md) + PDFs da página numa ficha única com miniaturas, total, Pix e QR."""
import importlib.util
import io
import shutil
import tempfile
import unittest
from pathlib import Path

from PIL import Image

from nucleo import ficha_pdf

RAIZ = Path(__file__).resolve().parent.parent
spec = importlib.util.spec_from_file_location("combinar_fichas", RAIZ / ".claude" / "skills" / "pdf-cliente-combinado" / "scripts" / "combinar_fichas.py")
cf = importlib.util.module_from_spec(spec)
spec.loader.exec_module(cf)


def png(cor):
    b = io.BytesIO(); Image.new("RGB", (100, 140), cor).save(b, "PNG"); return b.getvalue()


def ficha_md(nome, itens_lista, alts, completar=()):
    L = ["#### Nome", nome, "#### Número", "+55 11 91111-1111", f"### Pedido: {len(itens_lista) + len(completar)} slots", f"#### 1. {nome} (bot) → {len(itens_lista)} slots"]
    L += [f"{i}. {t}" for i, t in enumerate(itens_lista, 1)]
    if completar:
        L += [f"#### 2. Cartas para completar → {len(completar)} slots"] + [f"{i}. {t}" for i, t in enumerate(completar, 1)]
    if alts:
        L += ["### Alterações", "#### Imagens de outra fonte"] + [f"{i}. {t}" for i, t in enumerate(alts, 1)]
    L += ["### Valor do pedido: 100 reais", "#### Confidencial", "Pago = 100", "Custo", "\t- Lucro: 1", "### Pix", "chave-pix-de-teste"]
    return "\n".join(L) + "\n"


class Combinar(unittest.TestCase):
    def test_lista_limpa_junta_completar_e_renumera(self):
        lista = ["1. A", "2. B", "#### 2. Cartas para completar → 1 slots", "1. C"]
        self.assertEqual(cf.lista_limpa(lista), ["1. A", "2. B", "3. C"])
        com_versos = ["##### Frentes", "1. A", "##### Versos", "1. V", "#### 2. Cartas para completar → 1 slots", "1. C"]
        self.assertEqual(cf.lista_limpa(com_versos)[-2:], ["##### Cartas para completar", "1. C"])

    def test_sem_completar_omite_a_secao_inteira(self):
        lista = ["1. A", "2. B", "#### 2. Cartas para completar → 2 slots", "1. C", "2. D"]
        self.assertEqual(cf.lista_limpa(lista, sem_completar=True), ["1. A", "2. B"])
        com_versos = ["##### Frentes", "1. A", "##### Versos", "1. V", "#### 2. Cartas para completar → 1 slots", "1. C"]
        self.assertEqual(cf.lista_limpa(com_versos, sem_completar=True), ["##### Frentes", "1. A", "##### Versos", "1. V"])

    def test_ordem_pelo_numero_do_nome(self):
        pares = [({"nome": "Cli_3_X"}, "c"), ({"nome": "Cli_1_Y"}, "a"), ({"nome": "Cli_2_Z"}, "b")]
        self.assertEqual([p[1] for p in cf.ordenar(pares)], ["a", "b", "c"])

    def test_miniaturas_ficam_no_item_certo_mesmo_quando_um_item_nao_tem(self):
        md = ficha_md("T", [f"Carta {i}" for i in range(1, 8)], ["Alfa", "Beta sem miniatura", "Gama"])
        # a página gera o PDF assim: miniaturas só nos itens que têm imagem (aqui, o 1º e o 3º)
        paginas = ficha_pdf.desenhar(md.replace("(bot) ", ""), {"v": png((255, 0, 0)), "a": png((0, 0, 255))}, {"Alfa": ["v"], "Gama": ["a", "v"]})
        r = cf.miniaturas_por_item(paginas, 3)
        self.assertEqual([len(x) for x in r], [1, 0, 2])
        cor = lambda im: im.getpixel((im.width // 2, im.height // 2))
        self.assertGreater(cor(r[0][0])[0], 200)                                  # vermelha
        self.assertGreater(cor(r[2][0])[2], 200); self.assertGreater(cor(r[2][1])[0], 200)  # azul e vermelha

    def test_itens_de_duas_linhas_nao_deslocam_as_miniaturas(self):
        longo = " — não existe no MPCFill; a imagem vem de outra fonte e o texto precisa quebrar em mais de uma linha para este teste"
        alts = [f"Carta {i} (SET {i}){longo}" for i in range(1, 7)]
        md = ficha_md("T", [f"Carta {i}" for i in range(1, 6)], alts)
        minis = {alts[0]: ["v"], alts[2]: ["a"], alts[3]: ["v"], alts[5]: ["a", "v"]}  # itens 2 e 5 sem miniatura
        paginas = ficha_pdf.desenhar(md.replace("(bot) ", ""), {"v": png((255, 0, 0)), "a": png((0, 0, 255))}, minis)
        # o PDF da página é gravado em JPEG: a compressão cria um halo cinza em volta do texto, que não pode virar "número de item"
        jpg = []
        for pg in paginas:
            b = io.BytesIO(); pg.convert("RGB").save(b, "JPEG", quality=75); b.seek(0); jpg.append(Image.open(b).convert("RGB"))
        r = cf.miniaturas_por_item(jpg, 6)
        self.assertEqual([len(x) for x in r], [1, 0, 1, 1, 0, 2])

    def test_pdf_de_outro_pedido_e_recusado(self):
        paginas = ficha_pdf.desenhar(ficha_md("T", ["a", "b"], []))
        with self.assertRaises(ValueError):
            cf.miniaturas_por_item(paginas, 5)  # a ficha pede 5 alterações e o PDF não tem tantos itens

    @unittest.skipUnless(importlib.util.find_spec("qrcode") and shutil.which("pdftoppm") and shutil.which("pdfinfo"), "precisa de qrcode e poppler")
    def test_de_ponta_a_ponta(self):
        with tempfile.TemporaryDirectory() as d:
            d = Path(d); mds, pdfs = [], []
            for n, nome in ((2, "Cli_2_Beta"), (1, "Cli_1_Alfa")):
                md = ficha_md(nome, [f"Carta {i}" for i in range(1, 5)], [f"Troca {n}"])
                (d / f"{nome}.md").write_text(md, encoding="utf-8")
                ficha_pdf.gerar(md.replace("(bot) ", ""), {"v": png((255, 0, 0))}, {f"Troca {n}": ["v"]}, None, str(d / f"1a2b3c4d-{nome}.pdf"))
                mds.append(d / f"{nome}.md"); pdfs.append(d / f"1a2b3c4d-{nome}.pdf")
            r = cf.combinar("Cli", 150, mds, pdfs, str(d / "saida.pdf"), md_saida=str(d / "saida.md"))
            self.assertEqual(r["fichas"], ["Cli_1_Alfa", "Cli_2_Beta"])
            self.assertEqual((r["itens"], r["itens_com_miniatura"]), (2, 2))
            texto = (d / "saida.md").read_text(encoding="utf-8")
            self.assertIn("### Valor do pedido: 150 reais", texto)
            self.assertNotIn("Confidencial", texto); self.assertNotIn("Lucro", texto)
            self.assertIn("chave-pix-de-teste", texto)
            self.assertLess(texto.index("Cli_1_Alfa"), texto.index("Cli_2_Beta"))  # ordem pelo número do nome
            self.assertIn(cf.verificar_qr(str(d / "saida.pdf"), r["codigo"]), (True, None))  # None = sem OpenCV
