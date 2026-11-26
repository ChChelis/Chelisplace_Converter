// Worker chelisplace-avisos: webhook do Trello + resumos 10h/17h + avisos de atraso -> Telegram.
// Segredos (Cloudflare, tipo "Segredo"): TRELLO_KEY, TRELLO_TOKEN, TELEGRAM_TOKEN, ADMIN_SECRET.
// Variáveis comuns: TELEGRAM_CHAT_ID, TRELLO_BOARD_ID.
import { diaUtil, COLADOR_COM_DOMINGO } from "./prazos.js";
import { entradasPorCard, montarResumo, recemAtrasados, avisoMovimento, tipoMsgCliente, prazosColagem, linhaColagem, linkWaGrupo, fmtBR, montarCard, norm, avisoNovo, lerCard, setLinha, dataHoraBR, relatorioColagem, previsaoFila, linhaPrevisao, aplicarPrevisao, ROTULOS, paraTelegram, vencimentoGrafica, lembretesRetirada } from "./avisos.js";

import { autorizado } from "./auth.js";
import { rotaVitrine } from "./vitrine.js";
import { agendaConfigurada, criarOuAtualizarEventos, removerEvento, montarEventos, estadoOAuth, urlAutorizacao, trocarCodigo } from "./agenda.js";

const T = "https://api.trello.com/1";

async function trello(env, caminho, params = {}, metodo = "GET", formulario = null) {
  const u = new URL(T + caminho);
  u.searchParams.set("key", env.TRELLO_KEY);
  u.searchParams.set("token", env.TRELLO_TOKEN);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const r = await fetch(u, { method: metodo, ...(formulario ? { body: new URLSearchParams(formulario), headers: { "content-type": "application/x-www-form-urlencoded" } } : {}) });
  if (!r.ok) throw new Error(`Trello ${r.status} em ${caminho}`);
  return r.json();
}

async function telegram(env, metodo, corpo) {
  const r = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_TOKEN}/${metodo}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(corpo),
  });
  if (!r.ok) throw new Error(`Telegram ${r.status}`);
  return r.json();
}

const enviar = (env, texto, botoes = []) =>
  telegram(env, "sendMessage", {
    chat_id: env.TELEGRAM_CHAT_ID, text: paraTelegram(texto), parse_mode: "HTML",
    reply_markup: botoes.length ? { inline_keyboard: botoes } : undefined,
    disable_web_page_preview: true,
  });

async function carregarQuadro(env) {
  const b = env.TRELLO_BOARD_ID;
  const [listas, cards, acoes] = await Promise.all([
    trello(env, `/boards/${b}/lists`, { fields: "name" }),
    trello(env, `/boards/${b}/cards`, { fields: "name,desc,idList,dateLastActivity,url,due,dueComplete" }),
    trello(env, `/boards/${b}/actions`, { filter: "updateCard:idList,createCard,copyCard,moveCardToBoard", limit: "1000" }),
  ]);
  return { listas, cards, entradas: entradasPorCard(acoes, cards) };
}

// Google Agenda: evento da viagem para retirar na gráfica (vencimento do card); sem vencimento, remove o evento.
// Falha do Google nunca derruba o resto: avisa o grupo e segue.
async function agendaRetirada(env, card, dueIso, trelloUrl) {
  try {
    if (!agendaConfigurada(env)) return;
    if (dueIso) await criarOuAtualizarEventos(env, montarEventos({ card, inicioMs: Date.parse(dueIso), trelloUrl }));
    else await removerEvento(env, card.id);
  } catch (e) {
    await enviar(env, `Não consegui atualizar o Google Agenda (${e.message}). Os avisos do Telegram continuam normais.`).catch(() => {});
  }
}

// Sincroniza (cria ou atualiza) o evento de todos os cards da Gráfica com vencimento ainda não cumprido.
async function sincronizarAgenda(env, q) {
  const grafica = new Set(q.listas.filter((l) => norm(l.name).includes("grafica")).map((l) => l.id));
  const feitos = [];
  for (const c of q.cards) {
    if (!grafica.has(c.idList) || !c.due || c.dueComplete) continue;
    await criarOuAtualizarEventos(env, montarEventos({ card: c, inicioMs: Date.parse(c.due), trelloUrl: c.url }));
    feitos.push({ cliente: lerCard(c).cliente, inicio: c.due });
  }
  return feitos;
}

