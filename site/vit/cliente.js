"use strict";
// Subpágina do cliente: lê a lista no Worker e mostra a grade/rolagem. Só dá para trocar o modo e abrir uma carta sozinha (popup); nada mais.
const WORKER = "https://chelisplace-avisos.shrill-mountain-e326.workers.dev"; // endereço público (não é segredo)
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const aviso = (t, d) => { $("#main").innerHTML = `<div class="aviso"><b>${esc(t)}</b>${esc(d || "")}</div>`; };

let modo = "grade";
const largura = () => (modo === "rolagem" ? 800 : 480);   // a carta grande precisa de mais pixels que a miniatura da grade
// fundo desfocado com a arte em foco (duas camadas, troca com fade)
let camada = 0, fundoId = "";
function fundo(figura) {
  const img = figura.querySelector("img"), id = img.dataset.id;
  if (id === fundoId) return;
  fundoId = id;
  const url = img.classList.contains("ok") && img.currentSrc ? img.currentSrc : thumbUrl(id, 200);
  const novo = new Image();
  novo.onload = () => { if (fundoId !== id) return; const a = $(camada ? "#bgart" : "#bgart2"), b = $(camada ? "#bgart2" : "#bgart"); a.style.backgroundImage = `url(${url})`; a.classList.add("on"); b.classList.remove("on"); camada = 1 - camada; };
  novo.src = url;
}
function imagem(el) {
  const img = el.querySelector("img"), id = img.dataset.id;
  let tent = 0;
  const carregar = () => { img.src = thumbUrl(id, tent === 1 ? Math.round(largura() * 0.75) : largura()); };
  img.onload = () => { img.classList.add("ok"); const ar = img.naturalWidth / img.naturalHeight; if (ar > 0.5 && ar < 1.1) el.closest(".gc").style.setProperty("--ar", ar.toFixed(4)); };   // a moldura segue a proporção real da imagem (com sangria é ~0,735): nada é cortado
  img.onerror = () => { if (++tent < 3) setTimeout(carregar, 1200 * tent); else el.classList.add("falhou"); };
  carregar();
}

