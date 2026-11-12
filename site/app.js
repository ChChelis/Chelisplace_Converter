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
  if (b.dataset.aba === "montagem") prepararMontagem();
}));

// ---------- pasta ----------
// Devolve {nome, podeGravar, copiar(orig,dest), moverPares(nomes), raiz:[{nome, ler()}], pares:[...]}.
// No computador só grava onde o navegador deixa (Chrome/Edge); no Drive, sempre.
async function pastaDoComputador() {
  if (window.showDirectoryPicker) return lerHandle(await showDirectoryPicker({ mode: "readwrite" }));
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
      inp.files.length ? res({ nome: (inp.files[0].webkitRelativePath || "").split("/")[0], handle: null, raiz, pares, podeGravar: false }) : rej(new Error("cancelado"));
    };
    inp.click();
  });
}

async function lerHandle(handle) {
  {
    const raiz = [], pares = [];
    for await (const [nome, h] of handle.entries()) {
      if (h.kind === "file" && IMG.test(nome)) raiz.push({ nome, ler: () => h.getFile() });
      if (h.kind === "directory" && nome.toLowerCase() === "pares") {
        for await (const [n2, h2] of h.entries()) if (h2.kind === "file" && IMG.test(n2)) pares.push({ nome: n2, ler: () => h2.getFile() });
      }
    }
    return {
      nome: handle.name, handle, raiz, pares, podeGravar: true,
      recarregar: () => lerHandle(handle),
      async copiar(orig, dest) {
        const f = await (await handle.getFileHandle(orig)).getFile();
        const w = await (await handle.getFileHandle(dest, { create: true })).createWritable();
        await w.write(f); await w.close();
      },
      async moverPares(nomes) {
        const dir = await handle.getDirectoryHandle("pares", { create: true });
        for (const nome of nomes) {
          let origem; try { origem = await handle.getFileHandle(nome); } catch { continue; }
          const w = await (await dir.getFileHandle(nome, { create: true })).createWritable();
          await w.write(await origem.getFile()); await w.close();
          await handle.removeEntry(nome);
        }
      },
    };
  }
}

