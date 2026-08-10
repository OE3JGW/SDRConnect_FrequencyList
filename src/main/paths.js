'use strict';

const path = require('path');
const fs = require('fs');
const { app } = require('electron');

function isTempDir(dir) {
  const normalized = String(dir || '').replace(/\//g, '\\').toLowerCase();
  return (
    normalized.includes('\\temp\\') ||
    normalized.includes('\\appdata\\local\\temp') ||
    normalized.includes('\\appdata\\local\\tmp')
  );
}

function resolveAppDir() {
  if (process.env.PORTABLE_EXECUTABLE_DIR) {
    return process.env.PORTABLE_EXECUTABLE_DIR;
  }
  if (process.env.APPIMAGE) return path.dirname(process.env.APPIMAGE);

  if (app && app.isPackaged) {
    const execDir = path.dirname(process.execPath);
    // Prefer non-temp unpack dirs; portable builds otherwise land under %TEMP%.
    if (!isTempDir(execDir)) return execDir;
    return execDir;
  }

  return path.resolve(__dirname, '..', '..');
}

function resolveDefaultDbf() {
  const appDir = resolveAppDir();
  const candidates = [
    path.join(appDir, 'ILGADATA.DBF'),
    path.join(appDir, 'ilgadata.dbf'),
    process.resourcesPath ? path.join(process.resourcesPath, 'ILGADATA.DBF') : null,
    path.join(appDir, 'resources', 'ILGADATA.DBF'),
    path.resolve(__dirname, '..', '..', 'ILGADATA.DBF')
  ].filter(Boolean);

  return (
    candidates.find((p) => {
      try {
        return fs.existsSync(p);
      } catch {
        return false;
      }
    }) || candidates[0]
  );
}

module.exports = {
  resolveAppDir,
  resolveDefaultDbf,
  get appDir() {
    return resolveAppDir();
  },
  get configFile() {
    return path.join(resolveAppDir(), 'config.json');
  },
  get userDataDir() {
    return path.join(resolveAppDir(), 'data');
  },
  get defaultDbf() {
    return resolveDefaultDbf();
  }
};