async function iniciar() {
  const slug = slugDoEndereco(location.pathname, location.search);
  if (!slug) return aviso("Vitrine não encontrada", "Confira o endereço que você recebeu.");
  let r, d;
  try { r = await fetch(`${WORKER}/vitrine/${encodeURIComponent(slug)}`, { cache: "no-store" }); d = await r.json().catch(() => ({})); }
  catch { return aviso("Sem conexão", "Não consegui carregar agora. Tente de novo em instantes."); }
  if (r.status === 410 || r.status === 404) return aviso("Esta vitrine não está mais no ar", "O prazo acabou. Peça um novo link.");
  if (!r.ok) return aviso("Não consegui abrir", "Tente de novo em instantes.");

  document.title = d.titulo; $("#titulo").textContent = d.titulo;
  const meta = () => { $("#meta").textContent = `${d.itens.length} ${d.itens.length === 1 ? "imagem" : "imagens"} · no ar por ${quantoFalta(d.expira, Date.now())}`; };
  meta();
  const intervalo = setInterval(() => { if (Date.now() >= d.expira) { clearInterval(intervalo); aviso("Esta vitrine não está mais no ar", "O prazo acabou. Peça um novo link."); $("#meta").textContent = ""; } else meta(); }, 30000);

  $("#main").innerHTML = `<div class="grid" id="grade">${d.itens.map((i) => `<figure class="gc"><div class="hit" tabindex="0" role="button" aria-label="${esc(i.legenda || "Ver carta")}"><div class="tilt"><div class="img"><img alt="${esc(i.legenda)}" data-id="${esc(i.id)}" decoding="async" draggable="false"><div class="shine"></div><div class="glare"></div></div></div></div>${i.legenda ? `<figcaption>${esc(i.legenda)}</figcaption>` : ""}</figure>`).join("")}</div>`;
  // carrega só o que está perto da tela (centenas de imagens sem travar o Drive)
  const io = "IntersectionObserver" in window ? new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { io.unobserve(e.target); imagem(e.target); } }), { rootMargin: "600px" }) : null;
  document.querySelectorAll(".img").forEach((el) => { if (io) io.observe(el); else imagem(el); });
  const figuras = [...document.querySelectorAll(".gc")];
  fundo(figuras[0]);
  // entrada suave (escalonada) e, no modo rolagem, a carta do centro vira a "atual" e dá a cor do fundo
  let lote = 0;
  const ioVis = "IntersectionObserver" in window ? new IntersectionObserver((es) => { lote = 0; es.forEach((e) => { if (e.isIntersecting) { e.target.style.setProperty("--i", Math.min(lote++, 8)); e.target.classList.add("vis"); ioVis.unobserve(e.target); } }); }, { rootMargin: "0px 0px -4% 0px" }) : null;
  figuras.forEach((f) => (ioVis ? ioVis.observe(f) : f.classList.add("vis")));
  if ("IntersectionObserver" in window) {
    const ioCur = new IntersectionObserver((es) => es.forEach((e) => { e.target.classList.toggle("cur", e.isIntersecting); if (e.isIntersecting && modo === "rolagem") fundo(e.target); }), { rootMargin: "-42% 0px -42% 0px" });
    figuras.forEach((f) => ioCur.observe(f));
  } else figuras.forEach((f) => f.classList.add("cur"));
  // inclinar a carta com o ponteiro (mouse, ou o dedo enquanto toca), com brilho; a de baixo do ponteiro também vira o fundo
  const main = $("#main"); let ativa = null;
  const soltar = () => { if (!ativa) return; const t = ativa.querySelector(".tilt"); t.classList.remove("mov"); t.style.setProperty("--rx", "0deg"); t.style.setProperty("--ry", "0deg"); const g = ativa.closest(".gc"); if (g) g.classList.remove("fora"); ativa = null; };
  const mover = (e) => {
    const hit = e.target.closest && e.target.closest(".hit");
    if (!hit) return soltar();
    if (hit !== ativa) { soltar(); ativa = hit; const g = hit.closest(".gc"); if (g) { g.classList.add("fora"); if (modo === "grade") fundo(g); } }
    const t = hit.querySelector(".tilt"), r = hit.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
    t.classList.add("mov"); t.style.setProperty("--ry", (x * 16) + "deg"); t.style.setProperty("--rx", (-y * 14) + "deg");
    const im = hit.querySelector(".img"); im.style.setProperty("--sx", (100 - (x + 0.5) * 100) + "%"); im.style.setProperty("--gx", ((x + 0.5) * 100) + "%"); im.style.setProperty("--gy", ((y + 0.5) * 100) + "%");
  };
  const ligar = (el) => { el.addEventListener("pointermove", mover); el.addEventListener("pointerleave", soltar); el.addEventListener("pointercancel", soltar); el.addEventListener("pointerup", (e) => { if (e.pointerType !== "mouse") soltar(); }); };
  ligar(main);
  window.addEventListener("scroll", () => { if (ativa && !matchMedia("(hover:hover)").matches) soltar(); }, { passive: true });

  // clicar numa carta abre ela sozinha, inteira e no tamanho da rolagem, sobre um véu preto leve; clicar fora, no X ou Esc fecha
  let aberta = null, voltarFoco = null;
  const fechar = () => {
    if (!aberta) return; const p = aberta; aberta = null; soltar();
    p.classList.remove("on"); setTimeout(() => p.remove(), 260);
    document.documentElement.classList.remove("travado"); document.removeEventListener("keydown", teclas);
    if (voltarFoco && voltarFoco.focus) voltarFoco.focus({ preventScroll: true });
  };
  const teclas = (e) => { if (e.key === "Escape") fechar(); else if (e.key === "Tab") { e.preventDefault(); const x = aberta && aberta.querySelector(".pop-x"); if (x) x.focus(); } };
  const abrir = (fig) => {
    if (aberta) return;
    const img = fig.querySelector("img"), im = fig.querySelector(".img"); if (!img.classList.contains("ok") || fig.querySelector(".img.falhou")) return;
    soltar(); voltarFoco = fig.querySelector(".hit");
    const p = document.createElement("div"); p.className = "pop"; p.setAttribute("role", "dialog"); p.setAttribute("aria-modal", "true"); p.setAttribute("aria-label", img.alt || "Carta");
    p.style.setProperty("--ar", fig.style.getPropertyValue("--ar") || ".716");
    p.innerHTML = `<div class="hit"><div class="tilt"><div class="img"><img alt="${esc(img.alt)}" draggable="false"><div class="shine"></div><div class="glare"></div></div></div></div>${img.alt ? `<div class="pop-leg">${esc(img.alt)}</div>` : ""}<button class="pop-x" aria-label="Fechar">✕</button>`;
    const grande = p.querySelector("img"); grande.src = img.currentSrc || img.src; grande.classList.add("ok");    // já mostra a versão carregada e troca pela grande quando chegar
    const nova = new Image(); nova.onload = () => { if (aberta === p) grande.src = nova.src; }; nova.src = thumbUrl(img.dataset.id, 1000);
    p.addEventListener("click", (e) => { if (!e.target.closest(".hit")) fechar(); });   // qualquer clique fora da imagem (inclusive o X) fecha
    ligar(p);
    document.body.append(p); document.documentElement.classList.add("travado"); aberta = p;
    document.addEventListener("keydown", teclas);
    requestAnimationFrame(() => { p.classList.add("on"); p.querySelector(".pop-x").focus({ preventScroll: true }); });
    fundo(fig);
  };
  main.addEventListener("click", (e) => { const h = e.target.closest(".hit"); if (h) abrir(h.closest(".gc")); });
  main.addEventListener("keydown", (e) => { if ((e.key === "Enter" || e.key === " ") && e.target.classList && e.target.classList.contains("hit")) { e.preventDefault(); abrir(e.target.closest(".gc")); } });
  const trocar = (m) => {
    modo = m; document.documentElement.classList.toggle("rolagem", m === "rolagem");
    document.querySelectorAll("#modos button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.modo === m)));
    document.querySelectorAll(".img img[src]").forEach((im) => { im.src = thumbUrl(im.dataset.id, largura()); });   // já carregadas: pede a versão do tamanho novo
    window.scrollTo(0, 0); fundoId = ""; const c0 = document.querySelector(m === "rolagem" ? ".gc.cur" : ".gc"); if (c0) fundo(c0);
  };
  $("#modos").hidden = false;
  document.querySelectorAll("#modos button").forEach((b) => { b.onclick = () => trocar(b.dataset.modo); });
  document.addEventListener("contextmenu", (e) => e.preventDefault());
}
iniciar();
