'use strict';

const fs = require('fs');
const { kHzToHz, formatFreqKHz, formatYearMonth, clean, splitCsvLine, makeRow } = require('./util');

const RWW_COLUMNS = [
  'FREQ',
  'ID',
  'TYPE',
  'ACTIVE',
  'LSB',
  'USB',
  'SEC',
  'FMT',
  'NAME',
  'SP',
  'ITU',
  'REGION',
  'QTH',
  'kW',
  'NOTES',
  'HEARD IN',
  'LOGS',
  'FIRST LOGGED',
  'LAST LOGGED'
];

function isRwwContent(text) {
  const header = (text.split(/\r?\n/).find((l) => l.includes(',')) || '').toLowerCase();
  return (
    header.includes('khz') &&
    (header.includes('"id"') || header.includes(',id,') || header.includes('gsq') || header.includes('heard in'))
  );
}

function headerKey(name) {
  return clean(name)
    .replace(/['"]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function parseRww(filePath) {
  const text = fs.readFileSync(filePath, 'utf8');
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) throw new Error('Empty RWW CSV');

  let headerLine = lines[0];
  if (headerLine.charCodeAt(0) === 0xfeff) headerLine = headerLine.slice(1);
  const headers = splitCsvLine(headerLine).map((h) => clean(h.replace(/^'|'$/g, '')));
  if (!headers.length) throw new Error('No RWW headers');

  const idx = (aliases) => headers.findIndex((h) => aliases.includes(headerKey(h)));
  const iFreq = idx(['khz', 'freq', 'frequency']);
  const iId = idx(['id']);
  const iType = idx(['type']);
  const iActive = idx(['active']);
  const iLsb = idx(['lsb']);
  const iUsb = idx(['usb']);
  const iSec = idx(['sec']);
  const iFmt = idx(['fmt']);
  const iName = idx(['name and location', 'name', 'location']);
  const iSp = idx(['sp', 's/p']);
  const iItu = idx(['itu']);
  const iRegion = idx(['region']);
  const iGsq = idx(['gsq', 'qth']);
  const iLat = idx(['lat']);
  const iLon = idx(['lon']);
  const iPwr = idx(['pwr', 'power', 'kw']);
  const iNotes = idx(['notes']);
  const iHeard = idx(['heard in']);
  const iLogs = idx(['logs']);
  const iFirst = idx(['first logged']);
  const iLast = idx(['last logged']);

  const get = (parts, i) => (i >= 0 ? clean(parts[i] || '') : '');

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = splitCsvLine(lines[i]);
    if (!parts.length) continue;
    const freqRaw = iFreq >= 0 ? parts[iFreq] : parts[0];
    if (!freqRaw || !/^\d/.test(String(freqRaw).trim())) continue;

    const lat = Number(get(parts, iLat));
    const lon = Number(get(parts, iLon));
    const fields = {
      FREQ: formatFreqKHz(freqRaw),
      ID: get(parts, iId),
      TYPE: get(parts, iType),
      ACTIVE: get(parts, iActive),
      LSB: get(parts, iLsb),
      USB: get(parts, iUsb),
      SEC: get(parts, iSec),
      FMT: get(parts, iFmt),
      NAME: get(parts, iName),
      SP: get(parts, iSp),
      ITU: get(parts, iItu),
      REGION: get(parts, iRegion),
      QTH: get(parts, iGsq),
      kW: get(parts, iPwr),
      NOTES: get(parts, iNotes),
      'HEARD IN': get(parts, iHeard),
      LOGS: get(parts, iLogs),
      'FIRST LOGGED': formatYearMonth(get(parts, iFirst)) || get(parts, iFirst),
      'LAST LOGGED': formatYearMonth(get(parts, iLast)) || get(parts, iLast),
      _lat: Number.isFinite(lat) ? String(lat) : '',
      _lon: Number.isFinite(lon) ? String(lon) : ''
    };
    rows.push(makeRow(`rww-${i}`, kHzToHz(freqRaw), fields));
  }

  return { type: 'rww-csv', columns: [...RWW_COLUMNS], rows };
}

module.exports = { parseRww, isRwwContent, RWW_COLUMNS };
