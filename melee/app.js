// The player page: finds the disc (a file in this folder, the one kept in
// the browser, or one the player chooses), opens the settings before the
// game starts and from the game, and starts the game (melee.js) on the canvas.

import { Input, ActionNames, DefaultKeys } from './input.js?v=8';

const $ = (id) => document.getElementById(id);

// --- Settings ----------------------------------------------------------------

export const Presets = {
  low: { renderScale: 0.75, frameSkip: 2, msaa: 1, anisotropy: 1, audio: 1, audioEffects: 0, showFps: 0 },
  balanced: { renderScale: 1, frameSkip: 1, msaa: 1, anisotropy: 2, audio: 1, audioEffects: 1, showFps: 0 },
  high: { renderScale: 2, frameSkip: 1, msaa: 4, anisotropy: 4, audio: 1, audioEffects: 1, showFps: 0 },
};

// Settings the game can only take when it starts
const RestartSettings = ['msaa', 'anisotropy'];

function guessPreset() {
  // A rough guess at the device: few cores, little memory or a phone
  const cores = navigator.hardwareConcurrency || 4;
  const memory = navigator.deviceMemory || 8;
  const mobile = /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent);
  if (cores <= 4 || memory <= 4 || mobile) return 'low';
  if (cores >= 8 && memory >= 8) return 'high';
  return 'balanced';
}

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem('melee.settings') || 'null');
    if (saved) return { ...Presets.balanced, ...saved };
  } catch {}
  return { ...Presets[guessPreset()], preset: guessPreset() };
}

function saveSettings(s) {
  try {
    localStorage.setItem('melee.settings', JSON.stringify(s));
  } catch {}
}

// --- The disc ------------------------------------------------------------------
// A disc is { name, size, source, read(offset, length) -> Uint8Array }

const DiscFile = 'disc.iso';
// Which file in this folder the browser's copy came from
const DiscStampKey = 'melee.discStamp';

function fileDisc(file, source) {
  return {
    name: file.name,
    size: file.size,
    source,
    async read(offset, length) {
      return new Uint8Array(await file.slice(offset, offset + length).arrayBuffer());
    },
  };
}

// A disc image the server sends in parts (serve.py, and most servers)
function urlDisc(url, name, size) {
  return {
    name,
    size,
    source: 'folder',
    async read(offset, length) {
      const r = await fetch(url, { headers: { Range: `bytes=${offset}-${offset + length - 1}` } });
      if (r.status !== 206) throw new Error(`disc read failed (${r.status})`);
      return new Uint8Array(await r.arrayBuffer());
    },
  };
}

async function opfsDir() {
  if (!navigator.storage || !navigator.storage.getDirectory) return null;
  try {
    return await navigator.storage.getDirectory();
  } catch {
    return null;
  }
}

async function savedDiscFile() {
  const dir = await opfsDir();
  if (!dir) return null;
  try {
    const file = await (await dir.getFileHandle(DiscFile)).getFile();
    return file.size > 0 ? file : null;
  } catch {
    return null;
  }
}

// Copies the disc into browser storage, from a File or a stream
async function writeSavedDisc(chunks, size, progress) {
  const dir = await opfsDir();
  if (!dir) return null;
  const handle = await dir.getFileHandle(DiscFile, { create: true });
  const writable = await handle.createWritable();
  let done = 0;
  for await (const chunk of chunks) {
    await writable.write(chunk);
    done += chunk.byteLength;
    progress(Math.min(1, done / size));
  }
  await writable.close();
  return await handle.getFile();
}

async function* fileChunks(file) {
  const chunk = 16 * 1024 * 1024;
  for (let off = 0; off < file.size; off += chunk) {
    yield new Uint8Array(await file.slice(off, off + chunk).arrayBuffer());
  }
}

async function* streamChunks(body) {
  const reader = body.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    yield value;
  }
}

async function forgetDisc() {
  const dir = await opfsDir();
  if (dir) {
    try {
      await dir.removeEntry(DiscFile);
    } catch {}
  }
  try {
    localStorage.removeItem(DiscStampKey);
  } catch {}
}

