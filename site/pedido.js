"use strict";
// Fluxo do pedido: entrada → orçamento → conferência (bot local) → ficha e Pix. Usa as peças de app.js (sessao, chamar, pronto…).
const pedido = { fontes: [], alteracoes: [], modo: "normal", precos: {}, padrao: null };
const lerJson = (k, pad) => { try { return JSON.parse(guardado.ler(k)) || pad; } catch { return pad; } };

// ---------- entrada ----------
const LINHA = /^\s*(\d+)\s*x?\s+(.+?)\s*$/i;
function lerLista(texto) {
  const nomes = [];
  for (const bruta of texto.split(/\r?\n/)) {
    const m = bruta.match(LINHA);
    if (!m) continue;
    const nome = m[2].replace(/\s*\([A-Za-z0-9]{2,6}\)\s*\S*\s*(\*F\*)?$/, "").replace(/\s+\*F\*$/, "").trim();
    for (let i = 0; i < +m[1]; i++) nomes.push({ nome });
  }
  return nomes;
}
function lerXmlMpc(buf) {
  const txt = new TextDecoder().decode(buf);
  if (/<!DOCTYPE|<!ENTITY/i.test(txt)) throw new Error("XML recusado (DOCTYPE/ENTITY).");
  const doc = new DOMParser().parseFromString(txt, "application/xml");
  if (doc.querySelector("parsererror")) throw new Error("XML inválido.");
  const cartas = (tag) => {
    const saida = [];
    for (const c of doc.querySelectorAll(`${tag} > card`)) {
      const id = c.querySelector("id")?.textContent.trim();
      const ext = ((c.querySelector("name")?.textContent || "").match(/\.(jpe?g|png|webp)$/i) || [".jpg"])[0].toLowerCase();
      const nome = (c.querySelector("name")?.textContent || c.querySelector("query")?.textContent || id || "").replace(/\.(jpe?g|png|webp)$/i, "").replace(/\s*\([^)]{20,}\)\s*$/, "").replace(/(\w)_s\b/g, "$1's").trim();
      const slots = (c.querySelector("slots")?.textContent || "0").split(",").map((x) => x.trim()).filter((x) => x !== "");
      for (const s of (slots.length ? slots : ["0"])) saida.push({ nome, id, ext, slot: +s });
    }
    return saida;
  };
  const frentes = cartas("fronts"), todosVersos = cartas("backs");
  // Verso padrão: o da tag <cardback> e o verso repetido em quase todo o pedido (ex.: “Back WUBRG” em 186 slots).
  // Ele não conta como slot, não entra na ficha e sai da pasta no processo; só versos de dupla-face contam.
  const cardback = (doc.querySelector("cardback")?.textContent || "").trim();
  // É padrão (compartilhado) o verso da tag <cardback>, o verso que está em 3+ cartas DIFERENTES (verso de dupla-face é de uma carta só,
  // mesmo com várias cópias) e o que cobre 5+ slots e metade do pedido. Igual a nucleo/xml_mpc.py (versos_padrao).
  const frentePorSlot = new Map(frentes.map((f) => [f.slot, f.id]));
  const porId = new Map();
  for (const v of todosVersos) { const e = porId.get(v.id) || { nome: v.nome, qtd: 0, frentes: new Set() }; e.qtd++; if (frentePorSlot.has(v.slot)) e.frentes.add(frentePorSlot.get(v.slot)); porId.set(v.id, e); }
  const padraoIds = new Set([...porId].filter(([id, e]) => id === cardback || e.frentes.size >= 3 || e.qtd >= Math.max(5, frentes.length * 0.5)).map(([id]) => id));
  return { frentes, versos: todosVersos.filter((v) => !padraoIds.has(v.id)), xmlTexto: txt, padraoIds: [...padraoIds],
    versoPadrao: [...porId].filter(([id]) => padraoIds.has(id)).map(([, e]) => e) };
}
// Vários pedidos no mesmo pedido: a checagem e a montagem leem UM XML só, juntando os dos pedidos (slots em sequência).
const xmlEsc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
function xmlCombinado(fontes) {
  const xmls = fontes.filter((f) => f.xmlTexto);
  if (!xmls.length) return null;
  if (xmls.length === 1) return xmls[0].xmlTexto;
  let off = 0, fr = "", bk = "", total = 0; const cbs = [];
  const carta = (c, add) => {
    const q = (t) => c.querySelector(t)?.textContent || "";
    const slots = q("slots").split(",").map((s) => s.trim()).filter((s) => s !== "").map((s) => +s + add);
    return { id: q("id").trim(), slots, nome: q("name"), query: q("query") };
  };
  const xml = (c) => `<card><id>${xmlEsc(c.id)}</id><slots>${c.slots.join(",")}</slots><name>${xmlEsc(c.nome)}</name><query>${xmlEsc(c.query)}</query></card>`;
  for (const f of xmls) {
    const doc = new DOMParser().parseFromString(f.xmlTexto, "application/xml"), padrao = new Set(f.padraoIds || []);
    let maior = -1;
    for (const c of doc.querySelectorAll("fronts > card")) { const k = carta(c, off); fr += xml(k); total += k.slots.length; maior = Math.max(maior, ...k.slots.map((s) => s - off)); }
    for (const c of doc.querySelectorAll("backs > card")) { const k = carta(c, off); if (padrao.has(k.id)) cbs.push(k.id); else bk += xml(k); }
    for (const t of doc.querySelectorAll("cardback")) if (t.textContent.trim()) cbs.push(t.textContent.trim());
    off += maior + 1;
  }
  return `<?xml version="1.0" encoding="utf-8"?><order><details><quantity>${total}</quantity></details><fronts>${fr}</fronts><backs>${bk}</backs>${[...new Set(cbs)].map((i) => `<cardback>${xmlEsc(i)}</cardback>`).join("")}</order>`;
}
let ultimoXmlTexto = "", xmlDeFontes = false;
function sincronizarXml() {
  const x = xmlCombinado(pedido.fontes), n = pedido.fontes.filter((f) => f.xmlTexto).length;
  if (x === null) {  // nenhum pedido com XML: se o XML atual veio das fontes, solta
    if (xmlDeFontes) { sessao.xml = null; sessao.xmlNome = ""; sessao.conferencia = null; ultimoXmlTexto = ""; xmlDeFontes = false; atualizarRotulos(); }
    return;
  }
  if (x === ultimoXmlTexto) return;
  ultimoXmlTexto = x; xmlDeFontes = true;
  sessao.xml = new TextEncoder().encode(x).buffer;
  sessao.xmlNome = n === 1 ? pedido.fontes.find((f) => f.xmlTexto).titulo : `${n} pedidos combinados`;
  sessao.conferencia = null;  // o XML mudou: conferir de novo
  atualizarRotulos();
}
const assinatura = (f) => [...f.frentes, ...f.versos].map((c) => c.id || c.nome).join("|") + "#" + f.frentes.length;
function addFonte(f) {
  const i = pedido.fontes.findIndex((x) => assinatura(x) === assinatura(f));
  if (i >= 0) { pedido.fontes[i] = f; $("#e-erro").textContent = "Esse pedido já estava na lista: mantive uma cópia só."; }  // mesmo conteúdo (ex.: XML do arquivo e do bot)
  else pedido.fontes.push(f);
  renderFontes();
}
function renderFontes() {
  sincronizarXml();
  const c = $("#e-fontes");
  const mais = pedido.fontes.length > 0;
  $("#e-t-lista").textContent = mais ? "Adicionar outra lista" : "Lista colada";
  $("#e-t-xml").textContent = mais ? "Adicionar outro XML do MPCFill" : "XML do MPCFill";
  $("#e-t-deck").textContent = mais ? "Adicionar outra decklist" : "Imagens + decklist";
  $("#e-mais").innerHTML = mais ? `<p class="aviso">Já há ${pedido.fontes.length} pedido(s) neste pedido. Usar qualquer uma das entradas de novo <b>adiciona outro pedido</b> (não substitui o que já está aí). Para tirar um, use Remover.</p>` : "";
  c.innerHTML = (pedido.fontes.length > 1 ? `<p class="ok">${pedido.fontes.length} pedidos juntos neste pedido: os slots são somados e os kits incompletos se completam (veja a economia no Orçamento).</p>` : "") + pedido.fontes.map((f, i) => `<div class="fonte"><b>${esc(f.titulo)}</b><span class="suave">${f.frentes.length} frentes${f.versos.length ? " + " + f.versos.length + " versos" : ""}</span>${(f.versoPadrao || []).map((v) => `<span class="suave">· verso padrão “${esc(v.nome)}” (${v.qtd} slots) não conta</span>`).join("")}<button class="peq" data-rm="${i}">Remover</button></div>`).join("");
  c.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = () => { pedido.fontes.splice(+b.dataset.rm, 1); renderFontes(); }));
  atualizarResumo();
  atualizarPassos();
  preencherOrcamento();
  renderFicha();
}
// O bot só é necessário se algum pedido entrou como lista; XML (do MPCFill ou do bot) e imagens + decklist seguem direto.
const precisaBot = () => pedido.fontes.some((f) => f.origem === "lista");
const botDispensavel = () => pedido.fontes.length > 0 && !precisaBot();
function atualizarPassos() {
  const b = document.querySelector("#passos [data-aba=conferencia]");
  if (!b) return;
  const pular = botDispensavel();
  b.classList.toggle("pulada", pular);
  b.innerHTML = `<b>3</b> Conferência${pular ? ' <small>(não precisa)</small>' : ""}`;
}
const totais = () => ({
  frentes: pedido.fontes.reduce((n, f) => n + f.frentes.length, 0),
  versos: pedido.fontes.reduce((n, f) => n + f.versos.length, 0),
});
function atualizarResumo() {
  const t = totais();
  $("#resumo").innerHTML = pedido.fontes.length
    ? `<span><b>${t.frentes}</b> frentes</span><span><b>${t.versos}</b> versos</span><span><b>${t.frentes + t.versos}</b> slots</span><span><b>${Math.ceil((t.frentes + t.versos) / 18)}</b> páginas</span>`
    : `<span>Nenhum pedido carregado ainda.</span>`;
}
$("#e-lista-add").onclick = () => {
  const n = lerLista($("#e-lista").value);
  $("#e-erro").textContent = n.length ? "" : "Não achei nenhuma linha no formato “1 Nome” ou “2x Nome”.";
  if (n.length) { addFonte({ titulo: "Lista colada", origem: "lista", frentes: n, versos: [] }); $("#e-lista").value = ""; }
};
$("#e-xml").onchange = async (e) => {
  const arq = e.target.files[0]; if (!arq) return;
  e.target.value = "";  // o nome do arquivo fica na lista de pedidos; assim dá para adicionar outro sem confusão
  try {
    const buf = await arq.arrayBuffer();
    const r = lerXmlMpc(buf);
    $("#e-erro").textContent = "";
    addFonte({ titulo: arq.name, origem: "xml", ...r });  // a Checagem e a Montagem leem o XML combinado de todos os pedidos
  } catch (err) { $("#e-erro").textContent = err.message; }
};
$("#e-deck").onchange = async (e) => {
  const arq = e.target.files[0]; if (!arq) return;
  e.target.value = "";
  const n = lerLista(await arq.text());
  $("#e-erro").textContent = n.length ? "" : "A decklist está vazia ou fora do formato “2x Nome”.";
  if (n.length) addFonte({ titulo: "Decklist: " + arq.name, origem: "deco", frentes: n, versos: [] });
};

