// Lógica pura dos avisos (sem rede): leitura de cards, resumo, mensagens, links.
import { prazoFinal, atrasado, somarUtil, fimDiaUtil, alinharLoja, minutosColagem, inicioJanela, COLADOR, COLADOR_COM_DOMINGO, COLADORES, EXPEDIENTE, chaveDia, chaveProximoDiaUtil } from "./prazos.js";
import { feriadosNacionais } from "./feriados.js";
export { feriadosNacionais };

export const norm = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

// Linhas de prazo/previsão por etapa (uma só aparece no card, conforme a coluna atual).
export const ROTULOS = ["Prazo limite para montar", "Previsão de retirada da gráfica", "Prazo máximo de colagem", "Previsão de entrega"];
const RE_PREVISAO = new RegExp("^\\s*(?:" + ROTULOS.join("|") + ")\\s*:.*$", "im");

// "Natan_2_Wolfir_Deck": o nome do pedido (do bot) leva o cliente na frente. Para o cliente: nome = campo "Nome do cliente" (ou o que vem antes do primeiro "_");
// item da lista = o resto, sem o número do pedido e com espaços no lugar de "_" ("Wolfir Deck").
export function nomesDoCliente(nomeCampo, pedido) {
  const partes = String(pedido || "").split("_").map((x) => x.trim()).filter(Boolean);
  const nome = nomeCampo || (partes.length > 1 ? partes[0] : String(pedido || "").trim());
  let resto = partes.length > 1 ? partes.slice(1) : [];
  if (nomeCampo && !resto.length) resto = [];
  if (resto.length && /^\d+$/.test(resto[0])) resto = resto.slice(1);
  const item = resto.join(" ").trim() || (partes.length > 1 ? String(pedido).replace(/_/g, " ").trim() : "Pedido");
  return { nomeCliente: nome, itemPedido: item };
}

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
    previsaoMs: dataBR(((desc.match(RE_PREVISAO) || [""])[0].split(":").slice(1).join(":")).trim()),
    previsaoDomMs: dataBR(((desc.match(RE_PREVISAO) || [""])[0].match(/com domingo:\s*(\d[^)]*)\)/) || [, ""])[1].trim()),   // 2ª conta da Colagem (se o colador trabalhar no domingo)
    cliente: linha("Cliente") || (t ? t[1] : card.name || ""),
    ...nomesDoCliente(linha("Nome do cliente"), linha("Cliente") || (t ? t[1] : card.name || "")),
    telefone: linha("Telefone"),
    slots,
    url: card.url,
  };
}

// Prazo do card: o "Prazo:" informado à mão vale só enquanto o card está na coluna em que foi criado
// (entrada = a data "Entrou na coluna"); depois de qualquer movimento volta a regra da coluna.
// `fila` (opcional): prazos da Colagem já calculados em fila por cliente (prazosColagem).
export function prazoDe(coluna, entradaMs, info, fila) {
  if (info.prazoManual && info.entrouEm && info.entrouEm === entradaMs) return info.prazoManual;
  if (fila && norm(coluna).includes("colagem") && fila.has(info.id)) return fila.get(info.id);
  return prazoFinal(coluna, entradaMs, info.slotsPrazo ?? info.slots);
}

