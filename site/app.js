"use strict";
const $ = (s) => document.querySelector(s);
const IMG = /\.(jpe?g|png|webp)$/i;
const fmt = (n) => n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const reais = (n) => "R$ " + fmt(n);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

// ---------- motor Python (worker) ----------
const worker = new Worker("worker.js");
let seq = 0;
const pendentes = new Map();
worker.onmessage = ({ data }) => {
  const p = pendentes.get(data.id);
  if (!p) return;
  if (data.progresso) return p.prog && p.prog(data.progresso);
  pendentes.delete(data.id);
  data.erro ? p.rej(new Error(data.erro)) : p.res(data.ok);
};
function chamar(acao, args, prog, extra = {}) {
  return new Promise((res, rej) => {
    const id = ++seq;
    pendentes.set(id, { res, rej, prog });
    worker.postMessage({ id, acao, args, ...extra });
  });
}
const pronto = chamar("iniciar", null, null, { base: new URLSearchParams(location.search).get("pyodide") })
  .then(() => { $("#estado").textContent = "Pronto"; })
  .catch((e) => { $("#estado").textContent = "Erro ao carregar o motor: " + e.message; throw e; });

// ---------- abas ----------
document.querySelectorAll("nav button").forEach((b) => b.addEventListener("click", () => {
  document.querySelectorAll("nav button").forEach((x) => x.setAttribute("aria-selected", x === b));
  document.querySelectorAll("main > section").forEach((s) => (s.hidden = s.id !== b.dataset.aba));
}));

// ---------- pasta ----------
// Devolve {nome, handle, raiz:[{nome, ler()}], pares:[...]}; handle só existe onde o navegador deixa gravar.
async function escolherPasta() {
  if (window.showDirectoryPicker) {
    const handle = await showDirectoryPicker({ mode: "readwrite" });
    const raiz = [], pares = [];
    for await (const [nome, h] of handle.entries()) {
      if (h.kind === "file" && IMG.test(nome)) raiz.push({ nome, ler: () => h.getFile() });
      if (h.kind === "directory" && nome.toLowerCase() === "pares") {
        for await (const [n2, h2] of h.entries()) if (h2.kind === "file" && IMG.test(n2)) pares.push({ nome: n2, ler: () => h2.getFile() });
      }
    }
    return { nome: handle.name, handle, raiz, pares };
  }
  return new Promise((res, rej) => {
    const inp = document.createElement("input");
    inp.type = "file"; inp.webkitdirectory = true;
    inp.onchange = () => {
      const raiz = [], pares = [];
      for (const f of inp.files) {
        const partes = f.webkitRelativePath.split("/");
        if (!IMG.test(f.name)) continue;
        const item = { nome: f.name, ler: async () => f };
        if (partes.length === 2) raiz.push(item);
        else if (partes.length === 3 && partes[1].toLowerCase() === "pares") pares.push(item);
      }
      inp.files.length ? res({ nome: (inp.files[0].webkitRelativePath || "").split("/")[0], handle: null, raiz, pares }) : rej(new Error("cancelado"));
    };
    inp.click();
  });
}

// confirmação dentro da página (sem pop-ups nativos)
function confirmar(onde, texto, fazer) {
  const c = document.createElement("div");
  c.className = "conf";
  c.innerHTML = `<div>${esc(texto)}</div>`;
  const sim = Object.assign(document.createElement("button"), { className: "acao", textContent: "Sim, fazer" });
  const nao = Object.assign(document.createElement("button"), { className: "acao sec", textContent: "Cancelar" });
  nao.onclick = () => c.remove();
  sim.onclick = async () => { sim.disabled = nao.disabled = true; try { c.innerHTML = esc(await fazer()); } catch (e) { c.innerHTML = `<span class="alerta">${esc(e.message)}</span>`; } };
  c.append(sim, nao);
  onde.append(c);
}

