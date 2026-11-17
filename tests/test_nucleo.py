import tempfile
import unittest
from pathlib import Path

from PIL import Image

from nucleo import checagem, ficha, ficha_pdf, sangria, imagem, montagem, orcamento, pix, xml_mpc

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


class TestSangria(Base):
    def _carta(self, nome, canto_transp=True, caixa=True):
        import numpy as np
        a = np.zeros((140, 100, 4), np.uint8); a[:, :, :3] = (30, 90, 160); a[:, :, 3] = 255
        a[:, :, :3][:6, :6] = (250, 250, 250)  # RGB claro escondido no canto
        if canto_transp:
            a[:6, :6, 3] = 0; a[-6:, -6:, 3] = 0   # cantos externos transparentes
        if caixa:
            a[60:80, 20:80, :3] = 0; a[60:80, 20:80, 3] = 120  # caixa semitransparente interna
        Image.fromarray(a, "RGBA").save(self.d / nome)
        return self.d / nome

    def test_borda_preenche_cantos_e_mantem_transparencia_interna(self):
        img = sangria.corrigir(self._carta("a.png"))
        self.assertEqual(img.size, (816, 1110))
        self.assertEqual(img.getpixel((0, 0))[3], 255)                 # canto externo opaco
        self.assertNotEqual(img.getpixel((40, 40))[:3], (250, 250, 250))  # sem cinza/branco escondido
        meio = img.getpixel((408, 555))
        self.assertTrue(any(x < 255 for x in [meio[3]]) or meio[3] == 255)
        interno = img.getpixel((36 + 372, 35 + 520))  # dentro da caixa (60..80 de 140 ≈ 445..594 de 1040)
        self.assertLess(interno[3], 255)

    def test_branco_e_preto(self):
        b = sangria.corrigir(self._carta("b.png"), "branco")
        self.assertEqual(b.getpixel((0, 0)), (255, 255, 255, 255))
        self.assertEqual(b.getpixel((815, 1109)), (255, 255, 255, 255))   # sangria branca (constante)
        p = sangria.corrigir(self._carta("c.png", canto_transp=False, caixa=False), "preto")
        self.assertEqual(p.size, (816, 1110))

    def test_salvar_com_dpi_e_previa(self):
        img = sangria.corrigir(self._carta("d.png"))
        saida = sangria.salvar(img, self.d / "o" / "d.png")
        with Image.open(saida) as im:
            self.assertEqual((im.size, im.mode), ((816, 1110), "RGBA"))
            self.assertAlmostEqual(im.info["dpi"][0], 299.9994, delta=0.01)
        self.assertTrue(sangria.previa((self.d / "d.png").read_bytes(), img).startswith(b"\x89PNG"))
        with self.assertRaises(ValueError):
            sangria.corrigir(self.d / "d.png", "azul")


