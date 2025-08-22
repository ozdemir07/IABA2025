// intro.js — tile‑aligned typing + grid fade + fade‑out (+ dual‑language warning screen)
// Defines: window.runIntro(options) -> Promise

(function () {
  'use strict';

  const DEFAULTS = {
    // --- timings (all ms except lettersPerSec) ---
    lettersPerSec: 10,          // characters per second (typing rate)
    rowPauseMs: 250,            // pause after each line
    gridFadeStart: 0.10,        // FRACTION of total intro duration when grid starts fading in (0..1)
    gridFadeMs: 2500,           // grid fade duration
    textFadeOutMs: 2500,        // text fade out duration
    minTypingHoldMs: 1000,      // small hold after last char before fading text

    // --- grid look ---
    gridOpacity: 0.18,          // final grid opacity (multiplied by fade progress)
    gridStroke: 1.0,            // grid line width in CSS pixels

    // --- font for TITLE TYPING (unchanged) ---
    fontURL: 'fonts/BPdotsUnicase.otf',
    fontFamily: 'BPdotsUnicase',

    // baseline text size: tile * textScale (used when per‑row sizes are not provided)
    textScale: 0.82,            // fraction of tile size -> font px

    // OPTIONAL: per‑row absolute font size in px (one entry per title line); null to disable
    fontPxByRow: [32, 36, 22, 22],

    // --- content & layout for TITLE TYPING (unchanged) ---
    titleLines: [
      'Antalya Bilim University',
      '10+',
      '',
      'Ontology of Representations;',
      'Co-construction of Knowledge',
      '',
      'Temsillerin Ontolojisi;',
      'Bilginin Ortaklaşa İnşası'
    ],
    padTilesLeft: 1,            // left padding in tiles
    padTilesTop: 1,             // top padding in tiles
    lineGapTiles: 1,            // vertical gap between rows (in tiles)

    // ---------- Dual-language WARNING (new combined screen) ----------
    showWarning: true,
    // Fonts for warning
    warnTitleBlackURL:   'fonts/Satoshi-Black.otf',  // "WARNING" / "UYARI"
    warnBodyMediumURL:   'fonts/Satoshi-Light.otf',  // body paragraphs (you asked for Medium/Light look)
    warnTitleBlackFamily:'SatoshiBlack',
    warnBodyMediumFamily:'SatoshiLight',

    // Texts
    warnTitleEN: 'WARNING',
    warnBodyEN:
      'This presentation contains flashing lights and high-contrast motion. ' +
      'It may potentially trigger seizures for people with photosensitive epilepsy. ' +
      'Viewer discretion is advised.',
    warnTitleTR: 'UYARI',
    warnBodyTR:
      'Bu sunum, yüksek kontrastlı hareket ve yanıp sönen ışıklar içermektedir. ' +
      'Fotosensitif epilepsisi olan kişilerde nöbetleri tetikleyebilir. ' +
      'İzleyicilerin dikkatli olması önerilir.',

    // Warning timing
    warnFadeInMs:  900,
    warnHoldMs:    2600,
    warnFadeOutMs: 900,

    // Warning sizing & layout (relative to viewport height)
    warnTitlePx:   null,   // if null -> computed from H*0.030
    warnBodyPx:    null,   // if null -> computed from H*0.024
    warnMaxWidthVw: 40,    // max text width as % of viewport width
    warnBlockGapPx: 24,    // vertical gap between EN and TR blocks
    warnRule: {            // subtle separator rule between EN & TR (optional)
      enabled: false,
      heightPx: 1,
      alpha: 0.24,
      gapAbovePx: 14,
      gapBelowPx: 14
    },

    // Colors
    bg: '#000000',
    fg: '#ffffff',
    gridColor: '#c8cacc', // stroke color for grid

    // --- click SFX for typing (new) ---
    clickEnabled: true,
    clickURL: 'audio/digital-click.mp3',
    clickForRows: [0, 1, 2, 3, 4, 5, 6, 7],   // play clicks for rows 0 ("Antalya Bilim University") and 1 ("10+")
    clickVolume: 0.6        // 0..1
  };

  const clamp01 = x => Math.max(0, Math.min(1, x));
  const ease = t => (t < 0 ? 0 : (t > 1 ? 1 : 1 - Math.pow(1 - t, 3)));

  // Auto-detect font format from extension so OTF/TTF/WOFF/WOFF2 all work.
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
      // Non-fatal: the browser will use a fallback font
      console.warn('[intro] font load failed, using fallback:', e);
    }
  }

  // Low-latency click player using Web Audio (graceful fallback if blocked)
  async function makeClickPlayer(url, volume=0.6) {
    if (!url) return null;
    try{
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      const ctx = new AC();
      const res = await fetch(url, {cache:'force-cache'});
      const buf = await res.arrayBuffer();
      const audioBuf = await ctx.decodeAudioData(buf);
      const gain = ctx.createGain();
      gain.gain.value = volume;
      gain.connect(ctx.destination);

      // Attempt to unlock on first user gesture (for autoplay policies)
      const unlock = () => {
        if (ctx.state === 'suspended') ctx.resume().catch(()=>{});
        window.removeEventListener('pointerdown', unlock);
        window.removeEventListener('touchstart', unlock);
      };
      window.addEventListener('pointerdown', unlock, { once:true });
      window.addEventListener('touchstart', unlock, { once:true });

      return function play(){
        try{
          // resume if suspended (may be blocked before first gesture)
          if (ctx.state === 'suspended') ctx.resume().catch(()=>{});
          const src = ctx.createBufferSource();
          src.buffer = audioBuf;
          src.connect(gain);
          src.start(0);
        }catch{}
      };
    }catch{
      return null;
    }
  }

  function computeTile() {
    const BASE = 44;
    const W = window.innerWidth, H = window.innerHeight;
    const tCols = Math.floor(W / BASE), tRows = Math.floor(H / BASE);
    const tile = Math.max(1, Math.min(tCols, tRows));
    return { tile, cols: Math.ceil(W / tile), rows: Math.ceil(H / tile) };
  }

  function makeGridPath(tile, cols, rows) {
    const p = new Path2D();
    const gx1 = cols * tile, gy1 = rows * tile;
    for (let x = 0; x <= gx1; x += tile) { p.moveTo(x, 0); p.lineTo(x, gy1); }
    for (let y = 0; y <= gy1; y += tile) { p.moveTo(0, y); p.lineTo(gx1, y); }
    return p;
  }

  // Map each character to a tile cell, centered in that cell
  function layout(lines, tile, cols, rows, padL, padT, gap) {
    const out = [];
    let gy = padT;
    for (const ln of lines) {
      const chars = [...ln];
      let gx = padL;
      const row = [];
      for (let i = 0; i < chars.length && gx < cols; i++, gx++) {
        row.push({ ch: chars[i], cx: gx, cy: gy });
      }
      out.push(row);
      gy += 1 + gap;
      if (gy >= rows) break;
    }
    return out;
  }

  // Simple word-wrap for the warning paragraphs
  function wrapText(ctx, text, maxWidth) {
    const words = String(text).split(/\s+/);
    const lines = [];
    let cur = '';
    for (let i = 0; i < words.length; i++) {
      const test = cur ? (cur + ' ' + words[i]) : words[i];
      if (ctx.measureText(test).width <= maxWidth) {
        cur = test;
      } else {
        if (cur) lines.push(cur);
        cur = words[i];
      }
    }
    if (cur) lines.push(cur);
    return lines;
  }

  async function showWarningIfNeeded(ctx, c, p) {
    if (!p.showWarning) return;

    // Load Satoshi fonts for warning screen
    await Promise.all([
      loadFont(p.warnTitleBlackURL,  p.warnTitleBlackFamily),
      loadFont(p.warnBodyMediumURL,  p.warnBodyMediumFamily)
    ]);

    const W = c.width, H = c.height;
    const maxW = (p.warnMaxWidthVw/100) * W;
    const titlePx = (typeof p.warnTitlePx === 'number' && p.warnTitlePx > 0) ? p.warnTitlePx : Math.round(H * 0.024);
    const bodyPx  = (typeof p.warnBodyPx  === 'number' && p.warnBodyPx  > 0) ? p.warnBodyPx  : Math.round(H * 0.018);
    const blockGap = p.warnBlockGapPx|0;

    // Pre-wrap both blocks
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';

    // English block
    ctx.font = `900 ${titlePx}px "${p.warnTitleBlackFamily}", system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif`;
    const titleENh = titlePx;
    ctx.font = `500 ${bodyPx}px "${p.warnBodyMediumFamily}", system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif`;
    const linesEN = wrapText(ctx, p.warnBodyEN, maxW);
    const bodyENh = linesEN.length * (bodyPx * 1.35);

    // Turkish block
    ctx.font = `900 ${titlePx}px "${p.warnTitleBlackFamily}", system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif`;
    const titleTRh = titlePx;
    ctx.font = `500 ${bodyPx}px "${p.warnBodyMediumFamily}", system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif`;
    const linesTR = wrapText(ctx, p.warnBodyTR, maxW);
    const bodyTRh = linesTR.length * (bodyPx * 1.35);

    // Optional rule spacing
    const ruleTopGap = p.warnRule.enabled ? (p.warnRule.gapAbovePx|0) : 0;
    const ruleBotGap = p.warnRule.enabled ? (p.warnRule.gapBelowPx|0) : 0;
    const ruleH = p.warnRule.enabled ? (p.warnRule.heightPx|0) : 0;

    // Total height to vertically center two blocks
    const totalH =
      titleENh + (bodyENh) +
      ruleTopGap + ruleH + ruleBotGap +
      blockGap +
      titleTRh + (bodyTRh);

    const baseY = Math.round((H - totalH) / 2);
    const cx = Math.round(W/2);

    const t0 = performance.now();
    const tInEnd  = t0 + p.warnFadeInMs;
    const tHold   = tInEnd + p.warnHoldMs;
    const tOutEnd = tHold + p.warnFadeOutMs;

    return new Promise(resolve=>{
      (function loop(now){
        // fill BG
        ctx.setTransform(1,0,0,1,0,0);
        ctx.fillStyle = p.bg;
        ctx.fillRect(0,0,W,H);

        // alpha
        let a = 1;
        if (now <= tInEnd) a = clamp01((now - t0) / Math.max(1,p.warnFadeInMs));
        else if (now >= tHold) a = 1 - clamp01((now - tHold) / Math.max(1,p.warnFadeOutMs));

        // draw EN block
        ctx.save();
        ctx.globalAlpha = a;
        ctx.fillStyle = p.fg;
        // EN title
        ctx.font = `900 ${titlePx}px "${p.warnTitleBlackFamily}", system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif`;
        let y = baseY + titleENh;
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(p.warnTitleEN, cx, y);
        // EN body
        ctx.font = `500 ${bodyPx}px "${p.warnBodyMediumFamily}", system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif`;
        y += Math.round(bodyPx * 0.85);
        for (const line of linesEN){
          ctx.fillText(line, cx, y);
          y += Math.round(bodyPx * 1.35);
        }

        // separator rule
        if (p.warnRule.enabled){
          y += ruleTopGap;
          ctx.globalAlpha = a * (p.warnRule.alpha ?? 0.24);
          ctx.fillRect(Math.round(W*0.15), y, Math.round(W*0.70), ruleH>0?ruleH:1);
          y += (ruleH>0?ruleH:1) + ruleBotGap;
          ctx.globalAlpha = a;
        }

        // block gap before TR
        y += blockGap;

        // TR title
        ctx.font = `900 ${titlePx}px "${p.warnTitleBlackFamily}", system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif`;
        y += titleTRh;
        ctx.fillText(p.warnTitleTR, cx, y);

        // TR body
        ctx.font = `500 ${bodyPx}px "${p.warnBodyMediumFamily}", system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif`;
        y += Math.round(bodyPx * 0.85);
        for (const line of linesTR){
          ctx.fillText(line, cx, y);
          y += Math.round(bodyPx * 1.35);
        }

        ctx.restore();

        if (now < tOutEnd) requestAnimationFrame(loop);
        else resolve();
      })(performance.now());
    });
  }

  window.runIntro = async function runIntro(opts = {}) {
    const p = { ...DEFAULTS, ...opts };

    const c = document.getElementById('c');
    if (!c) throw new Error('canvas #c not found');
    const ctx = c.getContext('2d', { alpha: false });
    c.width = window.innerWidth; c.height = window.innerHeight;

    // Always draw against hard black to avoid the “not fully black” issue
    const bg = p.bg;

    // 1) Show combined warning screen (EN over TR) if enabled
    if (p.showWarning) {
      // Fit canvas (in case)
      c.width = window.innerWidth; c.height = window.innerHeight;
      await showWarningIfNeeded(ctx, c, p);
    }

    // 2) Continue with your original intro typing
    await loadFont(p.fontURL, p.fontFamily);

    const { tile, cols, rows } = computeTile();
    const GRID = makeGridPath(tile, cols, rows);

    const lines = layout(p.titleLines, tile, cols, rows, p.padTilesLeft, p.padTilesTop, p.lineGapTiles);

    // Build a typing schedule (per char timestamps)
    const charMs = 1000 / Math.max(1e-3, p.lettersPerSec);
    const schedule = [];
    let tCur = 0;
    lines.forEach((row, li) => {
      row.forEach(cell => { schedule.push({ t: tCur, ...cell, li }); tCur += charMs; });
      tCur += p.rowPauseMs;
    });

    const typingTotal = tCur;
    const total = typingTotal + p.minTypingHoldMs + p.textFadeOutMs;

    const gridStart = p.gridFadeStart * total;   // when grid starts appearing
    const gridEnd   = gridStart + p.gridFadeMs;

    // Optional per-row font size (px). Fallback to tile * textScale if not provided.
    let fontPxForRow = null;
    if (Array.isArray(p.fontPxByRow)) {
      fontPxForRow = i => {
        const v = p.fontPxByRow[i];
        return (typeof v === 'number' && v > 0) ? v : Math.floor(tile * p.textScale);
      };
    } else {
      const base = Math.floor(tile * p.textScale);
      fontPxForRow = () => base;
    }

    // Prepare click player (if enabled)
    const clickRows = Array.isArray(p.clickForRows) ? p.clickForRows : [];
    const playClick = p.clickEnabled ? (await makeClickPlayer(p.clickURL, p.clickVolume)) : null;

    let revealed = 0; // how many characters revealed

    const t0 = performance.now();
    return new Promise(resolve => {
      (function loop(now) {
        const tMs = now - t0;

        // background
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, c.width, c.height);

        // reveal count + per-char click SFX (only for selected rows)
        while (revealed < schedule.length && tMs >= schedule[revealed].t) {
          const item = schedule[revealed];
          if (playClick && clickRows.indexOf(item.li) !== -1 && item.ch.trim() !== '') {
            // Play one click per visible non-space char on rows 0/1
            playClick();
          }
          revealed++;
        }

        // grid fade
        let gAlpha = 0;
        if (tMs >= gridStart) {
          const k = clamp01((tMs - gridStart) / Math.max(1, p.gridFadeMs));
          gAlpha = k * p.gridOpacity;
        }
        if (gAlpha > 0) {
          ctx.save();
          ctx.globalAlpha = gAlpha;
          ctx.strokeStyle = p.gridColor;
          ctx.lineWidth = p.gridStroke;
          ctx.stroke(GRID);
          ctx.restore();
        }

        // text fade out after typing completes + hold
        let txtAlpha = 1;
        if (tMs > typingTotal + p.minTypingHoldMs) {
          const tt = (tMs - (typingTotal + p.minTypingHoldMs)) / Math.max(1, p.textFadeOutMs);
          txtAlpha = clamp01(1 - tt);
        }

        // draw revealed chars centered in tiles
        if (txtAlpha > 0 && revealed > 0) {
          ctx.save();
          ctx.globalAlpha = txtAlpha;
          ctx.fillStyle = '#ffffff';
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';

          // We can change font per row; cache last size to avoid resetting font every char if same row
          let lastRow = -1;
          for (let i = 0; i < revealed; i++) {
            const { ch, cx, cy, li } = schedule[i];
            if (li !== lastRow) {
              const px = fontPxForRow(li);
              ctx.font = `${px}px "${p.fontFamily}", system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif`;
              lastRow = li;
            }
            const x = cx * tile + tile * 0.5;
            const y = cy * tile + tile * 0.5;
            ctx.fillText(ch, x, y);
          }
          ctx.restore();
        }

        if (tMs < total) {
          requestAnimationFrame(loop);
        } else {
          resolve();
        }
      })(performance.now());
    });
  };
})();