// ---------- orçamento ----------
async function carregarPrecos() {
  await pronto;
  pedido.padrao = await chamar("orcamento_padrao");
  const salvo = lerJson("precos", {});
  pedido.precos = { normal: { ...pedido.padrao.normal, ...(salvo.normal || {}) }, foil: { ...pedido.padrao.foil, ...(salvo.foil || {}) } };
  for (const m of ["normal", "foil"]) {  // quem tem um kit de até 18 slots quer o resto como kit fechado, a menos que já tenha escolhido
    const q = pedido.precos[m];
    if (q.resto_em_kit === undefined) q.resto_em_kit = !!menorKit(q) && menorKit(q).slots <= 18;
  }
  desenharPrecos();
  orcar();
}
const salvarPrecos = () => guardado.gravar("precos", JSON.stringify(pedido.precos));
function preencherOrcamento() {
  const t = totais();
  $("#o-frentes").value = t.frentes; $("#o-versos").value = t.versos;
  $("#o-origem").textContent = pedido.fontes.length ? `Vindo do pedido: ${pedido.fontes.map((f) => f.titulo).join(" + ")}. Pode ajustar os números à mão.` : "Sem pedido carregado: digite as quantidades à mão ou volte à etapa 1.";
  if (pedido.padrao) orcar();
}
const menorKit = (p) => p.kits.filter((k) => k.slots > 0).sort((x, y) => x.slots - y.slots)[0];
function precosEfetivos(modo) {
  const p = { ...pedido.precos[modo] }, k = menorKit(p);
  if (p.avulso_auto === true && k) p.avulso = k.preco / k.slots;  // avulso = preço do menor kit ÷ slots dele
  return p;
}
function desenharPrecos() {
  const modo = $("#o-modo").value, p = pedido.precos[modo];
  $("#o-kits").innerHTML = `<tr><th>Kit (slots)</th><th>Preço (R$)</th><th class="suave">Equivale a</th><th></th></tr>` + p.kits.map((k, i) =>
    `<tr><td><input type="number" min="1" data-k="${i}" data-c="slots" value="${k.slots}"></td><td><input type="number" min="0" step="0.01" data-k="${i}" data-c="preco" value="${k.preco}"></td>
     <td class="suave" id="o-eq-${i}"></td><td><button class="peq" data-krm="${i}">Remover</button></td></tr>`).join("");
  const campo = (id, rot, v, extra = "") => `<div><label>${rot}</label><input type="number" min="0" step="0.0001" data-p="${id}" value="${v}" ${extra}></div>`;
  const ef = precosEfetivos(modo), auto = p.avulso_auto === true;
  $("#o-campos").innerHTML = `<div><label>Preço por slot avulso (R$)</label><input type="number" min="0" step="0.0001" data-p="avulso" value="${+ef.avulso.toFixed(4)}" ${auto ? "disabled" : ""}>
      <label style="display:flex;gap:6px;align-items:center;margin-top:4px"><input type="checkbox" id="o-avulso-auto" ${auto ? "checked" : ""}> calcular pelo menor kit</label>
      <label style="display:flex;gap:6px;align-items:center;margin-top:4px"><input type="checkbox" id="o-resto-kit" ${p.resto_em_kit ? "checked" : ""}> o que sobrar vira um kit do menor tamanho</label></div>` +
    campo("colagem", "Colagem por slot (R$)", p.colagem) +
    (p.impressao_pagina !== undefined ? campo("impressao_pagina", "Impressão por página (R$)", p.impressao_pagina)
      : campo("impressao_kit", "Impressão por kit foil (R$)", p.impressao_kit) + campo("impressao_pagina_extra", "Página extra foil (R$)", p.impressao_pagina_extra));
  const eq = () => p.kits.forEach((k, i) => { const el = $("#o-eq-" + i); if (el) el.textContent = k.slots > 0 ? `${Math.ceil(k.slots / 18)} página(s) · R$ ${fmt(k.preco / k.slots)}/slot` : ""; });
  eq();
  $("#o-kits").querySelectorAll("input").forEach((el) => (el.oninput = () => { p.kits[+el.dataset.k][el.dataset.c] = +el.value; salvarPrecos(); eq(); const av = $("#o-campos [data-p=avulso]"); if (p.avulso_auto === true) av.value = +precosEfetivos(modo).avulso.toFixed(4); orcar(); }));
  $("#o-kits").querySelectorAll("[data-krm]").forEach((b) => (b.onclick = () => { p.kits.splice(+b.dataset.krm, 1); salvarPrecos(); desenharPrecos(); orcar(); }));
  $("#o-campos").querySelectorAll("input[data-p]").forEach((el) => (el.oninput = () => { p[el.dataset.p] = +el.value; salvarPrecos(); orcar(); }));
  $("#o-resto-kit").onchange = (e) => { p.resto_em_kit = e.target.checked; salvarPrecos(); orcar(); };
  $("#o-avulso-auto").onchange = (e) => { p.avulso_auto = e.target.checked; if (!e.target.checked) p.avulso = +precosEfetivos(modo).avulso.toFixed(4); salvarPrecos(); desenharPrecos(); orcar(); };
}
$("#o-kit-add").onclick = () => { pedido.precos[$("#o-modo").value].kits.push({ slots: 18, preco: 30 }); salvarPrecos(); desenharPrecos(); orcar(); };
$("#o-restaurar").onclick = () => { pedido.precos[$("#o-modo").value] = JSON.parse(JSON.stringify(pedido.padrao[$("#o-modo").value])); salvarPrecos(); desenharPrecos(); orcar(); };
let ultimoOrc = null, pagoEditado = false;
async function orcar() {
  if (!pedido.padrao) return;
  pedido.modo = $("#o-modo").value;
  const pr = precosEfetivos(pedido.modo);
  ultimoOrc = await chamar("orcar", { frentes: +$("#o-frentes").value || 0, versos: +$("#o-versos").value || 0, modo: pedido.modo, precos: pr });
  const r = ultimoOrc;
  if (!pagoEditado) $("#o-pago").value = r.pago;  // o valor cobrado começa igual ao calculado
  const pago = valorFinal();
  // divisão automática: primeiro os kits maiores, depois os menores; o que sobra vira um kit final, cobrado pelo preço avulso
  const contas = [...r.usados.map((u) => `${u.qtd} × kit de ${u.slots} slots (${u.qtd * u.slots / 18} pág.) = ${reais(u.qtd * u.preco)}`),
    ...(r.kit_final ? [r.kit_final.kit
      ? `${r.kit_final.qtd} × kit final de ${r.kit_final.kit} slots (sobraram ${r.kit_final.slots}) = ${reais(r.kit_final.preco)}`
      : `${r.kit_final.slots} slots avulsos × R$ ${fmt(pr.avulso)} = ${reais(r.kit_final.preco)}`] : [])];
  $("#o-tabela").innerHTML = [
    ["Slots (frentes + versos)", r.slots], ["Páginas A3", r.paginas],
    ["Como o valor foi calculado", contas.length ? contas.join("<br>") + `<br><span class="suave">total: ${reais(r.pago)}</span>` : "—"],
    ["Valor cobrado do cliente" + (pago !== r.pago ? " (combinado)" : ""), `<b>${reais(pago)}</b>`],
    [`<span class="aviso">Só para você</span> · impressão`, reais(r.impressao)], ["Colagem", reais(r.colagem)], ["Lucro", reais(pago - r.impressao - r.colagem)],
  ].map(([k, v]) => `<tr><td>${k}</td><td class="n">${v}</td></tr>`).join("");
  desenharDescontos(r);
  desenharJuntos(r);
  $("#o-pago-auto").disabled = !pagoEditado;
  renderFicha();
}
// Vários pedidos no mesmo pedido: quanto cada um custaria sozinho × todos juntos (kits incompletos se completam)
let juntosSeq = 0;
async function desenharJuntos(r) {
  const el = $("#o-juntos"), seq = ++juntosSeq;
  if (pedido.fontes.length < 2) { el.innerHTML = ""; return; }
  const pr = precosEfetivos(pedido.modo), sep = [];
  for (const f of pedido.fontes) {
    const n = f.frentes.length + f.versos.length;
    sep.push([f.titulo, n, (await chamar("orcar", { frentes: n, versos: 0, modo: pedido.modo, precos: pr })).pago]);
    if (seq !== juntosSeq) return;  // chegou um cálculo mais novo
  }
  const soma = sep.reduce((s, x) => s + x[2], 0);
  el.innerHTML = `<b>Pedidos juntos × separados</b><table>` + sep.map(([t, n, v]) => `<tr><td>${esc(t)} <span class="suave">(${n} slots)</span></td><td class="n">${reais(v)}</td></tr>`).join("") +
    `<tr><td>Soma dos pedidos separados</td><td class="n">${reais(soma)}</td></tr><tr><td>Juntos (${r.slots} slots)</td><td class="n"><b>${reais(r.pago)}</b></td></tr>
    <tr><td>Economia ao juntar</td><td class="n ${soma - r.pago > 0 ? "ok" : ""}">${reais(soma - r.pago)}</td></tr></table>`;
}
// Descontos possíveis (confidencial): (1) todos os slots a um preço fixo por slot; (2) ceder uma % do lucro.
let descSlotEditado = false;
function desenharDescontos(r) {
  if (!r.slots) { $("#d-tabela").innerHTML = ""; return; }
  const p = pedido.precos[pedido.modo];
  if (!descSlotEditado) {  // começa no menor preço por slot que a tabela já pratica (o "primeiro nível", ex.: 135 ÷ 108 = 1,25)
    const taxas = p.kits.filter((k) => k.slots > 0).map((k) => k.preco / k.slots);
    $("#d-slot").value = taxas.length ? +Math.min(...taxas).toFixed(4) : "";
  }
  const slot = +$("#d-slot").value || 0, pct = Math.min(Math.max(+$("#d-pct").value || 0, 0), 100);
  const cede = Math.round(r.pago * pct / 100);  // a % é do valor do pedido (não do lucro: o lucro nunca aparece para o cliente)
  const custo = r.impressao + r.colagem, lucro = r.pago - custo;
  const linhas = [
    [`Todos os ${r.slots} slots a R$ ${fmt(slot)}`, Math.round(r.slots * slot)],
    [`Desconto de ${pct}% sobre o pedido (R$ ${fmt(r.pago * pct / 100)})`, r.pago - cede],
  ];
  $("#d-tabela").innerHTML = `<tr><th>Opção</th><th class="n">Preço</th><th class="n">Desconto</th><th class="n">Lucro</th><th></th></tr>` + linhas.map(([rot, preco], i) => {
    const desc = r.pago - preco, lu = preco - custo, igual = preco === valorFinal();
    return `<tr><td>${rot}</td><td class="n">${reais(preco)}</td><td class="n">${desc > 0 ? "− " + reais(desc) : desc < 0 ? "+ " + reais(-desc) + " (acima da tabela)" : "—"}</td>
      <td class="n ${lu < 0 ? "alerta" : ""}">${reais(lu)}${lu < 0 ? " (prejuízo)" : ""}</td><td><button class="peq" data-aplicar="${preco}" ${igual ? "disabled" : ""}>${igual ? "Aplicado" : "Aplicar"}</button></td></tr>`;
  }).join("");
  $("#d-tabela").querySelectorAll("[data-aplicar]").forEach((b) => (b.onclick = () => { $("#o-pago").value = b.dataset.aplicar; pagoEditado = true; orcar(); }));
}
$("#d-slot").addEventListener("input", () => { descSlotEditado = $("#d-slot").value !== ""; orcar(); });
$("#d-pct").addEventListener("input", orcar);
const valorFinal = () => ($("#o-pago").value !== "" ? +$("#o-pago").value : ultimoOrc ? ultimoOrc.pago : 0);
$("#o-pago").addEventListener("input", () => { pagoEditado = $("#o-pago").value !== ""; orcar(); });
$("#o-pago-auto").onclick = () => { pagoEditado = false; orcar(); };
["#o-frentes", "#o-versos"].forEach((s) => $(s).addEventListener("input", orcar));
$("#o-modo").addEventListener("change", () => { desenharPrecos(); orcar(); });

