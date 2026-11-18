// Lógica pura dos avisos (sem rede): leitura de cards, resumo, mensagens, links.
import { prazoFinal, atrasado } from "./prazos.js";

export const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Dados que a página grava no card (título "Cliente · N slots"; linhas "Chave: valor" na descrição).
export function lerCard(card) {
  const desc = card.desc || "";
  const linha = (k) => {
    const m = desc.match(new RegExp("^\\s*" + k + "\\s*:\\s*(.+)$", "im"));
    return m ? m[1].trim() : "";
  };
  const t = card.name.match(/^(.*?)\s*·\s*(\d+)\s*slots?\s*$/i);
  const slots = parseInt(linha("Slots"), 10) || (t ? parseInt(t[2], 10) : 0);
  return {
    id: card.id,
    cliente: linha("Cliente") || (t ? t[1] : card.name),
    telefone: linha("Telefone"),
    slots,
    url: card.url,
  };
}

// Instante em que o card entrou na coluna atual (a partir das ações do quadro, mais novas primeiro).
export function entradasPorCard(acoes, cards) {
  const mapa = {};
  for (const a of acoes) {
    const id = a.data?.card?.id;
    if (!id || mapa[id]) continue;
    const entrou = a.data?.listAfter?.id || a.data?.list?.id;
    if (entrou) mapa[id] = Date.parse(a.date);
  }
  for (const c of cards) if (!mapa[c.id]) mapa[c.id] = Date.parse(c.dateLastActivity);
  return mapa;
}

export function duracao(ms) {
  const h = Math.max(0, Math.floor(ms / 3600e3));
  return h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${h}h`;
}

export function linkWaGrupo(texto) {
  return "https://wa.me/?text=" + encodeURIComponent(texto);
}

export function linkWaCliente(telefone, texto) {
  const n = (telefone || "").replace(/\D/g, "");
  if (!n) return null;
  return `https://wa.me/${n}?text=${encodeURIComponent(texto)}`;
}

// Mensagens ao cliente por coluna (o Chelis revisa e clica em enviar).
export const MSG_CLIENTE = {
  grafica: (c) => `Olá, ${c}! Seu pedido foi enviado para a gráfica. Assim que estiver pronto eu aviso por aqui.`,
  retirada: (c) => `Olá, ${c}! Seu pedido foi retirado da gráfica e segue para a colagem.`,
  pronto: (c) => `Olá, ${c}! Seu pedido está pronto para entrega. Me diga o melhor jeito de combinarmos.`,
};
export function msgClientePorColuna(coluna) {
  const n = norm(coluna);
  if (n.includes("grafica")) return MSG_CLIENTE.grafica;
  if (n.includes("retirada")) return MSG_CLIENTE.retirada;
  if (n.includes("pronto")) return MSG_CLIENTE.pronto;
  return null;
}

// Janela de Finalizados: começa no 5º dia útil (seg–sex, feriados não contam) mais recente, 00h de Brasília.
// É a data em que o Chelis paga a colagem; depois dela o resumo só mostra o que foi finalizado a partir dali.
export function quintoDiaUtil(ano, mes) { // mes 0-11; devolve epoch ms de 00:00 BRT
  let n = 0;
  for (let d = 1; d <= 31; d++) {
    const dt = new Date(Date.UTC(ano, mes, d));
    if (dt.getUTCMonth() !== mes) break;
    const w = dt.getUTCDay();
    if (w >= 1 && w <= 5 && ++n === 5) return Date.UTC(ano, mes, d, 3, 0, 0);
  }
}
export function inicioJanelaFinalizados(agoraMs) {
  const l = new Date(agoraMs - 3 * 3600e3);
  let ano = l.getUTCFullYear(), mes = l.getUTCMonth();
  let ini = quintoDiaUtil(ano, mes);
  if (agoraMs < ini) { mes--; if (mes < 0) { mes = 11; ano--; } ini = quintoDiaUtil(ano, mes); }
  return ini;
}

