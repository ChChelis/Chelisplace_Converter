// Google Agenda: um evento por retirada na gráfica (criado na API do Google com uma conta de serviço).
// Segredos do Worker: GOOGLE_SA_JSON (chave JSON da conta de serviço) e GOOGLE_CALENDAR_ID (agenda do Chelis).
import { diaUtilAnterior17 } from "./prazos.js";
import { lerCard, dataHoraBR } from "./avisos.js";

const API = "https://www.googleapis.com/calendar/v3";
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64uTxt = (t) => b64u(new TextEncoder().encode(t));

// Evento do Google com id estável por card ("trello" + id do Trello: só letras a-v e dígitos, como o Google exige).
export const idEvento = (cardId) => "trello" + String(cardId).toLowerCase();

const isoBR = (ms) => { // "2026-11-23T10:00:00-03:00"
  const d = new Date(ms - 3 * 3600e3), p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}T${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:00-03:00`;
};

// Três eventos por retirada (os lembretes de evento do Google valem só para o usuário que os grava, a conta de serviço;
// por isso o aviso é um evento no horário certo, e o Chelis deixa a notificação padrão da agenda "no horário do evento"):
//  - viagem: 10h do dia da retirada (1h);  - véspera: 17h do dia útil anterior (15 min);  - manhã: 8h do dia (15 min).
const sufixos = { viagem: "", vespera: "v", manha: "m" };
export const idsDoCard = (cardId) => Object.values(sufixos).map((x) => idEvento(cardId) + x);

function eventoBase({ card, trelloUrl }, id, summary, inicioMs, duracaoMs) {
  const info = lerCard(card);
  const linhas = [
    `Cliente: ${info.cliente}`,
    info.slots ? `Slots: ${info.slots}` : null,
    info.paginas ? `Páginas: ${info.paginas}` : null,
    info.previsao || null,
    trelloUrl ? `Card no Trello: ${trelloUrl}` : null,
  ].filter(Boolean);
  return {
    id, summary: summary.replace("{cliente}", info.cliente), description: linhas.join("\n"),
    start: { dateTime: isoBR(inicioMs), timeZone: "America/Sao_Paulo" },
    end: { dateTime: isoBR(inicioMs + duracaoMs), timeZone: "America/Sao_Paulo" },
    reminders: { useDefault: true },
  };
}

// Sem telefone nem valores: só o necessário para a viagem. Avisos no passado não são criados.
export function montarEventos({ card, inicioMs, trelloUrl, agoraMs = Date.now() }) {
  const base = idEvento(card.id);
  const dia = (ms) => { const d = new Date(ms - 3 * 3600e3); return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}`; };
  const eventos = [eventoBase({ card, trelloUrl }, base + sufixos.viagem, "Viagem: retirar pedido de {cliente} na gráfica", inicioMs, 3600e3)];
  const vespera = diaUtilAnterior17(inicioMs);
  if (vespera > agoraMs) eventos.push(eventoBase({ card, trelloUrl }, base + sufixos.vespera, `Aviso: viagem à gráfica no próximo dia útil (${dia(inicioMs)}) - {cliente}`, vespera, 15 * 60e3));
  const dLocal = new Date(inicioMs - 3 * 3600e3);
  const oito = Date.UTC(dLocal.getUTCFullYear(), dLocal.getUTCMonth(), dLocal.getUTCDate(), 8 + 3, 0);
  if (oito > agoraMs && oito < inicioMs) eventos.push(eventoBase({ card, trelloUrl }, base + sufixos.manha, "Aviso: hoje é dia de viagem à gráfica - {cliente}", oito, 15 * 60e3));
  return eventos;
}

// JWT RS256 da conta de serviço (WebCrypto).
export async function assinarJwt(sa, agoraS, escopo) {
  const cab = b64uTxt(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const corpo = b64uTxt(JSON.stringify({ iss: sa.client_email, scope: escopo, aud: "https://oauth2.googleapis.com/token", iat: agoraS, exp: agoraS + 3600 }));
  const pem = sa.private_key.replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "");
  const chave = await crypto.subtle.importKey("pkcs8", Uint8Array.from(atob(pem), (c) => c.charCodeAt(0)), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const ass = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", chave, new TextEncoder().encode(`${cab}.${corpo}`));
  return `${cab}.${corpo}.${b64u(ass)}`;
}

let cacheToken = null;
async function token(env) {
  if (cacheToken && cacheToken.exp > Date.now() + 60e3) return cacheToken.valor;
  const sa = JSON.parse(env.GOOGLE_SA_JSON);
  const jwt = await assinarJwt(sa, Math.floor(Date.now() / 1000), "https://www.googleapis.com/auth/calendar.events");
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
  });
  if (!r.ok) throw new Error(`Google token ${r.status}`);
  const d = await r.json();
  cacheToken = { valor: d.access_token, exp: Date.now() + (d.expires_in || 3600) * 1000 };
  return cacheToken.valor;
}

export const agendaConfigurada = (env) => !!(env.GOOGLE_SA_JSON && env.GOOGLE_CALENDAR_ID);

async function google(env, metodo, caminho, corpo) {
  const r = await fetch(`${API}/calendars/${encodeURIComponent(env.GOOGLE_CALENDAR_ID)}/events${caminho}`, {
    method: metodo,
    headers: { authorization: `Bearer ${await token(env)}`, "content-type": "application/json" },
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  return r;
}

// Cria o evento ou, se já existir (mesmo id), atualiza.
export async function criarOuAtualizarEvento(env, evento) {
  if (!agendaConfigurada(env)) return { ignorado: "agenda não configurada" };
  let r = await google(env, "POST", "", evento);
  if (r.status === 409) r = await google(env, "PUT", `/${evento.id}`, evento);
  if (!r.ok) throw new Error(`Google Agenda ${r.status}`);
  return { ok: true };
}

export async function criarOuAtualizarEventos(env, eventos) {
  for (const e of eventos) await criarOuAtualizarEvento(env, e);
  return { ok: true, eventos: eventos.length };
}

// Remove os três eventos do card (404/410 = já não existe).
export async function removerEvento(env, cardId) {
  if (!agendaConfigurada(env)) return { ignorado: "agenda não configurada" };
  for (const id of idsDoCard(cardId)) {
    const r = await google(env, "DELETE", `/${id}`);
    if (!r.ok && r.status !== 404 && r.status !== 410) throw new Error(`Google Agenda ${r.status}`);
  }
  return { ok: true };
}