// O colador cola um pedido por vez: todos os cards da coluna Colagem entram numa fila geral, na ordem de entrada na coluna, e cada um vai para o
// primeiro colador que ficar livre (COLADORES = 1 hoje: o prazo de cada um começa quando o anterior termina; na própria entrada, se estiver livre),
// na janela do colador, 3 h a cada 108 slots. cards: os que estão na Colagem; entradas: {idCard: ms}. Devolve Map idCard -> prazo (ms).
export function prazosColagem(cards, entradas, coladores = COLADORES, janela = COLADOR) {
  const fila = cards.map((c) => ({ info: lerCard(c), ent: entradas[c.id] ?? Date.now() }));
  fila.sort((a, b) => a.ent - b.ent || a.info.cliente.localeCompare(b.info.cliente, "pt-BR", { numeric: true }));
  const livres = Array.from({ length: Math.max(1, coladores) }, () => 0), saida = new Map();
  for (const { info, ent } of fila) {
    const k = livres.indexOf(Math.min(...livres));
    const manual = info.prazoManual && info.entrouEm && info.entrouEm === ent;
    const prazo = manual ? info.prazoManual : somarUtil(Math.max(ent, livres[k]), minutosColagem(info.slotsPrazo ?? info.slots), janela);
    saida.set(info.id, prazo); livres[k] = Math.max(livres[k], prazo);
  }
  return saida;
}
const filaDaColagem = (listas, cards, entradas) => {
  const ids = new Set(listas.filter((l) => norm(l.name).includes("colagem")).map((l) => l.id));
  return prazosColagem(cards.filter((c) => ids.has(c.idList)), entradas);
};

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
export const linhaColagem = (prazoMs, prazoDomMs) => `${ROTULOS[2]}: ${dataHoraBR(prazoMs)} (com domingo: ${dataHoraBR(prazoDomMs)})`;
// irmaos: os outros cards que já estão na Colagem (com a linha de prazo deles): este só começa quando um colador ficar livre
// (com 1 colador, depois do maior prazo da fila; com N, depois do N-ésimo maior).
export function linhaPrevisao(coluna, entradaMs, info, agoraMs, irmaos = []) {
  const n = norm(coluna);
  const slots = info.slotsPrazo ?? info.slots;
  if (n.includes("montagem")) return `${ROTULOS[0]}: ${dataHoraBR(prazoDe(coluna, entradaMs, info))}`;
  if (n.includes("grafica")) return `${ROTULOS[1]}: ${dataHoraBR(pegadaGrafica(entradaMs, info, agoraMs))}`;
  if (n.includes("colagem")) {
    // sempre duas contas: sem domingo (colador de segunda a sábado) e com domingo (folga facultativa); cada uma segue a fila dos cards que já estão na coluna
    const ocupadoAte = (campo) => { const ps = irmaos.map((c) => lerCard(c)).filter((i) => i.id !== info.id).map((i) => i[campo] || i.previsaoMs || 0).sort((a, b) => b - a); return ps.length >= COLADORES ? ps[COLADORES - 1] : 0; };
    const min = minutosColagem(slots);
    return linhaColagem(somarUtil(Math.max(entradaMs, ocupadoAte("previsaoMs")), min, COLADOR), somarUtil(Math.max(entradaMs, ocupadoAte("previsaoDomMs")), min, COLADOR_COM_DOMINGO));
  }
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

// Mensagens ao cliente por coluna (o Chelis revisa e clica em enviar). A mensagem acumula todos os pedidos do mesmo cliente que estão na coluna de destino.
const dia2 = (ms) => { const d = new Date(ms - 3 * 3600e3), p = (n) => String(n).padStart(2, "0"); return { sem: ["dom", "seg", "ter", "qua", "qui", "sex", "sáb"][d.getUTCDay()], data: `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}`, h: d.getUTCHours(), m: d.getUTCMinutes() }; };
const horaCurta = (d) => `${d.h}h${d.m ? String(d.m).padStart(2, "0") : ""}`;
export const fmtDiaHora = (ms) => { const d = dia2(ms); return `${d.sem} ${d.data} às ${horaCurta(d)}`; };
export const fmtDia = (ms) => { const d = dia2(ms); return `${d.sem} ${d.data}`; };
const fmtHoras = (min) => { const h = min / 60; return Number.isInteger(h) ? String(h) : String(h).replace(".", ","); };
const ACAO = { grafica: "ser recebido na gráfica", retirada: "ser retirado na gráfica e segue para finalização", pronto: "ficar pronto para entrega" };
// cards: todos os do cliente na coluna (inclui o que acabou de entrar); agoraMs: instante do movimento
export function mensagemCliente(tipo, cards, agoraMs) {
  const infos = cards.map((c) => lerCard(c)).sort((x, y) => x.cliente.localeCompare(y.cliente, "pt-BR", { numeric: true }));   // Natan_1, Natan_2, ... Natan_10
  const nome = infos[0].nomeCliente;
  let t = `Olá ${nome}! Tudo joia? Seu pedido acabou de ${ACAO[tipo]}. O conteúdo é:\n\n${infos.map((i) => `* ${i.itemPedido}`).join("\n")}\n\n`;
  if (tipo === "retirada") {
    const paginas = infos.reduce((n, i) => n + (i.paginas || Math.max(1, Math.ceil(i.slots / 18))), 0), min = paginas * 30;   // meia hora por página (3h a cada kit de 6 páginas), sem arredondar
    const abre = COLADOR.seg[0].ini, fecha = COLADOR.seg.at(-1).fim, h = (m) => `${Math.floor(m / 60)}h${m % 60 ? String(m % 60).padStart(2, "0") : ""}`;   // janela fixa diária do colador (10h–23h)
    t += `Começando na próxima janela apta, entre ${h(abre)} e ${h(fecha)}, seu pedido precisa de ${fmtHoras(min)} horas para ser finalizado por um de nossos colaboradores. Te dou mais notícias assim que terminarmos!`;
  } else if (tipo === "grafica") {
    t += `A gráfica cobra de 2 a 3 dias úteis para entregar o pedido, então seu pedido deve estar pronto por volta de ${fmtDia(fimDiaUtil(agoraMs, 3, 17 * 60))} para ser coletado às 17h desse dia. Te mantenho informado!`;
  } else {
    t += `Agora é só combinar a entrega e ser feliz! Podemos nos encontrar em uma loja ou você pode solicitar um entregador para buscar. Se for o caso, trocamos endereços! Muito obrigado pelo pedido e eu espero que esteja do seu gosto. Volte sempre, espalhe a palavra e, de novo, muito obrigado pela preferência!`;
  }
  return t;
}
export function tipoMsgCliente(coluna) {
  const n = norm(coluna);
  return n.includes("grafica") ? "grafica" : n.includes("retirada") ? "retirada" : n.includes("pronto") ? "pronto" : null;
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
  const ini = inicioJanelaFinalizados(agoraMs), fila = filaDaColagem(listas, cards, entradas);
  for (const l of listas) {
    let doL = cards.filter((c) => c.idList === l.id);
    const fin = norm(l.name).includes("finalizad");
    if (fin) doL = doL.filter((c) => entradas[c.id] >= ini); // só a janela atual (depois do pagamento)
    if (!doL.length) continue;
    linhas.push("", `*Coluna ${l.name} (${doL.length})${fin ? ` - desde ${fmtBR(ini).slice(0, 5)}` : ""}:*`);
    for (const c of doL) {
      const info = lerCard(c);
      const ent = entradas[c.id];
      const prazo = prazoDe(l.name, ent, info, fila);
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
  const out = [], fila = filaDaColagem(listas, cards, entradas);
  for (const c of cards) {
    const l = listas.find((x) => x.id === c.idList);
    if (!l) continue;
    const info = lerCard(c);
    const p = prazoDe(l.name, entradas[c.id], info, fila);
    if (p !== null && p <= agoraMs && p >= agoraMs - 3600e3) out.push({ info, coluna: l.name, prazo: p });
  }
  return out;
}

// Previsão da fila de colagem (comando /fila): quem está na Colagem agora, quem vai entrar (Retirada: entra já) e quem ainda está na Gráfica (entra na retirada
// prevista), todos numa fila só pela ordem de entrada, cada um depois do colador ficar livre. Sempre as duas contas: sem domingo e com domingo (folga facultativa).
// Um pedido da Colagem já vencido conta como se terminasse agora (o colador ainda está nele). `filtro`: só mostra os pedidos cujo nome contém o texto (a fila é a inteira).
export function previsaoFila({ listas, cards, entradas, agoraMs, filtro = "" }) {
  const ids = (parte, exceto) => new Set(listas.filter((l) => norm(l.name).includes(parte) && !(exceto && norm(l.name).includes(exceto))).map((l) => l.id));
  const col = ids("colagem"), ret = ids("retirada", "pronto"), gra = ids("grafica");
  const ordem = { colagem: 0, retirada: 1, grafica: 2 }, itens = [];
  for (const c of cards) {
    const info = lerCard(c), ent0 = entradas[c.id] ?? agoraMs;
    let origem, ent, entra;
    if (col.has(c.idList)) { origem = "colagem"; ent = ent0; }
    else if (ret.has(c.idList)) { origem = "retirada"; ent = Math.max(ent0, agoraMs); }
    else if (gra.has(c.idList)) { origem = "grafica"; entra = info.previsaoMs || pegadaGrafica(ent0, info, agoraMs); ent = Math.max(entra, agoraMs); }
    else continue;
    const paginas = info.paginas || Math.max(1, Math.ceil(info.slots / 18)), min = minutosColagem(info.slotsPrazo ?? info.slots);
    itens.push({ info, origem, ent, min, paginas });
  }
  itens.sort((a, b) => a.ent - b.ent || ordem[a.origem] - ordem[b.origem] || a.info.cliente.localeCompare(b.info.cliente, "pt-BR", { numeric: true }));
  const simular = (janela) => {
    const livres = Array.from({ length: Math.max(1, COLADORES) }, () => 0), r = new Map();
    for (const it of itens) {
      const k = livres.indexOf(Math.min(...livres)), inicio = Math.max(it.ent, livres[k]), fim = somarUtil(inicio, it.min, janela);
      r.set(it, { comeca: inicioJanela(inicio, janela), fim });
      livres[k] = it.origem === "colagem" ? Math.max(fim, agoraMs) : fim;
    }
    return { r, livre: Math.min(...livres) };
  };
  const sem = simular(COLADOR), com = simular(COLADOR_COM_DOMINGO);
  const horas = (min) => String(min / 60).replace(".", ",");
  const f = norm(filtro).trim();
  const quer = (it) => !f || norm(`${it.info.cliente} ${it.info.nomeCliente}`).includes(f);
  const secao = (titulo, origem) => {
    const doGrupo = itens.filter((i) => i.origem === origem && quer(i));
    if (!doGrupo.length) return [];
    return ["", `*${titulo} (${doGrupo.length}):*`, ...doGrupo.map((i) => {
      const a = sem.r.get(i), b = com.r.get(i);
      const entra = origem === "grafica" ? `retirada prevista ${fmtDiaHora(i.ent)}, ` : origem === "retirada" ? "entra já, " : "";
      return `- ${i.info.cliente} - ${i.paginas} páginas (${horas(i.min)} h) - ${entra}colagem de ${fmtDiaHora(a.comeca)} até *${fmtDiaHora(a.fim)}* (com domingo: ${a.fim === b.fim && a.comeca === b.comeca ? "igual" : `${fmtDiaHora(b.comeca)} até ${fmtDiaHora(b.fim)}`})`;
    })];
  };
  const saida = [`*Previsão da fila de colagem* (agora ${fmtDiaHora(agoraMs)})`, `_Colador: segunda a sábado, 10h às 23h, almoço 13h às 15h, meia hora por página${COLADORES > 1 ? `, ${COLADORES} coladores` : ""}. Domingo é folga facultativa: sempre as duas contas (sem domingo e com domingo)._`,
    ...secao("Na Colagem agora", "colagem"), ...secao("Em Retirada (vão entrar na Colagem)", "retirada"), ...secao("Na Gráfica (entram na retirada prevista)", "grafica")];
  if (!itens.length) saida.push("", "Nenhum pedido na fila (Colagem, Retirada ou Gráfica).");
  else if (f && !itens.some(quer)) saida.push("", `Nenhum pedido encontrado para "${filtro.trim()}".`);
  if (itens.length) saida.push("", `*Colador livre depois do último pedido:* ${fmtDiaHora(Math.max(sem.livre, agoraMs))} (com domingo: ${Math.max(com.livre, agoraMs) === Math.max(sem.livre, agoraMs) ? "igual" : fmtDiaHora(Math.max(com.livre, agoraMs))}).`);
  return saida.join("\n");
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
export function avisoMovimento({ cardNome, de, para, card, previsao, irmaos, agoraMs }) { // previsao: linha "Rótulo: data" ou null
  const info = lerCard(card || { name: cardNome, desc: "" });
  const dados = descricaoParaAviso(card?.desc, previsao);
  const texto = `*PEDIDO MOVIDO:* ${info.cliente}${info.slots ? ` · ${info.slots} slots` : ""}\nDe _${de}_ para _${para}_.` + (dados ? `\n\n_Dados do pedido:_\n${dados}` : "");
  const botoes = [];
  const tipo = tipoMsgCliente(para);
  if (tipo) {
    // todos os pedidos do mesmo cliente que estão na coluna de destino (o que acabou de entrar sempre conta, mesmo se o Trello ainda não o listar)
    const mesmo = (c) => norm(lerCard(c).nomeCliente) === norm(info.nomeCliente);
    const outros = (irmaos || []).filter((c) => c.id !== (card && card.id) && mesmo(c));
    const msg = mensagemCliente(tipo, [card || { name: cardNome, desc: "" }, ...outros], agoraMs ?? Date.now());
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
    ...(txt(b.nomeCliente, 80) ? [`Nome do cliente: ${txt(b.nomeCliente, 80)}`] : []),
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
