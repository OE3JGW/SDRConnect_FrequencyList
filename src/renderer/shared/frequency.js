'use strict';

/** Frequency helpers. List data is typically in kHz; SDRconnect uses Hz. */
(function (global) {
  function kHzToHz(kHz) {
    const n = Number(kHz);
    return Number.isFinite(n) && n > 0 ? Math.round(n * 1000) : null;
  }

  function label(hz) {
    if (!Number.isFinite(hz)) return '—';
    if (hz >= 1e9) return `${(hz / 1e9).toFixed(6)} GHz`;
    if (hz >= 1e6) return `${(hz / 1e6).toFixed(6)} MHz`;
    if (hz >= 1e3) return `${(hz / 1e3).toFixed(3)} kHz`;
    return `${hz} Hz`;
  }

  function mapMode(raw) {
    if (raw === null || raw === undefined) return null;
    const t = String(raw).trim().toUpperCase();
    if (!t) return null;
    if (t === 'AM' || (t.includes('AM') && !t.includes('SAM'))) return 'AM';
    if (t === 'SAM') return 'SAM';
    if (t.includes('USB')) return 'USB';
    if (t.includes('LSB')) return 'LSB';
    if (t.includes('CW') || t.includes('MORSE')) return 'CW';
    if (t.includes('WFM')) return 'WFM';
    if (t === 'FM' || t.includes('NFM') || t.includes('FM')) return 'NFM';
    return null;
  }

  function modeFromFields(fields) {
    if (!fields) return null;
    return (
      mapMode(fields.MOD) ||
      mapMode(fields.MODTYP) ||
      mapMode(fields.Type) ||
      mapMode(fields.TYPE) ||
      mapMode(fields.Mode) ||
      mapMode(fields.MODE) ||
      null
    );
  }

  global.Frequency = { kHzToHz, label, mapMode, modeFromFields };
})(window);
