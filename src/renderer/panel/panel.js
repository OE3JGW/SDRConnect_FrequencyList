'use strict';

const ROW_HEIGHT_BASE = 24;
const QUERY_PAD = 40;
const MIN_COL_WIDTH = 48;

const DEFAULT_COL_WIDTHS = {
  FREQ: 92,
  UTC: 96,
  DAYS: 74,
  LANGUAGE: 230,
  STATION: 190,
  CALLSIGN: 90,
  LOCATION: 160,
  'POWER kW': 84,
  kW: 70,
  MOD: 52,
  MODTYP: 68,
  REMARKS: 230,
  STN: 64,
  COU: 52,
  COUNTRY: 120,
  NOTES: 170,
  HEARD: 78,
  QTH: 70,
  NAME: 180,
  'Call / Type': 110,
  DETAILS: 180,
  DATE: 78
};

const el = {
  shell: document.getElementById('shell'),
  statusDot: document.getElementById('statusDot'),
  tableScroll: document.getElementById('tableScroll'),
  tableHeader: document.getElementById('tableHeader'),
  tableBody: document.getElementById('tableBody'),
  tableSpacer: document.getElementById('tableSpacer'),
  tableRows: document.getElementById('tableRows'),
  tableError: document.getElementById('tableError'),
  listSelect: document.getElementById('listSelect'),
  btnSettings: document.getElementById('btnSettings'),
  btnMap: document.getElementById('btnMap'),
  btnConnect: document.getElementById('btnConnect'),
  btnQuit: document.getElementById('btnQuit'),
  utcDigits: document.getElementById('utcDigits')
};

let config = null;
let columns = [];
let allColumns = [];
let rowCount = 0;
let selectedIndex = -1;
let selectedRow = null;
let sortState = { key: null, dir: 1 };
let saveTimer = null;
let renderTimer = null;
let querySeq = 0;
let windowStart = 0;
let windowRows = [];
let resizing = null;
let suppressTrackUntil = 0;
let trackTimer = null;
let trackedFreqHz = null;

const client = new window.SdrConnectClient({
  onStatus: (status) => {
    el.statusDot.dataset.status = status;
    el.btnConnect.textContent = status === 'connected' ? 'Reconnect' : 'Connect';
  },
  onProperty: (property, value) => {
    if (property !== 'device_vfo_frequency' && property !== 'device_center_frequency') return;
    const hz = Number(value);
    if (!Number.isFinite(hz) || hz <= 0) return;
    // Prefer VFO when both arrive; center is fallback
    if (property === 'device_center_frequency' && Number.isFinite(Number(client.properties.device_vfo_frequency))) {
      return;
    }
    scheduleTrackFrequency(hz);
  }
});

function applyUiScale() {
  document.documentElement.style.setProperty('--ui-font-size', '15px');
  document.documentElement.style.setProperty('--row-height', `${rowHeight()}px`);
  document.documentElement.style.setProperty('--header-height', `${rowHeight() + 2}px`);
}

function rowHeight() {
  return Math.max(24, Math.round(15 + 10));
}

function activeListId() {
  return config?.activeListId || null;
}

function activeListType() {
  return config?.lists?.find((l) => l.id === config.activeListId)?.type || 'unknown';
}

function colWidth(name) {
  const id = activeListId();
  const type = activeListType();
  const byId = id && config?.columnWidthsByListId?.[id]?.[name];
  if (Number.isFinite(byId) && byId >= MIN_COL_WIDTH) return byId;
  const byType = config?.columnWidthsByListType?.[type]?.[name];
  if (Number.isFinite(byType) && byType >= MIN_COL_WIDTH) return byType;
  return DEFAULT_COL_WIDTHS[name] || Math.max(80, Math.min(180, String(name).length * 8 + 24));
}

function totalTableWidth() {
  return columns.reduce((sum, name) => sum + colWidth(name), 0);
}

function scheduleSave(patch) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    config = await window.api.config.set(patch);
  }, 250);
}

function applySidebar() {
  el.shell.dataset.sidebar = config.ui.sidebarSide === 'right' ? 'right' : 'left';
}

function columnSettings() {
  const id = activeListId();
  const type = activeListType();
  const saved =
    (id && config.columnsByListId?.[id]) ||
    config.columnsByListType?.[type] ||
    { order: [...allColumns], hidden: [] };
  const order = (saved.order || []).filter((c) => allColumns.includes(c));
  for (const c of allColumns) if (!order.includes(c)) order.push(c);
  return { order, hidden: [...(saved.hidden || [])] };
}

