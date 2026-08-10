'use strict';

const fs = require('fs');
const { kHzToHz, formatFreqKHz, formatYearMonth, clean, splitCsvLine, makeRow } = require('./util');

const NUMBERS_COLUMNS = ['FREQ', 'DATE', 'UTC', 'DAYS', 'Call / Type', 'MODE', 'DETAILS'];

function isNumbersContent(text, filePath = '') {
  const lower = filePath.toLowerCase();
  if (lower.includes('numbers') || lower.includes('oddities') || lower.includes('userlistno')) return true;
  const head = text.slice(0, 2000).toLowerCase();
  return head.includes('numbers & oddities') || head.includes('numbersoddities') || head.includes('n&o');
}

function parseNumbers(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) throw new Error('Empty Numbers & Oddities file');

  const delim = lines[0].includes(';') ? ';' : ',';
  let start = 0;
  const first = splitCsvLine(lines[0], delim).map(clean);
  const hasHeader = first.some((c) => /freq|khz|station|mode|code|ctrb/i.test(c));
  if (hasHeader) start = 1;

  const lower = first.map((c) => c.toLowerCase());
  const idx = (names) => lower.findIndex((c) => names.includes(c));
  const iFreq = hasHeader ? idx(['freq', 'khz', 'frequency']) : 0;
  const iDate = hasHeader ? idx(['date']) : 1;
  const iUtc = hasHeader ? idx(['utc', 'time']) : 2;
  const iDay = hasHeader ? idx(['day', 'days']) : 3;
  const iCode = hasHeader ? idx(['code', 'call']) : 4;
  const iMode = hasHeader ? idx(['mode']) : 5;
  const iDetails = hasHeader ? idx(['details', 'notes', 'remarks']) : 6;

  const get = (parts, i) => (i >= 0 ? clean(parts[i] || '') : '');

  const rows = [];
  for (let i = start; i < lines.length; i++) {
    const parts = splitCsvLine(lines[i], delim);
    if (parts.length < 2) continue;
    const freqRaw = get(parts, iFreq) || parts[0];
    if (!/^\d/.test(String(freqRaw))) continue;
    const fields = {
      FREQ: formatFreqKHz(freqRaw),
      DATE: formatYearMonth(get(parts, iDate)),
      UTC: get(parts, iUtc),
      DAYS: get(parts, iDay),
      'Call / Type': get(parts, iCode),
      MODE: get(parts, iMode),
      DETAILS: get(parts, iDetails)
    };
    rows.push(makeRow(`no-${i}`, kHzToHz(freqRaw), fields));
  }
  return { type: 'numbers', columns: [...NUMBERS_COLUMNS], rows };
}

module.exports = { parseNumbers, isNumbersContent, NUMBERS_COLUMNS };
