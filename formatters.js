// =====================================================================
// shared/js/formatters.js
// Formatação de moeda (binacional BRL/PYG) e datas (pt-BR / es-PY).
// A moeda exibida depende SEMPRE da filial (pais/moeda_principal/...),
// nunca de uma configuração global — cada unidade pode ter um contexto
// monetário diferente.
// =====================================================================

const LOCALE_POR_MOEDA = {
  BRL: 'pt-BR',
  PYG: 'es-PY',
  USD: 'en-US',
};

/**
 * Formata um valor numérico em uma moeda específica.
 * PYG não usa casas decimais (é a convenção local).
 */
export function formatMoney(valor, moeda) {
  const locale = LOCALE_POR_MOEDA[moeda] || 'pt-BR';
  const fractionDigits = moeda === 'PYG' ? 0 : 2;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: moeda,
    minimumFractionDigits: fractionDigits,
    maximumFractionDigits: fractionDigits,
  }).format(valor);
}

/**
 * Formata o preço de um item considerando a configuração de moeda da filial.
 * Se a filial aceita moeda secundária, mostra "principal (≈ secundária)".
 *
 * @param {number} valor - valor no padrão da moeda principal da filial
 * @param {object} filial - registro de `filiais` (pais, moeda_principal, aceita_moeda_secundaria, moeda_secundaria, taxa_cambio_secundaria)
 */
export function formatPrecoFilial(valor, filial) {
  if (!filial) return formatMoney(valor, 'BRL');

  const principal = formatMoney(valor, filial.moeda_principal);

  if (!filial.aceita_moeda_secundaria || !filial.moeda_secundaria || !filial.taxa_cambio_secundaria) {
    return principal;
  }

  const valorSecundario = valor * Number(filial.taxa_cambio_secundaria);
  const secundario = formatMoney(valorSecundario, filial.moeda_secundaria);
  return `${principal} (≈ ${secundario})`;
}

/**
 * Formata data/hora conforme o país da filial (pt-BR para BR, es-PY para PY).
 */
export function formatDateTime(data, filial) {
  const locale = filial?.pais === 'PY' ? 'es-PY' : 'pt-BR';
  const tz = filial?.timezone || 'America/Asuncion';
  return new Intl.DateTimeFormat(locale, {
    timeZone: tz,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(data));
}

export function formatTime(data, filial) {
  const locale = filial?.pais === 'PY' ? 'es-PY' : 'pt-BR';
  const tz = filial?.timezone || 'America/Asuncion';
  return new Intl.DateTimeFormat(locale, {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(data));
}

export function formatDateLong(data, filial) {
  const locale = filial?.pais === 'PY' ? 'es-PY' : 'pt-BR';
  const tz = filial?.timezone || 'America/Asuncion';
  return new Intl.DateTimeFormat(locale, {
    timeZone: tz,
    weekday: 'long',
    day: '2-digit',
    month: 'long',
  }).format(new Date(data));
}

/**
 * Converte uma data/hora "de parede" (YYYY-MM-DD + HH:MM) NO TIMEZONE DA
 * FILIAL para um Date UTC correto — essencial no contexto Brasil↔Paraguai,
 * onde o navegador do cliente pode estar em outro fuso que o da unidade.
 *
 * Truque: cria um instante UTC "ingênuo" com os mesmos dígitos, descobre
 * a diferença entre como esse instante aparece em UTC vs. no timezone alvo,
 * e aplica essa diferença. Testado para PY/BR (ambos UTC-3, sem DST) e
 * virada de dia.
 */
export function zonedTimeToUtc(dataStr, horaStr, timeZone) {
  const naiveUTC = new Date(`${dataStr}T${horaStr}:00Z`);
  const tzString = naiveUTC.toLocaleString('en-US', { timeZone });
  const utcString = naiveUTC.toLocaleString('en-US', { timeZone: 'UTC' });
  const diff = new Date(utcString) - new Date(tzString);
  return new Date(naiveUTC.getTime() + diff);
}

/** Data de "hoje" (YYYY-MM-DD) no timezone informado. */
export function hojeNaZona(timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}

/** Soma `dias` a uma string YYYY-MM-DD, retornando outra string YYYY-MM-DD. */
export function adicionarDiasISO(dataISO, dias) {
  const [ano, mes, dia] = dataISO.split('-').map(Number);
  const d = new Date(ano, mes - 1, dia);
  d.setDate(d.getDate() + dias);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Dia da semana (0=domingo..6=sábado) de uma string YYYY-MM-DD (independe de timezone). */
export function diaSemanaISO(dataISO) {
  const [ano, mes, dia] = dataISO.split('-').map(Number);
  return new Date(ano, mes - 1, dia).getDay();
}
export function horaMinutoNaFilial(dataISO, filial) {
  const tz = filial?.timezone || 'America/Asuncion';
  const partes = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date(dataISO));
  const hora = Number(partes.find((p) => p.type === 'hour')?.value ?? 0);
  const minuto = Number(partes.find((p) => p.type === 'minute')?.value ?? 0);
  return { hora: hora === 24 ? 0 : hora, minuto };
}

/**
 * Converte um valor de input <input type="datetime-local"> (string local,
 * sem timezone) em um Date correto para o timezone da filial.
 * Necessário porque o navegador interpreta datetime-local como horário local
 * do dispositivo, que pode não ser o mesmo da filial (ex: admin acessando de outro país).
 */
export function localInputParaISO(valorInput) {
  // valorInput: "2026-06-20T09:00"
  return new Date(valorInput).toISOString();
}
