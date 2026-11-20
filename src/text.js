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

module.exports = { normalizeAnswer, startsWithLetter, cleanText };
