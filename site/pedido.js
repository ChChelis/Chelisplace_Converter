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
      const nome = (c.querySelector("name")?.textContent || c.querySelector("query")?.textContent || id || "").replace(/\.(jpe?g|png|webp)$/i, "").replace(/\s*\([^)]{20,}\)\s*$/, "").trim();
      const n = (c.querySelector("slots")?.textContent || "0").split(",").filter((x) => x.trim() !== "").length || 1;
      for (let i = 0; i < n; i++) saida.push({ nome, id });
    }
    return saida;
  };
  return { frentes: cartas("fronts"), versos: cartas("backs") };
}
function addFonte(f) { pedido.fontes.push(f); renderFontes(); }
function renderFontes() {
  const c = $("#e-fontes");
  c.innerHTML = pedido.fontes.map((f, i) => `<div class="fonte"><b>${esc(f.titulo)}</b><span class="suave">${f.frentes.length} frentes${f.versos.length ? " + " + f.versos.length + " versos" : ""}</span><button class="peq" data-rm="${i}">Remover</button></div>`).join("");
  c.querySelectorAll("[data-rm]").forEach((b) => (b.onclick = () => { pedido.fontes.splice(+b.dataset.rm, 1); renderFontes(); }));
  atualizarResumo();
  preencherOrcamento();
  renderFicha();
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
  if (n.length) { addFonte({ titulo: "Lista colada", frentes: n, versos: [] }); $("#e-lista").value = ""; }
};
$("#e-xml").onchange = async (e) => {
  const arq = e.target.files[0]; if (!arq) return;
  try {
    const buf = await arq.arrayBuffer();
    const r = lerXmlMpc(buf);
    $("#e-erro").textContent = "";
    await receberXml(arq);  // a Checagem e a Montagem reaproveitam o mesmo XML
    addFonte({ titulo: arq.name, ...r });
  } catch (err) { $("#e-erro").textContent = err.message; }
};
$("#e-deck").onchange = async (e) => {
  const arq = e.target.files[0]; if (!arq) return;
  const n = lerLista(await arq.text());
  $("#e-erro").textContent = n.length ? "" : "A decklist está vazia ou fora do formato “2x Nome”.";
  if (n.length) addFonte({ titulo: "Decklist: " + arq.name, frentes: n, versos: [] });
};