// ---------- Google Drive ----------
const guardado = { ler: (k) => { try { return localStorage.getItem(k) || ""; } catch { return ""; } }, gravar: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
$("#drive-id").value = guardado.ler("drive-client-id");
const estadoDrive = (txt, conectado) => { $("#drive-estado").textContent = txt; $("#drive-sair").hidden = !conectado; };
$("#drive-entrar").addEventListener("click", async () => {
  const id = $("#drive-id").value.trim();
  $("#drive-erro").textContent = "";
  if (!id) { $("#drive-erro").textContent = "Cole o Client ID do Google antes de entrar."; return; }
  guardado.gravar("drive-client-id", id);
  try { await Drive.entrar(id); await Drive.raiz(); estadoDrive("conectado", true); } catch (e) { $("#drive-erro").textContent = e.message; estadoDrive("desconectado", false); }
});
$("#drive-sair").addEventListener("click", () => { Drive.sair(); estadoDrive("desconectado", false); });

async function pastaDoDrive(listaEl) {
  if (!Drive.conectado()) throw new Error("Entre com o Google no quadro \"Google Drive\" (no alto da página).");
  listaEl.textContent = "Lendo a pasta de pedidos…";
  const lista = await Drive.pedidos();
  return new Promise((res, rej) => {
    listaEl.innerHTML = lista.length ? `<p class="suave">Escolha o pedido:</p>` : `<p class="suave">Nenhuma pasta de pedido dentro de "${esc(Drive.NOME_RAIZ)}".</p>`;
    for (const ped of lista) {
      const b = Object.assign(document.createElement("button"), { className: "acao sec", textContent: ped.name });
      b.onclick = async () => {
        listaEl.textContent = "Lendo " + ped.name + "…";
        try { res(await montarPastaDrive(ped)); listaEl.textContent = ""; } catch (e) { rej(e); }
      };
      listaEl.append(b);
    }
  });
}

async function montarPastaDrive(ped) {
  const filhos = await Drive.listar(ped.id);
  const imagem = (f) => f.mimeType.startsWith("image/") || IMG.test(f.name);
  const item = (f) => ({ id: f.id, nome: f.name, ler: async () => new File([await Drive.baixar(f.id)], f.name) });
  const raiz = filhos.filter((f) => f.mimeType !== Drive.PASTA && imagem(f)).map(item);
  const dirPares = filhos.find((f) => f.mimeType === Drive.PASTA && f.name.toLowerCase() === "pares");
  const pares = dirPares ? (await Drive.listar(dirPares.id)).filter((f) => f.mimeType !== Drive.PASTA && imagem(f)).map(item) : [];
  return {
    nome: ped.name, drive: { id: ped.id }, raiz, pares, podeGravar: true,
    recarregar: () => montarPastaDrive(ped),
    async copiar(orig, dest) { await Drive.copiar(raiz.find((x) => x.nome === orig).id, dest, ped.id); },
    async moverPares(nomes) {
      const dir = await Drive.criarPasta("pares", ped.id);
      for (const nome of nomes) { const it = raiz.find((x) => x.nome === nome); if (it) await Drive.mover(it.id, dir, ped.id); }
    },
  };
}

const escolher = (p) => document.querySelector(`input[name=fonte-${p}]:checked`).value === "drive" ? pastaDoDrive($(`#${p}-drive-lista`)) : pastaDoComputador();
function falha(el, e) { if (e.message !== "cancelado" && e.name !== "AbortError") el.innerHTML = `<span class="alerta">${esc(e.message)}</span>`; }

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

// ---------- pedido em uso (compartilhado entre Checagem e Montagem) ----------
const sessao = { pasta: null, xml: null, xmlNome: "", ignorar: new Set() };
let clienteEditado = false;
const chaveIgnorar = () => "ignorar:" + sessao.pasta.nome;
function carregarIgnorados() { try { sessao.ignorar = new Set(JSON.parse(guardado.ler(chaveIgnorar()) || "[]")); } catch { sessao.ignorar = new Set(); } }
const salvarIgnorados = () => guardado.gravar(chaveIgnorar(), JSON.stringify([...sessao.ignorar]));

function atualizarRotulos() {
  const p = sessao.pasta;
  const txt = p ? `${p.nome}: ${p.raiz.length + p.pares.length} imagens${p.pares.length ? ` (${p.pares.length} em pares/)` : ""}` : "";
  $("#c-pasta-nome").textContent = txt; $("#m-pasta-nome").textContent = txt;
  $("#c-xml-nome").textContent = $("#m-xml-nome").textContent = sessao.xmlNome;
  $("#c-rodar").disabled = !(p && sessao.xml);
  $("#m-rodar").disabled = !(p && p.raiz.length);
}
async function receberXml(arq) {
  sessao.xml = arq ? await arq.arrayBuffer() : null; sessao.xmlNome = arq ? arq.name : "";
  atualizarRotulos();
}
async function receberPasta(alvoErro, prefixo) {
  try { sessao.pasta = await escolher(prefixo); } catch (e) { return falha(alvoErro, e); }
  carregarIgnorados();
  if (!clienteEditado) $("#m-cliente").value = sessao.pasta.nome;
  atualizarRotulos();
}
$("#c-xml").addEventListener("change", (e) => receberXml(e.target.files[0]));
$("#m-xml").addEventListener("change", (e) => receberXml(e.target.files[0]));
$("#c-pasta").addEventListener("click", () => receberPasta($("#c-pasta-nome"), "c"));
$("#m-pasta").addEventListener("click", () => receberPasta($("#m-pasta-nome"), "m"));
$("#m-cliente").addEventListener("input", () => (clienteEditado = true));

// ---------- checagem ----------
const lista = (itens, f) => (itens.length ? `<ul>${itens.map((i) => `<li>${f(i)}</li>`).join("")}</ul>` : "");
const botaoPeq = (rot, attr, ids) => `<button class="peq" ${attr}="${ids}">${rot}</button>`;

async function conferir() {
  const alvo = $("#c-resultado");
  alvo.textContent = "Conferindo…";
  await pronto;
  try {
    if (sessao.pasta.recarregar) { sessao.pasta = await sessao.pasta.recarregar(); atualizarRotulos(); }  // lê a pasta de novo, sem escolher outra vez
  } catch (e) { alvo.innerHTML = `<p class="alerta">${esc(e.message)}</p>`; return; }
  const pasta = sessao.pasta;
  const nomes = [...pasta.raiz, ...pasta.pares].map((x) => x.nome);
  let r;
  try { r = await chamar("checar", { xml: sessao.xml.slice(0), nomes, ignorar: [...sessao.ignorar] }); } catch (e) { alvo.innerHTML = `<p class="alerta">${esc(e.message)}</p>`; return; }
  const secao = (t, cls, itens, f) => (itens.length ? `<h3 class="${cls}">${t} (${itens.length})</h3>${lista(itens, f)}` : "");
  const todos = r.pares_incompletos.length > 1 ? `<p><button class="peq" data-ign-todos="1">Ignorar todos os pares incompletos</button></p>` : "";
  alvo.innerHTML =
    `<p><b>${r.total}</b> unidades no XML` + (r.pares_ignorados.length ? ` <span class="suave">(sem ${r.pares_ignorados.length} par(es) ignorado(s))</span>` : "") + `. ` +
    (r.ok ? `<span class="ok">Tudo certo: nada falta, nada sobra.</span>` : `<span class="alerta">Há pendências.</span>`) + `</p>` +
    secao("Faltando baixar", "alerta", r.faltando, ([n, q]) => `${esc(n)} × ${q}`) +
    secao("A duplicar (o XML pede mais cópias)", "aviso", r.a_duplicar, ([n, q]) => `${esc(n)}: faltam ${q} cópia(s)`) +
    secao("Cópias a mais", "aviso", r.excesso, ([n, q]) => `${esc(n)}: ${q} a mais`) +
    secao("Fora da lista do XML", "aviso", r.fora_da_lista, esc) +
    secao("Sem ID no nome", "aviso", r.sem_id, esc) +
    secao("Verso padrão na pasta (não entra na montagem)", "suave", r.verso_padrao, esc) +
    secao("Pares dupla face incompletos", "alerta", r.pares_incompletos, ([f, v, idf, idv]) => `${esc(f)} / ${esc(v)} ${botaoPeq("Ignorar este par", "data-ign", idf + "," + idv)}`) + todos +
    secao("Pares ignorados", "suave", r.pares_ignorados, ([f, v, idf, idv]) => `${esc(f)} / ${esc(v)} ${botaoPeq("Voltar a considerar", "data-des", idf + "," + idv)}`) +
    `<div id="c-acoes"></div>`;
  alvo.querySelectorAll("[data-ign],[data-des]").forEach((b) => (b.onclick = () => {
    const ids = (b.dataset.ign || b.dataset.des).split(",");
    ids.forEach((i) => (b.dataset.ign ? sessao.ignorar.add(i) : sessao.ignorar.delete(i)));
    salvarIgnorados(); conferir();
  }));
  const todosBtn = alvo.querySelector("[data-ign-todos]");
  if (todosBtn) todosBtn.onclick = () => { r.pares_incompletos.forEach(([, , f, v]) => { sessao.ignorar.add(f); sessao.ignorar.add(v); }); salvarIgnorados(); conferir(); };

  const acoes = $("#c-acoes");
  const botao = (texto, fn, sec) => { const b = Object.assign(document.createElement("button"), { className: "acao" + (sec ? " sec" : ""), textContent: texto }); b.onclick = fn; acoes.append(b); };
  if (r.faltantes_xml) botao("Baixar XML dos faltantes", () => baixar(new Blob([r.faltantes_xml], { type: "application/xml" }), `${pasta.nome}_faltantes.xml`).click(), true);
  if (pasta.podeGravar && r.duplicar.length) botao(`Criar ${r.duplicar.length} cópia(s)`, () => confirmar(acoes, `Criar ${r.duplicar.length} arquivo(s) novos na pasta? Nenhum arquivo existente é alterado.`, async () => {
    for (const [orig, dest] of r.duplicar) await pasta.copiar(orig, dest);
    return `${r.duplicar.length} cópia(s) criada(s). Clique em Conferir para ver o resultado.`;
  }));
  // pares completos que ainda estão soltos na pasta do pedido: propõe a pasta pares/ sozinho, com confirmação
  const jaEmPares = new Set(pasta.pares.map((x) => x.nome));
  const soltos = r.pares.filter(([f, v]) => !(jaEmPares.has(f) && jaEmPares.has(v))).flat().filter((n) => !jaEmPares.has(n));
  const moverPares = () => confirmar(acoes, `Criar a pasta "pares" dentro de "${pasta.nome}" e mover ${soltos.length} arquivo(s) de dupla face para ela?`, async () => {
    await pasta.moverPares(soltos);
    return `${soltos.length} arquivo(s) movido(s) para pares/. Clique em Conferir para ver o resultado.`;
  });
  if (pasta.podeGravar && soltos.length) { botao(`Mover ${soltos.length / 2} par(es) para pares/`, moverPares, true); moverPares(); }
  if (!pasta.podeGravar && (r.duplicar.length || soltos.length)) acoes.insertAdjacentHTML("beforeend", `<p class="suave">Para criar cópias e mover pares, use Chrome ou Edge, ou escolha o Google Drive.</p>`);
}
$("#c-rodar").addEventListener("click", conferir);

function baixar(blob, nome) {
  const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: nome, className: "baixar", textContent: "Baixar " + nome });
  return a;
}

