"use strict";
// Fluxo do pedido: entrada → orçamento → conferência (bot local) → ficha e Pix. Usa as peças de app.js (sessao, chamar, pronto…).
const pedido = { fontes: [], alteracoes: [], modo: "normal", precos: {}, padrao: null, cardId: null };
// ID de 20+ caracteres entre parênteses no fim do nome, tolerando o que o navegador/Windows acrescenta a cópias (" (1)", " - Copia", " - Copy (2)")
const SUFIXO_COPIA = "(?:\\s*(?:-\\s*)?(?:c[oó]pia|copy)(?:\\s*\\(\\d+\\))?|\\s*\\(\\d+\\))*";
const RE_ID_ARQ = new RegExp("\\(([A-Za-z0-9_-]{20,})\\)" + SUFIXO_COPIA + "\\.[A-Za-z0-9]+$", "i");
const lerJson = (k, pad) => { try { return JSON.parse(guardado.ler(k)) || pad; } catch { return pad; } };

// ---------- entrada ----------
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
// Trocas “usar no lugar”: o ID de uma imagem que sumiu do MPCFill é trocado, no XML, pelo ID da imagem que você subiu à mão
function aplicarTrocas(txt) {
  for (const [antigo, novo] of Object.entries(sessao.trocas || {})) txt = txt.replace(new RegExp("<id>\\s*" + antigo + "\\s*</id>", "g"), `<id>${novo}</id>`);
  return txt;
}
function sincronizarXml() {
  let x = xmlCombinado(pedido.fontes); if (x !== null) x = aplicarTrocas(x);
  const n = pedido.fontes.filter((f) => f.xmlTexto).length;
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
  $("#e-t-xml").textContent = mais ? "Adicionar outro(s) XML do MPCFill" : "XML do MPCFill";
  $("#e-t-deck").textContent = mais ? "Adicionar outra(s) decklist(s)" : "Imagens + decklist";
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
// As duas entradas aceitam vários arquivos de uma vez (cada um vira um pedido dentro do mesmo pedido)
$("#e-xml").onchange = async (e) => {
  const arqs = Array.from(e.target.files); if (!arqs.length) return;
  e.target.value = "";  // o nome do arquivo fica na lista de pedidos; assim dá para adicionar outro sem confusão
  const erros = [];
  $("#e-erro").textContent = "";
  for (const arq of arqs) {
    try {
      const r = lerXmlMpc(await arq.arrayBuffer());
      addFonte({ titulo: arq.name, origem: "xml", ...r });  // a Checagem e a Montagem leem o XML combinado de todos os pedidos
    } catch (err) { erros.push(`${arq.name}: ${err.message}`); }
  }
  if (erros.length) $("#e-erro").textContent = erros.join(" · ");  // senão, mantém o aviso de “já estava na lista”, se houve
};
$("#e-deck").onchange = async (e) => {
  const arqs = Array.from(e.target.files); if (!arqs.length) return;
  e.target.value = "";
  const erros = [];
  $("#e-erro").textContent = "";
  for (const arq of arqs) {
    const n = lerLista(await arq.text());
    if (n.length) addFonte({ titulo: "Decklist: " + arq.name, origem: "deco", frentes: n, versos: [] });
    else erros.push(`${arq.name}: vazia ou fora do formato “2x Nome”`);
  }
  if (erros.length) $("#e-erro").textContent = erros.join(" · ");
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
  $("#o-kits").innerHTML = `<tr><th>Kit (slots)</th><th>Preço (R$)</th><th class="suave">Equivale a</th><th class="suave">Neste pedido</th><th></th></tr>` + p.kits.map((k, i) =>
    `<tr><td><input type="number" min="1" data-k="${i}" data-c="slots" value="${k.slots}"></td><td><input type="number" min="0" step="0.01" data-k="${i}" data-c="preco" value="${k.preco}"></td>
     <td class="suave" id="o-eq-${i}"></td><td id="o-uso-${i}"></td><td><button class="peq" data-krm="${i}">Remover</button></td></tr>`).join("") + `<tr><td colspan="5" class="suave" id="o-uso-resto"></td></tr>`;
  const campo = (id, rot, v, extra = "") => `<div><label>${rot}</label><input type="number" min="0" step="0.0001" data-p="${id}" value="${v}" ${extra}></div>`;
  const ef = precosEfetivos(modo), auto = p.avulso_auto === true;
  $("#o-campos").innerHTML = `<div><label>Preço por slot avulso (R$)</label><input type="number" min="0" step="0.0001" data-p="avulso" value="${+ef.avulso.toFixed(4)}" ${auto ? "disabled" : ""}>
      <label style="display:flex;gap:6px;align-items:center;margin-top:4px"><input type="checkbox" id="o-avulso-auto" ${auto ? "checked" : ""}> calcular pelo menor kit</label>
      <label style="display:flex;gap:6px;align-items:center;margin-top:4px"><input type="checkbox" id="o-resto-kit" ${p.resto_em_kit ? "checked" : ""}> o que sobrar vira um kit do menor tamanho</label></div>` +
    campo("colagem", "Colagem por adesivo (R$; paga pela página inteira)", p.colagem) +
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
    [`<span class="aviso">Só para você</span> · impressão`, reais(r.impressao)], [`Colagem <span class="suave">(${r.paginas} págs × 18 adesivos)</span>`, reais(r.colagem)], ["Lucro", reais(pago - r.impressao - r.colagem)],
  ].map(([k, v]) => `<tr><td>${k}</td><td class="n">${v}</td></tr>`).join("");
  preencherUso(r, pr);
  desenharDescontos(r);
  desenharJuntos(r);
  $("#o-pago-auto").disabled = !pagoEditado;
  renderFicha();
}
// Coluna "Neste pedido": liga a tabela de preços à divisão do pedido (quantos de cada kit foram usados)
function preencherUso(r, pr) {
  const kits = pedido.precos[pedido.modo].kits, kf = r.kit_final;
  kits.forEach((k, i) => {
    const el = $("#o-uso-" + i); if (!el) return;
    const u = r.usados.find((x) => x.slots === k.slots), partes = [];
    if (u) partes.push(`${u.qtd} × = ${reais(u.qtd * u.preco)}`);
    if (kf && kf.kit === k.slots) partes.push(`+ 1 kit final (sobraram ${kf.slots}) = ${reais(kf.preco)}`);
    el.innerHTML = partes.length ? `<b>${partes.join("<br>")}</b>` : `<span class="suave">não usado</span>`;
  });
  const resto = $("#o-uso-resto");
  if (resto) resto.textContent = kf && !kf.kit ? `Sobraram ${kf.slots} slots, cobrados pelo preço avulso: ${reais(kf.preco)}.` : "";
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
// Manda a lista do passo 1 direto ao bot como pedido novo (sem colar de novo): o bot cria o pedido e já começa a processar.
function desenharEnvioBot() {
  const alvo = $("#b-enviar"); alvo.innerHTML = "";
  const listas = pedido.fontes.filter((f) => f.origem === "lista");
  if (!listas.length) return;
  const base = nomeParaBot($("#f-cliente").value.trim() || "pedido");
  listas.forEach((f, i) => {
    const caixa = Object.assign(document.createElement("div"), { className: "conf" });
    const nCartas = f.frentes.length, nLinhas = listaParaBot(f.frentes).trim().split("\n").length;
    caixa.innerHTML = `<b>${esc(f.titulo)}</b> <span class="suave">${nCartas} cartas, ${nLinhas} linhas</span><br><label>Nome do pedido no bot <input type="text" size="28" value="${esc(f.nomeBot || (listas.length > 1 ? base + "-" + (i + 1) : base))}"></label> <button class="acao">Enviar ao bot</button><div class="suave msg"></div>`;
    const inp = caixa.querySelector("input"), btn = caixa.querySelector("button"), msg = caixa.querySelector(".msg");
    if (f.enviadoBot) { inp.value = f.enviadoBot; inp.disabled = btn.disabled = true; btn.textContent = "Enviado ✓"; msg.innerHTML = `Já está no bot. <a href="${MOTOR}/#pedido=${encodeURIComponent(f.enviadoBot)}" target="_blank" rel="noopener">Abrir a conferência deste pedido</a>`; }
    btn.onclick = async () => {
      const nome = nomeParaBot(inp.value); inp.value = nome; btn.disabled = true; msg.textContent = "Enviando…";
      try {
        const r = await fetch(MOTOR + "/api/pedidos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nome, lista: listaParaBot(f.frentes) }) });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.erro || "o bot recusou o pedido");
        f.enviadoBot = nome; f.nomeBot = nome; procurarBot();
      } catch (e) { btn.disabled = false; msg.innerHTML = `<span class="aviso">${esc(e.message)}</span>`; }
    };
    alvo.append(caixa);
  });
}
async function procurarBot() {
  const alvo = $("#b-estado"), lista = $("#b-pedidos");
  alvo.textContent = "Procurando o bot…"; lista.innerHTML = ""; $("#b-enviar").innerHTML = "";
  try {
    const est = await (await fetch(MOTOR + "/api/estado")).json();
    alvo.innerHTML = `<span class="ok">Bot conectado</span> <span class="suave">(versão ${esc(est.versao)})</span> <button class="peq" id="b-de-novo">Atualizar</button> <a href="${MOTOR}/${(pedido.fontes.find((f) => f.enviadoBot) || {}).enviadoBot ? "#pedido=" + encodeURIComponent(pedido.fontes.find((f) => f.enviadoBot).enviadoBot) : ""}" target="_blank" rel="noopener">Abrir a conferência do bot</a>`;
    $("#b-de-novo").onclick = procurarBot;
    alvo.insertAdjacentHTML("beforeend", ` <button class="peq" id="b-sair">Fechar o bot</button>`);
    $("#b-sair").onclick = async () => { try { await fetch(MOTOR + "/api/sair", { method: "POST", body: "{}", headers: { "Content-Type": "application/json" } }); } catch {} clearInterval(pingBot); pingBot = null; setTimeout(procurarBot, 800); };
    manterBot();
    desenharEnvioBot();
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
      fontes: pedido.fontes.map((f) => { const mk = marcarFicha(f.frentes); return { titulo: f.titulo, frentes: mk.frentes, versos: f.versos.map((x) => x.nome), nota: mk.nota }; }),
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
  for (const f of pedido.fontes) for (const c0 of [...f.frentes, ...f.versos]) {
    const c = sessao.trocas[c0.id] ? { ...c0, id: sessao.trocas[c0.id] } : c0;  // imagem trocada à mão: usa o ID dela
    if (c.id && !cartas.has(c.id)) cartas.set(c.id, c);
  }
  if (!cartas.size) { alvo.innerHTML = ""; return; }
  const nomePedido = (sessao.pasta && sessao.pasta.nome) || ($("#f-cliente").value.trim()) || (pedido.fontes[0].titulo.replace(/\.xml$/i, "").replace(/ \(bot\)$/, ""));
  alvo.innerHTML = `<div class="conf"><b>Imagens do XML (${cartas.size} arquivos distintos)</b><p class="suave">Se a pasta do pedido ainda não tem as imagens, a página pode copiá-las para o seu Drive, pelo próprio Drive (nada é baixado no seu computador). Requer o login do Google.</p>
    <label for="c-env-nome">Pasta do pedido em “${esc(Drive.NOME_RAIZ)}”</label><input id="c-env-nome" type="text" size="36" value="${esc(nomePedido)}">
    <br><button class="acao" id="c-env-ir">Enviar as imagens para o Drive</button><div id="c-env-saida"></div></div>`;
  // se a pasta escolhida já tem todas as imagens do XML, o botão não tem mais o que fazer
  const p0 = sessao.pasta;
  if (p0 && p0.drive) {
    const tem = new Set([...p0.raiz, ...p0.pares].map((x) => (x.nome.match(RE_ID_ARQ) || [])[1]).filter(Boolean));
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
      const ja = new Set((await Drive.listar(pastaId)).map((x) => (x.name.match(RE_ID_ARQ) || [])[1]).filter(Boolean));
      const falhas = []; let feitas = 0, puladas = 0;
      const fila = [...cartas.values()];
      const totalCopias = fila.length;
      atualizar("Preparando a pasta no Drive…", 0.02);
      const progresso = () => { const k = feitas + puladas + falhas.length; atualizar(`Copiando imagens: ${k} de ${totalCopias}… (${feitas} copiadas, ${puladas} já estavam lá${falhas.length ? `, ${falhas.length} com erro` : ""})`, k / totalCopias); };
      await Promise.all(Array.from({ length: 4 }, async () => {
        while (fila.length) {
          const c = fila.shift();
          if (ja.has(c.id)) { puladas++; progresso(); continue; }
          try { await Drive.copiar(c.id, nomeNoDrive(c), pastaId); feitas++; } catch (e) { falhas.push({ nome: c.nome, motivo: motivoCurto(e.message) }); }
          progresso();
        }
      }));
      sessao.pasta = await montarPastaDrive({ id: pastaId, name: nome });  // a etapa 4 já abre nesta pasta
      carregarIgnorados(); atualizarRotulos();
      $("#c-env-ir").disabled = true; $("#c-env-ir").textContent = "Imagens já estão no Drive ✓"; sessao.conferencia = null;
      if (!falhas.length) return `${feitas} copiada(s), ${puladas} já estava(m) lá. Pasta pronta: clique em Conferir.`;
      const naoExistem = falhas.filter((f) => f.motivo.startsWith("não existe")).length;
      return { html: `${feitas} copiada(s), ${puladas} já estava(m) lá, <span class="alerta">${falhas.length} falharam</span>:<ul>${falhas.map((f) => `<li>${esc(f.nome)}: ${esc(f.motivo)}</li>`).join("")}</ul>` +
        (naoExistem ? `<p class="suave"><b>${naoExistem}</b> dessas imagens não existem mais no Drive do MPCFill (apagadas ou privadas): o bot também não consegue baixá-las. Suba outra versão da carta (ou baixe à mão) para a pasta do pedido, clique em <b>Conferir</b> e use <b>Usar no lugar</b> para trocar uma pela outra.</p>` : "") +
        (falhas.length > naoExistem ? `<p class="suave">As demais podem ter sido limite temporário do Drive: clique em <b>Enviar as imagens para o Drive</b> de novo (ele pula as que já estão lá).</p>` : "") };
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

const motivoCurto = (m) => /404|not found/i.test(m) ? "não existe mais no Drive do MPCFill (apagada ou privada)" : /rate|429|quota|userRateLimit/i.test(m) ? "limite do Drive: tente de novo" : /403|permission|forbidden/i.test(m) ? "sem permissão para copiar" : String(m).replace(/\s+/g, " ").slice(0, 90);

// ---------- Faltando × extras: “usar no lugar” ----------
// Imagens do XML que sumiram do MPCFill e que você substituiu à mão (arquivo com outro ID): diz-se qual entra no lugar de qual.
const idDoNomeArquivo = (n) => (n.match(RE_ID_ARQ) || [])[1] || "";
const baseDaCarta = (n) => n.replace(/\.[A-Za-z0-9]+$/, "").split(/[\[({]/)[0].trim().toLowerCase();
function desenharTrocas(r) {
  const el = $("#c-trocas");
  const feitas = Object.entries(sessao.trocas || {});
  // candidatos: imagens fora do XML E cópias "a mais" de imagens que o XML já pede (a sobra pode ser justamente a substituta de uma que sumiu)
  const cands = [...r.fora_da_lista, ...r.sem_id].map((n) => ({ nome: n, id: idDoNomeArquivo(n) })).filter((c) => c.id);
  for (const [id, arqs] of r.excesso_mover || []) if (arqs.length && !cands.some((c) => c.id === id)) cands.push({ nome: arqs[0], id, sobra: true });
  const falt = r.faltando_ids || [];
  let h = "";
  if (feitas.length) h += `<div class="conf"><b class="ok">${feitas.length} troca(s) feita(s)</b> <span class="suave">(o XML passa a usar a imagem que você subiu)</span><ul>${feitas.map(([a, b]) => `<li>${esc(a.slice(0, 8))}… → ${esc(b.slice(0, 8))}… <button class="peq" data-desfaz-troca="${a}">Desfazer</button></li>`).join("")}</ul></div>`;
  if (falt.length && cands.length) {
    h += `<div class="conf conf-so-voce"><b class="aviso">Usar no lugar</b><p class="suave">Estas imagens do XML não estão na pasta, e há imagens na pasta que não são do XML ou que estão <b>sobrando</b> (cópias a mais). Se você subiu outra versão à mão, diga qual entra no lugar de qual: o arquivo escolhido passa a ser pedido no lugar da que sumiu (as cópias que faltarem serão pedidas depois, em “A duplicar”).</p>` +
      falt.map(([id, nome, qtd], i) => {
        const b = baseDaCarta(nome), sug = cands.findIndex((c) => { const cb = baseDaCarta(c.nome); return cb && (cb === b || cb.startsWith(b) || b.startsWith(cb)); });
        return `<div class="item"><span><b>${esc(nome)}</b> × ${qtd}</span> →
          <select data-troca="${i}"><option value="">(não trocar)</option>${cands.map((c, k) => `<option value="${k}" ${k === sug ? "selected" : ""}>${esc(c.nome)}${c.sobra ? " — cópia a mais" : ""}</option>`).join("")}</select></div>`;
      }).join("") + `<button class="acao" id="t-aplicar">Usar no lugar</button></div>`;
  }
  el.innerHTML = h;
  el.querySelectorAll("[data-desfaz-troca]").forEach((b) => (b.onclick = () => {
    const novo = sessao.trocas[b.dataset.desfazTroca]; delete sessao.trocas[b.dataset.desfazTroca];
    pedido.alteracoes.forEach((a) => (a.itens = a.itens.filter((it) => it.usado_id !== novo))); pedido.alteracoes = pedido.alteracoes.filter((a) => a.itens.length);
    sincronizarXml(); renderAlteracoes(); renderFicha(); conferir();
  }));
  const ap = $("#t-aplicar");
  if (ap) ap.onclick = () => {
    let n = 0;
    el.querySelectorAll("[data-troca]").forEach((sel) => {
      if (sel.value === "") return;
      const [id, nome] = falt[+sel.dataset.troca], c = cands[+sel.value];
      sessao.trocas[id] = c.id; n++;
      let grupo = pedido.alteracoes.find((a) => a.titulo === "Artes trocadas (original indisponível)");
      if (!grupo) { grupo = { titulo: "Artes trocadas (original indisponível)", itens: [] }; pedido.alteracoes.push(grupo); }
      grupo.itens.push({ texto: `${nomeLimpo(nome)}: a versão pedida não está mais disponível; usada outra versão`, usado_id: c.id });
    });
    if (!n) return;
    sincronizarXml(); renderAlteracoes(); renderFicha(); conferir();
  };
}
window.desenharTrocas = desenharTrocas;

// ---------- Imagens extras (fora do pedido): completar/ e soltas sem ID ----------
// Elas mudam o total de slots depois do orçamento: a Conferência pede uma decisão e, se incluir, o pedido, o orçamento e a ficha são atualizados.
const nomeLimpo = (n) => n.replace(/\.[A-Za-z0-9]+$/, "").replace(new RegExp("\\s*\\([A-Za-z0-9_-]{20,}\\)" + SUFIXO_COPIA + "\\s*$", "i"), "").trim();
async function desenharExtras(itens, faltandoQtd = 0) {
  const el = $("#c-extras"), chave = chaveExtras(itens);
  const noPedido = pedido.fontes.some((f) => f.origem === "completar" && f.extrasChave === chave);
  if (!itens.length) {
    pedido.fontes = pedido.fontes.filter((f) => f.origem !== "completar");  // não há mais extras: tira a seção antiga
    sessao.extrasDecisao = null; el.innerHTML = ""; renderFontes(); return 0;
  }
  const dec = sessao.extrasDecisao && sessao.extrasDecisao.chave === chave ? sessao.extrasDecisao.valor : (noPedido ? "incluir" : null);
  const lista = `<ul>${itens.slice(0, 12).map((x) => `<li>${esc(x.nome)} <span class="suave">${x.em === "completar" ? "(completar/)" : "(solta na pasta)"}</span></li>`).join("")}${itens.length > 12 ? `<li class="suave">… e mais ${itens.length - 12}</li>` : ""}</ul>`;
  if (dec === "incluir") {
    el.innerHTML = `<div class="conf"><b class="ok">${itens.length} imagem(ns) extra(s) incluída(s) no pedido</b> (“Cartas para completar”, ${itens.length} slots; já está no orçamento e na ficha). <button class="peq" id="x-desfazer">Desfazer</button> <button class="peq" id="x-orc">Rever o orçamento</button></div>`;
    $("#x-desfazer").onclick = () => { pedido.fontes = pedido.fontes.filter((f) => f.origem !== "completar"); sessao.extrasDecisao = { chave, valor: "nao" }; renderFontes(); conferir(); };
    $("#x-orc").onclick = () => document.querySelector("#passos [data-aba=orcamento]").click();
    return 0;
  }
  if (dec === "nao") {
    el.innerHTML = `<div class="conf"><b>${itens.length} imagem(ns) extra(s) não entram no pedido.</b> <button class="peq" id="x-mudar">Mudar</button></div>`;
    $("#x-mudar").onclick = () => { sessao.extrasDecisao = null; conferir(); };
    return 0;
  }
  // ainda sem decisão: mostra o que muda no total e no valor
  await pronto;
  const t = totais(), pr = precosEfetivos(pedido.modo), slotsAtual = t.frentes + t.versos;
  const antes = (await chamar("orcar", { frentes: slotsAtual, versos: 0, modo: pedido.modo, precos: pr })).pago;
  const depois = (await chamar("orcar", { frentes: slotsAtual + itens.length, versos: 0, modo: pedido.modo, precos: pr })).pago;
  el.innerHTML = `<div class="conf conf-so-voce"><b class="aviso">${itens.length} imagem(ns) fora do pedido na pasta</b>${lista}
    <p>Elas não estavam no pedido quando o orçamento foi feito. Se entrarem, o pedido passa de <b>${slotsAtual}</b> para <b>${slotsAtual + itens.length} slots</b> e o valor da tabela de <b>${reais(antes)}</b> para <b>${reais(depois)}</b> (cobrado hoje: ${reais(valorFinal())}).</p>
    ${faltandoQtd ? `<p class="aviso">Atenção: ainda faltam ${faltandoQtd} imagem(ns) do XML. Se estas imagens são as <b>trocas</b> delas, use <b>Usar no lugar</b> (acima) e não inclua aqui, senão o pedido conta em dobro.</p>` : ""}
    <button class="acao" id="x-inc-atualiza">Incluir e atualizar o valor</button>
    <button class="acao sec" id="x-inc-mantem">Incluir e manter o valor atual</button>
    <button class="acao sec" id="x-nao">Não incluir</button></div>`;
  const incluir = (atualizarValor) => {
    if (!atualizarValor) { $("#o-pago").value = valorFinal(); pagoEditado = true; }  // congela o valor combinado
    else pagoEditado = false;
    pedido.fontes = pedido.fontes.filter((f) => f.origem !== "completar");
    pedido.fontes.push({ titulo: "Cartas para completar", origem: "completar", extrasChave: chave, frentes: itens.map((x) => ({ nome: nomeLimpo(x.nome) })), versos: [] });
    sessao.extrasDecisao = { chave, valor: "incluir" };
    renderFontes(); conferir();
  };
  $("#x-inc-atualiza").onclick = () => incluir(true);
  $("#x-inc-mantem").onclick = () => incluir(false);
  $("#x-nao").onclick = () => { sessao.extrasDecisao = { chave, valor: "nao" }; conferir(); };
  return itens.length;
}
window.desenharExtras = desenharExtras;

// ---------- Correção de sangria (botão separado; processo do HANDOFF_SANGRIA) ----------
// 816x1110 RGBA, carta 744x1040 centralizada, 299.9994 dpi; modos por imagem: borda (padrão), branco, preto. Nunca sobrescreve sem guardar a original.
const SG = { itens: [], mostrarComId: false, rodando: false };
const semIdNoNome = (n) => !RE_ID_ARQ.test(n);
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
const sgSaida = (i) => (i.opcoes ? i.opcoes[i.modo].saida : null);  // bytes da opção escolhida
const NOMES_MODO = { borda: "Borda estendida", branco: "Branco", preto: "Preto" };
function sgDesenhar() {
  const box = $("#sg"); box.hidden = false;
  const prontas = SG.itens.filter((i) => i.opcoes && i.incluir);
  const pendentes = SG.itens.filter((i) => i.incluir && !i.opcoes);
  const driveOk = typeof Drive !== "undefined" && Drive.conectado();
  box.innerHTML = `<b>Correção de sangria</b>
    <p class="suave">Corrige cantos transparentes e cria a sangria (canvas 816×1110, carta 744×1040, 300 dpi). Para cada imagem a página gera <b>as três opções</b>: veja como fica cada uma (miniatura com zoom nos cantos) e <b>clique na que quer</b>. <b>Borda</b> estende a borda (padrão); <b>branco</b> e <b>preto</b> são para imagens com sujeira nos cantos. Transparência interna (caixas de texto) é preservada.</p>
    <label style="display:flex;gap:6px;align-items:center"><input type="checkbox" id="sg-comid" ${SG.mostrarComId ? "checked" : ""}> mostrar também as imagens com ID do MPCFill</label>
    <input id="sg-add" type="file" accept="image/*" multiple> <span class="suave">adicionar imagens do computador</span>
    ${SG.itens.length ? "" : `<p class="aviso">Nenhuma imagem sem ID na pasta. Adicione imagens do computador ou marque a caixa acima.</p>`}
    ${SG.itens.map((i, n) => `<div class="alt"><label style="display:flex;gap:8px;align-items:center;margin:0"><input type="checkbox" data-sg-inc="${n}" ${i.incluir ? "checked" : ""}> <b>${esc(i.nome)}</b>${i.novo ? ' <span class="suave">(do computador)</span>' : ""}
        <span class="${i.erro ? "alerta" : "suave"}">${i.erro ? esc(i.erro) : i.processando ? "gerando as 3 opções…" : i.opcoes ? "" : "aguardando"}</span></label>
      ${i.opcoes ? `<div class="sg-opcoes"><div class="sg-op"><div class="suave">Original</div><img src="${i.urls.original}" alt="original"></div>${["borda", "branco", "preto"].map((m) => `<label class="sg-op ${i.modo === m ? "sel" : ""}"><div><input type="radio" name="sg-m${n}" data-sg-modo="${n}" value="${m}" ${i.modo === m ? "checked" : ""}> <b>${NOMES_MODO[m]}</b>${m === "borda" ? " <span class='suave'>(padrão)</span>" : ""}</div><img src="${i.urls[m]}" alt="${m}"></label>`).join("")}</div>` : ""}</div>`).join("")}
    <button class="acao" id="sg-rodar" ${SG.rodando || !pendentes.length ? "disabled" : ""}>Ver como fica (3 opções)</button>
    <button class="acao sec" id="sg-fechar-painel" ${SG.rodando ? "disabled" : ""}>Fechar</button>
    <span id="sg-status" class="suave"></span>
    ${prontas.length ? `<div class="conf"><b>Usar as ${prontas.length} imagem(ns) corrigida(s) com o modo escolhido?</b>
      <p class="suave">${sessao.pasta && sessao.pasta.podeGravar ? `<b>Inserir no pedido</b>: a original vai para a subpasta <code>originais_sem_sangria</code> (nada é apagado) e a corrigida (PNG) ocupa o lugar dela${SG.itens.some((i) => i.novo && i.opcoes) ? "; as do computador entram como novas" : ""}. Depois é preciso conferir de novo.` : "Esta pasta não aceita gravação neste navegador (use Chrome/Edge ou o Google Drive)."}${driveOk ? " <b>Enviar para o Drive</b>: escolha a pasta do pedido; as corrigidas entram como arquivos novos (as originais não são tocadas)." : ""} Ou baixe um zip.</p>
      ${sessao.pasta && sessao.pasta.podeGravar && sessao.pasta.inserirCorrigida ? `<button class="acao" id="sg-inserir">Sim, inserir no pedido</button>` : ""}
      ${driveOk ? `<button class="acao" id="sg-drive">Enviar para uma pasta do Drive…</button>` : ""}
      <button class="acao sec" id="sg-zip">Só baixar (zip)</button>
      <button class="acao sec" id="sg-descartar">Não, descartar as corrigidas</button><div id="sg-drive-lista"></div></div>` : ""}`;
  box.querySelector("#sg-comid").onchange = (e) => { SG.mostrarComId = e.target.checked; sgAtualizarLista(); sgDesenhar(); };
  box.querySelector("#sg-add").onchange = (e) => { for (const f of e.target.files) SG.itens.push({ chave: "novo/" + f.name + Date.now(), nome: f.name, file: f, novo: true, incluir: true, modo: "borda" }); sgDesenhar(); };
  box.querySelectorAll("[data-sg-inc]").forEach((el) => (el.onchange = () => { SG.itens[+el.dataset.sgInc].incluir = el.checked; sgDesenhar(); }));
  box.querySelectorAll("[data-sg-modo]").forEach((el) => (el.onchange = () => { SG.itens[+el.dataset.sgModo].modo = el.value; sgDesenhar(); }));
  box.querySelector("#sg-rodar").onclick = () => sgRodar(pendentes);
  box.querySelector("#sg-fechar-painel").onclick = () => { if (!SG.itens.some((i) => i.opcoes)) { sgLimpar(); box.hidden = true; } else $("#sg-status").textContent = "Responda primeiro o que fazer com as corrigidas (ou descarte)."; };
  const ins = box.querySelector("#sg-inserir"); if (ins) ins.onclick = sgInserir;
  const dr = box.querySelector("#sg-drive"); if (dr) dr.onclick = sgEnviarDrive;
  const zip = box.querySelector("#sg-zip"); if (zip) zip.onclick = sgBaixarZip;
  const des = box.querySelector("#sg-descartar"); if (des) des.onclick = () => { sgLimpar(true); sgDesenhar(); };
}
function sgLimpar(manterLista) {
  for (const i of SG.itens) { if (i.urls) Object.values(i.urls).forEach((u) => URL.revokeObjectURL(u)); i.urls = null; i.opcoes = null; i.modo = "borda"; }
  if (!manterLista) SG.itens = [];
}
const sgBlobUrl = (bytes) => URL.createObjectURL(new Blob([bytes], { type: "image/png" }));
async function sgRodar(lista) {
  if (SG.rodando || !lista.length) return;
  SG.rodando = true; await pronto;
  try {
    let k = 0;
    for (const i of lista) {
      i.processando = true; i.erro = ""; sgDesenhar();
      $("#sg-status").textContent = `Gerando as opções ${++k}/${lista.length}… (a primeira vez baixa o módulo de imagens, uns 30 MB)`;
      try {
        const arq = i.novo ? i.file : await i.item.ler();
        const r = await chamar("sangria_um", { nome: i.nome, bytes: new Uint8Array(await arq.arrayBuffer()) });
        i.opcoes = r.modos;
        i.urls = { original: sgBlobUrl(r.original), borda: sgBlobUrl(r.modos.borda.previa), branco: sgBlobUrl(r.modos.branco.previa), preto: sgBlobUrl(r.modos.preto.previa) };
        i.modo = "borda";
      } catch (e) { i.erro = e.message; }
      i.processando = false; sgDesenhar();
    }
  } finally { SG.rodando = false; sgDesenhar(); }
}
async function sgInserir() {
  const fila = SG.itens.filter((i) => i.opcoes && i.incluir), st = $("#sg-status");
  $("#sg-inserir").disabled = true;
  try {
    let n = 0;
    for (const i of fila) { st.textContent = `Inserindo ${++n}/${fila.length}…`; await sessao.pasta.inserirCorrigida(i.novo ? null : i.item, nomePng(i.nome), sgSaida(i)); }
    sgLimpar();
    if (sessao.pasta.recarregar) sessao.pasta = await sessao.pasta.recarregar();
    sessao.conferencia = null; atualizarRotulos();
    $("#sg").innerHTML = `<span class="ok">${fila.length} imagem(ns) corrigida(s) inserida(s).</span> As originais ficaram em <code>originais_sem_sangria</code>. Clique em <b>Conferir</b> de novo.`;
  } catch (e) { st.innerHTML = `<span class="alerta">${esc(e.message)}</span>`; $("#sg-inserir").disabled = false; }
}
async function sgBaixarZip() {
  const fila = SG.itens.filter((i) => i.opcoes && i.incluir);
  const bytes = await chamar("zipar", { arquivos: fila.map((i) => [nomePng(i.nome), sgSaida(i)]) });
  salvar(new Blob([bytes], { type: "application/zip" }), `${(sessao.pasta && sessao.pasta.nome) || "pedido"} - sangria corrigida.zip`);
  $("#sg-status").textContent = "Zip baixado. Você ainda pode inserir as corrigidas no pedido ou descartá-las.";
}
// Envia as corrigidas (modo escolhido) para a pasta de um pedido no Drive: entram como arquivos novos; nada é apagado nem movido.
async function sgEnviarDrive() {
  const st = $("#sg-status"), lista = $("#sg-drive-lista");
  try {
    const pasta = await pastaDoDrive(lista);  // lista os pedidos do Drive e espera a escolha
    const fila = SG.itens.filter((i) => i.opcoes && i.incluir);
    let n = 0;
    for (const i of fila) { st.textContent = `Enviando ${++n} de ${fila.length} para “${pasta.nome}” no Drive…`; await pasta.inserirCorrigida(null, nomePng(i.nome), sgSaida(i)); }
    sgLimpar();
    $("#sg").innerHTML = `<span class="ok">${fila.length} imagem(ns) corrigida(s) enviada(s) para “${esc(pasta.nome)}” no Drive.</span> Se for a pasta deste pedido, clique em <b>Conferir</b>: elas aparecem como imagens extras para você decidir se entram no pedido.`;
    if (sessao.pasta && sessao.pasta.drive && sessao.pasta.drive.id === pasta.drive.id && sessao.pasta.recarregar) { sessao.pasta = await sessao.pasta.recarregar(); atualizarRotulos(); }
    sessao.conferencia = null;
  } catch (e) { if (e.message !== "cancelado") st.innerHTML = `<span class="alerta">${esc(e.message)}</span>`; }
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
    else if (SG.itens.some((i) => i.opcoes)) m.push("responda se quer inserir as imagens de sangria corrigidas no pedido (ou descarte)");
    if (!sessao.pasta) m.push("escolha a pasta do pedido (ou envie as imagens do XML para o Drive)");
    else if (sessao.xml && !sessao.conferencia) m.push("clique em Conferir para checar as imagens");
    else if (sessao.conferencia && sessao.conferencia.extrasPendentes) m.push(`decida o que fazer com as ${sessao.conferencia.extrasPendentes} imagem(ns) extras (fora do pedido) que a conferência achou`);
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
  pedido.fontes = []; pedido.alteracoes = []; pedido.cardId = null; $("#t-criar").textContent = "Criar card no Trello";
  sessao.pasta = null; sessao.xml = null; sessao.xmlNome = ""; sessao.ignorar = new Set(); sessao.conferencia = null;
  Object.assign(MONT, { incluirExtras: null, chaveExtras: "", adicionadas: [], permitirBranco: false, chaveBranco: "", pronta: false, plano: null });
  sessao.extrasDecisao = null; sessao.trocas = {};
  clienteEditado = false; fichaManual = false; pagoEditado = false; copiando = false; ultimoOrc = null; ultimoXmlTexto = ""; xmlDeFontes = false;
  for (const s of ["#e-lista", "#e-xml", "#e-deck", "#c-xml", "#m-xml", "#f-cliente", "#f-tel", "#f-conclusao", "#m-cliente", "#o-pago", "#f-previa"]) $(s).value = "";
  for (const s of ["#e-erro", "#c-resultado", "#c-pasta-nome", "#m-pasta-nome", "#c-xml-nome", "#m-xml-nome", "#m-plano", "#m-resumo", "#m-status", "#m-saida", "#b-pedidos", "#b-aviso", "#p-saida", "#f-aviso", "#c-env-saida", "#m-novo-conf", "#c-extras", "#c-trocas", "#t-aviso"]) { const el = $(s); if (el) el.textContent = ""; }
  $("#m-barra").hidden = true; $("#m-fim").hidden = true; $("#nav-aviso").hidden = true;
  renderFontes(); renderAlteracoes(); fichaMd = ""; atualizarRotulos();
  document.querySelector("#passos [data-aba=entrada]").click();
  window.scrollTo({ top: 0, behavior: "smooth" });
}
$("#m-novo").onclick = () => confirmar($("#m-novo-conf"), "Começar um novo pedido? Isso limpa o pedido atual (cartas, ficha, pasta e XML escolhidos). Os PDFs já baixados não são afetados e o Google Drive continua conectado.", async () => { novoPedido(); return ""; });

// ---------- Versão da página: mostra qual está rodando e avisa quando sai uma nova (recarregar zera o pedido) ----------
let versaoRodando = null;
async function checarVersao() {
  try {
    const v = await (await fetch("versao.json", { cache: "no-store" })).json();
    if (!versaoRodando) { versaoRodando = v.versao; $("#versao").textContent = `· versão ${v.versao}`; $("#versao").title = `publicada em ${v.data} (UTC)`; }
    else if (v.versao !== versaoRodando) {
      const a = $("#nova-versao"); a.hidden = false;
      a.innerHTML = `<b>Há uma versão nova da página (${esc(v.versao)}).</b> Esta aba continua rodando a ${esc(versaoRodando)}, com as regras antigas. Termine (ou anote) o pedido em andamento e recarregue com <b>Ctrl+F5</b> para usar a nova: recarregar zera o pedido atual.`;
    }
  } catch { /* sem versao.json (teste local antigo): segue sem mostrar */ }
}
checarVersao(); setInterval(checarVersao, 5 * 60 * 1000);


// ---------- Trello: cria/atualiza o card do pedido pelo Worker (senha só neste navegador) ----------
const WORKER_PADRAO = "https://chelisplace-avisos.shrill-mountain-e326.workers.dev"; // endereço público (não é segredo)
["t-url", "t-senha"].forEach((id) => { $("#" + id).value = guardado.ler(id) || (id === "t-url" ? WORKER_PADRAO : ""); $("#" + id).addEventListener("input", () => guardado.gravar(id, $("#" + id).value.trim())); });
// Conectado ao Google (Drive): o Worker confere a conta, sem senha. Sem Drive, vale a senha da página.
setInterval(() => { const el = $("#t-modo"); if (el) el.textContent = Drive.conectado() ? "Conta Google conectada: não precisa de senha." : "Sem Google conectado: use a senha da página."; }, 1000);
$("#t-criar").onclick = async () => {
  const av = $("#t-aviso"), btn = $("#t-criar");
  const base = ($("#t-url").value.trim() || WORKER_PADRAO).replace(/\/+$/, ""), senha = $("#t-senha").value.trim();
  const credencial = Drive.conectado() ? await Drive.tokenAtual().catch(() => null) : null;
  const bearer = credencial || senha;
  if (!/^https:\/\//.test(base) || !bearer) { av.textContent = " Conecte o Google (Drive) ou preencha a senha da página."; $("#t-det").open = true; return; }
  if (!ultimoOrc || !(valorFinal() > 0)) { av.textContent = " Faça o orçamento antes (valor cobrado e slots)."; return; }
  const slots = ultimoOrc.slots, alts = pedido.alteracoes.filter((a) => a.titulo.trim()).map((a) => `${a.titulo.trim()}: ${a.itens.map((i) => i.texto.trim()).filter(Boolean).join("; ")}`);
  const corpo = {
    cliente: $("#f-cliente").value.trim(), telefone: $("#f-tel").value.trim(), slots, paginas: Math.ceil(slots / 18), valor: valorFinal(),
    pastaUrl: sessao.pasta && sessao.pasta.drive ? `https://drive.google.com/drive/folders/${sessao.pasta.drive.id}` : "",
    alteracoes: alts, cardId: pedido.cardId || undefined,
  };
  btn.disabled = true; av.textContent = " Enviando…";
  try {
    const r = await fetch(base + "/card", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + bearer }, body: JSON.stringify(corpo) });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.erro || "erro " + r.status);
    pedido.cardId = d.id; btn.textContent = "Atualizar card no Trello";
    av.innerHTML = ` Card ${corpo.cardId ? "atualizado" : "criado"}: <a href="${esc(d.url)}" target="_blank" rel="noopener">abrir no Trello</a>${d.previsao ? ` · <b>${esc(d.previsao)}</b>` : ""}`;
  } catch (e) { av.textContent = " Não deu: " + e.message; }
  btn.disabled = false;
};


// ---------- WhatsApp do cliente (wa.me): abre a conversa com o texto pronto; o Chelis clica em enviar e anexa o PDF ----------
function abrirWhatsApp(texto) {
  const n = $("#f-tel").value.replace(/\D/g, "");
  if (!n) { $("#f-aviso").textContent = "Preencha o telefone do cliente (com DDD) para abrir o WhatsApp."; return; }
  window.open(`https://wa.me/${n}?text=${encodeURIComponent(texto)}`, "_blank", "noopener");
  $("#f-aviso").textContent = "WhatsApp aberto: confira o texto, envie e anexe o PDF à mão.";
}
const saudacao = () => { const nome = $("#f-cliente").value.trim(); return `Oi${nome ? ", " + nome : ""}!`; };
$("#f-wa-ficha").onclick = () => {
  abrirWhatsApp(`${saudacao()} Segue a ficha do seu pedido${ultimoOrc ? ` (${ultimoOrc.slots} slots)` : ""}, com os dados para o pagamento no PDF. Qualquer dúvida é só falar.`); // sem valores no texto
};
$("#f-wa-cartas").onclick = () => {
  const alt = pedido.alteracoes.filter((a) => /sem vers/i.test(a.titulo)).flatMap((a) => a.itens.map((i) => i.texto.trim()).filter(Boolean));
  if (!alt.length) { $("#f-aviso").textContent = "Nenhuma carta sem versão próxima registrada. Use o botão da etapa Conferência para levá-las até aqui."; return; }
  abrirWhatsApp(`${saudacao()} Sobre o seu pedido: algumas cartas não tinham a versão pedida.\n\n${alt.map((t) => "• " + t).join("\n")}\n\nPosso seguir assim ou prefere trocar alguma?`);
};