// Resumo das 10h/17h: por coluna, na ordem do quadro, só colunas com cards.
export function montarResumo({ listas, cards, entradas, agoraMs, titulo }) {
  const linhas = [titulo];
  let atrasados = 0, total = 0;
  const ini = inicioJanelaFinalizados(agoraMs);
  for (const l of listas) {
    let doL = cards.filter((c) => c.idList === l.id);
    const fin = norm(l.name).includes("finalizad");
    if (fin) doL = doL.filter((c) => entradas[c.id] >= ini); // só a janela atual (depois do pagamento)
    if (!doL.length) continue;
    linhas.push("", `▸ ${l.name} (${doL.length})${fin ? ` — desde ${fmtBR(ini).slice(0, 5)}` : ""}`);
    for (const c of doL) {
      const info = lerCard(c);
      const ent = entradas[c.id];
      const atr = atrasado(l.name, ent, agoraMs, info.slots);
      total++; if (atr) atrasados++;
      const prazo = prazoFinal(l.name, ent, info.slots);
      const extra = atr ? ` ⚠️ ATRASADO (prazo era ${fmtBR(prazo)})` : "";
      linhas.push(`• ${info.cliente}${info.slots ? ` · ${info.slots} slots` : ""} — há ${duracao(agoraMs - ent)}${extra}`);
    }
  }
  if (!total) linhas.push("", "Nenhum pedido no quadro.");
  else linhas.push("", `Total: ${total} pedido(s), ${atrasados} atrasado(s).`);
  return linhas.join("\n");
}

export function fmtBR(ms) {
  const d = new Date(ms - 3 * 3600e3);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)} ${p(d.getUTCHours())}h${p(d.getUTCMinutes())}`;
}

// Cards cujo prazo venceu na última hora (aviso estável, sem guardar estado).
export function recemAtrasados({ listas, cards, entradas, agoraMs }) {
  const out = [];
  for (const c of cards) {
    const l = listas.find((x) => x.id === c.idList);
    if (!l) continue;
    const info = lerCard(c);
    const p = prazoFinal(l.name, entradas[c.id], info.slots);
    if (p !== null && p <= agoraMs && p > agoraMs - 3600e3) out.push({ info, coluna: l.name, prazo: p });
  }
  return out;
}

// Texto do aviso de movimento de card + botões opcionais.
export function avisoMovimento({ cardNome, de, para, card }) {
  const info = lerCard(card || { name: cardNome, desc: "" });
  const texto = `📦 ${info.cliente}${info.slots ? ` · ${info.slots} slots` : ""}\n${de} → ${para}`;
  const botoes = [];
  const gerar = msgClientePorColuna(para);
  if (gerar) {
    const msg = gerar(info.cliente);
    const cli = linkWaCliente(info.telefone, msg);
    if (cli) botoes.push([{ text: "Avisar o cliente (WhatsApp)", url: cli }]);
    else botoes.push([{ text: "Mensagem ao cliente (sem telefone no card)", url: linkWaGrupo(msg) }]);
  }
  botoes.push([{ text: "Encaminhar ao grupo do WhatsApp", url: linkWaGrupo(texto) }]);
  return { texto, botoes };
}

// Card criado pela página: só estes campos entram (nunca custo, lucro, desconto ou Pix).
const txt = (v, n) => String(v ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, n);
const num = (v) => (Number.isFinite(+v) && +v >= 0 ? +v : 0);
export function montarCard(b) {
  const cliente = txt(b.cliente, 80) || "Cliente sem nome";
  const slots = Math.round(num(b.slots));
  const paginas = Math.round(num(b.paginas));
  const valor = num(b.valor);
  const linhas = [
    `Cliente: ${cliente}`,
    `Telefone: ${txt(b.telefone, 40)}`,
    `Slots: ${slots}`,
    `Páginas: ${paginas}`,
    `Valor cobrado: R$ ${valor.toFixed(2).replace(".", ",")}`,
  ];
  const pasta = txt(b.pastaUrl, 300);
  if (/^https:\/\/drive\.google\.com\//.test(pasta)) linhas.push(`Pasta do Drive: ${pasta}`);
  const alts = (Array.isArray(b.alteracoes) ? b.alteracoes : []).slice(0, 30).map((a) => txt(a, 200)).filter(Boolean);
  if (alts.length) linhas.push("", "Alterações:", ...alts.map((a) => "- " + a));
  return { name: `${cliente} · ${slots} slots`, desc: linhas.join("\n") };
}

// Aviso de card novo (criado pela página ou à mão no Trello).
export function avisoNovo({ card, coluna }) {
  const info = lerCard(card);
  const texto = `🆕 Novo pedido: ${info.cliente}${info.slots ? ` · ${info.slots} slots` : ""}\nColuna: ${coluna}`;
  return { texto, botoes: [[{ text: "Encaminhar ao grupo do WhatsApp", url: linkWaGrupo(texto) }]] };
}