// ---------- montagem ----------
function prepararMontagem() {
  const p = sessao.pasta;
  $("#m-trocar").open = !p;
  $("#m-resumo").innerHTML = p
    ? `Pedido em uso: <b>${esc(p.nome)}</b> (${p.raiz.length} imagens${p.pares.length ? ` + ${p.pares.length} em pares/` : ""}). XML: ${sessao.xmlNome ? esc(sessao.xmlNome) : '<span class="aviso">nenhum (pares em ordem alfabética)</span>'}.`
    : `<span class="suave">Escolha a pasta do pedido abaixo, ou na aba Checagem.</span>`;
  if (p && !clienteEditado) $("#m-cliente").value = p.nome;
  atualizarRotulos();
}
$("#m-rodar").addEventListener("click", async () => {
  const cliente = $("#m-cliente").value.trim() || "Pedido";
  const barra = $("#m-barra"), prog = barra.firstElementChild, status = $("#m-status"), saida = $("#m-saida");
  $("#m-rodar").disabled = true; barra.hidden = false; saida.innerHTML = "";
  let feitas = 0;
  try {
    if (sessao.pasta.recarregar) sessao.pasta = await sessao.pasta.recarregar();  // pega o que mudou na pasta desde a última vez
    const p = sessao.pasta, total = p.raiz.length + p.pares.length;
    atualizarRotulos(); prepararMontagem();
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
    const pdfs = await chamar("montar_pdfs", { cliente, xml: sessao.xml ? sessao.xml.slice(0) : null });
    prog.style.width = "100%";
    status.textContent = `${pdfs.length} PDF(s) prontos.`;
    for (const [nome, bytes] of pdfs) saida.append(baixar(new Blob([bytes], { type: "application/pdf" }), nome));
    if (p.drive) {
      const b = Object.assign(document.createElement("button"), { className: "acao", textContent: "Salvar PDFs no Drive (pasta saida)" });
      b.onclick = () => confirmar(saida, `Criar a pasta "saida" dentro de "${p.nome}" no Drive (se não existir) e enviar ${pdfs.length} PDF(s) para lá?`, async () => {
        const dir = await Drive.criarPasta("saida", p.drive.id);
        let n = 0;
        for (const [nome, bytes] of pdfs) { await Drive.enviar(nome, new Blob([bytes], { type: "application/pdf" }), dir, "application/pdf"); n++; }
        return `${n} PDF(s) enviados para ${p.nome}/saida no Drive.`;
      });
      saida.append(b);
    }
  } catch (e) {
    status.innerHTML = `<span class="alerta">${esc(e.message)}</span>`;
  }
  atualizarRotulos();
});
