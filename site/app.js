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
  if (window.podeAbrirAba && !window.podeAbrirAba(b.dataset.aba)) return;  // não deixa pular uma etapa que ainda tem pendência
  document.querySelectorAll("nav button").forEach((x) => x.setAttribute("aria-selected", x === b));
  document.querySelectorAll("main > section").forEach((s) => (s.hidden = s.id !== b.dataset.aba));
  if (b.dataset.aba === "montagem") relerPasta().catch(() => {}).then(() => prepararMontagem());  // sempre com a pasta atual (o que você subiu no Drive aparece)
  if (window.aoAbrirAba) window.aoAbrirAba(b.dataset.aba);
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
      const raiz = [], pares = [], completar = [], subpastas = [];
      for (const f of inp.files) {
        const partes = f.webkitRelativePath.split("/");
        if (!IMG.test(f.name)) continue;
        const item = { nome: f.name, ler: async () => f };
        if (partes.length === 2) raiz.push(item);
        else if (partes.length === 3 && partes[1].toLowerCase() === "pares") pares.push(item);
        else if (partes.length >= 3 && partes[1].toLowerCase() === "completar") completar.push({ ...item, em: "completar" });
        else if (partes.length >= 3 && !RESERVADAS.has(partes[1].toLowerCase())) subpastas.push(itemSub(f.name, partes.slice(1, -1).join("/"), item.ler));
      }
      inp.files.length ? res({ nome: (inp.files[0].webkitRelativePath || "").split("/")[0], handle: null, raiz, pares, completar, subpastas, podeGravar: false }) : rej(new Error("cancelado"));
    };
    inp.click();
  });
}

// Imagens em subpastas do pedido (fora das pastas com função própria): ficam à disposição para trocar a arte de uma carta ou preencher uma pendente (nunca entram sozinhas).
const RESERVADAS = new Set(["pares", "completar", "saida", "originais_sem_sangria", "copias_a_mais", "anteriores"]);
const itemSub = (nome, caminho, ler, extra = {}) => ({ nome, em: "sub", caminho, chave: "sub/" + caminho + "/" + nome, rotulo: caminho + "/" + nome, opcional: true, ler, ...extra });

