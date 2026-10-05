/* Ranadinn map viewer — plain JS, no build step. */
(function () {
  'use strict';

  const TW = 24, TH = 15, ROWH = TH * 2;   // sprite size; CGA rows are doubled on screen
  const W = 60, H = 60;

  const PALETTES = {
    white: ['#ffffff', '#000000', 'White on black'],
    green: ['#4af626', '#031a04', 'Green phosphor'],
    amber: ['#ffb000', '#1a0e00', 'Amber'],
    cyan:  ['#55ffff', '#000000', 'CGA cyan'],
    magenta: ['#ff55ff', '#000000', 'CGA magenta'],
    paper: ['#222222', '#f4efe4', 'Ink on paper'],
  };

  const state = {
    areas: null, meta: null, sprites: null,   // sprites: Image
    tinted: {},                               // palette -> canvas of tinted sheet
    palette: localStorage.getItem('ranadinn.palette') || 'white',
    area: 1, zoom: 1, hi: null,               // hi: {x,y} highlight
    ov: { links: true, items: true, signs: true, creatures: false, grid: false, pass: false },
  };

  const $ = (s) => document.querySelector(s);
  const el = (tag, attrs, ...kids) => {
    const e = document.createElement(tag);
    for (const k in attrs || {}) {
      if (k === 'html') e.innerHTML = attrs[k];
      else if (k.startsWith('on')) e.addEventListener(k.slice(2), attrs[k]);
      else e.setAttribute(k, attrs[k]);
    }
    for (const k of kids) e.append(k);
    return e;
  };
  const hex = (b) => '0x' + b.toString(16).toUpperCase().padStart(2, '0');

  // ---- sprite mapping (mirrors the executable's draw routine) --------------
  function spriteFor(b) {
    if (b >= 1 && b <= 0x9B) return b - 1;
    if (b >= 0x9C && b <= 0xB4) return 0x67 - 1;
    if (b >= 0xB5 && b <= 0xBD) return 0x61 - 1;
    if (b >= 0xBE && b <= 0xC3) return 0x62 - 1;
    if (b >= 0xC4 && b <= 0xC8) return 0x5F - 1;
    if (b >= 0xC9 && b <= 0xCD) return 0x60 - 1;
    if (b >= 0xCE && b <= 0xD3) return 0x5D - 1;
    if (b >= 0xD4 && b <= 0xD9) return 0x5E - 1;
    if (b >= 0xDA && b <= 0xDE) return 0x65 - 1;
    if (b >= 0xDF && b <= 0xE8) return 0x66 - 1;
    if (b >= 0xEC && b <= 0xFF) return 0x3C - 1;
    return null;
  }
  function itemKind(b) {
    if (b >= 0x9C && b <= 0xB4) return 'scroll';
    if (b >= 0xB5 && b <= 0xBD) return 'sword';
    if (b >= 0xBE && b <= 0xC3) return 'bow';
    if (b >= 0xC4 && b <= 0xC8) return 'armor';
    if (b >= 0xC9 && b <= 0xCD) return 'shield';
    if (b >= 0xCE && b <= 0xD3) return 'gem';
    if (b >= 0xD4 && b <= 0xD9) return 'jewelry';
    if (b >= 0xDA && b <= 0xDE) return 'potion';
    if (b >= 0xDF && b <= 0xE8) return "wizard's stone";
    return null;
  }
  function tileName(b) {
    const m = state.meta;
    if (b >= 0x02 && b <= 0x1F) return m.creatures[b] ? m.creatures[b].name : 'creature';
    if (b >= 0x20 && b <= 0x33) return m.people[b] || 'person';
    if (b >= 0x9C && b <= 0xEB) { const n = m.items[b - 0x9C]; return (itemKind(b) || 'item') + (n ? ': ' + n : ''); }
    if (b >= 0xEC && b <= 0xFF) return 'sign';
    return m.tileNames[b] || (m.passable.includes(b) ? 'decoration (walkable)' : 'decoration (blocks)');
  }

  // ---- tinted sprite sheets -------------------------------------------------
  function tintedSheet(pal) {
    if (state.tinted[pal]) return state.tinted[pal];
    const [fg, bg] = PALETTES[pal];
    const rows = state.meta.sprites, cols = state.meta.spriteCols;
    const c = document.createElement('canvas');
    c.width = cols * TW; c.height = Math.ceil(rows.length / cols) * TH;
    const g = c.getContext('2d');
    const d = g.createImageData(c.width, c.height);
    const F = hexToRgb(fg), B = hexToRgb(bg);
    for (let i = 0; i < rows.length; i++) {
      const ox = (i % cols) * TW, oy = Math.floor(i / cols) * TH;
      for (let y = 0; y < TH; y++) for (let x = 0; x < TW; x++) {
        const col = (rows[i][y] >> (23 - x)) & 1 ? F : B;
        const o = ((oy + y) * c.width + ox + x) * 4;
        d.data[o] = col[0]; d.data[o + 1] = col[1]; d.data[o + 2] = col[2]; d.data[o + 3] = 255;
      }
    }
    g.putImageData(d, 0, 0);
    state.tinted[pal] = c;
    return c;
  }
  function hexToRgb(h) { return [1, 3, 5].map((i) => parseInt(h.substr(i, 2), 16)); }

  function drawGrid(ctx, grid, pal, scale) {
    const sheet = tintedSheet(pal);
    const cols = state.meta.spriteCols;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = PALETTES[pal][1];
    ctx.fillRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const si = spriteFor(grid[y][x]);
      if (si === null) continue;
      ctx.drawImage(sheet, (si % cols) * TW, Math.floor(si / cols) * TH, TW, TH,
        x * TW * scale, y * ROWH * scale, TW * scale, ROWH * scale);
    }
  }

  // ---- routing -------------------------------------------------------------
  function parseHash() {
    const h = location.hash.slice(1);
    const q = {};
    h.split('&').forEach((kv) => { const [k, v] = kv.split('='); if (k) q[k] = v === undefined ? true : decodeURIComponent(v); });
    return q;
  }
  function route() {
    const q = parseHash();
    let page = 'world';
    if (q.area) page = 'area'; else if ('guide' in q) page = 'guide'; else if ('legend' in q) page = 'legend'; else if ('download' in q) page = 'download';
    document.querySelectorAll('.page').forEach((p) => p.classList.toggle('active', p.id === 'page-' + page));
    document.querySelectorAll('header nav a').forEach((a) => a.classList.toggle('active', a.dataset.nav === page));
    if (page === 'guide' && q.s) { const h = document.getElementById('s-' + q.s); if (h) setTimeout(() => h.scrollIntoView(), 0); }
    if (page === 'area') {
      const id = Math.max(1, Math.min(60, parseInt(q.area, 10) || 1));
      state.hi = q.x && q.y ? { x: +q.x, y: +q.y } : null;
      showArea(id);
    }
  }

  // ---- area viewer ---------------------------------------------------------
  let mapCanvas, overlay, stack, scroll, tooltip;

  function showArea(id) {
    const a = state.areas[id - 1];
    state.area = id;
    $('#area-title').textContent = `${id}. ${a.name}`;
    $('#png-link').href = `maps/area${String(id).padStart(2, '0')}.png`;
    $('#png-link').download = `ranadinn-area${String(id).padStart(2, '0')}.png`;
    document.querySelectorAll('#area-list a').forEach((x) => x.classList.toggle('active', +x.dataset.id === id));
    mapCanvas.width = W * TW; mapCanvas.height = H * ROWH;
    drawGrid(mapCanvas.getContext('2d'), a.grid, state.palette, 1);
    applyZoom();
    renderInfo(a);
    if (state.hi) {
      // scroll the highlighted tile into view
      const sx = (state.hi.x - 1) * TW * state.zoom - scroll.clientWidth / 2;
      const sy = (state.hi.y - 1) * ROWH * state.zoom - scroll.clientHeight / 2;
      scroll.scrollTo(Math.max(0, sx), Math.max(0, sy));
    }
  }

  function applyZoom() {
    const z = state.zoom;
    stack.style.width = (W * TW * z) + 'px';
    stack.style.height = (H * ROWH * z) + 'px';
    mapCanvas.style.width = (W * TW * z) + 'px';
    mapCanvas.style.height = (H * ROWH * z) + 'px';
    overlay.width = Math.round(W * TW * z); overlay.height = Math.round(H * ROWH * z);
    overlay.style.width = overlay.width + 'px'; overlay.style.height = overlay.height + 'px';
    $('#zoom-label').textContent = Math.round(z * 100) + '%';
    drawOverlay();
  }

  function drawOverlay() {
    const a = state.areas[state.area - 1];
    const z = state.zoom, tw = TW * z, th = ROWH * z;
    const g = overlay.getContext('2d');
    g.clearRect(0, 0, overlay.width, overlay.height);
    const ov = state.ov;
    if (ov.grid) {
      g.strokeStyle = 'rgba(128,128,128,.35)'; g.lineWidth = 1;
      for (let x = 0; x <= W; x++) { g.beginPath(); g.moveTo(x * tw + .5, 0); g.lineTo(x * tw + .5, overlay.height); g.stroke(); }
      for (let y = 0; y <= H; y++) { g.beginPath(); g.moveTo(0, y * th + .5); g.lineTo(overlay.width, y * th + .5); g.stroke(); }
      if (z >= 0.75) {
        g.fillStyle = 'rgba(255,255,255,.7)'; g.font = `${Math.max(8, 9 * z)}px ui-monospace, monospace`;
        for (let i = 0; i < W; i += 5) { g.fillText(i + 1, i * tw + 2, 10 * z + 2); g.fillText(i + 1, 2, i * th + 10 * z + 2); }
      }
    }
    if (ov.pass) {
      const P = new Set(state.meta.passable);
      g.fillStyle = 'rgba(80,220,120,.28)';
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (P.has(a.grid[y][x])) g.fillRect(x * tw, y * th, tw, th);
      g.fillStyle = 'rgba(255,80,80,.55)';
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (a.grid[y][x] === 0x9A || a.grid[y][x] === 0x93) g.fillRect(x * tw, y * th, tw, th);
    }
    const mark = (x, y, color, label) => {
      g.strokeStyle = color; g.lineWidth = Math.max(1.5, 2 * z);
      g.strokeRect((x - 1) * tw + 1, (y - 1) * th + 1, tw - 2, th - 2);
      if (label && z >= 0.5) {
        g.font = `bold ${Math.max(9, 11 * z)}px system-ui, sans-serif`;
        const m = g.measureText(label).width;
        const lx = Math.min((x - 1) * tw, overlay.width - m - 6), ly = (y - 1) * th - 3;
        g.fillStyle = 'rgba(0,0,0,.75)'; g.fillRect(lx, ly - 11 * z - 2, m + 6, 12 * z + 4);
        g.fillStyle = color; g.fillText(label, lx + 3, ly);
      }
    };
    if (ov.creatures) {
      a.creatures.forEach((c) => mark(c.x, c.y, '#ff6a6a', z >= 1 ? (state.meta.creatures[c.tile] || {}).name : ''));
      a.people.filter((p) => p.tile >= 0x2C).forEach((p) => mark(p.x, p.y, '#ffa8e0', state.meta.people[p.tile]));
    }
    a.features.forEach((f) => { if (ov.items) mark(f.x, f.y, f.kind === 'trapped floor' ? '#ff6a6a' : '#ffd166', f.kind); });
    if (ov.items) a.items.forEach((it) => mark(it.x, it.y, '#ffd166', it.name));
    if (ov.signs) a.signs.forEach((s) => mark(s.x, s.y, '#c8a2ff', 'sign'));
    if (ov.links) a.links.forEach((l) => {
      const t = l.to && l.to !== state.area ? state.areas[l.to - 1] : null;
      mark(l.x, l.y, '#6fd3ff', t ? `${l.to}. ${shortName(t)}` : l.kind);
    });
    if (state.area === state.meta.start.area) mark(state.meta.start.x, state.meta.start.y, '#7CFC00', 'START');
    if (state.hi) {
      g.strokeStyle = '#7CFC00'; g.lineWidth = 3;
      g.strokeRect((state.hi.x - 1) * tw - 2, (state.hi.y - 1) * th - 2, tw + 4, th + 4);
    }
  }
  function countBy(arr, key) {
    const m = new Map();
    arr.forEach((v) => { const k = key(v); m.set(k, (m.get(k) || 0) + 1); });
    return [...m.entries()];
  }
  function spriteCanvas(tile, scale) {
    const c = document.createElement('canvas'); c.width = TW; c.height = TH; c.className = 'sprite';
    const si = spriteFor(tile), cols = state.meta.spriteCols;
    if (si !== null) c.getContext('2d').drawImage(tintedSheet(state.palette), (si % cols) * TW, Math.floor(si / cols) * TH, TW, TH, 0, 0, TW, TH);
    return c;
  }
  function shortName(a) { return a.name.replace(/ \(.*?\)/g, '').split(',')[0].replace(/^The /, ''); }

  function renderInfo(a) {
    const box = $('#area-info');
    box.innerHTML = '';
    const link = (id, txt) => el('a', { href: `#area=${id}` }, txt || `${id}. ${state.areas[id - 1].name}`);
    if (a.parent) {
      box.append(el('h3', {}, 'Reached from'));
      box.append(el('p', {}, link(a.parent.area), el('span', { class: 'co' }, ` at (${a.parent.x},${a.parent.y})`)));
    }
    if (a.note) { box.append(el('h3', {}, 'Note')); box.append(el('p', { class: 'note' }, a.note)); }
    const exits = a.links.filter((l) => l.to && l.to !== a.id);
    const tele = a.links.filter((l) => l.kind === 'teleporter');
    if (exits.length || tele.length) {
      box.append(el('h3', {}, 'Exits'));
      const ul = el('ul');
      exits.sort((p, q) => p.to - q.to).forEach((l) => ul.append(el('li', {},
        el('span', { class: 'co' }, `(${l.x},${l.y}) `), `${l.kind} → `, link(l.to))));
      tele.forEach((l) => ul.append(el('li', {}, el('span', { class: 'co' }, `(${l.x},${l.y}) `), 'teleporter → islands ',
        link(1, '1'), ' ', link(2, '2'), ' ', link(3, '3'), ' ', link(4, '4'))));
      box.append(ul);
    }
    if (a.kind !== 'island' && a.kind !== 'unused') {
      box.append(el('p', { class: 'rum' }, 'Walk off the map edge to return to where you came from.'));
    }
    if (a.items.length) {
      box.append(el('h3', {}, `Items (${a.items.length})`));
      const ul = el('ul');
      a.items.slice().sort((p, q) => p.name.localeCompare(q.name)).forEach((it) => ul.append(el('li', {},
        el('a', { href: `#area=${a.id}&x=${it.x}&y=${it.y}`, class: 'co' }, `(${it.x},${it.y})`), ` ${it.name} `, el('span', { class: 'co' }, it.kind))));
      box.append(ul);
    }
    if (a.signs.length) {
      box.append(el('h3', {}, 'Signs'));
      const ul = el('ul');
      a.signs.forEach((s) => ul.append(el('li', {}, el('span', { class: 'co' }, `(${s.x},${s.y}) `), s.text)));
      box.append(ul);
    }
    if (a.rumours) {
      box.append(el('h3', {}, 'What the locals say'));
      const ul = el('ul');
      a.rumours.forEach((r) => ul.append(el('li', { class: 'rum' }, r.replace(/\s+/g, ' ').trim())));
      box.append(ul);
    }
    if (a.features.length || a.secretDoors) {
      box.append(el('h3', {}, 'Features'));
      const ul = el('ul');
      countBy(a.features, (f) => f.kind).forEach(([k, n]) => ul.append(el('li', {}, `${n} × ${k}`)));
      if (a.secretDoors) ul.append(el('li', {}, `${a.secretDoors} secret door${a.secretDoors > 1 ? 's' : ''}`));
      box.append(ul);
    }
    const shops = a.people.filter((p) => p.tile >= 0x2C);
    if (shops.length) {
      box.append(el('h3', {}, 'Merchants'));
      const ul = el('ul');
      shops.forEach((p) => ul.append(el('li', {}, el('a', { href: `#area=${a.id}&x=${p.x}&y=${p.y}`, class: 'co' }, `(${p.x},${p.y})`), ' ' + state.meta.people[p.tile])));
      box.append(ul);
    }
    if (a.creatures.length) {
      box.append(el('h3', {}, `Creatures (${a.creatures.length})`));
      const ul = el('ul');
      countBy(a.creatures, (c) => c.tile).sort((p, q) => q[1] - p[1]).forEach(([t, n]) => {
        const cr = state.meta.creatures[t] || { name: 'creature' };
        ul.append(el('li', {}, `${n} × ${cr.name}`, el('span', { class: 'co' }, cr.hd ? ` HD${cr.hd} d${cr.dmg} ${cr.xp}xp` : '')));
      });
      box.append(ul);
    }
  }

  function tileAt(ev) {
    const r = mapCanvas.getBoundingClientRect();
    const x = Math.floor((ev.clientX - r.left) / (TW * state.zoom)) + 1;
    const y = Math.floor((ev.clientY - r.top) / (ROWH * state.zoom)) + 1;
    if (x < 1 || x > W || y < 1 || y > H) return null;
    return { x, y };
  }

  function bindViewer() {
    mapCanvas = $('#map'); overlay = $('#overlay'); stack = $('#map-stack'); scroll = $('#map-scroll'); tooltip = $('#tooltip');
    $('#zoom-in').onclick = () => { state.zoom = Math.min(4, state.zoom * 1.25); applyZoom(); };
    $('#zoom-out').onclick = () => { state.zoom = Math.max(0.25, state.zoom / 1.25); applyZoom(); };
    for (const k in state.ov) {
      const cb = $('#ov-' + k); cb.checked = state.ov[k];
      cb.onchange = () => { state.ov[k] = cb.checked; drawOverlay(); };
    }
    scroll.addEventListener('mousemove', (ev) => {
      const t = tileAt(ev);
      if (!t) { tooltip.style.display = 'none'; return; }
      const a = state.areas[state.area - 1];
      const b = a.grid[t.y - 1][t.x - 1];
      let html = `<b>(${t.x},${t.y})</b> ${tileName(b)} <span style="color:#888">${hex(b)}</span>`;
      const l = a.links.find((q) => q.x === t.x && q.y === t.y);
      if (l && l.to && l.to !== a.id) html += `<br>→ ${l.to}. ${state.areas[l.to - 1].name}`;
      else if (l) html += `<br>${l.kind}`;
      const s = a.signs.find((q) => q.x === t.x && q.y === t.y);
      if (s) html += `<br>“${s.text}”`;
      tooltip.innerHTML = html;
      tooltip.style.display = 'block';
      tooltip.style.left = (ev.clientX + 14) + 'px';
      tooltip.style.top = (ev.clientY + 14) + 'px';
    });
    scroll.addEventListener('mouseleave', () => { tooltip.style.display = 'none'; });
    scroll.addEventListener('click', (ev) => {
      const t = tileAt(ev); if (!t) return;
      const a = state.areas[state.area - 1];
      const l = a.links.find((q) => q.x === t.x && q.y === t.y && q.to && q.to !== a.id);
      if (l) location.hash = `#area=${l.to}&x=${l.x}&y=${l.y}`;
    });
    scroll.addEventListener('wheel', (ev) => {
      if (!ev.ctrlKey && !ev.metaKey) return;
      ev.preventDefault();
      state.zoom = Math.max(0.25, Math.min(4, state.zoom * (ev.deltaY < 0 ? 1.15 : 1 / 1.15)));
      applyZoom();
    }, { passive: false });
  }

  function buildAreaList() {
    const groups = [['island', 'Islands'], ['castle', 'Castles'], ['town', 'Towns'], ['ruins', 'Ruins'], ['dungeon', 'Dungeons'], ['cave', 'Caves']];
    const list = $('#area-list');
    const render = (filter) => {
      list.innerHTML = '';
      groups.forEach(([kind, title]) => {
        const items = state.areas.filter((a) => a.kind === kind && (!filter || a.name.toLowerCase().includes(filter) || String(a.id) === filter));
        if (!items.length) return;
        list.append(el('h4', {}, title));
        items.forEach((a) => list.append(el('a', { href: `#area=${a.id}`, 'data-id': a.id },
          el('span', { class: 'n' }, a.id), a.name)));
      });
      document.querySelectorAll('#area-list a').forEach((x) => x.classList.toggle('active', +x.dataset.id === state.area));
    };
    render('');
    $('#area-search').addEventListener('input', (ev) => render(ev.target.value.trim().toLowerCase()));
  }

  // ---- world page ------------------------------------------------------------
  function buildWorld() {
    const host = $('#world-islands');
    host.innerHTML = '';
    for (let id = 1; id <= 4; id++) {
      const a = state.areas[id - 1];
      const c = document.createElement('canvas');
      const sc = 0.5;
      c.width = W * TW * sc; c.height = H * ROWH * sc;
      const g = c.getContext('2d');
      drawGrid(g, a.grid, state.palette, sc);
      // labels
      g.font = 'bold 11px system-ui, sans-serif';
      a.links.filter((l) => l.to && l.to !== id).forEach((l) => {
        const t = state.areas[l.to - 1];
        const label = `${l.to} ${t.kind === 'cave' ? '' : shortName(t)}`.trim();
        const px = (l.x - 1) * TW * sc, py = (l.y - 1) * ROWH * sc;
        g.strokeStyle = '#6fd3ff'; g.lineWidth = 2; g.strokeRect(px, py, TW * sc, ROWH * sc);
        const m = g.measureText(label).width;
        const lx = Math.min(px + TW * sc + 2, c.width - m - 4), ly = Math.max(12, py + 12);
        g.fillStyle = 'rgba(0,0,0,.8)'; g.fillRect(lx - 2, ly - 11, m + 4, 14);
        g.fillStyle = '#ffd166'; g.fillText(label, lx, ly);
      });
      if (id === state.meta.start.area) {
        const px = (state.meta.start.x - 1) * TW * sc, py = (state.meta.start.y - 1) * ROWH * sc;
        g.strokeStyle = '#7CFC00'; g.lineWidth = 2; g.strokeRect(px - 1, py - 1, TW * sc + 2, ROWH * sc + 2);
        g.fillStyle = '#7CFC00'; g.fillText('START', px + TW * sc + 3, py + ROWH * sc + 10);
      }
      c.onclick = () => { location.hash = `#area=${id}`; };
      const ul = el('ul');
      a.links.filter((l) => l.to && l.to !== id).sort((p, q) => p.to - q.to).forEach((l) => {
        const t = state.areas[l.to - 1];
        ul.append(el('li', {}, el('a', { href: `#area=${l.to}` }, `${l.to}. ${t.name}`), el('span', { class: 'co' }, ` (${l.x},${l.y})`)));
      });
      a.links.filter((l) => l.kind === 'teleporter').forEach((l) => ul.append(el('li', {}, `Teleporter at (${l.x},${l.y})`)));
      host.append(el('div', { class: 'island' }, el('h3', {}, el('a', { href: `#area=${id}` }, `${id}. ${a.name}`)), c, ul));
    }
  }

  // ---- guide dynamic sections ------------------------------------------------
  function buildGuide() {
    const areas = state.areas;
    const link = (id) => el('a', { href: `#area=${id}` }, `${id}. ${areas[id - 1].name}`);
    // world structure
    const gw = $('#guide-world'); gw.innerHTML = '';
    for (let id = 1; id <= 4; id++) {
      const a = areas[id - 1];
      gw.append(el('h4', {}, link(id)));
      const ul = el('ul');
      a.links.filter((l) => l.to && l.to !== id).sort((p, q) => p.to - q.to).forEach((l) => {
        const t = areas[l.to - 1];
        let extra = '';
        if (t.kind === 'castle' || t.kind === 'dungeon') {
          const levels = [];
          for (let k = l.to; k <= 60 && areas[k - 1].links.some((q) => q.kind === 'ladder down'); k++) levels.push(k + 1);
          if (levels.length) extra = ` (levels: ${[l.to, ...levels].join(', ')})`;
        }
        ul.append(el('li', {}, el('span', { class: 'co' }, `(${l.x},${l.y}) `), link(l.to), extra,
          t.items.length ? el('span', { class: 'co' }, ` · ${t.items.length} item${t.items.length > 1 ? 's' : ''}`) : ''));
      });
      a.links.filter((l) => l.kind === 'teleporter').forEach((l) => ul.append(el('li', {}, el('span', { class: 'co' }, `(${l.x},${l.y}) `), 'teleporter to the other islands')));
      gw.append(ul);
    }
    const m = state.meta;
    // ending screenshots
    const ge = $('#ending-shots'); if (ge) { ge.innerHTML = ''; (window.RANADINN_ENDING || []).forEach((f, i) => ge.append(el('img', { src: 'maps/ending/' + f, alt: 'Ending screen ' + (i + 1), loading: 'lazy' }))); }
    // crown fragments
    const gc = $('#guide-crown'); gc.innerHTML = '';
    const ct = el('table', {}, el('tr', {}, el('th', {}, '#'), el('th', {}, 'Area'), el('th', {}, 'Where'), el('th', {}, 'Guarded by')));
    let n = 0;
    areas.forEach((ar) => ar.features.filter((f) => f.kind === 'crown piece' || f.kind === 'sceptre').forEach((f) => {
      const ros = countBy(ar.creatures, (c) => c.tile).sort((p, q) => q[1] - p[1]).slice(0, 3).map(([t, k]) => `${k} ${(m.creatures[t] || { name: 'creature' }).name}`).join(', ');
      ct.append(el('tr', {}, el('td', {}, f.kind === 'sceptre' ? 'sceptre' : String(++n)), el('td', {}, link(ar.id)),
        el('td', {}, el('a', { href: `#area=${ar.id}&x=${f.x}&y=${f.y}`, class: 'co' }, `(${f.x},${f.y})`)), el('td', {}, ros)));
    }));
    gc.append(ct);
    // bestiary
    const gb = $('#guide-bestiary'); gb.innerHTML = '';
    const bt = el('table', {}, el('tr', {}, el('th'), el('th', {}, 'Creature'), el('th', {}, 'HD'), el('th', {}, 'Dmg'), el('th', {}, 'Def'),
      el('th', {}, 'Atk'), el('th', {}, 'XP'), el('th', {}, 'Special'), el('th', {}, 'Where')));
    Object.keys(m.creatures).map(Number).sort((p, q) => p - q).forEach((t) => {
      const cr = m.creatures[t];
      const where = el('span');
      areas.forEach((a) => {
        const n = a.creatures.filter((c) => c.tile === t).length;
        if (n) where.append(el('a', { href: `#area=${a.id}` }, `${shortName(a)}${a.kind === 'cave' || a.kind === 'castle' || a.kind === 'dungeon' ? ' ' + a.id : ''} ×${n}`), ' · ');
      });
      bt.append(el('tr', {}, el('td', {}, spriteCanvas(t)), el('td', {}, cr.name), el('td', { class: 'num' }, cr.hd), el('td', { class: 'num' }, cr.dmg),
        el('td', { class: 'num' }, cr.ac), el('td', { class: 'num' }, '+' + cr.hit), el('td', { class: 'num' }, cr.xp || '—'), el('td', {}, cr.special || '—'), el('td', {}, where)));
    });
    gb.append(bt);
    // weapons / armor / spells
    const gw2 = $('#guide-weapons'); gw2.innerHTML = '';
    const priceOf = (name) => { const i = m.items.indexOf(name); const p = i >= 0 ? m.prices[i + 0x9C] : 0; return p ? p + ' gp' : '—'; };
    const wt = el('table', {}, el('tr', {}, el('th', {}, 'Weapon'), el('th', {}, 'Max damage'), el('th', {}, 'To-hit bonus'), el('th', {}, 'Price')));
    m.weapons.forEach(([n, d, b]) => wt.append(el('tr', {}, el('td', {}, n), el('td', { class: 'num' }, d), el('td', { class: 'num' }, b ? '+' + b : '—'), el('td', { class: 'num' }, priceOf(n)))));
    gw2.append(wt);
    const ga = $('#guide-armor'); ga.innerHTML = '';
    const at = el('table', {}, el('tr', {}, el('th', {}, 'Armour'), el('th', {}, 'Value'), el('th', {}, 'Price')));
    m.armor.forEach(([n, v]) => at.append(el('tr', {}, el('td', {}, n), el('td', { class: 'num' }, v), el('td', { class: 'num' }, priceOf(n)))));
    ga.append(at);
    const gsp = $('#guide-spells'); gsp.innerHTML = '';
    const SPELLTEXT = {
      'Flame-light': 'A floating ball of torch-bright light that follows you', 'Mend Wounds': 'Heals small wounds',
      'Nullify Traps': 'Disarms all traps near you', 'Illuminance': 'Lights the area around you for a very long time',
      'Produce Food': 'Adds rations to your food total', 'Excise Disease': 'Cures disease (rat and bat bites)',
      'Warding Symbol': 'A glowing rune in front of you that shocks enemies passing through', 'Detach Curse': 'Removes a curse',
      'Repair Wounds': 'Heals more serious injuries', 'Cancel Poison': 'Stops poison', 'Cure Wounds': 'Heals most damage',
      'Column of Fire': 'A pillar of flame on your enemies', 'Complete Heal': 'Full heal', 'Wall of Blades': 'Whirling blades in a target area',
      'Accurate Arrow': 'Magic missiles that always hit', 'Unlock': 'Unlocks doors within a radius', 'Invisibility': 'Unseen until you attack',
      'Sphere of Flame': 'Fireball; damages everything nearby', 'Cylinder of Cold': 'Cone of cold in front of you',
      'Create Stone': 'Puts a block of stone in an empty square', 'Execution': 'Kills all lesser creatures near you',
      'Crumble': 'Disintegrates one object or creature',
    };
    const st2 = el('table', {}, el('tr', {}, el('th', {}, 'Scroll'), el('th', {}, 'Type'), el('th', {}, 'Needs'), el('th', {}, 'Price'), el('th', {}, 'Effect')));
    m.spells.forEach(([n, k, req]) => st2.append(el('tr', {}, el('td', {}, n), el('td', {}, k), el('td', {}, `${k === 'clerical' ? 'Wis' : 'Int'} ${req}`), el('td', { class: 'num' }, priceOf(n)), el('td', {}, SPELLTEXT[n] || ''))));
    gsp.append(st2);
    const gss = $('#guide-scrollshops'); gss.innerHTML = '';
    const dealers = (tile) => areas.filter((ar) => ar.people.some((p) => p.tile === tile)).map((ar) => {
      const p = ar.people.find((q) => q.tile === tile);
      return el('a', { href: `#area=${ar.id}&x=${p.x}&y=${p.y}` }, `${shortName(ar)} (${p.x},${p.y})`);
    });
    gss.append(el('b', {}, 'Clerical scrolls (priests) are sold in: '));
    dealers(0x2F).forEach((d, i, arr) => gss.append(d, i < arr.length - 1 ? ', ' : '. '));
    gss.append(el('br'), el('b', {}, 'Sorceral scrolls (wizards) are sold in: '));
    dealers(0x33).forEach((d, i, arr) => gss.append(d, i < arr.length - 1 ? ', ' : '.'));
    // shops
    const gsh = $('#guide-shops'); gsh.innerHTML = '';
    const sht = el('table', {}, el('tr', {}, el('th', {}, 'Town'), el('th', {}, 'Merchant'), el('th', {}, 'Where'), el('th', {}, 'Sells')));
    areas.forEach((a) => a.people.filter((p) => p.tile >= 0x2C).sort((p, q) => p.tile - q.tile).forEach((p) => sht.append(el('tr', {},
      el('td', {}, link(a.id)), el('td', {}, m.people[p.tile]), el('td', {}, el('a', { href: `#area=${a.id}&x=${p.x}&y=${p.y}`, class: 'co' }, `(${p.x},${p.y})`)),
      el('td', {}, m.shopStock[p.tile] || '')))));
    gsh.append(sht);
    // area by area
    const gar = $('#guide-areas'); gar.innerHTML = '';
    areas.filter((a) => a.kind !== 'unused').forEach((a) => {
      const box = el('div', { class: 'area' }, el('h4', {}, link(a.id)));
      const ul = el('ul');
      if (a.parent) ul.append(el('li', {}, 'Entered from ', link(a.parent.area), el('span', { class: 'co' }, ` at (${a.parent.x},${a.parent.y})`)));
      if (a.note) ul.append(el('li', { class: 'note' }, a.note));
      a.links.filter((l) => l.to && l.to !== a.id).sort((p, q) => p.to - q.to).forEach((l) => ul.append(el('li', {},
        el('a', { href: `#area=${a.id}&x=${l.x}&y=${l.y}`, class: 'co' }, `(${l.x},${l.y})`), ` ${l.kind} → `, link(l.to))));
      a.links.filter((l) => l.kind === 'teleporter' || l.kind.startsWith('warp')).forEach((l) => ul.append(el('li', {}, el('span', { class: 'co' }, `(${l.x},${l.y}) `), l.kind)));
      const feats = countBy(a.features, (f) => f.kind).map(([k, n]) => `${n} ${k}${n > 1 ? 's' : ''}`);
      if (a.secretDoors) feats.push(`${a.secretDoors} secret door${a.secretDoors > 1 ? 's' : ''}`);
      if (feats.length) ul.append(el('li', {}, 'Features: ' + feats.join(', ')));
      if (a.items.length) ul.append(el('li', {}, 'Items: ' + a.items.map((it) => it.name).sort().join(', ')));
      const shops = a.people.filter((p) => p.tile >= 0x2C);
      if (shops.length) ul.append(el('li', {}, 'Merchants: ' + [...new Set(shops.map((p) => m.people[p.tile]))].join(', ')));
      if (a.creatures.length) {
        const ros = countBy(a.creatures, (c) => c.tile).sort((p, q) => q[1] - p[1]).map(([t, n]) => `${n} × ${(m.creatures[t] || { name: 'creature' }).name}`);
        ul.append(el('li', {}, 'Creatures: ' + ros.join(', ')));
      } else if (a.kind !== 'island') ul.append(el('li', {}, 'No hostile creatures.'));
      if (a.signs.length) ul.append(el('li', {}, 'Signs: ' + a.signs.map((s) => `“${s.text}”`).join(' ')));
      box.append(ul); gar.append(box);
    });
    // items
    const gi = $('#guide-items'); gi.innerHTML = '';
    const tbl = el('table', {}, el('tr', {}, el('th', {}, 'Area'), el('th', {}, 'Where'), el('th', {}, 'Item'), el('th', {}, 'Type')));
    areas.forEach((a) => a.items.slice().sort((p, q) => p.y - q.y || p.x - q.x).forEach((it) => tbl.append(el('tr', {},
      el('td', {}, el('a', { href: `#area=${a.id}&x=${it.x}&y=${it.y}` }, `${a.id}. ${a.name}`)),
      el('td', { class: 'co' }, `(${it.x},${it.y})`), el('td', {}, it.name), el('td', {}, it.kind)))));
    gi.append(tbl);
    // signs
    const gs = $('#guide-signs'); gs.innerHTML = '';
    const st = el('table', {}, el('tr', {}, el('th', {}, 'Area'), el('th', {}, 'Where'), el('th', {}, 'Text')));
    areas.forEach((a) => a.signs.forEach((s) => st.append(el('tr', {},
      el('td', {}, el('a', { href: `#area=${a.id}&x=${s.x}&y=${s.y}` }, `${a.id}. ${a.name}`)),
      el('td', { class: 'co' }, `(${s.x},${s.y})`), el('td', {}, s.text)))));
    gs.append(st);
    // rumours
    const gr = $('#guide-rumours'); gr.innerHTML = '';
    areas.filter((a) => a.rumours).forEach((a) => {
      gr.append(el('h4', {}, link(a.id)));
      const ul = el('ul');
      a.rumours.forEach((r) => ul.append(el('li', {}, r.replace(/\s+/g, ' ').trim())));
      gr.append(ul);
    });
  }

  function buildLegend() {
    const host = $('#legend-grid'); host.innerHTML = '';
    const cols = state.meta.spriteCols;
    const sheet = tintedSheet(state.palette);
    for (let b = 1; b <= 0x9B; b++) {
      const c = document.createElement('canvas'); c.width = TW; c.height = TH;
      const si = b - 1;
      c.getContext('2d').drawImage(sheet, (si % cols) * TW, Math.floor(si / cols) * TH, TW, TH, 0, 0, TW, TH);
      let name = state.meta.tileNames[b];
      if (!name) name = (b >= 2 && b <= 0x1F) ? ((state.meta.creatures[b] || {}).name || 'creature') : (b >= 0x20 && b <= 0x33) ? (state.meta.people[b] || 'person') : 'decoration';
      const walk = state.meta.passable.includes(b) ? 'walkable' : 'blocks movement';
      host.append(el('div', {}, c, el('div', {}, name), el('div', { class: 'hex' }, `${hex(b)} · ${walk}`)));
    }
  }

  // ---- boot ------------------------------------------------------------------
  function setPalette(p) {
    state.palette = p; localStorage.setItem('ranadinn.palette', p);
    document.body.style.setProperty('--map-bg', PALETTES[p][1]);
    buildWorld(); buildLegend(); buildGuide();
    if ($('#page-area').classList.contains('active')) showArea(state.area);
  }

  async function boot() {
    const sel = $('#palette');
    for (const k in PALETTES) sel.append(el('option', { value: k }, PALETTES[k][2]));
    sel.value = state.palette;
    sel.onchange = () => setPalette(sel.value);

    state.areas = window.RANADINN_AREAS; state.meta = window.RANADINN_META;
    if (!state.areas || !state.meta) throw new Error('data/areas.js or data/meta.js did not load');

    bindViewer(); buildAreaList(); buildWorld(); buildGuide(); buildLegend();
    window.addEventListener('hashchange', route);
    route();
  }
  boot().catch((e) => { document.body.insertAdjacentHTML('afterbegin', `<p style="padding:20px;color:#f66">Failed to load: ${e}</p>`); });
})();
