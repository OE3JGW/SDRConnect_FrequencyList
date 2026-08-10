'use strict';

const { screen } = require('electron');
const config = require('./config');

const SAVE_DEBOUNCE_MS = 400;

function isOnScreen(bounds) {
  return screen.getAllDisplays().some((display) => {
    const wa = display.workArea;
    return (
      bounds.x + bounds.width > wa.x + 40 &&
      bounds.x < wa.x + wa.width - 40 &&
      bounds.y + 40 > wa.y &&
      bounds.y < wa.y + wa.height - 40
    );
  });
}

/** Restore saved bounds, ignoring positions that fall off-screen. */
function restore(name, fallback) {
  const saved = config.load().windows?.[name] ?? {};
  const bounds = {
    width: Number.isFinite(saved.width) ? saved.width : fallback.width,
    height: Number.isFinite(saved.height) ? saved.height : fallback.height
  };
  if (Number.isFinite(saved.x) && Number.isFinite(saved.y)) {
    const candidate = { ...bounds, x: saved.x, y: saved.y };
    if (isOnScreen(candidate)) return candidate;
  }
  return bounds;
}

function track(name, window) {
  let timer = null;

  const save = () => {
    if (window.isDestroyed() || window.isMinimized()) return;
    const { x, y, width, height } = window.getNormalBounds();
    config.update({ windows: { [name]: { x, y, width, height } } });
  };

  const schedule = () => {
    clearTimeout(timer);
    timer = setTimeout(save, SAVE_DEBOUNCE_MS);
  };

  window.on('move', schedule);
  window.on('resize', schedule);
  window.on('close', () => {
    clearTimeout(timer);
    save();
  });
}

module.exports = { restore, track };