// A disc image in this page's folder: serve.py lists them; otherwise try
// the usual names
async function findFolderDisc() {
  let names = [];
  try {
    const r = await fetch('discs.json', { cache: 'no-store' });
    if (r.ok && (r.headers.get('Content-Type') || '').includes('json')) names = await r.json();
  } catch {}
  if (!names.length) names = ['disc.iso', 'melee.iso', 'game.iso', 'disc.gcm', 'melee.gcm', 'game.gcm'];
  for (const name of names) {
    const url = encodeURIComponent(name);
    try {
      const r = await fetch(url, { headers: { Range: 'bytes=0-31' }, cache: 'no-store' });
      const type = r.headers.get('Content-Type') || '';
      if (r.status === 206) {
        await r.arrayBuffer();
        const m = /\/(\d+)$/.exec(r.headers.get('Content-Range') || '');
        if (m) return { name, url, size: Number(m[1]), ranges: true };
      } else if (r.ok && !type.includes('text/html')) {
        // The server sends whole files only: stop this one
        const size = Number(r.headers.get('Content-Length') || 0);
        const stamp = `${name}|${size}|${r.headers.get('Last-Modified') || ''}`;
        if (r.body) r.body.cancel().catch(() => {});
        if (size > 1024 * 1024) return { name, url, size, ranges: false, stamp };
      } else if (r.body) {
        r.body.cancel().catch(() => {});
      }
    } catch {}
  }
  return null;
}

// The size and version of a file on the server, asking for one byte
async function probeFile(url) {
  try {
    const r = await fetch(url, { headers: { Range: 'bytes=0-0' }, cache: 'no-store' });
    const type = r.headers.get('Content-Type') || '';
    let size = 0;
    if (r.status === 206) {
      const m = /\/(\d+)$/.exec(r.headers.get('Content-Range') || '');
      size = m ? Number(m[1]) : 0;
      await r.arrayBuffer();
    } else if (r.ok && !type.includes('text/html')) {
      size = Number(r.headers.get('Content-Length') || 0);
      if (r.body) r.body.cancel().catch(() => {});
    } else if (r.body) {
      r.body.cancel().catch(() => {});
    }
    return size > 0 ? { url, size, ranges: r.status === 206, modified: r.headers.get('Last-Modified') || '' } : null;
  } catch {
    return null;
  }
}

// A disc image split into numbered parts in the split folder
// (split/melee.iso.part01, part02, ...), for hosts that limit file sizes
async function findSplitDisc() {
  for (const name of ['melee.iso', 'disc.iso', 'game.iso', 'melee.gcm', 'disc.gcm', 'game.gcm']) {
    for (const width of [2, 3]) {
      const partUrl = (i) => `split/${encodeURIComponent(name)}.part${String(i).padStart(width, '0')}`;
      const first = await probeFile(partUrl(1));
      if (!first) continue;
      const parts = [first];
      for (let i = 2; i < 1000; i++) {
        const part = await probeFile(partUrl(i));
        if (!part) break;
        parts.push(part);
      }
      const size = parts.reduce((sum, p) => sum + p.size, 0);
      const stamp = `split:${name}|${parts.map((p) => `${p.size}/${p.modified}`).join(',')}`;
      return { name, parts, size, stamp };
    }
  }
  return null;
}

// The split disc read in place: each read goes to the parts it covers
function splitDisc(found) {
  const starts = [];
  let at = 0;
  for (const p of found.parts) {
    starts.push(at);
    at += p.size;
  }
  return {
    name: found.name,
    size: found.size,
    source: 'folder',
    async read(offset, length) {
      const out = new Uint8Array(length);
      let done = 0;
      for (let i = 0; i < found.parts.length && done < length; i++) {
        const begin = starts[i];
        const end = begin + found.parts[i].size;
        const from = offset + done;
        if (from >= end || from < begin) continue;
        const take = Math.min(length - done, end - from);
        const r = await fetch(found.parts[i].url, { headers: { Range: `bytes=${from - begin}-${from - begin + take - 1}` } });
        if (r.status !== 206) throw new Error(`disc read failed (${r.status})`);
        out.set(new Uint8Array(await r.arrayBuffer()), done);
        done += take;
      }
      return out;
    },
  };
}

// The parts, one after another, as one stream of chunks
async function* splitChunks(found) {
  for (const p of found.parts) {
    const r = await fetch(p.url, { cache: 'no-store' });
    if (!r.ok) throw new Error(`could not download ${p.url} (${r.status})`);
    yield* streamChunks(r.body);
  }
}

