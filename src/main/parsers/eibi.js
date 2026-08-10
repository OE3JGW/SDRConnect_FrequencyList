'use strict';

const fs = require('fs');
const { kHzToHz, formatFreqKHz, clean, splitCsvLine, makeRow } = require('./util');

const EIBI_CSV_COLUMNS = ['FREQ', 'UTC', 'DAYS', 'ITU', 'STATION', 'LANGUAGE', 'TXSITE', 'PERSIST', 'STARTDATE', 'ENDDATE'];
const EIBI_TXT_COLUMNS = ['FREQ', 'UTC', 'DAYS', 'ITU', 'STATION', 'LANGUAGE', 'REMARKS'];

function isEibiCsvContent(text) {
  const line = text.split(/\r?\n/).find((l) => l.trim() && !l.startsWith('#')) || '';
  const parts = line.split(';');
  return parts.length >= 8 && /^\d+(\.\d+)?$/.test(parts[0].trim());
}

function isEibiTxtContent(text) {
  return /kHz\s+Time\(UTC\)/i.test(text) || /eibispace\.de/i.test(text) || /FREQUENCY VERSION/i.test(text);
}

function parseEibiCsv(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const rows = [];
  const lines = text.split(/\r?\n/);
  let idx = 0;
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const parts = splitCsvLine(trimmed, ';');
    if (parts.length < 5) continue;
    if (!/^\d/.test(parts[0].trim())) continue;
    // CSV layout: FREQ;UTC;DAYS;ITU;STATION;LANGUAGE;TARGET;TXSITE;PERSIST;START;END
    const fields = {
      FREQ: formatFreqKHz(parts[0]),
      UTC: clean(parts[1]),
      DAYS: clean(parts[2]),
      ITU: clean(parts[3]),
      STATION: clean(parts[4]),
      LANGUAGE: clean(parts[5]),
      TXSITE: clean(parts[7]),
      PERSIST: clean(parts[8]),
      STARTDATE: clean(parts[9]),
      ENDDATE: clean(parts[10])
    };
    const freqHz = kHzToHz(parts[0]);
    rows.push(makeRow(`eibi-csv-${idx++}`, freqHz, fields));
  }
  return { type: 'eibi-csv', columns: [...EIBI_CSV_COLUMNS], rows };
}

function parseEibiTxt(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.split(/\r?\n/);
  const rows = [];
  let started = false;
  let idx = 0;

  for (const rawLine of lines) {
    const line = rawLine.replace(/\r$/, '');
    if (/^={5,}/.test(line.trim())) {
      started = true;
      continue;
    }
    if (!started) {
      if (/^\s*\d+(\.\d+)?\s+\d{4}-\d{4}/.test(line)) started = true;
      else continue;
    }
    if (!line.trim()) continue;

    let fields;
    if (line.length >= 34 && /\d{4}-\d{4}/.test(line.slice(14, 24))) {
      fields = {
        FREQ: formatFreqKHz(line.slice(0, 14)),
        UTC: clean(line.slice(14, 24)),
        DAYS: clean(line.slice(24, 30)),
        ITU: clean(line.slice(30, 34)),
        STATION: clean(line.slice(34, 57)),
        LANGUAGE: clean(line.slice(57, 63)),
        REMARKS: clean(line.slice(72))
      };
    } else {
      const m = line.match(/^\s*(\d+(?:\.\d+)?)\s+(\d{4}-\d{4})\s+(?:(\S{1,7})\s+)?([A-Z]{1,3})\s+(.+)$/);
      if (!m) continue;
      fields = {
        FREQ: formatFreqKHz(m[1]),
        UTC: m[2],
        DAYS: m[3] || '',
        ITU: m[4],
        STATION: clean(m[5]),
        LANGUAGE: '',
        REMARKS: ''
      };
    }

    if (!/^\d/.test(String(fields.FREQ))) continue;
    rows.push(makeRow(`eibi-txt-${idx++}`, kHzToHz(fields.FREQ), fields));
  }

  return { type: 'eibi-txt', columns: [...EIBI_TXT_COLUMNS], rows };
}

function parseEibi(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const lower = filePath.toLowerCase();
  if (lower.endsWith('.csv') || isEibiCsvContent(text)) return parseEibiCsv(filePath);
  return parseEibiTxt(filePath);
}

module.exports = {
  parseEibi,
  parseEibiCsv,
  parseEibiTxt,
  isEibiCsvContent,
  isEibiTxtContent,
  EIBI_CSV_COLUMNS,
  EIBI_TXT_COLUMNS
};
