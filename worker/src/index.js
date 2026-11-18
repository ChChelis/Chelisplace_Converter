// Worker chelisplace-avisos: webhook do Trello + resumos 10h/17h + avisos de atraso -> Telegram.
// Segredos (Cloudflare, tipo "Segredo"): TRELLO_KEY, TRELLO_TOKEN, TELEGRAM_TOKEN, ADMIN_SECRET.
// Variáveis comuns: TELEGRAM_CHAT_ID, TRELLO_BOARD_ID.
import { entradasPorCard, montarResumo, recemAtrasados, avisoMovimento, linkWaGrupo, fmtBR } from "./avisos.js";

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
    chat_id: env.TELEGRAM_CHAT_ID, text: texto,
    reply_markup: botoes.length ? { inline_keyboard: botoes } : undefined,
    disable_web_page_preview: true,
  });

async function carregarQuadro(env) {
  const b = env.TRELLO_BOARD_ID;
  const [listas, cards, acoes] = await Promise.all([
    trello(env, `/boards/${b}/lists`, { fields: "name" }),
    trello(env, `/boards/${b}/cards`, { fields: "name,desc,idList,dateLastActivity,url" }),
    trello(env, `/boards/${b}/actions`, { filter: "updateCard:idList,createCard,copyCard,moveCardToBoard", limit: "1000" }),
  ]);
  return { listas, cards, entradas: entradasPorCard(acoes, cards) };
}

async function resumo(env, agoraMs, titulo) {
  const q = await carregarQuadro(env);
  const texto = montarResumo({ ...q, agoraMs, titulo });
  await enviar(env, texto, [[{ text: "Encaminhar ao grupo do WhatsApp", url: linkWaGrupo(texto) }]]);
}

async function verificarAtrasos(env, agoraMs) {
  const q = await carregarQuadro(env);
  for (const a of recemAtrasados({ ...q, agoraMs })) {
    const texto = `⚠️ ATRASADO: ${a.info.cliente} (${a.coluna}) — prazo era ${fmtBR(a.prazo)}`;
    await enviar(env, texto, [[{ text: "Encaminhar ao grupo do WhatsApp", url: linkWaGrupo(texto) }]]);
  }
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
        const { texto, botoes } = avisoMovimento({
          cardNome: a.data.card.name, de: a.data.listBefore.name, para: a.data.listAfter.name, card,
        });
        await enviar(env, texto, botoes);
      }
      return new Response("ok");
    }

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
      if (acao === "teste") { await enviar(env, "✅ Chelisplace Avisos conectado."); return json({ ok: true }); }
      if (acao === "resumo") { await resumo(env, Date.now(), "📋 Resumo (teste manual)"); return json({ ok: true }); }
      return json({ erro: "ação desconhecida" }, 404);
    }
    return new Response("chelisplace-avisos", { status: 200 });
  },

  async scheduled(evento, env) {
    const agora = Date.now();
    if (evento.cron === "0 13,20 * * 1-5") {
      const manha = new Date(agora - 3 * 3600e3).getUTCHours() < 12;
      await resumo(env, agora, manha ? "☀️ Resumo da manhã (10h)" : "🌇 Resumo do fim do expediente (17h)");
    } else {
      await verificarAtrasos(env, agora);
    }
  },
};
