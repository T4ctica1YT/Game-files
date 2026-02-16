var Module = {
  preRun: [],
  postRun: [],
  print: (function() {
    return function(text) {
      if (arguments.length > 1) text = Array.prototype.slice.call(arguments).join(' ');
      console.log(text);
    };
  })(),
  printErr: function(text) {
    if (arguments.length > 1) text = Array.prototype.slice.call(arguments).join(' ');
    console.error(text);
  },
  canvas: (function() {
    var canvas = document.getElementById('canvas');
    // Robust resize that uses the canvas's actual CSS size and devicePixelRatio
    function resizeCanvas() {
      try {
        if (!canvas) return;
        // Use the canvas's layout size (clientWidth/clientHeight) so CSS centering and transforms
        // (e.g., Classic fixed-centered 16:9) are respected. Multiply by devicePixelRatio for the drawing buffer.
        const rect = canvas.getBoundingClientRect();
        const cssW = Math.max(1, Math.floor(rect.width));
        const cssH = Math.max(1, Math.floor(rect.height));
        const dpr = window.devicePixelRatio || 1;
        const bufW = Math.max(1, Math.floor(cssW * dpr));
        const bufH = Math.max(1, Math.floor(cssH * dpr));
        // Only update if different to avoid unnecessary context re-allocations
        if (canvas.width !== bufW || canvas.height !== bufH) {
          canvas.width = bufW;
          canvas.height = bufH;
        }
        // Ensure the CSS size remains consistent (some code expects percentage sizing)
        canvas.style.width = cssW + 'px';
        canvas.style.height = cssH + 'px';
      } catch (e) {
        console.warn('resizeCanvas failed', e);
      }
    }
    // Keep a single resize listener; other code may add additional handlers for Classic layout but this ensures buffer matches CSS size
    window.addEventListener('resize', resizeCanvas);
    // run once now to initialize buffer
    resizeCanvas();
    if (canvas) canvas.addEventListener("webglcontextlost", function(e) {
      alert('WebGL context lost. You will need to reload the page.');
      e.preventDefault();
    }, false);
    return canvas;
  })(),
  setStatus: function(text) {}
};

// Async preRun: fetch server config for reference only (no FS writes)
Module.preRun.push(function() {
  return (async function() {
    try {
      let resp = await fetch('game/sm64config.txt', {cache: 'no-store'});
      let defaultText = '';
      if (resp && resp.ok) defaultText = await resp.text();
      window.__sm64config_default = defaultText;
      window.__sm64config_active = defaultText;
    } catch (e) {
      console.error('Error loading sm64config (reference only)', e);
      window.__sm64config_default = '';
      window.__sm64config_active = '';
    }
  })();
});

// Unlock WebAudio helper (moved from inline)
window.__unlockAudio = (function(){
  let unlocked = false;
  let unlocking = null;
  async function doUnlock() {
    if (unlocked) return true;
    if (unlocking) return unlocking;
    unlocking = (async () => {
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtx) return false;
        const ctx = new AudioCtx();
        if (ctx.state === 'suspended') {
          try { await ctx.resume(); } catch(e){ /* ignore */ }
        }
        try {
          const buf = ctx.createBuffer(1, 1, 22050);
          const src = ctx.createBufferSource();
          src.buffer = buf;
          src.connect(ctx.destination);
          if (src.start) src.start(0);
          else if (src.noteOn) src.noteOn(0);
        } catch(e) {}
        window.__audioContext = ctx;
        if (window.Module) window.Module.audioContext = ctx;
        unlocked = true;
        return true;
      } catch (e) {
        console.warn('Audio unlock failed:', e);
        return false;
      }
    })();
    return unlocking;
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(doUnlock, 0);
  } else {
    window.addEventListener('load', () => { setTimeout(doUnlock, 0); }, {once:true});
  }
  const gestures = ['click','touchstart','keydown','pointerdown'];
  const gestureHandler = () => { doUnlock(); removeGestureHandlers(); };
  function addGestureHandlers() { gestures.forEach(e=>document.addEventListener(e, gestureHandler, {once:true,passive:true})); }
  function removeGestureHandlers() { gestures.forEach(e=>document.removeEventListener(e, gestureHandler)); }
  addGestureHandlers();
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') doUnlock(); });
  return doUnlock;
})();

