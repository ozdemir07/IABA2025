// ending.js — TEAD.Studio credit splash after main outro completes
// Public: window.runEnding(options) -> Promise<void>
// Draws a single "movie-style" credits card (fade in/out) then the TEADS logo (fade in/out).

(function () {
  'use strict';

  const DEF = {
    // Colors & layout
    bg: '#000000',
    fg: '#ffffff',

    // --- Credit content (movie-style, two centered columns) ---
    // Left = role, Right = names
    credits: [
      { role: 'DIGITAL PRESENTATION & VIDEO CHOREOGRAPHY', name: 'Tolga Özdemir / TEAD.Studio' },
      { role: 'CURATOR / COORDINATOR',                     name: 'Alper Gülle' },
      { role: 'RESEARCH & EDITORIAL SUPPORT',              name: 'Songül Sancak' },
      { role: '',                                          name: 'Ahmet Berat Köksal' },
      // "Music" with an italic note:
      { role: 'MUSIC',                                     name: 'Tolga Özdemir / TEAD.Studio (Composed with Suno)', italicNote: '(Composed with Suno)' },
    ],

    // Fonts (kept as you had)
    fontLightURL:  'fonts/Satoshi-Light.otf',
    fontMediumURL: 'fonts/Satoshi-Medium.otf',
    fontLightFamily:  'SatoshiLight',
    fontMediumFamily: 'SatoshiMedium',

    // Sizing (relative to viewport height)
    rolePx:  24,               // if null -> H * 0.026
    namePx:  42,               // if null -> H * 0.030
    rowGapPx: 18,              // vertical gap between rows
    colGapVw: 2,               // horizontal gap between role and name columns in vw
    maxBlockWidthVw: 72,       // keep the whole block within this width (vw)

    // Logo
    logoURL: 'assets/teads-logo.png',
    logoScale: 0.40,           // fraction of min(viewportW, viewportH)

    // Timing (ms) — preserved keys; reused for credits card timing
    line1FadeInMs:  500,       // used as: creditsFadeInMs
    line2DelayMs:   0,         // (ignored now)
    line2FadeInMs:  0,         // (ignored now)
    holdBothMs:     3500,      // used as: creditsHoldMs
    linesFadeOutMs: 1000,      // used as: creditsFadeOutMs
    logoFadeInMs:   1500,
    logoHoldMs:     2000,
    logoFadeOutMs:  2000,
    removeOnFinish: true
  };

  function clamp01(v){ return v<0?0:v>1?1:v; }

  async function loadFont(url, family) {
    try {
      const ext = (url.split('.').pop() || '').toLowerCase();
      const fmt =
        ext === 'otf'  ? 'opentype' :
        ext === 'ttf'  ? 'truetype' :
        ext === 'woff' ? 'woff' :
        'woff2';
      const face = new FontFace(family, `url(${url}) format("${fmt}")`);
      await face.load();
      if (document.fonts) document.fonts.add(face);
    } catch (e) {
      console.warn('[ending] font load failed:', e);
    }
  }

  function makeCanvas() {
    let el = document.getElementById('ending');
    if (!el) {
      el = document.createElement('canvas');
      el.id = 'ending';
      Object.assign(el.style, {
        position:'fixed', inset:'0', width:'100vw', height:'100vh',
        display:'block', zIndex:'3', pointerEvents:'none'
      });
      document.body.appendChild(el);
    }
    return el;
  }

  function fit(el){
    el.width = window.innerWidth;
    el.height = window.innerHeight;
  }

  function loadImage(src){
    return new Promise((res, rej)=>{
      if (!src) return res(null);
      const img = new Image();
      img.onload = ()=>res(img);
      img.onerror = rej;
      img.src = src;
    });
  }

  // Measure wrapped width helper (no wrapping here; we just measure and cap block width)
  function measureBlock(ctx, p, H, W, credits){
    const rolePx = (typeof p.rolePx === 'number' && p.rolePx>0) ? p.rolePx : Math.round(H*0.026);
    const namePx = (typeof p.namePx === 'number' && p.namePx>0) ? p.namePx : Math.round(H*0.030);
    const colGap = (p.colGapVw/100) * W;
    const maxBlock = (p.maxBlockWidthVw/100) * W;

    ctx.textBaseline = 'alphabetic';

    let maxRole = 0, maxName = 0;
    for (const row of credits){
      // role
      if (row.role) {
        ctx.font = `500 ${rolePx}px "${p.fontMediumFamily}", system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif`;
        maxRole = Math.max(maxRole, ctx.measureText(row.role).width);
      }
      // name (split italic note width if present)
      ctx.font = `300 ${namePx}px "${p.fontLightFamily}", system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif`;
      let nameWidth = ctx.measureText(row.name).width;
      if (row.italicNote && row.name.includes(row.italicNote)) {
        const head = row.name.replace(row.italicNote, '').trimEnd();
        const headW = ctx.measureText(head).width;
        ctx.font = `italic 300 ${namePx}px "${p.fontLightFamily}", system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif`;
        const noteW = ctx.measureText(row.italicNote).width;
        nameWidth = headW + noteW;
      }
      maxName = Math.max(maxName, nameWidth);
    }

    const total = maxRole + colGap + maxName;
    const scale = total > maxBlock ? (maxBlock / total) : 1;

    return { rolePx, namePx, colGap, maxRole: maxRole*scale, maxName: maxName*scale, scale };
  }

  window.runEnding = async function runEnding(opts={}){
    const p = { ...DEF, ...opts };

    // Prepare canvas
    const c = makeCanvas();
    const ctx = c.getContext('2d', { alpha:false });
    const onResize = ()=>fit(c);
    window.addEventListener('resize', onResize);
    fit(c);

    // Load fonts & logo
    await Promise.all([
      loadFont(p.fontLightURL,  p.fontLightFamily),
      loadFont(p.fontMediumURL, p.fontMediumFamily)
    ]);
    const logo = await loadImage(p.logoURL);

    // Timeline (reuse your param names)
    const t0 = performance.now();
    const tCreditsInEnd = t0 + p.line1FadeInMs;     // credits fade-in
    const tHoldEnd      = tCreditsInEnd + p.holdBothMs;
    const tCreditsOutEnd= tHoldEnd + p.linesFadeOutMs;

    const tLogoInEnd    = tHoldEnd + p.logoFadeInMs;   // logo starts at the same moment as credits start fading
    const tLogoHoldEnd  = tLogoInEnd + p.logoHoldMs;
    const tLogoOutEnd   = tLogoHoldEnd + p.logoFadeOutMs;

    return new Promise(resolve=>{
      (function loop(now){
        // background
        ctx.setTransform(1,0,0,1,0,0);
        ctx.fillStyle = p.bg;
        ctx.fillRect(0,0,c.width,c.height);

        const W = c.width, H = c.height;
        const block = measureBlock(ctx, p, H, W, p.credits);
        const rolePx = Math.round(block.rolePx * block.scale);
        const namePx = Math.round(block.namePx * block.scale);
        const colGap = block.colGap * block.scale;

        // Compute column anchors (centered as a whole)
        const totalW = block.maxRole + colGap + block.maxName;
        const leftColRightX  = Math.round((W - totalW)/2 + block.maxRole);
        const rightColLeftX  = Math.round(leftColRightX + colGap);

        // --- Credits opacity (fade in → hold → fade out) ---
        let creditsA = 1;
        if (now <= tCreditsInEnd) {
          creditsA = clamp01((now - t0) / Math.max(1, p.line1FadeInMs));
        } else if (now >= tHoldEnd) {
          creditsA = 1 - clamp01((now - tHoldEnd) / Math.max(1, p.linesFadeOutMs));
        }

        // Draw credits block (center vertically)
        if (creditsA > 0){
          ctx.save();
          ctx.globalAlpha = creditsA;
          ctx.fillStyle = p.fg;
          ctx.textBaseline = 'alphabetic';

          const rows = p.credits.length;
          const lineGap = p.rowGapPx|0;
          const roleAsc = rolePx; // approximate line height
          const nameAsc = namePx;
          const lineH = Math.max(roleAsc, nameAsc) + lineGap;

          const blockH = rows * lineH - lineGap;
          let y = Math.round((H - blockH)/2 + roleAsc); // baseline for first row

          for (const row of p.credits){
            // ROLE (right aligned)
            if (row.role) {
              ctx.textAlign = 'right';
              ctx.font = `500 ${rolePx}px "${p.fontMediumFamily}", system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif`;
              ctx.fillText(row.role, leftColRightX, y);
            }

            // NAME (left aligned)
            ctx.textAlign = 'left';
            // If we have an italic note inside the name, draw it in two parts
            if (row.italicNote && row.name.includes(row.italicNote)) {
              const head = row.name.replace(row.italicNote, '').trimEnd();
              ctx.font = `300 ${namePx}px "${p.fontLightFamily}", system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif`;
              const headW = ctx.measureText(head).width;
              ctx.fillText(head, rightColLeftX, y);

              ctx.font = `italic 300 ${namePx}px "${p.fontLightFamily}", system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif`;
              ctx.fillText(row.italicNote, rightColLeftX + headW, y);
            } else {
              ctx.font = `300 ${namePx}px "${p.fontLightFamily}", system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif`;
              ctx.fillText(row.name, rightColLeftX, y);
            }

            y += lineH;
          }
          ctx.restore();
        }

        // --- Logo fades after credits start to fade ---
        let logoAlpha = 0;
        if (p.logoURL){
          if (now <= tHoldEnd){
            logoAlpha = 0;
          } else if (now <= tLogoInEnd){
            logoAlpha = clamp01((now - tHoldEnd) / Math.max(1, p.logoFadeInMs));
          } else if (now <= tLogoHoldEnd){
            logoAlpha = 1;
          } else {
            logoAlpha = 1 - clamp01((now - tLogoHoldEnd) / Math.max(1, p.logoFadeOutMs));
          }

          if (logo && logoAlpha > 0){
            const s = Math.min(W, H) * p.logoScale;
            const ar = logo.naturalWidth && logo.naturalHeight ? (logo.naturalWidth / logo.naturalHeight) : 1;
            let dw = s, dh = s;
            if (ar >= 1){ dh = s / ar; } else { dw = s * ar; }
            ctx.save();
            ctx.globalAlpha = logoAlpha;
            ctx.imageSmoothingEnabled = true;
            // place the logo slightly above center to balance after credits disappear
            const cx = Math.round(W/2), cy = Math.round(H*0.52);
            ctx.drawImage(logo, cx - dw/2, cy - dh/2, dw, dh);
            ctx.restore();
          }
        }

        if (now < tLogoOutEnd){
          requestAnimationFrame(loop);
        } else {
          window.removeEventListener('resize', onResize);
          if (p.removeOnFinish && c.parentNode) c.parentNode.removeChild(c);
          resolve();
        }
      })(performance.now());
    });
  };
})();
