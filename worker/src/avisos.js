// Lógica pura dos avisos (sem rede): leitura de cards, resumo, mensagens, links.
import { prazoFinal, atrasado, somarUtil, fimDiaUtil, alinharLoja, minutosColagem, COLADOR, EXPEDIENTE, chaveDia, chaveProximoDiaUtil } from "./prazos.js";
import { feriadosNacionais } from "./feriados.js";
export { feriadosNacionais };

export const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Linhas de prazo/previsão por etapa (uma só aparece no card, conforme a coluna atual).
export const ROTULOS = ["Prazo limite para montar", "Previsão de retirada da gráfica", "Prazo máximo de colagem", "Previsão de entrega"];
const RE_PREVISAO = new RegExp("^\\s*(?:" + ROTULOS.join("|") + ")\\s*:.*$", "im");

// Dados que a página grava no card (título "Cliente · N slots"; linhas "Chave: valor" na descrição).
export function lerCard(card) {
  const desc = card.desc || "";
  const linha = (k) => {
    const m = desc.match(new RegExp("^\\s*" + k + "\\s*:\\s*(.+)$", "im"));
    return m ? m[1].trim() : "";
  };
  const t = (card.name || "").match(/^(.*?)\s*·\s*(\d+)\s*slots?\s*$/i);
  const slots = parseInt(linha("Slots"), 10) || (t ? parseInt(t[2], 10) : 0);
  const dataBR = (t) => {
    const m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
    return m ? Date.UTC(+m[3], +m[2] - 1, +m[1], (+m[4] || 0) + 3, +m[5] || 0) : null; // hora de Brasília -> UTC
  };
  const paginas = parseInt(linha("Páginas"), 10) || 0;
  const entrouEm = dataBR(linha("Entrou na coluna"));
  const prazoManual = dataBR(linha("Prazo"));
  const confirmadaEm = dataBR(linha("Entrada confirmada em"));
  return {
    id: card.id,
    entrouEm, prazoManual, confirmadaEm, paginas,
    slotsPrazo: paginas ? paginas * 18 : slots, // Colagem conta pela página inteira (páginas x 18)
    previsao: (desc.match(RE_PREVISAO) || [""])[0].trim(), // linha de prazo/previsão da etapa atual, se houver
    cliente: linha("Cliente") || (t ? t[1] : card.name || ""),
    telefone: linha("Telefone"),
    slots,
    url: card.url,
  };
}

// Prazo do card: o "Prazo:" informado à mão vale só enquanto o card está na coluna em que foi criado
// (entrada = a data "Entrou na coluna"); depois de qualquer movimento volta a regra da coluna.
export function prazoDe(coluna, entradaMs, info) {
  if (info.prazoManual && info.entrouEm && info.entrouEm === entradaMs) return info.prazoManual;
  return prazoFinal(coluna, entradaMs, info.slotsPrazo ?? info.slots);
}

export const dataHoraBR = (ms) => {
  const d = new Date(ms - 3 * 3600e3), p = (n) => String(n).padStart(2, "0");
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
};

// O que informar ao entrar em cada coluna (depois da Colagem e antes da Montagem não há previsão):
//  Montagem -> prazo limite para montar; Gráfica -> previsão de retirada da gráfica; Colagem -> prazo máximo de colagem.
// A retirada da gráfica: a gráfica libera ao fim do 3º dia útil (entrada = dia 1) às 17h, ainda no expediente da loja, e a
// retirada é no mesmo expediente ou no seguinte. Prazo já vencido: a previsão parte de "agora".
export function pegadaGrafica(entradaMs, info, agoraMs) {
  const liberacao = info.prazoManual && info.entrouEm === entradaMs ? info.prazoManual : fimDiaUtil(entradaMs, 3, EXPEDIENTE.fim);
  return alinharLoja(Math.max(liberacao, agoraMs));
}
// Vencimento (due) do card no Trello, que o Power-Up do Google Agenda mostra como evento: a viagem para retirar na gráfica.
// Evento às 10h do dia da retirada prevista (a retirada em si é prevista para 17h); se as 10h daquele dia já passaram,
// usa o próprio horário da retirada prevista, para não criar evento no passado.
export const HORA_VIAGEM = 10 * 60;
export function vencimentoGrafica(coluna, entradaMs, info, agoraMs) {
  if (!norm(coluna).includes("grafica")) return null;
  const pegada = pegadaGrafica(entradaMs, info, agoraMs);
  const dia10 = pegada - ((new Date(pegada - 3 * 3600e3).getUTCHours() * 60 + new Date(pegada - 3 * 3600e3).getUTCMinutes()) - HORA_VIAGEM) * 60e3;
  return new Date(dia10 > agoraMs ? dia10 : pegada).toISOString();
}
export function linhaPrevisao(coluna, entradaMs, info, agoraMs) {
  const n = norm(coluna);
  const slots = info.slotsPrazo ?? info.slots;
  if (n.includes("montagem")) return `${ROTULOS[0]}: ${dataHoraBR(prazoDe(coluna, entradaMs, info))}`;
  if (n.includes("grafica")) return `${ROTULOS[1]}: ${dataHoraBR(pegadaGrafica(entradaMs, info, agoraMs))}`;
  if (n.includes("colagem")) return `${ROTULOS[2]}: ${dataHoraBR(somarUtil(entradaMs, minutosColagem(slots), COLADOR))}`;
  return null;
}