function visibleColumnNames() {
  const { order, hidden } = columnSettings();
  const hiddenSet = new Set(hidden);
  return order.filter((c) => !hiddenSet.has(c) && !String(c).startsWith('_'));
}

function renderListSelect() {
  const lists = config.lists || [];
  el.listSelect.innerHTML = '';
  for (const list of lists) {
    const opt = document.createElement('option');
    opt.value = list.id;
    opt.textContent = list.name;
    if (list.id === config.activeListId) opt.selected = true;
    el.listSelect.appendChild(opt);
  }
}

function persistColWidth(name, width) {
  const id = activeListId();
  if (!id) return;
  const widths = { ...(config.columnWidthsByListId?.[id] || {}) };
  widths[name] = width;
  config.columnWidthsByListId = { ...config.columnWidthsByListId, [id]: widths };
  scheduleSave({ columnWidthsByListId: config.columnWidthsByListId });
}

function renderHeader() {
  el.tableHeader.innerHTML = '';
  const total = totalTableWidth();
  el.tableHeader.style.width = total + 'px';
  el.tableBody.style.width = total + 'px';
  el.tableRows.style.width = total + 'px';

  for (const name of columns) {
    const div = document.createElement('div');
    div.className = 'col';
    div.style.width = colWidth(name) + 'px';
    div.textContent = name;
    if (sortState.key === name) {
      div.classList.add('sorted');
      div.textContent = name + (sortState.dir > 0 ? ' ▲' : ' ▼');
    }
    div.addEventListener('click', (e) => {
      if (e.target.classList.contains('col-resize') || resizing) return;
      if (sortState.key === name) sortState.dir *= -1;
      else {
        sortState.key = name;
        sortState.dir = 1;
      }
      selectedIndex = -1;
      selectedRow = null;
      renderHeader();
      scheduleRender(true);
    });

    const handle = document.createElement('div');
    handle.className = 'col-resize';
    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      e.stopPropagation();
      resizing = { name, startX: e.clientX, startW: colWidth(name) };
      document.body.style.cursor = 'col-resize';
    });
    div.appendChild(handle);
    el.tableHeader.appendChild(div);
  }
}

function scheduleRender(force = false) {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(() => renderVisible(force), force ? 0 : 16);
}

async function renderVisible(force = false) {
  const RH = rowHeight();
  const scrollTop = el.tableScroll.scrollTop;
  const height = el.tableScroll.clientHeight || 100;
  el.tableSpacer.style.height = rowCount * RH + 'px';

  const start = Math.max(0, Math.floor(scrollTop / RH) - 5);
  const end = Math.min(rowCount, Math.ceil((scrollTop + height) / RH) + 5);
  const needFetch =
    force ||
    start < windowStart ||
    end > windowStart + windowRows.length ||
    windowRows.length === 0;

  if (needFetch) {
    const seq = ++querySeq;
    const fetchStart = Math.max(0, start - QUERY_PAD);
    const fetchCount = Math.max(end - fetchStart + QUERY_PAD, 60);
    const result = await window.api.lists.query({
      start: fetchStart,
      count: fetchCount,
      sortKey: sortState.key,
      sortDir: sortState.dir
    });
    if (seq !== querySeq) return;
    windowStart = result.start;
    windowRows = result.rows;
    rowCount = result.total;
    el.tableSpacer.style.height = rowCount * RH + 'px';
  }

  const fragment = document.createDocumentFragment();
  el.tableRows.style.transform = `translateY(${start * RH}px)`;

  for (let i = start; i < end; i++) {
    const row = windowRows[i - windowStart];
    if (!row) continue;
    const div = document.createElement('div');
    div.className = 'table-row' + (i === selectedIndex ? ' selected' : '');
    div.style.height = RH + 'px';
    for (const name of columns) {
      const cell = document.createElement('div');
      cell.className = 'cell';
      cell.style.width = colWidth(name) + 'px';
      cell.textContent = row.fields?.[name] ?? '';
      div.appendChild(cell);
    }
    div.addEventListener('click', () => onRowClick(i));
    fragment.appendChild(div);
  }
  el.tableRows.innerHTML = '';
  el.tableRows.appendChild(fragment);
}

async function onRowClick(index) {
  selectedIndex = index;
  selectedRow = await window.api.lists.row(index);
  scheduleRender();
  if (!selectedRow?.freqHz) return;
  if (!client.connected) return;
  suppressTrackUntil = Date.now() + 800;
  trackedFreqHz = selectedRow.freqHz;
  const mode = window.Frequency.modeFromFields(selectedRow.fields);
  await client.tune({ freqHz: selectedRow.freqHz, mode });
}

