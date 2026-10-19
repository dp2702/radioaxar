/*
check_stations.js (updated)
Improved injection: more robustly inserts the "Check all stations" button by:
 - trying right away,
 - listening for DOMContentLoaded,
 - observing DOM mutations to detect when header (.fixed or .top) appears,
 - falling back to appending to body after a timeout.
Also adds safer CSS.escape fallback and defensive checks.
*/

(function () {
  'use strict';

  const DEAD_KEY = 'radioaxar_dead_v1';
  const INJECTION_TIMEOUT = 8000; // ms: how long to keep trying to inject the button

  function loadDeadSet() {
    try { return new Set(JSON.parse(localStorage.getItem(DEAD_KEY)) || []); } catch { return new Set(); }
  }
  function saveDeadSet(set) {
    try { localStorage.setItem(DEAD_KEY, JSON.stringify([...set])); } catch {}
  }

  function showToast(msg) {
    try { if (typeof toast === 'function') toast(msg); else console.log('TUNO:', msg); } catch (e) { console.log(msg); }
  }

  function removeRowByStationId(id) {
    try {
      const esc = (window.CSS && CSS.escape) ? CSS.escape(String(id)) : String(id).replace(/"/g, '\\"');
      const sel = `[data-id="${esc}"]`;
      const el = document.querySelector(sel);
      if (el) el.remove();
      return !!el;
    } catch (e) { return false; }
  }

  async function probeStream(url, timeout = 7000) {
    if (!/^https?:\/\//i.test(url)) return false;

    const isHls = /\.m3u8(\?|$)/i.test(url);

    return new Promise(async (resolve) => {
      let done = false;
      const finish = (ok) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        cleanup().catch(()=>{});
        resolve(!!ok);
      };

      const timer = setTimeout(() => finish(false), timeout);

      const a = document.createElement('audio');
      a.muted = true; a.volume = 0; a.preload = 'none'; a.playsInline = true; a.style.display = 'none';
      document.body.appendChild(a);

      async function cleanup() {
        try { a.pause(); a.removeAttribute('src'); a.src = ''; a.remove(); } catch (e) {}
      }

      if (isHls && window.Hls && typeof window.Hls.isSupported === 'function' && window.Hls.isSupported()) {
        try {
          const hls = new window.Hls();
          hls.on(window.Hls.Events.ERROR, (_, data) => { if (data && data.fatal) { try { hls.destroy(); } catch {} finish(false); } });
          try { hls.attachMedia(a); hls.loadSource(url); } catch (e) { try { hls.destroy(); } catch {} finish(false); return; }

          const onPlaying = () => { try { hls.destroy(); } catch {} finish(true); };
          const onTime = () => { try { hls.destroy(); } catch {} finish(true); };
          const onError = () => { try { hls.destroy(); } catch {} finish(false); };

          a.addEventListener('playing', onPlaying, { once: true });
          a.addEventListener('timeupdate', onTime, { once: true });
          a.addEventListener('error', onError, { once: true });

          try { a.load(); const p = a.play(); if (p && typeof p.then === 'function') p.catch(()=>{}); } catch (e) {}
          return;
        } catch (e) {}
      }

      const onPlaying = () => finish(true);
      const onTime = () => finish(true);
      const onError = () => finish(false);
      a.addEventListener('playing', onPlaying, { once: true });
      a.addEventListener('timeupdate', onTime, { once: true });
      a.addEventListener('error', onError, { once: true });

      try { a.src = url; a.load(); const p = a.play(); if (p && typeof p.then === 'function') p.catch(() => {}); }
      catch (e) { finish(false); }
    });
  }

  async function pMap(list, concurrency, mapper) {
    const result = new Array(list.length);
    let idx = 0;
    const runners = new Array(Math.max(1, concurrency)).fill(0).map(async () => {
      while (idx < list.length) { const i = idx++; try { result[i] = await mapper(list[i], i); } catch (e) { result[i] = { error: e }; } }
    });
    await Promise.all(runners);
    return result;
  }

  async function checkAllStationsForCurrentCountry({ concurrency = 3, timeout = 7000 } = {}) {
    if (!window.route || !route.code) { showToast('Open a country page first (tap a country).'); return; }
    const code = route.code;
    showToast('Loading stations…');
    let stationList;
    try { stationList = await getCountry(code); } catch (e) { showToast('Could not fetch stations for this country.'); return; }

    const candidates = stationList.filter(s => s && s.stream && typeof s.stream.url === 'string' && s.stream.url.startsWith('https:'));
    if (!candidates.length) { showToast('No https stations found on this country page.'); return; }

    const deadSet = loadDeadSet();
    let removed = 0;
    for (const s of candidates) { if (deadSet.has(String(s.id))) { if (removeRowByStationId(s.id)) removed++; } }
    showToast(`Checking ${candidates.length} stations (skipped ${removed} known-dead) …`);

    const results = await pMap(candidates, concurrency, async (s) => {
      const id = String(s.id || s.name || s.stream.url);
      if (deadSet.has(id)) return { id, ok: false, reason: 'known-dead' };
      let ok = false;
      try { ok = await probeStream(s.stream.url, timeout); } catch (e) { ok = false; }
      return { id, ok, url: s.stream.url, station: s };
    });

    let newlyRemoved = 0;
    for (const r of results) {
      if (!r.ok) { deadSet.add(String(r.id)); if (removeRowByStationId(r.id)) newlyRemoved++; } else { deadSet.delete(String(r.id)); }
    }
    saveDeadSet(deadSet);

    if (newlyRemoved || removed) showToast(`${newlyRemoved + removed} station(s) removed.`);
    else showToast('No more dead stations detected (or network blocked checks).');

    try { if (typeof countryDraw === 'function') countryDraw(); if (typeof homeDraw === 'function') homeDraw(); } catch (e) {}
  }

  function createButton() {
    const btn = document.createElement('button');
    btn.id = 'radioaxar-check-btn'; btn.type = 'button'; btn.textContent = 'Check all stations';
    btn.style.cssText = 'margin-left:8px;padding:9px 14px;border-radius:999px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.04);color:var(--text);font-weight:700;cursor:pointer;';
    btn.addEventListener('click', async () => { btn.disabled = true; try { await checkAllStationsForCurrentCountry(); } finally { btn.disabled = false; } });
    return btn;
  }

  function addButtonImmediate() {
    if (document.getElementById('radioaxar-check-btn')) return true;
    const host = document.querySelector('.fixed') || document.querySelector('.top') || document.querySelector('#view') || document.body;
    if (!host) return false;
    try { host.appendChild(createButton()); return true; } catch (e) { return false; }
  }

  function installInjection() {
    // try immediate
    if (addButtonImmediate()) return;

    // try on DOMContentLoaded
    function onReady() { addButtonImmediate(); }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', onReady); else onReady();

    // mutation observer for dynamic headers
    const obs = new MutationObserver(() => { if (addButtonImmediate()) obs.disconnect(); });
    obs.observe(document.documentElement || document.body, { childList: true, subtree: true });

    // fallback timeout: after INJECTION_TIMEOUT append to body if still not inserted
    setTimeout(() => { if (!document.getElementById('radioaxar-check-btn')) { try { document.body.appendChild(createButton()); } catch (e) {} } obs.disconnect(); }, INJECTION_TIMEOUT);
  }

  // Start injection process
  try { installInjection(); } catch (e) { console.error('check_stations injection failed', e); }

  // Expose control functions
  window._radioaxar_check = checkAllStationsForCurrentCountry;
  window._radioaxar_clear_dead = function() { localStorage.removeItem(DEAD_KEY); showToast('Cleared saved dead stations'); };

})();
