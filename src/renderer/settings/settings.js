'use strict';

const el = {
  btnClose: document.getElementById('btnClose'),
  btnAddList: document.getElementById('btnAddList'),
  btnReplaceList: document.getElementById('btnReplaceList'),
  btnRemoveList: document.getElementById('btnRemoveList'),
  btnReloadList: document.getElementById('btnReloadList'),
  listRegistry: document.getElementById('listRegistry'),
  downloadList: document.getElementById('downloadList'),
  autoUpdateLists: document.getElementById('autoUpdateLists'),
  columnList: document.getElementById('columnList'),
  columnSourceSelect: document.getElementById('columnSourceSelect'),
  sidebarSide: document.getElementById('sidebarSide'),
  alwaysOnTop: document.getElementById('alwaysOnTop'),
  connHost: document.getElementById('connHost'),
  connPort: document.getElementById('connPort'),
  connDevice: document.getElementById('connDevice'),
  configPathHint: document.getElementById('configPathHint')
};

let config = null;
let columnsByList = {};
let editListId = null;
let dragCol = null;
let saveTimer = null;

function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function scheduleSave(patch) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    saveTimer = null;
    config = await window.api.config.set(patch);
  }, 250);
}

function applyFont() {
  document.documentElement.style.setProperty('--ui-font-size', '15px');
}

function columnSettingsFor(listId) {
  const cols = columnsByList[listId] || [];
  const list = config.lists?.find((l) => l.id === listId);
  const type = list?.type || 'unknown';
  const saved =
    config.columnsByListId?.[listId] ||
    config.columnsByListType?.[type] ||
    { order: [...cols], hidden: [] };
  const order = (saved.order || []).filter((c) => cols.includes(c));
  for (const c of cols) if (!order.includes(c)) order.push(c);
  return { order, hidden: [...(saved.hidden || [])] };
}

function persistColumnSettings(listId, next) {
  config.columnsByListId = { ...config.columnsByListId, [listId]: next };
  scheduleSave({ columnsByListId: config.columnsByListId });
}

function renderListRegistry() {
  el.listRegistry.innerHTML = '';
  for (const list of config.lists || []) {
    const li = document.createElement('li');
    if (list.id === config.activeListId) li.classList.add('active');
    li.innerHTML = `<div><div>${escapeHtml(list.name)}</div><div class="meta">${escapeHtml(list.type)} · ${escapeHtml(list.path)}</div></div>`;
    li.addEventListener('click', async () => {
      if (list.id === config.activeListId) return;
      const result = await window.api.lists.setActive(list.id);
      config = result.config;
      if (result.meta?.columns) columnsByList[list.id] = result.meta.columns.filter((c) => !String(c).startsWith('_'));
      editListId = list.id;
      await refresh();
    });
    el.listRegistry.appendChild(li);
  }
}

function renderSourceSelect() {
  el.columnSourceSelect.innerHTML = '';
  for (const list of config.lists || []) {
    const opt = document.createElement('option');
    opt.value = list.id;
    opt.textContent = `${list.name} (${list.type})`;
    if (list.id === editListId) opt.selected = true;
    el.columnSourceSelect.appendChild(opt);
  }
  if (!editListId && config.lists?.[0]) editListId = config.lists[0].id;
}

function renderColumnEditor() {
  const listId = editListId || config.activeListId;
  if (!listId) {
    el.columnList.innerHTML = '';
    return;
  }
  const cols = columnsByList[listId] || [];
  const { order, hidden } = columnSettingsFor(listId);
  const hiddenSet = new Set(hidden);
  el.columnList.innerHTML = '';

  for (const name of order) {
    if (!cols.includes(name)) continue;
    const li = document.createElement('li');
    li.draggable = true;
    li.dataset.col = name;
    li.innerHTML = `<span class="drag-handle" title="Drag to reorder">⋮⋮</span><label><input type="checkbox" ${hiddenSet.has(name) ? '' : 'checked'} /><span>${escapeHtml(name)}</span></label>`;
    const checkbox = li.querySelector('input');
    checkbox.addEventListener('change', () => {
      const next = columnSettingsFor(listId);
      if (checkbox.checked) next.hidden = next.hidden.filter((c) => c !== name);
      else if (!next.hidden.includes(name)) next.hidden.push(name);
      persistColumnSettings(listId, next);
    });
    li.addEventListener('dragstart', (e) => {
      dragCol = name;
      li.classList.add('dragging');
      e.dataTransfer.setData('text/plain', name);
    });
    li.addEventListener('dragend', () => {
      dragCol = null;
      for (const row of el.columnList.children) row.classList.remove('dragging', 'drop-target');
    });
    li.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (!dragCol || dragCol === name) return;
      for (const row of el.columnList.children) row.classList.remove('drop-target');
      li.classList.add('drop-target');
    });
    li.addEventListener('dragleave', () => li.classList.remove('drop-target'));
    li.addEventListener('drop', (e) => {
      e.preventDefault();
      if (!dragCol || dragCol === name) return;
      const next = columnSettingsFor(listId);
      const from = next.order.indexOf(dragCol);
      const to = next.order.indexOf(name);
      if (from < 0 || to < 0) return;
      next.order.splice(from, 1);
      next.order.splice(to, 0, dragCol);
      persistColumnSettings(listId, next);
      renderColumnEditor();
    });
    el.columnList.appendChild(li);
  }
}