async function lerHandle(handle) {
  {
    const raiz = [], pares = [], completar = [], subpastas = [];
    const varrerSub = async (dir, caminho, nivel) => {
      for await (const [n, h] of dir.entries()) {
        if (h.kind === "file" && IMG.test(n)) subpastas.push(itemSub(n, caminho, () => h.getFile(), { pai: dir }));
        else if (h.kind === "directory" && nivel < 3) await varrerSub(h, caminho + "/" + n, nivel + 1);
      }
    };
    const varrer = async (dir, nivel) => {  // completar/ pode ter subpastas (uma por loja, por exemplo)
      for await (const [n, h] of dir.entries()) {
        if (h.kind === "file" && IMG.test(n)) completar.push({ nome: n, em: "completar", ler: () => h.getFile(), pai: dir });
        else if (h.kind === "directory" && nivel < 3) await varrer(h, nivel + 1);
      }
    };
    for await (const [nome, h] of handle.entries()) {
      if (h.kind === "directory" && nome.toLowerCase() === "completar") await varrer(h, 1);
      else if (h.kind === "directory" && !RESERVADAS.has(nome.toLowerCase())) await varrerSub(h, nome, 1);
      if (h.kind === "file" && IMG.test(nome)) raiz.push({ nome, em: "raiz", ler: () => h.getFile() });
      if (h.kind === "directory" && nome.toLowerCase() === "pares") {
        for await (const [n2, h2] of h.entries()) if (h2.kind === "file" && IMG.test(n2)) pares.push({ nome: n2, em: "pares", ler: () => h2.getFile() });
      }
    }
    return {
      nome: handle.name, handle, raiz, pares, completar, subpastas, podeGravar: true,
      recarregar: () => lerHandle(handle),
      // guarda a original em originais_sem_sangria/ e coloca a corrigida no lugar dela (ou só adiciona, se não havia original)
      async inserirCorrigida(item, nomeNovo, bytes) {
        const dir = item && item.pai ? item.pai : item && item.em === "pares" ? await handle.getDirectoryHandle("pares") : handle;  // completar/ (e subpastas): a corrigida fica ao lado da original
        if (item) {
          const backup = await handle.getDirectoryHandle("originais_sem_sangria", { create: true });
          const f = await (await dir.getFileHandle(item.nome)).getFile();
          const wb = await (await backup.getFileHandle(item.nome, { create: true })).createWritable(); await wb.write(f); await wb.close();
          if (item.nome !== nomeNovo) await dir.removeEntry(item.nome);
        }
        const w = await (await dir.getFileHandle(nomeNovo, { create: true })).createWritable(); await w.write(bytes); await w.close();
      },
      async copiar(orig, dest) {
        const f = await (await handle.getFileHandle(orig)).getFile();
        const w = await (await handle.getFileHandle(dest, { create: true })).createWritable();
        await w.write(f); await w.close();
      },
      async moverPares(nomes, prog, sub = "pares") {
        const dir = await handle.getDirectoryHandle(sub, { create: true });
        let k = 0;
        for (const nome of nomes) {
          if (prog) prog(++k, nomes.length);
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
const estadoDrive = (txt, conectado) => { $("#drive-estado").textContent = txt; $("#drive-sair").hidden = !conectado; $("#drive-entrar").disabled = conectado; };
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
  const item = (f, parentId, em) => ({ id: f.id, nome: f.name, parentId, em, ler: async () => new File([await Drive.baixar(f.id)], f.name) });
  const raiz = filhos.filter((f) => f.mimeType !== Drive.PASTA && imagem(f)).map((f) => item(f, ped.id, "raiz"));
  const dirPares = filhos.find((f) => f.mimeType === Drive.PASTA && f.name.toLowerCase() === "pares");
  const pares = dirPares ? (await Drive.listar(dirPares.id)).filter((f) => f.mimeType !== Drive.PASTA && imagem(f)).map((f) => item(f, dirPares.id, "pares")) : [];
  const dirCompletar = filhos.find((f) => f.mimeType === Drive.PASTA && f.name.toLowerCase() === "completar");
  const completar = [];
  const varrer = async (pasta, nivel) => {
    for (const f of await Drive.listar(pasta)) {
      if (f.mimeType === Drive.PASTA) { if (nivel < 3) await varrer(f.id, nivel + 1); }
      else if (imagem(f)) completar.push(item(f, pasta, "completar"));
    }
  };
  if (dirCompletar) await varrer(dirCompletar.id, 1);
  const subpastas = [];
  const varrerSub = async (pasta, caminho, nivel) => {
    for (const f of await Drive.listar(pasta)) {
      if (f.mimeType === Drive.PASTA) { if (nivel < 3) await varrerSub(f.id, caminho + "/" + f.name, nivel + 1); }
      else if (imagem(f)) subpastas.push({ ...item(f, pasta, "sub"), caminho, chave: "sub/" + caminho + "/" + f.name, rotulo: caminho + "/" + f.name, opcional: true });
    }
  };
  for (const f of filhos) if (f.mimeType === Drive.PASTA && !RESERVADAS.has(f.name.toLowerCase())) await varrerSub(f.id, f.name, 1);
  return {
    nome: ped.name, drive: { id: ped.id }, raiz, pares, completar, subpastas, podeGravar: true,
    recarregar: () => montarPastaDrive(ped),
    // move a original para originais_sem_sangria/ (nada é apagado) e envia a corrigida para o mesmo lugar
    async inserirCorrigida(it, nomeNovo, bytes) {
      if (it) { const backup = await Drive.criarPasta("originais_sem_sangria", ped.id); await Drive.mover(it.id, backup, it.parentId); }
      await Drive.enviar(nomeNovo, new Blob([bytes], { type: "image/png" }), it ? it.parentId : ped.id, "image/png");
    },
    async copiar(orig, dest) { await Drive.copiar(raiz.find((x) => x.nome === orig).id, dest, ped.id); },
    async moverPares(nomes, prog, sub = "pares") {
      const dir = await Drive.criarPasta(sub, ped.id);
      let k = 0;
      for (const nome of nomes) { if (prog) prog(++k, nomes.length); const it = raiz.find((x) => x.nome === nome); if (it) await Drive.mover(it.id, dir, ped.id); }
    },
  };
}

const escolher = (p) => document.querySelector(`input[name=fonte-${p}]:checked`).value === "drive" ? pastaDoDrive($(`#${p}-drive-lista`)) : pastaDoComputador();
function falha(el, e) { if (e.message !== "cancelado" && e.name !== "AbortError") el.innerHTML = `<span class="alerta">${esc(e.message)}</span>`; }

// confirmação dentro da página (sem pop-ups nativos). `fazer(atualizar)` pode chamar atualizar("texto", fracao 0..1) para mostrar andamento.
function confirmar(onde, texto, fazer) {
  const c = document.createElement("div");
  c.className = "conf";
  c.innerHTML = `<div>${esc(texto)}</div>`;
  const sim = Object.assign(document.createElement("button"), { className: "acao", textContent: "Sim, fazer" });
  const nao = Object.assign(document.createElement("button"), { className: "acao sec", textContent: "Cancelar" });
  nao.onclick = () => c.remove();
  sim.onclick = async () => {
    sim.disabled = nao.disabled = true;
    c.innerHTML = `<div class="aviso">Trabalhando… (não feche a página)</div><div class="barra"><div style="width:2%"></div></div>`;
    const atualizar = (t, fr) => { c.firstElementChild.textContent = t; if (fr != null) c.querySelector(".barra > div").style.width = Math.max(2, Math.round(fr * 100)) + "%"; };
    try { const rs = await fazer(atualizar); c.innerHTML = rs && typeof rs === "object" && rs.html ? rs.html : esc(rs); } catch (e) { c.innerHTML = `<span class="alerta">${esc(e.message)}</span>`; }
  };
  c.append(sim, nao);
  onde.append(c);
}

// ---------- pedido em uso (compartilhado entre Checagem e Montagem) ----------
const chaveExtras = (itens) => itens.map((x) => x.nome).sort().join("|");  // identifica um conjunto de imagens extras
const sessao = { trocas: {}, pasta: null, xml: null, xmlNome: "", ignorar: new Set(), conferencia: null, extrasDecisao: null };  // conferencia: resultado da última checagem (null = precisa conferir de novo)
let clienteEditado = false;
const chaveIgnorar = () => "ignorar:" + sessao.pasta.nome;
function carregarIgnorados() { try { sessao.ignorar = new Set(JSON.parse(guardado.ler(chaveIgnorar()) || "[]")); } catch { sessao.ignorar = new Set(); } }
const salvarIgnorados = () => guardado.gravar(chaveIgnorar(), JSON.stringify([...sessao.ignorar]));

function atualizarRotulos() {
  const p = sessao.pasta;
  const txt = p ? `${p.nome}: ${p.raiz.length + p.pares.length + (p.completar || []).length} imagens${p.pares.length ? ` (${p.pares.length} em pares/)` : ""}${(p.completar || []).length ? ` (${p.completar.length} em completar/)` : ""}` : "";
  $("#c-pasta-nome").textContent = txt; $("#m-pasta-nome").textContent = txt;
  $("#c-xml-nome").textContent = $("#m-xml-nome").textContent = sessao.xmlNome;
  $("#c-rodar").disabled = !(p && sessao.xml);
  $("#m-rodar").disabled = !(p && p.raiz.length && typeof MONT !== "undefined" && MONT.pronta);
}
async function receberXml(arq) {
  sessao.conferencia = null;
  sessao.xml = arq ? await arq.arrayBuffer() : null; sessao.xmlNome = arq ? arq.name : "";
  atualizarRotulos();
  if (!$("#montagem").hidden) prepararMontagem();
}
async function receberPasta(alvoErro, prefixo) {
  try { sessao.pasta = await escolher(prefixo); } catch (e) { return falha(alvoErro, e); }
  sessao.conferencia = null;
  carregarIgnorados();
  MONT.adicionadas = []; MONT.chaveExtras = "";  // outro pedido: as perguntas da montagem começam do zero
  if (!clienteEditado) $("#m-cliente").value = sessao.pasta.nome;
  atualizarRotulos();
  if (!$("#montagem").hidden) prepararMontagem();
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
  sessao.conferencia = null;
  const alvo = $("#c-resultado");
  alvo.textContent = "Conferindo…";
  await pronto;
  try {
    if (sessao.pasta.recarregar) { sessao.pasta = await sessao.pasta.recarregar(); atualizarRotulos(); }  // lê a pasta de novo, sem escolher outra vez
  } catch (e) { alvo.innerHTML = `<p class="alerta">${esc(e.message)}</p>`; return; }
  const pasta = sessao.pasta;
  const nomes = [...pasta.raiz, ...pasta.pares].map((x) => x.nome);  // completar/ é tratada à parte (extras)
  let r;
  try { r = await chamar("checar", { xml: sessao.xml.slice(0), nomes, ignorar: [...sessao.ignorar] }); } catch (e) { alvo.innerHTML = `<p class="alerta">${esc(e.message)}</p>`; return; }
  if (window.separarOriginaisTrocados) separarOriginaisTrocados(r);  // arte original de carta trocada (em todas as cópias) não é "extra"
  const secao = (t, cls, itens, f) => (itens.length ? `<h3 class="${cls}">${t} (${itens.length})</h3>${lista(itens, f)}` : "");
  const todos = r.pares_incompletos.length > 1 ? `<p><button class="peq" data-ign-todos="1">Ignorar todos os pares incompletos</button></p>` : "";
  alvo.innerHTML =
    `<p><b>${r.total}</b> unidades no XML` + (r.pares_ignorados.length ? ` <span class="suave">(sem ${r.pares_ignorados.length} par(es) ignorado(s))</span>` : "") + `. ` +
    (r.ok ? `<span class="ok">Tudo certo: nada falta, nada sobra.</span>` : `<span class="alerta">Há pendências.</span>`) + `</p>` +
    secao("Faltando baixar", "alerta", r.faltando, ([n, q]) => `${esc(n)} × ${q}`) +
    secao("A duplicar (o XML pede mais cópias)", "aviso", r.a_duplicar, ([n, q]) => `${esc(n)}: faltam ${q} cópia(s)`) +
    secao("Cópias a mais", "aviso", r.excesso, ([n, q]) => `${esc(n)}: ${q} a mais`) +
    secao("Fora da lista do XML (extras)", "aviso", r.fora_da_lista, esc) +
    secao("Sem ID no nome (extras)", "aviso", r.sem_id, esc) +
    secao("Arte original de carta trocada (não entra no pedido)", "suave", r.originais_trocadas || [], esc) +
    ((pasta.completar || []).length ? secao("Na pasta completar/ (extras)", "aviso", pasta.completar, (x) => esc(x.nome)) : "") +
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
  if (pasta.podeGravar && r.duplicar.length) botao(`Criar ${r.duplicar.length} cópia(s)`, () => confirmar(acoes, `Criar ${r.duplicar.length} arquivo(s) novos na pasta? Nenhum arquivo existente é alterado.`, async (atualizar) => {
    let k = 0;
    for (const [orig, dest] of r.duplicar) { atualizar(`Criando cópia ${k + 1} de ${r.duplicar.length}…`, k / r.duplicar.length); await pasta.copiar(orig, dest); k++; }
    sessao.conferencia = null;  // a pasta mudou: precisa conferir de novo
    return `${r.duplicar.length} cópia(s) criada(s). Clique em Conferir para ver o resultado.`;
  }));
  // cópias a mais do mesmo arquivo (ex.: "… - Copia.jpg"): nada é apagado, as sobras vão para copias_a_mais/
  const sobras = (r.excesso_mover || []).flatMap(([, fs]) => fs);
  if (pasta.podeGravar && sobras.length) botao(`Mover ${sobras.length} cópia(s) a mais para copias_a_mais/`, () => confirmar(acoes, `Mover ${sobras.length} arquivo(s) repetido(s) para a subpasta "copias_a_mais" (nada é apagado; fica o de nome mais curto de cada imagem)?\n${sobras.slice(0, 6).join("\n")}${sobras.length > 6 ? "\n…" : ""}`, async (atualizar) => {
    await pasta.moverPares(sobras, (k, n) => atualizar(`Movendo arquivo ${k} de ${n} para copias_a_mais/…`, (k - 1) / n), "copias_a_mais");
    sessao.conferencia = null;
    return `${sobras.length} arquivo(s) movido(s) para copias_a_mais/. Clique em Conferir para ver o resultado.`;
  }));
  const originais = r.originais_trocadas || [];
  if (pasta.podeGravar && originais.length) botao(`Mover ${originais.length} arte(s) original(is) trocada(s) para copias_a_mais/`, () => confirmar(acoes, `Mover ${originais.length} arquivo(s) da arte original das cartas que você trocou para a subpasta "copias_a_mais" (nada é apagado)?\n${originais.slice(0, 6).join("\n")}${originais.length > 6 ? "\n…" : ""}`, async (atualizar) => {
    await pasta.moverPares(originais, (k, n) => atualizar(`Movendo arquivo ${k} de ${n} para copias_a_mais/…`, (k - 1) / n), "copias_a_mais");
    sessao.conferencia = null;
    return `${originais.length} arquivo(s) movido(s) para copias_a_mais/. Clique em Conferir para ver o resultado.`;
  }), true);
  // pares completos que ainda estão soltos na pasta do pedido: propõe a pasta pares/ sozinho, com confirmação
  const jaEmPares = new Set(pasta.pares.map((x) => x.nome));
  const soltos = r.pares.filter(([f, v]) => !(jaEmPares.has(f) && jaEmPares.has(v))).flat().filter((n) => !jaEmPares.has(n));
  // Imagens fora do pedido (soltas sem ID/fora do XML, e tudo em completar/): mudam o total depois do orçamento, então pedem decisão
  const fora = new Set([...r.fora_da_lista, ...r.sem_id]);
  const extrasItens = [...pasta.raiz.filter((x) => fora.has(x.nome)), ...(pasta.completar || [])];
  if (window.desenharTrocas) window.desenharTrocas(r);  // faltando × imagens extras: “usar no lugar”
  const extrasPendentes = window.desenharExtras ? await window.desenharExtras([...extrasItens, ...(pasta.subpastas || [])], r.faltando.length) : 0;
  sessao.conferencia = { extrasPendentes, pendentes: r.faltando.length + r.a_duplicar.length + r.excesso.length + r.pares_incompletos.length + (soltos.length ? 1 : 0), faltando: r.faltando.length, a_duplicar: r.a_duplicar.length, excesso: r.excesso.length, pares_incompletos: r.pares_incompletos.length, soltos: soltos.length };
  const moverPares = () => confirmar(acoes, `Criar a pasta "pares" dentro de "${pasta.nome}" e mover ${soltos.length} arquivo(s) de dupla face para ela?`, async (atualizar) => {
    await pasta.moverPares(soltos, (k, n) => atualizar(`Movendo arquivo ${k} de ${n} para pares/…`, (k - 1) / n));
    sessao.conferencia = null;
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
// Ordem dos slots: cartas do XML, (brancos), pares, extras. Extras = imagens da pasta que não estão no XML.
const MONT = { incluirExtras: null, chaveExtras: "", adicionadas: [], permitirBranco: false, chaveBranco: "", pronta: false, plano: null, ignorarPend: false, chavePend: "" };

// Relê a pasta do pedido (Drive ou computador): pega o que foi subido/alterado depois que ela foi escolhida.
async function relerPasta() {
  if (sessao.pasta && sessao.pasta.recarregar) { sessao.pasta = await sessao.pasta.recarregar(); sessao.conferencia = null; atualizarRotulos(); }
}
window.relerPasta = relerPasta;
async function prepararMontagem() {
  const p = sessao.pasta, plano = $("#m-plano");
  $("#m-trocar").open = !p;
  $("#m-resumo").innerHTML = p
    ? `Pedido em uso: <b>${esc(p.nome)}</b>. XML: ${sessao.xmlNome ? esc(sessao.xmlNome) : '<span class="aviso">nenhum (não dá para separar imagens fora do XML nem ordenar os pares)</span>'}.`
    : `<span class="suave">Escolha a pasta do pedido abaixo, ou na aba Checagem.</span>`;
  if (!p) { plano.innerHTML = ""; MONT.pronta = false; return atualizarRotulos(); }
  if (!clienteEditado) $("#m-cliente").value = p.nome;
  await pronto;
  let raizXml = p.raiz, extras = [...(p.completar || [])], padrao = [], faltando = 0, ignorados = 0, copiasTrocadas = 0;
  if (sessao.xml) {
    try {
      const r = await chamar("checar", { xml: sessao.xml.slice(0), nomes: [...p.raiz, ...p.pares].map((x) => x.nome), ignorar: [...sessao.ignorar] });
      if (window.separarOriginaisTrocados) separarOriginaisTrocados(r);
      const fora = new Set([...r.fora_da_lista, ...r.sem_id]), pad = new Set(r.verso_padrao);
      extras = [...p.raiz.filter((x) => fora.has(x.nome)), ...(p.completar || [])];
      padrao = p.raiz.filter((x) => pad.has(x.nome));
      // cópias da arte ORIGINAL de uma carta cuja arte foi trocada (etapa 4): o XML passou a pedir menos cópias dela, as que sobram não entram
      const idsTrocados = new Set((sessao.substituicoes || []).map((s) => s.id));
      const sobras = new Set([...(r.excesso_mover || []).filter(([id]) => idsTrocados.has(id)).flatMap(([, arqs]) => arqs), ...(r.originais_trocadas || [])]);
      copiasTrocadas = sobras.size;
      raizXml = p.raiz.filter((x) => !fora.has(x.nome) && !pad.has(x.nome) && !sobras.has(x.nome));
      faltando = r.faltando.length; ignorados = r.pares_ignorados.length;
    } catch (e) { plano.innerHTML = `<p class="alerta">${esc(e.message)}</p>`; MONT.pronta = false; return; }
  }
  // As imagens que preenchem slots pendentes do bot entram sempre; só a sobra (extras de verdade) tem a decisão "incluir ou não".
  const pend = window.pendentesBot ? window.pendentesBot() : [];
  const todosExtras = [...extras, ...(p.subpastas || [])];  // as de subpastas só entram se atribuídas (troca de arte / pendente)
  const sep = window.separarExtras ? window.separarExtras(todosExtras) : { cobrem: [], sobra: extras };
  const sobra = sep.sobra;
  // decisão sobre a sobra vale para este conjunto de arquivos; se mudar, pergunta de novo
  const chave = chaveExtras(sobra);
  if (chave !== MONT.chaveExtras) { MONT.chaveExtras = chave; MONT.incluirExtras = sobra.length ? null : false; }
  const dec = sessao.extrasDecisao;  // já decidido na etapa 4 (Conferir), junto com o orçamento: não pergunta de novo
  if (sobra.length && dec && dec.chave === chave) MONT.incluirExtras = dec.valor === "incluir";
  if (!sobra.length) MONT.incluirExtras = false;  // nada a perguntar
  const extrasUsados = [...sep.cobrem, ...(MONT.incluirExtras ? sobra : [])];
  const nExtras = extrasUsados.length + MONT.adicionadas.length;
  const total = raizXml.length + p.pares.length + nExtras;
  const resto = total % 18, pendFalta = Math.max(0, pend.length - nExtras), falta = resto ? 18 - resto : 0;
  if (MONT.chavePend !== String(pendFalta)) { MONT.chavePend = String(pendFalta); MONT.ignorarPend = false; }
  const aguardando = pendFalta > 0 && !MONT.ignorarPend;  // enquanto faltam imagens dos pendentes, os brancos da última página ainda não fazem sentido
  if (MONT.chaveBranco !== String(falta)) { MONT.chaveBranco = String(falta); MONT.permitirBranco = false; }
  MONT.plano = { raizXml, pares: p.pares, extras: extrasUsados };
  MONT.pronta = total > 0 && MONT.incluirExtras !== null && !aguardando && (falta === 0 || MONT.permitirBranco);

  let h = `<p><b>${raizXml.length}</b> carta(s) do pedido + <b>${p.pares.length}</b> de pares + <b>${nExtras}</b> extra(s) = <b>${total}</b> slot(s) → <b>${Math.ceil(total / 18) || 0}</b> página(s) de 18.</p>`;
  if (ignorados) h += `<p class="suave">${ignorados} par(es) ignorado(s) na Checagem: não entram na montagem.</p>`;
  if (faltando) h += `<p class="aviso">${faltando} imagem(ns) do XML ainda não estão na pasta (veja a Checagem).</p>`;
  if (copiasTrocadas) h += `<p class="suave">${copiasTrocadas} cópia(s) da arte original que você trocou ficam de fora da montagem (na etapa 4 há um botão para guardá-las em copias_a_mais/).</p>`;
  if (padrao.length) h += `<p class="suave">O verso padrão (${esc(padrao[0].nome)}) está na pasta e não entra na montagem.</p>`;
  if (sep.cobrem.length) h += `<p class="ok">${sep.cobrem.length} slot(s) pendente(s) preenchido(s) por imagens da pasta (com as cópias que você definiu); entram nos últimos slots, depois dos pares.</p>`;
  if (sobra.length) {
    h += `<div class="conf"><b class="aviso">${sobra.length} imagem(ns) na pasta não estão no XML nem são de slot pendente:</b>${lista(sobra, (x) => esc(x.nome))}`;
    h += MONT.incluirExtras === null
      ? `Colocar nos <b>últimos slots, depois dos pares</b>? <br><button class="acao" id="m-extras-sim">Sim, colocar no fim</button><button class="acao sec" id="m-extras-nao">Não incluir</button>`
      : `<span class="suave">${MONT.incluirExtras ? "Entram nos últimos slots, depois dos pares." : "Não entram na montagem."}</span> <button class="peq" id="m-extras-mudar">Mudar</button>`;
    h += `</div>`;
  }
  if (pendFalta) {
    h += `<div class="conf"><b class="alerta">Faltam imagens para ${pendFalta} de ${pend.length} slot(s) pendente(s)</b> (nenhum serviu no bot ou a arte foi trocada; já estão no orçamento): ${esc(pend.slice(0, 12).map((c) => c.nome).join("; "))}${pend.length > 12 ? "…" : ""}<br>Suba as imagens da outra fonte na pasta do pedido (ou em <code>completar/</code>) e clique em <b>Reler a pasta</b>, ou adicione daqui do computador. Se vierem sem sangria, use <b>Corrigir sangria…</b> (ele lista também o que estiver em <code>completar/</code>).<br>`;
    h += `<div id="m-atrib"></div><button class="acao sec" id="m-reler">Reler a pasta</button> <button class="acao sec" id="m-sg">Corrigir sangria…</button> <input id="m-add-pend" type="file" accept="image/*" multiple> `;
    h += MONT.ignorarPend ? `<span class="suave">Vai montar sem essas ${pendFalta} imagem(ns).</span> <button class="peq" id="m-pend-nao">Desfazer</button>` : `<button class="acao sec" id="m-pend-ignorar">Montar sem elas</button>`;
    h += `</div>`;
  }
  if (falta && !aguardando) {
    h += `<div class="conf"><b class="alerta">A última página tem ${resto} de 18 slots: faltam ${falta}.</b><br>Adicione ${falta} imagem(ns) para completar (entram depois dos pares) ou monte assim mesmo, com ${falta} slot(s) em branco <b>só na última página</b> (as demais saem cheias).`;
    if (MONT.adicionadas.length) h += `<br><span class="suave">${MONT.adicionadas.length} imagem(ns) adicionada(s): ${esc(MONT.adicionadas.map((f) => f.name).join(", "))}</span> <button class="peq" id="m-add-limpar">Remover as adicionadas</button>`;
    h += `<br><input id="m-add" type="file" accept="image/*" multiple> `;
    h += MONT.permitirBranco ? `<span class="suave">Vai montar com ${falta} slot(s) em branco.</span> <button class="peq" id="m-branco-nao">Desfazer</button>` : `<button class="acao sec" id="m-branco">Montar com ${falta} slot(s) em branco</button>`;
    h += `</div>`;
  } else if (total && !aguardando) h += `<p class="ok">As páginas fecham em múltiplos de 18.</p>`;
  // o que da pasta NÃO entra na montagem (para conferir antes de gerar)
  const fora = [...padrao.map((x) => [x.nome, "verso padrão"]), ...(MONT.incluirExtras === false ? sobra.map((x) => [x.nome, "extra não incluído"]) : [])];
  if (fora.length) h += `<details class="conf"><summary class="suave">${fora.length} imagem(ns) da pasta <b>não entram</b> na montagem</summary><ul>${fora.slice(0, 40).map(([n, why]) => `<li>${esc(n)} <span class="suave">(${why})</span></li>`).join("")}${fora.length > 40 ? `<li class="suave">… e mais ${fora.length - 40}</li>` : ""}</ul></details>`;
  // por que o botão está travado (sempre dizer)
  const motivos = [];
  if (!total) motivos.push("não há nenhuma imagem para montar");
  if (MONT.incluirExtras === null) motivos.push("responda sobre as imagens fora do XML");
  if (aguardando) motivos.push(`faltam imagens para ${pendFalta} slot(s) pendente(s): suba-as ou escolha montar sem elas`);
  else if (falta && !MONT.permitirBranco) motivos.push(`complete os ${falta} slot(s) que faltam ou escolha montar com slots em branco`);
  if (motivos.length) h += `<p class="aviso">Montar PDFs está travado: ${motivos.join("; ")}.</p>`;
  plano.innerHTML = h;
  const ma = $("#m-atrib"); if (ma && window.desenharAtribuicao) window.desenharAtribuicao(ma, todosExtras, () => prepararMontagem(), true);  // qual imagem vale por qual carta pendente (e quantas cópias)
  const liga = (id, fn) => { const el = $("#" + id); if (el) el.onclick = async () => { fn(); await prepararMontagem(); }; };
  liga("m-extras-sim", () => (MONT.incluirExtras = true));
  liga("m-extras-nao", () => (MONT.incluirExtras = false));
  liga("m-extras-mudar", () => (MONT.incluirExtras = null));
  liga("m-branco", () => (MONT.permitirBranco = true));
  liga("m-branco-nao", () => (MONT.permitirBranco = false));
  liga("m-add-limpar", () => (MONT.adicionadas = []));
  liga("m-pend-ignorar", () => (MONT.ignorarPend = true));
  liga("m-pend-nao", () => (MONT.ignorarPend = false));
  const brl = $("#m-reler"); if (brl) brl.onclick = async () => { brl.disabled = true; brl.textContent = "Lendo a pasta…"; try { await relerPasta(); } catch (e) { /* mantém a pasta atual */ } await prepararMontagem(); };
  const bsg = $("#m-sg"); if (bsg) bsg.onclick = () => window.abrirSangriaMontagem && window.abrirSangriaMontagem();
  const addp = $("#m-add-pend"); if (addp) addp.onchange = async () => { MONT.adicionadas.push(...addp.files); await prepararMontagem(); };
  const add = $("#m-add");
  if (add) add.onchange = async () => { MONT.adicionadas.push(...add.files); await prepararMontagem(); };
  atualizarRotulos();
  $("#m-rodar").disabled = !MONT.pronta;
}

$("#m-rodar").addEventListener("click", async () => {
  const cliente = $("#m-cliente").value.trim() || "Pedido";
  const barra = $("#m-barra"), prog = barra.firstElementChild, status = $("#m-status"), saida = $("#m-saida");
  $("#m-rodar").disabled = true; barra.hidden = false; saida.innerHTML = ""; status.textContent = "Lendo a pasta…";
  let feitas = 0;
  try {
    if (sessao.pasta.recarregar) sessao.pasta = await sessao.pasta.recarregar();  // pega o que mudou na pasta desde a última vez
    await prepararMontagem();
    if (!MONT.pronta) { status.innerHTML = `<span class="alerta">A pasta mudou: responda as perguntas acima antes de montar.</span>`; return; }
    const p = sessao.pasta, { raizXml, extras } = MONT.plano;
    // extras numerados para a ordem ficar: imagens da pasta (alfabética), depois as adicionadas
    const todosExtras = [...extras, ...MONT.adicionadas.map((f) => ({ nome: f.name, ler: async () => f }))]
      .map((it, i) => ({ nome: String(i + 1).padStart(4, "0") + "_" + it.nome.replace(/[\\/]/g, "_"), ler: it.ler }));
    const grupos = [["raiz", raizXml], ["pares", p.pares], ["extras", todosExtras]];
    const total = grupos.reduce((n, [, it]) => n + it.length, 0);
    await chamar("iniciar_montagem");
    for (const [grupo, itens] of grupos) {
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
    $("#m-fim").hidden = false;
    for (const [nome, bytes] of pdfs) saida.append(baixar(new Blob([bytes], { type: "application/pdf" }), nome));
    if (p.drive) {
      const b = Object.assign(document.createElement("button"), { className: "acao", textContent: "Salvar PDFs no Drive (pasta saida)" });
      b.onclick = () => confirmar(saida, `Criar a pasta "saida" dentro de "${p.nome}" no Drive (se não existir) e enviar ${pdfs.length} PDF(s) para lá? PDFs que já existam lá com o mesmo nome (de uma montagem anterior) vão para a subpasta "anteriores": nada é apagado, e a saída fica só com a montagem atual.`, async (atualizar) => {
        const dir = await Drive.criarPasta("saida", p.drive.id);
        const novos = new Set(pdfs.map(([nome]) => nome));
        const antigos = (await Drive.listar(dir)).filter((f) => f.mimeType !== Drive.PASTA && novos.has(f.name));
        if (antigos.length) {
          const ant = await Drive.criarPasta("anteriores", dir);
          let m = 0;
          for (const f of antigos) { atualizar(`Guardando PDF anterior ${++m} de ${antigos.length} em saida/anteriores…`, 0); await Drive.mover(f.id, ant, dir); }
        }
        let n = 0;
        for (const [nome, bytes] of pdfs) { atualizar(`Enviando ${n + 1} de ${pdfs.length}: ${nome}…`, n / pdfs.length); await Drive.enviar(nome, new Blob([bytes], { type: "application/pdf" }), dir, "application/pdf"); n++; }
        return `${n} PDF(s) enviados para ${p.nome}/saida no Drive.` + (antigos.length ? ` ${antigos.length} PDF(s) de montagens anteriores foram para saida/anteriores.` : "");
      });
      saida.append(b);
    }
  } catch (e) {
    status.innerHTML = `<span class="alerta">${esc(e.message)}</span>`;
  }
  $("#m-rodar").disabled = !MONT.pronta;
});
