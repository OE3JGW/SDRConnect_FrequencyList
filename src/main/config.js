'use strict';

const fs = require('fs');
const path = require('path');

const paths = require('./paths');

const SCHEMA_VERSION = 3;
const DEFAULT_WIDTH = 1400;
const DEFAULT_HEIGHT = 220;
const DEFAULT_FONT_SIZE = 15;

let cache = null;
let lastError = null;

function defaultWidth() {
  return DEFAULT_WIDTH;
}

function newListId() {
  return 'l' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function defaultLists() {
  const lists = [];
  if (fs.existsSync(paths.defaultDbf)) {
    lists.push({
      id: 'ilg-default',
      name: 'ILG Radio',
      type: 'ilg-dbf',
      path: paths.defaultDbf
    });
  }
  return lists;
}

function baseConfig() {
  const lists = defaultLists();
  return {
    schemaVersion: SCHEMA_VERSION,
    connection: { host: '127.0.0.1', port: 5454, device: 'primary' },
    ui: {
      alwaysOnTop: true,
      sidebarSide: 'left',
      fontSize: DEFAULT_FONT_SIZE
    },
    lists,
    activeListId: lists[0]?.id ?? null,
    columnsByListId: {},
    columnsByListType: {},
    columnWidthsByListId: {},
    columnWidthsByListType: {},
    sortByListType: {},
    windows: {
      frequencyList: { width: defaultWidth(), height: DEFAULT_HEIGHT },
      settings: { width: 980, height: 720 },
      map: { width: 920, height: 700 }
    }
  };
}

function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function merge(target, patch) {
  const out = { ...target };
  for (const [key, value] of Object.entries(patch)) {
    out[key] = isPlainObject(value) && isPlainObject(target[key]) ? merge(target[key], value) : value;
  }
  return out;
}

function normalizeList(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const id = typeof raw.id === 'string' && raw.id ? raw.id : newListId();
  const name = String(raw.name || path.basename(raw.path || 'List')).trim().slice(0, 80) || 'List';
  const type = String(raw.type || 'unknown').trim();
  const filePath = String(raw.path || '').trim();
  if (!filePath) return null;
  return { id, name, type, path: filePath };
}

function normalize(cfg) {
  const incoming = cfg && typeof cfg === 'object' ? cfg : {};
  const prevSchema = Number(incoming.schemaVersion) || 1;
  const base = baseConfig();
  const merged = merge(base, incoming);

  if (prevSchema < 2) {
    merged.ui = { ...merged.ui, sidebarSide: 'left' };
    if (merged.columnsByListType?.['ilg-dbf']) {
      delete merged.columnsByListType['ilg-dbf'];
    }
  }
  if (prevSchema < 3) {
    merged.ui = { ...merged.ui, fontSize: DEFAULT_FONT_SIZE };
  }

  merged.schemaVersion = SCHEMA_VERSION;
  merged.connection = {
    host: String(merged.connection?.host || '127.0.0.1').trim() || '127.0.0.1',
    port: Math.max(1, Math.min(65535, Number(merged.connection?.port) || 5454)),
    device: merged.connection?.device === 'secondary' ? 'secondary' : 'primary'
  };
  merged.ui = {
    alwaysOnTop: Boolean(merged.ui?.alwaysOnTop),
    sidebarSide: merged.ui?.sidebarSide === 'right' ? 'right' : 'left',
    fontSize: DEFAULT_FONT_SIZE
  };

  const lists = Array.isArray(merged.lists) ? merged.lists.map(normalizeList).filter(Boolean) : [];
  if (!lists.length) {
    lists.push(...defaultLists());
  }
  merged.lists = lists;

  if (!lists.some((l) => l.id === merged.activeListId)) {
    merged.activeListId = lists[0]?.id ?? null;
  }

  if (!isPlainObject(merged.columnsByListId)) merged.columnsByListId = {};
  if (!isPlainObject(merged.columnsByListType)) merged.columnsByListType = {};
  if (!isPlainObject(merged.columnWidthsByListId)) merged.columnWidthsByListId = {};
  if (!isPlainObject(merged.columnWidthsByListType)) merged.columnWidthsByListType = {};
  if (!isPlainObject(merged.sortByListType)) merged.sortByListType = {};

  const win = merged.windows || {};
  const fl = win.frequencyList || {};
  const settings = win.settings || {};
  const map = win.map || {};
  merged.windows = {
    frequencyList: {
      x: Number.isFinite(fl.x) ? fl.x : undefined,
      y: Number.isFinite(fl.y) ? fl.y : undefined,
      width: Number.isFinite(fl.width) ? fl.width : defaultWidth(),
      height: Number.isFinite(fl.height) ? fl.height : DEFAULT_HEIGHT
    },
    settings: {
      x: Number.isFinite(settings.x) ? settings.x : undefined,
      y: Number.isFinite(settings.y) ? settings.y : undefined,
      width: Number.isFinite(settings.width) ? settings.width : 980,
      height: Number.isFinite(settings.height) ? settings.height : 720
    },
    map: {
      x: Number.isFinite(map.x) ? map.x : undefined,
      y: Number.isFinite(map.y) ? map.y : undefined,
      width: Number.isFinite(map.width) ? map.width : 920,
      height: Number.isFinite(map.height) ? map.height : 700
    }
  };

  return merged;
}

function persist(cfg) {
  const file = paths.configFile;
  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.config.${process.pid}.${Date.now()}.tmp`);
  try {
    fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf8');
    fs.renameSync(tmp, file);
    lastError = null;
  } catch (err) {
    lastError = err.message;
    try {
      fs.unlinkSync(tmp);
    } catch {
      /* ignore */
    }
    try {
      fs.writeFileSync(file, JSON.stringify(cfg, null, 2), 'utf8');
      lastError = null;
    } catch (err2) {
      lastError = err2.message;
    }
  }
}

function load() {
  if (cache) return cache;
  let raw = null;
  try {
    if (fs.existsSync(paths.configFile)) {
      raw = JSON.parse(fs.readFileSync(paths.configFile, 'utf8'));
    }
  } catch (err) {
    lastError = err.message;
  }
  cache = normalize(raw);
  persist(cache);
  return cache;
}

function update(patch) {
  const current = load();
  cache = normalize(merge(current, patch || {}));
  persist(cache);
  return cache;
}

function getConfigPath() {
  return paths.configFile;
}

function getLastError() {
  return lastError;
}

module.exports = {
  SCHEMA_VERSION,
  DEFAULT_HEIGHT,
  DEFAULT_FONT_SIZE,
  newListId,
  load,
  update,
  getConfigPath,
  getLastError,
  get DEFAULT_PANEL_WIDTH() {
    return defaultWidth();
  },
  DEFAULT_PANEL_HEIGHT: DEFAULT_HEIGHT
};
