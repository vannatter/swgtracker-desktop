/* SWG Tracker — Share card renderer (WTS / WTB ad image + Discord text).

   !! TWO COPIES — KEEP THEM BYTE-IDENTICAL !!
     website:  ~/workspace/swgtracker/js/share-card.js
     app:      ~/workspace/swgtrackerdesktop/web/js/share-card.js
   Edit one, copy it over the other (cmp should report nothing).

   Dependency-free. Exposes window.SWGTShare:
     SWGTShare.renderCard(ad, { scale }) -> Promise<HTMLCanvasElement>
     SWGTShare.renderText(ad)            -> string (Discord markdown)
     SWGTShare.normalize(ad)             -> { wts, items, ... } (see below)
     SWGTShare.totals(ad)                -> { grand, offers, priced }
     SWGTShare.stats(resource)           -> [{ key, label, value, pct, cls, color }]
     SWGTShare.topStats(resource, n)     -> the n best stats (by % of cap), stat order
     SWGTShare.wayText(waypoint)         -> '/way tatooine 3520 -4810 label'
     SWGTShare.parseWay(text)            -> { planet, x, y, label } | null
     SWGTShare.parseAmount('50k')        -> 50000 (NaN when unreadable)
     SWGTShare.fmtNum / fmtCpu / PLANETS / resourceUrl

   ad = {
     side: 'wts' | 'wtb'                 // (`mode` is accepted too)
     items: [{ resource, amount, cpu }]  // resource: { id, name, type_name, status, oq..pe,
                                         //   oq_max..pe_max, planet_* flags }
                                         // amount/cpu per item, either may be missing
     who, contact,                       // strings (optional)
     waypoint: { planet, x, y, label }   // optional; planet = SWG name ('tatooine', 'yavin4')
     date,                               // Date | unix seconds | ms (default: now)
     logoUrl,                            // same-origin image so the canvas isn't tainted
     siteUrl,                            // default 'https://swgtracker.com'
   }
   The old single-resource shape ({ mode, resource, amount, cpu, ... }) still works.
   1 item -> the compact card (~1000x380); 2+ -> a list (max 8 rows + "+N more").
   Stat colours use the site/app qualityClass() scale: % of the class cap
   great >= 96, good >= 90, fair >= 80, ok >= 50, poor below. */