async function resumo(env, agoraMs, titulo, quadro) {
  const q = quadro || (await carregarQuadro(env));
  const texto = montarResumo({ ...q, agoraMs, titulo });
  await enviar(env, texto, [[{ text: "Encaminhar ao grupo do WhatsApp", url: linkWaGrupo(texto) }]]);
}

async function verificarAtrasos(env, agoraMs) {
  const q = await carregarQuadro(env);
  for (const a of recemAtrasados({ ...q, agoraMs })) {
    const texto = `*ATRASADO:* ${a.info.cliente} (${a.coluna}). O prazo era ${fmtBR(a.prazo)}.`;
    await enviar(env, texto, [[{ text: "Encaminhar ao grupo do WhatsApp", url: linkWaGrupo(texto) }]]);
  }
}

const ORIGENS = ["https://pedidos.chelisplace.com", "https://pedidos-ng2.pages.dev", "http://localhost:8780"];
const cors = (origem) => ({
  "access-control-allow-origin": origem, "vary": "origin",
  "access-control-allow-headers": "authorization, content-type", "access-control-allow-methods": "POST, OPTIONS",
});

// Comentários das alterações: um por tópico. Em atualização, só posta os que ainda não existem (o texto igual não se repete).
async function postarComentarios(env, cardId, textos) {
  if (!textos.length) return 0;
  const ja = new Set((await trello(env, `/cards/${cardId}/actions`, { filter: "commentCard", limit: "1000" }).catch(() => [])).map((a) => a?.data?.text));
  let n = 0;
  for (const text of textos) { if (ja.has(text)) continue; await trello(env, `/cards/${cardId}/actions/comments`, {}, "POST", { text }); n++; }
  return n;
}

// POST /card: cria (ou atualiza, com cardId) o card do pedido. Exige origem da página + senha da página.
async function rotaCard(req, env) {
  const origem = req.headers.get("origin") || "";
  if (!ORIGENS.includes(origem)) return new Response("origem não permitida", { status: 403 });
  const h = cors(origem);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
  if (req.method !== "POST") return new Response("método inválido", { status: 405, headers: h });
  if (!(await autorizado(req, env)))
    return new Response(JSON.stringify({ erro: "não autorizado: entre com o Google (conta autorizada) ou use a senha da página" }), { status: 401, headers: { ...h, "content-type": "application/json" } });
  const b = await req.json().catch(() => null);
  if (!b) return new Response(JSON.stringify({ erro: "corpo inválido" }), { status: 400, headers: { ...h, "content-type": "application/json" } });
  const { name, desc, comentarios } = montarCard(b);
  let card, previsao = null;
  if (b.cardId && /^[0-9a-f]{24}$/.test(b.cardId)) {
    // atualização: preserva as linhas de controle do Worker (entrada, prazo manual, previsão) do card atual
    const atual = await trello(env, `/cards/${b.cardId}`, { fields: "desc" });
    let novo = desc;
    for (const k of ["Entrou na coluna", "Entrada confirmada em", "Prazo", ...ROTULOS]) {
      const m = (atual.desc || "").match(new RegExp("^\\s*" + k + "\\s*:\\s*(.+)$", "im"));
      if (m) novo = setLinha(novo, k, m[1].trim());
    }
    card = await trello(env, `/cards/${b.cardId}`, { name, desc: novo }, "PUT");
    previsao = lerCard({ name, desc: novo }).previsao || null;
  } else {
    const listas = await trello(env, `/boards/${env.TRELLO_BOARD_ID}/lists`, { fields: "name" });
    const alvo = norm(String(b.coluna || "novo"));
    const novos = listas.find((l) => norm(l.name).includes(alvo));
    if (!novos) return new Response(JSON.stringify({ erro: `coluna '${String(b.coluna || "Novos pedidos").slice(0, 40)}' não encontrada`, colunas: listas.map((l) => l.name) }), { status: 500, headers: { ...h, "content-type": "application/json" } });
    const info = lerCard({ name, desc });
    const t = b.entrouEm ? (typeof b.entrouEm === "number" ? b.entrouEm : Date.parse(b.entrouEm)) : NaN;
    const entrada = Number.isFinite(t) ? t : Date.now();
    previsao = linhaPrevisao(novos.name, entrada, info, Date.now());
    const descFinal = aplicarPrevisao(desc, previsao);
    const due = vencimentoGrafica(novos.name, entrada, lerCard({ name, desc: descFinal }), Date.now());
    card = await trello(env, "/cards", { idList: novos.id, name, desc: descFinal, pos: "bottom", ...(due ? { due } : {}) }, "POST");
    if (due) await agendaRetirada(env, { id: card.id, name, desc: descFinal }, due, card.shortUrl || card.url);
  }
  let comentou = 0, erroComentarios = null;
  try { comentou = await postarComentarios(env, card.id, comentarios); } catch (e) { erroComentarios = String(e.message || e).slice(0, 120); }  // o card já existe: falha nos comentários não derruba a criação
  return new Response(JSON.stringify({ id: card.id, url: card.shortUrl || card.url, previsao, comentarios: comentou, ...(erroComentarios ? { erroComentarios } : {}) }), { headers: { ...h, "content-type": "application/json" } });
}

