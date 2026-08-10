'use strict';

const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { app, BrowserWindow, BrowserView, ipcMain, dialog, shell } = require('electron');

const paths = require('./paths');

app.setPath('userData', paths.userDataDir);

const config = require('./config');
const windowState = require('./window-state');
const { parseFile, detectType, clearCache } = require('./parsers');

const PRELOAD = path.join(__dirname, 'preload.js');
const RENDERER = path.join(__dirname, '..', 'renderer');

function numbersOdditiesUrls() {
  const year = new Date().getFullYear();
  return [
    `http://www.numbersoddities.nl/Numbers-database-${year}.csv`,
    `http://www.numbersoddities.nl/Numbers-database-${year - 1}.csv`
  ];
}

function getDownloadSources() {
  return [
    {
      id: 'eibi-txt',
      name: 'EiBi (eibi.txt)',
      urls: ['http://www.eibispace.de/dx/eibi.txt'],
      filename: 'eibi.txt',
      type: 'eibi-txt'
    },
    {
      id: 'rww',
      name: 'RWW / Classaxe (CSV)',
      urls: ['https://rxx.classaxe.com/en/rww/signals?types=ALL&show=csv'],
      filename: 'rww.csv',
      type: 'rww-csv'
    },
    {
      id: 'numbers',
      name: 'Numbers & Oddities',
      urls: numbersOdditiesUrls(),
      filename: 'numbers-oddities.csv',
      type: 'numbers'
    }
  ];
}

function downloadSourcesForUi() {
  return getDownloadSources().map((s) => ({
    id: s.id,
    name: s.name,
    url: s.urls[0],
    filename: s.filename,
    type: s.type
  }));
}

let mainWindow = null;
let settingsWindow = null;
let mapWindow = null;
let mapView = null;
let autoUpdateRunning = false;

/** Active list kept in memory. */
let activeData = {
  list: null,
  columns: [],
  rows: [],
  error: null,
  sortKey: null,
  sortDir: 1,
  sortedRows: null
};

function broadcast(channel, payload) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(channel, payload);
  }
}

function ensureDataDir() {
  fs.mkdirSync(paths.userDataDir, { recursive: true });
}

/** Retarget missing list paths to the app directory or default DBF. */
function repairListPaths(cfg) {
  const appDir = paths.appDir;
  const defaultDbf = paths.defaultDbf;
  let changed = false;
  const lists = (cfg.lists || []).map((list) => {
    if (list.path && fs.existsSync(list.path)) return list;
    const base = path.basename(list.path || '');
    const beside = base ? path.join(appDir, base) : '';
    if (beside && fs.existsSync(beside)) {
      changed = true;
      return { ...list, path: beside };
    }
    if ((list.type === 'ilg-dbf' || /\.dbf$/i.test(list.path || '')) && fs.existsSync(defaultDbf)) {
      changed = true;
      return { ...list, path: defaultDbf, type: 'ilg-dbf' };
    }
    return list;
  });

  if (!lists.length && fs.existsSync(defaultDbf)) {
    changed = true;
    lists.push({
      id: 'ilg-default',
      name: 'ILG Radio',
      type: 'ilg-dbf',
      path: defaultDbf
    });
  }

  if (!changed) return cfg;
  return config.update({
    lists,
    activeListId: lists.some((l) => l.id === cfg.activeListId) ? cfg.activeListId : lists[0]?.id ?? null
  });
}

