"""Aplicativo local do bot: servidor (só em 127.0.0.1) + interface web.

Uso: python app/server.py [--dev] [--porta N] [--sem-navegador]
  --dev: usa as pastas do repositório (order/, cache/, config/) e treina o modelo em vez de ler o modelo.json pronto.
Sem --dev (o aplicativo compilado): dados em CHELIS_HOME (padrão: %LOCALAPPDATA%\\ChelisplaceBot ou ~/.chelisplace-bot)
e modelo em <dados>/modelo/modelo.json (uma atualização) ou no que veio dentro do aplicativo.
"""
import io, json, os, re, shutil, sys, threading, time, traceback, urllib.error, urllib.request, webbrowser
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, unquote, urlparse

VERSAO = "0.1"
AQUI = os.path.dirname(os.path.abspath(sys.argv[0] if getattr(sys, "frozen", False) else __file__))
BASE = getattr(sys, "_MEIPASS", None) or os.path.join(AQUI, "..")  # onde estão scripts/ e app/ (dentro do exe ou no repositório)
DEV = "--dev" in sys.argv


def pasta_dados():
    if DEV:
        return os.path.abspath(os.path.join(AQUI, ".."))
    if os.environ.get("CHELIS_HOME"):
        return os.path.abspath(os.environ["CHELIS_HOME"])
    base = os.environ.get("LOCALAPPDATA")
    return os.path.join(base, "ChelisplaceBot") if base else os.path.join(os.path.expanduser("~"), ".chelisplace-bot")


HOME = pasta_dados()
os.environ["CHELIS_HOME"] = HOME
for d in ("order", "cache", "config", "modelo", "uso"):
    os.makedirs(os.path.join(HOME, d), exist_ok=True)


def modelo_atual():
    """modelo.json mais novo: o da pasta de dados (atualização) ou o que veio no aplicativo. Em --dev: nenhum (treina)."""
    if DEV:
        return None
    for p in (os.path.join(HOME, "modelo", "modelo.json"), os.path.join(BASE, "app", "modelo", "modelo.json")):
        if os.path.exists(p):
            return p
    return None


if modelo_atual():
    os.environ["CHELIS_MODELO"] = modelo_atual()
sys.path.insert(0, os.path.join(BASE, "scripts"))
import compare as C  # noqa: E402  (precisa vir depois de CHELIS_HOME / CHELIS_MODELO)
import export_order as EX  # noqa: E402
import make_order as M  # noqa: E402

ORDER = os.path.join(HOME, "order")
WEB = os.path.join(BASE, "app", "web")
LOCK = threading.Lock()
JOBS = {}  # id -> andamento
NOME = re.compile(r"^[A-Za-z0-9_-]{1,60}$")


def agora():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def lj(path, padrao=None):
    try:
        return json.load(open(path, encoding="utf-8"))
    except (OSError, ValueError):
        return padrao


def sj(path, obj):
    tmp = path + ".tmp"
    json.dump(obj, open(tmp, "w", encoding="utf-8"), ensure_ascii=False)
    os.replace(tmp, path)


def pedido_dir(nome):
    if not NOME.match(nome or ""):
        raise ValueError("nome de pedido inválido")
    return os.path.join(ORDER, nome)


def evento(tipo, **dados):
    with LOCK, open(os.path.join(HOME, "uso", "eventos.jsonl"), "a", encoding="utf-8") as f:
        f.write(json.dumps({"t": agora(), "tipo": tipo, **dados}, ensure_ascii=False) + "\n")


# ---------- pedidos ----------
def fontes():
    if "n" not in FONTES:
        try: FONTES["n"] = sorted({x["name"] for x in M.sources().values()}, key=str.lower)
        except Exception:  # noqa: BLE001
            return []  # sem internet agora: tenta de novo na próxima
    return FONTES["n"]


FONTES = {}