// The image must be a plain GameCube disc image (.iso or .gcm) of Super
// Smash Bros. Melee NTSC 1.02 (GALE01, revision 2)
async function checkDisc(disc) {
  const head = await disc.read(0, 0x20);
  const id = String.fromCharCode(...head.slice(0, 6));
  const magic = new DataView(head.buffer, head.byteOffset).getUint32(0x1C);
  if (magic !== 0xC2339F3D) {
    if (String.fromCharCode(...head.slice(0, 4)) === 'RVZ\x01' || /\.rvz$/i.test(disc.name)) {
      return 'This is an RVZ (compressed) image. Convert it to .iso first — in Dolphin: right-click the game › Convert File… › Format: ISO.';
    }
    return 'That doesn’t look like a GameCube disc image (.iso or .gcm).';
  }
  if (id !== 'GALE01') {
    return `This disc is ${id}; the web build needs Super Smash Bros. Melee NTSC (GALE01).`;
  }
  if (head[7] !== 2) {
    return `This is revision 1.0${head[7]}; the web build needs NTSC 1.02.`;
  }
  return null;
}

// --- The memory card ---------------------------------------------------------
// The game's saves: one image, kept next to the disc in browser storage

const CardFile = 'card-a.bin';

function memoryCard() {
  let writing = Promise.resolve();
  return {
    async load() {
      const dir = await opfsDir();
      if (!dir) return null;
      try {
        const file = await (await dir.getFileHandle(CardFile)).getFile();
        return new Uint8Array(await file.arrayBuffer());
      } catch {
        return null;
      }
    },
    save(bytes) {
      // Writes go in order; each replaces the whole image
      writing = writing.then(async () => {
        const dir = await opfsDir();
        if (!dir) return;
        try {
          const writable = await (await dir.getFileHandle(CardFile, { create: true })).createWritable();
          await writable.write(bytes);
          await writable.close();
        } catch (e) {
          console.warn('could not save the memory card', e);
        }
      });
    },
  };
}

// --- Starting the game -----------------------------------------------------------

function supportReport() {
  const problems = [];
  if (!navigator.gpu) problems.push('WebGPU');
  if (typeof WebAssembly.Suspending !== 'function' && typeof WebAssembly.promising !== 'function') {
    problems.push('WebAssembly JSPI');
  }
  return problems;
}

// The game mixes at 32 kHz, the GameCube's rate; the browser resamples
async function startAudio() {
  try {
    const context = new AudioContext({ sampleRate: 32000, latencyHint: 'interactive' });
    await context.audioWorklet.addModule('audio-worklet.js');
    const node = new AudioWorkletNode(context, 'melee-output', { outputChannelCount: [2] });
    node.connect(context.destination);
    if (context.state !== 'running') {
      // Without a click first (a restart), sound starts with the first input
      const resume = () => context.resume().catch(() => {});
      resume();
      for (const ev of ['pointerdown', 'keydown']) window.addEventListener(ev, resume, { once: true });
    }
    return {
      context,
      sampleRate: context.sampleRate,
      push(samples) {
        node.port.postMessage(samples, [samples.buffer]);
      },
    };
  } catch (e) {
    console.warn('no audio:', e);
    return null;
  }
}

// The running game, once started
const game = { running: false, melee: null, input: null, started: null };

async function start(disc, settings) {
  if (game.running) return;
  game.running = true;
  game.started = { ...settings };
  $('setup').hidden = true;
  $('stage').hidden = false;
  // The settings open over the game, in fullscreen too
  $('stage').append($('settings'));
  $('status').textContent = 'Starting…';
  $('status').hidden = false;

  const input = new Input(window);
  input.keys = { ...DefaultKeys, ...(settings.keys || {}) };
  game.input = input;
  const canvas = $('canvas');
  const audio = settings.audio ? await startAudio() : null;
  let stopped = false;

  const melee = {
    settings: { ...settings },
    settingsChanged: false,
    disc: { size: disc.size, read: (offset, length) => disc.read(offset, length) },
    audio,
    card: memoryCard(),
    readPad: (port) => input.read(port),
    rumble: (port, on) => input.rumble(port, on),
    onStats: (s) => {
      // The game is running: createMelee only settles when it stops
      melee.ran = true;
      if (!stopped) $('status').hidden = true;
      if (melee.settings.showFps) $('fps').textContent = `${s.fps.toFixed(0)} fps · CPU ${(s.busy * 100).toFixed(0)}%`;
    },
    onFatal: (msg) => {
      stopped = true;
      $('status').textContent = `The game stopped: ${msg}`;
      $('status').hidden = false;
    },
    onReset: () => location.reload(),
  };
  game.melee = melee;

  try {
    await createMelee({
      canvas,
      melee,
      print: (t) => console.log(t),
      printErr: (t) => console.warn(t),
      // Versioned, so an old copy in the browser cache isn't used
      locateFile: (p) => (p.endsWith('.wasm') ? `${p}?v=8` : p),
    });
    $('status').hidden = true;
  } catch (e) {
    // The whole stack, for reporting the problem
    console.error('The game stopped:', e && e.stack ? e.stack : e);
    stopped = true;
    const what = melee.ran ? 'The game stopped' : 'Couldn’t start';
    $('status').textContent = `${what}: ${e.message || e}. Reload the page to play again (the details are in the browser console, F12).`;
    $('status').hidden = false;
  }
  canvas.focus();
}

