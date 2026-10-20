(function () {
  "use strict";

  const DEAD_KEY = "radioaxar_dead_v3";

  function toastMsg(msg) {
    try {
      if (typeof toast === "function") {
        toast(msg);
      } else {
        console.log(msg);
      }
    } catch {
      console.log(msg);
    }
  }

  function loadDeadSet() {
    try {
      return new Set(JSON.parse(localStorage.getItem(DEAD_KEY)) || []);
    } catch {
      return new Set();
    }
  }

  function saveDeadSet(set) {
    localStorage.setItem(DEAD_KEY, JSON.stringify([...set]));
  }

  async function probe(url, timeout = 8000) {
    return new Promise((resolve) => {

      const audio = document.createElement("audio");
      let finished = false;

      const done = (ok) => {
        if (finished) return;
        finished = true;

        clearTimeout(timer);

        try {
          audio.pause();
          audio.src = "";
          audio.remove();
        } catch {}

        resolve(ok);
      };

      const timer = setTimeout(() => done(false), timeout);

      audio.addEventListener("canplay", () => done(true), { once: true });
      audio.addEventListener("loadedmetadata", () => done(true), { once: true });
      audio.addEventListener("playing", () => done(true), { once: true });
      audio.addEventListener("error", () => done(false), { once: true });

      document.body.appendChild(audio);

      try {
        audio.src = url;
        audio.load();
      } catch {
        done(false);
      }
    });
  }

  async function getStations() {

    if (!window.route || !window.route.code) {
      throw new Error("No country selected");
    }

    const result = await getCountry(window.route.code);

    if (Array.isArray(result)) {
      return result;
    }

    if (Array.isArray(result?.stations)) {
      return result.stations;
    }

    return [];
  }
  
async function checkStations() {

    const stations = window.currentStations || [];

    if (!stations.length) {
        toast("No stations loaded");
        return;
    }

    toast(`Checking ${stations.length} stations`);

    const working = [];
    const dead = [];

    for (const station of stations) {

        const ok = await probe(station.stream.url);

        if (ok) {
            working.push(station);
        } else {
            dead.push(station);
        }
    }

    localStorage.setItem(
        "radioaxarWorkingStations",
        JSON.stringify(working)
    );

    localStorage.setItem(
        "radioaxarDeadStations",
        JSON.stringify(dead)
    );

    toast(
        `Done. Working: ${working.length}, Dead: ${dead.length}`
    );

    console.log("WORKING", working);
    console.log("DEAD", dead);
}
  
function createButton() {
  let btn = document.getElementById("radioaxar-check-btn");

  if (btn) return btn;

  btn = document.createElement("button");
  btn.id = "radioaxar-check-btn";
  btn.textContent = "Check Stations";

  btn.style.cssText = `
    position:fixed !important;
    right:20px !important;
    bottom:20px !important;
    z-index:2147483647 !important;
    padding:12px 18px !important;
    border:none !important;
    border-radius:999px !important;
    background:#2563eb !important;
    color:white !important;
    font-weight:bold !important;
    cursor:pointer !important;
    box-shadow:0 4px 12px rgba(0,0,0,.4) !important;
    display:block !important;
    visibility:visible !important;
    opacity:1 !important;
  `;

  btn.onclick = checkStations;

  document.body.appendChild(btn);

  return btn;
}

function keepButtonAlive() {
  createButton();

  setInterval(() => {
    if (!document.getElementById("radioaxar-check-btn")) {
      createButton();
    }
  }, 500);
}

window.addEventListener("load", keepButtonAlive);
document.addEventListener("DOMContentLoaded", keepButtonAlive);
keepButtonAlive();

  window._radioaxar_check = checkStations;
})();
