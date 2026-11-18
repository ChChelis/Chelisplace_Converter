// Feriados nacionais do Brasil (chave "AAAA-MM-DD"): fixos + Sexta-feira Santa.
// Carnaval e Corpus Christi são ponto facultativo e não entram.
export function feriadosNacionais(ano) {
  const fx = [[1, 1], [4, 21], [5, 1], [9, 7], [10, 12], [11, 2], [11, 15], [12, 25]];
  if (ano >= 2024) fx.push([11, 20]); // Consciência Negra (nacional desde 2024)
  const p2 = (n) => String(n).padStart(2, "0");
  const set = new Set(fx.map(([m, d]) => `${ano}-${p2(m)}-${p2(d)}`));
  // Páscoa (algoritmo de Meeus/Jones/Butcher) -> Sexta-feira Santa = Páscoa - 2 dias
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
  const sexta = new Date(Date.UTC(ano, mes - 1, dia - 2));
  set.add(`${sexta.getUTCFullYear()}-${p2(sexta.getUTCMonth() + 1)}-${p2(sexta.getUTCDate())}`);
  return set;
}

export const chaveData = (d) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
export const ehFeriado = (d) => feriadosNacionais(d.getUTCFullYear()).has(chaveData(d));