async function ensureColumnsCached(listId) {
  if (columnsByList[listId]?.length) return;
  const schema = await window.api.lists.schema(listId);
  columnsByList[listId] = schema.columns || [];
}

async function renderDownloads() {
  const sources = await window.api.lists.downloadSources();
  el.downloadList.innerHTML = '';
  for (const source of sources) {
    const row = document.createElement('div');
    row.className = 'download-row';
    row.innerHTML = `<span class="name">${escapeHtml(source.name)}</span>`;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn';
    btn.textContent = 'Download';
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.textContent = '…';
      try {
        const result = await window.api.lists.download(source.id);
        if (result.config) config = result.config;
        if (result.list?.id && result.meta?.columns) {
          columnsByList[result.list.id] = result.meta.columns.filter((c) => !String(c).startsWith('_'));
          editListId = result.list.id;
        }
        await refresh();
        btn.textContent = 'OK';
      } catch {
        btn.textContent = 'Fail';
      } finally {
        setTimeout(() => {
          btn.disabled = false;
          btn.textContent = 'Download';
        }, 1200);
      }
    });
    row.appendChild(btn);
    el.downloadList.appendChild(row);
  }
}

function fillForm() {
  el.sidebarSide.value = config.ui.sidebarSide;
  el.alwaysOnTop.checked = Boolean(config.ui.alwaysOnTop);
  el.autoUpdateLists.checked = config.downloads?.autoUpdate !== false;
  el.connHost.value = config.connection.host;
  el.connPort.value = config.connection.port;
  el.connDevice.value = config.connection.device;
}

async function refresh() {
  applyFont();
  renderListRegistry();
  if (!editListId) editListId = config.activeListId || config.lists?.[0]?.id || null;
  renderSourceSelect();
  if (editListId) await ensureColumnsCached(editListId);
  renderColumnEditor();
  fillForm();
  const pathInfo = await window.api.config.path();
  el.configPathHint.textContent = pathInfo.error
    ? `Config write error: ${pathInfo.error}`
    : `Config: ${pathInfo.path}`;
}

async function init() {
  config = await window.api.config.get();
  editListId = config.activeListId;
  const meta = await window.api.lists.getActive();
  if (config.activeListId) {
    columnsByList[config.activeListId] = (meta.columns || []).filter((c) => !String(c).startsWith('_'));
  }
  await refresh();
  await renderDownloads();

  window.api.config.onChanged(async (cfg) => {
    config = cfg;
    await refresh();
  });

  el.btnClose.addEventListener('click', () => window.api.window.close());

  el.columnSourceSelect.addEventListener('change', async () => {
    editListId = el.columnSourceSelect.value;
    await ensureColumnsCached(editListId);
    renderColumnEditor();
  });

  el.btnAddList.addEventListener('click', async () => {
    const picked = await window.api.lists.pickFile();
    if (!picked) return;
    const result = await window.api.lists.add(picked);
    config = result.config;
    if (result.list?.id) {
      columnsByList[result.list.id] = (result.meta?.columns || []).filter((c) => !String(c).startsWith('_'));
      editListId = result.list.id;
    }
    await refresh();
  });

  el.btnReplaceList.addEventListener('click', async () => {
    if (!config.activeListId) return;
    const picked = await window.api.lists.pickFile();
    if (!picked) return;
    const result = await window.api.lists.replace({
      listId: config.activeListId,
      path: picked.path,
      type: picked.type,
      name: picked.name
    });
    config = result.config;
    columnsByList[config.activeListId] = (result.meta?.columns || []).filter((c) => !String(c).startsWith('_'));
    await refresh();
  });

  el.btnRemoveList.addEventListener('click', async () => {
    if (!config.activeListId) return;
    const removed = config.activeListId;
    const result = await window.api.lists.remove(removed);
    config = result.config;
    delete columnsByList[removed];
    editListId = config.activeListId;
    await refresh();
  });

  el.btnReloadList.addEventListener('click', async () => {
    const meta = await window.api.lists.reload();
    config = await window.api.config.get();
    if (config.activeListId) {
      columnsByList[config.activeListId] = (meta.columns || []).filter((c) => !String(c).startsWith('_'));
    }
    await refresh();
  });

  el.sidebarSide.addEventListener('change', async () => {
    config = await window.api.config.set({ ui: { ...config.ui, sidebarSide: el.sidebarSide.value } });
  });

  el.alwaysOnTop.addEventListener('change', async () => {
    config = await window.api.config.set({ ui: { ...config.ui, alwaysOnTop: el.alwaysOnTop.checked } });
  });

  el.autoUpdateLists.addEventListener('change', async () => {
    config = await window.api.config.set({
      downloads: {
        ...(config.downloads || {}),
        autoUpdate: el.autoUpdateLists.checked
      }
    });
  });

  const saveConn = async () => {
    config = await window.api.config.set({
      connection: {
        host: el.connHost.value.trim() || '127.0.0.1',
        port: Number(el.connPort.value) || 5454,
        device: el.connDevice.value
      }
    });
  };
  el.connHost.addEventListener('change', saveConn);
  el.connPort.addEventListener('change', saveConn);
  el.connDevice.addEventListener('change', saveConn);
}

init().catch((err) => {
  el.configPathHint.textContent = err.message || String(err);
});