function scheduleTrackFrequency(freqHz) {
  clearTimeout(trackTimer);
  trackTimer = setTimeout(() => trackFrequency(freqHz), 180);
}

async function trackFrequency(freqHz) {
  if (Date.now() < suppressTrackUntil) return;
  if (!Number.isFinite(freqHz) || freqHz <= 0) return;
  if (trackedFreqHz !== null && Math.abs(trackedFreqHz - freqHz) < 25) return;

  const match = await window.api.lists.findNearest(freqHz, 150);
  if (!match) return;
  trackedFreqHz = freqHz;
  if (match.index === selectedIndex) return;

  selectedIndex = match.index;
  selectedRow = match.row;
  const RH = rowHeight();
  const viewH = el.tableScroll.clientHeight || 100;
  el.tableScroll.scrollTop = Math.max(0, match.index * RH - viewH / 2 + RH);
  scheduleRender(true);
}

function openSelectedMap() {
  const lat = Number(selectedRow?.fields?._lat);
  const lon = Number(selectedRow?.fields?._lon);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    el.tableError.textContent = 'No position for selected row';
    el.tableError.classList.remove('hidden');
    setTimeout(() => el.tableError.classList.add('hidden'), 1800);
    return;
  }
  window.api.window.openMap({
    lat,
    lon,
    title: selectedRow.fields?.STATION || selectedRow.fields?.NAME || `${lat.toFixed(5)}, ${lon.toFixed(5)}`
  });
}

function applyMeta(meta) {
  if (meta.error) {
    el.tableError.textContent = meta.error;
    el.tableError.classList.remove('hidden');
  } else {
    el.tableError.classList.add('hidden');
  }
  allColumns = (meta.columns || []).filter((c) => !String(c).startsWith('_'));
  rowCount = meta.rowCount || 0;
  columns = visibleColumnNames();
  selectedIndex = -1;
  selectedRow = null;
  trackedFreqHz = null;
  sortState = { key: null, dir: 1 };
  windowStart = 0;
  windowRows = [];
  renderHeader();
  scheduleRender(true);
  renderListSelect();
}

function connectSdr() {
  client.configure(config.connection);
  client.stop();
  client.start(0);
}

function tickUtc() {
  const now = new Date();
  const hh = String(now.getUTCHours()).padStart(2, '0');
  const mm = String(now.getUTCMinutes()).padStart(2, '0');
  const ss = String(now.getUTCSeconds()).padStart(2, '0');
  el.utcDigits.textContent = `${hh}:${mm}:${ss}`;
}

async function init() {
  config = await window.api.config.get();
  applyUiScale();
  applySidebar();
  renderListSelect();
  const meta = await window.api.lists.getActive();
  applyMeta(meta);
  connectSdr();
  tickUtc();
  setInterval(tickUtc, 250);

  window.api.config.onChanged(async (cfg) => {
    const prevActive = config.activeListId;
    const prevCols = JSON.stringify(config.columnsByListId);
    config = cfg;
    applyUiScale();
    applySidebar();
    renderListSelect();
    if (cfg.activeListId !== prevActive || JSON.stringify(cfg.columnsByListId) !== prevCols) {
      const nextMeta = await window.api.lists.getActive();
      applyMeta(nextMeta);
    }
  });

  el.tableScroll.addEventListener('scroll', () => scheduleRender());
  window.addEventListener('resize', () => scheduleRender());

  window.addEventListener('mousemove', (e) => {
    if (!resizing) return;
    const dx = e.clientX - resizing.startX;
    const next = Math.max(MIN_COL_WIDTH, resizing.startW + dx);
    const id = activeListId();
    if (!id) return;
    if (!config.columnWidthsByListId[id]) config.columnWidthsByListId[id] = {};
    config.columnWidthsByListId[id][resizing.name] = next;
    renderHeader();
    scheduleRender();
  });

  window.addEventListener('mouseup', () => {
    if (!resizing) return;
    persistColWidth(resizing.name, colWidth(resizing.name));
    resizing = null;
    document.body.style.cursor = '';
  });

  el.listSelect.addEventListener('change', async () => {
    const result = await window.api.lists.setActive(el.listSelect.value);
    config = result.config;
    applyMeta(result.meta);
  });

  el.btnMap.addEventListener('click', openSelectedMap);
  el.btnSettings.addEventListener('click', () => window.api.window.openSettings());
  el.btnConnect.addEventListener('click', connectSdr);
  el.btnQuit.addEventListener('click', () => window.api.window.close());
}

init().catch((err) => {
  el.tableError.textContent = err.message || String(err);
  el.tableError.classList.remove('hidden');
});