def unidades(d):
    ud = os.path.join(d, "units")
    return sorted(os.path.join(ud, f) for f in os.listdir(ud) if f.endswith(".json")) if os.path.isdir(ud) else []


def listar_pedidos():
    out = []
    for n in sorted(os.listdir(ORDER)):
        d = os.path.join(ORDER, n)
        if not os.path.isdir(d) or not os.path.exists(os.path.join(d, "lista.txt")):
            continue
        dec = lj(os.path.join(d, "decisions.json"), {})
        job = JOBS.get("criar:" + n)
        linhas = sum(1 for l in open(os.path.join(d, "lista.txt"), encoding="utf-8") if l.strip())
        completo = os.path.exists(os.path.join(d, "pronto.txt")) or os.path.exists(os.path.join(d, "catalog.json"))
        out.append({"nome": n, "pronto": completo, "processando": bool(job and job["estado"] in ("fila", "rodando")), "unidades": len(unidades(d)), "linhas": linhas,
                    "cartas": (lj(os.path.join(d, "catalog.json"), {}).get("order") or {}).get("quantity"),
                    "decididas": sum(1 for v in dec.values() if v.get("status") != "pendente"), "job": job})
    return out


def catalogo_leve(nome):
    """Catálogo sem imagens embutidas, montado na hora a partir das unidades já prontas (a tela mostra as primeiras enquanto o resto processa)."""
    d = pedido_dir(nome)
    ups = unidades(d)
    if not ups:
        return None
    cards, info = M.build_catalog(ups, d, leve=True)
    for c in cards:
        c["ref"] = "/img/sf/" + c["id"]
        for k in c["cands"]:
            k["img"] = "/img/mpc/" + k["id"]
    info["sources"] = fontes()
    job = JOBS.get("criar:" + nome)
    return {"order": info, "cards": cards, "vivo": bool(job and job["estado"] in ("fila", "rodando")), "job": job}


def iniciar(nome, d):
    job = {"estado": "fila", "fase": "", "feito": 0, "total": 0, "erro": None, "inicio": agora()}
    JOBS["criar:" + nome] = job
    threading.Thread(target=rodar_pipeline, args=(nome, d, job), daemon=True).start()


def criar_pedido(nome, texto):
    d = pedido_dir(nome)
    if os.path.exists(os.path.join(d, "lista.txt")):
        raise ValueError("já existe um pedido com esse nome")
    linhas = [l.strip() for l in texto.splitlines() if re.match(r"^\d+x?\s+\S", l.strip())]
    if not linhas:
        raise ValueError("não encontrei nenhuma linha de carta (ex.: 1 Sol Ring (C21) 263)")
    os.makedirs(os.path.join(d, "units"), exist_ok=True)
    open(os.path.join(d, "lista.txt"), "w", encoding="utf-8").write("\n".join(linhas) + "\n")
    iniciar(nome, d)
    evento("pedido_criado", pedido=nome, linhas=len(linhas))


def rodar_pipeline(nome, d, job):
    with LOCK2:  # um pedido por vez: o andamento do pipeline é global
        job["estado"] = "rodando"
        def prog(fase, feito, total):
            job.update(fase=fase, feito=feito, total=total)
        M.PROGRESS = prog
        if C.MODELO is None and modelo_atual():
            C.MODELO = modelo_atual()
        try:
            M.main(os.path.join(d, "lista.txt"), d, catalogo=False)
            open(os.path.join(d, "pronto.txt"), "w").write(agora()); job["estado"] = "pronto"
        except Exception as e:  # noqa: BLE001
            job.update(estado="erro", erro=f"{type(e).__name__}: {e}")
            open(os.path.join(d, "erro.txt"), "w").write(traceback.format_exc())
        finally:
            M.PROGRESS = lambda *a: None


LOCK2 = threading.Lock()


# ---------- decisões, uploaders, XML ----------
def decisoes(nome):
    return lj(os.path.join(pedido_dir(nome), "decisions.json"), {})


