/*
check_stations.js
RadioAXAR / TUNO station checker

Features:
- Reliable "Check All Stations" button injection
- Works with dynamic page rendering
- Detects playable and dead stations
- Saves dead stations in localStorage
- Saves working stations in localStorage
- Removes dead stations from current list
- Adds debug logging
*/

(function () {
  "use strict";

  const DEAD_KEY = "radioaxar_dead_v2";
  const WORKING_KEY = "radioaxar_working_v2";
  const INJECTION_TIMEOUT = 10000;

  function loadDeadSet() {
    try {
      return new Set(JSON.parse(localStorage.getItem(DEAD_KEY)) || []);
    } catch {
      return new Set();
    }
  }

  function saveDeadSet(set) {
    try {
      localStorage.setItem(DEAD_KEY, JSON.stringify([...set]));
    } catch {}
  }

  function loadWorkingSet() {
    try {
      return new Set(JSON.parse(localStorage.getItem(WORKING_KEY)) || []);
    } catch {
      return new Set();
    }
  }

  function saveWorkingSet(set) {
    try {
      localStorage.setItem(WORKING_KEY, JSON.stringify([...set]));
    } catch {}
  }

  function showToast(msg) {
    try {
      if (typeof toast === "function") {
        toast(msg);
      } else {
        console.log("[StationCheck]", msg);
      }
    } catch {
      console.log(msg);
    }
  }

  function removeRowByStationId(id) {
    try {
      const esc =
        window.CSS && CSS.escape
          ? CSS.escape(String(id))
          : String(id).replace(/"/g, '\\"');

      const selectors = [
        `[data-id="${esc}"]`,
        `[data-station-id="${esc}"]`,
        `[data-key="${esc}"]`
      ];

      for (const selector of selectors) {
        const el = document.querySelector(selector);
        if (el) {
          el.remove();
          return true;
        }
      }
    } catch (e) {
      console.error(e);
    }

    return false;
  }

  async function probeStream(url, timeout = 10000) {
    if (!url || !/^https?:\/\//i.test(url)) {
      return false;
    }

    return new Promise((resolve) => {
      let done = false;

      const finish = (result) => {
        if (done) return;
        done = true;

        clearTimeout(timer);

        try {
          audio.pause();
          audio.removeAttribute("src");
          audio.load();
        } catch {}

        try {
          audio.remove();
        } catch {}

        resolve(result);
      };

      const timer = setTimeout(() => finish(false), timeout);

      const audio = document.createElement("audio");

      audio.style.display = "none";
      audio.preload = "auto";
      audio.muted = true;

      document.body.appendChild(audio);

      audio.addEventListener(
        "loadedmetadata",
        () => finish(true),
        { once: true }
      );

      audio.addEventListener(
        "canplay",
        () => finish(true),
        { once: true }
      );

      audio.addEventListener(
        "playing",
        () => finish(true),
        { once: true }
      );

      audio.addEventListener(
        "error",
        () => finish(false),
        { once: true }
      );

      try {
        audio.src = url;
        audio.load();
      } catch {
        finish(false);
      }
    });
  }

  async function pMap(list, concurrency, mapper) {
    const result = new Array(list.length);

    let index = 0;

    const workers = new Array(Math.max(1, concurrency))
      .fill(null)
      .map(async () => {
        while (index < list.length) {
          const current = index++;

          try {
            result[current] = await mapper(list[current], current);
          } catch (e) {
            result[current] = {
              error: e
            };
          }
        }
      });

    await Promise.all(workers);

    return result;
  }

  async function checkAllStationsForCurrentCountry({
    concurrency = 3,
    timeout = 10000
  } = {}) {

    if (!window.route || !window.route.code) {
      showToast("Open a country page first.");
      return;
    }

    const code = window.route.code;

    console.log("Checking country:", code);

    let stationData;

    try {
      stationData = await getCountry(code);
    } catch (e) {
      console.error(e);
      showToast("Could not load stations.");
      return;
    }

    const stations = Array.isArray(stationData)
      ? stationData
      : Array.isArray(stationData?.stations)
      ? stationData.stations
      : [];

    console.log("Loaded stations:", stations.length);

    const candidates = stations.filter(
      (s) =>
        s &&
        s.stream &&
        typeof s.stream.url === "string" &&
        s.stream.url.startsWith("https")
    );

    if (!candidates.length) {
      showToast("No stations found.");
      return;
    }

    const deadSet = loadDeadSet();
    const workingSet = loadWorkingSet();

    let removedAlreadyDead = 0;

    for (const station of candidates) {
      const id = String(
        station.id ||
        station.name ||
        station.stream.url
      );

      if (deadSet.has(id)) {
        if (removeRowByStationId(id)) {
          removedAlreadyDead++;
        }
      }
    }

    showToast(
      `Checking ${candidates.length} stations...`
    );

    const results = await pMap(
      candidates,
      concurrency,
      async (station) => {
        const id = String(
          station.id ||
          station.name ||
          station.stream.url
        );

        if (deadSet.has(id)) {
          return {
            id,
            ok: false,
            skipped: true
          };
        }

        const ok = await probeStream(
          station.stream.url,
          timeout
        );

        return {
          id,
          ok,
          station
        };
      }
    );

    let deadCount = 0;
    let workingCount = 0;
    let removedCount = 0;

    for (const result of results) {

      if (!result) continue;

      const id = String(result.id);

      if (result.ok) {

        workingSet.add(id);
        deadSet.delete(id);

        workingCount++;

      } else {

        deadSet.add(id);
        workingSet.delete(id);

        deadCount++;

        if (removeRowByStationId(id)) {
          removedCount++;
        }
      }
    }

    saveDeadSet(deadSet);
    saveWorkingSet(workingSet);

    console.log({
      workingCount,
      deadCount,
      removedCount
    });

    showToast(
      `Working: ${workingCount} | Dead: ${deadCount}`
    );

    try {
      if (typeof countryDraw === "function") {
        countryDraw();
      }

      if (typeof homeDraw === "function") {
        homeDraw();
      }
    } catch (e) {
      console.error(e);
    }
  }

  function createButton() {

    const btn = document.createElement("button");

    btn.id = "radioaxar-check-btn";
    btn.type = "button";
    btn.textContent = "Check All Stations";

    btn.style.cssText = `
      margin-left:8px;
      padding:10px 15px;
      border-radius:999px;
      border:1px solid rgba(255,255,255,.15);
      background:#2563eb;
      color:white;
      font-weight:700;
      cursor:pointer;
      z-index:9999;
    `;

    btn.addEventListener("click", async () => {
      btn.disabled = true;

      try {
        await checkAllStationsForCurrentCountry();
      } finally {
        btn.disabled = false;
      }
    });

    return btn;
  }

  function findHost() {

    return (
      document.querySelector(".actions") ||
      document.querySelector(".header-actions") ||
      document.querySelector(".fixed") ||
      document.querySelector(".top") ||
      document.querySelector("header") ||
      document.querySelector("#view") ||
      document.body
    );
  }

  function addButton() {

    if (document.getElementById("radioaxar-check-btn")) {
      return true;
    }

    const host = findHost();

    if (!host) {
      return false;
    }

    try {
      host.appendChild(createButton());

      console.log(
        "Station checker button injected."
      );

      return true;

    } catch (e) {

      console.error(e);
      return false;
    }
  }

  function installInjection() {

    if (addButton()) {
      return;
    }

    if (document.readyState === "loading") {
      document.addEventListener(
        "DOMContentLoaded",
        addButton,
        { once: true }
      );
    } else {
      addButton();
    }

    const observer = new MutationObserver(() => {
      if (addButton()) {
        observer.disconnect();
      }
    });

    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });

    setTimeout(() => {

      if (!document.getElementById("radioaxar-check-btn")) {

        try {
          document.body.appendChild(
            createButton()
          );

          console.log(
            "Fallback button injected."
          );

        } catch (e) {
          console.error(e);
        }
      }

      observer.disconnect();

    }, INJECTION_TIMEOUT);
  }

  try {
    installInjection();
  } catch (e) {
    console.error("Injection failed:", e);
  }

  window._radioaxar_check =
    checkAllStationsForCurrentCountry;

  window._radioaxar_clear_dead = () => {
    localStorage.removeItem(DEAD_KEY);
    showToast("Dead station cache cleared.");
  };

  window._radioaxar_clear_working = () => {
    localStorage.removeItem(WORKING_KEY);
    showToast("Working station cache cleared.");
  };

})();
