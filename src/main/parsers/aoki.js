'use strict';

const fs = require('fs');
const { kHzToHz, clean, splitCsvLine, makeRow } = require('./util');

/** AOKI/Nagoya — often semicolon or comma schedules. */
function isAokiContent(text, filePath = '') {
  const lower = filePath.toLowerCase();
  if (lower.includes('aoki') || lower.includes('nagoya')) return true;
  const head = text.slice(0, 2000).toLowerCase();
  return head.includes('aoki') || head.includes('nagoya') || head.includes('nds.saito');
}

function parseAoki(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) throw new Error('Empty AOKI file');

  const delim = lines[0].includes(';') ? ';' : lines[0].includes('\t') ? '\t' : ',';
  let start = 0;
  let columns;
  const first = splitCsvLine(lines[0], delim).map(clean);
  if (first.some((c) => /freq|khz|station|time/i.test(c))) {
    columns = first.map((c, i) => c || `COL${i}`);
    start = 1;
  } else {
    // Common AOKI-like layout without header
    columns = ['FREQ', 'START', 'STOP', 'CIRAF', 'LOC', 'POWER', 'AZI', 'STATION', 'LANGUAGE', 'REMARKS'];
  }

  const freqIdx = columns.findIndex((c) => /freq|khz/i.test(c));
  const rows = [];
  for (let i = start; i < lines.length; i++) {
    const parts = splitCsvLine(lines[i], delim);
    if (parts.length < 2) continue;
    const fields = {};
    for (let c = 0; c < columns.length; c++) fields[columns[c]] = clean(parts[c] || '');
    const freqRaw = freqIdx >= 0 ? fields[columns[freqIdx]] : parts[0];
    if (!/^\d/.test(String(freqRaw))) continue;
    rows.push(makeRow(`aoki-${i}`, kHzToHz(freqRaw), fields));
  }
  return { type: 'aoki', columns, rows };
}

module.exports = { parseAoki, isAokiContent };