// Tira as linhas de prazo/previsão e, se houver, coloca a da etapa atual.
export function aplicarPrevisao(desc, linha) {
  let d = (desc || "").split("\n").filter((l) => !RE_PREVISAO.test(l)).join("\n");
  if (!linha) return d.trimEnd();
  const [chave, ...resto] = linha.split(": ");
  return setLinha(d.trimEnd(), chave, resto.join(": "));
}

// Substitui (ou acrescenta) uma linha "Chave: valor" na descrição.
export function setLinha(desc, chave, valor) {
  const re = new RegExp("^\\s*" + chave + "\\s*:.*$", "im");
  const nova = `${chave}: ${valor}`;
  if (re.test(desc)) return desc.replace(re, nova);
  const i = desc.indexOf("\n\nAlterações:");
  return i >= 0 ? desc.slice(0, i) + "\n" + nova + desc.slice(i) : (desc ? desc + "\n" : "") + nova;
}

// Texto da previsão de um card numa coluna: data, "pronto" ou "entregue".
export function textoPrevisao(coluna, entradaMs, info, agoraMs) {
  const n = norm(coluna);
  if (n.includes("finalizad")) return "entregue";
  if (n.includes("pronto")) return "pronto para entrega";
  const p = previsaoEntrega(coluna, entradaMs, info, agoraMs);
  return p === null ? null : dataHoraBR(p);
}

// Instante em que o card entrou na coluna atual (a partir das ações do quadro, mais novas primeiro).
export function entradasPorCard(acoes, cards) {
  const info = {};
  for (const c of cards) { const i = lerCard(c); if (i.entrouEm) info[c.id] = i; }
  const mapa = {};
  for (const a of acoes) {
    const id = a.data?.card?.id;
    if (!id || mapa[id]) continue;
    // só vale mudança de coluna: updateCard precisa de listAfter (outras edições do card, como descrição ou vencimento, não reiniciam o relógio)
    const entrou = a.type === "updateCard" ? a.data?.listAfter?.id : a.data?.listAfter?.id || a.data?.list?.id;
    if (!entrou) continue;
    const quando = Date.parse(a.date);
    // "Entrou na coluna" (data informada) vale até a hora de corte: a "Entrada confirmada em" da descrição ou, na falta dela,
    // 10 min depois da criação (o id do card, um ObjectId, guarda o instante de criação). Movimentos depois do corte reiniciam o relógio.
    const criacao = /^[0-9a-f]{24}$/.test(id) ? parseInt(id.slice(0, 8), 16) * 1000 : NaN;
    const corte = info[id]?.confirmadaEm ?? criacao + 10 * 60e3;
    const valeManual = info[id] && (a.type !== "updateCard" || quando <= corte);
    mapa[id] = valeManual ? info[id].entrouEm : quando;
  }
  for (const c of cards) if (!mapa[c.id]) mapa[c.id] = info[c.id]?.entrouEm || Date.parse(c.dateLastActivity);
  return mapa;
}

export function duracao(ms) {
  const h = Math.max(0, Math.floor(ms / 3600e3));
  return h >= 24 ? `${Math.floor(h / 24)}d ${h % 24}h` : `${h}h`;
}

// O Telegram recusa botões com URL longa (limite ~2048): corta o texto até o link caber.
export function linkWaGrupo(texto) {
  let t = texto;
  while (t.length > 20 && ("https://wa.me/?text=" + encodeURIComponent(t)).length > 1800) t = t.slice(0, Math.floor(t.length * 0.9)).trimEnd() + "...";
  return "https://wa.me/?text=" + encodeURIComponent(t);
}

