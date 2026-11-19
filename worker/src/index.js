// Worker chelisplace-avisos: webhook do Trello + resumos 10h/17h + avisos de atraso -> Telegram.
// Segredos (Cloudflare, tipo "Segredo"): TRELLO_KEY, TRELLO_TOKEN, TELEGRAM_TOKEN, ADMIN_SECRET.
// Variáveis comuns: TELEGRAM_CHAT_ID, TRELLO_BOARD_ID.
import { diaUtil } from "./prazos.js";
import { entradasPorCard, montarResumo, recemAtrasados, avisoMovimento, linkWaGrupo, fmtBR, montarCard, norm, avisoNovo, lerCard, setLinha, dataHoraBR, linhaPrevisao, aplicarPrevisao, ROTULOS, paraTelegram, vencimentoGrafica, lembretesRetirada } from "./avisos.js";

const T = "https://api.trello.com/1";

async function trello(env, caminho, params = {}, metodo = "GET") {
  const u = new URL(T + caminho);
  u.searchParams.set("key", env.TRELLO_KEY);
  u.searchParams.set("token", env.TRELLO_TOKEN);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  const r = await fetch(u, { method: metodo });
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

// POST /card: cria (ou atualiza, com cardId) o card do pedido. Exige origem da página + senha da página.
async function rotaCard(req, env) {
  const origem = req.headers.get("origin") || "";
  if (!ORIGENS.includes(origem)) return new Response("origem não permitida", { status: 403 });
  const h = cors(origem);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: h });
  if (req.method !== "POST") return new Response("método inválido", { status: 405, headers: h });
  if (!env.PAGINA_SECRET || req.headers.get("authorization") !== `Bearer ${env.PAGINA_SECRET}`)
    return new Response(JSON.stringify({ erro: "senha incorreta" }), { status: 401, headers: { ...h, "content-type": "application/json" } });
  const b = await req.json().catch(() => null);
  if (!b) return new Response(JSON.stringify({ erro: "corpo inválido" }), { status: 400, headers: { ...h, "content-type": "application/json" } });
  const { name, desc } = montarCard(b);
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
  }
  return new Response(JSON.stringify({ id: card.id, url: card.shortUrl || card.url, previsao }), { headers: { ...h, "content-type": "application/json" } });
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
        const card = await trello(env, `/cards/${a.data.card.id}`, { fields: "name,desc" }).catch(() => ({ name: a.data.card.name, desc: "" }));
        // recalcula a previsão de entrega a partir da coluna nova e grava no card
        const info = lerCard(card);
        const quando = Date.parse(a.date) || Date.now();
        const previsao = linhaPrevisao(a.data.listAfter.name, quando, info, Date.now());
        const params = {};
        if ((previsao || "") !== info.previsao) params.desc = aplicarPrevisao(card.desc || "", previsao);
        // Google Agenda (Power-Up): entrando na Gráfica o vencimento vira a retirada prevista; saindo, o vencimento é dado como cumprido
        const due = vencimentoGrafica(a.data.listAfter.name, quando, info, Date.now());
        if (due) { params.due = due; params.dueComplete = "false"; }
        else if (norm(a.data.listBefore.name).includes("grafica")) params.dueComplete = "true";
        if (Object.keys(params).length) await trello(env, `/cards/${a.data.card.id}`, params, "PUT").catch(() => {});
        const { texto, botoes } = avisoMovimento({
          cardNome: a.data.card.name, de: a.data.listBefore.name, para: a.data.listAfter.name, card, previsao,
        });
        await enviar(env, texto, botoes);
      }
      if ((a?.type === "createCard" || a?.type === "copyCard") && a.data?.card?.id) {
        const card = await trello(env, `/cards/${a.data.card.id}`, { fields: "name,desc" }).catch(() => ({ id: a.data.card.id, name: a.data.card.name, desc: "" }));
        const coluna = a.data.list?.name || "?";
        let previsao = lerCard(card).previsao;
        if (!previsao) { // card feito à mão no Trello: calcula (se a coluna tiver prazo) e grava
          previsao = linhaPrevisao(coluna, Date.parse(a.date) || Date.now(), lerCard(card), Date.now());
          const quando = Date.parse(a.date) || Date.now();
          const due = vencimentoGrafica(coluna, quando, lerCard(card), Date.now());
          if (previsao || due) await trello(env, `/cards/${a.data.card.id}`, { ...(previsao ? { desc: aplicarPrevisao(card.desc || "", previsao) } : {}), ...(due ? { due } : {}) }, "PUT").catch(() => {});
        }
        const { texto, botoes } = avisoNovo({ card, coluna, previsao });
        await enviar(env, texto, botoes);
      }
      return new Response("ok");
    }

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
        const r = await trello(env, "/webhooks", { callbackURL: cb, idModel: env.TRELLO_BOARD_ID, description: "chelisplace-avisos" }, "POST");
        return json({ ok: true, id: r.id });
      }
      if (acao === "vencimentos") { // grava o vencimento (retirada prevista) nos cards que já estão na Gráfica e ainda não têm
        const q = await carregarQuadro(env), agora = Date.now(), feitos = [], refazer = url.searchParams.get("refazer") === "1", daDescricao = url.searchParams.get("usarDescricao") === "1";
        for (const c of q.cards) {
          const l = q.listas.find((x) => x.id === c.idList);
          if (!l || (c.due && !refazer) || c.dueComplete) continue;
          const info = lerCard(c), entrada = daDescricao && info.entrouEm ? info.entrouEm : q.entradas[c.id], due = vencimentoGrafica(l.name, entrada, info, agora);
          if (!due) continue;
          await trello(env, `/cards/${c.id}`, { due, dueComplete: "false" }, "PUT");
          feitos.push({
            cliente: info.cliente, vencimento: due,
            diagnostico: { entradaUsada: new Date(entrada).toISOString(), entrouEmDaDescricao: info.entrouEm ? new Date(info.entrouEm).toISOString() : null, prazoManual: info.prazoManual ? new Date(info.prazoManual).toISOString() : null, ultimaAtividade: c.dateLastActivity },
          });
        }
        return json({ ok: true, atualizados: feitos });
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
      await resumo(env, agora, manha ? "*Resumo da manhã (10h)*" : "*Resumo do fim do expediente (17h)*", q);
      const aviso = lembretesRetirada({ ...q, agoraMs: agora, periodo: manha ? "manha" : "tarde" });
      if (aviso) await enviar(env, aviso, [[{ text: "Encaminhar ao grupo do WhatsApp", url: linkWaGrupo(aviso) }]]);
    } else {
      await verificarAtrasos(env, agora);
    }
  },
};