def gravar_decisao(nome, pid, doc):
    p = os.path.join(pedido_dir(nome), "decisions.json")
    with LOCK:
        D = lj(p, {})
        if doc is None:
            D.pop(pid, None)
        else:
            D[pid] = {**doc, "at": agora()}
        sj(p, D)


def uploaders():
    return lj(os.path.join(HOME, "config", "uploaders.json"), {"trusted": []})


def gerar_xml(nome, conferido):
    d = pedido_dir(nome)
    cards, _ = M.build_catalog(unidades(d), d, leve=True)
    r = EX.montar(d, decisoes(nome), conferido, cards)
    evento("xml_gerado", pedido=nome, usadas=r["usadas"], em_lote=r["em_lote"])
    return {k: v for k, v in r.items() if k != "xml"}


# ---------- baixar as imagens do XML ----------
def baixar_imagens(nome, destino):
    import xml.etree.ElementTree as ET
    d = pedido_dir(nome)
    xml_path = os.path.join(d, "pedido.xml")
    if not os.path.exists(xml_path):
        raise ValueError("gere o XML antes")
    destino = os.path.abspath(destino or os.path.join(d, "imagens"))
    os.makedirs(destino, exist_ok=True)
    cards = []
    for sec in ET.parse(xml_path).getroot():
        if sec.tag in ("fronts", "backs"):
            cards += [(c.find("id").text, c.find("name").text) for c in sec]
    job = {"estado": "rodando", "fase": "baixando", "feito": 0, "total": len(cards), "erro": None, "pasta": destino, "falhas": [], "inicio": agora()}
    JOBS["baixar:" + nome] = job

    def run():
        shutil.copy(xml_path, os.path.join(destino, "pedido.xml"))
        usados = {}
        for i, (cid, nm) in enumerate(cards):
            nm = re.sub(r'[<>:"/\\|?*]', "_", nm or cid)
            if nm.lower() in usados and usados[nm.lower()] != cid:  # mesmo nome, arte diferente
                base, ext = os.path.splitext(nm); nm = f"{base} [{cid[:6]}]{ext}"
            usados[nm.lower()] = cid
            alvo = os.path.join(destino, nm)
            job["feito"] = i
            if os.path.exists(alvo) and os.path.getsize(alvo) > 1000:
                continue
            ok = False
            for tentativa in range(3):
                try:
                    req = urllib.request.Request(f"https://drive.google.com/uc?export=download&id={cid}", headers=M.UA)
                    with urllib.request.urlopen(req, timeout=90) as r:
                        if "text/html" in (r.headers.get("Content-Type") or ""):
                            raise RuntimeError("o Drive devolveu uma página em vez do arquivo")
                        dados = r.read()
                    open(alvo + ".part", "wb").write(dados); os.replace(alvo + ".part", alvo); ok = True; break
                except Exception:  # noqa: BLE001
                    time.sleep(3 * (tentativa + 1))
            if not ok:
                job["falhas"].append(nm)
            time.sleep(0.6)  # um de cada vez e com pausa: o Drive limita pedidos em sequência
        job.update(feito=len(cards), estado="pronto")
    threading.Thread(target=run, daemon=True).start()


# ---------- exportar os usos (para o bot aprender por aqui) ----------
def exportar_usos():
    pedidos = []
    for p in listar_pedidos():
        d = os.path.join(ORDER, p["nome"])
        unidades = {f[:-5]: lj(os.path.join(d, "units", f)) for f in os.listdir(os.path.join(d, "units")) if f.endswith(".json")}
        for u in unidades.values():
            u.pop("refp", None)  # caminho do computador do usuário: sem valor aqui
        pedidos.append({"nome": p["nome"], "lista": open(os.path.join(d, "lista.txt"), encoding="utf-8").read(), "decisoes": lj(os.path.join(d, "decisions.json"), {}),
                        "gabarito": lj(os.path.join(d, "gabarito.json")), "model": (open(os.path.join(d, "model.txt")).read().strip() if os.path.exists(os.path.join(d, "model.txt")) else None),
                        "unidades": unidades})
    ev = []
    pe = os.path.join(HOME, "uso", "eventos.jsonl")
    if os.path.exists(pe):
        ev = [json.loads(l) for l in open(pe, encoding="utf-8") if l.strip()]
    return {"formato": 1, "app": VERSAO, "modelo": (lj(modelo_atual()) or {}).get("key") if modelo_atual() else "dev", "exportado_em": agora(),
            "uploaders": uploaders(), "pedidos": pedidos, "eventos": ev}


