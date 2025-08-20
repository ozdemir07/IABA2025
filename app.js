// app.js — Orchestrates: runIntro() → startMain()
// Loads AFTER intro.js and app.main.js (index.html uses <script defer> order)
(function () {
  'use strict';

  const BOOT_TIMEOUT_MS = 15000;

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

    // Make sure DOM/canvas is fully ready
    if (document.readyState !== 'complete') {
      await new Promise(r => window.addEventListener('load', r, { once: true }));
    }

    // Wait for intro + grid API presence (defined by the other scripts)
    await waitFor(() => typeof window.runIntro === 'function');
    await waitFor(() => window.gridAPI && typeof window.gridAPI.prepare === 'function');

    // Run intro (your current timings preserved)
    await window.runIntro();

    // Hand off to main
    await waitFor(() => typeof window.startMain === 'function');
    await window.startMain();
  }

  boot().catch(e => console.error('[orchestrator] App orchestration failed:', e));
})();