// Settings changed while the game runs: most take effect now
async function applyLive(settings) {
  const melee = game.melee;
  if (!melee) return;
  if (settings.audio && !melee.audio) {
    melee.audio = await startAudio();
  } else if (melee.audio && melee.audio.context) {
    if (settings.audio) melee.audio.context.resume().catch(() => {});
    else melee.audio.context.suspend().catch(() => {});
  }
  if (!settings.showFps) $('fps').textContent = '';
  game.input.keys = { ...DefaultKeys, ...(settings.keys || {}) };
  melee.settings = { ...settings };
  melee.settingsChanged = true;
  const needRestart = RestartSettings.some((k) => settings[k] !== game.started[k]);
  $('restartNote').hidden = !needRestart;
}

// --- The settings dialog -----------------------------------------------------------

function renderSettings(settings) {
  const set = (id, v) => {
    const el = $(id);
    if (el.type === 'checkbox') el.checked = !!v;
    else el.value = String(v);
  };
  set('renderScale', settings.renderScale);
  set('frameSkip', settings.frameSkip);
  set('msaa', settings.msaa);
  set('anisotropy', settings.anisotropy);
  set('audio', settings.audio);
  set('audioEffects', settings.audioEffects);
  set('showFps', settings.showFps);
  $('preset').value = settings.preset || 'custom';
}

function readSettings(settings) {
  const num = (id) => Number($(id).value);
  const bool = (id) => ($(id).checked ? 1 : 0);
  return {
    ...settings,
    renderScale: num('renderScale'),
    frameSkip: num('frameSkip'),
    msaa: num('msaa'),
    anisotropy: num('anisotropy'),
    audio: bool('audio'),
    audioEffects: bool('audioEffects'),
    showFps: bool('showFps'),
    preset: $('preset').value,
  };
}

function renderControls(settings, onChange) {
  const list = $('controls');
  list.textContent = '';
  const keys = { ...DefaultKeys, ...(settings.keys || {}) };
  for (const [action, label] of Object.entries(ActionNames)) {
    const row = document.createElement('div');
    row.className = 'key-row';
    const name = document.createElement('span');
    name.textContent = label;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'key';
    button.textContent = keys[action].replace(/^Key|^Digit/, '');
    button.addEventListener('click', () => {
      button.textContent = 'Press a key…';
      const onKey = (e) => {
        e.preventDefault();
        e.stopPropagation();
        window.removeEventListener('keydown', onKey, true);
        if (e.code !== 'Escape') {
          onChange({ ...(settings.keys || {}), [action]: e.code });
        } else {
          renderControls(settings, onChange);
        }
      };
      window.addEventListener('keydown', onKey, true);
    });
    row.append(name, button);
    list.append(row);
  }
}

