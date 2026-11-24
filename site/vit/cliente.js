"use strict";
// Subpágina do cliente: lê a lista no Worker e mostra a grade. Sem clique, busca, zoom ou qualquer ação.
const WORKER = "https://chelisplace-avisos.shrill-mountain-e326.workers.dev"; // endereço público (não é segredo)
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const aviso = (t, d) => { $("#main").innerHTML = `<div class="aviso"><b>${esc(t)}</b>${esc(d || "")}</div>`; };

let modo = "grade";
const largura = () => (modo === "rolagem" ? 800 : 480);   // a carta grande precisa de mais pixels que a miniatura da grade
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

  $("#main").innerHTML = `<div class="grid" id="grade">${d.itens.map((i) => `<figure class="gc"><div class="img"><img alt="${esc(i.legenda)}" data-id="${esc(i.id)}" decoding="async" draggable="false"></div>${i.legenda ? `<figcaption>${esc(i.legenda)}</figcaption>` : ""}</figure>`).join("")}</div>`;
  // carrega só o que está perto da tela (centenas de imagens sem travar o Drive)
  const io = "IntersectionObserver" in window ? new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { io.unobserve(e.target); imagem(e.target); } }), { rootMargin: "600px" }) : null;
  document.querySelectorAll(".img").forEach((el, i) => { if (io) io.observe(el); else imagem(el); if (i === 0) $("#bgart").style.backgroundImage = `url(${thumbUrl(d.itens[0].id, 200)})`; });
  const trocar = (m) => {
    modo = m; document.documentElement.classList.toggle("rolagem", m === "rolagem");
    document.querySelectorAll("#modos button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.modo === m)));
    document.querySelectorAll(".img img[src]").forEach((im) => { im.src = thumbUrl(im.dataset.id, largura()); });   // já carregadas: pede a versão do tamanho novo
    window.scrollTo(0, 0);
  };
  $("#modos").hidden = false;
  document.querySelectorAll("#modos button").forEach((b) => { b.onclick = () => trocar(b.dataset.modo); });
  document.addEventListener("contextmenu", (e) => e.preventDefault());
}
iniciar();
