'use strict';

const fs = require('fs');
const { kHzToHz, clean, splitCsvLine, makeRow } = require('./util');

/** AM/FMLIST / Classaxe-style or userlist exports. */
function isFmlistContent(text, filePath = '') {
  const lower = filePath.toLowerCase();
  if (lower.includes('fmlist') || lower.includes('amlist') || lower.includes('userlistfm') || lower.includes('userlistam')) {
    return true;
  }
  const head = text.slice(0, 2000).toLowerCase();
  return head.includes('fmlist') || head.includes('amlist') || (head.includes('psd') && head.includes('pi'));
}

function parseFmlist(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) throw new Error('Empty AM/FMLIST file');

  const delim = lines[0].includes(';') ? ';' : lines[0].includes('\t') ? '\t' : ',';
  let start = 0;
  let columns;
  const first = splitCsvLine(lines[0], delim).map(clean);

  if (first.some((c) => /freq|khz|mhz|station|pi/i.test(c))) {
    columns = first.map((c, i) => c || `COL${i}`);
    start = 1;
  } else {
    columns = ['FREQ', 'STATION', 'PI', 'PS', 'COUNTRY', 'LOCATION', 'LAT', 'LON', 'POWER', 'REMARKS'];
  }

  const freqIdx = columns.findIndex((c) => /freq|khz|mhz/i.test(c));
  const rows = [];

  for (let i = start; i < lines.length; i++) {
    const parts = splitCsvLine(lines[i], delim);
    if (parts.length < 2) continue;
    const fields = {};
    for (let c = 0; c < columns.length; c++) fields[columns[c]] = clean(parts[c] || '');
    const freqRaw = freqIdx >= 0 ? fields[columns[freqIdx]] : parts[0];
    if (!/^\d/.test(String(freqRaw))) continue;
    const n = Number(String(freqRaw).replace(',', '.'));
    if (!Number.isFinite(n) || n <= 0) continue;
    // FM values like 88.5 are MHz; SW/AM lists in kHz are typically >= 30 or integers like 531
    const colIsMhz = freqIdx >= 0 && /mhz/i.test(columns[freqIdx]);
    const hz = colIsMhz || (n > 30 && n < 300 && String(freqRaw).includes('.')) ? Math.round(n * 1e6) : Math.round(n * 1e3);
    rows.push(makeRow(`fmlist-${i}`, hz, fields));
  }

  const type = /am/i.test(filePath) && !/fm/i.test(filePath) ? 'amlist' : 'fmlist';
  return { type, columns, rows };
}

module.exports = { parseFmlist, isFmlistContent };
