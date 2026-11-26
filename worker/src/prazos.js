// Cálculo de prazos em horário útil (America/Sao_Paulo, UTC-3 fixo, sem horário de verão).
// Funções puras: sem rede, sem segredos. Fins de semana e feriados nacionais não contam.
const DESLOC = -3 * 3600e3;
const MIN = 60e3;
import { ehFeriado, chaveData } from "./feriados.js";

export const EXPEDIENTE = { ini: 10 * 60, fim: 17 * 60 }; // 10h–17h
export const GRAFICA = { ini: 9 * 60, fim: 18 * 60 }; // 9h–18h (fim = prazo de atraso)
export const CORTE_GRAFICA = 17 * 60; // entrada até 17h conta como dia 1; depois das 17h, o dia 1 é o dia útil seguinte

// "relógio local" como um Date em UTC (getUTC* devolve a hora de Brasília)
const local = (ms) => new Date(ms + DESLOC);
export const diaUtil = (d) => d.getUTCDay() >= 1 && d.getUTCDay() <= 5 && !ehFeriado(d); // seg–sex, sem feriado nacional
const util = diaUtil;
const minDia = (d) => d.getUTCHours() * 60 + d.getUTCMinutes();

// Janela do colador: 10h–23h com 2h de almoço (13h–15h), confirmada pelo Chelis.
// Quantos coladores trabalham ao mesmo tempo (hoje 1). Com mais de um, cada pedido da fila vai para o primeiro que ficar livre.
export const COLADORES = 1;
// Dias de trabalho do colador: segunda a sábado (feriado nacional não conta); o domingo é folga facultativa, então há sempre duas contas:
// COLADOR (sem domingo) e COLADOR_COM_DOMINGO (se ele topar trabalhar no domingo). Dias da semana como em Date#getUTCDay (0 = domingo).
const TURNOS_COLADOR = [{ ini: 10 * 60, fim: 13 * 60 }, { ini: 15 * 60, fim: 23 * 60 }];   // 10h–23h, almoço 13h–15h
export const COLADOR = { seg: TURNOS_COLADOR, dias: [1, 2, 3, 4, 5, 6] };
export const COLADOR_COM_DOMINGO = { seg: TURNOS_COLADOR, dias: [0, 1, 2, 3, 4, 5, 6] };

const proxDiaUtil = (dia) => { // dia: Date em "relógio local" à meia-noite
  const d = new Date(dia);
  do d.setUTCDate(d.getUTCDate() + 1); while (!util(d));
  return d;
};
const meiaNoite = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const noDia = (dia, minuto) => dia.getTime() + minuto * MIN - DESLOC; // epoch real de "dia às minuto"

// Soma `minutos` de tempo útil (dentro da janela ou das janelas {seg:[...]}; dias úteis seg–sex, ou os `dias` da janela) a partir de `inicioMs`.
export function somarUtil(inicioMs, minutos, janela = EXPEDIENTE) {
  const segs = janela.seg || [{ ini: janela.ini, fim: janela.fim }];
  let t = local(inicioMs).getTime();
  let resta = Math.ceil(minutos);
  for (let i = 0; i < 3650; i++) {
    const d = new Date(t);
    const m = minDia(d);
    const diaOk = janela.dias ? janela.dias.includes(d.getUTCDay()) && !ehFeriado(d) : util(d);
    const seg = diaOk ? segs.find((x) => m < x.fim) : null;
    if (!seg) {
      const prox = new Date(t);
      prox.setUTCDate(prox.getUTCDate() + 1);
      prox.setUTCHours(0, segs[0].ini, 0, 0);
      t = prox.getTime();
      continue;
    }
    if (m < seg.ini) { t += (seg.ini - m) * MIN; continue; }
    const cabe = seg.fim - m;
    if (resta <= cabe) return t + resta * MIN - DESLOC;
    resta -= cabe;
    t += cabe * MIN;
  }
  throw new Error("prazo fora do alcance");
}

// Fim do n-ésimo dia útil contando o dia de entrada como dia 1 (se entrou depois do fechamento da gráfica
// ou fora de dia útil, o dia 1 é o próximo dia útil). Devolve esse dia às `minutoFim`.
export function fimDiaUtil(inicioMs, n, minutoFim) {
  const l = local(inicioMs);
  let dia = meiaNoite(l);
  if (!util(dia) || minDia(l) >= CORTE_GRAFICA) dia = proxDiaUtil(dia);
  for (let i = 1; i < n; i++) dia = proxDiaUtil(dia);
  return noDia(dia, minutoFim);
}

// Primeiro instante dentro do expediente da loja (10h–17h, dia útil) a partir de `ms`: o mesmo expediente ou o seguinte.
export function alinharLoja(ms) {
  const l = local(ms), dia = meiaNoite(l), m = minDia(l);
  if (util(dia) && m >= EXPEDIENTE.ini && m <= EXPEDIENTE.fim) return ms;
  if (util(dia) && m < EXPEDIENTE.ini) return noDia(dia, EXPEDIENTE.ini);
  return noDia(proxDiaUtil(dia), EXPEDIENTE.ini);
}

// Minutos de colagem: meia hora por página inteira de 18 (3 h por kit de 6 páginas), sem arredondar para o kit; o mesmo número que a mensagem ao cliente informa.
export const minutosColagem = (slots) => 30 * Math.max(1, Math.ceil(slots / 18));

// Primeiro instante em que o colador pode trabalhar a partir de `ms` (dentro da janela, em dia de trabalho da janela).
export function inicioJanela(ms, janela = COLADOR) { return somarUtil(ms, 1, janela) - MIN; }

// Prazo por coluna. Gráfica: 3 dias úteis (entrada = dia 1) até 18h. Colagem: tamanho do pedido, janela do colador.
export function regraDaColuna(nome, slots = 0) {
  const n = nome.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (n.includes("novo")) return { min: 7 * 60, janela: EXPEDIENTE };
  if (n.includes("montagem")) return { min: 7 * 60, janela: EXPEDIENTE };
  if (n.includes("grafica")) return { dias: 3 };
  if (n.includes("retirada")) return { min: 7 * 60, janela: EXPEDIENTE };
  if (n.includes("colagem")) return { min: minutosColagem(slots), janela: COLADOR };
  return null; // Pronto para entrega, Finalizado: sem prazo
}

export function prazoFinal(coluna, entradaMs, slots = 0) {
  const r = regraDaColuna(coluna, slots);
  if (!r) return null;
  if (r.dias) return fimDiaUtil(entradaMs, r.dias, GRAFICA.fim);
  return somarUtil(entradaMs, r.min, r.janela);
}

export function atrasado(coluna, entradaMs, agoraMs, slots = 0) {
  const p = prazoFinal(coluna, entradaMs, slots);
  return p !== null && agoraMs > p;
}

// Chave "AAAA-MM-DD" (Brasília) do dia de `ms` e do próximo dia útil depois dele.
export const chaveDia = (ms) => chaveData(local(ms));
export const chaveProximoDiaUtil = (ms) => chaveData(proxDiaUtil(meiaNoite(local(ms))));

// Dia útil anterior ao de `ms`, às 17h (fim do expediente da loja): momento do aviso de véspera.
export function diaUtilAnterior17(ms) {
  const dia = meiaNoite(local(ms));
  do dia.setUTCDate(dia.getUTCDate() - 1); while (!util(dia));
  return noDia(dia, EXPEDIENTE.fim);
}
