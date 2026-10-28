import tempfile
import unittest
from pathlib import Path

from PIL import Image

from nucleo import checagem, imagem, montagem, orcamento, xml_mpc

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
        self.assertEqual(pag[1][17], "fa.png")
        self.assertEqual(pag[1][16], "fb.png")
        self.assertEqual(montagem.progresso(pag), ["018/022", "022/022"])

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

    def test_posicoes(self):
        self.assertEqual(montagem.posicao(0), (0, 0))
        self.assertEqual(montagem.posicao(17), (2222, 4143))


if __name__ == "__main__":
    unittest.main()
