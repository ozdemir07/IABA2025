// permission.js — splash screen for audio permission / user-gesture gate
(function () {
  'use strict';

  const SESSION_KEY = 'APP_MEDIA_OK'; // show only once per page session

  // If already granted this session, skip overlay and boot immediately.
  function tryAutoBootIfGranted() {
    if (sessionStorage.getItem(SESSION_KEY) === '1') {
      if (typeof window.bootApp === 'function') {
        window.bootApp();
      } else {
        window.addEventListener('load', () => window.bootApp && window.bootApp(), { once: true });
      }
      return true;
    }
    return false;
  }

  function createPermissionScreen() {
    if (tryAutoBootIfGranted()) return; // guard: do not show if already granted

    const overlay = document.createElement('div');
    overlay.id = 'permission-screen';
    Object.assign(overlay.style, {
      position: 'fixed',
      inset: '0',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#000',
      color: '#fff',
      textAlign: 'center',
      zIndex: '9999',
      cursor: 'pointer',
      padding: '2rem',
      userSelect: 'none'
    });

    // Keep your existing typography choices
    overlay.innerHTML = `
      <h1 style="font-family: BPdotsUnicase, system-ui, sans-serif; font-size: 3.5rem; margin: 0 0 1rem;">IABA 2025</h1>
      <h2 style="font-family: BPdotsUnicase, system-ui, sans-serif; font-size: 2.0rem; margin: 0 0 1rem;">Intersubjectivity – Öznelerarasılık</h2>
      <h3 style="font-family: BPdotsUnicase, system-ui, sans-serif; font-size: 1.5rem; margin: 0 0 2rem;">Antalya Bilim University</h3>
      <p1 style="font-family: SatoshiLight, system-ui, sans-serif; font-size: 1.2rem; opacity: 0.85;">Click or Tap to continue</p1>
      <p2 style="font-family: SatoshiLight, system-ui, sans-serif; font-size: 1.2rem; opacity: 0.85;">Do not close this page</p2>
    `;

    document.body.appendChild(overlay);

    // Optional warm-up for the click sound (harmless if you preload elsewhere)
    try {
      const preload = new Audio('audio/digital-click.mp3');
      preload.preload = 'auto';
      preload.load();
    } catch {}

    async function unlockAndStart() {
      // 1) Try to unlock audio (both HTMLAudio and WebAudio paths)
      try {
        // Quietly play the click once to satisfy gesture requirement
        const a = new Audio('audio/digital-click.mp3');
        a.volume = 0.0001;
        await a.play().catch(()=>{});
        a.pause(); a.currentTime = 0;
      } catch {}

      try {
        if (window.AudioContext || window.webkitAudioContext) {
          const AC = window.AudioContext || window.webkitAudioContext;
          const ac = new AC();
          if (ac.state === 'suspended') { await ac.resume().catch(()=>{}); }
          // Close immediately; we only needed the resume gesture
          try { await ac.close(); } catch {}
        }
      } catch {}

      // 2) Persist session grant so we don’t show again this load
      try { sessionStorage.setItem(SESSION_KEY, '1'); } catch {}

      // 3) Remove overlay
      if (overlay && overlay.parentNode) overlay.parentNode.removeChild(overlay);

      // 4) Start the app (intro → main → ending loop)
      if (typeof window.bootApp === 'function') {
        window.bootApp();
      }
    }

    const once = { once: true, passive: true };
    overlay.addEventListener('click', unlockAndStart, once);
    overlay.addEventListener('touchend', unlockAndStart, once);
    const onKey = (e) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'Spacebar') {
        unlockAndStart();
        window.removeEventListener('keydown', onKey, once);
      }
    };
    window.addEventListener('keydown', onKey, once);
  }

  // Create the permission screen as soon as DOM is ready (but skip if already granted)
  if (document.readyState === 'complete') {
    if (!tryAutoBootIfGranted()) createPermissionScreen();
  } else {
    window.addEventListener('load', () => {
      if (!tryAutoBootIfGranted()) createPermissionScreen();
    }, { once: true });
  }
})();