// ---------- conferência (motor local do bot) ----------
const MOTOR = "http://127.0.0.1:8781";
const BOT_ZIP = "https://github.com/ChChelis/Chelisplace_Converter/releases/download/bot-latest/Chelisplace_Simba_bot.zip";
let pingBot = null;  // enquanto a página está aberta e o bot conectado, avisa o bot que ainda é usado (ele fecha sozinho sem uso)
const manterBot = () => { if (!pingBot) pingBot = setInterval(() => fetch(MOTOR + "/api/estado").catch(() => {}), 20000); };
async function abrirBot(alvo) {
  // o bot registra o endereço chelisbot:// no Windows na primeira vez que roda; o navegador pergunta se pode abrir
  const a = Object.assign(document.createElement("a"), { href: "chelisbot://abrir" });
  document.body.append(a); a.click(); a.remove();
  alvo.textContent = "Abrindo o bot… (se o navegador perguntar, permita abrir o aplicativo)";
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    try { await fetch(MOTOR + "/api/estado"); return procurarBot(); } catch {}
  }
  alvo.innerHTML = `<span class="aviso">O bot não abriu.</span> Se é a primeira vez, baixe e abra o programa uma vez pelo botão abaixo.`;
}
async function procurarBot() {
  const alvo = $("#b-estado"), lista = $("#b-pedidos");
  alvo.textContent = "Procurando o bot…"; lista.innerHTML = "";
  try {
    const est = await (await fetch(MOTOR + "/api/estado")).json();
    alvo.innerHTML = `<span class="ok">Bot conectado</span> <span class="suave">(versão ${esc(est.versao)})</span> <button class="peq" id="b-de-novo">Atualizar</button> <a href="${MOTOR}/" target="_blank" rel="noopener">Abrir a conferência do bot</a>`;
    $("#b-de-novo").onclick = procurarBot;
    alvo.insertAdjacentHTML("beforeend", ` <button class="peq" id="b-sair">Fechar o bot</button>`);
    $("#b-sair").onclick = async () => { try { await fetch(MOTOR + "/api/sair", { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } }); } catch {} clearInterval(pingBot); pingBot = null; setTimeout(procurarBot, 800); };
    manterBot();
    const peds = await (await fetch(MOTOR + "/api/pedidos")).json();
    lista.innerHTML = peds.length ? "<h3>Pedidos do bot</h3>" : `<p class="suave">O bot ainda não tem pedidos. Abra-o e use “+ Novo pedido”.</p>`;
    for (const p of peds) {
      const b = Object.assign(document.createElement("button"), { className: "acao sec", textContent: `Usar o XML de ${p.nome}` });
      b.onclick = async () => {
        try {
          const r = await fetch(`${MOTOR}/api/pedidos/${encodeURIComponent(p.nome)}/xml`);
          if (!r.ok) throw new Error("Esse pedido ainda não tem XML: gere-o na conferência do bot.");
          const buf = await r.arrayBuffer();
          const novo = lerXmlMpc(buf);
          // o XML do bot substitui a lista que deu origem a ele (a de mesmo tamanho; senão, a primeira lista)
          let k = pedido.fontes.findIndex((f) => f.origem === "lista" && f.frentes.length === novo.frentes.length);
          if (k < 0) k = pedido.fontes.findIndex((f) => f.origem === "lista");
          if (k >= 0) pedido.fontes.splice(k, 1);
          addFonte({ titulo: p.nome + " (bot)", origem: "bot", ...novo });
          b.textContent = "XML carregado ✓"; b.disabled = true;
        } catch (e) { lista.insertAdjacentHTML("beforeend", `<p class="alerta">${esc(e.message)}</p>`); }
      };
      lista.append(b);
      const av = Object.assign(document.createElement("button"), { className: "acao sec", textContent: `Cartas sem versão próxima de ${p.nome}` });
      av.onclick = () => cartasParaAvisar(p.nome, lista);
      lista.append(av);
    }
  } catch {
    clearInterval(pingBot); pingBot = null;
    alvo.innerHTML = `<span class="aviso">Bot não encontrado.</span>
      <button class="acao" id="b-abrir">Abrir o bot</button>
      <a class="acao sec" style="text-decoration:none;display:inline-block" href="${BOT_ZIP}" id="b-baixar">Baixar o bot (Windows)</a>
      <button class="peq" id="b-de-novo">Procurar de novo</button>
      <p class="suave">Primeira vez: baixe o zip (<b>Chelisplace_Simba_bot.zip</b>), extraia — a pasta já sai como “Chelisplace_Simba (bot)” — e abra o <b>Chelisplace_Simba (bot).exe</b> uma vez (o Windows pode avisar que o programa é desconhecido: “Mais informações” → “Executar assim mesmo”). Depois disso, o botão <b>Abrir o bot</b> desta página basta. O bot abre minimizado e fecha sozinho quando você para de usar a página.</p>`;
    $("#b-de-novo").onclick = procurarBot;
    $("#b-abrir").onclick = () => abrirBot(alvo);
  }
}

