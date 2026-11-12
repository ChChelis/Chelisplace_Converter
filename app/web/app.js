/* Interface do aplicativo. Fala só com o servidor local (/api, /img). Sem dependências. */
(function () {
  "use strict";
  var $ = function (s, r) { return (r || document).querySelector(s); }, $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var esc = function (s) { return String(s == null ? "" : s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); };
  var LS = {
    get: function (k, d) { try { var v = localStorage.getItem("bot-" + k); return v == null ? d : v; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem("bot-" + k, v); } catch (e) { /* sem armazenamento: tudo bem */ } }
  };
  var toastT;
  function toast(m) { var t = $("#toast"); t.textContent = m; t.classList.add("on"); clearTimeout(toastT); toastT = setTimeout(function () { t.classList.remove("on"); }, 2400); }
  function api(method, path, body) {
    return fetch(path, { method: method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.erro || r.statusText); return j; }); });
  }
  function evento(tipo, dados) { api("POST", "/api/evento", Object.assign({ tipo: tipo }, dados || {})).catch(function () {}); }

  var BANDS = [["alta", "Alta"], ["media", "Média"], ["baixa", "Baixa"], ["nenhum", "Sem versão"]];
  var RANK = { nenhum: 0, baixa: 1, media: 2, alta: 3 };
  var S = { pedidos: [], nome: null, order: {}, cards: [], byId: {}, dec: {}, view: LS.get("view", "car"), idx: 0, mode: LS.get("mode", "alertas"), bands: {}, q: "", pv: null, T: {}, onlyTrust: LS.get("onlytrust", "0") === "1", shown: 0, t0: 0, flip: 0, undo: [], skipped: {}, showAllUpl: false, busy: false };
  var F = [];

  /* ---------- derivados ---------- */
  function stOf(id) { return S.dec[id] ? S.dec[id].status : "pendente"; }
  function candN(c, n) { return c.cands.filter(function (k) { return k.n === n; })[0] || null; }
  function chosenN(c) { var d = S.dec[c.id]; if (d && d.status === "ok" && d.accept && d.accept.length) return d.accept[0]; return (c.prop.accept || [])[0] || null; }
  function shownCand(c) { var n = S.pv && F[S.idx] === c ? S.pv : chosenN(c); return candN(c, n) || c.cands[0] || null; }
  function frontOf(c) { return c.face ? S.cards.filter(function (f) { return f.entry === c.entry && !f.face; })[0] : null; }
  function srcOf(c) { var k = candN(c, chosenN(c)); return k ? k.source : null; }
  function pairWarn(c) {
    var f = frontOf(c); if (!f) return null;
    var a = srcOf(f), b = srcOf(c);
    return a && b && a !== b ? "verso de " + f.name + ": fonte " + b + " difere da frente (" + a + ")" : null;
  }
  function alertOf(c) {
    var r = [], i = c.prop.idx, pw = pairWarn(c);
    if (pw) r.push(pw);
    if (i != null && i < 70) r.push("índice baixo (" + i + "%)");
    if (i == null && c.prop.conf === "baixa") r.push("confiança baixa");
    if (c.prop.conf === "nenhum") r.push("sem versão próxima: falar com o cliente");
    if (/Terreno básico/.test(c.prop.note || "")) r.push("terreno básico: a arte certa pode estar fora dos candidatos");
    if (c.set !== "LIGA" && (c.fixes || []).some(function (f) { return /adivinhada|sem Scryfall/.test(f); })) r.push("impressão adivinhada");
    return r;
  }
  function hasIdx() { return S.cards.some(function (c) { return c.prop.idx != null; }); }
  function trusted(k) { return !!S.T[k.source]; }
  function trustList() { return Object.keys(S.T).filter(function (k) { return S.T[k]; }).sort(); }
  function cls(i) { return i >= 85 ? "hi" : i >= 70 ? "mid" : "lo"; }

  function filtered() {
    var q = S.q.trim().toLowerCase(), any = Object.keys(S.bands).some(function (b) { return S.bands[b]; });
    var list = S.cards.filter(function (c) {
      if (q && c.name.toLowerCase().indexOf(q) < 0 && (c.set + " " + c.cn).toLowerCase().indexOf(q) < 0) return false;
      if (any && !S.bands[c.prop.conf]) return false;
      if (S.mode === "alertas") return alertOf(c).length > 0;
      if (S.mode === "pendentes") return stOf(c.id) === "pendente";
      return true;
    });
    list.sort(function (a, b) { return RANK[a.prop.conf] - RANK[b.prop.conf] || (a.prop.idx || 0) - (b.prop.idx || 0) || a.entry - b.entry || a.face - b.face; });
    return list;
  }

  /* ---------- decisões ---------- */
  function decide(c, status, accept, via, conferido) {
    var prev = S.dec[c.id] ? JSON.parse(JSON.stringify(S.dec[c.id])) : null;
    var ms = Date.now() - S.t0;
    var doc = { status: status, accept: accept, note: (S.dec[c.id] && S.dec[c.id].note) || "", via: via || "individual", conferido: conferido !== false, ms: ms > 0 && ms < 3600000 ? ms : null };
    S.dec[c.id] = doc; S.undo.push({ id: c.id, prev: prev });
    api("PUT", "/api/pedidos/" + S.nome + "/decisoes/" + encodeURIComponent(c.id), doc).catch(function (e) { toast("Não consegui salvar: " + e.message); });
    return doc;
  }
  function clearDec(c) {
    var prev = S.dec[c.id] || null; delete S.dec[c.id]; S.undo.push({ id: c.id, prev: prev });
    api("DELETE", "/api/pedidos/" + S.nome + "/decisoes/" + encodeURIComponent(c.id)).catch(function () {});
  }
  function undo() {
    var u = S.undo.pop(); if (!u) { toast("Nada para desfazer"); return; }
    if (u.prev) { S.dec[u.id] = u.prev; api("PUT", "/api/pedidos/" + S.nome + "/decisoes/" + encodeURIComponent(u.id), u.prev).catch(function () {}); }
    else { delete S.dec[u.id]; api("DELETE", "/api/pedidos/" + S.nome + "/decisoes/" + encodeURIComponent(u.id)).catch(function () {}); }
    var c = S.byId[u.id]; if (S.view === "tri") { S.skipped = {}; }
    afterChange(); toast("Desfeito");
  }
  function saveNote(c, text) {
    var d = S.dec[c.id] || { status: "pendente", accept: [], via: "individual", conferido: true };
    d.note = text; S.dec[c.id] = d;
    api("PUT", "/api/pedidos/" + S.nome + "/decisoes/" + encodeURIComponent(c.id), d).catch(function () {});
  }
  function acceptSuggestion(c) { var n = chosenN(c); if (n == null) { decide(c, "nenhum", [], "individual"); } else decide(c, "ok", [n], "individual"); }

  /* ---------- carga ---------- */
  function loadTabs() {
    return api("GET", "/api/pedidos").then(function (p) { S.pedidos = p; renderTabs(); return p; });
  }
  function renderTabs() {
    $("#tabs").innerHTML = S.pedidos.map(function (p) {
      return '<button class="tab" role="tab" data-p="' + esc(p.nome) + '" aria-selected="' + (S.nome === p.nome) + '"><b>' + esc(p.nome) + "</b>" +
        (p.pronto ? "<small>" + (S.nome === p.nome && S.cards.length ? S.cards.filter(function (c) { return stOf(c.id) !== "pendente"; }).length + "/" + S.cards.length : (p.decididas || 0) + "/" + (p.cartas || "?")) + "</small>" : "<small>processando…</small>") + "</button>";
    }).join("") + '<button class="tab add" data-p="__novo">+ Novo pedido</button>';
  }
  function openPedido(nome) {
    S.nome = nome; LS.set("pedido", nome); renderTabs();
    $("#main").innerHTML = '<div class="loading"><div class="spin"></div>Carregando ' + esc(nome) + "…</div>";
    return Promise.all([api("GET", "/api/pedidos/" + encodeURIComponent(nome) + "/catalogo"), api("GET", "/api/pedidos/" + encodeURIComponent(nome) + "/decisoes")]).then(function (r) {
      S.order = r[0].order || {}; S.cards = r[0].cards; S.byId = {}; S.cards.forEach(function (c) { S.byId[c.id] = c; });
      S.dec = r[1]; S.undo = []; S.skipped = {}; S.idx = 0; S.pv = null;
      if (!hasIdx() && S.mode === "alertas") S.mode = "todas";
      $("#filters").hidden = false; $("#ov").hidden = false;
      renderAll();
    }).catch(function (e) { $("#main").innerHTML = '<div class="empty">Esse pedido ainda não está pronto (' + esc(e.message) + ").</div>"; $("#ov").hidden = true; $("#filters").hidden = true; });
  }

  /* ---------- resumo do pedido ---------- */
  function renderOverview() {
    var box = $("#ov"); if (!S.cards.length) { box.hidden = true; return; }
    var tot = 0, w = 0, exp = 0, band = { alta: 0, media: 0, baixa: 0, nenhum: 0 }, dec = 0, pend = 0;
    S.cards.forEach(function (c) {
      var q = c.qty || 1, i = c.prop.idx; band[c.prop.conf]++;
      if (i != null) { tot += q; w += q * i; exp += (1 - i / 100) * q; }
      if (stOf(c.id) === "pendente") pend++; else dec++;
    });
    var overall = tot ? Math.round(w / tot) : null, als = S.cards.filter(function (c) { return alertOf(c).length; }), alPend = als.filter(function (c) { return stOf(c.id) === "pendente"; }).length;
    var rest = S.cards.filter(function (c) { return !alertOf(c).length && stOf(c.id) === "pendente"; }).length;
    var tw = S.cards.length;
    box.innerHTML = (overall != null ? '<div><div class="ov-big ' + cls(overall) + '">' + overall + '%</div><div class="ov-lbl">índice do pedido</div></div>' : "") +
      '<div class="ov-sub">' + (overall != null ? "Chance média de você aceitar cada escolha do bot. Dá para esperar uma troca em cerca de <b>" + Math.round(exp) + "</b> das <b>" + tot + "</b> imagens. " : "") +
      "<b>" + als.length + "</b> alerta" + (als.length === 1 ? "" : "s") + ", <b>" + alPend + "</b> ainda sem decisão. " + band.alta + " alta · " + band.media + " média · " + band.baixa + " baixa · " + band.nenhum + " sem versão próxima.</div>" +
      '<div style="min-width:160px"><div class="bar"><i style="width:' + (100 * dec / tw) + '%;background:var(--ok)"></i></div><div class="ov-lbl" style="margin-top:4px">' + dec + " de " + tw + " decididas</div></div>" +
      '<div class="ov-act"><button class="btn" id="oUndo">↶ Desfazer</button>' + (rest ? '<button class="btn pri" id="oRest">Aceitar as ' + rest + " sem alerta</button>" : "") + "</div>";
    $("#cntU").textContent = trustList().length; renderTabs();
  }

  /* ---------- filtros ---------- */
  function renderFilters() {
    $("#fAl").setAttribute("aria-pressed", S.mode === "alertas"); $("#fPe").setAttribute("aria-pressed", S.mode === "pendentes"); $("#fTo").setAttribute("aria-pressed", S.mode === "todas");
    var n = {}; S.cards.forEach(function (c) { n[c.prop.conf] = (n[c.prop.conf] || 0) + 1; });
    $("#chips").innerHTML = BANDS.map(function (b) { return '<button class="chip" data-b="' + b[0] + '" aria-pressed="' + !!S.bands[b[0]] + '">' + b[1] + "<small>" + (n[b[0]] || 0) + "</small></button>"; }).join("");
    $("#onlytrust").checked = S.onlyTrust; document.body.classList.toggle("only-trust", S.onlyTrust);
    $("#resCount").textContent = F.length + " de " + S.cards.length + " cartas";
  }

  /* ---------- renderização geral ---------- */
  function renderAll(keep) {
    F = filtered(); if (!keep || S.idx >= F.length) S.idx = Math.min(S.idx, Math.max(0, F.length - 1));
    renderOverview(); renderFilters(); renderTabs();
    $("#vCar").setAttribute("aria-pressed", S.view === "car"); $("#vGrid").setAttribute("aria-pressed", S.view === "grid"); $("#vTri").setAttribute("aria-pressed", S.view === "tri");
    S.t0 = Date.now();
    if (S.view === "car") mountCarousel(); else if (S.view === "tri") mountTri(); else mountGrid();
  }
  function afterChange() { var id = F[S.idx] && F[S.idx].id; F = filtered(); var k = F.findIndex(function (c) { return c.id === id; }); if (k >= 0) S.idx = k; renderOverview(); renderFilters(); refreshView(); }
  function refreshView() {
    if (S.view === "car") { layoutReel(); renderInfo(); } else if (S.view === "grid") { $$(".gc").forEach(updateTile); } else { renderTri(); }
  }
  function setBg() { var c = F[S.idx], k = c && shownCand(c); $("#bgart").style.backgroundImage = k ? "url(" + k.img + ")" : ""; }

  /* ---------- carrossel ---------- */
  var reelEls = {};
  function mountCarousel() {
    $("#main").innerHTML = '<div class="carousel"><div class="reelwrap"><div class="reel" id="reel" aria-label="Cartas"></div></div><div class="info" id="info"></div></div>';
    reelEls = {}; bindReel(); layoutReel(true); renderInfo();
  }
  function mkReelCard(c) {
    var el = document.createElement("div"); el.className = "rc"; el.dataset.id = c.id;
    el.innerHTML = '<div class="tilt"><div class="face"><img alt="' + esc(c.name) + '" draggable="false"><div class="shine"></div><span class="stamp" hidden></span></div><div class="face back"><img alt="Referência do Scryfall" draggable="false" src="' + c.ref + '"></div></div>';
    return el;
  }
  function paintReelCard(el, c) {
    var k = shownCand(c), im = el.querySelector(".face:not(.back) img"); if (k && im.getAttribute("src") !== k.img) im.src = k.img;
    var st = stOf(c.id), sp = el.querySelector(".stamp"); sp.hidden = st === "pendente"; sp.className = "stamp " + st; sp.textContent = st === "ok" ? "CONFERIDO" : st === "nenhum" ? "NENHUM" : "DÚVIDA";
  }
  function layoutReel() {
    var reel = $("#reel"); if (!reel) return;
    if (!F.length) { reel.innerHTML = ""; reelEls = {}; $("#info").innerHTML = '<div class="empty">Nenhuma carta com esses filtros.</div>'; return; }
    var keep = {};
    for (var d = -3; d <= 3; d++) {
      var i = S.idx + d; if (i < 0 || i >= F.length) continue;
      var c = F[i]; keep[c.id] = 1;
      var el = reelEls[c.id];
      if (!el) { el = mkReelCard(c); reelEls[c.id] = el; el.style.opacity = 0; el.style.transform = "translateY(" + (d > 0 ? "110%" : "-110%") + ") scale(.9)"; reel.appendChild(el); void el.offsetHeight; }
      paintReelCard(el, c);
      el.classList.toggle("cur", d === 0); el.style.zIndex = 10 - Math.abs(d);
      if (d === 0) { el.style.transform = "translateY(0) scale(1)"; el.style.opacity = 1; }
      else if (d > 0) { el.style.transform = "translateY(calc(var(--ch)*" + (1.04 * d).toFixed(2) + ")) scale(" + (0.93 - 0.02 * d).toFixed(2) + ")"; el.style.opacity = d === 1 ? 0.55 : 0; }
      else { el.style.transform = "translateY(calc(var(--ch)*" + (1.04 * d).toFixed(2) + ")) scale(.9)"; el.style.opacity = 0; }
      el.style.pointerEvents = Math.abs(d) <= 1 ? "auto" : "none";
    }
    Object.keys(reelEls).forEach(function (id) { if (!keep[id]) { reelEls[id].remove(); delete reelEls[id]; } });
    var cur = F[S.idx] && reelEls[F[S.idx].id]; if (cur) cur.querySelector(".tilt").style.setProperty("--flip", S.flip + "deg");
    setBg();
  }
  function bindReel() {
    var reel = $("#reel");
    reel.addEventListener("click", function (e) {
      var el = e.target.closest(".rc"); if (!el) return;
      var i = F.findIndex(function (c) { return c.id === el.dataset.id; });
      if (i !== S.idx) go(i - S.idx); else flip();
    });
    reel.addEventListener("mousemove", function (e) {
      if (matchMedia("(hover:none)").matches) return;
      var el = reel.querySelector(".rc.cur"); if (!el) return; var t = el.querySelector(".tilt"), r = el.getBoundingClientRect();
      var x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
      t.style.transition = "transform .08s"; t.style.setProperty("--ry", (x * 16) + "deg"); t.style.setProperty("--rx", (-y * 14) + "deg");
      el.querySelector(".shine").style.setProperty("--sx", (100 - (x + 0.5) * 100) + "%");
    });
    reel.addEventListener("mouseleave", function () { var t = reel.querySelector(".rc.cur .tilt"); if (t) { t.style.transition = ""; t.style.setProperty("--ry", "0deg"); t.style.setProperty("--rx", "0deg"); } });
    var wl = 0; reel.addEventListener("wheel", function (e) { e.preventDefault(); var n = Date.now(); if (n - wl < 260) return; wl = n; go(e.deltaY > 0 ? 1 : -1); }, { passive: false });
    var ty = null; reel.addEventListener("touchstart", function (e) { ty = e.touches[0].clientY; }, { passive: true });
    reel.addEventListener("touchend", function (e) { if (ty == null) return; var dy = e.changedTouches[0].clientY - ty; ty = null; if (Math.abs(dy) > 40) go(dy < 0 ? 1 : -1); }, { passive: true });
  }
  function go(n) {
    if (!F.length) return; var i = Math.min(F.length - 1, Math.max(0, S.idx + n)); if (i === S.idx) return;
    var ms = Date.now() - S.t0; if (ms > 1500 && F[S.idx] && ms < 600000) evento("visto", { pedido: S.nome, id: F[S.idx].id, ms: ms });
    S.idx = i; S.flip = 0; S.pv = null; S.t0 = Date.now(); layoutReel(); renderInfo();
  }
  function flip() { S.flip = S.flip ? 0 : 180; var cur = F[S.idx] && reelEls[F[S.idx].id]; if (cur) cur.querySelector(".tilt").style.setProperty("--flip", S.flip + "deg"); }
  function ordered(c) {
    var sug = c.prop.accept || [], near = c.prop.near || [], rk = function (n) { return sug.indexOf(n) >= 0 ? 0 : near.indexOf(n) >= 0 ? 1 : 2; };
    return c.cands.slice().sort(function (a, b) { return rk(a.n) - rk(b.n) || a.n - b.n; });
  }
  function renderInfo() {
    var box = $("#info"); if (!box) return; var c = F[S.idx];
    if (!c) { box.innerHTML = '<div class="empty">Nenhuma carta com esses filtros.</div>'; return; }
    var st = stOf(c.id), k = shownCand(c), als = alertOf(c), list = ordered(c), lim = S.shown ? list.length : 10, i = c.prop.idx;
    var cl = c.prop.conf === "alta" ? "hi" : c.prop.conf === "media" ? "mid" : "lo";
    var sel = chosenN(c), sug = c.prop.accept || [], near = c.prop.near || [];
    var hasTrust = c.cands.some(trusted);
    box.innerHTML = '<div class="meta" style="margin-bottom:8px">' + esc(S.nome).toUpperCase() + " · " + (S.idx + 1) + " / " + F.length + "</div>" +
      "<h1>" + esc(c.name) + '</h1><div class="type">' + esc(c.set) + " " + esc(c.cn) + (c.face ? " · verso" + (frontOf(c) ? " de " + esc(frontOf(c).name) : "") : "") + " · ×" + c.qty + "</div>" +
      '<div class="tags"><span class="tag ' + cl + '">confiança ' + esc(c.prop.conf) + "</span>" + (i != null ? '<span class="tag ' + cls(i) + '">índice ' + i + "%</span>" : "") +
      '<span class="tag">' + (st === "ok" ? "conferido" : st === "nenhum" ? "nenhum serve" : st === "duvida" ? "dúvida" : "pendente") + "</span>" +
      als.map(function (a) { return '<span class="tag alert">' + esc(a) + "</span>"; }).join("") + "</div>" +
      '<p class="note"><b>Meu motivo:</b> ' + esc(c.prop.note) + "</p>" +
      '<div class="cmp"><figure><div style="display:flex;gap:10px;align-items:flex-end"><img class="refmini" src="' + c.ref + '" alt="Referência"><div class="foot" style="flex:1;background-image:url(' + c.ref + ')"></div></div><figcaption>Referência · rodapé</figcaption></figure>' +
      (k ? '<figure><div class="foot" style="height:98px;background-image:url(' + k.img + ')"></div><figcaption>Candidato ' + k.n + " · rodapé</figcaption></figure>" : "") + "</div>" +
      '<div class="cands">' + list.slice(0, lim).map(function (x) {
        var tr = trusted(x), hide = S.onlyTrust && hasTrust && !tr;
        return '<div class="cd' + (sug.indexOf(x.n) >= 0 ? " sug" : near.indexOf(x.n) >= 0 ? " near" : "") + (st === "ok" && sel === x.n ? " sel" : "") + (tr ? " trusted" : "") + (hide ? " hasno" : "") + '" data-n="' + x.n + '" tabindex="0" role="button" aria-label="Candidato ' + x.n + '">' +
          '<img loading="lazy" src="' + x.img + '" alt=""><span class="n">' + x.n + '</span><div class="s">' + esc(x.source) + " · " + x.dpi + " dpi" + (x.sc != null ? " · " + x.sc : "") + "</div></div>";
      }).join("") + "</div>" + (list.length > lim ? '<button class="btn" id="bMore">Mostrar mais (' + (list.length - lim) + ")</button>" : "") +
      '<div class="rows"><button class="btn pri" data-a="accept">' + ((c.prop.accept || []).length ? "Aceitar sugestão" : "Confirmar: nenhum serve") + '</button><button class="btn bad" data-a="nenhum">Nenhum serve</button><button class="btn warn" data-a="duvida">Dúvida</button><button class="btn" data-a="clear">Limpar</button></div>' +
      '<input class="notein" type="text" id="note" placeholder="Anotação (opcional)" value="' + esc((S.dec[c.id] && S.dec[c.id].note) || "") + '" aria-label="Anotação">' +
      '<div class="nav"><button class="btn" data-g="-1">↑ Anterior</button><button class="btn" data-g="1">Próxima ↓</button><button class="btn" id="bFlip">Virar (referência)</button><button class="btn" id="bToGrid">Ver grade</button></div>' +
      '<div class="keys"><kbd>↑</kbd> <kbd>↓</kbd> cartas · <kbd>←</kbd> <kbd>→</kbd> candidatos · <kbd>Enter</kbd> aceita o candidato em vista · <kbd>N</kbd> nenhum · <kbd>D</kbd> dúvida · <kbd>Backspace</kbd> limpa · <kbd>Espaço</kbd> vira · <kbd>Z</kbd> desfaz · <kbd>G</kbd> grade · <kbd>T</kbd> triagem</div>';
    var note = $("#note"); if (note) note.addEventListener("change", function () { saveNote(c, note.value); });
  }
  function actCur(a) {
    var c = F[S.idx]; if (!c) return;
    if (a === "accept") { var n = S.pv || chosenN(c); if (n == null) decide(c, "nenhum", [], "individual"); else decide(c, "ok", [n], "individual"); }
    else if (a === "nenhum") decide(c, "nenhum", [], "individual");
    else if (a === "duvida") decide(c, "duvida", (S.dec[c.id] && S.dec[c.id].accept) || [], "individual");
    else if (a === "clear") clearDec(c);
    S.pv = null; var el = reelEls[c.id]; if (el && a === "accept") { var f = el.querySelector(".face"); f.classList.remove("pop"); void f.offsetWidth; f.classList.add("pop"); }
    renderOverview(); renderFilters(); layoutReel(); renderInfo();
    if (a === "accept" || a === "nenhum") { setTimeout(function () { if (S.view === "car" && F[S.idx] === c) go(1); }, 250); }
  }

  /* ---------- grade ---------- */
  function mountGrid() {
    var main = $("#main");
    if (!F.length) { main.innerHTML = '<div class="empty">Nenhuma carta com esses filtros.</div>'; return; }
    main.innerHTML = '<div class="gridwrap"><div class="grid" id="grid">' + F.map(function (c, i) {
      return '<div class="gc" data-id="' + esc(c.id) + '" data-i="' + i + '" tabindex="0" role="button" aria-label="' + esc(c.name) + '"><img loading="lazy" decoding="async" alt="' + esc(c.name) + '" draggable="false"><div class="nm">' + esc(c.name) + '</div><div class="bd"></div>' +
        '<div class="ov2"><button data-x="nenhum" aria-label="Nenhum serve">✕</button><button data-x="open" aria-label="Abrir no carrossel">⤢</button><button data-x="ok" aria-label="Aceitar sugestão">✓</button></div></div>';
    }).join("") + "</div></div>";
    $$(".gc").forEach(updateTile);
    $("#grid").addEventListener("click", function (e) {
      var el = e.target.closest(".gc"); if (!el) return; var c = S.byId[el.dataset.id], x = e.target.closest("button"), a = x && x.dataset.x;
      if (a === "ok") { acceptSuggestion(c); afterChange(); } else if (a === "nenhum") { decide(c, "nenhum", [], "individual"); afterChange(); }
      else { S.idx = +el.dataset.i; setView("car"); }
    });
    $("#bgart").style.backgroundImage = F[0] ? "url(" + (shownCand(F[0]) || {}).img + ")" : "";
  }
  function updateTile(el) {
    var c = S.byId[el.dataset.id], k = candN(c, chosenN(c)) || c.cands[0], im = el.querySelector("img"), st = stOf(c.id);
    var src = k ? k.img : c.ref; if (im.getAttribute("src") !== src) im.src = src;
    el.className = "gc" + (st !== "pendente" ? " s-" + st : "");
    var i = c.prop.idx, b = "";
    if (i != null) b += '<span class="' + (i >= 85 ? "hi" : i >= 70 ? "" : "lo") + '">' + i + "%</span>";
    if (c.qty > 1) b += '<span class="q">×' + c.qty + "</span>";
    el.querySelector(".bd").innerHTML = b;
  }

  /* ---------- triagem ---------- */
  var TQ = [], drag = null;
  function triQ() { return F.filter(function (c) { return stOf(c.id) === "pendente" && !S.skipped[c.id]; }); }
  function mountTri() {
    $("#main").innerHTML = '<div class="tri"><div class="meta" id="triMeta"></div><div class="tri-row"><div class="tri-stage" id="triStage"></div></div><div class="tri-info" id="triInfo"></div>' +
      '<div class="tri-bar"><button class="tb no" data-v="n" aria-label="Nenhum serve (seta esquerda)">✕<small>Nenhum</small></button><button class="tb meh" data-v="m" aria-label="Pular (seta para baixo)">↷<small>Pular</small></button><button class="tb sup" data-v="s" aria-label="Dúvida (seta para cima)">?<small>Dúvida</small></button><button class="tb yes" data-v="y" aria-label="Aceitar (seta direita)">✓<small>Aceitar</small></button></div>' +
      '<div><button class="btn" id="triUndo">↶ Desfazer</button></div>' +
      '<div class="keys"><kbd>→</kbd> aceita a sugestão · <kbd>←</kbd> nenhum serve · <kbd>↑</kbd> dúvida · <kbd>↓</kbd> pula · <kbd>Z</kbd> desfaz · ou arraste a carta</div></div>';
    bindTri(); renderTri();
  }
  function renderTri() {
    var st = $("#triStage"); if (!st) return; TQ = triQ(); var cs = TQ.slice(0, 3);
    $("#triMeta").textContent = TQ.length + " pendentes nesta seleção";
    var bar = $(".tri-bar");
    if (!cs.length) { st.innerHTML = ""; st.style.display = "none"; bar.style.visibility = "hidden"; $("#triInfo").innerHTML = '<div class="empty" style="padding:20px">Nenhuma carta pendente nesta seleção.</div>'; return; }
    st.style.display = ""; bar.style.visibility = "";
    st.innerHTML = cs.map(function (c, i) { var k = candN(c, chosenN(c)) || c.cands[0]; return '<div class="tc" data-d="' + i + '" data-id="' + esc(c.id) + '"><img alt="' + esc(c.name) + '" draggable="false" src="' + (k ? k.img : c.ref) + '">' + (i === 0 ? '<span class="st y">ACEITAR</span><span class="st n">NENHUM</span><span class="st m">PULAR</span><span class="st s">? DÚVIDA</span>' : "") + "</div>"; }).reverse().join("");
    var c = cs[0], k = candN(c, chosenN(c)) || c.cands[0];
    $("#triInfo").innerHTML = '<div class="tn">' + esc(c.name) + '</div><div class="meta">' + esc(c.set) + " " + esc(c.cn) + (c.face ? " · verso" : "") + " · confiança " + esc(c.prop.conf) + (c.prop.idx != null ? " · índice " + c.prop.idx + "%" : "") + (k ? " · " + esc(k.source) : "") + "</div>" +
      '<div class="meta" style="max-width:60ch;margin:4px auto 0">' + alertOf(c).map(esc).join(" · ") + "</div>";
    $("#bgart").style.backgroundImage = k ? "url(" + k.img + ")" : ""; S.t0 = Date.now();
  }
  function bindTri() {
    var st = $("#triStage"), T = Math.min(110, innerWidth * 0.22);
    var dec = function (dx, dy) { return dx > T && dx > Math.abs(dy) ? "y" : dx < -T && -dx > Math.abs(dy) ? "n" : dy < -T && -dy > Math.abs(dx) ? "s" : dy > T && dy > Math.abs(dx) ? "m" : null; };
    st.addEventListener("pointerdown", function (e) {
      if (e.button !== 0 || S.busy) return; var el = e.target.closest('.tc[data-d="0"]'); if (!el) return;
      drag = { el: el, x: e.clientX, y: e.clientY, id: e.pointerId, dx: 0, dy: 0 };
      try { el.setPointerCapture(e.pointerId); } catch (_) { /* ok */ } el.style.transition = "none"; el.style.cursor = "grabbing";
    });
    st.addEventListener("pointermove", function (e) {
      if (!drag || e.pointerId !== drag.id) return; drag.dx = e.clientX - drag.x; drag.dy = e.clientY - drag.y;
      var el = drag.el, dx = drag.dx, dy = drag.dy, k = function (v) { return Math.max(0, Math.min(1, v / T)); };
      el.style.transform = "translate(" + dx + "px," + dy + "px) rotate(" + (dx * 0.05) + "deg)";
      el.querySelector(".st.y").style.opacity = k(dx); el.querySelector(".st.n").style.opacity = k(-dx);
      el.querySelector(".st.s").style.opacity = -dy > Math.abs(dx) ? k(-dy) : 0; el.querySelector(".st.m").style.opacity = dy > Math.abs(dx) ? k(dy) : 0;
    });
    var end = function (e) {
      if (!drag || e.pointerId !== drag.id) return; var el = drag.el, dx = drag.dx, dy = drag.dy; drag = null; el.style.cursor = "";
      var v = e.type === "pointercancel" ? null : dec(dx, dy);
      if (v) flyOut(v); else { el.style.transition = ""; el.style.transform = ""; $$(".st", el).forEach(function (x) { x.style.opacity = 0; }); }
    };
    st.addEventListener("pointerup", end); st.addEventListener("pointercancel", end);
  }
  function flyOut(v) {
    if (S.busy || S.view !== "tri") return; var c = TQ[0]; if (!c) return;
    var el = $('#triStage .tc[data-d="0"]'); if (!el) return; S.busy = true;
    var W = innerWidth, H = innerHeight, dx = v === "y" ? W : v === "n" ? -W : 0, dy = v === "s" ? -H : v === "m" ? H : 0;
    var stamp = el.querySelector(".st." + v); if (stamp) stamp.style.opacity = 1;
    el.style.transition = "transform .28s ease-in,opacity .28s"; el.style.transform = "translate(" + dx + "px," + dy + "px) rotate(" + (v === "y" ? 22 : v === "n" ? -22 : 0) + "deg)"; el.style.opacity = 0;
    setTimeout(function () {
      S.busy = false;
      if (v === "y") acceptSuggestion(c); else if (v === "n") decide(c, "nenhum", [], "individual"); else if (v === "s") decide(c, "duvida", [], "individual"); else S.skipped[c.id] = 1;
      renderOverview(); renderFilters(); renderTri();
    }, 270);
  }

  /* ---------- visões e filtros ---------- */
  function setView(v) { S.view = v; LS.set("view", v); renderAll(true); }
  function setMode(m) { S.mode = m; LS.set("mode", m); S.idx = 0; S.skipped = {}; renderAll(); }

  /* ---------- resumo: aceitar sem alerta ---------- */
  function askRest() {
    var list = S.cards.filter(function (c) { return !alertOf(c).length && stOf(c.id) === "pendente"; }), box = $("#confirm");
    box.hidden = false;
    box.innerHTML = '<span>Aceitar as <b>' + list.length + "</b> sugestões sem alerta?</span>" +
      '<button class="btn pri" data-r="sim">Sim, conferi</button><button class="btn" data-r="semconf">Aceitar sem conferir</button><button class="btn" data-r="nao">Cancelar</button>' +
      '<span class="info-t">"Sem conferir" vale para o XML, mas essas escolhas não entram no treino do bot.</span>';
    box.onclick = function (e) {
      var b = e.target.closest("[data-r]"); if (!b) return; var r = b.dataset.r; box.hidden = true;
      if (r === "nao") return;
      list.forEach(function (c) { var n = chosenN(c); if (n != null) decide(c, "ok", [n], "lote", r === "sim"); else decide(c, "nenhum", [], "lote", r === "sim"); });
      evento("aceite_em_lote", { pedido: S.nome, n: list.length, conferido: r === "sim" }); toast(list.length + " sugestões aceitas"); afterChange();
    };
  }

  /* ---------- gaveta: XML e imagens ---------- */
  function openDrawer(o) { $("#drawer").classList.toggle("open", o); $("#scrim").classList.toggle("on", o); if (o) renderDrawer(); }
  function renderDrawer() {
    if (!S.nome) { $("#dBody").innerHTML = '<div class="empty">Abra um pedido.</div>'; return; }
    var dec = S.cards.filter(function (c) { return stOf(c.id) !== "pendente"; }).length, ok = S.cards.filter(function (c) { return stOf(c.id) === "ok"; }).length, pend = S.cards.length - dec;
    $("#dBody").innerHTML = '<div class="box"><h3>Gerar o XML</h3><div class="info-t"><b>' + ok + "</b> conferidas · <b>" + pend + "</b> pendentes (ficam de fora) · <b>" + (dec - ok) + "</b> nenhum/dúvida (ficam de fora)</div>" +
      '<div><button class="btn pri" id="mkxml">Gerar XML</button></div><div class="info-t" id="xmlmsg"></div><div id="xmlDl"></div></div>' +
      '<div class="box"><h3>Baixar as imagens</h3><label>Pasta de destino (vazio = dentro dos dados do aplicativo)<input type="text" id="pasta" placeholder="C:\\Users\\você\\Downloads\\pedido" value="' + esc(LS.get("pasta", "")) + '"></label>' +
      '<div><button class="btn" id="mkimg">Baixar imagens do XML</button></div><div class="prog" id="imgProg" hidden><i style="width:0%"></i></div><div class="info-t" id="imgMsg"></div></div>' +
      '<div class="box"><h3>Mensagem para o cliente</h3><div class="info-t">Cartas sem versão próxima e as suas anotações.</div><div><button class="btn" id="mkmsg">Montar mensagem</button></div><textarea id="cmsg" rows="8" hidden readonly></textarea></div>';
  }
  function gerarXml() {
    $("#xmlmsg").textContent = "Gerando…";
    api("POST", "/api/pedidos/" + encodeURIComponent(S.nome) + "/xml", {}).then(function (r) {
      $("#xmlmsg").innerHTML = "<b>" + r.usadas + "</b> cartas entram (moldura de " + r.moldura + ")." + (r.fora.length ? " Ficam de fora, para resolver à mão: " + esc(r.fora.join("; ")) + "." : " Nenhuma carta fica de fora.") + (r.em_lote ? " " + r.em_lote + " aceitas em lote sem conferir (não entram no treino)." : "");
      $("#xmlDl").innerHTML = '<a class="btn" href="/api/pedidos/' + encodeURIComponent(S.nome) + '/xml" download="' + esc(S.nome) + '.xml" style="display:inline-block;text-decoration:none">Baixar o XML</a>';
      loadTabs();
    }).catch(function (e) { $("#xmlmsg").textContent = "Erro: " + e.message; });
  }
  function pollImg() {
    api("GET", "/api/pedidos/" + encodeURIComponent(S.nome) + "/baixar").then(function (j) {
      var p = $("#imgProg"), m = $("#imgMsg"); if (!p) return; if (j.estado === "sem andamento") return;
      p.hidden = false; p.firstChild.style.width = (j.total ? 100 * j.feito / j.total : 0) + "%";
      m.textContent = j.feito + " de " + j.total + " em " + j.pasta + (j.falhas && j.falhas.length ? " · falharam: " + j.falhas.join(", ") : "") + (j.estado === "pronto" ? " · pronto" : "");
      if (j.estado === "rodando") setTimeout(pollImg, 1500);
    }).catch(function () {});
  }
  function clientMsg() {
    var items = S.cards.filter(function (c) { return !c.face && (c.prop.conf === "nenhum" || (S.dec[c.id] && S.dec[c.id].note)); });
    var box = $("#cmsg"); box.hidden = false;
    box.value = items.length ? "Oi! Sobre estas cartas:\n\n" + items.map(function (c) {
      var k = candN(c, chosenN(c)), n = S.dec[c.id] && S.dec[c.id].note;
      return "• " + c.name + " (" + c.set + " " + c.cn + ")" + (c.qty > 1 ? " ×" + c.qty : "") + (k ? " → versão escolhida: " + k.name + " (" + k.source + ")" : "") + (n ? " — " + n : "");
    }).join("\n") + "\n\nPode ser assim ou prefere outra?" : "Nenhum alerta para o cliente neste pedido.";
    box.focus(); box.select(); try { navigator.clipboard.writeText(box.value); } catch (e) { /* sem área de transferência */ }
  }

  /* ---------- uploaders ---------- */
  function renderUpl() {
    var counts = {}, names = {}, q = ($("#uplq").value || "").toLowerCase();
    S.cards.forEach(function (c) { var seen = {}; c.cands.forEach(function (k) { if (!seen[k.source]) { seen[k.source] = 1; counts[k.source] = (counts[k.source] || 0) + 1; } }); });
    (S.order.sources || []).concat(Object.keys(counts), trustList()).forEach(function (n) { names[n] = 1; });
    var list = Object.keys(names).filter(function (n) { return (S.showAllUpl || counts[n] || S.T[n]) && (!q || n.toLowerCase().indexOf(q) >= 0); });
    list.sort(function (a, b) { return (S.T[b] ? 1 : 0) - (S.T[a] ? 1 : 0) || (counts[b] || 0) - (counts[a] || 0) || a.toLowerCase().localeCompare(b.toLowerCase()); });
    $("#uplchips").innerHTML = list.map(function (n) { return '<button class="chip' + (S.T[n] ? " on" : "") + '" data-u="' + esc(n) + '" aria-pressed="' + !!S.T[n] + '">' + (S.T[n] ? "★ " : "") + esc(n) + (counts[n] ? "<small>" + counts[n] + "</small>" : "") + "</button>"; }).join("") || '<span class="info-t">Nenhum uploader encontrado.</span>';
    $("#uplall").textContent = S.showAllUpl ? "Só os deste pedido" : "Mostrar todos (" + Object.keys(names).length + ")";
    $("#cntU").textContent = trustList().length;
  }
  function saveTrust() { api("PUT", "/api/uploaders", { trusted: trustList() }).catch(function (e) { toast("Não consegui salvar os uploaders: " + e.message); }); renderUpl(); if (S.nome) { renderFilters(); if (S.view === "car") renderInfo(); } }

  /* ---------- novo pedido ---------- */
  function startNovo() {
    var nome = $("#nNome").value.trim(), lista = $("#nLista").value; $("#nErro").textContent = "";
    $("#nGo").disabled = true;
    api("POST", "/api/pedidos", { nome: nome, lista: lista }).then(function () { $("#nProg").hidden = false; pollNovo(nome); loadTabs(); })
      .catch(function (e) { $("#nErro").textContent = e.message; $("#nGo").disabled = false; });
  }
  function pollNovo(nome) {
    api("GET", "/api/pedidos/" + encodeURIComponent(nome) + "/andamento").then(function (j) {
      var fases = { resolvendo: "Conferindo as cartas no Scryfall", candidatos: "Buscando e comparando candidatos no MPCFill", catalogo: "Montando a conferência" };
      $("#nFase").textContent = (fases[j.fase] || j.estado) + (j.total ? " — " + j.feito + " de " + j.total : "");
      var base = j.fase === "resolvendo" ? 0 : j.fase === "candidatos" ? 15 : 97, span = j.fase === "resolvendo" ? 15 : j.fase === "candidatos" ? 82 : 3;
      $("#nBar").style.width = (base + (j.total ? span * j.feito / j.total : 0)) + "%";
      if (j.estado === "pronto") { $("#nGo").disabled = false; closeModals(); loadTabs().then(function () { openPedido(nome); }); return; }
      if (j.estado === "erro") { $("#nErro").textContent = "Erro: " + j.erro; $("#nGo").disabled = false; return; }
      setTimeout(function () { pollNovo(nome); }, 2000);
    }).catch(function () { setTimeout(function () { pollNovo(nome); }, 3000); });
  }

  /* ---------- janelas ---------- */
  function openModal(id) { $("#" + id).classList.add("open"); }
  function closeModals() { $$(".modal").forEach(function (m) { m.classList.remove("open"); }); }
  function anyModal() { return $$(".modal.open").length > 0 || $("#drawer").classList.contains("open"); }

  /* ---------- eventos ---------- */
  document.addEventListener("click", function (e) {
    var t = e.target;
    var tab = t.closest(".tab"); if (tab) { if (tab.dataset.p === "__novo") { $("#nProg").hidden = true; $("#nErro").textContent = ""; openModal("mNovo"); } else openPedido(tab.dataset.p); return; }
    if (t.closest("[data-close]")) { closeModals(); return; }
    if (t.id === "vCar") return setView("car"); if (t.id === "vGrid") return setView("grid"); if (t.id === "vTri") return setView("tri");
    if (t.id === "fAl") return setMode("alertas"); if (t.id === "fPe") return setMode("pendentes"); if (t.id === "fTo") return setMode("todas");
    var chip = t.closest(".chip[data-b]"); if (chip) { S.bands[chip.dataset.b] = !S.bands[chip.dataset.b]; S.idx = 0; renderAll(); return; }
    if (t.id === "bUpl") { renderUpl(); openModal("mUpl"); return; }
    if (t.id === "bXml") { openDrawer(true); return; }
    if (t.id === "bUso") { api("GET", "/api/estado").then(function (j) { $("#sobre").innerHTML = "Versão <b>" + esc(j.versao) + "</b><br>Dados: " + esc(j.dados) + "<br>Modelo: " + esc(j.modelo); }); openModal("mUso"); return; }
    if (t.id === "dClose" || t.id === "scrim") { openDrawer(false); return; }
    if (t.id === "oRest") return askRest(); if (t.id === "oUndo") return undo();
    if (t.id === "mkxml") return gerarXml();
    if (t.id === "mkimg") { var pasta = $("#pasta").value.trim(); LS.set("pasta", pasta); api("POST", "/api/pedidos/" + encodeURIComponent(S.nome) + "/baixar", { pasta: pasta || null }).then(function () { pollImg(); }).catch(function (er) { $("#imgMsg").textContent = "Erro: " + er.message; }); return; }
    if (t.id === "mkmsg") return clientMsg();
    if (t.id === "nGo") return startNovo();
    if (t.id === "uplall") { S.showAllUpl = !S.showAllUpl; renderUpl(); return; }
    var u = t.closest("[data-u]"); if (u) { S.T[u.dataset.u] = !S.T[u.dataset.u]; saveTrust(); return; }
    if (t.id === "upladd") { var n = $("#uplnew").value.trim(); if (n) { S.T[n] = true; $("#uplnew").value = ""; saveTrust(); } return; }
    if (t.id === "bMore") { S.shown = 1; renderInfo(); return; }
    if (t.id === "bFlip") return flip(); if (t.id === "bToGrid") return setView("grid");
    var g = t.closest("[data-g]"); if (g) return go(+g.dataset.g);
    var a = t.closest("[data-a]"); if (a && S.view === "car") return actCur(a.dataset.a);
    var cd = t.closest(".cd"); if (cd && S.view === "car") { S.pv = +cd.dataset.n; var c = F[S.idx]; decide(c, "ok", [S.pv], "individual"); S.pv = null; renderOverview(); renderFilters(); layoutReel(); renderInfo(); return; }
    var tv = t.closest("[data-v]"); if (tv && S.view === "tri") return flyOut(tv.dataset.v);
    if (t.id === "triUndo") return undo();
  });
  $("#q").addEventListener("input", function (e) { S.q = e.target.value; S.idx = 0; renderAll(); });
  $("#onlytrust").addEventListener("change", function (e) { S.onlyTrust = e.target.checked; LS.set("onlytrust", e.target.checked ? "1" : "0"); renderFilters(); if (S.view === "car") renderInfo(); });
  $("#uplq").addEventListener("input", renderUpl);
  $("#modFile").addEventListener("change", function (e) {
    var f = e.target.files[0]; if (!f) return; var r = new FileReader();
    r.onload = function () { try { api("POST", "/api/modelo", JSON.parse(r.result)).then(function (j) { $("#modMsg").textContent = "Modelo " + j.key + " instalado. Vale para os próximos pedidos."; }).catch(function (er) { $("#modMsg").textContent = "Erro: " + er.message; }); } catch (x) { $("#modMsg").textContent = "Arquivo inválido."; } };
    r.readAsText(f);
  });
  document.addEventListener("keydown", function (e) {
    if (e.target.matches("input,textarea,select") || e.ctrlKey || e.metaKey || e.altKey) { if (e.key === "Escape") { closeModals(); openDrawer(false); } return; }
    if (e.key === "Escape") { closeModals(); openDrawer(false); return; }
    if (anyModal() || !S.nome) return;
    var k = e.key;
    if (S.view === "car") {
      var c = F[S.idx], list = c ? ordered(c) : [];
      if (k === "ArrowDown") { e.preventDefault(); go(1); } else if (k === "ArrowUp") { e.preventDefault(); go(-1); }
      else if ((k === "ArrowRight" || k === "ArrowLeft") && c) { e.preventDefault(); var cur = list.map(function (x) { return x.n; }).indexOf(S.pv || chosenN(c)); var nx = list[(cur + (k === "ArrowRight" ? 1 : -1) + list.length) % list.length]; S.pv = nx && nx.n; layoutReel(); renderInfo(); }
      else if (k === "Enter") { e.preventDefault(); actCur("accept"); } else if (k === " ") { e.preventDefault(); flip(); }
      else if (k === "n" || k === "N") actCur("nenhum"); else if (k === "d" || k === "D") actCur("duvida"); else if (k === "Backspace") { e.preventDefault(); actCur("clear"); }
      else if (k === "g" || k === "G") setView("grid"); else if (k === "t" || k === "T") setView("tri"); else if (k === "z" || k === "Z") undo();
    } else if (S.view === "tri") {
      if (k === "ArrowRight") flyOut("y"); else if (k === "ArrowLeft") flyOut("n"); else if (k === "ArrowUp") { e.preventDefault(); flyOut("s"); } else if (k === "ArrowDown") { e.preventDefault(); flyOut("m"); }
      else if (k === "z" || k === "Z") undo(); else if (k === "g" || k === "G") setView("grid"); else if (k === "c" || k === "C") setView("car");
    } else if (k === "c" || k === "C") setView("car"); else if (k === "t" || k === "T") setView("tri");
  });

  /* ---------- início ---------- */
  api("GET", "/api/estado").then(function (j) { ((j.uploaders || {}).trusted || []).forEach(function (n) { S.T[n] = true; }); $("#cntU").textContent = trustList().length; }).catch(function () {});
  loadTabs().then(function (p) {
    var pronto = p.filter(function (x) { return x.pronto; }), last = LS.get("pedido", ""), pick = pronto.filter(function (x) { return x.nome === last; })[0] || pronto[pronto.length - 1];
    if (pick) openPedido(pick.nome); else $("#main").innerHTML = '<div class="empty">Nenhum pedido ainda.<br><br><button class="btn pri" id="firstNew">Criar o primeiro pedido</button></div>';
    var fn = $("#firstNew"); if (fn) fn.addEventListener("click", function () { openModal("mNovo"); });
  }).catch(function (e) { $("#main").innerHTML = '<div class="empty">Não consegui falar com o servidor local (' + esc(e.message) + ").</div>"; });
})();
