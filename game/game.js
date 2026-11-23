// 《殭屍防線》玩法：8×8 放方塊，排滿一行或一列就消除
// 第 2 天：格子、托盤、拖曳放置、消除、分數（殭屍和砲台在第 3 天）
window.Game = (function () {
  const C = window.CONFIG, G = C.grid, CELL = G.cell, N = G.size;
  let core, shapes, totalW;
  let grid, tray, drag, flashes, particles, texts, shake, stuckTimer;

  // ---------- 工具 ----------
  function rnd(n) { return Math.floor(Math.random() * n); }
  const shadeCache = {};
  function shade(hex, p) {
    const key = hex + p;
    if (shadeCache[key]) return shadeCache[key];
    const n = parseInt(hex.slice(1), 16);
    let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    const f = p < 0 ? 0 : 255, t = Math.abs(p);
    r = Math.round((f - r) * t + r); g = Math.round((f - g) * t + g); b = Math.round((f - b) * t + b);
    return (shadeCache[key] = 'rgb(' + r + ',' + g + ',' + b + ')');
  }
  function rrect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }
  // 圓角方塊：有亮面和陰影，不用圖片
  function block(ctx, x, y, s, ci, alpha) {
    const base = C.colors[ci], pad = s * 0.04;
    ctx.save();
    ctx.globalAlpha = alpha === undefined ? 1 : alpha;
    ctx.fillStyle = shade(base, -0.45);                       // 下方陰影
    rrect(ctx, x + pad, y + pad + s * 0.09, s - pad * 2, s - pad * 2 - s * 0.02, s * 0.22); ctx.fill();
    ctx.fillStyle = base;                                     // 主體
    rrect(ctx, x + pad, y + pad, s - pad * 2, s - pad * 2 - s * 0.07, s * 0.22); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.34)';                 // 亮面
    rrect(ctx, x + pad + s * 0.1, y + pad + s * 0.08, s - pad * 2 - s * 0.2, s * 0.24, s * 0.12); ctx.fill();
    ctx.restore();
  }

  // ---------- 形狀 ----------
  function parse(m) {
    const cells = []; let w = 0;
    m.forEach(function (row, r) {
      for (let c = 0; c < row.length; c++) if (row[c] === '#') { cells.push([r, c]); if (c + 1 > w) w = c + 1; }
    });
    return { cells: cells, w: w, h: m.length };
  }
  function pickShape() {
    let t = Math.random() * totalW;
    for (let i = 0; i < shapes.length; i++) { t -= shapes[i].weight; if (t < 0) return shapes[i]; }
    return shapes[shapes.length - 1];
  }

  // ---------- 托盤 ----------
  function trayCell(shape) { return Math.min(C.tray.maxCell, (C.tray.slotW - 10) / Math.max(shape.w, shape.h)); }
  function slotX(i) { return C.tray.slotX[i]; }
  function makePiece(i, shape, color) {
    return { slot: i, shape: shape, color: color === undefined ? rnd(C.colors.length) : color, used: false,
             cx: slotX(i), cy: C.tray.y + 90, s: trayCell(shape) };
  }
  function newTray() {
    tray = [0, 1, 2].map(function (i) { return makePiece(i, pickShape()); });
  }

  // ---------- 格子 ----------
  function canPlace(shape, r, c) {
    for (let i = 0; i < shape.cells.length; i++) {
      const rr = r + shape.cells[i][0], cc = c + shape.cells[i][1];
      if (rr < 0 || cc < 0 || rr >= N || cc >= N || grid[rr][cc]) return false;
    }
    return true;
  }
  function anyFit(shape) {
    for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) if (canPlace(shape, r, c)) return true;
    return false;
  }
  // 手指位置 → 方塊要放的格子（左上角）
  function targetCell(piece, px, py) {
    const cx = px, cy = py - C.drag.liftY;
    const left = cx - piece.shape.w * CELL / 2, top = cy - piece.shape.h * CELL / 2;
    return { r: Math.round((top - G.y) / CELL), c: Math.round((left - G.x) / CELL) };
  }

  function addText(x, y, text, color, size) { texts.push({ x: x, y: y, text: text, color: color, size: size, t: 0 }); }

  function place(piece, r, c) {
    piece.used = true;
    const cells = piece.shape.cells;
    cells.forEach(function (p) { grid[r + p[0]][c + p[1]] = { color: piece.color, t: 0 }; });
    let gain = cells.length * C.scoring.perCell;
    core.Sfx.play('place'); core.buzz(10);

    // 找出排滿的行與列（交叉的格子只算一次）
    const rows = [], cols = [];
    for (let i = 0; i < N; i++) {
      let fr = true, fc = true;
      for (let j = 0; j < N; j++) { if (!grid[i][j]) fr = false; if (!grid[j][i]) fc = false; }
      if (fr) rows.push(i);
      if (fc) cols.push(i);
    }
    const n = rows.length + cols.length;
    if (n > 0) {
      const kill = {};
      rows.forEach(function (i) { for (let j = 0; j < N; j++) kill[i * N + j] = 1; });
      cols.forEach(function (j) { for (let i = 0; i < N; i++) kill[i * N + j] = 1; });
      Object.keys(kill).forEach(function (k) {
        const i = Math.floor(k / N), j = k % N;
        flashes.push({ r: i, c: j, color: grid[i][j].color, t: 0 });
        grid[i][j] = null;
      });
      const mults = C.scoring.comboMult;
      const mult = mults[Math.min(n, mults.length - 1)];
      const lineScore = C.scoring.perLine * n * mult;
      gain += lineScore;
      core.Sfx.play('clear'); core.buzz(40); shake = 0.25;
      addText(G.x + N * CELL / 2, G.y + N * CELL / 2 - 20, '+' + lineScore, '#ffe27a', 44);
      if (n >= 2) addText(G.x + N * CELL / 2, G.y + N * CELL / 2 - 80, '連擊 ×' + n, '#ff7a7a', 56);
    }
    score += gain;
    core.setScore(score);

    // 3 個都放完才補新的 3 個
    if (tray.every(function (p) { return p.used; })) newTray();
    checkStuck();
  }
  function checkStuck() {
    const left = tray.filter(function (p) { return !p.used; });
    stuckTimer = left.every(function (p) { return !anyFit(p.shape); }) ? 0.7 : -1;
  }

  // ---------- 對外介面 ----------
  function start() {
    grid = []; for (let i = 0; i < N; i++) grid.push(new Array(N).fill(null));
    score = 0; drag = null; flashes = []; particles = []; texts = []; shake = 0; stuckTimer = -1;
    newTray();
    checkStuck();
  }
  let score = 0;

  function update(dt) {
    // 方塊平滑移動（拖曳中跟著手指，放開後彈回托盤）
    tray.forEach(function (p) {
      if (p.used) return;
      let tx, ty, ts;
      if (drag && drag.piece === p) { tx = drag.px; ty = drag.py - C.drag.liftY; ts = CELL; }
      else { tx = slotX(p.slot); ty = C.tray.y; ts = trayCell(p.shape); }
      const k = 1 - Math.exp(-dt * (drag && drag.piece === p ? 30 : 16));
      p.cx += (tx - p.cx) * k; p.cy += (ty - p.cy) * k; p.s += (ts - p.s) * k;
    });
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) if (grid[i][j]) grid[i][j].t += dt;
    for (let i = flashes.length - 1; i >= 0; i--) {
      const f = flashes[i]; f.t += dt;
      if (f.t >= 0.18) {                                   // 閃光後碎裂
        const x = G.x + f.c * CELL + CELL / 2, y = G.y + f.r * CELL + CELL / 2;
        for (let k = 0; k < 6; k++) {
          const a = Math.random() * Math.PI * 2, v = 120 + Math.random() * 200;
          particles.push({ x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 80, t: 0, life: 0.5 + Math.random() * 0.3, color: f.color, s: 8 + Math.random() * 10 });
        }
        flashes.splice(i, 1);
      }
    }
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i]; p.t += dt; p.vy += 700 * dt; p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.t >= p.life) particles.splice(i, 1);
    }
    for (let i = texts.length - 1; i >= 0; i--) { const t = texts[i]; t.t += dt; if (t.t > 1.1) texts.splice(i, 1); }
    if (shake > 0) shake = Math.max(0, shake - dt);
    if (stuckTimer >= 0 && !drag) {                         // 托盤上的方塊都放不下
      stuckTimer -= dt;
      if (stuckTimer < 0) { stuckTimer = -1; core.Sfx.play('over'); core.endGame(score, 'no_space'); }
    }
  }

  function render(ctx) {
    ctx.save();
    if (shake > 0) ctx.translate((Math.random() - 0.5) * 8 * (shake / 0.25), (Math.random() - 0.5) * 8 * (shake / 0.25));

    // 殭屍區（第 3 天放殭屍）與圍牆線
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fillRect(0, C.zombieZone.top, core.W, C.zombieZone.wallY - C.zombieZone.top);
    ctx.fillStyle = '#8a6a43'; ctx.fillRect(0, C.zombieZone.wallY, core.W, 10);

    // 格子底板
    ctx.fillStyle = '#10201a';
    rrect(ctx, G.x - 10, G.y - 10, N * CELL + 20, N * CELL + 20, 18); ctx.fill();
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      ctx.fillStyle = '#1c3328';
      rrect(ctx, G.x + j * CELL + 2, G.y + i * CELL + 2, CELL - 4, CELL - 4, 8); ctx.fill();
    }
    // 預覽陰影
    let ghost = null;
    if (drag) {
      const t = targetCell(drag.piece, drag.px, drag.py);
      if (canPlace(drag.piece.shape, t.r, t.c)) {
        ghost = t;
        drag.piece.shape.cells.forEach(function (p) {
          const x = G.x + (t.c + p[1]) * CELL, y = G.y + (t.r + p[0]) * CELL;
          ctx.fillStyle = 'rgba(255,255,255,0.28)';
          rrect(ctx, x + 3, y + 3, CELL - 6, CELL - 6, 9); ctx.fill();
        });
      }
    }
    // 已放的方塊（放下時小彈跳）
    for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
      const b = grid[i][j]; if (!b) continue;
      const x = G.x + j * CELL, y = G.y + i * CELL;
      const p = Math.min(1, b.t / 0.2);
      const sc = p >= 1 ? 1 : (p < 0.6 ? 0.7 + p / 0.6 * 0.45 : 1.15 - (p - 0.6) / 0.4 * 0.15);
      block(ctx, x + CELL / 2 - CELL * sc / 2, y + CELL / 2 - CELL * sc / 2, CELL * sc, b.color);
    }
    // 消除閃光
    flashes.forEach(function (f) {
      const x = G.x + f.c * CELL, y = G.y + f.r * CELL;
      block(ctx, x, y, CELL, f.color);
      ctx.fillStyle = 'rgba(255,255,255,' + (0.35 + 0.6 * Math.abs(Math.sin(f.t * 40))) + ')';
      rrect(ctx, x + 2, y + 2, CELL - 4, CELL - 4, 10); ctx.fill();
    });
    // 碎片
    particles.forEach(function (p) {
      ctx.globalAlpha = Math.max(0, 1 - p.t / p.life);
      ctx.fillStyle = C.colors[p.color];
      ctx.fillRect(p.x - p.s / 2, p.y - p.s / 2, p.s, p.s);
    });
    ctx.globalAlpha = 1;

    // 托盤
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    rrect(ctx, 16, C.tray.topY, core.W - 32, 170, 22); ctx.fill();
    tray.forEach(function (p) { if (!p.used && !(drag && drag.piece === p)) drawPiece(ctx, p); });
    if (drag) drawPiece(ctx, drag.piece);

    // 飄字
    texts.forEach(function (t) {
      ctx.globalAlpha = Math.max(0, 1 - t.t / 1.1);
      ctx.font = '900 ' + t.size + 'px "PingFang TC","Microsoft JhengHei",sans-serif';
      ctx.textAlign = 'center'; ctx.lineWidth = 8; ctx.strokeStyle = 'rgba(0,0,0,.6)';
      const y = t.y - t.t * 70;
      ctx.strokeText(t.text, t.x, y); ctx.fillStyle = t.color; ctx.fillText(t.text, t.x, y);
    });
    ctx.globalAlpha = 1;
    ctx.restore();
  }
  function drawPiece(ctx, p) {
    const s = p.s, left = p.cx - p.shape.w * s / 2, top = p.cy - p.shape.h * s / 2;
    p.shape.cells.forEach(function (c) { block(ctx, left + c[1] * s, top + c[0] * s, s, p.color); });
  }

  function onPointer(type, x, y) {
    if (type === 'down') {
      if (drag || y < C.tray.topY) return;
      for (let i = 0; i < tray.length; i++) {
        const p = tray[i];
        if (!p.used && Math.abs(x - slotX(p.slot)) < C.tray.slotW / 2) { drag = { piece: p, px: x, py: y }; core.Sfx.play('click'); return; }
      }
    } else if (type === 'move') {
      if (drag) { drag.px = x; drag.py = y; }
    } else if (type === 'up') {
      if (!drag) return;
      const p = drag.piece, t = targetCell(p, x, y);
      drag = null;
      if (canPlace(p.shape, t.r, t.c)) {
        // 直接落到格子位置
        p.cx = G.x + (t.c + p.shape.w / 2) * CELL; p.cy = G.y + (t.r + p.shape.h / 2) * CELL;
        place(p, t.r, t.c);
      }                                                    // 放不下：update 會讓它彈回托盤
    }
  }

  function init(c) {
    core = c;
    shapes = C.shapes.map(function (s) { const o = parse(s.m); o.weight = s.w; return o; });
    totalW = shapes.reduce(function (a, s) { return a + s.weight; }, 0);
  }

  return {
    init: init, start: start, update: update, render: render, onPointer: onPointer,
    // 測試用（不影響玩法）
    _dbg: {
      grid: function () { return grid; }, tray: function () { return tray; },
      setTray: function (list) { tray = list.map(function (m, i) { return makePiece(i, parse(m), i % C.colors.length); }); checkStuck(); },
      setGrid: function (fn) { fn(grid); },
      geom: function () { return { G: G, CELL: CELL, tray: C.tray, liftY: C.drag.liftY }; }
    }
  };
})();
