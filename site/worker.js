// Roda o núcleo Python (Pyodide) fora da thread da página, para ela não travar.
const PYODIDE = "https://cdn.jsdelivr.net/pyodide/v0.27.7/full/";
let py = null;

async function iniciar(base) {
  importScripts(base || PYODIDE + "pyodide.js");
  py = await loadPyodide({ indexURL: base ? base.replace(/pyodide\.js$/, "") : PYODIDE });
  await py.loadPackage("Pillow");
  const lista = (await (await fetch("nucleo/lista.txt")).text()).split("\n").filter(Boolean);
  py.FS.mkdirTree("/app/nucleo");
  for (const nome of lista) {
    py.FS.writeFile("/app/nucleo/" + nome, await (await fetch("nucleo/" + nome)).text());
  }
  py.runPython("import sys; sys.path.insert(0, '/app')");
  py.runPython("from nucleo import web");
}

function limpar(dir) {
  if (!py.FS.analyzePath(dir).exists) return;
  for (const n of py.FS.readdir(dir)) {
    if (n === "." || n === "..") continue;
    const p = dir + "/" + n;
    py.FS.isDir(py.FS.stat(p).mode) ? (limpar(p), py.FS.rmdir(p)) : py.FS.unlink(p);
  }
}

function gravar(dir, arquivos) {
  limpar(dir);
  py.FS.mkdirTree(dir);
  for (const [nome, bytes] of arquivos) py.FS.writeFile(dir + "/" + nome, bytes);
}

const acoes = {
  async orcar({ frentes, versos, modo }) {
    py.globals.set("a", [frentes, versos, modo]);
    return JSON.parse(py.runPython("web.orcar(*a)"));
  },
  async checar({ xml, nomes }) {
    gravar("/w/pasta", nomes.map((n) => [n, new Uint8Array(0)]));
    gravar("/w/xml", [["pedido.xml", new Uint8Array(xml)]]);
    py.globals.set("a", ["/w/pasta", "/w/xml/pedido.xml", "/w/xml/faltantes.xml"]);
    const r = JSON.parse(py.runPython("web.checar(*a)"));
    const tem = py.FS.analyzePath("/w/xml/faltantes.xml").exists;
    r.faltantes_xml = tem ? py.FS.readFile("/w/xml/faltantes.xml", { encoding: "utf8" }) : null;
    return r;
  },
  async iniciar_montagem() {
    for (const d of ["/w/png", "/w/png_pares", "/w/pdf"]) { limpar(d); py.FS.mkdirTree(d); }
    return true;
  },
  // Um lote de imagens por vez, para não estourar a memória do navegador.
  async redim({ grupo, arquivos }) {
    gravar("/w/in", arquivos);
    const dest = grupo === "pares" ? "/w/png_pares" : "/w/png";
    py.globals.set("a", ["/w/in", dest]);
    py.runPython("web.redimensionar_pasta(*a)");
    limpar("/w/in");
    return true;
  },
  async montar_pdfs({ cliente }) {
    py.globals.set("a", ["/w/png", "/w/png_pares", "/w/pdf", cliente]);
    const caminhos = JSON.parse(py.runPython("web.montar(*a)"));
    return caminhos.map((c) => [c.split("/").pop(), py.FS.readFile(c)]);
  },
};

self.onmessage = async ({ data }) => {
  const { id, acao, args, base } = data;
  try {
    if (acao === "iniciar") await iniciar(base);
    const r = acao === "iniciar" ? true : await acoes[acao](args, (t) => self.postMessage({ id, progresso: t }));
    const transfer = acao === "montar_pdfs" ? r.map((x) => x[1].buffer) : [];
    self.postMessage({ id, ok: r }, transfer);
  } catch (e) {
    self.postMessage({ id, erro: String(e && e.message || e) });
  }
};