// ---------- orçamento ----------
const ORC = ["#o-frentes", "#o-versos", "#o-modo"];
async function orcar() {
  await pronto;
  const r = await chamar("orcar", { frentes: +$("#o-frentes").value || 0, versos: +$("#o-versos").value || 0, modo: $("#o-modo").value });
  $("#o-tabela").innerHTML = [
    ["Slots (frentes + versos)", r.slots], ["Páginas A3", r.paginas], ["Kits fechados", r.kits], ["Slots avulsos", r.resto],
    ["Valor do pedido", reais(r.pago)], ["Custo de impressão", reais(r.impressao)], ["Custo de colagem", reais(r.colagem)], ["Lucro", reais(r.lucro)],
  ].map(([k, v]) => `<tr><td>${k}</td><td class="n">${v}</td></tr>`).join("");
}
ORC.forEach((s) => $(s).addEventListener("input", orcar));
orcar();

// ---------- checagem ----------
let chk = { pasta: null, xml: null };
const chkPronto = () => ($("#c-rodar").disabled = !(chk.pasta && chk.xml));
$("#c-xml").addEventListener("change", async (e) => { chk.xml = e.target.files[0] ? await e.target.files[0].arrayBuffer() : null; chkPronto(); });
$("#c-pasta").addEventListener("click", async () => {
  try { chk.pasta = await escolherPasta(); $("#c-pasta-nome").textContent = `${chk.pasta.nome}: ${chk.pasta.raiz.length + chk.pasta.pares.length} imagens`; } catch (e) { return; }
  chkPronto();
});
const lista = (itens, f) => (itens.length ? `<ul>${itens.map((i) => `<li>${f(i)}</li>`).join("")}</ul>` : "");

$("#c-rodar").addEventListener("click", async () => {
  const alvo = $("#c-resultado");
  alvo.textContent = "Conferindo…";
  await pronto;
  const nomes = [...chk.pasta.raiz, ...chk.pasta.pares].map((x) => x.nome);
  let r;
  try { r = await chamar("checar", { xml: chk.xml.slice(0), nomes }); } catch (e) { alvo.innerHTML = `<p class="alerta">${esc(e.message)}</p>`; return; }
  const secao = (t, cls, itens, f) => (itens.length ? `<h3 class="${cls}">${t} (${itens.length})</h3>${lista(itens, f)}` : "");
  alvo.innerHTML =
    `<p><b>${r.total}</b> unidades no XML. ` + (r.ok ? `<span class="ok">Tudo certo: nada falta, nada sobra.</span>` : `<span class="alerta">Há pendências.</span>`) + `</p>` +
    secao("Faltando baixar", "alerta", r.faltando, ([n, q]) => `${esc(n)} × ${q}`) +
    secao("A duplicar (o XML pede mais cópias)", "aviso", r.a_duplicar, ([n, q]) => `${esc(n)}: faltam ${q} cópia(s)`) +
    secao("Cópias a mais", "aviso", r.excesso, ([n, q]) => `${esc(n)}: ${q} a mais`) +
    secao("Fora da lista do XML", "aviso", r.fora_da_lista, esc) +
    secao("Sem ID no nome", "aviso", r.sem_id, esc) +
    secao("Verso padrão na pasta (não entra na montagem)", "suave", r.verso_padrao, esc) +
    secao("Pares dupla face incompletos", "alerta", r.pares_incompletos, ([f, v]) => `${esc(f)} / ${esc(v)}`) +
    `<div id="c-acoes"></div>`;
  const acoes = $("#c-acoes");
  const botao = (texto, fn, sec) => { const b = Object.assign(document.createElement("button"), { className: "acao" + (sec ? " sec" : ""), textContent: texto }); b.onclick = fn; acoes.append(b); };
  if (r.faltantes_xml) botao("Baixar XML dos faltantes", () => baixar(new Blob([r.faltantes_xml], { type: "application/xml" }), "faltantes.xml").click(), true);
  if (chk.pasta.handle && r.duplicar.length) botao(`Criar ${r.duplicar.length} cópia(s)`, () => confirmar(acoes, `Criar ${r.duplicar.length} arquivo(s) novos na pasta? Nenhum arquivo existente é alterado.`, async () => {
    for (const [orig, dest] of r.duplicar) {
      const f = await (await chk.pasta.handle.getFileHandle(orig)).getFile();
      const w = await (await chk.pasta.handle.getFileHandle(dest, { create: true })).createWritable();
      await w.write(f); await w.close();
    }
    return `${r.duplicar.length} cópia(s) criada(s). Confira de novo.`;
  }));
  if (chk.pasta.handle && r.pares.length) botao(`Mover ${r.pares.length} par(es) para pares/`, () => confirmar(acoes, `Mover ${r.pares.length * 2} arquivo(s) da pasta do pedido para a subpasta pares/?`, async () => {
    const dir = await chk.pasta.handle.getDirectoryHandle("pares", { create: true });
    for (const nome of r.pares.flat()) {
      let origem; try { origem = await chk.pasta.handle.getFileHandle(nome); } catch { continue; }
      const w = await (await dir.getFileHandle(nome, { create: true })).createWritable();
      await w.write(await origem.getFile()); await w.close();
      await chk.pasta.handle.removeEntry(nome);
    }
    return "Pares movidos. Confira de novo.";
  }), true);
  if (!chk.pasta.handle && (r.duplicar.length || r.pares.length)) acoes.insertAdjacentHTML("beforeend", `<p class="suave">Para criar cópias e mover pares, use Chrome ou Edge (o navegador precisa deixar gravar na pasta).</p>`);
});

