import tempfile
import unittest
from pathlib import Path

from PIL import Image

from nucleo import checagem, ficha, ficha_pdf, imagem, montagem, orcamento, pix, xml_mpc

A, B, C, V = ("a" * 33, "b" * 33, "c" * 33, "v" * 33)
XML = f"""<order><details><quantity>4</quantity></details>
<fronts>
<card><id>{A}</id><slots>0,1,2</slots><name>Ilha.jpg</name><query>island</query></card>
<card><id>{B}</id><slots>3</slots><name>Frente.png</name><query>front</query></card>
<card><id>{C}</id><slots>4</slots><name>Falta.png</name><query>missing</query></card>
</fronts>
<backs><card><id>{V}</id><slots>3</slots><name>Verso.png</name><query>b:back</query></card></backs>
<cardback>{"z" * 33}</cardback></order>"""


def img(p, cor="red", tam=(30, 40), modo="RGB"):
    Image.new(modo, tam, cor).save(p)


class Base(unittest.TestCase):
    def setUp(self):
        self.t = tempfile.TemporaryDirectory()
        self.d = Path(self.t.name)
        (self.d / "p.xml").write_text(XML)
        self.ped = xml_mpc.ler(self.d / "p.xml")

    def tearDown(self):
        self.t.cleanup()


class TestChecagem(Base):
    def monta(self):
        pasta = self.d / "pedido"
        pasta.mkdir()
        img(pasta / f"Ilha ({A}).jpg")
        img(pasta / f"Frente ({B}).png")
        img(pasta / f"Verso ({V}).png")
        img(pasta / f"Padrao ({'z' * 33}).png")
        img(pasta / f"Intrusa ({'q' * 33}).png")
        return pasta

    def test_classifica(self):
        r = checagem.analisar(self.monta(), self.ped)
        self.assertEqual(r.exigido[A], 3)
        self.assertEqual(r.a_duplicar, {A: 2})
        self.assertEqual(r.faltando, {C: 1})
        self.assertEqual(len(r.fora_da_lista), 1)
        self.assertEqual(len(r.verso_padrao), 1)
        self.assertEqual(r.pares, [(B, V)])
        self.assertFalse(r.ok)

    def test_duplicar_e_reconferir_sem_apagar(self):
        pasta = self.monta()
        antes = set(p.name for p in pasta.iterdir())
        checagem.duplicar(pasta, checagem.analisar(pasta, self.ped))
        r = checagem.analisar(pasta, self.ped)
        self.assertFalse(r.a_duplicar)
        self.assertTrue(antes <= set(p.name for p in pasta.iterdir()))

    def test_pares_e_xml_faltantes(self):
        pasta = self.monta()
        r = checagem.analisar(pasta, self.ped)
        self.assertEqual(len(checagem.separar_pares(pasta, r)), 2)
        novo = checagem.xml_dos_faltantes(self.ped, r, self.d / "f.xml")
        self.assertEqual([c.id for c in novo.frentes], [C])
        self.assertEqual(xml_mpc.ler(self.d / "f.xml").frentes[0].slots, [0])

    def test_ignorar_par(self):
        pasta = self.monta()
        r = checagem.analisar(pasta, self.ped, ignorar={C, V})
        self.assertNotIn(C, r.faltando)            # exigência do par ignorado some
        self.assertEqual(r.pares, [])
        self.assertNotIn(f"Verso ({V}).png", r.fora_da_lista)  # arquivo do par ignorado não vira "sobra"
        self.assertEqual(len(self.ped.frentes), 3)  # o pedido original não é alterado

    def test_xml_com_entidade_recusado(self):
        (self.d / "x.xml").write_text('<!DOCTYPE a [<!ENTITY e "x">]><order/>')
        with self.assertRaises(ValueError):
            xml_mpc.ler(self.d / "x.xml")


class TestOrcamento(unittest.TestCase):
    def test_exemplo_da_referencia(self):
        r = orcamento.calcular(120)
        self.assertEqual((r["kits"], r["resto"], r["pago"], r["paginas"]), (1, 12, 155, 7))
        self.assertEqual((r["impressao"], r["colagem"], r["lucro"]), (98, 16, 41))

    def test_kit_fechado(self):
        self.assertEqual(orcamento.calcular(108)["pago"], 135)

    def test_foil(self):
        r = orcamento.calcular(180, modo="foil")
        self.assertEqual((r["pago"], r["impressao"]), (330, 121.99))


class TestOrcamentoEditavel(unittest.TestCase):
    def test_kits_e_avulso_editados(self):
        p = dict(kits=[dict(slots=108, preco=135), dict(slots=36, preco=50)], avulso=2.0)
        r = orcamento.calcular(150, 0, "normal", p)  # 1 kit de 108 + 1 de 36 + 6 avulsos
        self.assertEqual((r["kits"], r["resto"], r["pago"]), (2, 6, 135 + 50 + 12))

    def test_padrao_nao_muda(self):
        self.assertEqual(orcamento.calcular(120, 0, "normal", orcamento.padrao()), orcamento.calcular(120))


