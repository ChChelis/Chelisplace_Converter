"use strict";
// Subpágina do cliente: lê a lista no Worker e mostra a grade. Sem clique, busca, zoom ou qualquer ação.
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
  img.onload = () => img.classList.add("ok");
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

  $("#main").innerHTML = `<div class="grid" id="grade">${d.itens.map((i) => `<figure class="gc"><div class="hit"><div class="tilt"><div class="img"><img alt="${esc(i.legenda)}" data-id="${esc(i.id)}" decoding="async" draggable="false"><div class="shine"></div><div class="glare"></div></div></div></div>${i.legenda ? `<figcaption>${esc(i.legenda)}</figcaption>` : ""}</figure>`).join("")}</div>`;
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
  const soltar = () => { if (!ativa) return; const t = ativa.querySelector(".tilt"); t.classList.remove("mov"); t.style.setProperty("--rx", "0deg"); t.style.setProperty("--ry", "0deg"); ativa.closest(".gc").classList.remove("fora"); ativa = null; };
  main.addEventListener("pointermove", (e) => {
    const hit = e.target.closest && e.target.closest(".hit");
    if (!hit) return soltar();
    if (hit !== ativa) { soltar(); ativa = hit; const g = hit.closest(".gc"); g.classList.add("fora"); if (modo === "grade") fundo(g); }
    const t = hit.querySelector(".tilt"), r = hit.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
    t.classList.add("mov"); t.style.setProperty("--ry", (x * 16) + "deg"); t.style.setProperty("--rx", (-y * 14) + "deg");
    const im = hit.querySelector(".img"); im.style.setProperty("--sx", (100 - (x + 0.5) * 100) + "%"); im.style.setProperty("--gx", ((x + 0.5) * 100) + "%"); im.style.setProperty("--gy", ((y + 0.5) * 100) + "%");
  });
  main.addEventListener("pointerleave", soltar); main.addEventListener("pointercancel", soltar); main.addEventListener("pointerup", (e) => { if (e.pointerType !== "mouse") soltar(); });
  window.addEventListener("scroll", () => { if (ativa && !matchMedia("(hover:hover)").matches) soltar(); }, { passive: true });
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
