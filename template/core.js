'use strict';
/*
 * 共用模板 core.js（之後每款免洗遊戲都沿用，不要放玩法）
 * 遊戲玩法寫在 game/game.js，需提供 window.Game：
 *   Game.init(Core)          啟動時呼叫一次
 *   Game.start()             每一局開始
 *   Game.update(dt)          每格更新（暫停、看廣告時不會呼叫）
 *   Game.render(ctx, dt)     每格繪製（邏輯座標 W×H）
 *   Game.onPointer(type,x,y) type: 'down' | 'move' | 'up'
 * 遊戲結束時呼叫 Core.endGame(分數, 結束原因)
 */
(function () {
  const C = window.CONFIG;
  const W = C.width, H = C.height;

  // ================= 存檔 Save =================
  const Save = (function () {
    const KEY = C.saveKey;
    const defaults = () => ({ v: 1, best: 0, coins: 0, sound: true, vibrate: true });
    let data = defaults();
    try {
      const o = JSON.parse(localStorage.getItem(KEY));
      if (o && o.v === 1) {
        const d = defaults();
        if (Number.isFinite(o.best) && o.best >= 0) d.best = o.best;
        if (Number.isFinite(o.coins) && o.coins >= 0) d.coins = o.coins;
        if (typeof o.sound === 'boolean') d.sound = o.sound;
        if (typeof o.vibrate === 'boolean') d.vibrate = o.vibrate;
        data = d;
      }
    } catch (e) { data = defaults(); }
    function write() { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) {} }
    return {
      get(k) { return data[k]; },
      set(k, val) { data[k] = val; write(); },
      add(k, n) { data[k] = (data[k] || 0) + n; write(); }
    };
  })();

  // ================= 數據追蹤 track =================
  const LOG_KEY = C.saveKey + '_log';
  let log = [];
  let firstOpen = true;
  try {
    const raw = localStorage.getItem(LOG_KEY);
    if (raw !== null) {
      firstOpen = false;
      const a = JSON.parse(raw);
      if (Array.isArray(a)) log = a.slice(-C.maxLogs);
    }
  } catch (e) { log = []; }
  function track(name, data) {
    log.push({ t: Date.now(), e: name, d: data || {} });
    if (log.length > C.maxLogs) log.splice(0, log.length - C.maxLogs);
    try { localStorage.setItem(LOG_KEY, JSON.stringify(log)); } catch (e) {}
  }

  // ================= 音效 Sfx（程式產生，不用音檔） =================
  const Sfx = (function () {
    let ac = null, muted = false;
    function getCtx() {
      if (!ac) { try { ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {} }
      return ac;
    }
    function unlock() {
      const a = getCtx();
      if (a && a.state === 'suspended') a.resume().catch(function () {});
    }
    function tone(freq, dur, type, vol, slideTo, delay) {
      const a = getCtx(); if (!a) return;
      const t0 = a.currentTime + (delay || 0);
      const o = a.createOscillator(), g = a.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(freq, t0);
      if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
      g.gain.setValueAtTime(vol || 0.2, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g); g.connect(a.destination);
      o.start(t0); o.stop(t0 + dur + 0.02);
    }
    function noise(dur, vol, delay) {
      const a = getCtx(); if (!a) return;
      const t0 = a.currentTime + (delay || 0);
      const n = Math.max(1, Math.floor(a.sampleRate * dur));
      const buf = a.createBuffer(1, n, a.sampleRate), d = buf.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      const s = a.createBufferSource(), g = a.createGain();
      s.buffer = buf;
      g.gain.setValueAtTime(vol || 0.2, t0);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      s.connect(g); g.connect(a.destination);
      s.start(t0);
    }
    // 預設音效，game.js 可以自己再加：Sfx.presets.xxx = function(){...}
    const presets = {
      click: function () { tone(660, 0.07, 'square', 0.12); },
      place: function () { tone(240, 0.1, 'sine', 0.3, 130); },
      clear: function () { tone(523, 0.1, 'triangle', 0.25); tone(784, 0.16, 'triangle', 0.25, null, 0.08); },
      shoot: function () { noise(0.12, 0.3); tone(150, 0.16, 'sawtooth', 0.22, 60); },
      hit: function () { tone(180, 0.12, 'square', 0.2, 80); },
      warn: function () { tone(440, 0.12, 'square', 0.15); tone(330, 0.12, 'square', 0.15, null, 0.13); },
      over: function () { tone(330, 0.2, 'sawtooth', 0.22, 120); tone(165, 0.4, 'sawtooth', 0.22, 70, 0.2); },
      coin: function () { tone(988, 0.08, 'square', 0.15); tone(1319, 0.18, 'square', 0.15, null, 0.08); }
    };
    return {
      presets: presets,
      unlock: unlock,
      setMuted: function (m) { muted = m; },
      play: function (name) {
        if (muted || !Save.get('sound')) return;
        unlock();
        const p = presets[name];
        if (p) { try { p(); } catch (e) {} }
      },
      tone: tone, noise: noise
    };
  })();

  // ================= 震動 buzz =================
  function buzz(ms) {
    if (!Save.get('vibrate') || Ads.active) return;
    try { if (navigator.vibrate) navigator.vibrate(ms); } catch (e) {}
  }

  // ================= 畫面元素 =================
  const stage = document.getElementById('stage');
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const ui = document.createElement('div');
  ui.innerHTML =
    '<div id="hud" class="hidden"><div id="hud-score">0</div><button id="btn-pause">❚❚</button></div>' +
    '<div id="scr-start" class="screen">' +
      '<div class="title" id="t-title"></div>' +
      '<button class="btn" id="btn-start">開始遊戲</button>' +
      '<button class="btn gray" id="btn-sound"></button>' +
      '<div id="ver"></div>' +
    '</div>' +
    '<div id="scr-pause" class="screen hidden">' +
      '<div class="h2">暫停中</div>' +
      '<button class="btn" id="btn-resume">繼續</button>' +
      '<button class="btn gray" id="btn-restart">重新開始</button>' +
      '<button class="btn gray" id="btn-home">回開始畫面</button>' +
    '</div>' +
    '<div id="scr-over" class="screen hidden">' +
      '<div class="h2">結算</div>' +
      '<div class="row">本局分數　<b id="o-score">0</b></div>' +
      '<div class="new-best hidden" id="o-new">新紀錄！</div>' +
      '<div class="row">最高分　<b id="o-best">0</b></div>' +
      '<div class="row">獲得金幣　<b id="o-coins">0</b></div>' +
      '<div class="row">累計金幣　<b id="o-total">0</b></div>' +
      '<button class="btn gold" id="btn-double">看廣告　金幣加倍</button>' +
      '<button class="btn" id="btn-again">再玩一次</button>' +
    '</div>' +
    '<div id="scr-ad" class="screen hidden">' +
      '<div class="ad-tag">測試用模擬廣告</div>' +
      '<div class="ad-text" id="ad-text"></div>' +
      '<div class="ad-bar"><i id="ad-fill"></i></div>' +
      '<div class="ad-sec" id="ad-sec"></div>' +
    '</div>' +
    '<div id="scr-stats" class="screen hidden">' +
      '<div class="h2">統計</div>' +
      '<div id="stats-body"></div>' +
      '<div class="btn-row">' +
        '<button class="btn small" id="btn-copy">複製全部紀錄</button>' +
        '<button class="btn small gray" id="btn-stats-close">關閉</button>' +
      '</div>' +
    '</div>';
  while (ui.firstChild) stage.appendChild(ui.firstChild);
  const $ = function (id) { return document.getElementById(id); };
  const screens = ['scr-start', 'scr-pause', 'scr-over', 'scr-stats'];
  function show(id) { $(id).classList.remove('hidden'); }
  function hide(id) { $(id).classList.add('hidden'); }
  function showOnly(id) { screens.forEach(hide); if (id) show(id); }

  // ================= 廣告 Ads（所有廣告都只能從這裡播） =================
  const Ads = {
    active: false,
    // 獎勵廣告：看完才呼叫 onSuccess
    rewarded: function (text, onSuccess) { play('rewarded', text, onSuccess); },
    // 插頁廣告：開關關閉時直接略過
    interstitial: function (onDone) {
      if (!C.ads.interstitialEnabled) { if (onDone) onDone(); return; }
      play('interstitial', '', onDone);
    }
  };
  function play(kind, text, done) {
    if (Ads.active) return;
    Ads.active = true;            // 遊戲迴圈看到這個就會暫停
    Sfx.setMuted(true);           // 自動靜音
    $('ad-text').textContent = text || '';
    show('scr-ad');
    const total = C.ads.fakeDurationMs, t0 = Date.now();
    const timer = setInterval(function () {
      const el = Date.now() - t0;
      const left = Math.max(0, Math.ceil((total - el) / 1000));
      $('ad-fill').style.width = Math.min(100, el / total * 100) + '%';
      $('ad-sec').textContent = left + ' 秒後結束';
      if (el >= total) {
        clearInterval(timer);
        hide('scr-ad');
        Ads.active = false;
        Sfx.setMuted(false);
        track('ad', { type: kind });
        if (done) done();
      }
    }, 100);
    $('ad-fill').style.width = '0%';
    $('ad-sec').textContent = Math.ceil(total / 1000) + ' 秒後結束';
  }

  // ================= 遊戲流程 =================
  let state = 'start';            // start | play | over
  let paused = false;
  let playTime = 0;
  let score = 0;
  let roundCoins = 0;
  let doubled = false;

  function setScore(n) { score = n; $('hud-score').textContent = n; }

  function startRound() {
    state = 'play'; paused = false; playTime = 0;
    setScore(0);
    showOnly(null);
    show('hud');
    track('round_start', {});
    Game.start();
  }

  function endGame(finalScore, reason) {
    if (state !== 'play') return;
    state = 'over'; paused = false;
    score = finalScore;
    hide('hud');
    const sec = Math.round(playTime);
    track('round_end', { score: finalScore, seconds: sec, reason: reason || 'unknown' });
    const isNew = finalScore > Save.get('best');
    if (isNew) Save.set('best', finalScore);
    roundCoins = Math.floor(finalScore / C.coinDivisor);
    doubled = false;
    if (roundCoins > 0) Save.add('coins', roundCoins);
    refreshOver(isNew);
    showOnly('scr-over');
  }
  function refreshOver(isNew) {
    $('o-score').textContent = score;
    $('o-best').textContent = Save.get('best');
    $('o-coins').textContent = doubled ? roundCoins * 2 : roundCoins;
    $('o-total').textContent = Save.get('coins');
    if (isNew !== undefined) $('o-new').classList.toggle('hidden', !isNew);
    $('btn-double').classList.toggle('hidden', roundCoins <= 0 || doubled);
  }

  function pauseGame() {
    if (state !== 'play' || paused || Ads.active) return;
    paused = true; show('scr-pause'); Sfx.play('click');
  }
  function resumeGame() { paused = false; hide('scr-pause'); Sfx.play('click'); }
  function leaveRound(reason) {
    track('round_end', { score: score, seconds: Math.round(playTime), reason: reason });
  }

  // ================= 統計畫面 =================
  function statsData() {
    let opens = 0, firsts = 0, starts = 0, ends = 0, sumScore = 0, sumTime = 0, bestLog = 0;
    const reasons = {}, adTypes = {};
    log.forEach(function (x) {
      if (x.e === 'open') { opens++; if (x.d && x.d.first) firsts++; }
      else if (x.e === 'round_start') starts++;
      else if (x.e === 'round_end') {
        const r = (x.d && x.d.reason) || 'unknown';
        reasons[r] = (reasons[r] || 0) + 1;
        if (r !== 'restart' && r !== 'quit') {
          ends++; sumScore += x.d.score || 0; sumTime += x.d.seconds || 0;
          if ((x.d.score || 0) > bestLog) bestLog = x.d.score;
        }
      } else if (x.e === 'ad') { const t = (x.d && x.d.type) || '?'; adTypes[t] = (adTypes[t] || 0) + 1; }
    });
    return { opens: opens, firsts: firsts, starts: starts, ends: ends, sumScore: sumScore, sumTime: sumTime, bestLog: bestLog, reasons: reasons, adTypes: adTypes };
  }
  function openStats() {
    const s = statsData();
    const rows = [
      ['紀錄筆數', log.length],
      ['開啟遊戲次數', s.opens],
      ['其中第一次開啟', s.firsts],
      ['開始局數', s.starts],
      ['完整結束局數', s.ends],
      ['平均分數', s.ends ? Math.round(s.sumScore / s.ends) : 0],
      ['平均時間（秒）', s.ends ? Math.round(s.sumTime / s.ends) : 0],
      ['紀錄中最高分', s.bestLog]
    ];
    Object.keys(s.reasons).forEach(function (k) { rows.push(['結束原因：' + k, s.reasons[k]]); });
    Object.keys(s.adTypes).forEach(function (k) { rows.push(['看廣告：' + k, s.adTypes[k]]); });
    $('stats-body').innerHTML = rows.map(function (r) { return '<div><span>' + r[0] + '</span><span>' + r[1] + '</span></div>'; }).join('');
    showOnly('scr-stats');
  }
  function copyLog() {
    const text = log.map(function (x) { return JSON.stringify(x); }).join('\n');
    function fallback() {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch (e) {}
      document.body.removeChild(ta);
    }
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).catch(fallback);
      else fallback();
    } catch (e) { fallback(); }
    const b = $('btn-copy'); b.textContent = '已複製';
    setTimeout(function () { b.textContent = '複製全部紀錄'; }, 1500);
  }

  // ================= 縮放（9:16，電腦置中） =================
  function fit() {
    const vw = window.innerWidth, vh = window.innerHeight;
    const s = Math.min(vw / W, vh / H);
    stage.style.width = W + 'px'; stage.style.height = H + 'px';
    stage.style.left = Math.round((vw - W * s) / 2) + 'px';
    stage.style.top = Math.round((vh - H * s) / 2) + 'px';
    stage.style.transform = 'scale(' + s + ')';
    const r = Math.min(3, (window.devicePixelRatio || 1) * s);
    canvas.width = Math.max(1, Math.round(W * r));
    canvas.height = Math.max(1, Math.round(H * r));
    ctx.setTransform(r, 0, 0, r, 0, 0);
  }

  // ================= 主迴圈 =================
  let last = performance.now();
  function frame(now) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (state === 'play' && !paused && !Ads.active) {
      playTime += dt;
      if (Game.update) Game.update(dt);
    }
    ctx.fillStyle = C.stageColor;
    ctx.fillRect(0, 0, W, H);
    if (state !== 'start' && Game.render) Game.render(ctx, dt);
  }

  function pointer(type, e) {
    if (state !== 'play' || paused || Ads.active) return;
    const r = canvas.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width * W;
    const y = (e.clientY - r.top) / r.height * H;
    if (Game.onPointer) Game.onPointer(type, x, y);
  }

  // ================= 啟動 =================
  function boot() {
    $('t-title').textContent = C.title;
    $('ver').textContent = 'v' + C.version;
    document.title = C.title;
    const refreshSound = function () { $('btn-sound').textContent = Save.get('sound') ? '音效：開' : '音效：關'; };
    refreshSound();

    $('btn-start').onclick = function () { Sfx.unlock(); Sfx.play('click'); startRound(); };
    $('btn-sound').onclick = function () { Save.set('sound', !Save.get('sound')); refreshSound(); Sfx.unlock(); Sfx.play('click'); };
    $('btn-pause').onclick = pauseGame;
    $('btn-resume').onclick = resumeGame;
    $('btn-restart').onclick = function () { leaveRound('restart'); hide('scr-pause'); startRound(); };
    $('btn-home').onclick = function () { leaveRound('quit'); state = 'start'; paused = false; hide('hud'); showOnly('scr-start'); };
    $('btn-again').onclick = function () { Sfx.play('click'); startRound(); };
    $('btn-double').onclick = function () {
      Ads.rewarded('看完廣告，本局金幣加倍', function () {
        Save.add('coins', roundCoins); doubled = true; Sfx.play('coin'); refreshOver();
      });
    };
    $('btn-copy').onclick = copyLog;
    $('btn-stats-close').onclick = function () { showOnly('scr-start'); };

    // 版本號連點 5 下 → 統計畫面
    let taps = 0, lastTap = 0;
    $('ver').onclick = function () {
      const now = Date.now();
      taps = (now - lastTap > 1500) ? 1 : taps + 1;
      lastTap = now;
      if (taps >= 5) { taps = 0; openStats(); }
    };

    canvas.addEventListener('pointerdown', function (e) { try { canvas.setPointerCapture(e.pointerId); } catch (x) {} Sfx.unlock(); pointer('down', e); });
    canvas.addEventListener('pointermove', function (e) { pointer('move', e); });
    canvas.addEventListener('pointerup', function (e) { pointer('up', e); });
    canvas.addEventListener('pointercancel', function (e) { pointer('up', e); });
    document.addEventListener('contextmenu', function (e) { e.preventDefault(); });
    document.addEventListener('visibilitychange', function () { if (document.hidden) pauseGame(); });
    window.addEventListener('resize', fit);
    window.addEventListener('orientationchange', fit);

    fit();
    track('open', { first: firstOpen });
    if (Game.init) Game.init(Core);
    requestAnimationFrame(frame);
  }

  const Core = {
    W: W, H: H, ctx: ctx, config: C,
    boot: boot, endGame: function (s, r) { endGame(s, r); }, setScore: setScore,
    isPlaying: function () { return state === 'play' && !paused && !Ads.active; },
    Save: Save, Sfx: Sfx, Ads: Ads, track: track, buzz: buzz,
    _stats: statsData, _log: function () { return log; }
  };
  window.Core = Core;
  window.Save = Save; window.Sfx = Sfx; window.Ads = Ads;
  window.track = track; window.buzz = buzz;
})();