# ---------- HTTP ----------
TIPOS = {".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json", ".png": "image/png",
         ".jpg": "image/jpeg", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".woff2": "font/woff2"}


class H(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):
        pass

    def enviar(self, status, corpo, tipo="application/json", extra=None):
        if not isinstance(corpo, (bytes, bytearray)):
            corpo = json.dumps(corpo, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", tipo); self.send_header("Content-Length", str(len(corpo))); self.send_header("Cache-Control", "no-store")
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.end_headers(); self.wfile.write(corpo)

    def arquivo(self, caminho, cache=False):
        if not os.path.isfile(caminho):
            return self.enviar(404, {"erro": "não encontrado"})
        corpo = open(caminho, "rb").read()
        self.enviar(200, corpo, TIPOS.get(os.path.splitext(caminho)[1].lower(), "application/octet-stream"), {"Cache-Control": "max-age=86400"} if cache else None)

    def corpo(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n) or b"{}") if n else {}

    def tratar(self, metodo):
        u = urlparse(self.path); p = unquote(u.path); q = parse_qs(u.query)
        try:
            if metodo == "GET" and not p.startswith(("/api/", "/img/")):
                rel = "index.html" if p == "/" else p.lstrip("/")
                alvo = os.path.normpath(os.path.join(WEB, rel))
                if not alvo.startswith(os.path.normpath(WEB)):
                    return self.enviar(403, {"erro": "caminho inválido"})
                return self.arquivo(alvo)
            m = re.match(r"^/img/(mpc|sf)/([A-Za-z0-9_.-]+)$", p)
            if m and metodo == "GET":
                pre = "mpc_" if m.group(1) == "mpc" else "sf_"
                return self.arquivo(os.path.join(HOME, "cache", f"{pre}{m.group(2)}.jpg"), cache=True)
            if p == "/api/estado" and metodo == "GET":
                return self.enviar(200, {"versao": VERSAO, "dados": HOME, "modelo": modelo_atual() or "treino local (dev)", "uploaders": uploaders()})
            if p == "/api/pedidos":
                if metodo == "GET":
                    return self.enviar(200, listar_pedidos())
                b = self.corpo(); criar_pedido(b.get("nome", ""), b.get("lista", ""))
                return self.enviar(200, {"ok": True})
            m = re.match(r"^/api/pedidos/([^/]+)/(catalogo|decisoes|xml|baixar|andamento|continuar)(?:/(.+))?$", p)
            if m:
                nome, acao, extra = m.groups()
                if acao == "catalogo":
                    c = catalogo_leve(nome)
                    return self.enviar(200 if c else 404, c or {"erro": "pedido ainda não está pronto"})
                if acao == "continuar" and metodo == "POST":
                    if (JOBS.get("criar:" + nome) or {}).get("estado") in ("fila", "rodando"):
                        return self.enviar(200, {"ok": True})
                    iniciar(nome, pedido_dir(nome)); return self.enviar(200, {"ok": True})
                if acao == "andamento":
                    return self.enviar(200, JOBS.get("criar:" + nome) or {"estado": "sem andamento"})
                if acao == "decisoes":
                    if metodo == "GET":
                        return self.enviar(200, decisoes(nome))
                    if metodo == "PUT":
                        gravar_decisao(nome, extra, self.corpo()); return self.enviar(200, {"ok": True})
                    if metodo == "DELETE":
                        gravar_decisao(nome, extra, None); return self.enviar(200, {"ok": True})
                if acao == "xml":
                    if metodo == "POST":
                        return self.enviar(200, gerar_xml(nome, bool(self.corpo().get("conferido"))))
                    return self.arquivo(os.path.join(pedido_dir(nome), "pedido.xml"))
                if acao == "baixar":
                    if metodo == "POST":
                        baixar_imagens(nome, self.corpo().get("pasta")); return self.enviar(200, {"ok": True})
                    return self.enviar(200, JOBS.get("baixar:" + nome) or {"estado": "sem andamento"})
            if p == "/api/uploaders":
                if metodo == "GET":
                    return self.enviar(200, uploaders())
                b = self.corpo(); sj(os.path.join(HOME, "config", "uploaders.json"), {"trusted": sorted({str(x) for x in b.get("trusted", [])})})
                evento("uploaders", trusted=b.get("trusted", []))
                return self.enviar(200, {"ok": True})
            if p == "/api/evento" and metodo == "POST":
                b = self.corpo(); evento(str(b.pop("tipo", "evento"))[:40], **{k: v for k, v in b.items() if isinstance(v, (str, int, float, bool, list, type(None)))})
                return self.enviar(200, {"ok": True})
            if p == "/api/usos" and metodo == "GET":
                nome = f"usos_{datetime.now().strftime('%Y%m%d_%H%M')}.json"
                return self.enviar(200, json.dumps(exportar_usos(), ensure_ascii=False).encode(), "application/json", {"Content-Disposition": f'attachment; filename="{nome}"'})
            if p == "/api/modelo" and metodo == "POST":
                b = self.corpo()
                if not all(k in b for k in ("key", "modelos", "calibracao")):
                    return self.enviar(400, {"erro": "arquivo de modelo inválido"})
                sj(os.path.join(HOME, "modelo", "modelo.json"), b); C.MODELO = os.path.join(HOME, "modelo", "modelo.json")
                return self.enviar(200, {"ok": True, "key": b["key"]})
            self.enviar(404, {"erro": "rota desconhecida"})
        except ValueError as e:
            self.enviar(400, {"erro": str(e)})
        except Exception as e:  # noqa: BLE001
            self.enviar(500, {"erro": f"{type(e).__name__}: {e}"})

    def do_GET(self): self.tratar("GET")
    def do_POST(self): self.tratar("POST")
    def do_PUT(self): self.tratar("PUT")
    def do_DELETE(self): self.tratar("DELETE")


def selftest():
    """Usado pela compilação: confere que o OCR, o modelo e a interface vieram dentro do aplicativo."""
    from PIL import Image, ImageDraw
    assert os.path.isfile(os.path.join(WEB, "index.html")), "interface não encontrada"
    ms = M.models(); assert len(ms) == 2, "modelo inválido"
    im = Image.new("RGB", (200, 60), "white"); ImageDraw.Draw(im).text((10, 20), "TEST 123", fill="black"); p = os.path.join(HOME, "cache", "selftest.png"); im.save(p)
    C.ocr_footer(p, "selftest"); print("selftest ok: modelo", (lj(modelo_atual()) or {}).get("key"), flush=True)


def main():
    if "--selftest" in sys.argv:
        return selftest()
    porta = int(sys.argv[sys.argv.index("--porta") + 1]) if "--porta" in sys.argv else 0
    srv = ThreadingHTTPServer(("127.0.0.1", porta), H)
    url = f"http://127.0.0.1:{srv.server_address[1]}/"
    print("Bot Chelisplace", VERSAO, "-", url, "- dados em", HOME, flush=True)
    if "--sem-navegador" not in sys.argv:
        threading.Timer(0.8, lambda: webbrowser.open(url)).start()
    try:
        srv.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