// Cartas em que o cliente precisa ser avisado, com miniatura do que ele pediu (Scryfall) e do que foi usado (MPCFill).
async function cartasParaAvisar(nome, lista) {
  let caixa = document.getElementById("b-avisar");
  caixa?.remove();
  caixa = Object.assign(document.createElement("div"), { id: "b-avisar", className: "conf", textContent: "Lendo o pedido no bot…" });
  lista.append(caixa);
  try {
    const q = encodeURIComponent(nome);
    const [cat, dec] = await Promise.all([fetch(`${MOTOR}/api/pedidos/${q}/catalogo`).then((r) => r.json()), fetch(`${MOTOR}/api/pedidos/${q}/decisoes`).then((r) => r.json())]);
    const achados = [];
    for (const c of cat.cards || []) {
      if (c.face) continue;  // versos seguem a frente
      const d = dec[c.id] || {};
      const semProxima = c.prop && c.prop.conf === "nenhum";
      if (d.status !== "nenhum" && !(semProxima && d.status === "ok")) continue;
      const usadoId = d.status === "ok" ? (d.accept_ids && d.accept_ids[0]) || (c.cands[0] && c.cands[0].id) || "" : "";
      const rotulo = `${c.name}${c.set && c.set !== "LIGA" ? ` (${c.set.toUpperCase()} ${c.cn})` : ""}`;
      achados.push({ texto: d.status === "ok" ? `${rotulo}: não achei a versão pedida; usei a mais próxima` : `${rotulo}: sem versão disponível, ficou de fora`,
        pedido_img: scryImg(c.set, c.cn), usado_img: usadoId ? miniUrl(usadoId) : "" });
    }
    caixa.innerHTML = achados.length ? `<b>${achados.length} carta(s) para avisar o cliente:</b>` : `<span class="ok">Nenhuma carta sem versão próxima nas decisões deste pedido.</span>`;
    if (!achados.length) return;
    for (const it of achados) caixa.insertAdjacentHTML("beforeend", `<div class="item">${it.pedido_img ? `<img src="${esc(it.pedido_img)}" height="64" alt="">` : ""}${it.usado_img ? `<img src="${esc(it.usado_img)}" height="64" alt="">` : ""} ${esc(it.texto)}</div>`);
    const b = Object.assign(document.createElement("button"), { className: "acao", textContent: "Levar para a ficha como alteração" });
    b.onclick = () => { pedido.alteracoes.push({ titulo: "Cartas sem versão próxima", itens: achados }); renderAlteracoes(); renderFicha(); b.textContent = "Levado para a etapa 5 ✓"; b.disabled = true; };
    caixa.append(b);
  } catch (e) { caixa.innerHTML = `<span class="alerta">${esc(e.message)}</span>`; }
}

