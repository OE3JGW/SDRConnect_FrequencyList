'use strict';

const fs = require('fs');
const { kHzToHz, formatFreqKHz, clean, makeRow } = require('./util');

/** Default visible ILG column order (display names). */
const ILG_COLUMNS = [
  'FREQ',
  'UTC',
  'DAYS',
  'LANGUAGE',
  'STATION',
  'CALLSIGN',
  'LOCATION',
  'POWER kW',
  'MOD',
  'MODTYP',
  'REMARKS',
  'STN',
  'COU',
  'COUNTRY',
  'NOTES',
  'HEARD'
];

function formatHeard(year) {
  const y = clean(year);
  if (!/^\d{4}$/.test(y)) return y || '';
  const yy = Number(y.slice(0, 2));
  const mm = y.slice(2, 4);
  const full = yy >= 70 ? 1900 + yy : 2000 + yy;
  if (Number(mm) < 1 || Number(mm) > 12) return String(full);
  return `${full}/${mm}`;
}

function formatMilStd(notes) {
  return clean(notes).replace(/MIL-STD-(\d+)[-–](.+)/i, 'MIL - STG $1 - $2');
}

function composeLanguage(language, modtyp, notes) {
  const lang = clean(language);
  const mod = clean(modtyp);
  const note = formatMilStd(notes);
  if (!lang) return [mod, note].filter(Boolean).join(' ');

  if (/^DATA:/i.test(lang)) {
    const after = lang.replace(/^DATA:/i, '').trim();
    const parts = ['DATA'];
    if (after && after.toUpperCase() !== 'DATA') parts.push(after);
    if (mod) parts.push(mod);
    if (note) parts.push(note);
    return parts.join(' ').replace(/\s+/g, ' ').trim();
  }
  return lang;
}

function composeRemarks(remarks) {
  return clean(remarks);
}

function parseIlgPosition(pos) {
  const text = clean(pos);
  if (!text) return null;
  const m = text.match(
    /^(\d{1,3})\s+(\d{1,2})\s+(\d{1,2}(?:\.\d+)?)([EW])\s*,\s*(\d{1,2})\s+(\d{1,2})\s+(\d{1,2}(?:\.\d+)?)([NS])$/i
  );
  if (!m) return null;
  let lon = Number(m[1]) + Number(m[2]) / 60 + Number(m[3]) / 3600;
  if (m[4].toUpperCase() === 'W') lon = -lon;
  let lat = Number(m[5]) + Number(m[6]) / 60 + Number(m[7]) / 3600;
  if (m[8].toUpperCase() === 'S') lat = -lat;
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

function parseIlgLongLat(longi, lati) {
  const lonM = clean(longi).match(/^(\d{3})(\d{2})([EW])$/i);
  const latM = clean(lati).match(/^(\d{2})(\d{2})([NS])$/i);
  if (!lonM || !latM) return null;
  let lon = Number(lonM[1]) + Number(lonM[2]) / 60;
  if (lonM[3].toUpperCase() === 'W') lon = -lon;
  let lat = Number(latM[1]) + Number(latM[2]) / 60;
  if (latM[3].toUpperCase() === 'S') lat = -lat;
  return { lat, lon };
}

function transformIlgRecord(raw) {
  const freqRaw = raw.FREQ || raw.CFFREQ || '';
  const freqHz = kHzToHz(freqRaw);
  const coords = parseIlgPosition(raw.POSITION) || parseIlgLongLat(raw.LONGI, raw.LATI);

  const fields = {
    FREQ: formatFreqKHz(freqRaw),
    UTC: clean(raw.UTC),
    DAYS: clean(raw.DAYS),
    LANGUAGE: composeLanguage(raw.LANGUAGE, raw.MODTYP, raw.NOTES),
    STATION: clean(raw.STATION),
    CALLSIGN: clean(raw.CALL),
    LOCATION: clean(raw.LOCATION),
    'POWER kW': clean(raw.POWER),
    MOD: clean(raw.MOD),
    MODTYP: clean(raw.MODTYP),
    REMARKS: composeRemarks(raw.REMARKS),
    STN: clean(raw.STN),
    COU: clean(raw.ADM),
    COUNTRY: clean(raw.COUNTRY),
    NOTES: clean(raw.NOTES),
    HEARD: formatHeard(raw.YEAR),
    _lat: coords ? String(coords.lat) : '',
    _lon: coords ? String(coords.lon) : ''
  };

  return { freqHz, fields };
}

function parseDbf(filePath) {
  const buf = fs.readFileSync(filePath);
  if (buf.length < 32) throw new Error('DBF file too small');

  const headerLen = buf.readUInt16LE(8);
  const recordLen = buf.readUInt16LE(10);
  const recordCount = buf.readUInt32LE(4);

  const fields = [];
  let offset = 32;
  while (offset < headerLen - 1 && buf[offset] !== 0x0d) {
    let name = '';
    for (let i = 0; i < 11; i++) {
      const b = buf[offset + i];
      if (b === 0) break;
      name += String.fromCharCode(b);
    }
    name = name.trim();
    const type = String.fromCharCode(buf[offset + 11]);
    const length = buf[offset + 16];
    const decimals = buf[offset + 17];
    if (name) fields.push({ name, type, length, decimals });
    offset += 32;
  }

  if (!fields.length) throw new Error('No DBF fields found');

  const rows = [];
  let dataOffset = headerLen;

  for (let i = 0; i < recordCount; i++) {
    if (dataOffset + recordLen > buf.length) break;
    const deleted = buf[dataOffset] === 0x2a;
    let pos = dataOffset + 1;
    const raw = {};
    for (const field of fields) {
      const slice = buf.slice(pos, pos + field.length).toString('latin1');
      pos += field.length;
      raw[field.name] = slice;
    }
    dataOffset += recordLen;
    if (deleted) continue;

    const joined = Object.values(raw).join(' ');
    if (joined.includes('#')) continue;

    const freqRaw = clean(raw.FREQ || raw.CFFREQ || '');
    if (!/^\d/.test(freqRaw)) continue;

    const transformed = transformIlgRecord(raw);
    if (!transformed.freqHz) continue;

    rows.push(makeRow(`dbf-${i}`, transformed.freqHz, transformed.fields));
  }

  return { type: 'ilg-dbf', columns: [...ILG_COLUMNS], rows };
}

module.exports = {
  parseDbf,
  formatFreqKHz,
  formatHeard,
  composeLanguage,
  composeRemarks,
  parseIlgPosition,
  ILG_COLUMNS
};