(function () {
  'use strict';

  const W = 1000;
  const MAX_ROWS = 8;
  const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif';
  const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace';
  // tokens from css/app-theme.css (site) / web/css/app.css (app)
  const C = {
    bg: '#14161d', bg2: '#20222F', card: '#20232d', input: '#323546', border: '#2f3442',
    accent: '#e24350', better: '#2e6ae2',
    text: '#cccccc', hover: '#eeeeee', muted: '#777777', soft: '#9a9fb0',
    great: '#fe614f', good: '#ffff6e', fair: '#88fba5', ok: '#cccccc', poor: '#777777',
  };
  const Q_COLOR = { 'q-great': C.great, 'q-good': C.good, 'q-fair': C.fair, 'q-ok': C.ok, 'q-poor': C.poor };
  const STATS = ['oq', 'cr', 'cd', 'dr', 'hr', 'ma', 'sr', 'ut', 'fl', 'pe'];
  // resource row planet flag -> [display name, /way planet name]
  const PLANETS = [
    ['planet_corellia', 'Corellia', 'corellia'], ['planet_dantooine', 'Dantooine', 'dantooine'],
    ['planet_dathomir', 'Dathomir', 'dathomir'], ['planet_endor', 'Endor', 'endor'], ['planet_lok', 'Lok', 'lok'],
    ['planet_naboo', 'Naboo', 'naboo'], ['planet_rori', 'Rori', 'rori'], ['planet_talus', 'Talus', 'talus'],
    ['planet_tatooine', 'Tatooine', 'tatooine'], ['planet_yavin4', 'Yavin IV', 'yavin4'],
    ['planet_kashyyyk', 'Kashyyyk', 'kashyyyk'], ['planet_mustafar', 'Mustafar', 'mustafar'],
  ];
  // api/waypoints.php planet codes -> /way names
  const PLANET_CODES = { cor: 'corellia', dan: 'dantooine', dat: 'dathomir', end: 'endor', lok: 'lok', nab: 'naboo',
    ror: 'rori', tal: 'talus', tat: 'tatooine', yav: 'yavin4', kas: 'kashyyyk', mus: 'mustafar' };

  const int = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : 0; };
  const str = (v) => String(v == null ? '' : v).replace(/\s+/g, ' ').trim();

  function qualityClass(pct) {
    if (pct >= 96) return 'q-great';
    if (pct >= 90) return 'q-good';
    if (pct >= 80) return 'q-fair';
    if (pct >= 50) return 'q-ok';
    return 'q-poor';
  }
  function stats(r) {
    r = r || {};
    const out = [];
    STATS.forEach((k) => {
      const v = int(r[k]);
      if (v <= 0) return;
      const pct = (v / (int(r[k + '_max']) || 1000)) * 100;
      const cls = qualityClass(pct);
      out.push({ key: k, label: k.toUpperCase(), value: v, pct, cls, color: Q_COLOR[cls] });
    });
    return out;
  }
  // the n best stats by % of cap, shown back in the usual stat order
  function topStats(r, n) {
    const all = stats(r);
    const keep = new Set(all.slice().sort((a, b) => b.pct - a.pct || b.value - a.value).slice(0, n || 4).map((s) => s.key));
    return all.filter((s) => keep.has(s.key));
  }
  function planets(r) {
    r = r || {};
    return PLANETS.filter(([k]) => String(r[k] == null ? '0' : r[k]) === '1').map(([, n]) => n);
  }
  const fmtNum = (v) => Math.round(Number(v) || 0).toLocaleString('en-US');
  const fmtCpu = (v) => (Number(v) || 0).toLocaleString('en-US', { maximumFractionDigits: 2 });
  const has = (v) => v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v)) && Number(v) > 0;

  // "50k", "1.2m", "300,000" -> number
  function parseAmount(text) {
    const s = String(text == null ? '' : text).trim().toLowerCase().replace(/[, _]/g, '');
    if (!s) return NaN;
    const m = s.match(/^(\d+(?:\.\d+)?|\.\d+)([kmb])?$/);
    if (!m) return NaN;
    const mult = m[2] === 'k' ? 1e3 : m[2] === 'm' ? 1e6 : m[2] === 'b' ? 1e9 : 1;
    return parseFloat(m[1]) * mult;
  }
  function wayPlanet(p) {
    const s = str(p).toLowerCase().replace(/\s+/g, '');
    if (PLANET_CODES[s]) return PLANET_CODES[s];
    if (s === 'yaviniv' || s === 'yavin') return 'yavin4';
    return s;
  }
  function wayText(w) {
    if (!w || !str(w.planet) || w.x === '' || w.y === '' || w.x == null || w.y == null) return '';
    if (!Number.isFinite(Number(w.x)) || !Number.isFinite(Number(w.y))) return '';
    const label = str(w.label).replace(/`/g, "'");
    return ['/way', wayPlanet(w.planet), Math.round(Number(w.x)), Math.round(Number(w.y)), label].filter((p) => p !== '').join(' ');
  }
  // "/way tatooine 3520 -4810 label", "/wp Tatooine 3520 0 -4810 label" (x z y) -> parts
  function parseWay(text) {
    const t = str(text).replace(/^\/(way|wp|waypoint)\s+/i, '').split(' ');
    if (t.length < 3) return null;
    const planet = wayPlanet(t[0]);
    const nums = [];
    let i = 1;
    while (i < t.length && nums.length < 3 && /^-?\d+(\.\d+)?$/.test(t[i])) { nums.push(Number(t[i])); i++; }
    if (nums.length < 2) return null;
    const [x, y] = nums.length === 3 ? [nums[0], nums[2]] : nums;
    return { planet, x: Math.round(x), y: Math.round(y), label: t.slice(i).join(' ') };
  }
  function resourceUrl(r, siteUrl) {
    const base = String(siteUrl || 'https://swgtracker.com').replace(/\/+$/, '');
    return r && r.name ? `${base}/?r=${encodeURIComponent(r.name)}` : base;
  }
  function toDate(d) {
    if (d instanceof Date) return d;
    const n = Number(d);
    if (Number.isFinite(n) && n > 0) return new Date(n < 1e12 ? n * 1000 : n);
    return new Date();
  }
  const fmtDate = (d) => toDate(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  function normalize(ad) {
    ad = ad || {};
    const raw = Array.isArray(ad.items) ? ad.items
      : (ad.resource ? [{ resource: ad.resource, amount: ad.amount, cpu: ad.cpu }] : []);
    const items = raw.filter((i) => i && i.resource).map((i) => ({
      resource: i.resource,
      amount: has(i.amount) ? Number(i.amount) : null,
      cpu: has(i.cpu) ? Number(i.cpu) : null,
    }));
    const side = String(ad.side || ad.mode || 'wts').toLowerCase();
    return Object.assign({}, ad, { items, wts: side !== 'wtb', side: side === 'wtb' ? 'wtb' : 'wts' });
  }
  const lineTotal = (i) => (has(i.amount) && has(i.cpu) ? Number(i.amount) * Number(i.cpu) : null);
  function totals(ad) {
    const a = ad && ad.items && ad.wts !== undefined ? ad : normalize(ad);
    let grand = 0; let priced = 0; let offers = 0;
    a.items.forEach((i) => { const t = lineTotal(i); if (t !== null) { grand += t; priced++; } else offers++; });
    return { grand, priced, offers };
  }
  function adUrl(a) {
    return a.items.length === 1 ? resourceUrl(a.items[0].resource, a.siteUrl)
      : String(a.siteUrl || 'https://swgtracker.com').replace(/\/+$/, '');
  }

  // ---------------------------------------------------------------- text ----
  const md = (s) => str(s).replace(/([\\*_`~|>])/g, '\\$1');
  function contactText(a) {
    const who = str(a.who); const contact = str(a.contact);
    if (!who && !contact) return '';
    return `${who ? md(who) : ''}${who && contact ? ` (${md(contact)})` : md(contact)}`;
  }
  function renderText(ad) {
    const a = normalize(ad);
    const tag = a.wts ? 'WTS' : 'WTB';
    const lines = [];
    const way = wayText(a.waypoint);
    if (a.items.length <= 1) {
      const it = a.items[0] || { resource: {} };
      const r = it.resource;
      lines.push(`**[${tag}] ${md(r.name || 'Resource')}**${r.type_name ? ` — ${md(r.type_name)}` : ''}`);
      const st = stats(r);
      if (st.length) lines.push(st.map((s) => `${s.label} ${s.value}`).join(' · '));
      const amt = has(it.amount); const cpu = has(it.cpu);
      if (amt && cpu) lines.push(`**${fmtNum(it.amount)}** @ **${fmtCpu(it.cpu)} cpu** (${fmtNum(lineTotal(it))} cr)`);
      else if (amt) lines.push(`**${fmtNum(it.amount)}** units — price negotiable`);
      else if (cpu) lines.push(`@ **${fmtCpu(it.cpu)} cpu**`);
      const ct = contactText(a);
      if (ct) lines.push(`Contact: ${ct}`);
    } else {
      const ct = contactText(a);
      lines.push(`**[${tag}] ${a.items.length} resources**${ct ? ` — ${ct}` : ''}`);
      a.items.forEach((it) => {
        const r = it.resource;
        const st = topStats(r, 4).map((s) => `${s.label} ${s.value}`).join(' · ');
        const qty = has(it.amount) ? fmtNum(it.amount) : '';
        const deal = has(it.cpu) ? `${qty ? `${qty} @ ` : ''}${fmtCpu(it.cpu)} cpu` : `${qty ? `${qty} · ` : ''}offer`;
        lines.push(`• **${md(r.name || 'Resource')}**${r.type_name ? ` (${md(r.type_name)})` : ''}${st ? ` ${st}` : ''} — ${deal}`);
      });
    }
    if (way) lines.push(`${a.wts ? 'Pickup' : 'Drop-off'}: \`${way}\``);
    lines.push(adUrl(a));
    return lines.join('\n');
  }

  // --------------------------------------------------------------- canvas ---
  function loadImage(url) {
    return new Promise((resolve) => {
      if (!url) { resolve(null); return; }
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => resolve(null);
      img.src = url;
    });
  }
  function rr(ctx, x, y, w, h, r) {
    r = Math.min(r, h / 2, w / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  const font = (weight, size, fam) => `${weight} ${size}px ${fam || FONT}`;
  function ellipsize(ctx, text, maxW) {
    if (ctx.measureText(text).width <= maxW) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(t + '…').width > maxW) t = t.slice(0, -1);
    return t + '…';
  }
  // shrink the font until text fits maxW (down to minSize), then ellipsize
  function fitText(ctx, text, maxW, weight, size, minSize, fam) {
    let s = size;
    ctx.font = font(weight, s, fam);
    while (s > minSize && ctx.measureText(text).width > maxW) { s -= 1; ctx.font = font(weight, s, fam); }
    return { text: ellipsize(ctx, text, maxW), size: s };
  }
  // greedy word wrap, at most maxLines (last line ellipsized)
  function wrap(ctx, text, maxW, maxLines) {
    const words = str(text).split(' ');
    const lines = [];
    let cur = '';
    for (let i = 0; i < words.length; i++) {
      const next = cur ? cur + ' ' + words[i] : words[i];
      if (ctx.measureText(next).width <= maxW || !cur) { cur = next; continue; }
      lines.push(cur);
      cur = words[i];
      if (lines.length === maxLines) { cur = ''; lines[maxLines - 1] = ellipsize(ctx, lines[maxLines - 1] + ' ' + words.slice(i).join(' '), maxW); break; }
    }
    if (cur) lines.push(cur);
    return lines.slice(0, maxLines).map((l) => ellipsize(ctx, l, maxW));
  }
  function spaced(ctx, text, x, y, spacing) { // letter-spaced small caps labels
    let cx = x;
    for (const ch of text) { ctx.fillText(ch, cx, y); cx += ctx.measureText(ch).width + spacing; }
    return cx - x;
  }
  function spacedWidth(ctx, text, spacing) {
    let w = 0;
    for (const ch of text) w += ctx.measureText(ch).width + spacing;
    return w - spacing;
  }
  const label = (ctx, t, x, y, color) => { ctx.fillStyle = color || C.muted; ctx.font = font(700, 12); spaced(ctx, t, x, y, 1.6); };
  // text then a smaller muted suffix ("25" "cpu"); returns the total width
  function valueWithUnit(ctx, value, unit, x, y, size, color, align) {
    ctx.font = font(800, size); const vw = ctx.measureText(value).width;
    ctx.font = font(600, Math.round(size * 0.55)); const uw = unit ? ctx.measureText(unit).width + 5 : 0;
    const x0 = align === 'right' ? x - vw - uw : x;
    ctx.fillStyle = color; ctx.font = font(800, size); ctx.fillText(value, x0, y);
    if (unit) { ctx.fillStyle = C.soft; ctx.font = font(600, Math.round(size * 0.55)); ctx.fillText(unit, x0 + vw + 5, y); }
    return vw + uw;
  }

  // ---- shared pieces: background, header, footer
  function paintBackground(ctx, H, wts) {
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);
    const glow = ctx.createRadialGradient(W - 120, 20, 10, W - 120, 20, 460);
    glow.addColorStop(0, wts ? 'rgba(226,67,80,0.15)' : 'rgba(46,106,226,0.17)');
    glow.addColorStop(1, 'rgba(20,22,29,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = wts ? C.accent : C.better;
    ctx.fillRect(0, 0, W, 5);
  }
  function paintHeader(ctx, logo, wts) {
    const LX = 28;
    if (logo) {
      ctx.save(); rr(ctx, LX, 18, 38, 38, 9); ctx.clip();
      ctx.drawImage(logo, LX, 18, 38, 38);
      ctx.restore();
    } else {
      ctx.fillStyle = C.accent; rr(ctx, LX, 18, 38, 38, 9); ctx.fill();
    }
    ctx.fillStyle = C.hover;
    ctx.font = font(700, 23);
    ctx.fillText('SWG Tracker', LX + 50, 45);
    const big = wts ? 'WTS' : 'WTB';
    const small = wts ? 'SELLING' : 'BUYING';
    ctx.font = font(800, 23); const bw = ctx.measureText(big).width;
    ctx.font = font(700, 12); const sw = spacedWidth(ctx, small, 2);
    const badgeW = 18 + bw + 10 + sw + 18;
    const bx = W - 28 - badgeW;
    ctx.fillStyle = wts ? C.accent : C.better;
    rr(ctx, bx, 17, badgeW, 40, 20); ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = font(800, 23); ctx.fillText(big, bx + 18, 45);
    ctx.fillStyle = 'rgba(255,255,255,0.88)';
    ctx.font = font(700, 12); spaced(ctx, small, bx + 18 + bw + 10, 41, 2);
  }
  function paintFooter(ctx, H, a) {
    ctx.fillStyle = C.border;
    ctx.fillRect(28, H - 38, W - 56, 1);
    ctx.font = font(500, 15);
    ctx.fillStyle = C.muted;
    ctx.fillText(`Posted ${fmtDate(a.date)}`, 28, H - 14);
    const link = adUrl(a).replace(/^https?:\/\//, '');
    const dom = link.split('/')[0];
    ctx.font = font(600, 15);
    const lw = ctx.measureText(link).width;
    ctx.fillStyle = C.soft;
    ctx.textAlign = 'right';
    ctx.fillText(link.slice(dom.length), W - 28, H - 14);
    ctx.textAlign = 'left';
    ctx.fillStyle = C.accent;
    ctx.fillText(dom, W - 28 - lw, H - 14);
  }
  function makeCanvas(H, scale) {
    const canvas = document.createElement('canvas');
    canvas.width = W * scale;
    canvas.height = H * scale;
    const ctx = canvas.getContext('2d');
    ctx.scale(scale, scale);
    ctx.textBaseline = 'alphabetic';
    return { canvas, ctx };
  }

  // ---- 1 item: compact card -------------------------------------------------------
  function singleLayout(a) {
    const r = a.items[0].resource;
    const st = stats(r);
    const leftBottom = 168 + Math.ceil(st.length / 2) * 34;
    let right = 92 + 66; // quantity row
    const it = a.items[0];
    if (has(it.amount) && has(it.cpu)) right += 64;
    else right += 28;
    if (str(a.who) || str(a.contact)) right += 34;
    if (wayText(a.waypoint)) right += 56;
    return { H: Math.max(300, Math.max(leftBottom, right) + 52) };
  }
  function paintSingle(ctx, H, a) {
    const it = a.items[0];
    const r = it.resource;
    const LX = 28; const leftW = 556;
    // name + class/planets
    let f = fitText(ctx, str(r.name) || 'Resource', leftW, 800, 54, 30);
    ctx.fillStyle = C.hover; ctx.font = font(800, f.size);
    ctx.fillText(f.text, LX, 118);
    const pl = planets(r);
    let sx = LX;
    if (str(r.type_name)) {
      f = fitText(ctx, str(r.type_name), leftW, 600, 20, 15);
      ctx.fillStyle = C.soft; ctx.font = font(600, f.size);
      ctx.fillText(f.text, sx, 148);
      sx += ctx.measureText(f.text).width;
    }
    if (pl.length && sx < LX + leftW - 80) {
      ctx.font = font(500, 16);
      const pre = sx > LX ? '  ·  ' : '';
      let t = pl.length > 3 ? `${pl.slice(0, 3).join(', ')} +${pl.length - 3}` : pl.join(', ');
      t = ellipsize(ctx, pre + t, LX + leftW - sx);
      ctx.fillStyle = C.muted; ctx.fillText(t, sx, 148);
    }
    // stats: 2-column grid
    const st = stats(r);
    const colW = (leftW - 28) / 2;
    if (st.length) {
      st.forEach((s, i) => {
        const col = i % 2; const row = Math.floor(i / 2);
        const x = LX + col * (colW + 28); const cy = 186 + row * 34;
        ctx.fillStyle = C.text; ctx.font = font(700, 19);
        ctx.fillText(s.label, x, cy + 7);
        const bx = x + 44; const bw = colW - 44 - 60;
        ctx.fillStyle = C.input; rr(ctx, bx, cy - 4.5, bw, 9, 4.5); ctx.fill();
        ctx.fillStyle = s.color; rr(ctx, bx, cy - 4.5, Math.max(9, bw * Math.max(0, Math.min(100, s.pct)) / 100), 9, 4.5); ctx.fill();
        ctx.font = font(800, 21); ctx.textAlign = 'right';
        ctx.fillText(String(s.value), x + colW, cy + 8);
        ctx.textAlign = 'left';
      });
    } else {
      ctx.fillStyle = C.muted; ctx.font = font(500, 17);
      ctx.fillText('No stats recorded for this resource.', LX, 192);
    }
    // right column: price, who, waypoint
    const RX = 616; const RW = W - 28 - RX;
    ctx.fillStyle = C.border; ctx.fillRect(RX - 22, 84, 1, H - 84 - 54);
    let y = 92;
    const amt = has(it.amount); const cpu = has(it.cpu);
    label(ctx, a.wts ? 'QUANTITY' : 'WANTED', RX, y + 12);
    if (amt) {
      const w1 = valueWithUnit(ctx, fmtNum(it.amount), '', RX, y + 46, 32, C.hover);
      if (cpu) valueWithUnit(ctx, `@ ${fmtCpu(it.cpu)}`, 'cpu', RX + w1 + 14, y + 46, 24, C.text);
    } else if (cpu) {
      valueWithUnit(ctx, `@ ${fmtCpu(it.cpu)}`, 'cpu', RX, y + 46, 28, C.hover);
    } else {
      ctx.fillStyle = C.soft; ctx.font = font(600, 20); ctx.fillText('Make an offer', RX, y + 44);
    }
    y += 66;
    if (amt && cpu) {
      label(ctx, 'TOTAL', RX, y + 10);
      const tf = fitText(ctx, fmtNum(lineTotal(it)), RW - 40, 800, 28, 18);
      valueWithUnit(ctx, tf.text, 'cr', RX, y + 42, tf.size, C.fair);
      y += 64;
    } else {
      if (amt) { ctx.fillStyle = C.soft; ctx.font = font(500, 16); ctx.fillText('Price negotiable', RX, y + 4); }
      y += 28;
    }
    const who = str(a.who); const contact = str(a.contact); const way = wayText(a.waypoint);
    if (who || contact) { // one line: SELLER  Dos · in-game mail
      const lab = a.wts ? 'SELLER' : 'BUYER';
      ctx.font = font(700, 12); const lw = spacedWidth(ctx, lab, 1.6);
      label(ctx, lab, RX, y + 20);
      let x = RX + lw + 10;
      if (who) {
        f = fitText(ctx, who, RW - lw - 10, 700, 20, 15);
        ctx.fillStyle = C.hover; ctx.font = font(700, f.size); ctx.fillText(f.text, x, y + 21);
        x += ctx.measureText(f.text).width;
      }
      if (contact && RX + RW - x > 40) {
        ctx.fillStyle = C.text; ctx.font = font(500, 16);
        ctx.fillText(ellipsize(ctx, `${who ? '  ·  ' : ''}${contact}`, RX + RW - x), x, y + 21);
      }
      y += 34;
    }
    if (way) {
      label(ctx, a.wts ? 'PICKUP' : 'DROP-OFF', RX, y + 12);
      y += 18;
      ctx.font = font(600, 15, MONO);
      let wl = way;
      if (ctx.measureText(wl).width > RW - 20) { ctx.font = font(600, 13, MONO); wl = ellipsize(ctx, wl, RW - 20); }
      ctx.fillStyle = C.card; rr(ctx, RX, y, RW, 30, 7); ctx.fill();
      ctx.fillStyle = C.fair; ctx.fillText(wl, RX + 10, y + 20);
    }
  }

  // ---- 2+ items: list ----------------------------------------------------------------
  const ROW_H = 56;
  function multiLayout(a) {
    const n = a.items.length;
    const shown = n > MAX_ROWS ? MAX_ROWS - 1 : n; // the 8th row becomes "+N more"
    const strip = (str(a.who) || str(a.contact) || wayText(a.waypoint)) ? 48 : 0;
    const top = 72 + strip + 26;
    const rows = shown * ROW_H + (n > shown ? 44 : 0);
    return { H: top + rows + 12 + 52, top, shown, strip }; // a shopping list: no grand-total band
  }
  function paintMulti(ctx, H, a, L) {
    const LX = 28; const RE = W - 28;
    let y = 72;
    // who / contact / waypoint strip
    if (L.strip) {
      ctx.fillStyle = C.card; rr(ctx, LX, y, RE - LX, 38, 9); ctx.fill();
      const way = wayText(a.waypoint);
      let wayW = 0;
      if (way) {
        ctx.font = font(600, 15, MONO);
        const lab = a.wts ? 'PICKUP' : 'DROP-OFF';
        const wt = ellipsize(ctx, way, 420);
        wayW = ctx.measureText(wt).width;
        ctx.fillStyle = C.fair; ctx.textAlign = 'right'; ctx.fillText(wt, RE - 14, y + 25); ctx.textAlign = 'left';
        ctx.font = font(700, 12); const lw = spacedWidth(ctx, lab, 1.6);
        label(ctx, lab, RE - 14 - wayW - 12 - lw, y + 24);
        wayW += lw + 40;
      }
      const who = str(a.who); const contact = str(a.contact);
      let x = LX + 14; const maxX = RE - wayW - 14;
      if (who || contact) {
        ctx.font = font(700, 12); const lab = a.wts ? 'SELLER' : 'BUYER';
        label(ctx, lab, x, y + 24); x += spacedWidth(ctx, lab, 1.6) + 12;
        if (who) {
          ctx.font = font(700, 18); const t = ellipsize(ctx, who, Math.max(40, maxX - x));
          ctx.fillStyle = C.hover; ctx.fillText(t, x, y + 25); x += ctx.measureText(t).width;
        }
        if (contact && maxX - x > 60) {
          ctx.font = font(500, 16); const t = ellipsize(ctx, `${who ? '  ·  ' : ''}${contact}`, maxX - x);
          ctx.fillStyle = C.text; ctx.fillText(t, x, y + 25);
        }
      }
      y += 48;
    }
    // column heads
    const X = { chips: 330, qty: 752, cpu: 846, total: RE };
    label(ctx, 'RESOURCE', LX, y + 14);
    label(ctx, 'BEST STATS', X.chips, y + 14);
    ctx.font = font(700, 12);
    [['QTY', X.qty], ['CPU', X.cpu], ['TOTAL', X.total]].forEach(([t, x]) => label(ctx, t, x - spacedWidth(ctx, t, 1.6), y + 14));
    y += 26;
    // rows
    for (let i = 0; i < L.shown; i++) {
      const it = a.items[i]; const r = it.resource;
      if (i % 2 === 0) { ctx.fillStyle = 'rgba(32,35,45,0.55)'; rr(ctx, LX - 8, y, RE - LX + 16, ROW_H, 8); ctx.fill(); }
      let f = fitText(ctx, str(r.name) || 'Resource', 290, 800, 22, 15);
      ctx.fillStyle = C.hover; ctx.font = font(800, f.size); ctx.fillText(f.text, LX, y + 25);
      if (str(r.type_name)) {
        ctx.font = font(500, 14); ctx.fillStyle = C.soft;
        ctx.fillText(ellipsize(ctx, str(r.type_name), 296), LX, y + 45);
      }
      // stat chips
      let cx = X.chips;
      const chipMax = X.qty - 84;
      for (const s of topStats(r, 4)) {
        ctx.font = font(700, 13); const lw = ctx.measureText(s.label).width;
        ctx.font = font(800, 16); const vw = ctx.measureText(String(s.value)).width;
        const w = 8 + lw + 5 + vw + 8;
        if (cx + w > chipMax) break;
        ctx.fillStyle = C.input; rr(ctx, cx, y + 15, w, 27, 7); ctx.fill();
        ctx.fillStyle = C.soft; ctx.font = font(700, 13); ctx.fillText(s.label, cx + 8, y + 33);
        ctx.fillStyle = s.color; ctx.font = font(800, 16); ctx.fillText(String(s.value), cx + 8 + lw + 5, y + 34);
        cx += w + 6;
      }
      // numbers
      ctx.textAlign = 'right';
      ctx.font = font(700, 19); ctx.fillStyle = has(it.amount) ? C.hover : C.muted;
      ctx.fillText(has(it.amount) ? fmtNum(it.amount) : '—', X.qty, y + 35);
      if (has(it.cpu)) { ctx.fillStyle = C.hover; ctx.font = font(700, 19); ctx.fillText(fmtCpu(it.cpu), X.cpu, y + 35); }
      else { ctx.fillStyle = C.soft; ctx.font = font('italic 600', 17); ctx.fillText('offer', X.cpu, y + 35); }
      const t = lineTotal(it);
      if (t !== null) { ctx.fillStyle = C.fair; ctx.font = font(800, 19); ctx.fillText(fmtNum(t), X.total, y + 35); }
      else { ctx.fillStyle = C.muted; ctx.font = font(600, 17); ctx.fillText('—', X.total, y + 35); }
      ctx.textAlign = 'left';
      y += ROW_H;
    }
    if (a.items.length > L.shown) {
      const rest = a.items.slice(L.shown);
      ctx.fillStyle = C.soft; ctx.font = font(600, 18);
      ctx.fillText(`+ ${rest.length} more resource${rest.length === 1 ? '' : 's'}`, LX, y + 28);
      ctx.font = font(500, 15); ctx.fillStyle = C.muted;
      const names = rest.map((i) => str(i.resource.name)).filter(Boolean).join(', ');
      ctx.fillText(ellipsize(ctx, names, X.qty - 200 - 40), 200, y + 28);
      y += 44;
    }
    // no grand total — each line is its own deal (a buy/sell shopping list, not one order)
  }

  async function renderCard(ad, opts) {
    opts = opts || {};
    const scale = opts.scale || 2;
    const a = normalize(ad);
    if (!a.items.length) a.items = [{ resource: {}, amount: null, cpu: null }];
    const logo = await loadImage(a.logoUrl);
    const multi = a.items.length > 1;
    const L = multi ? multiLayout(a) : singleLayout(a);
    const { canvas, ctx } = makeCanvas(L.H, scale);
    paintBackground(ctx, L.H, a.wts);
    paintHeader(ctx, logo, a.wts);
    if (multi) paintMulti(ctx, L.H, a, L); else paintSingle(ctx, L.H, a);
    paintFooter(ctx, L.H, a);
    return canvas;
  }

  window.SWGTShare = {
    renderCard, renderText, normalize, totals, stats, topStats, planets, wayText, parseWay, parseAmount, wayPlanet,
    fmtNum, fmtCpu, fmtDate, resourceUrl, qualityClass, PLANETS, PLANET_CODES, W, MAX_ROWS,
  };
})();
