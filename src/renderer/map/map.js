'use strict';

const el = {
  title: document.getElementById('mapTitle'),
  btnClose: document.getElementById('btnClose')
};

el.btnClose.addEventListener('click', () => window.api.window.close());

window.api.map.onTitle((title) => {
  el.title.textContent = title || 'Map';
});
