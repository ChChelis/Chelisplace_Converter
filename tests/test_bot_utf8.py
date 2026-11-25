"""Windows abre arquivo de texto com cp1252 quando o código não diz o contrário; um byte como 0x8f (parte de 'Ï') derrubava
o pedido novo na leitura dos gabaritos antigos. Aqui o mesmo erro é reproduzido forçando um locale sem UTF-8."""
import json, os, subprocess, sys, tempfile, unittest

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCRIPT = r"""
import json, os, sys
sys.path.insert(0, os.path.join(sys.argv[1], "scripts"))
import make_order as M
M.ROOT = sys.argv[2]
mem = M.memory()
assert mem[("dsk", "118", 0)] == ["abc"], mem
print("ok")
"""


class TestBotUtf8(unittest.TestCase):
    def test_memory_le_gabarito_com_acentos_sem_utf8_no_sistema(self):
        with tempfile.TemporaryDirectory() as t:
            ped = os.path.join(t, "order", "antigo")
            os.makedirs(os.path.join(ped, "units"))
            # "Ï" em UTF-8 = C3 8F: o byte 0x8f não existe em cp1252 (nem em ASCII)
            json.dump({"u1": {"status": "ok", "accept_ids": ["abc"], "nota": "Ïnvocação – ação"}}, open(os.path.join(ped, "gabarito.json"), "w", encoding="utf-8"), ensure_ascii=False)
            json.dump({"set": "DSK", "cn": "118", "face": 0}, open(os.path.join(ped, "units", "u1.json"), "w", encoding="utf-8"), ensure_ascii=False)
            env = {**os.environ, "LC_ALL": "C", "LANG": "C", "PYTHONCOERCECLOCALE": "0", "PYTHONUTF8": "0"}
            r = subprocess.run([sys.executable, "-X", "utf8=0", "-c", SCRIPT, RAIZ, t], env=env, capture_output=True, text=True, timeout=120)
            self.assertEqual(r.returncode, 0, r.stderr[-800:])
            self.assertIn("ok", r.stdout)

    def test_nenhum_open_de_texto_sem_encoding_no_bot(self):
        import ast
        ruins = []
        for caminho in ("app/server.py", "scripts/make_order.py", "scripts/calibrate.py", "scripts/compare.py", "scripts/deck_parse.py"):
            arv = ast.parse(open(os.path.join(RAIZ, caminho), encoding="utf-8").read())
            for n in ast.walk(arv):
                if isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id == "open" and not any(k.arg == "encoding" for k in n.keywords):
                    modo = n.args[1].value if len(n.args) > 1 and isinstance(n.args[1], ast.Constant) else ""
                    if "b" not in str(modo):
                        ruins.append(f"{caminho}:{n.lineno}")
        self.assertEqual(ruins, [], "open() de texto sem encoding='utf-8'")


if __name__ == "__main__":
    unittest.main()