function baixar(blob, nome) {
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: nome, className: "baixar", textContent: "Baixar " + nome });
  return a;
}

// ---------- montagem ----------
let mon = { pasta: null };
$("#m-pasta").addEventListener("click", async () => {
  try { mon.pasta = await escolherPasta(); } catch { return; }
  await pronto;
  const p = mon.pasta;
  $("#m-pasta-nome").textContent = `${p.nome}: ${p.raiz.length} imagens + ${p.pares.length} em pares`;
  $("#m-plano").textContent = `${Math.ceil((p.raiz.length + p.pares.length) / 18)} página(s) A3 de 18 cartas.`;
  $("#m-rodar").disabled = !p.raiz.length;
});
$("#m-rodar").addEventListener("click", async () => {
  const p = mon.pasta, cliente = $("#m-cliente").value.trim() || "Pedido";
  const barra = $("#m-barra"), prog = barra.firstElementChild, status = $("#m-status"), saida = $("#m-saida");
  $("#m-rodar").disabled = true; barra.hidden = false; saida.innerHTML = "";
  const total = p.raiz.length + p.pares.length;
  let feitas = 0;
  try {
    await chamar("iniciar_montagem");
    for (const [grupo, itens] of [["raiz", p.raiz], ["pares", p.pares]]) {
      for (let i = 0; i < itens.length; i += 4) {
        const lote = itens.slice(i, i + 4);
        const arquivos = await Promise.all(lote.map(async (it) => [it.nome, new Uint8Array(await (await it.ler()).arrayBuffer())]));
        await chamar("redim", { grupo, arquivos });
        feitas += lote.length;
        prog.style.width = (feitas / total) * 80 + "%";
        status.textContent = `Redimensionando ${feitas}/${total}…`;
      }
    }
    status.textContent = "Montando páginas…";
    const pdfs = await chamar("montar_pdfs", { cliente });
    prog.style.width = "100%";
    status.textContent = `${pdfs.length} PDF(s) prontos.`;
    for (const [nome, bytes] of pdfs) saida.append(baixar(new Blob([bytes], { type: "application/pdf" }), nome));
  } catch (e) {
    status.innerHTML = `<span class="alerta">${esc(e.message)}</span>`;
  }
  $("#m-rodar").disabled = false;
});
