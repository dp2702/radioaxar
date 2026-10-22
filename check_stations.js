/* TUNO universal station checker
 * Works on country pages, search results, home lists, and SPA-rendered lists.
 */
(() => {
  'use strict';

  if (window.__TUNO_STATION_CHECKER__) return;
  window.__TUNO_STATION_CHECKER__ = true;

  const IDS = {
    button: 'tuno-check-stations-button',
    panel: 'tuno-check-stations-panel',
    style: 'tuno-check-stations-style'
  };

  const CONFIG = {
    timeout: 12000,
    concurrency: 4,
    deadStore: 'tuno-dead-station-urls-v2',
    rowSelectors: [
      '[data-station]', '[data-station-id]', '[data-stream]', '[data-stream-url]',
      '[data-url]', '.station', '.station-card', '.station-item', '.radio-station',
      '.radio-card', '.station-row', '.row[data-id]', '.tile[data-id]', '.slot[data-id]',
      'li[class*="station"]',
      'article[class*="station"]', 'a[href*="station"]'
    ].join(','),
    urlAttributes: [
      'data-stream', 'data-stream-url', 'data-streamurl', 'data-audio',
      'data-audio-url', 'data-radio-url', 'data-url', 'data-src', 'src', 'href'
    ]
  };

  let running = false;
  let cancelled = false;
  let mutationTimer = 0;

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  function injectStyle() {
    if (document.getElementById(IDS.style)) return;
    const style = document.createElement('style');
    style.id = IDS.style;
    style.textContent = `
      #${IDS.button}{position:fixed!important;right:max(16px,env(safe-area-inset-right))!important;bottom:max(18px,env(safe-area-inset-bottom))!important;z-index:2147483646!important;display:flex!important;align-items:center!important;gap:8px!important;min-height:48px!important;padding:0 18px!important;border:0!important;border-radius:999px!important;background:#7c3aed!important;color:#fff!important;font:700 14px/1 system-ui,-apple-system,Segoe UI,sans-serif!important;box-shadow:0 10px 30px rgba(0,0,0,.35)!important;cursor:pointer!important;opacity:1!important;visibility:visible!important;transform:none!important}
      #${IDS.button}:hover{background:#6d28d9!important}#${IDS.button}:disabled{cursor:wait!important;opacity:.85!important}
      #${IDS.panel}{position:fixed!important;right:16px!important;bottom:78px!important;z-index:2147483646!important;width:min(380px,calc(100vw - 32px))!important;max-height:min(65vh,520px)!important;overflow:auto!important;padding:16px!important;border:1px solid rgba(255,255,255,.15)!important;border-radius:16px!important;background:#111827!important;color:#f9fafb!important;box-shadow:0 18px 50px rgba(0,0,0,.45)!important;font:14px/1.45 system-ui,-apple-system,Segoe UI,sans-serif!important}
      #${IDS.panel}[hidden]{display:none!important}.tuno-sc-title{font-size:16px;font-weight:800;margin-bottom:8px}.tuno-sc-progress{height:8px;background:#374151;border-radius:99px;overflow:hidden;margin:10px 0}.tuno-sc-bar{height:100%;width:0;background:#22c55e;transition:width .2s}.tuno-sc-actions{display:flex;gap:8px;margin-top:12px}.tuno-sc-actions button{border:0;border-radius:10px;padding:9px 12px;font-weight:700;cursor:pointer}.tuno-sc-stop{background:#ef4444;color:#fff}.tuno-sc-close{background:#374151;color:#fff}.tuno-station-dead{display:none!important}
      @media(max-width:600px){#${IDS.button}{right:12px!important;bottom:12px!important;min-height:46px!important;padding:0 14px!important}#${IDS.panel}{right:10px!important;bottom:70px!important;width:calc(100vw - 20px)!important}}
    `;
    (document.head || document.documentElement).appendChild(style);
  }

  function ensureUI() {
    injectStyle();
    let panel = document.getElementById(IDS.panel);
    if (!panel) {
      panel = document.createElement('section');
      panel.id = IDS.panel;
      panel.hidden = true;
      panel.setAttribute('role', 'status');
      panel.innerHTML = `<div class="tuno-sc-title">Station checker</div><div class="tuno-sc-text">Ready.</div><div class="tuno-sc-progress"><div class="tuno-sc-bar"></div></div><div class="tuno-sc-actions"><button class="tuno-sc-stop" type="button">Stop</button><button class="tuno-sc-close" type="button">Close</button></div>`;
      document.body.appendChild(panel);
      panel.querySelector('.tuno-sc-stop').addEventListener('click', () => { cancelled = true; });
      panel.querySelector('.tuno-sc-close').addEventListener('click', () => { panel.hidden = true; });
    }

    let button = document.getElementById(IDS.button);
    if (!button) {
      button = document.createElement('button');
      button.id = IDS.button;
      button.type = 'button';
      button.innerHTML = '<span aria-hidden="true">✓</span><span>Check stations</span>';
      button.addEventListener('click', checkAllStations);
      document.body.appendChild(button);
    } else if (!button.isConnected || button.parentElement !== document.body) {
      document.body.appendChild(button);
    }
    return { button, panel };
  }

  function normalizeUrl(value) {
    if (!value || typeof value !== 'string') return '';
    value = value.trim().replace(/&amp;/g, '&');
    if (!/^(https?:|blob:)/i.test(value)) return '';
    try { return new URL(value, location.href).href; } catch { return ''; }
  }

  function urlFromObject(obj) {
    if (!obj || typeof obj !== 'object') return '';
    for (const key of ['url_resolved','url','streamUrl','stream_url','stream','src','listenUrl','listen_url']) {
      const url = normalizeUrl(obj[key]);
      if (url) return url;
    }
    return '';
  }

  function extractUrl(row) {
    // TUNO keeps station data in window.currentStations and renders rows with data-id.
    // Resolve the stream directly from that array, so index.html does not need data-stream attributes.
    const stationId = row && row.dataset ? row.dataset.id : '';
    if (stationId && Array.isArray(window.currentStations)) {
      const station = window.currentStations.find(item => String(item && item.id) === String(stationId));
      const currentUrl = normalizeUrl(
        station && station.stream && (station.stream.url_resolved || station.stream.url) ||
        station && (station.url_resolved || station.url || station.streamUrl || station.stream_url)
      );
      if (currentUrl) return currentUrl;
    }

    const nodes = [row, ...row.querySelectorAll('audio,source,[data-stream],[data-stream-url],[data-url],[data-src],a[href]')];
    for (const node of nodes) {
      for (const attr of CONFIG.urlAttributes) {
        const url = normalizeUrl(node.getAttribute && node.getAttribute(attr));
        if (url && !/\.(?:html?|php)(?:[?#]|$)/i.test(url)) return url;
      }
    }
    const props = ['station','radio','item'];
    for (const prop of props) {
      const url = urlFromObject(row[prop]);
      if (url) return url;
    }
    return '';
  }

  function getRows() {
    const found = new Set(document.querySelectorAll(CONFIG.rowSelectors));
    document.querySelectorAll('audio, audio source').forEach(media => {
      const row = media.closest(CONFIG.rowSelectors) || media.closest('li,article,[role="listitem"],div');
      if (row) found.add(row);
    });
    return [...found].filter(row => !row.closest(`#${IDS.panel}`) && extractUrl(row));
  }

  function storedDead() {
    try { return new Set(JSON.parse(localStorage.getItem(CONFIG.deadStore) || '[]')); }
    catch { return new Set(); }
  }

  function saveDead(set) {
    try { localStorage.setItem(CONFIG.deadStore, JSON.stringify([...set].slice(-5000))); } catch {}
  }

  function markDead(row, url, dead) {
    dead.add(url);
    row.classList.add('tuno-station-dead');
    row.dataset.stationCheck = 'dead';
    row.setAttribute('aria-hidden', 'true');
  }

  function applySavedDead() {
    const dead = storedDead();
    if (!dead.size) return;
    getRows().forEach(row => {
      const url = extractUrl(row);
      if (dead.has(url)) markDead(row, url, dead);
    });
  }

  function testStream(url) {
    return new Promise(resolve => {
      const audio = new Audio();
      let done = false;
      const finish = ok => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        audio.pause();
        audio.removeAttribute('src');
        audio.load();
        resolve(ok);
      };
      const timer = setTimeout(() => finish(false), CONFIG.timeout);
      audio.preload = 'metadata';
      audio.muted = true;
      audio.addEventListener('loadedmetadata', () => finish(true), { once: true });
      audio.addEventListener('canplay', () => finish(true), { once: true });
      audio.addEventListener('playing', () => finish(true), { once: true });
      audio.addEventListener('error', () => finish(false), { once: true });
      audio.src = url;
      audio.load();
    });
  }

  async function checkAllStations() {
    if (running) return;
    const { button, panel } = ensureUI();
    const text = panel.querySelector('.tuno-sc-text');
    const bar = panel.querySelector('.tuno-sc-bar');
    panel.hidden = false;
    cancelled = false;

    const rows = getRows();
    if (!rows.length) {
      text.textContent = 'No stream URLs were found in the visible results. Add data-stream="STREAM_URL" to each station row.';
      bar.style.width = '0%';
      return;
    }

    running = true;
    button.disabled = true;
    button.querySelector('span:last-child').textContent = 'Checking…';
    const dead = storedDead();
    let next = 0, checked = 0, removed = 0, working = 0;

    const update = () => {
      text.textContent = `Checked ${checked}/${rows.length} • Working ${working} • Removed ${removed}`;
      bar.style.width = `${Math.round((checked / rows.length) * 100)}%`;
    };
    update();

    async function worker() {
      while (!cancelled) {
        const index = next++;
        if (index >= rows.length) return;
        const row = rows[index];
        const url = extractUrl(row);
        let ok = !dead.has(url) && await testStream(url);
        if (ok) {
          working++;
          row.dataset.stationCheck = 'working';
        } else {
          markDead(row, url, dead);
          removed++;
        }
        checked++;
        update();
        await sleep(30);
      }
    }

    await Promise.all(Array.from({ length: Math.min(CONFIG.concurrency, rows.length) }, worker));
    saveDead(dead);
    text.textContent = cancelled
      ? `Stopped. Checked ${checked}/${rows.length}; removed ${removed}.`
      : `Finished. ${working} working; ${removed} unavailable stations removed.`;
    running = false;
    button.disabled = false;
    button.querySelector('span:last-child').textContent = 'Check stations';
  }

  function boot() {
    if (!document.body) return;
    ensureUI();
    applySavedDead();
    const observer = new MutationObserver(() => {
      clearTimeout(mutationTimer);
      mutationTimer = setTimeout(() => {
        ensureUI();
        applySavedDead();
      }, 250);
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    window.addEventListener('pageshow', ensureUI);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) ensureUI(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