// ---------- ficha, mensagem ao cliente e Pix ----------
const idDrive = (t) => { const m = (t || "").match(/[-\w]{25,}/); return m ? m[0] : ""; };
const miniUrl = (id) => `https://drive.google.com/thumbnail?id=${id}&sz=w200`;
const urlPedido = (it) => it.pedido_img || (it.pedido_id ? miniUrl(it.pedido_id) : "");
const urlUsado = (it) => it.usado_img || (it.usado_id ? miniUrl(it.usado_id) : "");
const scryImg = (set, cn) => (set && cn && set !== "LIGA" ? `https://api.scryfall.com/cards/${encodeURIComponent(set.toLowerCase())}/${encodeURIComponent(cn)}?format=image&version=small` : "");
function renderAlteracoes() {
  const c = $("#f-alt");
  c.innerHTML = pedido.alteracoes.map((a, i) => `<div class="alt"><input type="text" data-a="${i}" data-f="titulo" value="${esc(a.titulo)}" placeholder="Título (ex.: Troca de arte)"><button class="peq" data-arm="${i}">Remover</button>` +
    a.itens.map((it, j) => `<div class="item"><input type="text" size="28" data-a="${i}" data-j="${j}" data-f="texto" value="${esc(it.texto)}" placeholder="Carta e o que mudou">
      <input type="text" size="18" data-a="${i}" data-j="${j}" data-f="pedido_id" value="${esc(it.pedido_id || "")}" placeholder="Link/ID do que pediu">${urlPedido(it) ? `<img src="${esc(urlPedido(it))}" alt="">` : ""}
      <input type="text" size="18" data-a="${i}" data-j="${j}" data-f="usado_id" value="${esc(it.usado_id || "")}" placeholder="Link/ID do que usou">${urlUsado(it) ? `<img src="${esc(urlUsado(it))}" alt="">` : ""}</div>`).join("") +
    `<button class="peq" data-iadd="${i}">+ carta</button></div>`).join("");
  c.querySelectorAll("input").forEach((el) => (el.onchange = () => {
    const a = pedido.alteracoes[+el.dataset.a], f = el.dataset.f;
    if (el.dataset.j === undefined) a[f] = el.value;
    else {
      const v = f.endsWith("_id") ? idDrive(el.value) : el.value;
      a.itens[+el.dataset.j][f] = v;
      if (f.endsWith("_id")) {  // só atualiza a miniatura ao lado, sem refazer a lista (não perde o foco)
        el.value = v;
        let img = el.nextElementSibling;
        if (!(img && img.tagName === "IMG")) { img = document.createElement("img"); el.after(img); }
        a.itens[+el.dataset.j][f.replace("_id", "_img")] = "";  // o ID digitado vale mais que a miniatura vinda do bot
        v ? (img.src = miniUrl(v)) : img.remove();
      }
    }
    renderFicha();
  }));
  c.querySelectorAll("[data-arm]").forEach((b) => (b.onclick = () => { pedido.alteracoes.splice(+b.dataset.arm, 1); renderAlteracoes(); renderFicha(); }));
  c.querySelectorAll("[data-iadd]").forEach((b) => (b.onclick = () => { pedido.alteracoes[+b.dataset.iadd].itens.push({ texto: "" }); renderAlteracoes(); }));
}
$("#f-alt-add").onclick = () => { pedido.alteracoes.push({ titulo: "", itens: [{ texto: "" }] }); renderAlteracoes(); };
["#f-cliente", "#f-tel", "#f-conclusao"].forEach((s) => $(s).addEventListener("input", () => { if (s === "#f-cliente" && !clienteEditado) $("#m-cliente").value = $(s).value; renderFicha(); }));

let fichaMd = "", fichaManual = false;
$("#f-previa").addEventListener("input", () => { fichaManual = true; fichaMd = $("#f-previa").value; });
$("#f-refazer").onclick = () => { fichaManual = false; renderFicha(); };
async function renderFicha() {
  if (!pedido.padrao) return;
  const alts = pedido.alteracoes.filter((a) => a.titulo.trim() && a.itens.some((i) => i.texto.trim())).map((a) => ({ ...a, itens: a.itens.filter((i) => i.texto.trim()) }));
  try {
    const r = await chamar("ficha", {
      cliente: $("#f-cliente").value.trim() || "<CLIENTE>", telefone: $("#f-tel").value.trim() || "<TELEFONE>",
      fontes: pedido.fontes.map((f) => ({ titulo: f.titulo, frentes: f.frentes.map((x) => x.nome), versos: f.versos.map((x) => x.nome) })),
      alteracoes: alts, conclusao: $("#f-conclusao").value.trim(), modo: pedido.modo, precos: precosEfetivos(pedido.modo),
      chave_pix: $("#p-chave").value.trim() || "<CHAVE_PIX>", pago: ultimoOrc ? valorFinal() : null,
      descontos: { slot: +$("#d-slot").value || null, pct: $("#d-pct").value === "" ? 10 : +$("#d-pct").value }, slots_orc: ultimoOrc ? ultimoOrc.slots : null,
    });
    if (!fichaManual) { fichaMd = r.markdown; $("#f-previa").value = fichaMd; }
  } catch (e) { if (!fichaManual) $("#f-previa").value = "Erro: " + e.message; }
}
async function copiar(texto, html, aviso) {
  try {
    if (html && window.ClipboardItem) await navigator.clipboard.write([new ClipboardItem({ "text/plain": new Blob([texto], { type: "text/plain" }), "text/html": new Blob([html], { type: "text/html" }) })]);
    else await navigator.clipboard.writeText(texto);
    $("#f-aviso").textContent = aviso;
  } catch (e) { $("#f-aviso").textContent = "Não consegui copiar: " + e.message; }
}
$("#f-copiar").onclick = () => copiar(fichaMd, null, "Texto da ficha copiado: cole no Obsidian (só texto; as miniaturas ficam no PDF).");
$("#f-msg").onclick = () => {
  const nome = $("#f-cliente").value.trim();
  const linhas = pedido.alteracoes.flatMap((a) => a.itens.filter((i) => i.texto.trim()).map((i) => "• " + i.texto.trim()));
  const html = pedido.alteracoes.flatMap((a) => a.itens.filter((i) => i.texto.trim()).map((i) => `<p>${esc(i.texto)}<br>` + [urlPedido(i), urlUsado(i)].filter(Boolean).map((u) => `<img src="${esc(u)}" height="120">`).join(" ") + "</p>")).join("");
  const texto = `Oi${nome ? ", " + nome : ""}! Sobre o seu pedido:\n\n${linhas.join("\n") || "(nenhuma alteração registrada)"}\n\n${$("#f-conclusao").value.trim()}`.trim();
  copiar(texto, `<p>${esc(texto.split("\n")[0])}</p>${html}<p>${esc($("#f-conclusao").value.trim())}</p>`, "Mensagem copiada (com miniaturas, se o destino aceitar imagens; senão, só o texto).");
};

["p-chave", "p-nome", "p-cidade"].forEach((id) => { $("#" + id).value = guardado.ler(id); $("#" + id).addEventListener("input", () => { guardado.gravar(id, $("#" + id).value); if (id === "p-chave") renderFicha(); }); });
$("#p-pdf").onclick = async () => {
  const av = $("#p-aviso"), saida = $("#p-saida"); saida.innerHTML = ""; av.textContent = "";
  try {
    await pronto;
    const valor = ultimoOrc ? valorFinal() : null;
    const codigo = await chamar("pix_codigo", { chave: $("#p-chave").value, nome: $("#p-nome").value || "Chelisplace", cidade: $("#p-cidade").value || "Sao Paulo", valor });
    const qr = qrcode(0, "M"); qr.addData(codigo); qr.make();
    const n = qr.getModuleCount(), matriz = Array.from({ length: n }, (_, y) => Array.from({ length: n }, (_, x) => (qr.isDark(y, x) ? 1 : 0)));
    const bytes = await chamar("pix_pdf", { matriz, codigo, cliente: $("#f-cliente").value.trim() || "Pedido", valor });
    saida.append(baixar(new Blob([bytes], { type: "application/pdf" }), `Pix ${$("#f-cliente").value.trim() || "pedido"}.pdf`));
  } catch (e) { av.textContent = e.message; }
};