// ---------- orçamento ----------
async function carregarPrecos() {
  await pronto;
  pedido.padrao = await chamar("orcamento_padrao");
  const salvo = lerJson("precos", {});
  pedido.precos = { normal: { ...pedido.padrao.normal, ...(salvo.normal || {}) }, foil: { ...pedido.padrao.foil, ...(salvo.foil || {}) } };
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
function desenharPrecos() {
  const p = pedido.precos[$("#o-modo").value];
  $("#o-kits").innerHTML = `<tr><th>Kit (slots)</th><th>Preço (R$)</th><th></th></tr>` + p.kits.map((k, i) =>
    `<tr><td><input type="number" min="1" data-k="${i}" data-c="slots" value="${k.slots}"></td><td><input type="number" min="0" step="0.01" data-k="${i}" data-c="preco" value="${k.preco}"></td><td><button class="peq" data-krm="${i}">Remover</button></td></tr>`).join("");
  const campo = (id, rot, v) => `<div><label>${rot}</label><input type="number" min="0" step="0.0001" data-p="${id}" value="${v}"></div>`;
  $("#o-campos").innerHTML = campo("avulso", "Preço por slot avulso (R$)", p.avulso) + campo("colagem", "Colagem por slot (R$)", p.colagem) +
    (p.impressao_pagina !== undefined ? campo("impressao_pagina", "Impressão por página (R$)", p.impressao_pagina)
      : campo("impressao_kit", "Impressão por kit foil (R$)", p.impressao_kit) + campo("impressao_pagina_extra", "Página extra foil (R$)", p.impressao_pagina_extra));
  $("#o-kits").querySelectorAll("input").forEach((el) => (el.oninput = () => { p.kits[+el.dataset.k][el.dataset.c] = +el.value; salvarPrecos(); orcar(); }));
  $("#o-kits").querySelectorAll("[data-krm]").forEach((b) => (b.onclick = () => { p.kits.splice(+b.dataset.krm, 1); salvarPrecos(); desenharPrecos(); orcar(); }));
  $("#o-campos").querySelectorAll("input").forEach((el) => (el.oninput = () => { p[el.dataset.p] = +el.value; salvarPrecos(); orcar(); }));
}
$("#o-kit-add").onclick = () => { pedido.precos[$("#o-modo").value].kits.push({ slots: 36, preco: 50 }); salvarPrecos(); desenharPrecos(); orcar(); };
$("#o-restaurar").onclick = () => { pedido.precos[$("#o-modo").value] = JSON.parse(JSON.stringify(pedido.padrao[$("#o-modo").value])); salvarPrecos(); desenharPrecos(); orcar(); };
let ultimoOrc = null;
async function orcar() {
  if (!pedido.padrao) return;
  pedido.modo = $("#o-modo").value;
  ultimoOrc = await chamar("orcar", { frentes: +$("#o-frentes").value || 0, versos: +$("#o-versos").value || 0, modo: pedido.modo, precos: pedido.precos[pedido.modo] });
  const r = ultimoOrc, pago = valorFinal();
  $("#o-tabela").innerHTML = [
    ["Slots (frentes + versos)", r.slots], ["Páginas A3", r.paginas],
    ["Kits fechados", r.usados.length ? r.usados.map((u) => `${u.qtd} × ${u.slots}`).join(" + ") : "0"], ["Slots avulsos", r.resto],
    ["Valor do pedido" + (pago !== r.pago ? " (combinado)" : ""), reais(pago)],
    [`<span class="aviso">Só para você</span> · impressão`, reais(r.impressao)], ["Colagem", reais(r.colagem)], ["Lucro", reais(pago - r.impressao - r.colagem)],
  ].map(([k, v]) => `<tr><td>${k}</td><td class="n">${v}</td></tr>`).join("");
  renderFicha();
}
const valorFinal = () => ($("#o-pago").value !== "" ? +$("#o-pago").value : ultimoOrc ? ultimoOrc.pago : 0);
["#o-frentes", "#o-versos", "#o-pago"].forEach((s) => $(s).addEventListener("input", orcar));
$("#o-modo").addEventListener("change", () => { desenharPrecos(); orcar(); });

// ---------- conferência (motor local do bot) ----------
const MOTOR = "http://127.0.0.1:8781";
async function procurarBot() {
  const alvo = $("#b-estado"), lista = $("#b-pedidos");
  alvo.textContent = "Procurando o bot…"; lista.innerHTML = "";
  try {
    const est = await (await fetch(MOTOR + "/api/estado")).json();
    alvo.innerHTML = `<span class="ok">Bot conectado</span> <span class="suave">(versão ${esc(est.versao)})</span> <button class="peq" id="b-de-novo">Atualizar</button> <a href="${MOTOR}/" target="_blank" rel="noopener">Abrir a conferência do bot</a>`;
    $("#b-de-novo").onclick = procurarBot;
    const peds = await (await fetch(MOTOR + "/api/pedidos")).json();
    lista.innerHTML = peds.length ? "<h3>Pedidos do bot</h3>" : `<p class="suave">O bot ainda não tem pedidos. Abra-o e use “+ Novo pedido”.</p>`;
    for (const p of peds) {
      const b = Object.assign(document.createElement("button"), { className: "acao sec", textContent: `Usar o XML de ${p.nome}` });
      b.onclick = async () => {
        try {
          const r = await fetch(`${MOTOR}/api/pedidos/${encodeURIComponent(p.nome)}/xml`);
          if (!r.ok) throw new Error("Esse pedido ainda não tem XML: gere-o na conferência do bot.");
          const buf = await r.arrayBuffer();
          await receberXml(new File([buf], p.nome + ".xml"));
          addFonte({ titulo: p.nome + " (bot)", ...lerXmlMpc(buf) });
          b.textContent = "XML carregado ✓";
        } catch (e) { lista.insertAdjacentHTML("beforeend", `<p class="alerta">${esc(e.message)}</p>`); }
      };
      lista.append(b);
      const av = Object.assign(document.createElement("button"), { className: "acao sec", textContent: `Cartas sem versão próxima de ${p.nome}` });
      av.onclick = () => cartasParaAvisar(p.nome, lista);
      lista.append(av);
    }
  } catch {
    alvo.innerHTML = `<span class="aviso">Bot não encontrado.</span> Abra o <b>BotChelisplace.exe</b> (ele usa a porta 8781) e clique em <button class="peq" id="b-de-novo">Procurar de novo</button>`;
    $("#b-de-novo").onclick = procurarBot;
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

let fichaMd = "";
async function renderFicha() {
  if (!pedido.padrao) return;
  const alts = pedido.alteracoes.filter((a) => a.titulo.trim() && a.itens.some((i) => i.texto.trim())).map((a) => ({ ...a, itens: a.itens.filter((i) => i.texto.trim()) }));
  try {
    const r = await chamar("ficha", {
      cliente: $("#f-cliente").value.trim() || "<CLIENTE>", telefone: $("#f-tel").value.trim() || "<TELEFONE>",
      fontes: pedido.fontes.map((f) => ({ titulo: f.titulo, frentes: f.frentes.map((x) => x.nome), versos: f.versos.map((x) => x.nome) })),
      alteracoes: alts, conclusao: $("#f-conclusao").value.trim(), modo: pedido.modo, precos: pedido.precos[pedido.modo],
      chave_pix: $("#p-chave").value.trim() || "<CHAVE_PIX>", pago: ultimoOrc ? valorFinal() : null,
    });
    fichaMd = r.markdown;
  } catch (e) { $("#f-previa").innerHTML = `<span class="alerta">${esc(e.message)}</span>`; return; }
  // prévia: a mesma ficha, com as miniaturas visíveis
  $("#f-previa").innerHTML = esc(fichaMd).replace(/!\[\|\d+\]\((https:\/\/[^)\s]+)\)/g, (_, u) => `<img src="${u.replace(/&amp;/g, "&")}" alt="">`);
}
async function copiar(texto, html, aviso) {
  try {
    if (html && window.ClipboardItem) await navigator.clipboard.write([new ClipboardItem({ "text/plain": new Blob([texto], { type: "text/plain" }), "text/html": new Blob([html], { type: "text/html" }) })]);
    else await navigator.clipboard.writeText(texto);
    $("#f-aviso").textContent = aviso;
  } catch (e) { $("#f-aviso").textContent = "Não consegui copiar: " + e.message; }
}
$("#f-copiar").onclick = () => copiar(fichaMd, null, "Ficha copiada: cole no Obsidian (as miniaturas aparecem pelo link do Drive).");
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
$("#f-pdf").onclick = async () => {
  const av = $("#f-aviso"); av.textContent = "Montando o PDF…";
  try {
    await pronto;
    const alts = pedido.alteracoes.filter((a) => a.titulo.trim() && a.itens.some((i) => i.texto.trim()))
      .map((a) => ({ titulo: a.titulo, itens: a.itens.filter((i) => i.texto.trim()).map((i) => ({ texto: i.texto, pedido_img: urlPedido(i), usado_img: urlUsado(i) })) }));
    const urls = [...new Set(alts.flatMap((a) => a.itens.flatMap((i) => [i.pedido_img, i.usado_img]).filter(Boolean)))];
    const imagens = [];
    for (const u of urls) { const b = await bytesDaMiniatura(u); if (b) imagens.push([u, b]); }
    let matriz = null, codigo = null;
    if ($("#p-chave").value.trim()) {
      codigo = await chamar("pix_codigo", { chave: $("#p-chave").value, nome: $("#p-nome").value || "Chelisplace", cidade: $("#p-cidade").value || "Sao Paulo", valor: ultimoOrc ? valorFinal() : null });
      const qr = qrcode(0, "M"); qr.addData(codigo); qr.make();
      const n = qr.getModuleCount(); matriz = Array.from({ length: n }, (_, y) => Array.from({ length: n }, (_, x) => (qr.isDark(y, x) ? 1 : 0)));
    }
    const dados = { cliente: $("#f-cliente").value.trim() || "Pedido", conclusao: $("#f-conclusao").value.trim(), pago: ultimoOrc ? valorFinal() : 0, modo: pedido.modo, alteracoes: alts,
      fontes: pedido.fontes.map((f) => ({ titulo: f.titulo, frentes: f.frentes.map((x) => x.nome), versos: f.versos.map((x) => x.nome) })) };
    const bytes = await chamar("ficha_pdf", { dados, imagens, matriz, codigo });
    const sem = urls.length - imagens.length;
    av.textContent = sem ? `PDF pronto, mas ${sem} miniatura(s) não puderam ser baixadas (entre no Drive ou abra o bot).` : "PDF pronto." + (codigo ? "" : " Sem chave Pix: o PDF saiu sem QR.");
    $("#p-saida").replaceChildren(baixar(new Blob([bytes], { type: "application/pdf" }), `Ficha ${dados.cliente}.pdf`));
  } catch (e) { av.textContent = e.message; }
};
$("#f-copiar").textContent = "Copiar texto da ficha (Obsidian)";

window.aoAbrirAba = (aba) => {
  if (aba === "conferencia") procurarBot();
  if (aba === "ficha") { if (!$("#f-cliente").value && sessao.pasta) $("#f-cliente").value = sessao.pasta.nome; renderFicha(); }
};
renderFontes(); renderAlteracoes();
pronto.then(carregarPrecos);