function createMainWindow() {
  const cfg = config.load();
  const { screen } = require('electron');
  const work = screen.getPrimaryDisplay().workAreaSize;
  const bounds = windowState.restore('frequencyList', {
    width: work.width,
    height: config.DEFAULT_PANEL_HEIGHT
  });

  mainWindow = new BrowserWindow({
    ...bounds,
    minWidth: 640,
    minHeight: 140,
    frame: false,
    show: false,
    backgroundColor: '#1e1e1e',
    alwaysOnTop: cfg.ui.alwaysOnTop,
    skipTaskbar: false,
    title: 'SDRconnect FrequencyList',
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.loadFile(path.join(RENDERER, 'panel', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.on('closed', () => {
    mainWindow = null;
  });
  windowState.track('frequencyList', mainWindow);
}

function createSettingsWindow() {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus();
    return settingsWindow;
  }
  const cfg = config.load();
  const bounds = windowState.restore('settings', { width: 980, height: 720 });
  settingsWindow = new BrowserWindow({
    ...bounds,
    minWidth: 720,
    minHeight: 480,
    frame: false,
    show: false,
    backgroundColor: '#1e1e1e',
    parent: undefined,
    alwaysOnTop: cfg.ui.alwaysOnTop,
    title: 'FrequencyList Settings',
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  settingsWindow.loadFile(path.join(RENDERER, 'settings', 'index.html'));
  settingsWindow.once('ready-to-show', () => settingsWindow.show());
  settingsWindow.on('closed', () => {
    settingsWindow = null;
  });
  windowState.track('settings', settingsWindow);
  return settingsWindow;
}

function googleMapsSatelliteUrl(lat, lon, zoom = 15) {
  const q = encodeURIComponent(`${lat},${lon}`);
  return `https://www.google.com/maps?q=${q}&ll=${lat},${lon}&z=${zoom}&t=k`;
}

/** Hide the Maps side panel after load; keep the place marker. */
const COLLAPSE_MAPS_SIDEBAR_JS = `
(function () {
  function injectCss() {
    if (document.getElementById('freqlist-collapse-pane')) return;
    const style = document.createElement('style');
    style.id = 'freqlist-collapse-pane';
    style.textContent = [
      '#pane {',
      '  width: 0 !important;',
      '  min-width: 0 !important;',
      '  max-width: 0 !important;',
      '  flex: 0 0 0 !important;',
      '  overflow: hidden !important;',
      '  opacity: 0 !important;',
      '  pointer-events: none !important;',
      '}',
      '#pane > * { visibility: hidden !important; }'
    ].join('\\n');
    document.documentElement.appendChild(style);
  }
  function collapseOnce() {
    injectCss();
    const labels = [
      'Collapse side panel',
      'Hide side panel',
      'Seitenbereich ausblenden',
      'Seitenleiste ausblenden'
    ];
    for (const label of labels) {
      const btn = document.querySelector('button[aria-label="' + label + '"]');
      if (btn) { btn.click(); return true; }
    }
    const fuzzy = document.querySelector(
      'button[aria-label*="Collapse side" i], button[aria-label*="Hide side" i], button[aria-label*="Seitenbereich" i]'
    );
    if (fuzzy) { fuzzy.click(); return true; }
    return false;
  }
  if (window.__freqListCollapseTimer) clearInterval(window.__freqListCollapseTimer);
  let n = 0;
  window.__freqListCollapseTimer = setInterval(function () {
    collapseOnce();
    if (++n >= 32) {
      clearInterval(window.__freqListCollapseTimer);
      window.__freqListCollapseTimer = null;
    }
  }, 200);
})();
`;

function layoutMapView() {
  if (!mapWindow || mapWindow.isDestroyed() || !mapView) return;
  const [width, height] = mapWindow.getContentSize();
  const top = 32;
  mapView.setBounds({ x: 0, y: top, width, height: Math.max(0, height - top) });
}

function loadMapLocation(lat, lon) {
  if (!mapView || mapView.webContents.isDestroyed()) return;
  const wc = mapView.webContents;
  const inject = () => {
    wc.executeJavaScript(COLLAPSE_MAPS_SIDEBAR_JS).catch(() => {});
  };
  wc.once('did-finish-load', inject);
  wc.once('did-navigate', () => {
    setTimeout(inject, 400);
    setTimeout(inject, 1200);
  });
  wc.loadURL(googleMapsSatelliteUrl(lat, lon));
}

function createMapWindow(payload) {
  const cfg = config.load();
  const bounds = windowState.restore('map', { width: 920, height: 700 });
  const lat = Number(payload?.lat);
  const lon = Number(payload?.lon);
  const title = payload?.title || (Number.isFinite(lat) ? `${lat.toFixed(5)}, ${lon.toFixed(5)}` : 'Map');

  if (mapWindow && !mapWindow.isDestroyed()) {
    mapWindow.focus();
    mapWindow.webContents.send('map:title', title);
    if (Number.isFinite(lat) && Number.isFinite(lon)) {
      loadMapLocation(lat, lon);
    }
    return mapWindow;
  }

  mapWindow = new BrowserWindow({
    ...bounds,
    minWidth: 640,
    minHeight: 480,
    frame: false,
    show: false,
    backgroundColor: '#1e1e1e',
    alwaysOnTop: cfg.ui.alwaysOnTop,
    title: 'FrequencyList Map',
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mapView = new BrowserView({
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mapWindow.setBrowserView(mapView);
  layoutMapView();

  mapWindow.loadFile(path.join(RENDERER, 'map', 'index.html'));
  mapWindow.once('ready-to-show', () => {
    mapWindow.show();
    mapWindow.webContents.send('map:title', title);
  });
  mapWindow.on('resize', layoutMapView);
  mapWindow.on('closed', () => {
    mapWindow = null;
    mapView = null;
  });
  windowState.track('map', mapWindow);

  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    loadMapLocation(lat, lon);
  }
  return mapWindow;
}

function downloadToFile(url, destPath) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https') ? https : http;
    const request = client.get(url, { timeout: 60000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        downloadToFile(res.headers.location, destPath).then(resolve, reject);
        return;
      }
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        return;
      }
      ensureDataDir();
      const tmp = destPath + '.tmp';
      const out = fs.createWriteStream(tmp);
      res.pipe(out);
      out.on('finish', () => {
        out.close(() => {
          try {
            fs.renameSync(tmp, destPath);
            resolve(destPath);
          } catch (err) {
            reject(err);
          }
        });
      });
      out.on('error', reject);
    });
    request.on('error', reject);
    request.on('timeout', () => {
      request.destroy();
      reject(new Error('Download timeout'));
    });
  });
}

async function downloadToFileWithFallback(urls, destPath) {
  let lastErr = null;
  for (const url of urls) {
    try {
      await downloadToFile(url, destPath);
      return { path: destPath, url };
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr || new Error('Download failed');
}

/** Download a built-in source; activate=true switches the active list (manual download). */
async function applyDownload(sourceId, { activate = true } = {}) {
  const source = getDownloadSources().find((s) => s.id === sourceId);
  if (!source) throw new Error('Unknown download source');

  ensureDataDir();
  const dest = path.join(paths.userDataDir, source.filename);
  const fetched = await downloadToFileWithFallback(source.urls, dest);

  if (!source.type) {
    return { registered: false, path: dest, url: fetched.url, name: source.name };
  }

  clearCache();
  const cfg = config.load();
  const existing = cfg.lists.find((l) => l.path === dest || l.id === `dl-${source.id}`);
  let next;
  let list;
  if (existing) {
    list = { ...existing, path: dest, type: source.type, name: source.name };
    const lists = cfg.lists.map((l) => (l.id === existing.id ? list : l));
    const patch = { lists };
    if (activate) patch.activeListId = list.id;
    next = config.update(patch);
  } else {
    list = {
      id: `dl-${source.id}`,
      name: source.name,
      type: source.type,
      path: dest
    };
    const patch = { lists: [...cfg.lists, list] };
    if (activate) patch.activeListId = list.id;
    next = config.update(patch);
  }

  const activePath = next.lists.find((l) => l.id === next.activeListId)?.path;
  if (activate || activePath === dest) {
    loadActiveListIntoMemory(next);
  }
  broadcast('config:changed', next);
  return { registered: true, path: dest, url: fetched.url, list, config: next, meta: activeMeta() };
}

async function runAutoUpdates() {
  if (autoUpdateRunning) return;
  const cfg = config.load();
  if (!cfg.downloads?.autoUpdate) return;

  const intervalMs = Math.max(1, Number(cfg.downloads.intervalHours) || 24) * 60 * 60 * 1000;
  const last = Number(cfg.downloads.lastCheckAt) || 0;
  if (Date.now() - last < intervalMs && last > 0) return;

  const registered = new Set();
  for (const list of cfg.lists || []) {
    if (list.id && String(list.id).startsWith('dl-')) registered.add(String(list.id).slice(3));
    const base = path.basename(list.path || '').toLowerCase();
    for (const source of getDownloadSources()) {
      if (base === source.filename.toLowerCase()) registered.add(source.id);
    }
  }

  const sources = getDownloadSources().filter((s) => registered.has(s.id));
  if (!sources.length) {
    config.update({
      downloads: {
        ...config.load().downloads,
        lastCheckAt: Date.now()
      }
    });
    return;
  }

  autoUpdateRunning = true;
  try {
    for (const source of sources) {
      try {
        await applyDownload(source.id, { activate: false });
      } catch {
        /* keep going; next interval retries */
      }
    }
    config.update({
      downloads: {
        ...config.load().downloads,
        lastCheckAt: Date.now()
      }
    });
  } finally {
    autoUpdateRunning = false;
  }
}

function sortRows(rows, sortKey, sortDir) {
  if (!sortKey) return rows;
  const dir = sortDir >= 0 ? 1 : -1;
  return rows.slice().sort((a, b) => {
    const av = a.fields?.[sortKey];
    const bv = b.fields?.[sortKey];
    const an = Number(av);
    const bn = Number(bv);
    if (Number.isFinite(an) && Number.isFinite(bn)) return (an - bn) * dir;
    return String(av ?? '').localeCompare(String(bv ?? ''), undefined, { sensitivity: 'base' }) * dir;
  });
}

function getSortedRows() {
  if (!activeData.sortKey) return activeData.rows;
  if (!activeData.sortedRows) {
    activeData.sortedRows = sortRows(activeData.rows, activeData.sortKey, activeData.sortDir);
  }
  return activeData.sortedRows;
}

function loadActiveListIntoMemory(cfg) {
  const list = (cfg.lists || []).find((l) => l.id === cfg.activeListId) || cfg.lists?.[0] || null;
  activeData = {
    list: null,
    columns: [],
    rows: [],
    error: null,
    sortKey: null,
    sortDir: 1,
    sortedRows: null
  };
  if (!list) {
    activeData.error = 'No frequency list configured';
    return activeMeta();
  }
  try {
    const parsed = parseFile(list.path, list.type);
    if (parsed.type && list.type !== parsed.type) {
      const lists = cfg.lists.map((l) => (l.id === list.id ? { ...l, type: parsed.type } : l));
      config.update({ lists });
      list.type = parsed.type;
    }
    activeData.list = list;
    activeData.columns = parsed.columns;
    activeData.rows = parsed.rows;
  } catch (err) {
    activeData.list = list;
    activeData.error = err.message || String(err);
  }
  return activeMeta();
}

function activeMeta() {
  return {
    list: activeData.list,
    columns: activeData.columns,
    rowCount: activeData.rows.length,
    error: activeData.error
  };
}

ipcMain.handle('config:get', () => config.load());

ipcMain.handle('config:set', (_event, patch) => {
  const next = config.update(patch);
  if (patch && patch.ui && Object.prototype.hasOwnProperty.call(patch.ui, 'alwaysOnTop')) {
    for (const win of [mainWindow, settingsWindow, mapWindow]) {
      if (win && !win.isDestroyed()) win.setAlwaysOnTop(Boolean(next.ui.alwaysOnTop));
    }
  }
  broadcast('config:changed', next);
  return next;
});

ipcMain.handle('config:path', () => ({
  path: config.getConfigPath(),
  error: config.getLastError()
}));

ipcMain.handle('config:reveal', () => shell.showItemInFolder(config.getConfigPath()));

ipcMain.handle('window:close', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.close();
});

ipcMain.handle('window:minimize', (event) => {
  BrowserWindow.fromWebContents(event.sender)?.minimize();
});

ipcMain.handle('window:open-settings', () => {
  createSettingsWindow();
});

ipcMain.handle('window:open-map', (_event, payload) => {
  createMapWindow(payload || {});
});

ipcMain.handle('lists:get-active', () => {
  if (!activeData.list && !activeData.error) {
    return loadActiveListIntoMemory(config.load());
  }
  return activeMeta();
});

ipcMain.handle('lists:reload', () => {
  clearCache();
  const cfg = repairListPaths(config.load());
  return loadActiveListIntoMemory(cfg);
});

ipcMain.handle('lists:query', (_event, { start = 0, count = 80, sortKey = null, sortDir = 1 } = {}) => {
  if (sortKey !== activeData.sortKey || sortDir !== activeData.sortDir) {
    activeData.sortKey = sortKey;
    activeData.sortDir = sortDir;
    activeData.sortedRows = null;
  }
  const source = getSortedRows();
  const from = Math.max(0, Number(start) || 0);
  const n = Math.max(0, Math.min(500, Number(count) || 80));
  return {
    start: from,
    total: source.length,
    rows: source.slice(from, from + n)
  };
});

ipcMain.handle('lists:row', (_event, index) => {
  const source = getSortedRows();
  const i = Number(index);
  if (!Number.isFinite(i) || i < 0 || i >= source.length) return null;
  return source[i];
});

/** Closest list row for an SDR frequency (Hz). */
ipcMain.handle('lists:find-nearest', (_event, freqHz, toleranceHz = 150) => {
  const target = Number(freqHz);
  if (!Number.isFinite(target) || target <= 0) return null;
  const source = getSortedRows();
  let bestIndex = -1;
  let bestDiff = Infinity;
  for (let i = 0; i < source.length; i++) {
    const hz = source[i]?.freqHz;
    if (!Number.isFinite(hz)) continue;
    const diff = Math.abs(hz - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      bestIndex = i;
    }
  }
  const tol = Math.max(50, Number(toleranceHz) || 150);
  if (bestIndex < 0 || bestDiff > tol) return null;
  return { index: bestIndex, diffHz: bestDiff, row: source[bestIndex] };
});

ipcMain.handle('lists:pick-file', async (event) => {
  const owner = BrowserWindow.fromWebContents(event.sender);
  const result = await dialog.showOpenDialog(owner, {
    title: 'Select frequency list file',
    properties: ['openFile'],
    filters: [
      { name: 'Frequency lists', extensions: ['dbf', 'txt', 'csv'] },
      { name: 'All files', extensions: ['*'] }
    ]
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const filePath = result.filePaths[0];
  const type = detectType(filePath);
  return { path: filePath, type, name: path.basename(filePath) };
});

ipcMain.handle('lists:add', (_event, entry) => {
  const cfg = config.load();
  const id = config.newListId();
  const type = entry.type || detectType(entry.path);
  const list = {
    id,
    name: entry.name || path.basename(entry.path),
    type,
    path: entry.path
  };
  const lists = [...cfg.lists, list];
  const next = config.update({ lists, activeListId: id });
  clearCache();
  loadActiveListIntoMemory(next);
  broadcast('config:changed', next);
  return { config: next, list, meta: activeMeta() };
});

ipcMain.handle('lists:replace', (_event, { listId, path: filePath, name, type }) => {
  const cfg = config.load();
  const detected = type || detectType(filePath);
  const lists = cfg.lists.map((l) =>
    l.id === listId
      ? { ...l, path: filePath, type: detected, name: name || l.name || path.basename(filePath) }
      : l
  );
  clearCache();
  const next = config.update({ lists, activeListId: listId });
  loadActiveListIntoMemory(next);
  broadcast('config:changed', next);
  return { config: next, meta: activeMeta() };
});

ipcMain.handle('lists:remove', (_event, listId) => {
  const cfg = config.load();
  const lists = cfg.lists.filter((l) => l.id !== listId);
  const activeListId = cfg.activeListId === listId ? lists[0]?.id ?? null : cfg.activeListId;
  clearCache();
  const next = config.update({ lists, activeListId });
  loadActiveListIntoMemory(next);
  broadcast('config:changed', next);
  return { config: next, meta: activeMeta() };
});

ipcMain.handle('lists:set-active', (_event, listId) => {
  const next = config.update({ activeListId: listId });
  clearCache();
  loadActiveListIntoMemory(next);
  broadcast('config:changed', next);
  return { config: next, meta: activeMeta() };
});

ipcMain.handle('lists:schema', (_event, listId) => {
  const cfg = config.load();
  const list = (cfg.lists || []).find((l) => l.id === listId);
  if (!list) return { columns: [], error: 'List not found' };
  try {
    const parsed = parseFile(list.path, list.type);
    return {
      columns: (parsed.columns || []).filter((c) => !String(c).startsWith('_')),
      error: null
    };
  } catch (err) {
    return { columns: [], error: err.message || String(err) };
  }
});

ipcMain.handle('lists:download-sources', () => downloadSourcesForUi());

ipcMain.handle('lists:download', async (_event, sourceId) => applyDownload(sourceId, { activate: true }));

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(() => {
    ensureDataDir();
    const cfg = repairListPaths(config.load());
    loadActiveListIntoMemory(cfg);
    createMainWindow();
    setTimeout(() => {
      runAutoUpdates().catch(() => {});
    }, 2500);
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    });
  });

  app.on('window-all-closed', () => app.quit());
}
