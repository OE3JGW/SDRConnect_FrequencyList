'use strict';

const fs = require('fs');
const path = require('path');

const { detectType } = require('./detect');
const { parseDbf } = require('./dbf');
const { parseEibi } = require('./eibi');
const { parseRww } = require('./rww');
const { parseAoki } = require('./aoki');
const { parseHfcc } = require('./hfcc');
const { parseFmlist } = require('./fmlist');
const { parseNumbers } = require('./numbers');

const cache = new Map();

function cacheKey(filePath) {
  const st = fs.statSync(filePath);
  return `${filePath}|${st.size}|${st.mtimeMs}`;
}

function parseFile(filePath, forcedType = null) {
  if (!fs.existsSync(filePath)) throw new Error(`File not found: ${filePath}`);
  const type = forcedType && forcedType !== 'unknown' ? forcedType : detectType(filePath);
  const key = cacheKey(filePath) + '|' + type;
  if (cache.has(key)) return cache.get(key);

  let result;
  switch (type) {
    case 'ilg-dbf':
      result = parseDbf(filePath);
      break;
    case 'eibi-txt':
    case 'eibi-csv':
      result = parseEibi(filePath);
      break;
    case 'rww-csv':
      result = parseRww(filePath);
      break;
    case 'aoki':
      result = parseAoki(filePath);
      break;
    case 'hfcc':
      result = parseHfcc(filePath);
      break;
    case 'fmlist':
    case 'amlist':
      result = parseFmlist(filePath);
      break;
    case 'numbers':
      result = parseNumbers(filePath);
      break;
    default:
      throw new Error(`Unsupported list format: ${type} (${path.basename(filePath)})`);
  }

  cache.set(key, result);
  // Bound cache size
  if (cache.size > 8) {
    const first = cache.keys().next().value;
    cache.delete(first);
  }
  return result;
}

function clearCache() {
  cache.clear();
}

module.exports = { parseFile, detectType, clearCache };