// baixa a miniatura para o PDF: direto (Scryfall aceita), senão pelo Drive logado, senão pelo cache do bot
async function bytesDaMiniatura(url) {
  const id = (url.match(/[?&]id=([-\w]+)/) || [])[1];
  const tentativas = [() => fetch(url).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject()))];
  if (id && typeof Drive !== "undefined" && Drive.conectado()) tentativas.push(() => Drive.baixar(id));
  if (id) tentativas.push(() => fetch(`${MOTOR}/img/mpc/${id}`).then((r) => (r.ok ? r.arrayBuffer() : Promise.reject())));
  for (const t of tentativas) { try { const b = await t(); if (b && b.byteLength) return new Uint8Array(b); } catch {} }
  return null;
}
// PDF = a própria ficha (texto de cima, editado ou não) desenhada em A4, sem a parte confidencial, com o QR do Pix no fim
async function gerarPdf(av) {
  await pronto;
  const itens = pedido.alteracoes.flatMap((a) => a.itens.filter((i) => i.texto.trim()));
  const miniaturas = Object.fromEntries(itens.map((i) => [i.texto.trim(), [urlPedido(i), urlUsado(i)].filter(Boolean)]));
  const urls = [...new Set(Object.values(miniaturas).flat())];
  const imagens = [];
  for (const u of urls) { const b = await bytesDaMiniatura(u); if (b) imagens.push([u, b]); }
  let matriz = null;
  const chave = $("#p-chave").value.trim();
  if (chave) {
    const codigo = await chamar("pix_codigo", { chave, nome: $("#p-nome").value || "Chelisplace", cidade: $("#p-cidade").value || "Sao Paulo", valor: ultimoOrc ? valorFinal() : null });
    const qr = qrcode(0, "M"); qr.addData(codigo); qr.make();
    const n = qr.getModuleCount(); matriz = Array.from({ length: n }, (_, y) => Array.from({ length: n }, (_, x) => (qr.isDark(y, x) ? 1 : 0)));
  }
  const md = chave ? fichaMd : fichaMd.replace(/### Pix\n.*\n?$/, "");  // sem chave, o PDF sai sem a parte do Pix
  const bytes = await chamar("ficha_pdf", { md, imagens, miniaturas, matriz });
  const sem = urls.length - imagens.length;
  av.textContent = (sem ? `PDF pronto, mas ${sem} miniatura(s) não puderam ser baixadas (entre no Drive ou abra o bot). ` : "PDF pronto. ") + (chave ? "" : "Sem chave Pix: saiu sem QR.");
  return bytes;
}
const nomeArq = () => `Pedido ${$("#f-cliente").value.trim() || "cliente"}`;
const salvar = (blob, nome) => { const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(blob), download: nome }); document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 4000); };
const baixarMd = () => salvar(new Blob([fichaMd], { type: "text/markdown;charset=utf-8" }), nomeArq() + ".md");
const botaoPdf = (fn) => async () => { const av = $("#f-aviso"); av.textContent = "Montando o PDF…"; try { await fn(av); } catch (e) { av.textContent = e.message; } };
$("#f-md").onclick = baixarMd;
$("#f-pdf").onclick = botaoPdf(async (av) => { salvar(new Blob([await gerarPdf(av)], { type: "application/pdf" }), nomeArq() + ".pdf"); });
$("#f-tudo").onclick = botaoPdf(async (av) => {
  const bytes = await gerarPdf(av);
  baixarMd();
  setTimeout(() => salvar(new Blob([bytes], { type: "application/pdf" }), nomeArq() + ".pdf"), 600);  // o navegador pode pedir licença para baixar dois arquivos
  av.textContent += " Baixando o .md e o PDF (se o navegador perguntar, permita vários downloads).";
});
$("#f-copiar").textContent = "Copiar texto da ficha (Obsidian)";

// ---------- imagens do XML direto para o Drive (cópia feita pelo próprio Drive, sem baixar nada) ----------
function nomeNoDrive(c) { return `${c.nome.replace(/[\\/:*?"<>|]/g, "_")} (${c.id})${c.ext || ".jpg"}`; }
let copiando = false;
function desenharEnvio() {
  const alvo = $("#c-enviar");
  const cartas = new Map();
  for (const f of pedido.fontes) for (const c of [...f.frentes, ...f.versos]) if (c.id && !cartas.has(c.id)) cartas.set(c.id, c);
  if (!cartas.size) { alvo.innerHTML = ""; return; }
  const nomePedido = (sessao.pasta && sessao.pasta.nome) || ($("#f-cliente").value.trim()) || (pedido.fontes[0].titulo.replace(/\.xml$/i, "").replace(/ \(bot\)$/, ""));
  alvo.innerHTML = `<div class="conf"><b>Imagens do XML (${cartas.size} arquivos distintos)</b><p class="suave">Se a pasta do pedido ainda não tem as imagens, a página pode copiá-las para o seu Drive, pelo próprio Drive (nada é baixado no seu computador). Requer o login do Google.</p>
    <label for="c-env-nome">Pasta do pedido em “${esc(Drive.NOME_RAIZ)}”</label><input id="c-env-nome" type="text" size="36" value="${esc(nomePedido)}">
    <br><button class="acao" id="c-env-ir">Enviar as imagens para o Drive</button><div id="c-env-saida"></div></div>`;
  // se a pasta escolhida já tem todas as imagens do XML, o botão não tem mais o que fazer
  const p0 = sessao.pasta;
  if (p0 && p0.drive) {
    const tem = new Set([...p0.raiz, ...p0.pares].map((x) => (x.nome.match(/\(([A-Za-z0-9_-]{20,})\)\.[A-Za-z0-9]+$/) || [])[1]).filter(Boolean));
    if ([...cartas.keys()].every((id) => tem.has(id))) { $("#c-env-ir").disabled = true; $("#c-env-ir").textContent = "Imagens já estão no Drive ✓"; }
  }
  $("#c-env-ir").onclick = () => {
    const nome = $("#c-env-nome").value.trim(), saida = $("#c-env-saida");
    if (!nome) { saida.innerHTML = `<span class="alerta">Dê um nome à pasta do pedido.</span>`; return; }
    if (!Drive.conectado()) { saida.innerHTML = `<span class="alerta">Entre com o Google no quadro “Google Drive” (no alto da página) primeiro.</span>`; return; }
    confirmar(saida, `Criar (ou reaproveitar) a pasta “${nome}” dentro de “${Drive.NOME_RAIZ}” e copiar para ela ${cartas.size} imagem(ns)? Arquivos que já estiverem lá são pulados; nada é apagado.`, async (atualizar) => {
      copiando = true;
      try {
      const raizId = await Drive.raiz();
      const existentes = (await Drive.listar(raizId, ` and mimeType='${Drive.PASTA}'`)).find((x) => x.name === nome);
      const pastaId = existentes ? existentes.id : await Drive.criarPasta(nome, raizId);
      const ja = new Set((await Drive.listar(pastaId)).map((x) => (x.name.match(/\(([A-Za-z0-9_-]{20,})\)\.[A-Za-z0-9]+$/) || [])[1]).filter(Boolean));
      const falhas = []; let feitas = 0, puladas = 0;
      const fila = [...cartas.values()];
      const totalCopias = fila.length;
      atualizar("Preparando a pasta no Drive…", 0.02);
      const progresso = () => { const k = feitas + puladas + falhas.length; atualizar(`Copiando imagens: ${k} de ${totalCopias}… (${feitas} copiadas, ${puladas} já estavam lá${falhas.length ? `, ${falhas.length} com erro` : ""})`, k / totalCopias); };
      await Promise.all(Array.from({ length: 4 }, async () => {
        while (fila.length) {
          const c = fila.shift();
          if (ja.has(c.id)) { puladas++; progresso(); continue; }
          try { await Drive.copiar(c.id, nomeNoDrive(c), pastaId); feitas++; } catch (e) { falhas.push(`${c.nome}: ${e.message}`); }
          progresso();
        }
      }));
      sessao.pasta = await montarPastaDrive({ id: pastaId, name: nome });  // a etapa 4 já abre nesta pasta
      carregarIgnorados(); atualizarRotulos();
      $("#c-env-ir").disabled = true; $("#c-env-ir").textContent = "Imagens já estão no Drive ✓"; sessao.conferencia = null;
      return `${feitas} copiada(s), ${puladas} já estava(m) lá` + (falhas.length ? `, ${falhas.length} falharam (${falhas.slice(0, 3).join("; ")}${falhas.length > 3 ? "…" : ""}). Essas precisam ser baixadas pelo bot (tela “XML e imagens” dele) para a pasta do pedido.` : ". Pasta pronta: clique em Conferir.");
      } finally { copiando = false; }
    });
  };
}

window.aoAbrirAba = (aba) => {
  if (aba === "checagem") desenharEnvio();
  if (aba === "conferencia") {
    const av = $("#b-aviso");
    av.innerHTML = botDispensavel() ? `<p class="ok">Seu pedido já veio de XML ou de imagens: <b>esta etapa não é necessária</b>. Siga para a etapa 4.</p>` :
      precisaBot() ? `<p class="aviso">Seu pedido entrou como lista: o bot é necessário para achar as imagens e gerar o XML.</p>` : "";
    procurarBot();
  }
  if (aba === "ficha") { if (!$("#f-cliente").value && sessao.pasta) $("#f-cliente").value = sessao.pasta.nome; renderFicha(); }
};
renderFontes(); renderAlteracoes();
pronto.then(carregarPrecos);

