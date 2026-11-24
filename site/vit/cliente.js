"use strict";
// Subpágina do cliente: lê a lista no Worker e mostra a grade/rolagem. Só dá para trocar o modo, girar a roleta e, na grade, abrir uma carta sozinha (popup); nada mais.
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
  if (el.dataset.ini) return; el.dataset.ini = "1";
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
  let idx = 0;   // carta atual da roleta
  const meta = () => { $("#meta").textContent = `${modo === "rolagem" ? `${idx + 1} / ${d.itens.length}` : `${d.itens.length} ${d.itens.length === 1 ? "imagem" : "imagens"}`} · no ar por ${quantoFalta(d.expira, Date.now())}`; };
  meta();
  const intervalo = setInterval(() => { if (Date.now() >= d.expira) { clearInterval(intervalo); aviso("Esta vitrine não está mais no ar", "O prazo acabou. Peça um novo link."); $("#meta").textContent = ""; } else meta(); }, 30000);

  $("#main").innerHTML = `<div class="grid" id="grade">${d.itens.map((i) => `<figure class="gc"><div class="hit" tabindex="0" role="button" aria-label="${esc(i.legenda || "Ver carta")}"><div class="tilt"><div class="img"><img alt="${esc(i.legenda)}" data-id="${esc(i.id)}" decoding="async" draggable="false"><div class="shine"></div><div class="glare"></div></div></div></div>${i.legenda ? `<figcaption>${esc(i.legenda)}</figcaption>` : ""}</figure>`).join("")}</div>`;
  // carrega só o que está perto da tela (centenas de imagens sem travar o Drive)
  const io = "IntersectionObserver" in window ? new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { io.unobserve(e.target); imagem(e.target); } }), { rootMargin: "600px" }) : null;
  document.querySelectorAll(".img").forEach((el) => { if (io) io.observe(el); else imagem(el); });
  const figuras = [...document.querySelectorAll(".gc")];
  fundo(figuras[0]);
  // entrada suave (escalonada) das cartas da grade
  let lote = 0;
  const ioVis = "IntersectionObserver" in window ? new IntersectionObserver((es) => { lote = 0; es.forEach((e) => { if (e.isIntersecting) { e.target.style.setProperty("--i", Math.min(lote++, 8)); e.target.classList.add("vis"); ioVis.unobserve(e.target); } }); }, { rootMargin: "0px 0px -4% 0px" }) : null;
  figuras.forEach((f) => (ioVis ? ioVis.observe(f) : f.classList.add("vis")));
  // inclinar a carta com o ponteiro (mouse, ou o dedo enquanto toca), com brilho; a de baixo do ponteiro também vira o fundo
  const main = $("#main"); let ativa = null;
  const soltar = () => { if (!ativa) return; const t = ativa.querySelector(".tilt"); t.classList.remove("mov"); t.style.setProperty("--rx", "0deg"); t.style.setProperty("--ry", "0deg"); const g = ativa.closest(".gc"); if (g) g.classList.remove("fora"); ativa = null; };
  const mover = (e) => {
    const hit = e.target.closest && e.target.closest(".hit");
    if (!hit) return soltar();
    if (modo === "rolagem" && !hit.closest(".gc.cur") && !hit.closest(".pop")) return soltar();   // na roleta só a carta atual inclina
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
  // ---------- roleta (modo Rolagem), como a do bot: a página não rola; cada giro do mouse anda UMA carta e a atual fica travada no centro ----------
  const N = figuras.length;
  const pintar = (f, i) => {
    const dd = i - idx, ad = Math.abs(dd);
    f.style.setProperty("--d", dd); f.style.setProperty("--s", dd === 0 ? 1 : dd > 0 ? (0.93 - 0.02 * dd).toFixed(2) : 0.9); f.style.setProperty("--o", dd === 0 ? 1 : dd === 1 ? 0.55 : 0);
    f.style.zIndex = 10 - Math.min(ad, 9);
    f.classList.toggle("cur", dd === 0); f.classList.toggle("perto", ad <= 1); f.classList.toggle("longe", ad > 3);
    if (ad <= 4) imagem(f.querySelector(".img"));
  };
  const camadas = (de = 0, ate = N - 1) => { for (let i = Math.max(0, de); i <= Math.min(N - 1, ate); i++) pintar(figuras[i], i); };
  const ir = (n) => {
    const novo = Math.min(N - 1, Math.max(0, idx + n)); if (novo === idx) return;
    const ant = idx; idx = novo; soltar(); camadas(Math.min(ant, novo) - 5, Math.max(ant, novo) + 5); fundo(figuras[idx]); meta();
  };
  let ultimaRoda = 0;
  window.addEventListener("wheel", (e) => {
    if (modo !== "rolagem") return; e.preventDefault();   // nada de rolar a página: só a roleta anda
    if (aberta || !e.deltaY) return; const agora = Date.now(); if (agora - ultimaRoda < 260) return; ultimaRoda = agora;
    ir(e.deltaY > 0 ? 1 : -1);
  }, { passive: false });
  let ty = null;
  main.addEventListener("touchstart", (e) => { ty = e.touches[0].clientY; }, { passive: true });
  main.addEventListener("touchend", (e) => { if (ty == null || modo !== "rolagem" || aberta) { ty = null; return; } const dy = e.changedTouches[0].clientY - ty; ty = null; if (Math.abs(dy) > 40) ir(dy < 0 ? 1 : -1); }, { passive: true });
  document.addEventListener("keydown", (e) => {
    if (modo !== "rolagem" || aberta || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key; if (k === "ArrowDown" || k === "PageDown" || k === "ArrowRight") ir(1); else if (k === "ArrowUp" || k === "PageUp" || k === "ArrowLeft") ir(-1);
    else if (k === "Home") ir(-N); else if (k === "End") ir(N); else return;
    e.preventDefault();
  });
  main.addEventListener("click", (e) => {
    const h = e.target.closest(".hit"); if (!h) return; const f = h.closest(".gc");
    if (modo === "rolagem") { if (!f.classList.contains("cur")) ir(figuras.indexOf(f) - idx); }   // na roleta a carta já está no tamanho cheio: sem popup; clicar na vizinha só a traz para o centro
    else abrir(f);
  });
  main.addEventListener("keydown", (e) => { if (modo === "grade" && (e.key === "Enter" || e.key === " ") && e.target.classList && e.target.classList.contains("hit")) { e.preventDefault(); abrir(e.target.closest(".gc")); } });
  const trocar = (m) => {
    if (m === modo) return; soltar();
    if (m === "rolagem") {   // começa pela carta da fileira mais perto do centro da tela (a mais à esquerda, em empate)
      const cy = innerHeight / 2; let dist = Infinity;
      figuras.forEach((f, i) => { const r = f.getBoundingClientRect(), dd = Math.round(Math.abs((r.top + r.bottom) / 2 - cy) / 8); if (dd < dist) { dist = dd; idx = i; } f.classList.add("vis"); });
    }
    modo = m; document.documentElement.classList.toggle("rolagem", m === "rolagem");
    document.querySelectorAll("#modos button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.modo === m)));
    document.querySelectorAll(".img img[src]").forEach((im) => { im.src = thumbUrl(im.dataset.id, largura()); });   // já carregadas: pede a versão do tamanho novo
    if (m === "rolagem") camadas();
    else { figuras.forEach((f) => { ["--d", "--s", "--o"].forEach((k) => f.style.removeProperty(k)); f.style.zIndex = ""; f.classList.remove("cur", "perto", "longe"); }); figuras[idx].scrollIntoView({ block: "center" }); }
    fundoId = ""; fundo(figuras[idx]); meta();
  };
  $("#modos").hidden = false;
  document.querySelectorAll("#modos button").forEach((b) => { b.onclick = () => trocar(b.dataset.modo); });
  document.addEventListener("contextmenu", (e) => e.preventDefault());
}
iniciar();