export function linkWaCliente(telefone, texto) {
  const n = (telefone || "").replace(/\D/g, "");
  if (!n) return null;
  return `https://wa.me/${n}?text=${encodeURIComponent(texto)}`;
}

// Mensagens ao cliente por coluna (o Chelis revisa e clica em enviar).
export const MSG_CLIENTE = {
  grafica: (c) => `Olá, ${c}! Seu pedido foi enviado para a gráfica. Assim que estiver pronto eu aviso por aqui.`,
  retirada: (c) => `Olá, ${c}! Seu pedido foi retirado na gráfica e segue para a finalização.`,
  pronto: (c) => `Olá, ${c}! Seu pedido está pronto para entrega. Me diga o melhor jeito de combinarmos.`,
};
export function msgClientePorColuna(coluna) {
  const n = norm(coluna);
  if (n.includes("grafica")) return MSG_CLIENTE.grafica;
  if (n.includes("retirada")) return MSG_CLIENTE.retirada;
  if (n.includes("pronto")) return MSG_CLIENTE.pronto;
  return null;
}

// Janela de Finalizados: começa no 5º dia útil (seg–sex, sem feriados nacionais) mais recente, 00h de Brasília.
// É a data em que o Chelis paga a colagem; depois dela o resumo só mostra o que foi finalizado a partir dali.
export function quintoDiaUtil(ano, mes) { // mes 0-11; devolve epoch ms de 00:00 BRT
  const fer = feriadosNacionais(ano);
  let n = 0;
  for (let d = 1; d <= 31; d++) {
    const dt = new Date(Date.UTC(ano, mes, d));
    if (dt.getUTCMonth() !== mes) break;
    const w = dt.getUTCDay();
    const chave = `${ano}-${String(mes + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    if (w >= 1 && w <= 5 && !fer.has(chave) && ++n === 5) return Date.UTC(ano, mes, d, 3, 0, 0);
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
    linhas.push("", `*Coluna ${l.name} (${doL.length})${fin ? ` - desde ${fmtBR(ini).slice(0, 5)}` : ""}:*`);
    for (const c of doL) {
      const info = lerCard(c);
      const ent = entradas[c.id];
      const prazo = prazoDe(l.name, ent, info);
      const atr = prazo !== null && agoraMs > prazo;
      total++; if (atr) atrasados++;
      const extra = atr ? ` - *ATRASADO* (prazo era ${fmtBR(prazo)})` : "";
      linhas.push(`- ${info.cliente}${info.slots ? ` · ${info.slots} slots` : ""} - há ${duracao(agoraMs - ent)}${extra}`);
    }
  }
  if (!total) linhas.push("", "Nenhum pedido no quadro.");
  else linhas.push("", `_Total: ${total} pedido(s), ${atrasados} atrasado(s)._`);
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
    const p = prazoDe(l.name, entradas[c.id], info);
    if (p !== null && p <= agoraMs && p >= agoraMs - 3600e3) out.push({ info, coluna: l.name, prazo: p });
  }
  return out;
}

// Valor da colagem (custo pago ao colador): páginas x 18 x R$ 0,13, arredondado (mesma regra do orçamento).
export const COLAGEM_POR_SLOT = 0.13;
export const valorColagem = (info) => (info.slots ? Math.round((info.paginas || Math.ceil(info.slots / 18)) * 18 * COLAGEM_POR_SLOT) : 0); // sem adesivos (ex.: caixas), sem colagem

// Descrição do card para os avisos: sem as linhas de controle do Worker, o telefone nem o valor cobrado; com valor de colagem e a linha da etapa.
export function descricaoParaAviso(desc, linha) {
  const info = lerCard({ name: "", desc });
  let d = (desc || "").split("\n").filter((l) => !/^\s*(Entrou na coluna|Entrada confirmada em|Prazo|Telefone|Valor cobrado|Valor de colagem)\s*:/i.test(l)).join("\n").trim();
  if (info.slots || info.paginas) d = setLinha(d, "Valor de colagem", `R$ ${valorColagem(info)}`);
  d = aplicarPrevisao(d, linha);
  if (d.length > 900) d = d.slice(0, 900).trimEnd() + "...";
  // formatação do WhatsApp (*negrito*, _itálico_): rótulos em negrito; a linha de prazo/previsão inteira em negrito
  return d.split("\n").map((l) => {
    if (RE_PREVISAO.test(l)) return `*${l.trim()}*`;
    const m = l.match(/^([A-Za-zÀ-ÿ ]{1,30}):(\s.*)?$/);
    return m && !/^https?$/i.test(m[1]) ? `*${m[1]}:*${m[2] || ""}` : l;
  }).join("\n");
}

// Texto do aviso de movimento de card + botões opcionais (sem emojis: colam mal no WhatsApp).
export function avisoMovimento({ cardNome, de, para, card, previsao }) { // previsao: linha "Rótulo: data" ou null
  const info = lerCard(card || { name: cardNome, desc: "" });
  const dados = descricaoParaAviso(card?.desc, previsao);
  const texto = `*PEDIDO MOVIDO:* ${info.cliente}${info.slots ? ` · ${info.slots} slots` : ""}\nDe _${de}_ para _${para}_.` + (dados ? `\n\n_Dados do pedido:_\n${dados}` : "");
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
// Comentários do card com as alterações completas (um por tópico; tópico muito longo é dividido). O Trello limita a descrição, e linhas longas ficavam cortadas.
const LIMITE_COMENTARIO = 7000;
export function comentariosAlteracoes(titulo, itens) {
  const cab = `**${titulo}**`, saida = [];
  let atual = [];
  const tam = () => atual.reduce((n, l) => n + l.length + 1, 0);
  for (const it of itens) {
    const linha = "- " + it;
    if (atual.length && tam() + linha.length > LIMITE_COMENTARIO) { saida.push(atual); atual = []; }
    atual.push(linha);
  }
  if (atual.length || !saida.length) saida.push(atual);
  return saida.map((ls, i) => `${cab}${i ? " (continuação)" : ""}\n\n${ls.join("\n")}`.trim());
}
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
  if (b.entrouEm) {
    const t = typeof b.entrouEm === "number" ? b.entrouEm : Date.parse(b.entrouEm);
    if (Number.isFinite(t)) { const d = new Date(t - 3 * 3600e3), p = (n) => String(n).padStart(2, "0");
      linhas.push(`Entrou na coluna: ${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`); }
  }
  if (b.prazo) {
    const t = typeof b.prazo === "number" ? b.prazo : Date.parse(b.prazo);
    if (Number.isFinite(t)) { const d = new Date(t - 3 * 3600e3), p = (n) => String(n).padStart(2, "0");
      linhas.push(`Prazo: ${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`); }
  }
  const pasta = txt(b.pastaUrl, 300);
  if (/^https:\/\/drive\.google\.com\//.test(pasta)) linhas.push(`Pasta do Drive: ${pasta}`);
  const obs = txt(b.obs, 400);
  if (obs) linhas.push(`Obs: ${obs}`);
  const alts = [], comentarios = [];
  for (const a of (Array.isArray(b.alteracoes) ? b.alteracoes : []).slice(0, 30)) {
    if (typeof a === "string") { const t = txt(a, 200); if (t) alts.push(t); continue; }  // formato antigo: uma linha por tópico
    const titulo = txt(a && a.titulo, 120), itens = (Array.isArray(a && a.itens) ? a.itens : []).slice(0, 300).map((i) => txt(i, 1000)).filter(Boolean);
    if (!itens.length) continue;
    alts.push(`${titulo || "Alterações"}: ${itens.length} item(ns), detalhes nos comentários do card`);
    comentarios.push(...comentariosAlteracoes(titulo || "Alterações", itens));
  }
  if (alts.length) linhas.push("", "Alterações:", ...alts.map((a) => "- " + a));
  return { name: `${cliente} · ${slots} slots`, desc: linhas.join("\n"), comentarios };
}

// Aviso de card novo (criado pela página ou à mão no Trello).
export function avisoNovo({ card, coluna, previsao }) {
  const info = lerCard(card);
  const dados = descricaoParaAviso(card.desc, previsao === undefined ? info.previsao : previsao);
  const texto = `*NOVO PEDIDO:* ${info.cliente}${info.slots ? ` · ${info.slots} slots` : ""}\nColuna _${coluna}_.` + (dados ? `\n\n_Dados do pedido:_\n${dados}` : "");
  return { texto, botoes: [[{ text: "Encaminhar ao grupo do WhatsApp", url: linkWaGrupo(texto) }]] };
}

// O Telegram não entende o formato do WhatsApp: converte *negrito* e _itálico_ (só nas bordas de palavra, para não
// pegar underscores de links) em HTML do Telegram, escapando o resto.
export function paraTelegram(t) {
  const esc = t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc
    .replace(/(^|[\s(])\*(\S(?:[^*\n]*\S)?)\*(?=$|[\s).,;:!?])/gm, "$1<b>$2</b>")
    .replace(/(^|[\s(])_(\S(?:[^_\n]*\S)?)_(?=$|[\s).,;:!?])/gm, "$1<i>$2</i>");
}

// Lembretes de viagem para retirar na gráfica: de manhã (10h) os cards com retirada hoje; no fim do expediente (17h) os do
// próximo dia útil. Usa o vencimento (due) do card, ainda não cumprido, na coluna Gráfica.
export function lembretesRetirada({ listas, cards, agoraMs, periodo }) {
  const alvo = periodo === "manha" ? chaveDia(agoraMs) : chaveProximoDiaUtil(agoraMs);
  const grafica = new Set(listas.filter((l) => norm(l.name).includes("grafica")).map((l) => l.id));
  const itens = cards.filter((c) => grafica.has(c.idList) && c.due && !c.dueComplete && chaveDia(Date.parse(c.due)) === alvo);
  if (!itens.length) return null;
  const [a, m, d] = alvo.split("-");
  const titulo = periodo === "manha" ? `*RETIRADA NA GRÁFICA HOJE (${d}/${m})*` : `*RETIRADA NA GRÁFICA NO PRÓXIMO DIA ÚTIL (${d}/${m})*`;
  const linhas = itens.map((c) => {
    const info = lerCard(c);
    const ret = (info.previsao.match(/Previsão de retirada da gráfica:\s*\d\d\/\d\d\/\d{4}\s+(\d\d:\d\d)/) || [])[1];
    const viagem = dataHoraBR(Date.parse(c.due)).slice(11);
    return `- ${info.cliente}${info.slots ? ` · ${info.slots} slots` : ""}${info.paginas ? ` · ${info.paginas} páginas` : ""} - viagem a partir das ${viagem}${ret && ret !== viagem ? `, retirada prevista ${ret}` : ""}`;
  });
  return [titulo, ...linhas, "", periodo === "manha" ? "_Hoje será preciso fazer a viagem à gráfica._" : "_Planeje a viagem à gráfica para esse dia._"].join("\n");
}

// Relatório do que se paga ao colador: pedidos finalizados na janela atual (desde o 5º dia útil mais recente),
// com o valor de colagem de cada um, o total e a previsão dos que ainda estão em andamento.
export function relatorioColagem({ listas, cards, entradas, agoraMs }) {
  const ini = inicioJanelaFinalizados(agoraMs);
  const l = new Date(ini - 3 * 3600e3);
  const proxima = quintoDiaUtil(l.getUTCMonth() === 11 ? l.getUTCFullYear() + 1 : l.getUTCFullYear(), (l.getUTCMonth() + 1) % 12);
  const fin = new Set(listas.filter((x) => norm(x.name).includes("finalizad")).map((x) => x.id));
  const feitos = cards.filter((c) => fin.has(c.idList) && entradas[c.id] >= ini).sort((a, b) => entradas[a.id] - entradas[b.id]);
  const andamento = cards.filter((c) => !fin.has(c.idList));
  const linha = (c) => { const i = lerCard(c); return `- ${i.cliente} - ${i.paginas ? `${i.paginas} páginas` : `${i.slots} slots`} - R$ ${valorColagem(i)}`; };
  const soma = (cs) => cs.reduce((t, c) => t + valorColagem(lerCard(c)), 0);
  const saida = [`*Colagem: janela desde ${fmtBR(ini).slice(0, 5)}*`, `_Próximo pagamento: ${fmtBR(proxima).slice(0, 5)} (5º dia útil)_`, ""];
  saida.push(feitos.length ? feitos.map(linha).join("\n") : "Nenhum pedido finalizado nesta janela.");
  saida.push("", `*Total a pagar: R$ ${soma(feitos)}* (${feitos.length} pedido(s))`);
  if (andamento.length) saida.push("", `_Em andamento (ainda não finalizados): ${andamento.length} pedido(s), R$ ${soma(andamento)} previstos._`);
  return saida.join("\n");
}