// ---------- Correção de sangria (botão separado; processo do HANDOFF_SANGRIA) ----------
// 816x1110 RGBA, carta 744x1040 centralizada, 299.9994 dpi; modos por imagem: borda (padrão), branco, preto. Nunca sobrescreve sem guardar a original.
const SG = { itens: [], mostrarComId: false, rodando: false };
const semIdNoNome = (n) => !/\(([A-Za-z0-9_-]{20,})\)\.[A-Za-z0-9]+$/.test(n);
const nomePng = (n) => n.replace(/\.[A-Za-z0-9]+$/, "") + ".png";
function sgAtualizarLista() {
  const p = sessao.pasta, ja = new Map(SG.itens.map((i) => [i.chave, i]));
  const daPasta = [];
  if (p) for (const it of [...p.raiz, ...p.pares]) {
    if (!SG.mostrarComId && !semIdNoNome(it.nome)) continue;  // imagens com ID de 20+ caracteres já são do MPCFill
    const chave = (it.em || "raiz") + "/" + it.nome;
    daPasta.push(ja.get(chave) || { chave, nome: it.nome, item: it, incluir: true, modo: "borda" });
  }
  SG.itens = [...daPasta, ...SG.itens.filter((i) => i.novo)];
}
function sgDesenhar() {
  const box = $("#sg"); box.hidden = false;
  const prontas = SG.itens.filter((i) => i.saida && i.incluir);
  const opcoes = (m) => [["borda", "Borda estendida (padrão)"], ["branco", "Branco"], ["preto", "Preto"]].map(([v, t]) => `<option value="${v}" ${m === v ? "selected" : ""}>${t}</option>`).join("");
  box.innerHTML = `<b>Correção de sangria</b>
    <p class="suave">Corrige cantos transparentes e cria a sangria (canvas 816×1110, carta 744×1040, 300 dpi). Escolha o modo de cada imagem e confira o antes/depois: <b>borda</b> estende a borda (padrão); <b>branco</b> e <b>preto</b> são para imagens apontadas com sujeira nos cantos. Transparência interna (caixas de texto) é preservada. A original nunca é sobrescrita sem ser guardada.</p>
    <label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="sg-comid" ${SG.mostrarComId ? "checked" : ""}> mostrar também as imagens com ID do MPCFill</label>
    <input id="sg-add" type="file" accept="image/*" multiple> <span class="suave">adicionar imagens do computador</span>
    ${SG.itens.length ? "" : `<p class="aviso">Nenhuma imagem sem ID na pasta. Adicione imagens do computador ou marque a caixa acima.</p>`}
    ${SG.itens.map((i, n) => `<div class="alt"><label style="display:flex;gap:8px;align-items:center;margin:0"><input type="checkbox" data-sg-inc="${n}" ${i.incluir ? "checked" : ""}> <b>${esc(i.nome)}</b>${i.novo ? ' <span class="suave">(do computador)</span>' : ""}</label>
      <div class="item"><select data-sg-modo="${n}">${opcoes(i.modo)}</select>
      <span class="${i.erro ? "alerta" : "suave"}">${i.erro ? esc(i.erro) : i.processando ? "corrigindo…" : i.saida ? "corrigida ✓ (mude o modo para refazer)" : "aguardando"}</span></div>
      ${i.previaUrl ? `<details open><summary class="suave">Antes (esquerda) × depois (direita); abaixo, zoom dos cantos</summary><img src="${i.previaUrl}" alt="antes e depois" style="max-width:100%;height:auto;border-radius:6px"></details>` : ""}</div>`).join("")}
    <button class="acao" id="sg-rodar" ${SG.rodando || !SG.itens.some((i) => i.incluir && !i.saida) ? "disabled" : ""}>Corrigir selecionadas</button>
    <button class="acao sec" id="sg-fechar-painel" ${SG.rodando ? "disabled" : ""}>Fechar</button>
    <span id="sg-status" class="suave"></span>
    ${prontas.length ? `<div class="conf"><b>Inserir as ${prontas.length} imagem(ns) corrigida(s) no pedido?</b>
      <p class="suave">${sessao.pasta && sessao.pasta.podeGravar ? `Inserir: a original vai para a subpasta <code>originais_sem_sangria</code> (nada é apagado) e a corrigida (PNG) ocupa o lugar dela${SG.itens.some((i) => i.novo && i.saida) ? "; as do computador entram como novas" : ""}. Depois é preciso conferir de novo.` : "Esta pasta não aceita gravação neste navegador (use Chrome/Edge ou o Google Drive): dá para baixar as corrigidas em um zip."}</p>
      ${sessao.pasta && sessao.pasta.podeGravar && sessao.pasta.inserirCorrigida ? `<button class="acao" id="sg-inserir">Sim, inserir no pedido</button>` : ""}
      <button class="acao sec" id="sg-zip">Só baixar (zip)</button>
      <button class="acao sec" id="sg-descartar">Não, descartar as corrigidas</button></div>` : ""}`;
  box.querySelector("#sg-comid").onchange = (e) => { SG.mostrarComId = e.target.checked; sgAtualizarLista(); sgDesenhar(); };
  box.querySelector("#sg-add").onchange = (e) => { for (const f of e.target.files) SG.itens.push({ chave: "novo/" + f.name + Date.now(), nome: f.name, file: f, novo: true, incluir: true, modo: "borda" }); sgDesenhar(); };
  box.querySelectorAll("[data-sg-inc]").forEach((el) => (el.onchange = () => { SG.itens[+el.dataset.sgInc].incluir = el.checked; sgDesenhar(); }));
  box.querySelectorAll("[data-sg-modo]").forEach((el) => (el.onchange = () => { const i = SG.itens[+el.dataset.sgModo]; i.modo = el.value; if (i.saida || i.erro) { i.saida = null; i.erro = ""; sgRodar([i]); } }));
  box.querySelector("#sg-rodar").onclick = () => sgRodar(SG.itens.filter((i) => i.incluir && !i.saida));
  box.querySelector("#sg-fechar-painel").onclick = () => { if (!SG.itens.some((i) => i.saida)) { SG.itens.forEach((i) => i.previaUrl && URL.revokeObjectURL(i.previaUrl)); SG.itens = SG.itens.filter((i) => false); box.hidden = true; } else $("#sg-status").textContent = "Responda primeiro se quer inserir as corrigidas (ou descarte)."; };
  const ins = box.querySelector("#sg-inserir"); if (ins) ins.onclick = sgInserir;
  const zip = box.querySelector("#sg-zip"); if (zip) zip.onclick = sgBaixarZip;
  const des = box.querySelector("#sg-descartar"); if (des) des.onclick = () => { SG.itens.forEach((i) => { i.saida = null; i.previaUrl && URL.revokeObjectURL(i.previaUrl); i.previaUrl = ""; }); sgDesenhar(); };
}
async function sgRodar(lista) {
  if (SG.rodando || !lista.length) return;
  SG.rodando = true; await pronto;
  try {
    let k = 0;
    for (const i of lista) {
      i.processando = true; i.erro = ""; sgDesenhar();
      $("#sg-status").textContent = `Corrigindo ${++k}/${lista.length}… (a primeira vez baixa o módulo de imagens, uns 30 MB)`;
      try {
        const arq = i.novo ? i.file : await i.item.ler();
        const r = await chamar("sangria_um", { nome: i.nome, bytes: new Uint8Array(await arq.arrayBuffer()), modo: i.modo });
        i.saida = r.saida;
        if (i.previaUrl) URL.revokeObjectURL(i.previaUrl);
        i.previaUrl = URL.createObjectURL(new Blob([r.previa], { type: "image/png" }));
      } catch (e) { i.erro = e.message; }
      i.processando = false; sgDesenhar();
    }
  } finally { SG.rodando = false; sgDesenhar(); }
}
async function sgInserir() {
  const fila = SG.itens.filter((i) => i.saida && i.incluir), st = $("#sg-status");
  $("#sg-inserir").disabled = true;
  try {
    let n = 0;
    for (const i of fila) { st.textContent = `Inserindo ${++n}/${fila.length}…`; await sessao.pasta.inserirCorrigida(i.novo ? null : i.item, nomePng(i.nome), i.saida); }
    SG.itens.forEach((i) => i.previaUrl && URL.revokeObjectURL(i.previaUrl));
    SG.itens = [];
    if (sessao.pasta.recarregar) sessao.pasta = await sessao.pasta.recarregar();
    sessao.conferencia = null; atualizarRotulos();
    $("#sg").innerHTML = `<span class="ok">${fila.length} imagem(ns) corrigida(s) inserida(s).</span> As originais ficaram em <code>originais_sem_sangria</code>. Clique em <b>Conferir</b> de novo.`;
  } catch (e) { st.innerHTML = `<span class="alerta">${esc(e.message)}</span>`; $("#sg-inserir").disabled = false; }
}
async function sgBaixarZip() {
  const fila = SG.itens.filter((i) => i.saida && i.incluir);
  const bytes = await chamar("zipar", { arquivos: fila.map((i) => [nomePng(i.nome), i.saida]) });
  salvar(new Blob([bytes], { type: "application/zip" }), `${(sessao.pasta && sessao.pasta.nome) || "pedido"} - sangria corrigida.zip`);
  $("#sg-status").textContent = "Zip baixado. Você ainda pode inserir as corrigidas no pedido ou descartá-las.";
}
$("#sg-abrir").onclick = () => { sgAtualizarLista(); sgDesenhar(); };

