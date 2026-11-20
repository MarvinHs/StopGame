'use strict';

// Marca temporal para que la Ñ sobreviva cuando quitamos las tildes.
const ENYE_MARK = '\u0001';

/**
 * Normaliza una respuesta para compararla con las de los demás:
 * minúsculas, sin tildes (pero conservando la ñ), sin signos y con
 * espacios simples. "  México!! " -> "mexico", "Ñame" -> "ñame".
 */
function normalizeAnswer(text) {
  return String(text ?? '')
    .normalize('NFC')
    .toLowerCase()
    .replace(/ñ/g, ENYE_MARK)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(new RegExp(ENYE_MARK, 'g'), 'ñ')
    .replace(/[^a-zñ0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** ¿La respuesta empieza con la letra de la ronda? (acepta texto normalizado o no) */
function startsWithLetter(text, letter) {
  const normalized = normalizeAnswer(text);
  if (!normalized || !letter) return false;
  return normalized.startsWith(normalizeAnswer(letter));
}

/** Limpia texto libre que viene del navegador: sin saltos de línea ni controles, recortado. */
function cleanText(text, maxLength) {
  return String(text ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

/** Forma "base" para comparar: sin espacios, sin letras dobles y sin plural. */
function canonical(normalized) {
  let c = String(normalized || '').replace(/ /g, '').replace(/(.)\1+/g, '$1');
  if (c.length > 4 && c.endsWith('es')) c = c.slice(0, -2);
  else if (c.length > 3 && c.endsWith('s')) c = c.slice(0, -1);
  return c;
}

/** Distancia de edición (cuántas letras hay que cambiar, quitar o poner). */
function editDistance(a, b) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > 2) return 99;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/**
 * ¿Dos respuestas (ya normalizadas) son prácticamente la misma?
 * "oso" = "osos", "ana" = "anna", "lapiz" = "lapices", "guayava" = "guayaba".
 */
function areSimilar(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;
  const ca = canonical(a);
  const cb = canonical(b);
  if (ca === cb) return true;
  return Math.min(ca.length, cb.length) >= 6 && editDistance(ca, cb) <= 1;
}

module.exports = { normalizeAnswer, startsWithLetter, cleanText, canonical, editDistance, areSimilar };
