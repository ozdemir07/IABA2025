// ending.js — TEAD.Studio credit splash after main outro completes
// Public: window.runEnding(options) -> Promise<void>
// Draws on its own overlay canvas (#ending), then removes it.

(function () {
  'use strict';

  const DEF = {
    // Colors & layout
    bg: '#000000',
    fg: '#ffffff',

    // Texts
    title1: 'Digital Presentation Made By', // Satoshi Light
    title2: 'TEAD.Studio',                      // Satoshi Medium
    line1SizeRatio: 0.025,  // fraction of viewport height
    line2SizeRatio: 0.040,

    // Fonts (adjust to your files)
    fontLightURL:  'fonts/Satoshi-Light.otf',
    fontMediumURL: 'fonts/Satoshi-Medium.otf',
    fontLightFamily:  'SatoshiLight',
    fontMediumFamily: 'SatoshiMedium',

    // Logo
    logoURL: 'assets/teads-logo.png',    // e.g. 'media/teads-logo.svg' (optional)
    logoScale: 0.25,  // fraction of min(viewportW, viewportH)

    // Timing (ms)
    line1FadeInMs:  1500,
    line2DelayMs:   1500,   // start line2 after this delay (while line1 is visible)
    line2FadeInMs:  1500,
    holdBothMs:     1000,  // keep both lines on screen before fading them
    linesFadeOutMs: 1000,   // fade out both lines while logo fades in
    logoFadeInMs:   1500,
    logoHoldMs:     2000,  // hold logo at full opacity
    logoFadeOutMs:  2000,   // optional: fade to black before resolve
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

    // Timeline
    const t0 = performance.now();
    const tLine1InEnd = t0 + p.line1FadeInMs;
    const tLine2InStart = t0 + p.line2DelayMs;
    const tLine2InEnd   = tLine2InStart + p.line2FadeInMs;
    const tHoldEnd      = Math.max(tLine2InEnd, tLine1InEnd) + p.holdBothMs;
    const tLinesOutEnd  = tHoldEnd + p.linesFadeOutMs;
    const tLogoInEnd    = tHoldEnd + p.logoFadeInMs;   // logo starts at hold start
    const tLogoHoldEnd  = tLogoInEnd + p.logoHoldMs;
    const tLogoOutEnd   = tLogoHoldEnd + p.logoFadeOutMs;

    return new Promise(resolve=>{
      (function loop(now){
        // background
        ctx.setTransform(1,0,0,1,0,0);
        ctx.fillStyle = p.bg;
        ctx.fillRect(0,0,c.width,c.height);

        const W = c.width, H = c.height;
        const centerX = W/2;
        const baseY = Math.round(H*0.55); // vertical anchor for two lines

        // Opacities
        const a1 = clamp01((now - t0) / p.line1FadeInMs);              // line1 fade-in
        const a2 = clamp01((now - tLine2InStart) / p.line2FadeInMs);   // line2 fade-in
        const outK = clamp01((now - tHoldEnd) / p.linesFadeOutMs);     // both lines fade-out
        const lineAlpha = (1 - outK);

        // Draw Line 1 (Satoshi Light)
        if (lineAlpha > 0){
          ctx.save();
          ctx.globalAlpha = a1 * lineAlpha;
          ctx.fillStyle = p.fg;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.font = `300 ${Math.round(H*p.line1SizeRatio)}px "${p.fontLightFamily}", system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif`;
          ctx.fillText(p.title1, centerX, baseY - Math.round(H*0.04));
          ctx.restore();
        }

        // Draw Line 2 (Satoshi Medium)
        if (lineAlpha > 0){
          ctx.save();
          ctx.globalAlpha = a2 * lineAlpha;
          ctx.fillStyle = p.fg;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.font = `500 ${Math.round(H*p.line2SizeRatio)}px "${p.fontMediumFamily}", system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif`;
          ctx.fillText(p.title2, centerX, baseY + Math.round(H*0.02));
          ctx.restore();
        }

        // Logo fades in while lines fade out, then holds, then fades out (optional)
        let logoAlpha = 0;
        if (p.logoURL){
          if (now <= tHoldEnd){
            // pre-fade-in period: keep 0
            logoAlpha = 0;
          } else if (now <= tLogoInEnd){
            logoAlpha = clamp01((now - tHoldEnd) / p.logoFadeInMs);
          } else if (now <= tLogoHoldEnd){
            logoAlpha = 1;
          } else {
            // fade out
            logoAlpha = 1 - clamp01((now - tLogoHoldEnd) / p.logoFadeOutMs);
          }

          if (logo && logoAlpha > 0){
            const s = Math.min(W, H) * p.logoScale;
            const ar = logo.naturalWidth && logo.naturalHeight ? (logo.naturalWidth / logo.naturalHeight) : 1;
            let dw = s, dh = s;
            if (ar >= 1){ dh = s / ar; } else { dw = s * ar; }
            ctx.save();
            ctx.globalAlpha = logoAlpha;
            ctx.imageSmoothingEnabled = true;
            ctx.drawImage(logo, centerX - dw/2, baseY - dh/2, dw, dh);
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
