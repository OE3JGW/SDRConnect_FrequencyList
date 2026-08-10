'use strict';

/** Shared helpers for frequency-list parsers. */

function kHzToHz(value) {
  const n = Number(String(value).trim().replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round(n * 1000);
}

/** Display frequency as kHz with 3 decimal places, e.g. 3450.500 */
function formatFreqKHz(raw) {
  const n = Number(String(raw ?? '').trim().replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return '';
  return n.toFixed(3);
}

/** Normalize dates toward YYYY/MM when possible. */
function formatYearMonth(raw) {
  const text = clean(raw);
  if (!text) return '';
  // YYMM (ILG YEAR)
  if (/^\d{4}$/.test(text) && Number(text.slice(2)) <= 12) {
    const yy = Number(text.slice(0, 2));
    const mm = text.slice(2, 4);
    const full = yy >= 70 ? 1900 + yy : 2000 + yy;
    return `${full}/${mm}`;
  }
  // YYYY-MM-DD or YYYY/MM/DD
  let m = text.match(/^(\d{4})[-/.](\d{1,2})(?:[-/.]\d{1,2})?/);
  if (m) return `${m[1]}/${m[2].padStart(2, '0')}`;
  // D-M-YYYY or D/M/YYYY
  m = text.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (m) return `${m[3]}/${m[2].padStart(2, '0')}`;
  return text;
}

function clean(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/\s+/g, ' ').trim();
}

function splitCsvLine(line, delimiter = ',') {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delimiter) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

function makeRow(id, freqHz, fields) {
  return { id, freqHz, fields };
}

function mapMode(raw) {
  const t = clean(raw).toUpperCase();
  if (!t) return null;
  if (t === 'AM' || t.includes('AM')) return 'AM';
  if (t === 'SAM') return 'SAM';
  if (t === 'USB' || t.includes('USB')) return 'USB';
  if (t === 'LSB' || t.includes('LSB')) return 'LSB';
  if (t === 'CW' || t.includes('CW') || t.includes('MORSE')) return 'CW';
  if (t === 'NFM' || t === 'FM' || t.includes('NFM')) return 'NFM';
  if (t === 'WFM' || t.includes('WFM')) return 'WFM';
  return null;
}

module.exports = { kHzToHz, formatFreqKHz, formatYearMonth, clean, splitCsvLine, makeRow, mapMode };
