// app.js — Orchestrates: runIntro() → startMain() → runEnding()
// Loads AFTER intro.js, app.main.js, and ending.js (index.html uses <script defer> order)
(function () {
  'use strict';

  const BOOT_TIMEOUT_MS = 15000;
  const OUTRO_COMPLETE_EVENT = 'main:outro-complete'; // must match app.main.js
  const RESTART_DELAY_MS = 3000; // ⏳ wait before restarting when APP_LOOP is true

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

  async function boot() {
    console.log('[orchestrator] boot…');

    // Ensure DOM ready
    if (document.readyState !== 'complete') {
      await new Promise(r => window.addEventListener('load', r, { once: true }));
    }

    // Wait for intro + grid API presence
    await waitFor(() => typeof window.runIntro === 'function');
    await waitFor(() => window.gridAPI && typeof window.gridAPI.prepare === 'function');

    // Run intro
    await window.runIntro();

    // Hand off to main
    await waitFor(() => typeof window.startMain === 'function');
    await window.startMain();

    // Wait until ending module is present
    await waitFor(() => typeof window.runEnding === 'function');

    // Listen once for the "outro finished" signal from app.main
    const outroDone = new Promise(resolve => {
      window.addEventListener(OUTRO_COMPLETE_EVENT, resolve, { once: true });
    });

    await outroDone;

    // Run ending splash
    await window.runEnding();

    console.log('[orchestrator] sequence finished.');

    // 🔁 Loop back to start if APP_LOOP flag is set
    if (window.APP_LOOP) {
      console.log(`[orchestrator] waiting ${RESTART_DELAY_MS}ms before restart…`);
      setTimeout(() => {
        boot(); // recursively restart
      }, RESTART_DELAY_MS);
    }
  }

  boot().catch(e => console.error('[orchestrator] App orchestration failed:', e));
})();
