/*
 * AIR-Runtime / ruffle-loader.js
 * -------------------------------
 * Creates the Ruffle player and loads a SWF into it.
 *
 * The engine is a patched build of Ruffle (https://ruffle.rs) vendored in
 * vendor/ruffle/ - see AIR-Runtime/README.md and ruffle-patches/ for what was
 * changed and how to rebuild it. Stock Ruffle cannot run this game: it runs out
 * of WebAssembly memory while loading, and its AIR file classes are empty stubs.
 *
 * Also tracks download progress of every .swf Ruffle fetches (the hub movie and
 * the three chapter files it loads itself), so the page can show a progress bar.
 */

(function () {
  const RUFFLE_SOURCE = "AIR-Runtime/vendor/ruffle/ruffle.js";

  // Ruffle can't see installed fonts on the web; these metric-compatible open
  // fonts (SIL OFL, see fonts/) stand in for Flash's generic _sans/_serif.
  const FONT_DIR = new URL("AIR-Runtime/fonts/", document.baseURI).href;
  const FONT_SOURCES = [
    "LiberationSans-Regular.ttf",
    "LiberationSans-Bold.ttf",
    "LiberationSerif-Regular.ttf",
    "LiberationSerif-Bold.ttf",
  ].map((f) => FONT_DIR + f);

  window.AIRRuntime = window.AIRRuntime || {};

  // ---- download progress ---------------------------------------------------
  // Ruffle's WebAssembly fetches through window.fetch, looked up at call time,
  // so wrapping it here sees every SWF request - including the chapter files
  // the game loads with its own Loader objects.
  const downloads = new Map(); // url -> { loaded, total, done }
  let progressListener = null;

  function reportProgress() {
    if (!progressListener) return;
    let loaded = 0, total = 0, active = 0;
    downloads.forEach((d) => {
      loaded += d.loaded;
      total += d.total || d.loaded;
      if (!d.done) active++;
    });
    progressListener({ loaded, total, active, files: downloads.size });
  }

  const realFetch = window.fetch.bind(window);

  // ---- split files -----------------------------------------------------------
  // Files over 100 MB can be stored as parts (see split-files.py at the project
  // root), listed in Game Files/split-files.json:
  //   { "Henry.swf": { "size": 122379723, "sha256": "...", "parts": ["Henry.swf.part1", ...] } }
  // A request for Henry.swf is answered with the parts streamed back to back, so
  // Ruffle and the game see one ordinary file at its usual URL.
  const SPLIT_MANIFEST_URL = new URL("Game Files/split-files.json", document.baseURI).href;
  let splitManifestPromise = null;

  function splitManifest() {
    if (!splitManifestPromise) {
      splitManifestPromise = realFetch(SPLIT_MANIFEST_URL, { cache: "no-cache" })
        .then((res) => (res.ok ? res.json() : {}))
        .catch(() => ({}))
        .then((raw) => {
          const byUrl = new Map();
          for (const [name, entry] of Object.entries(raw || {})) {
            if (!entry || !Array.isArray(entry.parts) || !entry.parts.length) continue;
            byUrl.set(new URL(name, SPLIT_MANIFEST_URL).href, {
              size: Number(entry.size) || 0,
              partUrls: entry.parts.map((p) => new URL(p, SPLIT_MANIFEST_URL).href),
            });
          }
          return byUrl;
        });
    }
    return splitManifestPromise;
  }

  /**
   * Size in bytes of the file at `url`, or null if it can't be fetched.
   * Uses GET and cancels the download as soon as the headers arrive, instead of
   * HEAD: some static hosts and CDNs (raw.githack.com, for one) answer every HEAD
   * request with 403 Forbidden even for files that exist.
   */
  async function probeSize(url) {
    const controller = new AbortController();
    try {
      const res = await realFetch(url, { cache: "no-cache", signal: controller.signal });
      const size = res.ok ? Number(res.headers.get("content-length")) || 0 : null;
      controller.abort();
      return size;
    } catch (e) {
      controller.abort();
      return null;
    }
  }

  /** The split entry ({ size, partUrls }) for a URL, or null if it isn't split. */
  async function splitEntryFor(url) {
    const clean = new URL(url, document.baseURI);
    clean.search = "";
    clean.hash = "";
    return (await splitManifest()).get(clean.href) || null;
  }

  function joinedResponse(entry, init) {
    let index = 0;
    let reader = null;
    const body = new ReadableStream({
      async pull(controller) {
        for (;;) {
          if (!reader) {
            if (index >= entry.partUrls.length) {
              controller.close();
              return;
            }
            const partUrl = entry.partUrls[index++];
            const res = await realFetch(partUrl, { signal: init && init.signal });
            if (!res.ok || !res.body) {
              controller.error(new Error("Could not load " + partUrl + " (HTTP " + res.status + ")"));
              return;
            }
            reader = res.body.getReader();
          }
          const { done, value } = await reader.read();
          if (done) {
            reader = null;
            continue;
          }
          controller.enqueue(value);
          return;
        }
      },
      cancel(reason) {
        if (reader) reader.cancel(reason);
      },
    });
    return new Response(body, {
      status: 200,
      headers: { "Content-Type": "application/x-shockwave-flash", "Content-Length": String(entry.size) },
    });
  }

  window.fetch = async function (input, init) {
    const url = typeof input === "string" ? input : (input && input.url) || String(input);
    const isSwf = /\.swf(\?|#|$)/i.test(url);
    const method = ((init && init.method) || (input && input.method) || "GET").toUpperCase();

    let response;
    const split = isSwf && method === "GET" ? await splitEntryFor(url) : null;
    if (split) {
      // Missing parts surface as a stream error when the joined body is read.
      response = joinedResponse(split, init);
    } else {
      response = await realFetch(input, init);
    }
    if (!isSwf || !response.body || !response.ok) return response;

    const entry = { loaded: 0, total: Number(response.headers.get("content-length")) || 0, done: false };
    downloads.set(url, entry);
    reportProgress();
    const counter = new TransformStream({
      transform(chunk, controller) {
        entry.loaded += chunk.byteLength;
        reportProgress();
        controller.enqueue(chunk);
      },
      flush() {
        entry.done = true;
        reportProgress();
      },
    });
    return new Response(response.body.pipeThrough(counter), {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };

  // ---- audio unlock -----------------------------------------------------------
  // Browsers keep audio suspended until the first click, and this game's intro is
  // synced to streamed audio, so it waits on a black frame until then. Keep hold
  // of the AudioContext(s) Ruffle creates so the page can resume them from its
  // own "click to start" prompt without passing that click to the game.
  const audioContexts = [];
  const NativeAudioContext = window.AudioContext || window.webkitAudioContext;
  if (NativeAudioContext) {
    const Tracked = class extends NativeAudioContext {
      constructor(...args) {
        super(...args);
        audioContexts.push(this);
      }
    };
    window.AudioContext = Tracked;
    if (window.webkitAudioContext) window.webkitAudioContext = Tracked;
  }

  function audioBlocked() {
    return audioContexts.some((c) => c.state === "suspended");
  }

  function resumeAudio() {
    return Promise.all(audioContexts.map((c) => (c.state === "suspended" ? c.resume() : null)));
  }

  function onAudioUnblocked(callback) {
    for (const c of audioContexts) {
      c.addEventListener("statechange", () => { if (!audioBlocked()) callback(); });
    }
  }

  // ---- Ruffle ---------------------------------------------------------------
  let readyPromise = null;

  function ensureRuffle() {
    if (readyPromise) return readyPromise;
    window.RufflePlayer = window.RufflePlayer || {};
    window.RufflePlayer.config = Object.assign(
      { polyfills: false, fontSources: FONT_SOURCES, defaultFonts: { sans: ["Liberation Sans"], serif: ["Liberation Serif"] } },
      window.RufflePlayer.config || {}
    );
    readyPromise = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = RUFFLE_SOURCE;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("Failed to load " + RUFFLE_SOURCE));
      document.head.appendChild(s);
    }).then(() => {
      if (!window.RufflePlayer || typeof window.RufflePlayer.newest !== "function") {
        throw new Error("Ruffle loaded but window.RufflePlayer.newest() is missing.");
      }
      return window.RufflePlayer.newest();
    });
    readyPromise.catch(() => { readyPromise = null; });
    return readyPromise;
  }

  /**
   * Loads a .swf into mountEl.
   * @param {HTMLElement} mountEl
   * @param {string} swfUrl
   * @param {object} [opts] - { base, renderer, logLevel, onProgress, onTrace }
   * @returns {Promise<HTMLElement>} the Ruffle player element
   */
  async function loadSwf(mountEl, swfUrl, opts) {
    opts = opts || {};
    progressListener = opts.onProgress || null;
    downloads.clear();
    const ruffle = await ensureRuffle();
    unload(mountEl);

    const player = ruffle.createPlayer();
    player.style.width = "100%";
    player.style.height = "100%";
    mountEl.appendChild(player);

    const config = {
      // Absolute URLs: Ruffle derives the movie's security sandbox from them.
      url: new URL(swfUrl, document.baseURI).href,
      base: opts.base ? new URL(opts.base, document.baseURI).href : undefined,
      // AIR mode exposes flash.desktop / flash.filesystem (patched, see README).
      playerRuntime: "air",
      // The AIR file classes reach the page via ExternalInterface (air-fs.js).
      allowScriptAccess: true,
      // The page's "Play" button already provided the user gesture audio needs.
      autoplay: "on",
      unmuteOverlay: "hidden",
      splashScreen: false,
      letterbox: "on",
      backgroundColor: "#000000",
      allowFullscreen: true,
      // The game uses right-click itself (right-click a character to unlock their
      // bio), so Ruffle's own context menu must not pop up over it.
      contextMenu: "off",
      preferredRenderer: opts.renderer || null,
      logLevel: opts.logLevel || "error",
      // Don't let Ruffle's own "this is taking a while" / version prompts appear.
      warnOnUnsupportedContent: false,
      showSwfDownload: false,
    };
    await player.ruffle().load(config);
    // The game's trace() output, e.g. to tell which screen is showing.
    if (opts.onTrace) player.ruffle().traceObserver = opts.onTrace;
    return player;
  }

  function unload(mountEl) {
    mountEl.querySelectorAll("ruffle-player, ruffle-object, ruffle-embed").forEach((p) => {
      try { p.ruffle && p.ruffle().destroy ? p.ruffle().destroy() : p.remove(); } catch (e) { /* already gone */ }
    });
    mountEl.innerHTML = "";
  }

  window.AIRRuntime.ensureRuffle = ensureRuffle;
  window.AIRRuntime.loadSwf = loadSwf;
  window.AIRRuntime.unload = unload;
  window.AIRRuntime.splitEntryFor = splitEntryFor;
  window.AIRRuntime.probeSize = probeSize;
  window.AIRRuntime.audioBlocked = audioBlocked;
  window.AIRRuntime.resumeAudio = resumeAudio;
  window.AIRRuntime.onAudioUnblocked = onAudioUnblocked;
})();
