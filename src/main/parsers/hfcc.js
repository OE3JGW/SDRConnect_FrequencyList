'use strict';

const fs = require('fs');
const { kHzToHz, clean, splitCsvLine, makeRow } = require('./util');

/** HFCC seasonal broadcast schedule exports (CSV/fixed). */
function isHfccContent(text, filePath = '') {
  const lower = filePath.toLowerCase();
  if (lower.includes('hfcc')) return true;
  const head = text.slice(0, 3000).toLowerCase();
  return head.includes('hfcc') || (head.includes('freq') && head.includes('site') && head.includes('ciraf'));
}

function parseHfcc(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) throw new Error('Empty HFCC file');

  const delim = lines[0].includes(';') ? ';' : lines[0].includes('\t') ? '\t' : ',';
  let start = 0;
  let columns;
  const first = splitCsvLine(lines[0], delim).map(clean);

  if (first.some((c) => /freq|khz|administration|broadcaster/i.test(c))) {
    columns = first.map((c, i) => c || `COL${i}`);
    start = 1;
  } else {
    columns = [
      'FREQ',
      'START',
      'STOP',
      'CIRAF',
      'LOC',
      'POWER',
      'AZI',
      'ANT',
      'DAYS',
      'LANGUAGE',
      'ADMIN',
      'BROADCASTER',
      'REMARKS'
    ];
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
    rows.push(makeRow(`hfcc-${i}`, kHzToHz(freqRaw), fields));
  }
  return { type: 'hfcc', columns, rows };
}

module.exports = { parseHfcc, isHfccContent };