// Ensure Module waits for audio unlock
try {
  window.Module = window.Module || Module;
  window.Module.preRun = window.Module.preRun || [];
  window.Module.preRun.push(function() { return window.__unlockAudio(); });
} catch (e) { console.warn('Failed to attach audio preRun:', e); }

// UI and Controls remapper logic (moved from inline script)
(function(){
  // Re-create minimal panel layout dynamically (keeps index.html small)
  const panel = document.getElementById('panel');
  panel.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <h3 style="margin:0">Controls   |   Ports Info  |   And Switch Between Versions</h3>
      <div style="display:flex;gap:8px;align-items:center;">
        <!-- Fullscreen icon button -->
        <button id="fullscreenBtn" title="Toggle Fullscreen" style="font-size:20px; line-height:1; padding:8px 10px; border-radius:8px; background:rgba(255,255,255,0.03); color:#e6f6ff; border:1px solid rgba(255,255,255,0.04); cursor:pointer;">🗗</button>
        <!-- Close button: down-caret (upside-down '^') styled like the fullscreen icon -->
        <button id="closeBtn" title="Close" aria-label="Close panel" style="font-size:20px; line-height:1; padding:8px 10px; border-radius:8px; background:rgba(255,255,255,0.03); color:#e6f6ff; border:1px solid rgba(255,255,255,0.04); cursor:pointer;">˅</button>
      </div>
    </div>

    <div style="margin-top:10px; display:flex; gap:12px; align-items:flex-start;">
      <!-- Modern (left) -->
      <div style="flex:1; min-width:220px; background:rgba(255,255,255,0.02); padding:10px; border-radius:8px;">
        <h3 style="margin:0 0 8px 0; font-size:14px;">Modern</h3>
        <p style="margin:6px 0;"><strong>Controls and More (Modern):</strong></p>
        <ul style="margin:6px 0 6px 18px; padding:0; font-size:13px;">
          <li>Movement: WASD</li>
          <li>A: L &nbsp;|&nbsp; B: , &nbsp;|&nbsp; L: . &nbsp;|&nbsp; R: Shift &nbsp;|&nbsp; Z: K &nbsp;|&nbsp; Start: Space</li>
          <li>C-Stick: Arrow Keys</li>
          <li>Controllers are Supported!</li>
        </ul>
        <p style="margin:6px 0 36px 0; font-size:12px; color:#cfe6f6;">Newer port using the PC Port version of the game as a base. New settings, controls, and possibly more!</p>
        <div style="display:flex;gap:8px;">
          <button id="switchModern" class="btn small" aria-pressed="true">Switch to Modern</button>
        </div>
      </div>

      <!-- Classic (right) -->
      <div style="flex:1; min-width:220px; background:rgba(255,255,255,0.02); padding:10px; border-radius:8px;">
        <h3 style="margin:0 0 8px 0; font-size:14px;">Classic</h3>
        <p style="margin:6px 0;"><strong>Controls and More (Classic):</strong></p>
        <ul style="margin:6px 0 6px 18px; padding:0; font-size:13px;">
          <li>Movement: WASD</li>
          <li>A: X &nbsp;|&nbsp; B: C &nbsp| &nbspZ: Space</li>
          <li>Start: Enter</li>
          <li>C-stick: WASD</li>
          <li>Controllers are Supported!</li>
        </ul>
        <p style="margin:6px 0 10px 0; font-size:12px; color:#cfe6f6;">Older port using the original game decompilation as a base. Just the original Super Mario 64 with the exception of widescreen support.</p>
        <div style="display:flex;gap:8px;">
          <button id="switchClassic" class="btn small">Switch to Classic</button>
        </div>
      </div>
    </div>

    <!-- Footer: centered small logo always visible without scrolling -->
    <div style="display:flex; justify-content:center; align-items:center; margin-top:12px; padding-top:8px; border-top:1px solid rgba(255,255,255,0.02);">
      <img src="/Logo.png" alt="Codename T4CTICS" style="width:84px; height:auto; display:block; filter: drop-shadow(0 4px 8px rgba(0,0,0,0.5));">
    </div>
  `;

  // Panel switch wiring: control which mode is active and update button states
  (function(){
    // default mode (keeps state across panel opens during session)
    // detect mode from URL so Classic page correctly shows Classic as active
    (function(){
      let detected = 'Modern';
      try {
        const p = (location.pathname || '').toLowerCase();
        const h = (location.href || '').toLowerCase();
        if (p.includes('/classic/') || h.includes('/classic/index.html') || h.includes('/classic/')) detected = 'Classic';
      } catch(e) { /* ignore */ }
      window.__gameMode = window.__gameMode || detected || 'Modern';
    })();
    const modernBtn = panel.querySelector('#switchModern');
    const classicBtn = panel.querySelector('#switchClassic');

    function updateButtons() {
      if (!modernBtn || !classicBtn) return;
      if (window.__gameMode === 'Modern') {
        modernBtn.disabled = true;
        modernBtn.classList.add('btn','ghost');
        modernBtn.style.opacity = '0.6';
        modernBtn.setAttribute('aria-pressed','true');

        classicBtn.disabled = false;
        classicBtn.classList.remove('ghost');
        classicBtn.style.opacity = '1';
        classicBtn.setAttribute('aria-pressed','false');
      } else {
        classicBtn.disabled = true;
        classicBtn.classList.add('btn','ghost');
        classicBtn.style.opacity = '0.6';
        classicBtn.setAttribute('aria-pressed','true');

        modernBtn.disabled = false;
        modernBtn.classList.remove('ghost');
        modernBtn.style.opacity = '1';
        modernBtn.setAttribute('aria-pressed','false');
      }
    }

    if (modernBtn) modernBtn.addEventListener('click', function(){
      if (window.__gameMode === 'Modern') return;
      // switch to Modern: navigate to root index (reload)
      try { window.__gameMode = 'Modern'; updateButtons(); window.location.href = '/'; } catch(e){ console.warn(e); }
    }, {passive:true});

    if (classicBtn) classicBtn.addEventListener('click', function(){
      if (window.__gameMode === 'Classic') return;
      // switch to Classic: navigate to the classic HTML
      try { window.__gameMode = 'Classic'; updateButtons(); window.location.href = 'classic/index.html'; } catch(e){ console.warn(e); }
    }, {passive:true});

    // set initial visual state
    setTimeout(updateButtons, 20);
  })();

  // Minimal panel wiring: open/close only (controls editor removed)
  const btn = document.getElementById('menuBtn');
  const closeBtn = document.getElementById('closeBtn');
  const fullscreenBtn = document.getElementById('fullscreenBtn');
  function openPanel() { panel.classList.add('open'); panel.setAttribute('aria-hidden','false'); }
  function closePanel() { panel.classList.remove('open'); panel.setAttribute('aria-hidden','true'); }
  btn.addEventListener('click', ()=> { if (panel.classList.contains('open')) closePanel(); else openPanel(); });
  if (closeBtn) closeBtn.addEventListener('click', closePanel);

  // Fullscreen toggle handler (targets the container so the canvas expands)
  if (fullscreenBtn) {
    fullscreenBtn.addEventListener('click', async function(e){
      try {
        const container = document.getElementById('container') || document.documentElement;
        if (!document.fullscreenElement && !document.webkitFullscreenElement) {
          if (container.requestFullscreen) await container.requestFullscreen();
          else if (container.webkitRequestFullscreen) container.webkitRequestFullscreen();
          fullscreenBtn.style.opacity = '0.8';
        } else {
          if (document.exitFullscreen) await document.exitFullscreen();
          else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
          fullscreenBtn.style.opacity = '1';
        }
      } catch (err) { console.warn('Fullscreen toggle failed', err); }
    }, {passive:true});
  }

  // no controls remap code included; defaults remain active and any existing localStorage mapping is ignored by the UI

  // Start overlay and game loader (moved from inline)
  (function(){
    const overlay = document.getElementById('startOverlay') || document.createElement('div');

    // layout the overlay (id already exists in DOM for pages that include it)
    overlay.id = 'startOverlay';
    overlay.style.position = 'absolute';
    overlay.style.left = '0';
    overlay.style.top = '0';
    overlay.style.width = '100vw';
    overlay.style.height = '100vh';
    overlay.style.display = 'flex';
    overlay.style.alignItems = 'center';
    overlay.style.justifyContent = 'center';
    overlay.style.zIndex = '50';
    overlay.style.backdropFilter = 'blur(2px)';
    overlay.innerHTML = `<div style="background: linear-gradient(180deg, rgba(10,14,18,0.9), rgba(18,24,28,0.85)); color:#dff7ff; padding:18px 22px;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,0.6); text-align:center; max-width:86vw;">
        <div style="font-family:Mario64DS,Arial;font-size:18px;margin-bottom:6px;">Tap or Click to Enable Audio & Start</div>
        <div style="font-size:13px; color:#bfe7f8;">This ensures sound is unlocked on your browser.</div>
      </div>`;
    if (!document.getElementById('startOverlay')) document.body.appendChild(overlay);

    // Keep a stable registry of listeners so we can remove them reliably
    const __startHandlers = [];

    function addStartListener(target, type, fn, opts) {
      // normalize to a canonical options shape so removeEventListener can match it reliably
      // prefer boolean capture or an options object with passive/capture if provided
      let options = opts === undefined ? {passive:true, capture:false} : opts;
      // if caller passed a boolean (capture) convert to object
      if (typeof options === 'boolean') options = {passive:true, capture: !!options};
      // ensure keys exist
      options.passive = options.passive === undefined ? true : options.passive;
      options.capture = options.capture === undefined ? false : options.capture;
      // try adding with the options object; fall back to simple addEventListener if not supported
      try { target.addEventListener(type, fn, options); }
      catch(e) { try { target.addEventListener(type, fn, options.capture); } catch(e2){ target.addEventListener(type, fn); } }
      __startHandlers.push({target, type, fn, options});
    }
    function removeStartListeners() {
      for (let h of __startHandlers) {
        try { h.target.removeEventListener(h.type, h.fn, h.options); } catch(e){
          try { h.target.removeEventListener(h.type, h.fn, h.options && h.options.capture); } catch(e2){
            try { h.target.removeEventListener(h.type, h.fn); } catch(e3){}
          }
        }
      }
      __startHandlers.length = 0;
    }

    let started = false;
    async function startGame() {
      if (started) return;
      started = true;
      removeStartListeners();
      try { if (window.__unlockAudio) await window.__unlockAudio(); } catch(e){ console.warn('Audio unlock error', e); }
      const current = document.getElementById('startOverlay');
      if (current && current.parentNode) current.parentNode.removeChild(current);
      try { document.getElementById('canvas').focus(); } catch(e){}
      try { if (window.__applyControlsRemap) window.__applyControlsRemap(); } catch (e) { console.warn('Applying controls remap before game load failed', e); }
      const s = document.createElement('script');
      s.src = 'game/sm64.us.f3dex2e.js';
      s.async = true;
      s.type = 'text/javascript';
      document.body.appendChild(s);
    }

    // Unified gesture handler that tolerates delayed interaction and overlay replacement
    function boundGesture(e) {
      // Accept most user gestures (click, touch, pointer, key)
      try { startGame(); } catch(err){ console.warn('gesture start error', err); }
    }

    // Add event listeners broadly (document/window) so user interactions anywhere start the game.
    // Also attach to the overlay element for immediate clicks on that element.
    // Primary listeners (bubble-phase) — use non-passive so handlers run reliably after delays
    addStartListener(document, 'click', boundGesture, {passive:false, capture:false});
    addStartListener(document, 'touchstart', boundGesture, {passive:false, capture:false});
    addStartListener(document, 'pointerdown', boundGesture, {passive:false, capture:false});
    addStartListener(document, 'pointerup', boundGesture, {passive:false, capture:false});
    addStartListener(document, 'touchend', boundGesture, {passive:false, capture:false});
    addStartListener(window, 'keydown', boundGesture, {passive:false, capture:false});
    addStartListener(window, 'pointerdown', boundGesture, {passive:false, capture:false});
    addStartListener(window, 'touchstart', boundGesture, {passive:false, capture:false});
    addStartListener(overlay, 'click', boundGesture, {passive:false, capture:false});
    addStartListener(overlay, 'touchstart', boundGesture, {passive:false, capture:false});
    addStartListener(overlay, 'pointerdown', boundGesture, {passive:false, capture:false});
    addStartListener(overlay, 'pointerup', boundGesture, {passive:false, capture:false});

    // Fallback capture-phase listeners (helps when overlay is replaced or events are intercepted)
    addStartListener(document, 'pointerdown', boundGesture, {passive:false, capture:true});
    addStartListener(document, 'touchstart', boundGesture, {passive:false, capture:true});
    addStartListener(document, 'click', boundGesture, {passive:false, capture:true});
    addStartListener(window, 'pointerdown', boundGesture, {passive:false, capture:true});
    addStartListener(window, 'touchstart', boundGesture, {passive:false, capture:true});
    addStartListener(window, 'click', boundGesture, {passive:false, capture:true});

    // Extra redundancy: older events and mouse events to catch edge cases
    addStartListener(document, 'mousedown', boundGesture, {passive:false, capture:false});
    addStartListener(document, 'mouseup', boundGesture, {passive:false, capture:false});
    addStartListener(window, 'mousedown', boundGesture, {passive:false, capture:true});
    addStartListener(window, 'mouseup', boundGesture, {passive:false, capture:true});

    // ensure visibility regain attempts to unlock audio in case the gesture occurred off-overlay
    document.addEventListener('visibilitychange', function(){
      if (document.visibilityState === 'visible') { try { window.__unlockAudio && window.__unlockAudio(); } catch(e){} }
    }, {passive:true});
  })();

  // Enforce centered 16:9 canvas while in Classic mode
  (function(){
    function applyClassicLayout() {
      try {
        const isClassic = (window.__gameMode === 'Classic') || (location.pathname || '').toLowerCase().includes('/classic/');
        const container = document.getElementById('container');
        const canvas = document.getElementById('canvas');
        if (!container || !canvas) return;

        if (isClassic) {
          // center the container and clamp canvas to 16:9 centered in viewport
          container.style.position = 'fixed';
          container.style.left = '50%';
          container.style.top = '50%';
          container.style.transform = 'translate(-50%,-50%)';
          container.style.width = 'auto';
          container.style.height = 'auto';
          container.style.maxWidth = '100vw';
          container.style.maxHeight = '100vh';
          container.style.display = 'flex';
          container.style.alignItems = 'center';
          container.style.justifyContent = 'center';
          container.style.pointerEvents = 'auto';

          function resizeClassicCanvas() {
            // Debounced, robust sizing that preserves centered 16:9 and avoids CSS->buffer mismatch
            const vw = window.innerWidth;
            const vh = window.innerHeight;
            const aspect = 16 / 9;

            // Decide whether width or height is the limiting dimension
            let targetWidth, targetHeight;
            if (vw / vh > aspect) {
              // viewport is wider than 16:9, limit by height
              targetHeight = Math.floor(vh);
              targetWidth = Math.floor(targetHeight * aspect);
            } else {
              // viewport is narrower/taller, limit by width
              targetWidth = Math.floor(vw);
              targetHeight = Math.floor(targetWidth / aspect);
            }

            // Ensure at least 1px
            targetWidth = Math.max(1, targetWidth);
            targetHeight = Math.max(1, targetHeight);

            // Size the container so the canvas remains visually centered in the page
            container.style.width = targetWidth + 'px';
            container.style.height = targetHeight + 'px';
            container.style.display = 'flex';
            container.style.alignItems = 'center';
            container.style.justifyContent = 'center';

            // Maintain CSS size for the canvas (logical pixels)
            canvas.style.width = targetWidth + 'px';
            canvas.style.height = targetHeight + 'px';
            canvas.style.display = 'block';
            canvas.style.margin = '0';
            canvas.style.transform = 'none';
            canvas.style.transformOrigin = 'center center';

            // Update drawing buffer using devicePixelRatio for crisp rendering
            const dpr = window.devicePixelRatio || 1;
            const desiredBufferWidth = Math.max(1, Math.floor(targetWidth * dpr));
            const desiredBufferHeight = Math.max(1, Math.floor(targetHeight * dpr));
            if (canvas.width !== desiredBufferWidth || canvas.height !== desiredBufferHeight) {
              canvas.width = desiredBufferWidth;
              canvas.height = desiredBufferHeight;
            }
          }

          // initial and responsive sizing
          resizeClassicCanvas();
          // ensure listener added only once by using a named handler stored on window
          if (!window.__resizeClassicHandler) {
            window.__resizeClassicHandler = function(){ resizeClassicCanvas(); };
            window.addEventListener('resize', window.__resizeClassicHandler);
          }
        } else {
          // reset to default (modern) full-viewport behavior and ensure drawing buffer matches CSS size
          container.style.position = 'absolute';
          container.style.left = '0';
          container.style.top = '0';
          container.style.transform = '';
          container.style.width = '100vw';
          container.style.height = '100vh';
          container.style.maxWidth = '';
          container.style.maxHeight = '';
          container.style.display = 'flex';
          container.style.alignItems = 'center';
          container.style.justifyContent = 'center';
          container.style.pointerEvents = '';

          // restore canvas to fill container (CSS) and set drawing buffer using devicePixelRatio
          canvas.style.width = '100%';
          canvas.style.height = '100%';
          canvas.style.transformOrigin = 'center center';
          canvas.style.transform = 'none';
          const dpr = window.devicePixelRatio || 1;
          // Use the container's computed size to avoid mismatches when UI chrome changes
          const rect = container.getBoundingClientRect();
          const drawWidth = Math.max(1, Math.floor(rect.width * dpr));
          const drawHeight = Math.max(1, Math.floor(rect.height * dpr));
          canvas.width = drawWidth;
          canvas.height = drawHeight;

          // remove classic resize handler if present
          if (window.__resizeClassicHandler) {
            try { window.removeEventListener('resize', window.__resizeClassicHandler); } catch(e){}
            window.__resizeClassicHandler = null;
          }
        }
      } catch (e) {
        console.warn('applyClassicLayout failed', e);
      }
    }

    // respond to mode changes and window resizes
    setTimeout(applyClassicLayout, 20);
    window.addEventListener('resize', applyClassicLayout);
    // if the panel or other code changes __gameMode, observe and re-apply (polling is lightweight)
    let lastMode = window.__gameMode || null;
    setInterval(function(){
      if ((window.__gameMode || null) !== lastMode) {
        lastMode = window.__gameMode || null;
        applyClassicLayout();
      }
    }, 250);
  })();

})();