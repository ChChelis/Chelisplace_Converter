"use strict";
// Publicar a vitrine do cliente: escolhe a pasta no Drive, confere legendas, compartilha as imagens por link e
// registra a lista (IDs + legendas + prazo) no Worker. O cliente abre /conferencia/<código>. Nada aqui é segredo.
(() => {
  const VIT_WORKER = "https://chelisplace-avisos.shrill-mountain-e326.workers.dev";
  const CHAVE = "vit-publicadas";
  const base = () => (($("#t-url") && $("#t-url").value.trim()) || VIT_WORKER).replace(/\/+$/, "");
  const lerNoAr = () => { try { return JSON.parse(localStorage.getItem(CHAVE) || "[]"); } catch { return []; } };
  const gravarNoAr = (l) => { try { localStorage.setItem(CHAVE, JSON.stringify(l)); } catch {} };
  const vit = { pedidos: [], subs: [], itens: [], ocupado: false };
  const aviso = (t, cls = "") => { const el = $("#vit-aviso"); el.className = "suave " + cls; el.textContent = t ? " " + t : ""; };
  const linkDe = (slug) => `${location.origin}/conferencia/${slug}`;

  async function emParalelo(lista, n, fn) {
    let i = 0;
    await Promise.all(Array.from({ length: Math.min(n, lista.length) }, async () => { while (i < lista.length) { const k = i++; await fn(lista[k], k); } }));
  }

  // ---------- escolher pasta e ler imagens ----------
  $("#vit-ler-pedidos").onclick = async () => {
    if (!Drive.conectado()) return aviso("Entre com o Google no quadro “Google Drive” (no alto da página).", "alerta");
    aviso("Lendo pedidos…");
    try {
      vit.pedidos = await Drive.pedidos();
      $("#vit-pedido").innerHTML = `<option value="">Escolha o pedido</option>` + vit.pedidos.map((p) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`).join("");
      aviso(vit.pedidos.length ? "" : "Nenhuma pasta de pedido encontrada.");
    } catch (e) { aviso(e.message, "alerta"); }
  };
  $("#vit-pedido").onchange = async () => {
    const id = $("#vit-pedido").value, ped = vit.pedidos.find((p) => p.id === id);
    $("#vit-ler").disabled = !id; $("#vit-sub").disabled = !id; $("#vit-config").hidden = true; vit.itens = [];
    $("#vit-sub").innerHTML = `<option value="">(raiz do pedido)</option>`;
    if (!id) return;
    $("#vit-titulo").value = ped.name;
    try {
      vit.subs = await Drive.listar(id, ` and mimeType='${Drive.PASTA}'`);
      $("#vit-sub").innerHTML += vit.subs.sort((a, b) => a.name.localeCompare(b.name, "pt")).map((s) => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join("");
    } catch (e) { aviso(e.message, "alerta"); }
  };
  $("#vit-sub").onchange = () => { $("#vit-config").hidden = true; vit.itens = []; };

  let arquivos = [];
  $("#vit-ler").onclick = async () => {
    const pai = $("#vit-sub").value || $("#vit-pedido").value;
    if (!pai) return;
    aviso("Lendo imagens…"); $("#vit-ler").disabled = true;
    try {
      arquivos = await Drive.listar(pai, " and (mimeType contains 'image/')");
      aviso(""); montarLista();
    } catch (e) { aviso(e.message, "alerta"); }
    $("#vit-ler").disabled = false;
  };
  $("#vit-rep").onchange = () => montarLista();

  function montarLista() {
    const antigas = new Map(vit.itens.map((i) => [i.id, i]));  // preserva legendas editadas e marcas ao mudar a opção
    vit.itens = itensDaPasta(arquivos, { ocultarRepetidas: $("#vit-rep").checked }).map((i) => ({ ...i, on: antigas.has(i.id) ? antigas.get(i.id).on : true, legenda: antigas.has(i.id) ? antigas.get(i.id).legenda : i.legenda }));
    $("#vit-config").hidden = false;
    $("#vit-lista").innerHTML = vit.itens.map((i, k) => `<div class="vit-item${i.on ? "" : " off"}" data-k="${k}"><img loading="lazy" alt="" src="${esc(thumbUrl(i.id, 160))}"><label><input type="checkbox" ${i.on ? "checked" : ""}> mostrar</label><input type="text" maxlength="120" value="${esc(i.legenda)}" aria-label="Legenda"></div>`).join("") || `<p class="suave">Nenhuma imagem nesta pasta.</p>`;
    atualizar();
  }
  $("#vit-lista").addEventListener("input", (e) => {
    const el = e.target.closest(".vit-item"); if (!el) return; const i = vit.itens[+el.dataset.k];
    if (e.target.type === "checkbox") { i.on = e.target.checked; el.classList.toggle("off", !i.on); } else i.legenda = e.target.value;
    atualizar();
  });
  const marcar = (v) => { vit.itens.forEach((i) => (i.on = v)); $("#vit-lista").querySelectorAll(".vit-item").forEach((el) => { el.classList.toggle("off", !v); el.querySelector("input[type=checkbox]").checked = v; }); atualizar(); };
  $("#vit-todas").onclick = () => marcar(true); $("#vit-nenhuma").onclick = () => marcar(false);
  $("#vit-titulo").oninput = atualizar; $("#vit-min").oninput = atualizar;

  const minutos = () => Math.round(Number($("#vit-min").value));
  function motivoBloqueio() {
    if (vit.ocupado) return "Publicando…";
    if (!Drive.conectado()) return "Entre com o Google.";
    if (!$("#vit-titulo").value.trim()) return "Dê um título à página.";
    if (!vit.itens.some((i) => i.on)) return "Marque ao menos uma imagem.";
    if (vit.itens.filter((i) => i.on).length > 1000) return "No máximo 1000 imagens por vitrine.";
    if (!(minutos() >= 5 && minutos() <= 10080)) return "O prazo vai de 5 minutos a 7 dias (10080).";
    return "";
  }
  function atualizar() {
    $("#vit-conta").textContent = `${vit.itens.filter((i) => i.on).length} de ${vit.itens.length} imagens marcadas.`;
    const m = motivoBloqueio(); $("#vit-publicar").disabled = !!m; $("#vit-motivo").textContent = m ? " " + m : "";
  }

  // ---------- publicar ----------
  $("#vit-publicar").onclick = () => {
    const n = vit.itens.filter((i) => i.on).length;
    $("#vit-conf").innerHTML = `<div class="conf"><b>${n} imagem(ns)</b> ficarão visíveis para <b>qualquer pessoa que tiver o link</b>, por ${minutos()} min (ou até você despublicar). Nada é apagado nem movido.<br><button class="acao" id="vit-sim">Publicar</button><button class="acao sec" id="vit-nao">Cancelar</button></div>`;
    $("#vit-nao").onclick = () => { $("#vit-conf").innerHTML = ""; };
    $("#vit-sim").onclick = publicar;
  };

  async function publicar() {
    const marcadas = vit.itens.filter((i) => i.on), alvo = $("#vit-conf");
    vit.ocupado = true; atualizar();
    alvo.innerHTML = `<div class="conf"><span id="vit-prog">Compartilhando 0 de ${marcadas.length}…</span><div class="barra"><div id="vit-barra"></div></div></div>`;
    const ok = [], falhas = []; let feitos = 0;
    try {
      await emParalelo(marcadas, 4, async (i) => {
        try { await Drive.compartilhar(i.id); ok.push(i); } catch (e) { falhas.push({ i, erro: e.message }); }
        feitos++; $("#vit-prog").textContent = `Compartilhando ${feitos} de ${marcadas.length}…`; $("#vit-barra").style.width = (100 * feitos / marcadas.length) + "%";
      });
      if (!ok.length) throw new Error("Nenhuma imagem pôde ser compartilhada. " + (falhas[0] ? falhas[0].erro : ""));
      const ordem = new Map(marcadas.map((i, k) => [i.id, k])); ok.sort((a, b) => ordem.get(a.id) - ordem.get(b.id));
      const token = await Drive.tokenAtual();
      let d;
      try {
        const r = await fetch(base() + "/vitrine", { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + token }, body: JSON.stringify({ titulo: $("#vit-titulo").value.trim(), minutos: minutos(), itens: ok.map((i) => ({ id: i.id, legenda: i.legenda.trim() })) }) });
        d = await r.json().catch(() => ({})); if (!r.ok) throw new Error(d.erro || "erro " + r.status);
      } catch (e) { await desfazer(ok.map((i) => i.id)).catch(() => {}); throw e; }  // não deixa imagem exposta sem vitrine
      const reg = { slug: d.slug, titulo: $("#vit-titulo").value.trim(), ids: ok.map((i) => i.id), expira: d.expira };
      gravarNoAr([reg, ...lerNoAr()]);
      alvo.innerHTML = `<div class="conf"><b class="ok">No ar.</b> ${ok.length} imagem(ns). Mande este link ao cliente:<br><code id="vit-link">${esc(linkDe(d.slug))}</code> <button class="peq" id="vit-copiar">Copiar</button> <a href="${esc(linkDe(d.slug))}" target="_blank" rel="noopener">abrir</a>${falhas.length ? `<p class="alerta">${falhas.length} imagem(ns) não puderam ser compartilhadas e ficaram de fora (${esc(falhas[0].erro.slice(0, 160))}). Se o Drive é de uma conta Workspace, o administrador pode bloquear compartilhamento por link.</p>` : ""}</div>`;
      $("#vit-copiar").onclick = async () => { try { await navigator.clipboard.writeText(linkDe(d.slug)); $("#vit-copiar").textContent = "Copiado"; } catch { $("#vit-copiar").textContent = "Selecione e copie à mão"; } };
      listarNoAr();
    } catch (e) { alvo.innerHTML = `<div class="conf alerta">Não publicou: ${esc(e.message)}</div>`; }
    vit.ocupado = false; atualizar();
  }

  // ---------- no ar / despublicar ----------
  const desfazer = (ids) => emParalelo(ids, 4, (id) => Drive.descompartilhar(id).catch((e) => { if (!/404/.test(e.message)) throw e; }));

  async function despublicar(slug, aviso2) {
    const reg = lerNoAr().find((r) => r.slug === slug); if (!reg) return;
    aviso2.textContent = " Tirando do ar…";
    try {
      if (Date.now() < reg.expira) {
        const r = await fetch(`${base()}/vitrine/${encodeURIComponent(slug)}`, { method: "DELETE", headers: { authorization: "Bearer " + await Drive.tokenAtual() } });
        if (!r.ok && r.status !== 404) throw new Error("Worker " + r.status);
      }
      await desfazer(reg.ids);
      gravarNoAr(lerNoAr().filter((r) => r.slug !== slug)); listarNoAr();
    } catch (e) { aviso2.textContent = " Não deu: " + e.message; }
  }

  function listarNoAr() {
    const l = lerNoAr(), el = $("#vit-no-ar");
    $("#vit-estado").textContent = l.length ? `${l.length} no ar` : "nenhuma no ar";
    el.innerHTML = l.length ? `<h3>No ar</h3>` : "";
    for (const r of l) {
      const div = document.createElement("div"); div.className = "vit-no-ar-item";
      const venceu = Date.now() >= r.expira;
      div.innerHTML = `<b>${esc(r.titulo)}</b><span class="suave">${r.ids.length} imagens · ${venceu ? "prazo acabou (imagens ainda compartilhadas)" : "faltam " + quantoFalta(r.expira, Date.now())}</span><a href="${esc(linkDe(r.slug))}" target="_blank" rel="noopener">abrir</a><button class="peq" data-copiar>Copiar link</button><button class="peq" data-fora>Despublicar</button><span class="suave" data-av></span>`;
      div.querySelector("[data-copiar]").onclick = async (e) => { try { await navigator.clipboard.writeText(linkDe(r.slug)); e.target.textContent = "Copiado"; } catch { e.target.textContent = linkDe(r.slug); } };
      div.querySelector("[data-fora]").onclick = (e) => { e.target.disabled = true; despublicar(r.slug, div.querySelector("[data-av]")).finally(() => { e.target.disabled = false; }); };
      el.append(div);
    }
  }
  // com a página aberta e o Google conectado, desfaz sozinha o compartilhamento das vitrines que venceram
  let varrendo = false;
  setInterval(async () => {
    listarNoAr();
    if (varrendo || !Drive.conectado()) return;
    const vencidas = lerNoAr().filter((r) => Date.now() >= r.expira); if (!vencidas.length) return;
    varrendo = true;
    try { for (const r of vencidas) { await desfazer(r.ids); gravarNoAr(lerNoAr().filter((x) => x.slug !== r.slug)); } } catch { /* tenta de novo no próximo ciclo */ }
    varrendo = false; listarNoAr();
  }, 30000);
  setInterval(atualizar, 1000);
  listarNoAr(); atualizar();
  window.__vitrine = { vit, publicar, listarNoAr };
})();
