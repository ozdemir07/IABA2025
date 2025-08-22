// app.js — Orchestrates: runIntro() → startMain() → runEnding()  (loops optional)
(function () {
  'use strict';

  const BOOT_TIMEOUT_MS = 15000;
  const OUTRO_COMPLETE_EVENT = 'main:outro-complete'; // must match app.main.js
  const LOOP_WAIT_MS = 1200;                           // small pause before restarting

  // --- AUDIO (start main exactly when audio starts) ---
  const AUDIO_URL = 'audio/background.mp3'; // put your file here
  const AUDIO_PRELOAD_TIMEOUT_MS = 8000;

  const audioCtl = {
    el: null,
    ready: false,
    loadPromise: null
  };

  function preloadAudio(url = AUDIO_URL, timeoutMs = AUDIO_PRELOAD_TIMEOUT_MS) {
    if (audioCtl.loadPromise) return audioCtl.loadPromise;

    const el = new Audio();
    el.preload = 'auto';
    el.src = url;
    el.crossOrigin = 'anonymous'; // harmless if local
    audioCtl.el = el;

    audioCtl.loadPromise = new Promise((resolve) => {
      let done = false;
      const finish = (ok) => { if (done) return; done = true; audioCtl.ready = ok; resolve(ok); };

      const onReady = () => { el.removeEventListener('canplaythrough', onReady); finish(true); };
      const onErr   = () => { el.removeEventListener('error', onErr); finish(false); };

      el.addEventListener('canplaythrough', onReady, { once: true });
      el.addEventListener('error', onErr, { once: true });

      // Kick load (some browsers need explicit .load())
      try { el.load(); } catch {}

      // Timeout fallback so we never hang boot
      setTimeout(() => finish(false), timeoutMs);
    });

    return audioCtl.loadPromise;
  }

  async function playAudioNowOrOnGesture() {
    if (!audioCtl.el) return; // nothing to do
    // If it’s already playing, keep it (don’t restart, avoids overlaps across loops)
    if (!audioCtl.el.paused && !audioCtl.el.ended) return;

    try {
      // Try immediate play (will work if browser allows autoplay or you previously interacted)
      await audioCtl.el.play();
      return;
    } catch {
      // Autoplay blocked — arm a one-time gesture unlock and start main only when audio starts
      await new Promise((resolve) => {
        const handler = async () => {
          window.removeEventListener('pointerdown', handler);
          window.removeEventListener('keydown', handler);
          try { await audioCtl.el.play(); } catch {}
          resolve();
        };
        window.addEventListener('pointerdown', handler, { once: true });
        window.addEventListener('keydown', handler,   { once: true });
      });
    }
  }

  // --- small helpers ---
  function waitFor(cond, timeoutMs = BOOT_TIMEOUT_MS) {
    const t0 = performance.now();
    return new Promise((res, rej) => {
      (function loop() {
        if (cond()) return res(true);
        if (performance.now() - t0 > timeoutMs) return rej(new Error('Timeout waiting for dependency'));
        requestAnimationFrame(loop);
      })();
    });
  }
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  // Run one full cycle: intro → (start audio & main in sync) → wait outro → ending
  async function runOnce() {
    // Ensure modules are present
    await waitFor(() => typeof window.runIntro === 'function');
    await waitFor(() => window.gridAPI && typeof window.gridAPI.prepare === 'function');
    await waitFor(() => typeof window.startMain === 'function');
    await waitFor(() => typeof window.runEnding === 'function');

    // Start preloading audio while intro runs
    const audioPreload = preloadAudio();

    // Intro first
    await window.runIntro();

    // Ensure audio buffered (don’t block forever if network is slow)
    await audioPreload.catch(()=>{});

    // Start AUDIO and MAIN on the same frame:
    //  - If autoplay is allowed, play() resolves immediately and we start main right away.
    //  - If blocked, we wait for the first user gesture, then play() and start main.
    let mainStarted = false;
    const startMainSynced = async () => {
      if (mainStarted) return;
      mainStarted = true;
      await window.startMain();
    };

    try {
      await audioCtl.el?.play();
      // Audio started immediately — start main now (same microtask/frame)
      await startMainSynced();
    } catch {
      // Autoplay blocked — wait for gesture, then start both
      await new Promise((resolve) => {
        const handler = async () => {
          window.removeEventListener('pointerdown', handler);
          window.removeEventListener('keydown', handler);
          try { await audioCtl.el?.play(); } catch {}
          await startMainSynced();
          resolve();
        };
        window.addEventListener('pointerdown', handler, { once: true });
        window.addEventListener('keydown', handler,   { once: true });
      });
    }

    // Wait for the main sequence to signal that its “outro” (video fade out) is complete
    await new Promise((resolve) => {
      const once = () => { window.removeEventListener(OUTRO_COMPLETE_EVENT, once); resolve(); };
      window.addEventListener(OUTRO_COMPLETE_EVENT, once, { once: true });
    });

    // Run ending (logo/title)
    await window.runEnding();
  }

  async function boot() {
    console.log('[orchestrator] boot…');

    // Ensure DOM ready
    if (document.readyState !== 'complete') {
      await new Promise(r => window.addEventListener('load', r, { once: true }));
    }

    // First run
    await runOnce();

    // Loop if enabled
    const shouldLoop = (typeof window.APP_LOOP === 'boolean') ? window.APP_LOOP : false;
    while (shouldLoop) {
      await sleep(LOOP_WAIT_MS);
      await runOnce();
    }
  }

  boot().catch(e => console.error('[orchestrator] App orchestration failed:', e));
})();
