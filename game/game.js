// 《殭屍防線》玩法：8×8 放方塊，排滿一行或一列就消除，消除就開砲打殭屍
// v1.1：等級制（無限）、道具、糖果主題、新手提示
window.Game = (function () {
  const C = window.CONFIG, G = C.grid, CELL = G.cell, N = G.size;
  let core, shapes, totalW;
  let grid, tray, drag, flashes, particles, texts, shake, stuckTimer;
  let zombies, balls, revived, ending, sinceSpawn, time;
  const Z = C.zombies, WALL_Y = C.zombieZone.wallY, L = C.levels, SH = C.shop;
  // v1.1 新增狀態
  let level = 1, lvScore = 0, roundTime = 0, lvBanner = null, lvKey = '';
  let statLines = 0, statCombo = 0, comboN = 0, comboT = 0, slowT = 0, flashA = 0, rings = [], freezeLeft = 0, used = {}, bombMode = false, aim = null, theme = 'classic', hint = false, notice = null;
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
  const COMBO_COLORS = ['#ffd24a', '#7ad7ff', '#ffb347', '#ff7a7a', '#c58bff', '#ffffff'];
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
  // 補牌：至少有 guaranteeFit 塊現在放得下（轉向也算），避免「不是我的錯」的死局
  function newTray() {
    const need = Math.min(C.tray.guaranteeFit, C.tray.slotX.length);
    for (let k = 0; k < 40; k++) {
      tray = C.tray.slotX.map(function (x, i) { return makePiece(i, pickShape()); });
      if (tray.filter(function (p) { return anyFitRot(p.shape); }).length >= need) break;
    }
  }

  // ---------- 格子 ----------
  function canPlace(shape, r, c) {
    for (let i = 0; i < shape.cells.length; i++) {
      const rr = r + shape.cells[i][0], cc = c + shape.cells[i][1];
      if (rr < 0 || cc < 0 || rr >= N || cc >= N || grid[rr][cc]) return false;
    }
    return true;
  }
  // 順時針轉 90 度（點托盤上的方塊一下）
  function rotShape(sh) {
    return { cells: sh.cells.map(function (c) { return [c[1], sh.h - 1 - c[0]]; }), w: sh.h, h: sh.w, weight: sh.weight, hard: sh.hard };
  }
  // 任何一個轉向放得下就算有空間
  function anyFitRot(shape) {
    let sh = shape;
    for (let k = 0; k < 4; k++) { if (anyFit(sh)) return true; sh = rotShape(sh); }
    return false;
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
    if (zombies.length >= maxZombies()) return;
    const free = Z.lanes.filter(function (x) {
      return zombies.every(function (z) { return !(Math.abs(z.x - x) < 30 && z.ty < Z.spawnY + Z.spawnGap); });
    });
    if (!free.length) return;
    const x = free[rnd(free.length)] + rnd(21) - 10;
    const tp = type || pickType();
    zombies.push({ type: tp, hp: Z.types[tp].hp || 1, x: x, ty: Z.spawnY, y: Z.spawnY - 50, hit: 0, pending: 0, ph: Math.random() * 6 });
  }
  // 前進距離倍率：每級 +0.04，超過 15 級後每級 +0.02，不封頂
  function stepMult() {
    if (level <= L.lateFrom) return 1 + L.stepPerLevel * (level - 1);
    return 1 + L.stepPerLevel * (L.lateFrom - 1) + L.stepPerLevelLate * (level - L.lateFrom);
  }
  // 每放幾個方塊來新殭屍：8 起跳，每 2 級少 1，最少 3
  function moreSteps() { return level >= L.moreFrom ? Math.floor((level - L.moreFrom) / L.moreEvery) + 1 : 0; }   // 5、10、15…級各算一次
  function maxZombies() { return Z.max + L.moreMax * moreSteps(); }
  function spawnEvery() {
    const base = Math.max(L.spawnEveryMin, L.spawnEveryStart - Math.floor((level - 1) / L.spawnEveryLevels)), m = moreSteps();
    return m > 0 ? Math.max(Math.min(base, L.moreSpawnMin), base - L.moreSpawn * m) : base;
  }
  function frontZombie() {
    let f = null;
    zombies.forEach(function (z) { if (z.hp > 0 && (!f || z.ty > f.ty)) f = z; });
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
    const prog = lvScore / L.scoreNeed;
    const key = level + ':' + Math.round(Math.min(1, prog) * 100);
    if (force || key !== lvKey) { lvKey = key; core.setLevel(level, prog); }
  }
  function checkLevel() {
    if (ending) return;
    if (lvScore >= L.scoreNeed) levelUp();
  }
  // 砲塔數量：1 個起，每 perLevels 級多 1 個，最多 max 個
  function cannonCount() { return Math.min(C.cannon.max, 1 + Math.floor(level / C.cannon.perLevels)); }
  function cannonXs() { const k = cannonCount(); return Array.from({ length: k }, function (_, i) { return C.cannon.x + (i - (k - 1) / 2) * C.cannon.spacing; }); }
  // 每座塔的種類：箭塔 → 砲塔 → 機槍塔（由左到右一座一座進化）
  function towerKinds() {
    const T = C.tower, k = cannonCount();
    const cn = level >= T.cannonFrom ? Math.min(C.cannon.max, Math.floor((level - T.cannonFrom) / T.every) + 1) : 0;
    const mg = level >= T.mgFrom ? Math.min(C.cannon.max, Math.floor((level - T.mgFrom) / T.every) + 1) : 0;
    return Array.from({ length: k }, function (_, i) { return i < mg ? 'mg' : (i < cn ? 'cannon' : 'arrow'); });
  }
  function comboMax() { return C.combo.seconds + C.cannon.comboBonus * (cannonCount() - 1); }
  function levelUp() {
    level++; lvScore = 0;
    zombies.forEach(function (z) { z.ty = Math.max(Z.spawnY, z.ty - L.knockback); });   // 獎勵：全部往後退
    if (level % L.waveEvery === 0) for (let i = 0; i < L.waveExtra; i++) spawnZombie();    // 第 5、10、15… 級：一次多來幾隻
    const T = C.tower, evo = level >= T.cannonFrom && level < T.mgFrom && (level - T.cannonFrom) % T.every === 0 ? '箭塔進化成砲塔！' :
      (level >= T.mgFrom && level < T.mgFrom + T.every * C.cannon.max && (level - T.mgFrom) % T.every === 0 ? '砲塔進化成機槍塔！' : '');
    lvBanner = { t: 0, n: level, cannon: level % C.cannon.perLevels === 0 && level / C.cannon.perLevels < C.cannon.max, evo: evo };
    core.Sfx.play('levelup'); core.buzz(30);
    core.track('level_up', { level: level, score: score, seconds: Math.round(roundTime) });
    syncLevel(true);
  }
  // 每消除 1 條，每座塔打一輪：箭塔 1 箭（傷害 1）、砲塔 1 砲彈（傷害 3）、機槍塔連射 5 發（每發傷害 3）
  function shootAt(dmg) {
    const z = frontZombie();
    if (z) { z.hp -= dmg; z.pending++; if (z.hp > 0) z.ty = Math.max(Z.spawnY, z.ty - Z.types[z.type].knock); }
    return z;
  }
  function fireLines(n, lv) {
    const T = C.tower, gap = Math.min(C.cannon.shotGap, C.combo.volleySec / n), xs = cannonXs(), kinds = towerKinds();
    for (let i = 0; i < n; i++) {
      xs.forEach(function (cx, ci) {                 // 每座塔各打一輪
        const kind = kinds[ci];
        if (kind === 'mg') {
          for (let m = 0; m < T.mgShots; m++) balls.push({ t: -i * gap - m * T.mgGap, z: shootAt(T.mgDmg), fired: false, x: 0, y: 0, lv: lv || 1, cx: cx, ci: ci, kind: kind });
        } else {
          balls.push({ t: -i * gap, z: shootAt(kind === 'cannon' ? T.cannonDmg : T.arrowDmg), fired: false, x: 0, y: 0, lv: lv || 1, cx: cx, ci: ci, kind: kind });
        }
      });
    }
  }
  // 殭屍被打死：加分＋直接給金幣
  function killZombie(z) {
    const i = zombies.indexOf(z); if (i < 0) return;
    zombies.splice(i, 1);
    const T = Z.types[z.type], x = laneX(z.x, z.y), y = z.y - T.r * depthScale(z.y);
    score += T.rewardScore; lvScore += T.rewardScore; core.setScore(score);
    core.Save.add('coins', T.rewardCoins);
    addText(x, y - 10, '+' + T.rewardScore + '　💰' + T.rewardCoins, '#ffe27a', 30);
    for (let k = 0; k < 14; k++) {
      const a = Math.random() * Math.PI * 2, v = 120 + Math.random() * 200;
      particles.push({ x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 80, t: 0, life: 0.5, css: T.color, s: 9 });
    }
    core.Sfx.play('coin'); checkLevel();
  }
  function wallBroken() { return zombies.some(function (z) { return z.ty >= WALL_Y; }); }
  function warning() { const f = frontZombie(); return !!f && f.ty >= WALL_Y - Z.warnDist; }

  // ---------- 結束與復活 ----------
  function gameOver(reason) {
    if (ending) return;
    ending = true; stuckTimer = -1; bombMode = false; aim = null; refreshItems();
    const text = reason === 'zombie' ? '殭屍衝破圍牆了！' : '沒有地方可以放方塊了！';
    function finish() { core.Sfx.play('over'); core.endGame(score, reason, { level: level, stats: { maxCombo: statCombo, lines: statLines } }); }
    if (revived) { finish(); return; }
    core.Sfx.play('over');
    core.askRevive(text, function () { revived = true; ending = false; doRevive(); refreshItems(); }, finish);
  }
  function doRevive() {
    const sz = C.revive.clearSize, off = Math.floor((N - sz) / 2);
    for (let r = off; r < off + sz; r++) for (let c = off; c < off + sz; c++) {
      if (grid[r][c]) { flashes.push({ r: r, c: c, color: grid[r][c].color, t: 0 }); grid[r][c] = null; }
    }
    zombies = zombies.filter(function (z) { return z.hp > 0; }); zombies.forEach(function (z) { z.ty = Z.spawnY; z.pending = 0; });   // 全部擊退到最上方
    balls = []; shake = 0.3;
    core.Sfx.play('clear'); core.buzz(60);
    addText(core.W / 2, G.y + N * CELL / 2, '復活！', '#9be86b', 64);
    for (let i = 0; i < 30 && tray.filter(function (p) { return !p.used; }).every(function (p) { return !anyFitRot(p.shape); }); i++) newTray();
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
      rows.forEach(function (i) { clearBands.push({ index: i, column: false, time: 0 }); });
      cols.forEach(function (i) { clearBands.push({ index: i, column: true, time: 0 }); });
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
    if (n > 0) {
      // 限時連消：每次消除重新倒數，時間內再消除 combo+1；子彈 = 條數 × 2^(combo−1)，有上限
      comboN = comboT > 0 ? comboN + 1 : 1; comboT = comboMax();
      statLines += n; if (comboN > statCombo) statCombo = comboN;
      const shots = Math.min(C.combo.maxBullets, Math.round(n * Math.pow(C.combo.growth, comboN - 1)));
      if (comboN >= 2) {
        const cl = Math.min(comboN, 8);
        addText(G.x + N * CELL / 2, G.y + N * CELL / 2 - 150, 'COMBO ' + comboN + '！', COMBO_COLORS[Math.min(comboN - 1, 5)], 40 + cl * 6);
        addText(G.x + N * CELL / 2, G.y + N * CELL / 2 - 100, '子彈 ×' + shots, '#ffffff', 30);
        core.Sfx.tone(880 * (1 + 0.1 * cl), 0.08, 'square', 0.14); core.Sfx.tone(1175 * (1 + 0.1 * cl), 0.14, 'square', 0.16, null, 0.08);
        shake = Math.min(0.6, 0.25 + comboN * 0.05); core.buzz(30 + cl * 8);
      }
      if (n >= C.combo.bigClearLines || shots >= C.combo.bigClearLines * 2) { flashA = 0.55; slowT = C.combo.slowSec; }   // 大消除：閃白光＋短暫慢動作
      fireLines(shots, comboN);       // 先砲擊擊退
    }
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
    stuckTimer = left.every(function (p) { return !anyFitRot(p.shape); }) ? 0.7 : -1;
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
        if (tray.some(function (p) { return !p.used && anyFitRot(p.shape); })) break;
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
  let clearBands = [];
  let towerFlashes = [];
  const towerFlashLife = { arrow: 0.12, cannon: 0.23, mg: 0.08 };
  const muzzleRows = { arrow: 10, cannon: 8, mg: 8 };

  function towerSize() { return cannonCount() >= 4 ? 80 : 96; }

  function muzzleY(kind, size) {
    return WALL_Y + 12 - size + size * muzzleRows[kind] / 64;
  }

  function start() {
    clearBands = [];
    towerFlashes = [];
    grid = []; for (let i = 0; i < N; i++) grid.push(new Array(N).fill(null));
    score = 0; drag = null; flashes = []; particles = []; texts = []; shake = 0; stuckTimer = -1;
    zombies = []; balls = []; revived = false; ending = false; sinceSpawn = 0; time = 0;
    statLines = 0; statCombo = 0; level = 1; lvScore = 0; roundTime = 0; comboN = 0; comboT = 0; slowT = 0; flashA = 0; rings = []; lvBanner = null; lvKey = '';
    freezeLeft = 0; used = {}; bombMode = false; aim = null; notice = null;
    theme = core.Save.get('theme'); hint = !core.Save.get('hintSeen');
    syncLevel(true); refreshItems();
    for (let i = 0; i < Z.start; i++) spawnZombie();
    newTray();
    checkStuck();
  }
  let score = 0;

  function update(dt) {
    clearBands = clearBands.filter(function (band) { band.time += dt; return band.time < 0.18; });
    towerFlashes = towerFlashes.map(function (remaining) { return Math.max(0, remaining - dt); });
    if (flashA > 0) flashA = Math.max(0, flashA - dt * 2.5);
    const real = dt;
    if (slowT > 0) { slowT -= dt; dt *= C.combo.slowScale; }          // 大消除的短暫慢動作（連消倒數仍照真實時間）
    time += dt; roundTime += dt;
    if (comboT > 0) { comboT -= real; if (comboT <= 0) { comboT = 0; comboN = 0; } }
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
      if (!b.fired) { b.fired = true; towerFlashes[b.ci] = towerFlashLife[b.kind]; b.originY = muzzleY(b.kind, towerSize()); if (b.ci === 0) { core.Sfx.play('shoot'); core.buzz(15); } }
      const tx = b.z ? laneX(b.z.x, b.z.y) : b.cx, ty = b.z ? b.z.y - Z.types[b.z.type].r * depthScale(b.z.y) : 100;
      const p = Math.min(1, b.t / C.cannon.flight);
      b.x = b.cx + (tx - b.cx) * p; b.y = b.originY + (ty - b.originY) * p;
      if (p >= 1) {
        if (b.z) {
          b.z.pending = Math.max(0, b.z.pending - 1); b.z.hit = 0.2; if (b.z.hp <= 0 && b.z.pending === 0) killZombie(b.z); core.Sfx.play('hit'); rings.push({ x: tx, y: ty, t: 0, lv: b.lv });
          for (let k = 0; k < 8; k++) {
            const a = Math.random() * Math.PI * 2, v = 100 + Math.random() * 160;
            particles.push({ x: tx, y: ty, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, t: 0, life: 0.35, css: '#fff3a0', s: 7 });
          }
        }
        balls.splice(i, 1);
      }
    }
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
    for (let i = rings.length - 1; i >= 0; i--) { rings[i].t += dt; if (rings[i].t > 0.3) rings.splice(i, 1); }
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
    ctx.fillStyle = '#66574a';
    rrect(ctx, G.x - 13, G.y - 13, N * CELL + 26, N * CELL + 26, 18); ctx.fill();
    ctx.fillStyle = '#332b26';
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
    clearBands.forEach(function (band) {
      const fade = 1 - band.time / 0.18;
      const offset = band.index * CELL + Math.floor(CELL / 2);
      ctx.fillStyle = 'rgba(255,219,142,' + fade * 0.72 + ')';
      if (band.column) ctx.fillRect(G.x + offset - 2, G.y, 4, N * CELL);
      else ctx.fillRect(G.x, G.y + offset - 2, N * CELL, 4);
    });
    particles.forEach(function (p) {
      ctx.globalAlpha = Math.max(0, 1 - p.t / p.life);
      ctx.fillStyle = p.css || pal()[p.color];
      ctx.fillRect(p.x - p.s / 2, p.y - p.s / 2, p.s, p.s);
    });
    ctx.globalAlpha = 1;

    // 托盤
    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    rrect(ctx, 16, C.tray.topY, core.W - 32, C.tray.h, 22); ctx.fill();
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
    if (flashA > 0) { ctx.fillStyle = 'rgba(255,255,255,' + flashA + ')'; ctx.fillRect(-10, -10, core.W + 20, core.H + 20); }
    if (comboT > 0 && comboN >= 1) {                         // 連消倒數條
      const bw = 170, bx = 16, by = 168;
      stext(ctx, 'COMBO ' + comboN, bx + bw / 2, by - 8, 34, '#7ad7ff');
      ctx.fillStyle = 'rgba(0,0,0,.55)'; rrect(ctx, bx, by, bw, 10, 5); ctx.fill();
      ctx.fillStyle = '#7ad7ff'; rrect(ctx, bx, by, Math.max(6, bw * comboT / comboMax()), 10, 5); ctx.fill();
      stext(ctx, '下次消除 子彈 ×' + Math.min(C.combo.maxBullets, Math.pow(C.combo.growth, comboN)), bx + bw / 2, by + 32, 20, '#cfeeff');
    }
    if (freezeLeft > 0) {
      ctx.fillStyle = 'rgba(120,200,255,0.18)'; ctx.fillRect(0, 0, C.ui.stripX, WALL_Y);
      stext(ctx, '❄ 冰凍中　剩 ' + freezeLeft + ' 次', 235, WALL_Y - 14, 26, '#bfe8ff');
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
      stext(ctx, '💣 點一格引爆（再按一次炸彈取消）', 235, WALL_Y - 50, 24, '#ffd29a');
    }
    if (hint) {
      const w = 340, h = 150, bob = Math.sin(time * 5) * 6;
      ctx.fillStyle = 'rgba(0,0,0,0.72)'; rrect(ctx, mx - w / 2, my - h / 2, w, h, 22); ctx.fill();
      ctx.strokeStyle = '#ffd24a'; ctx.lineWidth = 4; rrect(ctx, mx - w / 2, my - h / 2, w, h, 22); ctx.stroke();
      stext(ctx, C.ui.hintText[0], mx, my - 24, 30, '#fff');
      stext(ctx, C.ui.hintText[1], mx, my + 16, 30, '#ffe27a');
      stext(ctx, C.ui.hintText[2], mx, my + 56, 22, '#9be8ff');
      ctx.fillStyle = '#ffd24a'; ctx.beginPath();
      ctx.moveTo(mx - 16, my + h / 2 + 8 + bob); ctx.lineTo(mx + 16, my + h / 2 + 8 + bob); ctx.lineTo(mx, my + h / 2 + 30 + bob); ctx.closePath(); ctx.fill();
    }
    if (lvBanner) {
      const t = lvBanner.t, fade = L.bannerSec;
      const a = t < 0.15 ? t / 0.15 : Math.max(0, 1 - (t - 0.15) / (fade - 0.15));
      ctx.save(); ctx.globalAlpha = a; ctx.translate(core.W / 2, 190);
      const sc = 1 + Math.max(0, 0.3 - t) * 1.2; ctx.scale(sc, sc);
      stext(ctx, 'LEVEL ' + lvBanner.n + '！', 0, 0, 64, '#ffe27a');
      if (lvBanner.evo) stext(ctx, lvBanner.evo, 0, 52, 30, '#ffd54a');
      else if (lvBanner.cannon) stext(ctx, '新增箭塔！　連消時間 +' + C.cannon.comboBonus + ' 秒', 0, 52, 28, '#9be8ff');
      ctx.restore();
    }
    if (notice) { ctx.save(); ctx.globalAlpha = Math.max(0, 1 - notice.t / 1.2); stext(ctx, notice.text, mx, my, 34, '#fff'); ctx.restore(); }
  }

  // ---------- 殭屍區繪製（先用程式畫，第 4 天換成圖片）----------
  // ---------- 圖片素材（載入失敗就退回程式畫）----------
  const ART = {};
  ['normal', 'fast', 'fat', 'arrow', 'cannon', 'mg', 'wall', 'bg'].forEach(function (n) {
    const im = new Image(); im.onload = function () { ART[n] = im; }; im.src = 'assets/' + n + '.png?v=' + C.version;
  });
  const FRAME = { normal: 88, fast: 72, fat: 104 };
  // 景深：越靠近圍牆（y 越大）殭屍畫得越大、越清楚；只影響畫面，不影響遊戲邏輯
  function depthT(y) { return Math.max(0, Math.min(1, (y - Z.spawnY) / (WALL_Y - Z.spawnY))); }
  // 畫面上的左右位置：賽道越遠越往中線（270）收攏，像沿著遠處的路走過來；z.x 仍是賽道本身的位置
  function laneX(x, y) { return 270 + (x - 270) * (Z.laneNarrow + (1 - Z.laneNarrow) * depthT(y)); }
  function depthScale(y) { const t = depthT(y); return Z.depthFar + (Z.depthNear - Z.depthFar) * t; }
  function drawZombieArt(ctx, z) {
    const T = Z.types[z.type], im = ART[z.type];
    if (!im) return false;
    const f = FRAME[z.type], size = T.r * 4.2, fr = Math.floor(time * (z.type === 'fast' ? 12 : 8) + z.ph * 2) % 4;
    const sq = z.hit > 0 ? 1 + z.hit * 1.2 : 1;
    ctx.save();
    ctx.translate(laneX(z.x, z.y), z.y);
    const ds = depthScale(z.y); ctx.scale(ds, ds); ctx.globalAlpha = Z.depthFog + (1 - Z.depthFog) * Math.min(1, depthT(z.y) * 2.5);
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.ellipse(0, 0, T.r * 0.9, T.r * 0.28, 0, 0, Math.PI * 2); ctx.fill();
    ctx.translate(0, size * 0.1); ctx.scale(1 / sq, sq);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(im, fr * f, 0, f, f, -size / 2, -size, size, size);
    if (z.hit > 0) { ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha *= Math.min(0.6, z.hit * 3); ctx.drawImage(im, fr * f, 0, f, f, -size / 2, -size, size, size); }
    ctx.restore();
    return true;
  }
  function drawZombie(ctx, z) {
    if (drawZombieArt(ctx, z)) return;
    const T = Z.types[z.type], r = T.r;
    const bob = Math.sin(time * 8 + z.ph) * 3, sq = z.hit > 0 ? 1 + z.hit * 1.2 : 1;
    ctx.save();
    ctx.translate(laneX(z.x, z.y), z.y);
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
  function drawHp(ctx, z) {
    const T = Z.types[z.type], mx = T.hp || 1; if (mx <= 1 || z.hp >= mx || z.hp <= 0) return;   // 只有受傷的才顯示血條
    const s = depthScale(z.y), w = 44 * s, x = laneX(z.x, z.y) - w / 2, y = z.y - T.r * 2 * s - 12 * s;
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(x - 1, y - 1, w + 2, 8 * s + 2);
    ctx.fillStyle = '#ff5a4a'; ctx.fillRect(x, y, w * Math.max(0, z.hp) / mx, 8 * s);
  }
  function drawTower(ctx, kind, cx, back, csz) {
    const y0 = WALL_Y;
    if (ART[kind]) { ctx.imageSmoothingEnabled = false; ctx.drawImage(ART[kind], 0, 0, 64, 64, cx - csz / 2, y0 - csz + 12 + back, csz, csz); return; }
    if (kind === 'cannon' && ART.cannon) { ctx.imageSmoothingEnabled = false; ctx.drawImage(ART.cannon, 0, 0, 64, 64, cx - csz / 2, y0 - csz + 12 + back, csz, csz); return; }
    ctx.save(); ctx.translate(cx, y0);
    if (kind === 'arrow') {                                       // 木頭箭塔：木架＋弓＋箭
      ctx.fillStyle = '#6b4a2b'; ctx.fillRect(-18, -34, 6, 38); ctx.fillRect(12, -34, 6, 38); ctx.fillRect(-18, -14, 36, 5);
      ctx.fillStyle = '#8a6238'; ctx.fillRect(-22, -42, 44, 9); ctx.fillStyle = '#5a3d22'; ctx.fillRect(-22, -36, 44, 3);
      ctx.translate(0, back * 0.5);
      ctx.strokeStyle = '#c89b5a'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(0, -52, 17, Math.PI * 1.1, Math.PI * 1.9); ctx.stroke();
      ctx.strokeStyle = '#eee'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(-16, -48); ctx.lineTo(16, -48); ctx.stroke();
      ctx.strokeStyle = '#e8d9a8'; ctx.lineWidth = 3; ctx.beginPath(); ctx.moveTo(0, -48); ctx.lineTo(0, -74); ctx.stroke();
      ctx.fillStyle = '#d8d8d8'; ctx.beginPath(); ctx.moveTo(0, -80); ctx.lineTo(-4, -72); ctx.lineTo(4, -72); ctx.fill();
    } else {                                                      // 機槍塔：鋼板底座＋三管槍
      ctx.fillStyle = '#3b434b'; rrect(ctx, -22, -26, 44, 30, 6); ctx.fill();
      ctx.fillStyle = '#5a6670'; ctx.fillRect(-18, -22, 10, 22);
      ctx.fillStyle = '#2b333a'; ctx.beginPath(); ctx.arc(0, 0, 26, Math.PI, 0); ctx.fill();
      ctx.translate(0, back);
      ctx.fillStyle = '#4a545d'; rrect(ctx, -16, -52, 32, 30, 6); ctx.fill();
      ctx.fillStyle = '#222'; [-10, 0, 10].forEach(function (dx) { ctx.fillRect(dx - 3, -78, 6, 28); });
      ctx.fillStyle = '#ffd54a'; [-10, 0, 10].forEach(function (dx) { ctx.fillRect(dx - 3, -80, 6, 4); });
      ctx.fillStyle = '#e04a3a'; ctx.fillRect(-4, -46, 8, 6);
    }
    ctx.restore();
  }
  function drawTowerFlash(ctx, kind, x, size, back, strength) {
    const y = muzzleY(kind, size) + back;
    ctx.save();
    ctx.globalAlpha = strength;
    if (kind === 'arrow') {
      ctx.strokeStyle = '#edce91';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(x - size * 0.36, y + size * 0.31);
      ctx.lineTo(x, y + size * (0.37 + strength * 0.05));
      ctx.lineTo(x + size * 0.36, y + size * 0.31);
      ctx.stroke();
    } else if (kind === 'cannon') {
      const lift = (1 - strength) * 11;
      ctx.fillStyle = '#a9a69e';
      ctx.fillRect(x - 7, y - lift - 3, 14, 6);
      ctx.fillStyle = '#e2cfaa';
      ctx.fillRect(x - 4, y - lift - 5, 8, 5);
    } else {
      ctx.fillStyle = '#ffce70';
      [-0.14, 0, 0.14].forEach(function (offset) {
        ctx.fillRect(x + size * offset - 2, y - 5, 4, 7);
      });
    }
    ctx.restore();
  }

  function drawZone(ctx) {
    if (ART.bg) { ctx.imageSmoothingEnabled = false; ctx.drawImage(ART.bg, 0, 0, 256, 192, 0, C.zombieZone.top, core.W, WALL_Y - C.zombieZone.top); }
    ctx.fillStyle = ART.bg ? 'rgba(0,0,0,0.12)' : 'rgba(0,0,0,0.18)';
    ctx.fillRect(0, C.zombieZone.top, core.W, WALL_Y - C.zombieZone.top);
    ctx.fillStyle = 'rgba(0,0,0,0.38)';                                        // 右邊按鈕欄（殭屍不會走到這裡）
    ctx.fillRect(C.ui.stripX, C.zombieZone.top, core.W - C.ui.stripX, WALL_Y - C.zombieZone.top);
    zombies.slice().sort(function (a, b) { return a.y - b.y; }).forEach(function (z) { drawZombie(ctx, z); drawHp(ctx, z); });
    // 圍牆
    if (ART.wall) { ctx.imageSmoothingEnabled = false; for (let i = 0; i < 8; i++) ctx.drawImage(ART.wall, 0, 8, 64, 52, i * 67.5, WALL_Y - 6, 68, 44); }
    else { ctx.fillStyle = '#8a6a43'; ctx.fillRect(0, WALL_Y, core.W, 14); ctx.fillStyle = '#b28a58'; ctx.fillRect(0, WALL_Y, core.W, 4); }
    if (warning()) {
      const front = frontZombie();
      const x = laneX(front.x, front.y);
      const segment = core.W / 8;
      const left = Math.floor(x / segment) * segment;
      const pulse = 0.5 + Math.sin(time * 12) * 0.25;
      ctx.fillStyle = 'rgba(211,47,35,' + pulse * 0.22 + ')';
      ctx.fillRect(0, WALL_Y - 4, core.W, 27);
      ctx.fillStyle = 'rgba(255,84,62,' + pulse + ')';
      ctx.fillRect(left + 2, WALL_Y - 4, segment - 4, 4);
      ctx.fillRect(left + 2, WALL_Y + 17, segment - 4, 3);
    }
    const size = towerSize(), kinds = towerKinds();
    cannonXs().forEach(function (cx, ci) {
      const kind = kinds[ci], remaining = towerFlashes[ci] || 0;
      const strength = remaining / towerFlashLife[kind];
      const back = strength * C.cannon.recoil * (kind === 'cannon' ? 1 : 0.3);
      drawTower(ctx, kind, cx, back, size);
      if (strength > 0) drawTowerFlash(ctx, kind, cx, size, back, strength);
    });
    // 砲彈
    balls.forEach(function (b) {
      if (b.t < 0) return;
      if (b.kind === 'arrow') {                                   // 箭：細長、朝目標飛
        const dx = b.x - b.cx, dy = b.y - b.originY, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len;
        ctx.strokeStyle = '#e8d9a8'; ctx.lineWidth = 4; ctx.lineCap = 'round';
        ctx.beginPath(); ctx.moveTo(b.x - ux * 26, b.y - uy * 26); ctx.lineTo(b.x, b.y); ctx.stroke();
        ctx.fillStyle = '#d8d8d8'; ctx.beginPath(); ctx.arc(b.x, b.y, 4.5, 0, Math.PI * 2); ctx.fill();
        return;
      }
      if (b.kind === 'mg') {                                      // 機槍子彈：小而亮
        ctx.fillStyle = '#fff3a0'; ctx.beginPath(); ctx.arc(b.x, b.y, 6, 0, Math.PI * 2); ctx.fill();
        ctx.globalAlpha = 0.4; ctx.fillStyle = '#ffb347'; ctx.beginPath(); ctx.arc(b.x, b.y, 10, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1;
        return;
      }
      const lv = Math.min(b.lv || 1, 6), r = 10 + (lv - 1) * 2.5, col = COMBO_COLORS[lv - 1];
      if (lv > 1) { ctx.globalAlpha = 0.35; ctx.fillStyle = col; ctx.beginPath(); ctx.arc(b.x, b.y, r + 7, 0, Math.PI * 2); ctx.fill(); ctx.globalAlpha = 1; }
      ctx.fillStyle = '#222'; ctx.beginPath(); ctx.arc(b.x, b.y, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(b.x - r * 0.3, b.y - r * 0.3, r * 0.4, 0, Math.PI * 2); ctx.fill();
    });
    // 命中的衝擊圈
    rings.forEach(function (g) {
      const k = g.t / 0.3;
      ctx.globalAlpha = 1 - k; ctx.strokeStyle = COMBO_COLORS[Math.min(g.lv || 1, 6) - 1]; ctx.lineWidth = 5 * (1 - k) + 1;
      ctx.beginPath(); ctx.arc(g.x, g.y, 14 + k * (40 + (g.lv || 1) * 6), 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
    });
  }

  function drawPiece(ctx, p) {
    const s = p.s, left = p.cx - p.shape.w * s / 2, top = p.cy - p.shape.h * s / 2;
    p.shape.cells.forEach(function (c) { block(ctx, left + c[1] * s, top + c[0] * s, s, p.color); });
  }

  function rotatePiece(p) {
    p.shape = rotShape(p.shape); p.s *= 0.8;               // 縮一下再彈回，當作轉動的動畫
    core.Sfx.play('place'); core.buzz(8);
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
        if (!p.used && Math.abs(x - slotX(p.slot)) < C.tray.slotW / 2) { drag = { piece: p, px: x, py: y, sx: x, sy: y, moved: false }; core.Sfx.play('click'); return; }
      }
    } else if (type === 'move') {
      if (drag) { drag.px = x; drag.py = y; if (Math.abs(x - drag.sx) + Math.abs(y - drag.sy) > 14) drag.moved = true; }
    } else if (type === 'up') {
      if (!drag) return;
      const p = drag.piece;
      if (!drag.moved && Math.abs(x - drag.sx) + Math.abs(y - drag.sy) <= 14) {   // 只是點一下：旋轉
        drag = null; rotatePiece(p); return;
      }
      const t = targetCell(p, x, y);
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
    core.Sfx.presets.combo = function () { core.Sfx.tone(880, 0.08, 'square', 0.14); core.Sfx.tone(1175, 0.14, 'square', 0.16, null, 0.08); };
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
      info: function () { return { towers: towerKinds(), maxZ: maxZombies(), cannons: cannonCount(), comboMax: comboMax(), comboN: comboN, comboT: comboT, revived: revived, ending: ending, score: score, level: level, lvScore: lvScore, roundTime: roundTime, freezeLeft: freezeLeft, bombMode: bombMode, used: used, hint: hint, every: spawnEvery(), step: stepMult(), bigBoost: bigBoost() }; },
      setLevelState: function (lv, sc) { level = lv; lvScore = sc; syncLevel(true); },
      resetCombo: function () { comboN = 0; comboT = 0; }, newTray: function () { newTray(); return tray.length; }, slowLeft: function () { return slowT; },
      setCombo: function (n, t) { comboN = n; comboT = t; }, ballCount: function () { return balls.length; },
      rotate: function (i) { if (tray[i] && !tray[i].used) rotatePiece(tray[i]); }, detonate: detonate, cellAt: cellAt,
      levelUp: levelUp, types: function () { return Object.keys(Z.types).filter(function (k) { return level >= Z.types[k].unlockLevel; }); }, shapeBoost: function () { return bigBoost(); },
      setZombies: function (list) { zombies = []; list.forEach(function (o) { spawnZombie(o.type); const z = zombies[zombies.length - 1]; z.ty = o.ty; z.y = o.ty; }); },
      geom: function () { return { G: G, CELL: CELL, tray: C.tray, liftY: C.drag.liftY }; }
    }
  };
})();
