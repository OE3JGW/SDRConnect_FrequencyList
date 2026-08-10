'use strict';

const fs = require('fs');
const path = require('path');

const { isEibiCsvContent, isEibiTxtContent } = require('./eibi');
const { isRwwContent } = require('./rww');
const { isAokiContent } = require('./aoki');
const { isHfccContent } = require('./hfcc');
const { isFmlistContent } = require('./fmlist');
const { isNumbersContent } = require('./numbers');

function sniffText(filePath, maxBytes = 64 * 1024) {
  const fd = fs.openSync(filePath, 'r');
  try {
    const buf = Buffer.alloc(maxBytes);
    const n = fs.readSync(fd, buf, 0, maxBytes, 0);
    return buf.slice(0, n).toString('utf8');
  } finally {
    fs.closeSync(fd);
  }
}

function detectType(filePath) {
  const lower = path.basename(filePath).toLowerCase();
  const ext = path.extname(lower);

  if (ext === '.dbf') return 'ilg-dbf';

  let text = '';
  try {
    text = sniffText(filePath);
  } catch {
    text = '';
  }

  if (lower.includes('eibi') || lower.startsWith('freq-') || lower.startsWith('sked-') || lower.startsWith('bc-')) {
    if (ext === '.csv' || isEibiCsvContent(text)) return 'eibi-csv';
    return 'eibi-txt';
  }
  if (lower.includes('rww') || lower.includes('classaxe') || isRwwContent(text)) return 'rww-csv';
  if (isAokiContent(text, filePath)) return 'aoki';
  if (isHfccContent(text, filePath)) return 'hfcc';
  if (isNumbersContent(text, filePath)) return 'numbers';
  if (isFmlistContent(text, filePath)) return lower.includes('am') && !lower.includes('fm') ? 'amlist' : 'fmlist';

  if (ext === '.csv') {
    if (isEibiCsvContent(text)) return 'eibi-csv';
    if (isRwwContent(text)) return 'rww-csv';
    return 'rww-csv';
  }
  if (ext === '.txt') {
    if (isEibiTxtContent(text) || isEibiCsvContent(text)) {
      return isEibiCsvContent(text) ? 'eibi-csv' : 'eibi-txt';
    }
    return 'eibi-txt';
  }

  return 'unknown';
}

module.exports = { detectType, sniffText };