class TestPixFicha(unittest.TestCase):
    def test_crc(self):
        self.assertEqual(pix._crc16("123456789"), "29B1")

    def test_payload(self):
        p = pix.payload("a@b.com", "Chelis Plácê", "São Paulo", 135)
        self.assertTrue(p.startswith("000201") and "5406135.00" in p and "CHELIS PLACE" in p)
        self.assertEqual(p[-4:], pix._crc16(p[:-4]))
        with self.assertRaises(ValueError):
            pix.payload("", "x", "y")

    def test_pdf_cobranca(self):
        pdf = pix.pdf_cobranca([[1, 0], [0, 1]], "abc", "Ana", 10)
        self.assertTrue(pdf.startswith(b"%PDF"))

    def test_ficha_pdf(self):
        from PIL import Image
        import io
        b = io.BytesIO(); Image.new("RGB", (60, 80), "red").save(b, "PNG")
        d = dict(cliente="Ana", fontes=[dict(titulo="XML", frentes=["A"] * 40, versos=[])], pago=135, conclusao="ok", modo="normal",
                 alteracoes=[dict(titulo="Troca", itens=[dict(texto="x", pedido_img="u1", usado_img="u2")])])
        pdf = ficha_pdf.gerar(d, {"u1": b.getvalue()}, [[1, 0], [0, 1]], "000201")
        self.assertTrue(pdf.startswith(b"%PDF"))

    def test_ficha(self):
        md, r = ficha.gerar("Ana", "1", [dict(titulo="XML", frentes=["A", "B"], versos=["V"])],
                            [dict(titulo="Troca", itens=[dict(texto="x", pedido_id="i1", usado_id="i2")])], "ok", "normal", None)
        self.assertIn("### Pedido: 3 slots", md)
        self.assertNotIn("![", md)
        self.assertLess(md.index("#### Conclusão"), md.index("#### Confidencial"))
        self.assertLess(md.index("### Alterações"), md.index("#### Confidencial"))


class TestImagemMontagem(Base):
    def test_redimensiona_cmyk_e_alfa(self):
        for modo, nome in (("CMYK", "c.jpg"), ("RGBA", "a.png")):
            img(self.d / nome, modo=modo, tam=(200, 270))
            out = imagem.redimensionar(self.d / nome, self.d / "o" / (nome + ".png"))
            with Image.open(out) as im:
                self.assertEqual((im.size, im.mode), ((816, 1110), "RGB"))
                self.assertAlmostEqual(im.info["dpi"][0], 300, delta=0.01)

    def test_planejar_pares_no_fim(self):
        pag = montagem.planejar([f"{i:02d}.png" for i in range(20)], pares=["fa.png", "fb.png"])
        self.assertEqual(len(pag), 2)
        self.assertEqual(pag[1][16], "fa.png")  # pares consecutivos no fim, na ordem recebida
        self.assertEqual(pag[1][17], "fb.png")
        self.assertEqual(montagem.progresso(pag), ["18/22", "22/22"])

    def test_pdf_a3(self):
        p = self.d / "s.png"
        imagem.redimensionar(self._mk(), p)
        pdfs = montagem.montar_pedido([p], self.d / "pdf", "Cliente")
        dados = pdfs[0].read_bytes()
        self.assertTrue(dados.startswith(b"%PDF"))
        self.assertIn(b"841.9", dados)

    def _mk(self):
        img(self.d / "o.png", "blue", (300, 400))
        return self.d / "o.png"

    def test_extras_depois_dos_pares_e_branco_antes(self):
        pag = montagem.planejar([f"{i:02d}.png" for i in range(17)], pares=["p1", "p2"], extras=["e1"])
        slots = pag[0] + pag[1]
        self.assertEqual(len(pag), 2)
        self.assertEqual(slots[-3:], ["p1", "p2", "e1"])       # pares e depois extras, no fim
        self.assertEqual(slots[16], "16.png")
        self.assertTrue(all(x is None for x in slots[17:33]))  # brancos ficam entre a raiz e os pares
        self.assertEqual(montagem.progresso(pag), ["17/20", "20/20"])

    def test_niveis_do_psd(self):
        im = Image.new("RGB", (3, 1))
        for x, v in enumerate((0, 255, 49)):
            im.putpixel((x, 0), (v, v, v))
        saida = montagem.aplicar_niveis(im)
        px = [saida.getpixel((x, 0)) for x in range(3)]
        self.assertEqual((px[0], px[1]), ((15, 15, 15), (255, 255, 255)))
        self.assertAlmostEqual(px[2][0], 64, delta=1)  # medido no PS: 49 -> 63,3

    def test_pdf_qualidade_100_maior_que_30(self):
        import numpy as np
        pg = Image.fromarray((np.random.default_rng(3).random((600, 400, 3)) * 255).astype("uint8"))
        a = montagem.exportar_pdf(pg, self.d / "q100.pdf")
        b = montagem.exportar_pdf(pg, self.d / "q30.pdf", qualidade=30)
        self.assertGreater(a.stat().st_size, 2 * b.stat().st_size)

    def test_ordem_dos_pares_pelo_xml(self):
        x = xml_mpc.Pedido(
            frentes=[xml_mpc.Carta("f2" * 12, [9]), xml_mpc.Carta("f1" * 12, [2])],
            versos=[xml_mpc.Carta("v2" * 12, [9]), xml_mpc.Carta("v1" * 12, [2])])
        nomes = [f"{i} ({i}).png" for i in ("v2" * 12, "f1" * 12, "v1" * 12, "f2" * 12)]
        ordem = checagem.ordem_pares(x, nomes)
        self.assertEqual([checagem.id_do_arquivo(n) for n in ordem], ["f1" * 12, "v1" * 12, "f2" * 12, "v2" * 12])

    def test_posicoes(self):
        self.assertEqual(montagem.posicao(0), (0, 0))
        self.assertEqual(montagem.posicao(17), (2222, 4143))


if __name__ == "__main__":
    unittest.main()