class TestVersoPadrao(Base):
    def _xml(self):
        fr = "".join(f"<card><id>{'F%02d' % i + 'x' * 22}</id><slots>{i}</slots><name>C{i}.png</name></card>" for i in range(10))
        padrao = "<card><id>" + "P" * 25 + "</id><slots>" + ",".join(str(i) for i in range(10)) + "</slots><name>Back.png</name></card>"
        dfc = "<card><id>" + "V" * 25 + "</id><slots>3</slots><name>Verso DFC.png</name></card>"
        (self.d / "x.xml").write_text(f"<order><fronts>{fr}</fronts><backs>{padrao}{dfc}</backs><cardback>{'Z' * 25}</cardback></order>")
        return xml_mpc.ler(self.d / "x.xml")

    def test_xml_com_varios_cardback(self):
        (self.d / "m.xml").write_text("<order><fronts><card><id>" + "a" * 25 + "</id><slots>0</slots><name>A</name></card></fronts><backs/><cardback>" + "p" * 25 + "</cardback><cardback>" + "q" * 25 + "</cardback></order>")
        ped = xml_mpc.ler(self.d / "m.xml")
        self.assertEqual(xml_mpc.versos_padrao(ped), {"p" * 25, "q" * 25})
        xml_mpc.escrever(ped, self.d / "m2.xml")
        self.assertEqual(xml_mpc.versos_padrao(xml_mpc.ler(self.d / "m2.xml")), {"p" * 25, "q" * 25})

    def test_verso_compartilhado_por_poucas_cartas_diferentes(self):
        # 33 frentes; um verso em 14 delas (cartas diferentes) = verso padrão, mesmo sem chegar à metade do pedido
        fr = "".join(f"<card><id>{'F%02d' % i + 'x' * 22}</id><slots>{i}</slots><name>C{i}</name></card>" for i in list(range(20)) + list(range(26, 33)))
        fr += "<card><id>" + "D" * 25 + "</id><slots>20,21,22,23,24,25</slots><name>DFC</name></card>"  # a mesma carta, 6 cópias
        pad = "<card><id>" + "P" * 25 + "</id><slots>" + ",".join(str(i) for i in range(14)) + "</slots><name>Proxy Playtest Copy.jpg</name></card>"
        dfc = "<card><id>" + "V" * 25 + "</id><slots>20,21,22,23,24,25</slots><name>DFC x6</name></card>"  # 6 cópias da MESMA carta: não é padrão
        (self.d / "c.xml").write_text(f"<order><fronts>{fr}</fronts><backs>{pad}{dfc}</backs><cardback>{'Z' * 25}</cardback></order>")
        ped = xml_mpc.ler(self.d / "c.xml")
        self.assertIn("P" * 25, xml_mpc.versos_padrao(ped))
        self.assertNotIn("V" * 25, xml_mpc.versos_padrao(ped))

    def test_detecta_o_verso_repetido(self):
        ped = self._xml()
        self.assertEqual(xml_mpc.versos_padrao(ped), {"Z" * 25, "P" * 25})

    def test_nao_conta_nem_exige_o_padrao_mas_conta_o_dfc(self):
        ped = self._xml()
        exig, _ = checagem.exigido(ped)
        self.assertNotIn("P" * 25, exig)
        self.assertEqual(exig["V" * 25], 1)
        self.assertEqual(sum(exig.values()), 11)  # 10 frentes + 1 verso de dupla-face
        self.assertEqual(checagem.pares(ped), [("F03" + "x" * 22, "V" * 25)])