const json = (o, s = 200) => new Response(JSON.stringify(o, null, 2), { status: s, headers: { "content-type": "application/json; charset=utf-8" } });

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const partes = url.pathname.split("/").filter(Boolean);

    // Webhook do Trello: /trello/<ADMIN_SECRET> (HEAD/GET respondem 200 para o cadastro)
    if (partes[0] === "trello") {
      if (partes[1] !== env.ADMIN_SECRET) return new Response("não autorizado", { status: 403 });
      if (req.method !== "POST") return new Response("ok");
      const corpo = await req.json().catch(() => null);
      const a = corpo?.action;
      if (a?.type === "updateCard" && a.data?.listBefore && a.data?.listAfter) {
        const card = await trello(env, `/cards/${a.data.card.id}`, { fields: "name,desc,shortUrl" }).catch(() => ({ name: a.data.card.name, desc: "" }));
        // recalcula a previsão de entrega a partir da coluna nova e grava no card
        const info = lerCard(card);
        const quando = Date.parse(a.date) || Date.now();
        // cards que já estão na coluna de destino: a mensagem ao cliente junta os do mesmo cliente e, na Colagem, o prazo entra na fila geral do colador
        const naColuna = tipoMsgCliente(a.data.listAfter.name) || norm(a.data.listAfter.name).includes("colagem")
          ? await trello(env, `/lists/${a.data.listAfter.id}/cards`, { fields: "name,desc" }).catch(() => []) : [];
        const previsao = linhaPrevisao(a.data.listAfter.name, quando, info, Date.now(), naColuna.filter((c) => c.id !== a.data.card.id));
        const params = {};
        if ((previsao || "") !== info.previsao) params.desc = aplicarPrevisao(card.desc || "", previsao);
        // Google Agenda (Power-Up): entrando na Gráfica o vencimento vira a retirada prevista; saindo, o vencimento é dado como cumprido
        const due = vencimentoGrafica(a.data.listAfter.name, quando, info, Date.now());
        if (due) { params.due = due; params.dueComplete = "false"; }
        else if (norm(a.data.listBefore.name).includes("grafica")) params.dueComplete = "true";
        if (Object.keys(params).length) await trello(env, `/cards/${a.data.card.id}`, params, "PUT").catch(() => {});
        if (due) await agendaRetirada(env, { id: a.data.card.id, name: card.name, desc: params.desc ?? card.desc }, due, card.shortUrl);
        else if (norm(a.data.listBefore.name).includes("grafica")) await agendaRetirada(env, { id: a.data.card.id }, null);
        const irmaos = naColuna;
        const { texto, botoes } = avisoMovimento({
          cardNome: a.data.card.name, de: a.data.listBefore.name, para: a.data.listAfter.name, card: { ...card, id: a.data.card.id }, previsao, irmaos, agoraMs: quando,
        });
        await enviar(env, texto, botoes);
      }
      if ((a?.type === "createCard" || a?.type === "copyCard") && a.data?.card?.id) {
        const card = await trello(env, `/cards/${a.data.card.id}`, { fields: "name,desc,shortUrl" }).catch(() => ({ id: a.data.card.id, name: a.data.card.name, desc: "" }));
        const coluna = a.data.list?.name || "?";
        let previsao = lerCard(card).previsao;
        if (!previsao) { // card feito à mão no Trello: calcula (se a coluna tiver prazo) e grava
          previsao = linhaPrevisao(coluna, Date.parse(a.date) || Date.now(), lerCard(card), Date.now());
          const quando = Date.parse(a.date) || Date.now();
          const due = vencimentoGrafica(coluna, quando, lerCard(card), Date.now());
          if (previsao || due) await trello(env, `/cards/${a.data.card.id}`, { ...(previsao ? { desc: aplicarPrevisao(card.desc || "", previsao) } : {}), ...(due ? { due } : {}) }, "PUT").catch(() => {});
          if (due) await agendaRetirada(env, { id: a.data.card.id, name: card.name, desc: previsao ? aplicarPrevisao(card.desc || "", previsao) : card.desc }, due, card.shortUrl);
        }
        const { texto, botoes } = avisoNovo({ card, coluna, previsao });
        await enviar(env, texto, botoes);
      }
      return new Response("ok");
    }

    // Comandos do bot no grupo (webhook do Telegram): /colagem, /resumo, /ajuda. Só o grupo configurado é atendido.
    if (partes[0] === "telegram" && partes[1] === env.ADMIN_SECRET && req.method === "POST") {
      if (req.headers.get("x-telegram-bot-api-secret-token") !== (await estadoOAuth({ ADMIN_SECRET: "telegram:" + env.ADMIN_SECRET }))) return new Response("não autorizado", { status: 403 });
      const msg = (await req.json().catch(() => ({})))?.message;
      if (!msg?.text || String(msg.chat?.id) !== String(env.TELEGRAM_CHAT_ID).trim()) return new Response("ok");
      const cmd = msg.text.trim().split(/\s+/)[0].split("@")[0].toLowerCase();
      try {
        if (cmd === "/fila") { const q = await carregarQuadro(env); await enviar(env, previsaoFila({ ...q, agoraMs: Date.now(), filtro: msg.text.trim().split(/\s+/).slice(1).join(" ") })); }
        else if (cmd === "/colagem") { const q = await carregarQuadro(env); await enviar(env, relatorioColagem({ ...q, agoraMs: Date.now() })); }
        else if (cmd === "/resumo") await resumo(env, Date.now(), "*Resumo agora*");
        else if (cmd === "/ajuda" || cmd === "/start") await enviar(env, "*Comandos*\n/fila [nome] - previsão da fila de colagem (Colagem, Retirada e Gráfica), com e sem domingo\n/colagem - quanto pagar de colagem na janela atual\n/resumo - resumo dos pedidos agora");
      } catch (e) { await enviar(env, `Não consegui responder ao comando (${e.message}).`).catch(() => {}); }
      return new Response("ok");
    }

    // Retorno da autorização do Google: troca o código pelo refresh token e o mostra uma vez, para o Chelis colar no painel.
    if (partes[0] === "google" && partes[1] === "callback") {
      const code = url.searchParams.get("code"), state = url.searchParams.get("state");
      if (!code || !state || state !== (await estadoOAuth(env))) return new Response("não autorizado", { status: 403 });
      try {
        const d = await trocarCodigo(env, code, `${url.origin}/google/callback`);
        const corpo = d.refresh_token
          ? `<p>Autorizado. Copie o valor abaixo e crie, no painel da Cloudflare, o segredo <b>GOOGLE_REFRESH_TOKEN</b> (tipo Segredo). Não compartilhe e feche esta página depois.</p><textarea rows="4" cols="80" readonly onclick="this.select()">${d.refresh_token}</textarea>`
          : `<p>O Google não devolveu o token (talvez esta conta já tenha autorizado antes). Remova o acesso do app em myaccount.google.com/permissions e abra de novo o endereço de autorização.</p>`;
        return new Response(`<!doctype html><meta charset="utf-8"><title>Google Agenda</title><body style="font-family:sans-serif;padding:24px">${corpo}</body>`, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
      } catch (e) { return new Response("Falha ao autorizar: " + e.message, { status: 500 }); }
    }

    // Vitrine do cliente: POST /vitrine, GET|DELETE /vitrine/<código> (lista de imagens com prazo, em KV)
    if (partes[0] === "vitrine" && partes.length <= 2) return rotaVitrine(req, env, partes, { origens: ORIGENS, cors }).catch((e) => new Response(JSON.stringify({ erro: String(e.message || e).slice(0, 120) }), { status: 500, headers: { "content-type": "application/json" } }));

    if (partes[0] === "card" && partes.length === 1) return rotaCard(req, env).catch((e) => new Response(JSON.stringify({ erro: e.message }), { status: 500, headers: { ...cors(req.headers.get("origin") || ""), "content-type": "application/json" } }));

    // Utilidades do Chelis (abrir no navegador): /admin/<ADMIN_SECRET>/<acao>
    if (partes[0] === "admin") {
      if (partes[1] !== env.ADMIN_SECRET) return new Response("não autorizado", { status: 403 });
      const acao = partes[2];
      if (acao === "quadros") {
        const bs = await trello(env, "/members/me/boards", { fields: "name,closed" });
        return json(bs.filter((b) => !b.closed).map((b) => ({ id: b.id, nome: b.name })));
      }
      if (acao === "chat-id") {
        const r = await telegram(env, "getUpdates", {});
        const chats = new Map();
        for (const u of r.result || []) { const c = (u.message || u.my_chat_member || {}).chat; if (c) chats.set(c.id, c.title || c.first_name); }
        return json([...chats].map(([id, nome]) => ({ id, nome })));
      }
      if (acao === "registrar-webhook") {
        const cb = `${url.origin}/trello/${env.ADMIN_SECRET}`;
        // remove os webhooks antigos deste Worker (por exemplo, com a senha anterior no endereço) antes de criar o novo
        const antigos = await trello(env, `/tokens/${env.TRELLO_TOKEN}/webhooks`);
        const removidos = [];
        for (const w of antigos) {
          if (w.description === "chelisplace-avisos") { await trello(env, `/webhooks/${w.id}`, {}, "DELETE"); removidos.push(w.id); }
        }
        const r = await trello(env, "/webhooks", { callbackURL: cb, idModel: env.TRELLO_BOARD_ID, description: "chelisplace-avisos" }, "POST");
        return json({ ok: true, id: r.id, antigosRemovidos: removidos.length });
      }
      if (acao === "vencimentos") { // grava o vencimento (retirada prevista) nos cards que já estão na Gráfica e ainda não têm
        const q = await carregarQuadro(env), agora = Date.now(), feitos = [], refazer = url.searchParams.get("refazer") === "1", daDescricao = url.searchParams.get("usarDescricao") === "1";
        for (const c of q.cards) {
          const l = q.listas.find((x) => x.id === c.idList);
          if (!l || (c.due && !refazer) || c.dueComplete) continue;
          const info = lerCard(c), entrada = daDescricao && info.entrouEm ? info.entrouEm : q.entradas[c.id], due = vencimentoGrafica(l.name, entrada, info, agora);
          if (!due) continue;
          const previsao = linhaPrevisao(l.name, entrada, info, agora); // mantém a linha da descrição coerente com o vencimento
          await trello(env, `/cards/${c.id}`, { due, dueComplete: "false", desc: aplicarPrevisao(c.desc || "", previsao) }, "PUT");
          feitos.push({
            cliente: info.cliente, vencimento: due,
            diagnostico: { entradaUsada: new Date(entrada).toISOString(), entrouEmDaDescricao: info.entrouEm ? new Date(info.entrouEm).toISOString() : null, prazoManual: info.prazoManual ? new Date(info.prazoManual).toISOString() : null, ultimaAtividade: c.dateLastActivity },
          });
        }
        return json({ ok: true, atualizados: feitos });
      }
      if (acao === "colagem-fila") { // recalcula o prazo de colagem dos cards que já estão na Colagem, em fila por cliente (sem ?aplicar=1 só mostra)
        const q = await carregarQuadro(env), aplicar = url.searchParams.get("aplicar") === "1", feitos = [];
        const ids = new Set(q.listas.filter((l) => norm(l.name).includes("colagem")).map((l) => l.id));
        const doGrupo = q.cards.filter((c) => ids.has(c.idList)), fila = prazosColagem(doGrupo, q.entradas), filaDom = prazosColagem(doGrupo, q.entradas, undefined, COLADOR_COM_DOMINGO);
        for (const c of doGrupo) {
          const info = lerCard(c), linha = linhaColagem(fila.get(c.id), filaDom.get(c.id));
          if (aplicar && linha !== info.previsao) await trello(env, `/cards/${c.id}`, { desc: aplicarPrevisao(c.desc || "", linha) }, "PUT");
          feitos.push({ cliente: info.cliente, nomeCliente: info.nomeCliente, antes: info.previsao || null, depois: linha, mudou: linha !== info.previsao });
        }
        return json({ ok: true, aplicado: aplicar, cards: feitos });
      }
      if (acao === "fixar-entradas") { // confirma, agora, a data "Entrou na coluna" dos cards que a têm: movimentos de teste anteriores deixam de valer
        const q = await carregarQuadro(env), feitos = [], agora = dataHoraBR(Date.now());
        for (const c of q.cards) {
          const info = lerCard(c);
          if (!info.entrouEm || c.dueComplete) continue;
          await trello(env, `/cards/${c.id}`, { desc: setLinha(c.desc || "", "Entrada confirmada em", agora) }, "PUT");
          feitos.push({ cliente: info.cliente, entrouNaColuna: new Date(info.entrouEm).toISOString() });
        }
        return json({ ok: true, confirmadaEm: agora, cards: feitos });
      }
      if (acao === "google-autorizar") { // abre a tela de consentimento do Google (uma vez)
        if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return json({ ok: false, erro: "GOOGLE_CLIENT_ID e GOOGLE_CLIENT_SECRET ainda não foram criados como segredos" }, 400);
        return Response.redirect(urlAutorizacao(env, `${url.origin}/google/callback`, await estadoOAuth(env)), 302);
      }
      if (acao === "agenda") { // cria/atualiza no Google Agenda o evento de cada card da Gráfica com vencimento
        if (!agendaConfigurada(env)) return json({ ok: false, erro: "faltam segredos do Google (GOOGLE_CALENDAR_ID e GOOGLE_SA_JSON, ou GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET e GOOGLE_REFRESH_TOKEN)" }, 400);
        try { return json({ ok: true, eventos: await sincronizarAgenda(env, await carregarQuadro(env)) }); }
        catch (e) { return json({ ok: false, erro: e.message }, 500); }
      }
      if (acao === "telegram-webhook") { // liga os comandos do bot (desliga o getUpdates, usado só para descobrir o chat-id)
        const r = await telegram(env, "setWebhook", {
          url: `${url.origin}/telegram/${env.ADMIN_SECRET}`, allowed_updates: ["message"],
          secret_token: await estadoOAuth({ ADMIN_SECRET: "telegram:" + env.ADMIN_SECRET }),
        });
        return json({ ok: r.ok, descricao: r.description || "webhook do Telegram registrado" });
      }
      if (acao === "teste") { await enviar(env, "Chelisplace Avisos conectado."); return json({ ok: true }); }
      if (acao === "lembretes") { // teste manual: simula o lembrete de retirada (?periodo=manha|tarde)
        const q = await carregarQuadro(env), per = url.searchParams.get("periodo") === "manha" ? "manha" : "tarde";
        const aviso = lembretesRetirada({ ...q, agoraMs: Date.now(), periodo: per });
        if (aviso) await enviar(env, aviso, [[{ text: "Encaminhar ao grupo do WhatsApp", url: linkWaGrupo(aviso) }]]);
        return json({ ok: true, enviado: !!aviso });
      }
      if (acao === "resumo") { await resumo(env, Date.now(), "*Resumo (teste manual)*"); return json({ ok: true }); }
      return json({ erro: "ação desconhecida" }, 404);
    }
    return new Response("chelisplace-avisos", { status: 200 });
  },

  async scheduled(evento, env) {
    const agora = Date.now();
    if (!diaUtil(new Date(agora - 3 * 3600e3))) return; // feriado nacional: sem resumos nem alertas
    if (evento.cron === "0 13,20 * * 1-5") {
      const manha = new Date(agora - 3 * 3600e3).getUTCHours() < 12;
      const q = await carregarQuadro(env);
      if (agendaConfigurada(env)) await sincronizarAgenda(env, q).catch(() => {}); // autocorreção diária do Google Agenda
      await resumo(env, agora, manha ? "*Resumo da manhã (10h)*" : "*Resumo do fim do expediente (17h)*", q);
      const aviso = lembretesRetirada({ ...q, agoraMs: agora, periodo: manha ? "manha" : "tarde" });
      if (aviso) await enviar(env, aviso, [[{ text: "Encaminhar ao grupo do WhatsApp", url: linkWaGrupo(aviso) }]]);
    } else {
      await verificarAtrasos(env, agora);
    }
  },
};
