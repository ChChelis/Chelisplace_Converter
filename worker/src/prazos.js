// Cálculo de prazos em horário útil (America/Sao_Paulo, UTC-3 fixo, sem horário de verão).
// Funções puras: sem rede, sem segredos. Fins de semana e feriados nacionais não contam.
const DESLOC = -3 * 3600e3;
const MIN = 60e3;
import { ehFeriado } from "./feriados.js";

export const EXPEDIENTE = { ini: 10 * 60, fim: 17 * 60 }; // 10h–17h
export const GRAFICA = { ini: 9 * 60, fim: 18 * 60 }; // 9h–18h

// "relógio local" como um Date em UTC (getUTC* devolve a hora de Brasília)
const local = (ms) => new Date(ms + DESLOC);
export const diaUtil = (d) => d.getUTCDay() >= 1 && d.getUTCDay() <= 5 && !ehFeriado(d); // seg–sex, sem feriado nacional
const util = diaUtil;
const minDia = (d) => d.getUTCHours() * 60 + d.getUTCMinutes();

// Janela do colador: 10h–23h com 2h de almoço (13h–15h, suposição a corrigir pelo Chelis).
export const COLADOR = { seg: [{ ini: 10 * 60, fim: 13 * 60 }, { ini: 15 * 60, fim: 23 * 60 }] };

const proxDiaUtil = (dia) => { // dia: Date em "relógio local" à meia-noite
  const d = new Date(dia);
  do d.setUTCDate(d.getUTCDate() + 1); while (!util(d));
  return d;
};
const meiaNoite = (d) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
const noDia = (dia, minuto) => dia.getTime() + minuto * MIN - DESLOC; // epoch real de "dia às minuto"

// Soma `minutos` de tempo útil (dentro da janela ou das janelas {seg:[...]}, seg–sex) a partir de `inicioMs`.
export function somarUtil(inicioMs, minutos, janela = EXPEDIENTE) {
  const segs = janela.seg || [{ ini: janela.ini, fim: janela.fim }];
  let t = local(inicioMs).getTime();
  let resta = Math.ceil(minutos);
  for (let i = 0; i < 3650; i++) {
    const d = new Date(t);
    const m = minDia(d);
    const seg = util(d) ? segs.find((x) => m < x.fim) : null;
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
  if (!util(dia) || minDia(l) >= GRAFICA.fim) dia = proxDiaUtil(dia);
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

// Minutos de colagem pelo tamanho do pedido: 3h a cada 108 slots (arredondando para cima).
export const minutosColagem = (slots) => 3 * 60 * Math.max(1, Math.ceil(slots / 108));

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
