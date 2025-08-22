// app.js — Orchestrates: runIntro() → startMain() → runEnding()  (loops optional)
// - Waits for one-time audio permission (from permission.js) before first run
// - Starts background.mp3 exactly when app.main starts on every loop (no audio looping)

(function () {
  'use strict';

  const BOOT_TIMEOUT_MS = 15000;
  const OUTRO_COMPLETE_EVENT = 'main:outro-complete'; // must match app.main.js
  const LOOP_WAIT_MS = 1200;

  // ---------- MUSIC (starts with main each loop; no loop) ----------
  const MUSIC_URL = 'audio/background.mp3';
  const music = new Audio();
  music.src = MUSIC_URL;
  music.preload = 'auto';
  music.loop = false;
  music.crossOrigin = 'anonymous';
  music.playsInline = true; // iOS

  // >>> Minimal addition: expose a music clock for app.main.js <<<
  // app.main.js calls window.getMusicClock() and will prefer this over performance.now()
  window.getMusicClock = function () {
    if (music && !music.paused && isFinite(music.currentTime)) {
      return music.currentTime * 1000; // milliseconds
    }
    return performance.now(); // fallback when music not started yet
  };

  // Helpers
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

  // Wait for the one-time audio permission screen (permission.js)
  async function waitForUserAudioPermit() {
    // We support either a function or a promise, depending on your permission.js
    // 1) function window.waitForPermission()
    if (typeof window.waitForPermission === 'function') {
      await window.waitForPermission();
      return;
    }
    // 2) window.permission.ready is a Promise or a function returning a Promise
    if (window.permission) {
      const r = window.permission.ready;
      if (typeof r === 'function') { await r(); return; }
      if (r && typeof r.then === 'function') { await r; return; }
    }
    // 3) Fallback: require a gesture once if autoplay is still blocked
    try {
      await music.play();           // try to unlock immediately if browser allows
      music.pause(); music.currentTime = 0;
    } catch {
      await new Promise(resolve => {
        const once = async () => {
          window.removeEventListener('pointerdown', once);
          window.removeEventListener('keydown', once);
          try { await music.play(); music.pause(); music.currentTime = 0; } catch {}
          resolve();
        };
        window.addEventListener('pointerdown', once, { once:true });
        window.addEventListener('keydown',     once, { once:true });
      });
    }
  }

  // One full cycle
  async function runOnce() {
    // Ensure modules present
    await waitFor(() => typeof window.runIntro === 'function');
    await waitFor(() => window.gridAPI && typeof window.gridAPI.prepare === 'function');
    await waitFor(() => typeof window.startMain === 'function');
    await waitFor(() => typeof window.runEnding === 'function');

    // Intro (no audio)
    await window.runIntro();

    // Start music and main **on the same frame**; music does NOT loop.
    // If the user already granted permission, play() will resolve immediately.
    music.currentTime = 0;
    try { await music.play(); } catch {} // if blocked somehow, permission.js already handled it
    await window.startMain();            // begin main right after music starts

    // Wait until app.main signals that its outro (video fade to BG) is complete
    await new Promise(resolve => {
      window.addEventListener(OUTRO_COMPLETE_EVENT, resolve, { once:true });
    });

    // Ending (logo/title)
    await window.runEnding();
  }

  async function boot() {
    console.log('[orchestrator] boot…');

    if (document.readyState !== 'complete') {
      await new Promise(r => window.addEventListener('load', r, { once: true }));
    }

    // One-time: wait for permission screen to be accepted so audio can play later without extra clicks
    await waitForUserAudioPermit();

    // First run
    await runOnce();

    // Loop intro→main→ending if enabled
    const shouldLoop = (typeof window.APP_LOOP === 'boolean') ? window.APP_LOOP : false;
    while (shouldLoop) {
      await sleep(LOOP_WAIT_MS);
      await runOnce();
    }
  }

  boot().catch(e => console.error('[orchestrator] App orchestration failed:', e));
})();
