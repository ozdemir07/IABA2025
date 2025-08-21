// intro.js — tile‑aligned typing + grid fade + fade‑out (minimal changes)
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

    // --- font (now using your OTF) ---
    fontURL: 'fonts/BPdotsUnicase.otf',
    fontFamily: 'BPdotsUnicase',

    // baseline text size: tile * textScale (used when per‑row sizes are not provided)
    textScale: 0.82,            // fraction of tile size -> font px

    // OPTIONAL: per‑row absolute font size in px (one entry per title line).
    // If provided, overrides textScale for that row.
    // Example: [28, 22, 22, 22]
    fontPxByRow: [32, 36, 24, 24], // null if no override

    // --- content & layout ---
    titleLines: [
      'Antalya Bilim University',
      '10+',
      'Ontology of Representations; Co-construction of Knowledge',
      'Temsillerin Ontolojisi; Bilginin Ortaklaşa İnşası'
    ],
    padTilesLeft: 1,            // left padding in tiles
    padTilesTop: 1,             // top padding in tiles
    lineGapTiles: 1,            // vertical gap between rows (in tiles)

    // ====== NEW: bilingual warnings (fonts + timings) ======
    warnFadeInMs: 1200,
    warnHoldMs: 3000,
    warnFadeOutMs: 1200,
    warnGapMs: 600, // blank time after each language block

    // Satoshi fonts (titles/body)
    warnFonts: {
      title: { family: 'SatoshiBlack',  url: 'fonts/Satoshi-Black.otf'  },
      body:  { family: 'SatoshiMedium', url: 'fonts/Satoshi-Medium.otf' }
    },
    // Warning text (TR then EN)
    warningsTR: [
      'UYARI',
      'Bu video, ışığa duyarlı epilepsi hastalarında nöbetlere neden olabilir.',
      'İzleyicinin dikkatine sunulur.'
    ],
    warningsEN: [
      'WARNING',
      'This video may potentially trigger seizures for people with photosensitive epilepsy.',
      'Viewer discretion is advised.'
    ]
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

  // ---- NEW: draw a centered warning block with Satoshi fonts ----
  function drawWarningBlock(ctx, cx, cy, basePx, lines, fonts) {
    const gapPx = Math.floor(basePx * 0.6);
    const totalH = lines.length * basePx + (lines.length - 1) * gapPx;
    let y = cy - totalH / 2 + basePx / 2;

    lines.forEach((ln, i) => {
      const fam = (i === 0 ? fonts.title.family : fonts.body.family);
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `${basePx}px "${fam}", system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif`;
      ctx.fillText(ln, cx, y);
      y += basePx + gapPx;
    });
  }

  window.runIntro = async function runIntro(opts = {}) {
    const p = { ...DEFAULTS, ...opts };

    const c = document.getElementById('c');
    if (!c) throw new Error('canvas #c not found');
    const ctx = c.getContext('2d', { alpha: false });
    c.width = window.innerWidth; c.height = window.innerHeight;

    // load fonts (existing title font + Satoshi for warnings)
    await Promise.all([
      loadFont(p.fontURL, p.fontFamily),
      loadFont(p.warnFonts.title.url, p.warnFonts.title.family),
      loadFont(p.warnFonts.body.url,  p.warnFonts.body.family)
    ]);

    const bg = '#000000';
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
    const gridEnd   = gridStart + p.gridFadeMs;  // (kept to preserve your original vars)

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

    // ---- NEW: total warning time (TR + EN), each with fade in/hold/fade out + gap ----
    const perBlock = p.warnFadeInMs + p.warnHoldMs + p.warnFadeOutMs + p.warnGapMs;
    const warnTotal = perBlock * 2;

    let revealed = 0; // how many characters revealed

    const t0 = performance.now();
    return new Promise(resolve => {
      (function loop(now) {
        const tMs = now - t0;

        // background
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = bg;
        ctx.fillRect(0, 0, c.width, c.height);

        // ---- warnings phase first ----
        if (tMs < warnTotal) {
          const half = perBlock;
          const local = tMs < half ? tMs : (tMs - half);
          const block = tMs < half ? p.warningsEN : p.warningsTR;

          let alpha = 0;
          if (local < p.warnFadeInMs) {
            alpha = clamp01(local / p.warnFadeInMs);
          } else if (local < p.warnFadeInMs + p.warnHoldMs) {
            alpha = 1;
          } else if (local < p.warnFadeInMs + p.warnHoldMs + p.warnFadeOutMs) {
            const t = (local - (p.warnFadeInMs + p.warnHoldMs)) / Math.max(1, p.warnFadeOutMs);
            alpha = clamp01(1 - t);
          } else {
            alpha = 0; // gap time
          }

          if (alpha > 0) {
            ctx.save();
            ctx.globalAlpha = alpha;
            drawWarningBlock(ctx, c.width / 2, c.height / 2, Math.floor(tile * 0.9), block, p.warnFonts);
            ctx.restore();
          }

          requestAnimationFrame(loop);
          return;
        }

        // ---- normal intro after warnings (time-shifted by warnTotal) ----
        const tIntro = tMs - warnTotal;

        // reveal count
        while (revealed < schedule.length && tIntro >= schedule[revealed].t) revealed++;

        // grid fade
        let gAlpha = 0;
        if (tIntro >= gridStart) {
          const k = clamp01((tIntro - gridStart) / Math.max(1, p.gridFadeMs));
          gAlpha = k * p.gridOpacity;
        }
        if (gAlpha > 0) {
          ctx.save();
          ctx.globalAlpha = gAlpha;
          ctx.strokeStyle = '#c8cacc';
          ctx.lineWidth = p.gridStroke;
          ctx.stroke(GRID);
          ctx.restore();
        }

        // text fade out after typing completes + hold
        let txtAlpha = 1;
        if (tIntro > typingTotal + p.minTypingHoldMs) {
          const tt = (tIntro - (typingTotal + p.minTypingHoldMs)) / Math.max(1, p.textFadeOutMs);
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

        if (tIntro < total) {
          requestAnimationFrame(loop);
        } else {
          resolve();
        }
      })(performance.now());
    });
  };
})();
