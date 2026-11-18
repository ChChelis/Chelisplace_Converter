// Cálculo de prazos em horário útil (America/Sao_Paulo, UTC-3 fixo, sem horário de verão).
// Funções puras: sem rede, sem segredos.
const DESLOC = -3 * 3600e3;
const MIN = 60e3;

export const EXPEDIENTE = { ini: 10 * 60, fim: 17 * 60 }; // 10h–17h
export const GRAFICA = { ini: 9 * 60, fim: 18 * 60 }; // 9h–18h

// "relógio local" como um Date em UTC (getUTC* devolve a hora de Brasília)
const local = (ms) => new Date(ms + DESLOC);
const util = (d) => d.getUTCDay() >= 1 && d.getUTCDay() <= 5;
const minDia = (d) => d.getUTCHours() * 60 + d.getUTCMinutes();

// Soma `minutos` de tempo útil (dentro da janela, seg–sex) a partir de `inicioMs`.
export function somarUtil(inicioMs, minutos, janela = EXPEDIENTE) {
  let t = local(inicioMs).getTime();
  let resta = Math.ceil(minutos);
  for (let i = 0; i < 3650; i++) {
    const d = new Date(t);
    const m = minDia(d);
    if (!util(d) || m >= janela.fim) {
      const prox = new Date(t);
      prox.setUTCDate(prox.getUTCDate() + 1);
      prox.setUTCHours(0, janela.ini, 0, 0);
      t = prox.getTime();
      continue;
    }
    if (m < janela.ini) { t += (janela.ini - m) * MIN; continue; }
    const cabe = janela.fim - m;
    if (resta <= cabe) return t + resta * MIN - DESLOC;
    resta -= cabe;
    t += cabe * MIN;
  }
  throw new Error("prazo fora do alcance");
}

// Prazo (em minutos úteis) por coluna. `slots` só importa para Colagem.
export function regraDaColuna(nome, slots = 0) {
  const n = nome.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  if (n.includes("novo")) return { min: 7 * 60, janela: EXPEDIENTE };
  if (n.includes("montagem")) return { min: 7 * 60, janela: EXPEDIENTE };
  if (n.includes("grafica")) return { min: 3 * 9 * 60, janela: GRAFICA }; // 3 dias úteis
  if (n.includes("retirada")) return { min: 7 * 60, janela: EXPEDIENTE };
  if (n.includes("colagem")) return { min: 3 * 60 * Math.max(1, Math.ceil(slots / 108)), janela: EXPEDIENTE };
  return null; // Pronto para entrega, Finalizado: sem prazo
}

export function prazoFinal(coluna, entradaMs, slots = 0) {
  const r = regraDaColuna(coluna, slots);
  return r ? somarUtil(entradaMs, r.min, r.janela) : null;
}

export function atrasado(coluna, entradaMs, agoraMs, slots = 0) {
  const p = prazoFinal(coluna, entradaMs, slots);
  return p !== null && agoraMs > p;
}
