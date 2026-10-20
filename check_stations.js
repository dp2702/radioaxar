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

    let stations;

    try {
      stations = await getStations();
    } catch (e) {
      toastMsg("Open a country page first");
      return;
    }

    if (!stations.length) {
      toastMsg("No stations found");
      return;
    }

    const candidates = stations.filter(
      s =>
        s &&
        s.stream &&
        typeof s.stream.url === "string" &&
        s.stream.url.startsWith("https")
    );

    if (!candidates.length) {
      toastMsg("No HTTPS stations found");
      return;
    }

    toastMsg(`Checking ${candidates.length} stations`);

    const deadSet = loadDeadSet();

    let working = 0;
    let dead = 0;

    for (const s of candidates) {

      const id = String(
        s.id ||
        s.name ||
        s.stream.url
      );

      const ok = await probe(s.stream.url);

      if (ok) {
        working++;
        deadSet.delete(id);
      } else {
        dead++;
        deadSet.add(id);
      }

      console.log(
        `${ok ? "WORKING" : "DEAD"}:`,
        s.name,
        s.stream.url
      );
    }

    saveDeadSet(deadSet);

    toastMsg(
      `Finished. Working=${working} Dead=${dead}`
    );

    console.log("Working stations:", working);
    console.log("Dead stations:", dead);
  }

  function createFloatingButton() {

    if (document.getElementById("radioaxar-check-btn")) {
      return;
    }

    const btn = document.createElement("button");

    btn.id = "radioaxar-check-btn";

    btn.textContent = "Check Stations";

    btn.style.position = "fixed";
    btn.style.bottom = "24px";
    btn.style.right = "24px";
    btn.style.zIndex = "2147483647";
    btn.style.padding = "14px 18px";
    btn.style.border = "none";
    btn.style.borderRadius = "999px";
    btn.style.background = "#2563eb";
    btn.style.color = "#fff";
    btn.style.cursor = "pointer";
    btn.style.fontWeight = "700";
    btn.style.boxShadow = "0 4px 20px rgba(0,0,0,.4)";
    btn.style.fontSize = "14px";

    btn.onclick = async () => {
      btn.disabled = true;

      try {
        await checkStations();
      } finally {
        btn.disabled = false;
      }
    };

    document.body.appendChild(btn);

    console.log("RadioAXAR floating button created");
  }

  function keepButtonAlive() {

    createFloatingButton();

    setInterval(() => {

      if (!document.getElementById("radioaxar-check-btn")) {
        createFloatingButton();
      }

    }, 1000);
  }

  keepButtonAlive();

  window._radioaxar_check = checkStations;
})();
