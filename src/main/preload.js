'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  config: {
    get: () => ipcRenderer.invoke('config:get'),
    set: (patch) => ipcRenderer.invoke('config:set', patch),
    path: () => ipcRenderer.invoke('config:path'),
    reveal: () => ipcRenderer.invoke('config:reveal'),
    onChanged: (callback) => {
      const handler = (_event, cfg) => callback(cfg);
      ipcRenderer.on('config:changed', handler);
      return () => ipcRenderer.removeListener('config:changed', handler);
    }
  },
  window: {
    close: () => ipcRenderer.invoke('window:close'),
    minimize: () => ipcRenderer.invoke('window:minimize'),
    openSettings: () => ipcRenderer.invoke('window:open-settings'),
    openMap: (payload) => ipcRenderer.invoke('window:open-map', payload)
  },
  map: {
    onShow: (callback) => {
      const handler = (_event, payload) => callback(payload);
      ipcRenderer.on('map:show', handler);
      return () => ipcRenderer.removeListener('map:show', handler);
    },
    onTitle: (callback) => {
      const handler = (_event, title) => callback(title);
      ipcRenderer.on('map:title', handler);
      return () => ipcRenderer.removeListener('map:title', handler);
    }
  },
  lists: {
    getActive: () => ipcRenderer.invoke('lists:get-active'),
    reload: () => ipcRenderer.invoke('lists:reload'),
    query: (opts) => ipcRenderer.invoke('lists:query', opts),
    row: (index) => ipcRenderer.invoke('lists:row', index),
    findNearest: (freqHz, toleranceHz) => ipcRenderer.invoke('lists:find-nearest', freqHz, toleranceHz),
    pickFile: () => ipcRenderer.invoke('lists:pick-file'),
    add: (entry) => ipcRenderer.invoke('lists:add', entry),
    replace: (payload) => ipcRenderer.invoke('lists:replace', payload),
    remove: (listId) => ipcRenderer.invoke('lists:remove', listId),
    setActive: (listId) => ipcRenderer.invoke('lists:set-active', listId),
    schema: (listId) => ipcRenderer.invoke('lists:schema', listId),
    downloadSources: () => ipcRenderer.invoke('lists:download-sources'),
    download: (sourceId) => ipcRenderer.invoke('lists:download', sourceId)
  }
});