class TestOrcamentoEditavel(unittest.TestCase):
    def test_kits_e_avulso_editados(self):
        p = dict(kits=[dict(slots=108, preco=135), dict(slots=36, preco=50)], avulso=2.0)
        r = orcamento.calcular(150, 0, "normal", p)  # 1 kit de 108 + 1 de 36 + 6 avulsos
        self.assertEqual((r["kits"], r["resto"], r["pago"]), (2, 6, 135 + 50 + 12))

    def test_divisao_automatica_com_kit_final(self):
        p = dict(kits=[dict(slots=18, preco=30), dict(slots=108, preco=135), dict(slots=72, preco=120)], avulso=30 / 18)
        r = orcamento.calcular(194, 0, "normal", p)  # 108 + 72 + 14 que sobram
        self.assertEqual([(u["slots"], u["qtd"]) for u in r["usados"]], [(108, 1), (72, 1)])
        self.assertEqual(r["kit_final"], dict(slots=14, kit=None, qtd=1, preco=23))  # sem a opção, o resto sai pelo avulso
        self.assertEqual(r["pago"], 135 + 120 + 23)
        r3 = orcamento.calcular(194, 0, "normal", {**p, "resto_em_kit": True})  # com a opção, vira 1 kit de 18
        self.assertEqual(r3["kit_final"], dict(slots=14, kit=18, qtd=1, preco=30))
        self.assertEqual((r3["pago"], r3["paginas"]), (135 + 120 + 30, 11))
        self.assertEqual(orcamento.calcular(109, 0, "normal", {**p, "resto_em_kit": True})["pago"], 135 + 30)  # sobrou 1 slot → kit de 18
        self.assertEqual(r["paginas"], 11)
        r2 = orcamento.calcular(90, 0, "normal", p)  # 72 + 18, nada sobra
        self.assertEqual((r2["kit_final"], r2["pago"]), (None, 150))

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
        import io
        from PIL import Image
        b = io.BytesIO(); Image.new("RGB", (60, 80), "red").save(b, "PNG")
        md, _ = ficha.gerar("Ana", "1", [dict(titulo="XML → X", frentes=["A"] * 60, versos=[])],
                            [dict(titulo="Troca", itens=[dict(texto="Sol Ring")])], "Conclusão ã", "normal", None, "chave-pix")
        pdf = ficha_pdf.gerar(md, {"u1": b.getvalue()}, {"Sol Ring": ["u1", "u2"]}, [[1, 0], [0, 1]])
        self.assertTrue(pdf.startswith(b"%PDF"))
        self.assertGreater(pdf.count(b"/Type /Page\n") + pdf.count(b"/Type /Page "), 1)  # 60 itens passam de uma página

    def test_ficha_com_raciocinio_do_preco_e_pdf_com_valor(self):
        p = dict(kits=[dict(slots=108, preco=135), dict(slots=72, preco=120), dict(slots=18, preco=30)], avulso=30 / 18, resto_em_kit=True)
        md, r = ficha.gerar("X", "1", [dict(titulo="t", frentes=["A"] * 191, versos=["V"] * 3)], [], "", "normal", p, "chave", 285, dict(slot=1.25, pct=10))
        conf = md.split("#### Confidencial")[1]
        for trecho in ("1 × kit de 108 slots (6 pág.) = 135", "1 × kit de 72 slots (4 pág.) = 120", "1 × kit final de 18 slots (sobraram 14) = 30",
                       "Valor da tabela = 285", "Todos os slots a 1,25: 194x1,25 = 243", "Desconto de 10% sobre o pedido (28,5 → 29): 256 (lucro 77)", "Lucro: 285-154-25 = 106"):
            self.assertIn(trecho, conf)
        md2, _ = ficha.gerar("X", "1", [dict(titulo="t", frentes=["A"] * 172)], [], "", "normal", p, "chave", 243, dict(slot=1.25, pct=10))
        self.assertIn("3 × kit de 18 slots (3 pág.) = 90", md2)
        self.assertIn("Valor cobrado = 243 (desconto de 12 sobre a tabela)", md2)
        # o PDF mostra o valor, mas nada do bloco confidencial
        import re, io
        from nucleo import ficha_pdf
        vistos = []
        orig = ficha_pdf._Folha.linha
        ficha_pdf._Folha.linha = lambda self, texto, *a, **k: (vistos.append(texto), orig(self, texto, *a, **k))[1]
        try:
            ficha_pdf.gerar(md, {}, {}, [[1, 0], [0, 1]])
        finally:
            ficha_pdf._Folha.linha = orig
        self.assertIn("Valor do pedido: 285 reais", vistos)
        self.assertNotIn("Confidencial", vistos)
        self.assertFalse(any("kit" in v or "Lucro" in v or "Descontos" in v for v in vistos))

    def test_pedidos_juntos_completam_kits(self):
        p = dict(kits=[dict(slots=108, preco=135), dict(slots=72, preco=120), dict(slots=18, preco=30)], avulso=30 / 18, resto_em_kit=True)
        md, r = ficha.gerar("Renato", "1", [dict(titulo="Chris novas", frentes=["A"] * 171, versos=["V"]), dict(titulo="iggor", frentes=["B"] * 191, versos=["V"] * 3)],
                            [], "", "normal", p, "k", None, dict(slot=1.25, pct=10))
        self.assertEqual(r["pago"], 495)
        conf = md.split("#### Confidencial")[1]
        self.assertIn("Chris novas (172 slots) sozinho = 255", conf)
        self.assertIn("iggor (194 slots) sozinho = 285", conf)
        self.assertIn("Soma separados = 540; juntos (366 slots) = 495; economia = 45", conf)
        self.assertIn("3 × kit de 108 slots (18 pág.) = 405", conf)

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