async function main() {
  window.meleePageStarted = true;
  let settings = loadSettings();
  let disc = null;
  const dialog = $('settings');

  const changed = (next) => {
    settings = next;
    saveSettings(settings);
    if (game.running) applyLive(settings);
  };
  const keysChanged = (keys) => {
    const next = { ...settings };
    if (keys) next.keys = keys;
    else delete next.keys;
    changed(next);
    renderControls(settings, keysChanged);
  };
  renderSettings(settings);
  renderControls(settings, keysChanged);

  const problems = supportReport();
  if (problems.length) {
    $('support').hidden = false;
    $('support').textContent = `This browser lacks ${problems.join(' and ')}. Use a recent Chrome or Edge.`;
  }

  $('preset').addEventListener('change', () => {
    const p = $('preset').value;
    if (Presets[p]) {
      changed({ ...settings, ...Presets[p], preset: p });
      renderSettings(settings);
    }
  });
  for (const id of ['renderScale', 'frameSkip', 'msaa', 'anisotropy', 'audio', 'audioEffects', 'showFps']) {
    $(id).addEventListener('change', () => {
      $('preset').value = 'custom';
      changed(readSettings({ ...settings, preset: 'custom' }));
    });
  }
  $('resetKeys').addEventListener('click', () => keysChanged(null));

  // Before the game: Play starts it. From the game: Resume closes it.
  const openSettings = () => {
    renderSettings(settings);
    $('play').textContent = game.running ? 'Resume' : 'Play';
    $('play').disabled = !game.running && (!disc || problems.length > 0);
    $('discSummary').textContent = !game.running && disc ? discLabel(disc) : '';
    $('settingsHint').hidden = game.running;
    for (const tag of document.querySelectorAll('.restart-tag')) tag.hidden = !game.running;
    if (game.input) {
      game.input.paused = true;
      game.input.down.clear();
    }
    if (!dialog.open) dialog.showModal();
  };
  dialog.addEventListener('close', () => {
    if (game.input) game.input.paused = false;
    if (game.running) $('canvas').focus();
  });
  $('closeSettings').addEventListener('click', () => dialog.close());
  // The credit: one of the GIFs at random, ELBUWH, and a spin (restarted on
  // every click)
  $('creditImage').src = `MyBeloved${1 + Math.floor(Math.random() * 3)}.gif`;
  $('credit').addEventListener('click', () => {
    const sound = new Audio('ELBUWH.mp3');
    sound.play().catch(() => {});
    const credit = $('credit');
    credit.classList.remove('elbuwh');
    void credit.offsetWidth;
    credit.classList.add('elbuwh');
  });
  $('credit').addEventListener('animationend', (e) => {
    if (e.animationName === 'credit-elbuwh') $('credit').classList.remove('elbuwh');
  });
  $('play').addEventListener('click', () => {
    dialog.close();
    if (!game.running && disc) start(disc, settings);
  });
  $('openSettings').addEventListener('click', openSettings);
  $('settingsButton').addEventListener('click', openSettings);
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' && game.running && !dialog.open && !document.fullscreenElement) {
      e.preventDefault();
      openSettings();
    }
  });
  $('restart').addEventListener('click', () => {
    saveSettings(settings);
    try {
      sessionStorage.setItem('melee.autostart', '1');
    } catch {}
    location.reload();
  });
  $('fullscreen').addEventListener('click', () => {
    const el = $('stage');
    if (document.fullscreenElement) document.exitFullscreen();
    else el.requestFullscreen().catch(() => {});
  });

  // --- Finding the disc ---
  const discLabel = (d) => {
    const mb = `${(d.size / 2 ** 20).toFixed(0)} MB`;
    if (d.source === 'folder' && d.parts) return `${d.name} (${mb}, rebuilt from ${d.parts} parts)`;
    if (d.source === 'folder') return `${d.name} (${mb}, from this folder)`;
    return `Disc ready (${mb}, kept in this browser)`;
  };
  const showDisc = () => {
    $('discName').textContent = disc ? discLabel(disc) : 'No disc chosen yet';
    $('forget').hidden = !disc || disc.source === 'folder';
    $('openSettings').hidden = !disc;
    $('openSettings').disabled = problems.length > 0;
  };
  const showError = (msg) => {
    $('discError').textContent = msg || '';
    $('discError').hidden = !msg;
  };
  // A disc is ready: on to the settings (or straight into the game after a
  // restart)
  const ready = (d) => {
    disc = d;
    showDisc();
    let autostart = false;
    try {
      autostart = sessionStorage.getItem('melee.autostart') === '1';
      sessionStorage.removeItem('melee.autostart');
    } catch {}
    if (problems.length) {
      showError(`This browser can't run the game: it lacks ${problems.join(' and ')}. Use a recent Chrome or Edge (version 137 or later), on http://localhost.`);
      return;
    }
    if (autostart) start(disc, settings);
    else openSettings();
  };

  const progress = (what) => (p) => {
    $('discName').textContent = `${what}… ${(p * 100).toFixed(0)}%`;
  };

  // The player chooses one (or another one)
  $('discInput').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const problem = await checkDisc(fileDisc(file, 'file'));
    if (problem) {
      showError(problem);
      return;
    }
    showError(null);
    $('discName').textContent = 'Saving the disc in this browser…';
    let kept = null;
    try {
      kept = await writeSavedDisc(fileChunks(file), file.size, progress('Saving the disc in this browser'));
      localStorage.removeItem(DiscStampKey);
    } catch (err) {
      console.warn('could not keep the disc in browser storage', err);
    }
    ready(fileDisc(kept || file, kept ? 'saved' : 'file'));
  });
  $('forget').addEventListener('click', async () => {
    await forgetDisc();
    disc = null;
    showDisc();
  });

  // 0. A disc image split into parts (the split folder): joined back into
  // the original image in this browser's storage, once
  const split = await findSplitDisc();
  if (split) {
    const what = `Rebuilding ${split.name} from ${split.parts.length} parts`;
    let stamp = null;
    try {
      stamp = localStorage.getItem(DiscStampKey);
    } catch {}
    let file = stamp === split.stamp ? await savedDiscFile() : null;
    if (file && file.size !== split.size) file = null;
    if (!file) {
      $('discName').textContent = `${what}…`;
      try {
        file = await writeSavedDisc(splitChunks(split), split.size, progress(what));
        if (file && file.size === split.size) {
          localStorage.setItem(DiscStampKey, split.stamp);
        } else {
          file = null;
        }
      } catch (e) {
        console.warn('could not rebuild the disc', e);
        file = null;
      }
    }
    let d = null;
    if (file) {
      d = fileDisc(file, 'folder');
      d.name = split.name;
      d.parts = split.parts.length;
    } else if (split.parts.every((p) => p.ranges)) {
      // No browser storage: read the parts where they are
      d = splitDisc(split);
      d.parts = split.parts.length;
    } else {
      showError(`Found ${split.name} in ${split.parts.length} parts, but the browser couldn't rebuild it. Start the page with serve.py instead.`);
    }
    if (d) {
      const problem = await checkDisc(d);
      if (problem) showError(`${split.name}: ${problem}`);
      else return ready(d);
    }
  }

  // 1. A disc image in this folder
  const found = await findFolderDisc();
  if (found) {
    let d = null;
    if (found.ranges) {
      d = urlDisc(found.url, found.name, found.size);
    } else {
      // The server can't send parts of files: copy it into the browser once
      let stamp = null;
      try {
        stamp = localStorage.getItem(DiscStampKey);
      } catch {}
      let file = stamp === found.stamp ? await savedDiscFile() : null;
      if (!file) {
        $('discName').textContent = `Copying ${found.name} into this browser…`;
        try {
          const r = await fetch(found.url, { cache: 'no-store' });
          file = await writeSavedDisc(streamChunks(r.body), found.size, progress(`Copying ${found.name} into this browser`));
          if (file) localStorage.setItem(DiscStampKey, found.stamp);
        } catch (e) {
          console.warn('could not copy the disc', e);
        }
      }
      if (file) {
        d = fileDisc(file, 'folder');
        d.name = found.name;
      } else {
        showError(`Found ${found.name}, but this server sends whole files only and the browser couldn't keep a copy. Start the page with serve.py instead.`);
      }
    }
    if (d) {
      const problem = await checkDisc(d);
      if (problem) showError(`${found.name}: ${problem}`);
      else return ready(d);
    }
  }

  // 2. The disc kept in this browser from before
  const saved = await savedDiscFile();
  if (saved) {
    let stamp = null;
    try {
      stamp = localStorage.getItem(DiscStampKey);
    } catch {}
    // A copy of a folder disc that is gone isn't offered as the player's own
    if (!stamp) return ready(fileDisc(saved, 'saved'));
  }
  showDisc();
}

// Anything that goes wrong shows on the page instead of stopping it silently
function showProblem(e) {
  const msg = (e && (e.message || e.reason?.message || e.reason)) || String(e);
  console.error(e);
  const el = game.running ? $('status') : $('discError');
  el.textContent = `Something went wrong: ${msg}`;
  el.hidden = false;
}
window.addEventListener('error', (e) => showProblem(e.error || e.message));
window.addEventListener('unhandledrejection', (e) => showProblem(e.reason));

main().catch(showProblem);