// ---------- Etapas: não passa para a próxima com pendência ----------
const ORDEM = ["entrada", "orcamento", "conferencia", "checagem", "ficha", "montagem"];
const NOMES = { entrada: "Entrada", orcamento: "Orçamento", conferencia: "Conferência", checagem: "Imagens", ficha: "Cliente e ficha", montagem: "Montagem" };
function pendencias(etapa) {
  const m = [];
  if (etapa === "entrada" && !pedido.fontes.length) m.push("traga o pedido (lista, XML ou decklist)");
  if (etapa === "orcamento") {
    const t = totais();
    if (!(t.frentes + t.versos)) m.push("o pedido não tem nenhum slot");
    if (!(valorFinal() > 0)) m.push("o valor cobrado está vazio");
  }
  if (etapa === "conferencia" && precisaBot()) m.push("o pedido entrou como lista: gere o XML no bot e use “Usar o XML de …”");
  if (etapa === "checagem") {
    if (copiando) m.push("a cópia das imagens para o Drive ainda está em andamento");
    if (SG.rodando) m.push("a correção de sangria ainda está rodando");
    else if (SG.itens.some((i) => i.saida)) m.push("responda se quer inserir as imagens de sangria corrigidas no pedido (ou descarte)");
    if (!sessao.pasta) m.push("escolha a pasta do pedido (ou envie as imagens do XML para o Drive)");
    else if (sessao.xml && !sessao.conferencia) m.push("clique em Conferir para checar as imagens");
    else if (sessao.conferencia && sessao.conferencia.pendentes) {
      const c = sessao.conferencia, itens = [];
      if (c.faltando) itens.push(`${c.faltando} imagem(ns) faltando`);
      if (c.a_duplicar) itens.push(`${c.a_duplicar} para duplicar`);
      if (c.excesso) itens.push(`${c.excesso} cópia(s) a mais`);
      if (c.pares_incompletos) itens.push(`${c.pares_incompletos} par(es) incompleto(s) (resolva ou use “Ignorar este par”)`);
      if (c.soltos) itens.push("pares soltos para mover para pares/");
      m.push("a conferência ainda tem pendências: " + itens.join(", "));
    }
  }
  if (etapa === "ficha" && !$("#f-cliente").value.trim()) m.push("preencha o nome do cliente");
  return m;
}
const etapasAtivas = () => ORDEM.filter((e) => !(e === "conferencia" && botDispensavel()));
function podeAbrirAba(aba) {
  const ate = ORDEM.indexOf(aba), atual = ORDEM.find((e) => !document.getElementById(e).hidden);
  if (ate <= ORDEM.indexOf(atual)) return true;  // voltar é sempre livre
  for (const e of etapasAtivas()) {
    if (ORDEM.indexOf(e) >= ate) break;
    const pend = pendencias(e);
    if (pend.length) {
      const av = $("#nav-aviso");
      av.hidden = false; av.innerHTML = `<b>Termine a etapa “${NOMES[e]}” antes de seguir:</b> ${esc(pend.join("; "))}.`;
      clearTimeout(podeAbrirAba.t); podeAbrirAba.t = setTimeout(() => (av.hidden = true), 7000);
      return false;
    }
  }
  $("#nav-aviso").hidden = true;
  return true;
}
window.podeAbrirAba = podeAbrirAba;

// ---------- Voltar / Próximo em cada etapa ----------
(() => {
  const ir = (aba) => { document.querySelector(`#passos [data-aba=${aba}]`).click(); window.scrollTo({ top: 0, behavior: "smooth" }); };
  const vizinho = (i, d) => { let k = i + d; if (ORDEM[k] === "conferencia" && botDispensavel()) k += d; return ORDEM[k]; };
  ORDEM.forEach((id, i) => {
    const sec = document.getElementById(id), barra = document.createElement("div");
    barra.className = "linha passos-rodape";
    if (i > 0) barra.insertAdjacentHTML("beforeend", `<button class="acao sec" data-d="-1">← Voltar</button>`);
    if (i < ORDEM.length - 1) barra.insertAdjacentHTML("beforeend", `<button class="acao" data-d="1">Próximo →</button><span class="aviso motivo" style="align-self:center"></span>`);
    barra.querySelectorAll("button").forEach((b) => (b.onclick = () => ir(vizinho(i, +b.dataset.d))));
    sec.append(barra);
  });
  // o botão Próximo fica desabilitado enquanto a etapa tiver pendência, e diz o motivo
  const atualizarNav = () => {
    ORDEM.forEach((id) => {
      const barra = document.getElementById(id).querySelector(".passos-rodape"), prox = barra && barra.querySelector('[data-d="1"]');
      if (!prox) return;
      const pend = pendencias(id);
      prox.disabled = pend.length > 0;
      barra.querySelector(".motivo").textContent = pend.length ? "Falta: " + pend.join("; ") : "";
    });
  };
  setInterval(atualizarNav, 400); atualizarNav();
})();

// ---------- Novo pedido: zera tudo menos o Google Drive e as configurações ----------
function novoPedido() {
  pedido.fontes = []; pedido.alteracoes = [];
  sessao.pasta = null; sessao.xml = null; sessao.xmlNome = ""; sessao.ignorar = new Set(); sessao.conferencia = null;
  Object.assign(MONT, { incluirExtras: null, chaveExtras: "", adicionadas: [], permitirBranco: false, chaveBranco: "", pronta: false, plano: null });
  clienteEditado = false; fichaManual = false; pagoEditado = false; copiando = false; ultimoOrc = null; ultimoXmlTexto = ""; xmlDeFontes = false;
  for (const s of ["#e-lista", "#e-xml", "#e-deck", "#c-xml", "#m-xml", "#f-cliente", "#f-tel", "#f-conclusao", "#m-cliente", "#o-pago", "#f-previa"]) $(s).value = "";
  for (const s of ["#e-erro", "#c-resultado", "#c-pasta-nome", "#m-pasta-nome", "#c-xml-nome", "#m-xml-nome", "#m-plano", "#m-resumo", "#m-status", "#m-saida", "#b-pedidos", "#b-aviso", "#p-saida", "#f-aviso", "#c-env-saida", "#m-novo-conf"]) { const el = $(s); if (el) el.textContent = ""; }
  $("#m-barra").hidden = true; $("#m-fim").hidden = true; $("#nav-aviso").hidden = true;
  renderFontes(); renderAlteracoes(); fichaMd = ""; atualizarRotulos();
  document.querySelector("#passos [data-aba=entrada]").click();
  window.scrollTo({ top: 0, behavior: "smooth" });
}
$("#m-novo").onclick = () => confirmar($("#m-novo-conf"), "Começar um novo pedido? Isso limpa o pedido atual (cartas, ficha, pasta e XML escolhidos). Os PDFs já baixados não são afetados e o Google Drive continua conectado.", async () => { novoPedido(); return ""; });
