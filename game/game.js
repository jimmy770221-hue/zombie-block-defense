// 《殭屍防線》玩法：8×8 放方塊，排滿一行或一列就消除，消除就開砲打殭屍
// v1.1：等級制（無限）、道具、糖果主題、新手提示
window.Game = (function () {
  const C = window.CONFIG, G = C.grid, CELL = G.cell, N = G.size;
  let core, shapes, totalW;
  let grid, tray, drag, flashes, particles, texts, shake, stuckTimer;
  let zombies, balls, recoil, revived, ending, sinceSpawn, time;
  const Z = C.zombies, WALL_Y = C.zombieZone.wallY, L = C.levels, SH = C.shop;
  // v1.1 新增狀態
  let level = 1, lvScore = 0, lvTime = 0, roundTime = 0, lvBanner = null, lvKey = '';
  let freezeLeft = 0, used = {}, bombMode = false, aim = null, theme = 'classic', hint = false, notice = null;
  let itemBtns = {};
  function pal() { return theme === 'candy' ? C.candyColors : C.colors; }

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
  function candyBlock(ctx, x, y, s, base, alpha) {
    const pad = s * 0.05;
    ctx.save();
    ctx.globalAlpha = alpha === undefined ? 1 : alpha;
    ctx.fillStyle = shade(base, -0.4);                                  // 下方陰影
    rrect(ctx, x + pad, y + pad + s * 0.08, s - pad * 2, s - pad * 2 - s * 0.02, s * 0.4); ctx.fill();
    ctx.fillStyle = base;                                               // 糖果本體
    rrect(ctx, x + pad, y + pad, s - pad * 2, s - pad * 2 - s * 0.07, s * 0.4); ctx.fill();
    ctx.save();                                                         // 斜紋
    rrect(ctx, x + pad, y + pad, s - pad * 2, s - pad * 2 - s * 0.07, s * 0.4); ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = s * 0.13;
    for (let k = -1; k <= 1; k++) { ctx.beginPath(); ctx.moveTo(x + s * (0.2 + k * 0.4), y + s); ctx.lineTo(x + s * (0.9 + k * 0.4), y); ctx.stroke(); }
    ctx.restore();
    ctx.fillStyle = 'rgba(255,255,255,0.7)';                            // 亮點
    ctx.beginPath(); ctx.ellipse(x + s * 0.3, y + s * 0.27, s * 0.12, s * 0.07, -0.6, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  function block(ctx, x, y, s, ci, alpha) {
    if (theme === 'candy') { candyBlock(ctx, x, y, s, pal()[ci], alpha); return; }
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
  // 等級越高，大方塊／難放方塊越常出現（最多變成原本的 2 倍）
  function bigBoost() { return Math.min(L.bigBoostMax, 1 + L.bigBoostPerLevel * (level - 1)); }
  function pickShape() {
    const b = bigBoost();
    let tot = 0;
    for (let i = 0; i < shapes.length; i++) tot += shapes[i].weight * (shapes[i].hard ? b : 1);
    let t = Math.random() * tot;
    for (let i = 0; i < shapes.length; i++) { t -= shapes[i].weight * (shapes[i].hard ? b : 1); if (t < 0) return shapes[i]; }
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


  // ---------- 殭屍 ----------
  function pickType() {
    const names = Object.keys(Z.types).filter(function (k) { return level >= Z.types[k].unlockLevel; });
    let tot = 0; names.forEach(function (k) { tot += Z.types[k].weight; });
    let t = Math.random() * tot;
    for (let i = 0; i < names.length; i++) { t -= Z.types[names[i]].weight; if (t < 0) return names[i]; }
    return names[0];
  }
  function spawnZombie(type) {
    if (zombies.length >= Z.max) return;
    const free = Z.lanes.filter(function (x) {
      return zombies.every(function (z) { return !(Math.abs(z.x - x) < 60 && z.ty < Z.spawnY + 45); });
    });
    if (!free.length) return;
    const x = free[rnd(free.length)] + rnd(21) - 10;
    zombies.push({ type: type || pickType(), x: x, ty: Z.spawnY, y: Z.spawnY - 50, hit: 0, pending: 0, ph: Math.random() * 6 });
  }
  // 前進距離倍率：每級 +0.04，超過 15 級後每級 +0.02，不封頂
  function stepMult() {
    if (level <= L.lateFrom) return 1 + L.stepPerLevel * (level - 1);
    return 1 + L.stepPerLevel * (L.lateFrom - 1) + L.stepPerLevelLate * (level - L.lateFrom);
  }
  // 每放幾個方塊來新殭屍：8 起跳，每 2 級少 1，最少 3
  function spawnEvery() { return Math.max(L.spawnEveryMin, L.spawnEveryStart - Math.floor((level - 1) / L.spawnEveryLevels)); }
  function frontZombie() {
    let f = null;
    zombies.forEach(function (z) { if (!f || z.ty > f.ty) f = z; });
    return f;
  }
  // 每放一個方塊，殭屍前進一步；到間隔就來新殭屍
  function advanceZombies() {
    if (freezeLeft > 0) { freezeLeft--; return; }          // 冰凍中：不前進、不出新殭屍
    const m = stepMult();
    zombies.forEach(function (z) { z.ty += Z.types[z.type].step * m; });
    sinceSpawn++;
    if (sinceSpawn >= spawnEvery()) { sinceSpawn = 0; spawnZombie(); }
  }

  // ---------- 等級 ----------
  function syncLevel(force) {
    const prog = Math.max(lvScore / L.scoreNeed, lvTime / L.secondsNeed);
    const key = level + ':' + Math.round(Math.min(1, prog) * 100);
    if (force || key !== lvKey) { lvKey = key; core.setLevel(level, prog); }
  }
  function checkLevel() {
    if (ending) return;
    if (lvScore >= L.scoreNeed || lvTime >= L.secondsNeed) levelUp();
  }
  function levelUp() {
    level++; lvScore = 0; lvTime = 0;                      // 計時重來
    zombies.forEach(function (z) { z.ty = Math.max(Z.spawnY, z.ty - L.knockback); });   // 獎勵：全部往後退
    if (level % L.waveEvery === 0) for (let i = 0; i < L.waveExtra; i++) spawnZombie();    // 第 5、10、15… 級：一次多來幾隻
    lvBanner = { t: 0, n: level };
    core.Sfx.play('levelup'); core.buzz(30);
    core.track('level_up', { level: level, score: score, seconds: Math.round(roundTime) });
    syncLevel(true);
  }
  // 每消除 1 條，砲台打 1 發，擊退最前面的殭屍
  function fireLines(n) {
    for (let i = 0; i < n; i++) {
      const z = frontZombie();
      if (z) { z.ty = Math.max(Z.spawnY, z.ty - Z.types[z.type].knock); z.pending++; }
      balls.push({ t: -i * C.cannon.shotGap, z: z, fired: false, x: 0, y: 0 });
    }
  }
  function wallBroken() { return zombies.some(function (z) { return z.ty >= WALL_Y; }); }
  function warning() { const f = frontZombie(); return !!f && f.ty >= WALL_Y - Z.warnDist; }

  // ---------- 結束與復活 ----------
  function gameOver(reason) {
    if (ending) return;
    ending = true; stuckTimer = -1; bombMode = false; aim = null; refreshItems();
    const text = reason === 'zombie' ? '殭屍衝破圍牆了！' : '沒有地方可以放方塊了！';
    function finish() { core.Sfx.play('over'); core.endGame(score, reason, { level: level }); }
    if (revived) { finish(); return; }
    core.Sfx.play('over');
    core.askRevive(text, function () { revived = true; ending = false; doRevive(); refreshItems(); }, finish);
  }
  function doRevive() {
    const sz = C.revive.clearSize, off = Math.floor((N - sz) / 2);
    for (let r = off; r < off + sz; r++) for (let c = off; c < off + sz; c++) {
      if (grid[r][c]) { flashes.push({ r: r, c: c, color: grid[r][c].color, t: 0 }); grid[r][c] = null; }
    }
    zombies.forEach(function (z) { z.ty = Z.spawnY; z.pending = 0; });   // 全部擊退到最上方
    balls = []; shake = 0.3;
    core.Sfx.play('clear'); core.buzz(60);
    addText(core.W / 2, G.y + N * CELL / 2, '復活！', '#9be86b', 64);
    for (let i = 0; i < 30 && tray.filter(function (p) { return !p.used; }).every(function (p) { return !anyFit(p.shape); }); i++) newTray();
    checkStuck();
  }

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
    score += gain; lvScore += gain;
    core.setScore(score);
    if (hint) { hint = false; core.Save.set('hintSeen', true); }     // 放了第一個方塊，新手提示就收起來
    if (n > 0) fireLines(n);          // 先砲擊擊退
    checkLevel();                     // 升級（獎勵擊退）
    advanceZombies();                 // 再前進一步
    if (warning()) core.Sfx.play('warn');

    // 3 個都放完才補新的 3 個
    if (tray.every(function (p) { return p.used; })) newTray();
    if (wallBroken()) { gameOver('zombie'); return; }
    checkStuck();
  }
  function checkStuck() {
    const left = tray.filter(function (p) { return !p.used; });
    stuckTimer = left.every(function (p) { return !anyFit(p.shape); }) ? 0.7 : -1;
  }

  // ---------- 道具（每局每種最多用 1 次）----------
  function refreshItems() {
    Object.keys(itemBtns).forEach(function (id) {
      const b = itemBtns[id], n = core.Items.count(id);
      b.lastChild.textContent = n;
      b.classList.toggle('off', n <= 0 || !!used[id] || !!ending);
      b.classList.toggle('aim', id === 'bomb' && bombMode);
    });
  }
  function useItem(id) {
    if (ending || drag || !core.isPlaying() || used[id] || core.Items.count(id) <= 0) return;
    core.Sfx.play('click');
    if (id === 'bomb') { bombMode = !bombMode; aim = null; refreshItems(); return; }
    if (id === 'freeze') {
      core.Items.use('freeze'); used.freeze = true; freezeLeft = SH.freezePlacements;
      notice = { t: 0, text: '冰凍！' }; core.Sfx.play('clear');
    } else if (id === 'shuffle') {
      const slots = tray.filter(function (p) { return !p.used; }).map(function (p) { return p.slot; });
      if (!slots.length) return;
      core.Items.use('shuffle'); used.shuffle = true;
      for (let k = 0; k < 10; k++) {
        slots.forEach(function (sl) { tray[sl] = makePiece(sl, pickShape()); });
        if (tray.some(function (p) { return !p.used && anyFit(p.shape); })) break;
      }
      core.Sfx.play('place'); checkStuck();
    }
    refreshItems();
  }
  function cellAt(x, y) {
    const c = Math.floor((x - G.x) / CELL), r = Math.floor((y - G.y) / CELL);
    return (r >= 0 && c >= 0 && r < N && c < N) ? { r: r, c: c } : null;
  }
  // 炸彈：清掉點到的格子周圍 3×3，不計分、不算連擊
  function detonate(r, c) {
    const R = SH.bombSize; let any = false;
    for (let rr = r - R; rr <= r + R; rr++) for (let cc = c - R; cc <= c + R; cc++) {
      if (rr < 0 || cc < 0 || rr >= N || cc >= N || !grid[rr][cc]) continue;
      flashes.push({ r: rr, c: cc, color: grid[rr][cc].color, t: 0 }); grid[rr][cc] = null; any = true;
    }
    if (!any) { notice = { t: 0, text: '那裡沒有方塊' }; return; }      // 沒炸到東西就不扣道具
    core.Items.use('bomb'); used.bomb = true; bombMode = false; aim = null;
    shake = 0.25; core.Sfx.play('clear'); core.buzz(40);
    refreshItems(); checkStuck();
  }

  // ---------- 對外介面 ----------
  function start() {
    grid = []; for (let i = 0; i < N; i++) grid.push(new Array(N).fill(null));
    score = 0; drag = null; flashes = []; particles = []; texts = []; shake = 0; stuckTimer = -1;
    zombies = []; balls = []; recoil = 0; revived = false; ending = false; sinceSpawn = 0; time = 0;
    level = 1; lvScore = 0; lvTime = 0; roundTime = 0; lvBanner = null; lvKey = '';
    freezeLeft = 0; used = {}; bombMode = false; aim = null; notice = null;
    theme = core.Save.get('theme'); hint = !core.Save.get('hintSeen');
    syncLevel(true); refreshItems();
    for (let i = 0; i < Z.start; i++) spawnZombie();
    newTray();
    checkStuck();
  }
  let score = 0;

  function update(dt) {
    time += dt; roundTime += dt;
    if (!ending) { lvTime += dt; checkLevel(); }
    syncLevel(false);
    if (lvBanner) { lvBanner.t += dt; if (lvBanner.t > L.bannerSec) lvBanner = null; }
    if (notice) { notice.t += dt; if (notice.t > 1.2) notice = null; }
    // 殭屍平滑移動（被砲彈打中前先停住，打中後彈回去）
    zombies.forEach(function (z) {
      if (z.hit > 0) z.hit -= dt;
      if (z.pending > 0) return;
      z.y += (z.ty - z.y) * (1 - Math.exp(-dt * (z.y > z.ty ? 14 : 8)));
    });
    // 砲彈
    for (let i = balls.length - 1; i >= 0; i--) {
      const b = balls[i]; b.t += dt;
      if (b.t < 0) continue;
      if (!b.fired) { b.fired = true; recoil = 1; core.Sfx.play('shoot'); core.buzz(15); }
      const tx = b.z ? b.z.x : C.cannon.x, ty = b.z ? b.z.y - Z.types[b.z.type].r : 100;
      const p = Math.min(1, b.t / C.cannon.flight);
      b.x = C.cannon.x + (tx - C.cannon.x) * p; b.y = (WALL_Y - 30) + (ty - (WALL_Y - 30)) * p;
      if (p >= 1) {
        if (b.z) {
          b.z.pending = Math.max(0, b.z.pending - 1); b.z.hit = 0.2; core.Sfx.play('hit');
          for (let k = 0; k < 8; k++) {
            const a = Math.random() * Math.PI * 2, v = 100 + Math.random() * 160;
            particles.push({ x: tx, y: ty, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, t: 0, life: 0.35, css: '#fff3a0', s: 7 });
          }
        }
        balls.splice(i, 1);
      }
    }
    if (recoil > 0) recoil = Math.max(0, recoil - dt * 6);
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
      if (stuckTimer < 0) { stuckTimer = -1; gameOver('no_space'); }
    }
  }

  function render(ctx) {
    ctx.save();
    if (shake > 0) ctx.translate((Math.random() - 0.5) * 8 * (shake / 0.25), (Math.random() - 0.5) * 8 * (shake / 0.25));

    drawZone(ctx);

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
      ctx.fillStyle = p.css || pal()[p.color];
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
    drawOverlays(ctx);
    ctx.restore();
  }

  // ---------- 提示、升級字樣、道具效果 ----------
  function stext(ctx, text, x, y, size, color) {
    ctx.font = '900 ' + size + 'px "PingFang TC","Microsoft JhengHei",sans-serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'alphabetic'; ctx.lineWidth = Math.max(5, size / 7); ctx.lineJoin = 'round';
    ctx.strokeStyle = 'rgba(0,0,0,.65)'; ctx.strokeText(text, x, y);
    ctx.fillStyle = color; ctx.fillText(text, x, y);
  }
  function drawOverlays(ctx) {
    const mx = G.x + N * CELL / 2, my = G.y + N * CELL / 2;
    if (freezeLeft > 0) {
      ctx.fillStyle = 'rgba(120,200,255,0.18)'; ctx.fillRect(0, 0, C.ui.stripX, WALL_Y);
      stext(ctx, '❄ 冰凍中　剩 ' + freezeLeft + ' 次', 235, 240, 26, '#bfe8ff');
    }
    if (bombMode) {
      if (aim) {
        const R = SH.bombSize;
        for (let rr = aim.r - R; rr <= aim.r + R; rr++) for (let cc = aim.c - R; cc <= aim.c + R; cc++) {
          if (rr < 0 || cc < 0 || rr >= N || cc >= N) continue;
          ctx.fillStyle = 'rgba(255,120,40,0.45)';
          rrect(ctx, G.x + cc * CELL + 3, G.y + rr * CELL + 3, CELL - 6, CELL - 6, 9); ctx.fill();
        }
      }
      stext(ctx, '💣 點一格引爆（再按一次炸彈取消）', mx, G.y + N * CELL + 31, 22, '#ffd29a');
    }
    if (hint) {
      const w = 410, h = 130, bob = Math.sin(time * 5) * 6;
      ctx.fillStyle = 'rgba(0,0,0,0.72)'; rrect(ctx, mx - w / 2, my - h / 2, w, h, 22); ctx.fill();
      ctx.strokeStyle = '#ffd24a'; ctx.lineWidth = 4; rrect(ctx, mx - w / 2, my - h / 2, w, h, 22); ctx.stroke();
      stext(ctx, C.ui.hintText[0], mx, my - 8, 33, '#fff');
      stext(ctx, C.ui.hintText[1], mx, my + 36, 33, '#ffe27a');
      ctx.fillStyle = '#ffd24a'; ctx.beginPath();
      ctx.moveTo(mx - 16, my + h / 2 + 8 + bob); ctx.lineTo(mx + 16, my + h / 2 + 8 + bob); ctx.lineTo(mx, my + h / 2 + 30 + bob); ctx.closePath(); ctx.fill();
    }
    if (lvBanner) {
      const t = lvBanner.t, fade = L.bannerSec;
      const a = t < 0.15 ? t / 0.15 : Math.max(0, 1 - (t - 0.15) / (fade - 0.15));
      ctx.save(); ctx.globalAlpha = a; ctx.translate(core.W / 2, 118);
      const sc = 1 + Math.max(0, 0.3 - t) * 1.2; ctx.scale(sc, sc);
      stext(ctx, 'LEVEL ' + lvBanner.n + '！', 0, 0, 64, '#ffe27a');
      ctx.restore();
    }
    if (notice) { ctx.save(); ctx.globalAlpha = Math.max(0, 1 - notice.t / 1.2); stext(ctx, notice.text, mx, my, 34, '#fff'); ctx.restore(); }
  }

  // ---------- 殭屍區繪製（先用程式畫，第 4 天換成圖片）----------
  // ---------- 圖片素材（載入失敗就退回程式畫）----------
  const ART = {};
  ['normal', 'fast', 'fat', 'cannon', 'wall', 'bg'].forEach(function (n) {
    const im = new Image(); im.onload = function () { ART[n] = im; }; im.src = 'assets/' + n + '.png';
  });
  const FRAME = { normal: 88, fast: 72, fat: 104 };
  function drawZombieArt(ctx, z) {
    const T = Z.types[z.type], im = ART[z.type];
    if (!im) return false;
    const f = FRAME[z.type], size = T.r * 4.2, fr = Math.floor(time * 8 + z.ph * 2) % 4;
    const sq = z.hit > 0 ? 1 + z.hit * 1.2 : 1;
    ctx.save();
    ctx.translate(z.x, z.y);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.ellipse(0, 0, T.r * 0.9, T.r * 0.28, 0, 0, Math.PI * 2); ctx.fill();
    ctx.translate(0, size * 0.1); ctx.scale(1 / sq, sq);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(im, fr * f, 0, f, f, -size / 2, -size, size, size);
    if (z.hit > 0) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = Math.min(0.6, z.hit * 3); ctx.drawImage(im, fr * f, 0, f, f, -size / 2, -size, size, size); }
    ctx.restore();
    return true;
  }
  function drawZombie(ctx, z) {
    if (drawZombieArt(ctx, z)) return;
    const T = Z.types[z.type], r = T.r;
    const bob = Math.sin(time * 8 + z.ph) * 3, sq = z.hit > 0 ? 1 + z.hit * 1.2 : 1;
    ctx.save();
    ctx.translate(z.x, z.y);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.ellipse(0, 0, r * 0.9, r * 0.28, 0, 0, Math.PI * 2); ctx.fill();
    ctx.translate(0, -r + bob); ctx.scale(1 / sq, sq);
    const swing = Math.sin(time * 8 + z.ph) * r * 0.2;
    ctx.fillStyle = shade(T.color, -0.2);                                      // 手
    ctx.beginPath(); ctx.arc(-r * 0.98, -r * 0.1 + swing, r * 0.27, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.arc(r * 0.98, -r * 0.1 - swing, r * 0.27, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = T.color; ctx.strokeStyle = shade(T.color, -0.45); ctx.lineWidth = 3;   // 圓滾滾身體
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.beginPath(); ctx.ellipse(-r * 0.3, -r * 0.55, r * 0.35, r * 0.2, -0.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff';                                                    // 眼睛
    ctx.beginPath(); ctx.arc(-r * 0.36, -r * 0.2, r * 0.27, 0, Math.PI * 2); ctx.arc(r * 0.36, -r * 0.2, r * 0.27, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#222';
    ctx.beginPath(); ctx.arc(-r * 0.32, -r * 0.16, r * 0.11, 0, Math.PI * 2); ctx.arc(r * 0.4, -r * 0.16, r * 0.11, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = '#2a4a2a'; ctx.lineWidth = 3; ctx.lineCap = 'round';     // 嘴
    ctx.beginPath(); ctx.arc(0, r * 0.28, r * 0.22, 0.15 * Math.PI, 0.85 * Math.PI); ctx.stroke();
    if (z.hit > 0) { ctx.fillStyle = 'rgba(255,255,255,' + Math.min(0.8, z.hit * 4) + ')'; ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill(); }
    ctx.restore();
  }
  function drawZone(ctx) {
    if (ART.bg) { ctx.imageSmoothingEnabled = false; ctx.drawImage(ART.bg, 0, 60, 256, 118, 0, C.zombieZone.top, core.W, WALL_Y - C.zombieZone.top); }
    ctx.fillStyle = ART.bg ? 'rgba(0,0,0,0.12)' : 'rgba(0,0,0,0.18)';
    ctx.fillRect(0, C.zombieZone.top, core.W, WALL_Y - C.zombieZone.top);
    ctx.fillStyle = 'rgba(0,0,0,0.38)';                                        // 右邊按鈕欄（殭屍不會走到這裡）
    ctx.fillRect(C.ui.stripX, C.zombieZone.top, core.W - C.ui.stripX, WALL_Y - C.zombieZone.top);
    zombies.slice().sort(function (a, b) { return a.y - b.y; }).forEach(function (z) { drawZombie(ctx, z); });
    // 圍牆
    if (ART.wall) { ctx.imageSmoothingEnabled = false; for (let i = 0; i < 8; i++) ctx.drawImage(ART.wall, 0, 8, 64, 52, i * 67.5, WALL_Y - 6, 68, 44); }
    else { ctx.fillStyle = '#8a6a43'; ctx.fillRect(0, WALL_Y, core.W, 14); ctx.fillStyle = '#b28a58'; ctx.fillRect(0, WALL_Y, core.W, 4); }
    if (warning()) {                                                           // 殭屍快到：圍牆閃紅色
      const a = 0.3 + 0.3 * Math.sin(time * 12);
      ctx.fillStyle = 'rgba(255,40,40,' + a + ')'; ctx.fillRect(0, WALL_Y - 4, core.W, 22);
      ctx.fillStyle = 'rgba(255,40,40,' + (a * 0.25) + ')'; ctx.fillRect(0, C.zombieZone.top, core.W, WALL_Y - C.zombieZone.top);
    }
    // 砲台（開砲時後座力）
    const cx = C.cannon.x, back = recoil * C.cannon.recoil;
    if (ART.cannon) { ctx.imageSmoothingEnabled = false; ctx.drawImage(ART.cannon, 0, 0, 64, 64, cx - 48, WALL_Y - 84 + back, 96, 96); }
    else {
      ctx.fillStyle = '#3a4650'; rrect(ctx, cx - 14, WALL_Y - 40 + back, 28, 44, 8); ctx.fill();
      ctx.fillStyle = '#56646f'; rrect(ctx, cx - 10, WALL_Y - 40 + back, 8, 40, 4); ctx.fill();
      ctx.fillStyle = '#2b333a'; ctx.beginPath(); ctx.arc(cx, WALL_Y + 4, 24, Math.PI, 0); ctx.fill();
    }
    // 砲彈
    balls.forEach(function (b) {
      if (b.t < 0) return;
      ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(b.x, b.y, 10, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ffd24a'; ctx.beginPath(); ctx.arc(b.x - 3, b.y - 3, 4, 0, Math.PI * 2); ctx.fill();
    });
  }

  function drawPiece(ctx, p) {
    const s = p.s, left = p.cx - p.shape.w * s / 2, top = p.cy - p.shape.h * s / 2;
    p.shape.cells.forEach(function (c) { block(ctx, left + c[1] * s, top + c[0] * s, s, p.color); });
  }

  function onPointer(type, x, y) {
    if (bombMode) {                                         // 炸彈瞄準中：點格子引爆
      if (type === 'down' && y >= C.tray.topY) { bombMode = false; aim = null; refreshItems(); }   // 去拖方塊就取消瞄準
      else { if (type === 'up') { const t = cellAt(x, y); aim = null; if (t) detonate(t.r, t.c); } else aim = cellAt(x, y); return; }
    }
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
    shapes.forEach(function (o, i) { o.hard = !!C.shapes[i].hard || o.cells.length >= L.bigCells; });
    totalW = shapes.reduce(function (a, s) { return a + s.weight; }, 0);
    // 升級音效
    core.Sfx.presets.levelup = function () {
      core.Sfx.tone(523, 0.1, 'square', 0.16); core.Sfx.tone(659, 0.1, 'square', 0.16, null, 0.1); core.Sfx.tone(784, 0.26, 'square', 0.2, null, 0.2);
    };
    // 道具按鈕（右邊一欄，不蓋格子和托盤）
    const box = document.createElement('div'); box.id = 'hud-items';
    SH.items.filter(function (it) { return it.kind === 'item'; }).forEach(function (it) {
      const b = document.createElement('button'); b.className = 'itbtn'; b.textContent = it.icon;
      b.appendChild(document.createElement('i'));
      b.onclick = function () { useItem(it.id); };
      itemBtns[it.id] = b; box.appendChild(b);
    });
    document.getElementById('hud').appendChild(box);
  }

  return {
    init: init, start: start, update: update, render: render, onPointer: onPointer,
    // 測試用（不影響玩法）
    _dbg: {
      grid: function () { return grid; }, tray: function () { return tray; },
      setTray: function (list) { tray = list.map(function (m, i) { return makePiece(i, parse(m), i % C.colors.length); }); checkStuck(); },
      setGrid: function (fn) { fn(grid); },
      place: function (i, r, c) { const p = tray[i]; if (!p || p.used || !canPlace(p.shape, r, c)) return false; place(p, r, c); return true; },
      canPlace: function (i, r, c) { const p = tray[i]; return !!p && !p.used && canPlace(p.shape, r, c); },
      zombies: function () { return zombies; },
      info: function () { return { revived: revived, ending: ending, score: score, level: level, lvScore: lvScore, lvTime: lvTime, roundTime: roundTime, freezeLeft: freezeLeft, bombMode: bombMode, used: used, hint: hint, every: spawnEvery(), step: stepMult(), bigBoost: bigBoost() }; },
      setLevelState: function (lv, sc, tm) { level = lv; lvScore = sc; lvTime = tm; syncLevel(true); },
      detonate: detonate, cellAt: cellAt,
      levelUp: levelUp, types: function () { return Object.keys(Z.types).filter(function (k) { return level >= Z.types[k].unlockLevel; }); }, shapeBoost: function () { return bigBoost(); },
      setZombies: function (list) { zombies = []; list.forEach(function (o) { spawnZombie(o.type); const z = zombies[zombies.length - 1]; z.ty = o.ty; z.y = o.ty; }); },
      geom: function () { return { G: G, CELL: CELL, tray: C.tray, liftY: C.drag.liftY }; }
    }
  };
})();
