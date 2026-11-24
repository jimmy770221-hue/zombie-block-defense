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
    const items = C.shop.items;
    const ITEM_IDS = items.filter(function (i) { return i.kind === 'item'; }).map(function (i) { return i.id; });
    const THEME_IDS = ['classic'].concat(items.filter(function (i) { return i.kind === 'theme'; }).map(function (i) { return i.id; }));
    const defaults = () => {
      const inv = {}; ITEM_IDS.forEach(function (id) { inv[id] = 0; });
      // v 一直是 1：新欄位缺少時用預設值，舊存檔可以直接讀
      return { v: 1, best: 0, coins: 0, sound: true, music: true, vibrate: true,
               bestLevel: 1, hintSeen: false, inv: inv, theme: 'classic', ownedThemes: ['classic'],
               board: [], lastName: '', lastEntryT: 0 };
    };
    let data = defaults();
    try {
      const o = JSON.parse(localStorage.getItem(KEY));
      if (o && o.v === 1) {
        const d = defaults();
        if (Number.isFinite(o.best) && o.best >= 0) d.best = o.best;
        if (Number.isFinite(o.coins) && o.coins >= 0) d.coins = o.coins;
        if (typeof o.sound === 'boolean') d.sound = o.sound;
        if (typeof o.music === 'boolean') d.music = o.music;
        if (typeof o.vibrate === 'boolean') d.vibrate = o.vibrate;
        if (Number.isFinite(o.bestLevel) && o.bestLevel >= 1) d.bestLevel = Math.floor(o.bestLevel);
        if (typeof o.hintSeen === 'boolean') d.hintSeen = o.hintSeen;
        else {                                   // 舊存檔：有玩過就不再顯示新手提示
          let played = d.best > 0 || d.coins > 0;
          try { played = played || (localStorage.getItem(KEY + '_log') || '').indexOf('round_start') >= 0; } catch (e) {}
          d.hintSeen = played;
        }
        if (o.inv && typeof o.inv === 'object') ITEM_IDS.forEach(function (id) {
          if (Number.isFinite(o.inv[id]) && o.inv[id] >= 0) d.inv[id] = Math.floor(o.inv[id]);
        });
        if (Array.isArray(o.ownedThemes)) o.ownedThemes.forEach(function (t) { if (THEME_IDS.indexOf(t) > 0 && d.ownedThemes.indexOf(t) < 0) d.ownedThemes.push(t); });
        if (typeof o.theme === 'string' && d.ownedThemes.indexOf(o.theme) >= 0) d.theme = o.theme;
        if (typeof o.lastName === 'string') d.lastName = Array.from(o.lastName).slice(0, C.board.nameMax).join('');
        if (Number.isFinite(o.lastEntryT)) d.lastEntryT = o.lastEntryT;
        if (Array.isArray(o.board)) {
          d.board = o.board.filter(function (b) {
            return b && Number.isFinite(b.score) && b.score >= 0 && Number.isFinite(b.level) && b.level >= 1 && typeof b.name === 'string' && Number.isFinite(b.t);
          }).map(function (b) {
            return { name: Array.from(b.name).slice(0, C.board.nameMax).join(''), score: b.score, level: Math.floor(b.level), t: b.t };
          }).sort(function (a, b) { return b.score - a.score; }).slice(0, C.board.size);
        }
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
    // 背景音樂：程式合成的短旋律，一直循環（只在遊戲進行中播）
    const MEL = [440, 0, 523, 0, 659, 0, 523, 0, 440, 0, 392, 0, 349, 0, 392, 0, 440, 0, 523, 0, 659, 0, 784, 0, 659, 0, 523, 0, 587, 0, 523, 0];
    const BASS = [110, 110, 87.3, 87.3, 98, 98, 110, 110];
    let mWant = null, mTimer = null, mStep = 0, mNext = 0;
    function mTick() {
      const a = getCtx();
      if (!a || !mWant || !mWant()) { mNext = 0; return; }
      if (a.state === 'suspended') return;
      if (!mNext || mNext < a.currentTime) { mNext = a.currentTime + 0.05; }
      while (mNext < a.currentTime + 0.4) {
        const f = MEL[mStep % MEL.length], d = mNext - a.currentTime;
        if (f) tone(f, 0.22, 'triangle', 0.05, null, d);
        if (mStep % 4 === 0) tone(BASS[(mStep / 4) % BASS.length], 0.5, 'sine', 0.07, null, d);
        mStep++; mNext += 0.24;
      }
    }
    function musicInit(want) { mWant = want; if (!mTimer) mTimer = setInterval(mTick, 120); }
    return {
      presets: presets,
      unlock: unlock,
      musicInit: musicInit,
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
    '<div id="hud" class="hidden">' +
      '<div id="hud-left"><div id="hud-score">0</div><div id="hud-best">最高 0</div>' +
        '<div id="hud-lv"><span id="hud-lvtxt">Lv 1</span><div class="lvbar"><i id="hud-lvfill"></i></div></div></div>' +
      '<button id="btn-pause">❚❚</button>' +
    '</div>' +
    '<div id="scr-start" class="screen">' +
      '<div id="st-bg"></div>' +
      '<div class="title" id="t-title"></div>' +
      '<div id="st-zombie"></div>' +
      '<div id="st-stats">' +
        '<div><span>最高分</span><b id="st-best">0</b></div>' +
        '<div><span>最高等級</span><b id="st-lv">Lv 1</b></div>' +
        '<div><span>金幣</span><b id="st-coins">0</b></div>' +
      '</div>' +
      '<button class="btn" id="btn-start">開始遊戲</button>' +
      '<div class="btn-row">' +
        '<button class="btn gray half" id="btn-shop">🛒 商店</button>' +
        '<button class="btn gray half" id="btn-board">🏆 排行榜</button>' +
      '</div>' +
      '<button class="btn gray small" id="btn-set">⚙ 設定</button>' +
      '<div id="ver"></div>' +
    '</div>' +
    '<div id="scr-set" class="screen hidden">' +
      '<div class="h2">設定</div>' +
      '<button class="btn gray" id="btn-sound"></button>' +
      '<button class="btn gray" id="btn-music"></button>' +
      '<button class="btn gray" id="btn-vib"></button>' +
      '<button class="btn" id="btn-set-close">返回</button>' +
    '</div>' +
    '<div id="scr-shop" class="screen hidden">' +
      '<div class="h2">商店</div>' +
      '<div class="row">金幣　<b id="sh-coins">0</b></div>' +
      '<div id="sh-list"></div>' +
      '<button class="btn gray" id="btn-shop-close">返回</button>' +
    '</div>' +
    '<div id="scr-board" class="screen hidden">' +
      '<div class="h2">排行榜</div>' +
      '<div id="bd-list"></div>' +
      '<button class="btn gray" id="btn-board-close">返回</button>' +
    '</div>' +
    '<div id="scr-pause" class="screen hidden">' +
      '<div class="h2">暫停中</div>' +
      '<button class="btn" id="btn-resume">繼續</button>' +
      '<button class="btn gray" id="btn-restart">重新開始</button>' +
      '<button class="btn gray" id="btn-pause-set">⚙ 設定</button>' +
      '<button class="btn gray" id="btn-home">回開始畫面</button>' +
    '</div>' +
    '<div id="scr-over" class="screen hidden">' +
      '<div class="h2">結算</div>' +
      '<div class="row">本局分數　<b id="o-score">0</b></div>' +
      '<div class="row" id="o-lvrow">到達等級　<b id="o-level">Lv 1</b></div>' +
      '<div class="new-best hidden" id="o-new">新紀錄！</div>' +
      '<div class="row sm" id="o-st">連消最高 <b id="o-combo">0</b>　消除 <b id="o-lines">0</b> 行　<b id="o-time">0</b> 秒</div>' +
      '<div class="row">最高分　<b id="o-best">0</b></div>' +
      '<div class="row">獲得金幣　<b id="o-coins">0</b></div>' +
      '<div class="row">累計金幣　<b id="o-total">0</b></div>' +
      '<div id="o-rank" class="hidden">' +
        '<div class="new-best" id="o-rank-txt"></div>' +
        '<div class="name-row"><input id="o-name" type="text" maxlength="24" autocomplete="off" autocorrect="off" spellcheck="false" enterkeyhint="done">' +
        '<button class="btn small" id="btn-name-ok">確定</button></div>' +
      '</div>' +
      '<button class="btn gold" id="btn-double">看廣告　金幣加倍</button>' +
      '<button class="btn" id="btn-again">再玩一次</button>' +
      '<button class="btn gray" id="btn-over-home">回主選單</button>' +
    '</div>' +
    '<div id="scr-revive" class="screen hidden">' +
      '<div class="h2">遊戲結束</div>' +
      '<div class="row" id="rv-text"></div>' +
      '<button class="btn gold" id="btn-revive">看廣告　復活</button>' +
      '<button class="btn gray" id="btn-norevive">不用了</button>' +
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
  const screens = ['scr-start', 'scr-pause', 'scr-over', 'scr-stats', 'scr-revive', 'scr-shop', 'scr-board', 'scr-set'];
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
  let curLevel = 1;
  let lastEntry = null;           // 這局剛寫進排行榜的那一筆

  function setScore(n) {
    score = n; $('hud-score').textContent = n;
    $('hud-best').textContent = '最高 ' + Math.max(n, Save.get('best'));
  }
  // 遊戲呼叫：目前等級與升級進度（0~1）
  function setLevel(lv, prog) {
    curLevel = lv;
    $('hud-lvtxt').textContent = 'Lv ' + lv;
    $('hud-lv').classList.toggle('near', prog >= 0.8 && prog < 1);
    $('hud-lvfill').style.width = Math.round(Math.max(0, Math.min(1, prog)) * 100) + '%';
    if (lv > Save.get('bestLevel')) Save.set('bestLevel', lv);
  }
  // 道具：數量與使用（用掉 1 個並記錄）
  const Items = {
    count: function (id) { const v = Save.get('inv')[id]; return v > 0 ? v : 0; },
    use: function (id) {
      if (Items.count(id) <= 0) return false;
      const inv = Object.assign({}, Save.get('inv')); inv[id]--; Save.set('inv', inv);
      track('item_use', { item: id });
      return true;
    }
  };

  function startRound() {
    state = 'play'; paused = false; playTime = 0; curLevel = 1;
    setScore(0); setLevel(1, 0);
    showOnly(null);
    show('hud');
    track('round_start', {});
    Game.start();
  }

  function endGame(finalScore, reason, info) {
    if (state !== 'play') return;
    state = 'over'; paused = false;
    score = finalScore;
    const level = Math.max(1, Math.floor((info && info.level) || curLevel));
    curLevel = level;
    if (level > Save.get('bestLevel')) Save.set('bestLevel', level);
    hide('hud');
    const sec = Math.round(playTime);
    track('round_end', { score: finalScore, seconds: sec, reason: reason || 'unknown', level: level });
    const isNew = finalScore > Save.get('best');
    if (isNew) Save.set('best', finalScore);
    roundCoins = Math.floor(finalScore / C.coinDivisor * (1 + C.coinLevelBonus * (level - 1)) + 1e-9);
    doubled = false;
    if (roundCoins > 0) Save.add('coins', roundCoins);
    const rank = enterBoard(finalScore, level);
    const st = info && info.stats;
    $('o-st').classList.toggle('hidden', !st);
    if (st) { $('o-combo').textContent = st.maxCombo | 0; $('o-lines').textContent = st.lines | 0; $('o-time').textContent = sec; }
    refreshOver(isNew);
    showRank(rank);
    showOnly('scr-over');
  }
  function refreshOver(isNew) {
    $('o-score').textContent = score;
    $('o-level').textContent = 'Lv ' + curLevel;
    $('o-best').textContent = Save.get('best');
    $('o-coins').textContent = doubled ? roundCoins * 2 : roundCoins;
    $('o-total').textContent = Save.get('coins');
    if (isNew !== undefined) $('o-new').classList.toggle('hidden', !isNew);
    $('btn-double').classList.toggle('hidden', roundCoins <= 0 || doubled);
  }

  // 結束前先問一次「看廣告復活」（要不要問由遊戲自己決定；每局只問一次也由遊戲控制）
  function askRevive(text, onYes, onNo) {
    if (state !== 'play') return;
    paused = true;                                  // 凍結遊戲，但不顯示暫停畫面
    $('rv-text').textContent = text || '';
    showOnly('scr-revive');
    $('btn-revive').onclick = function () {
      Ads.rewarded('看廣告復活', function () { paused = false; showOnly(null); if (onYes) onYes(); });
    };
    $('btn-norevive').onclick = function () { paused = false; showOnly(null); if (onNo) onNo(); };
  }

  function pauseGame() {
    if (state !== 'play' || paused || Ads.active) return;
    paused = true; show('scr-pause'); Sfx.play('click');
  }
  function resumeGame() { paused = false; hide('scr-pause'); Sfx.play('click'); }
  function leaveRound(reason) {
    track('round_end', { score: score, seconds: Math.round(playTime), reason: reason, level: curLevel });
  }

  // ================= 本機排行榜（前 10 名）=================
  function randomName() { return C.board.names[Math.floor(Math.random() * C.board.names.length)]; }
  function cleanName(v) { return Array.from(String(v || '').replace(/[\r\n\t]/g, ' ').trim()).slice(0, C.board.nameMax).join(''); }
  // 這局能排第幾名？進榜就先用預設名字寫進去（之後在結算畫面按「確定」可以改名）
  function enterBoard(sc, level) {
    lastEntry = null;
    const b = Save.get('board').slice();
    if (sc <= 0) return 0;
    let rank = b.length;                                  // 同分排在舊的後面
    for (let i = 0; i < b.length; i++) if (sc > b[i].score) { rank = i; break; }
    if (rank >= C.board.size) return 0;
    const e = { name: cleanName(Save.get('lastName')) || randomName(), score: sc, level: level, t: Date.now() };
    b.splice(rank, 0, e);
    Save.set('board', b.slice(0, C.board.size));
    Save.set('lastEntryT', e.t);
    lastEntry = e;
    return rank + 1;
  }
  function showRank(rank) {
    const box = $('o-rank');
    $('scr-over').classList.remove('kb');
    box.classList.toggle('hidden', !rank);
    if (!rank) return;
    $('o-rank-txt').textContent = '第 ' + rank + ' 名！';
    $('o-name').value = lastEntry.name;
    $('o-name').disabled = false;
    $('btn-name-ok').textContent = '確定'; $('btn-name-ok').disabled = false;
  }
  function confirmName() {
    if (!lastEntry || $('btn-name-ok').disabled) return;
    const nm = cleanName($('o-name').value) || lastEntry.name;
    const b = Save.get('board').map(function (x) { return x.t === lastEntry.t ? Object.assign({}, x, { name: nm }) : x; });
    lastEntry.name = nm;
    Save.set('board', b); Save.set('lastName', nm);
    $('o-name').value = nm;
    $('btn-name-ok').textContent = '已記錄'; $('btn-name-ok').disabled = true; $('o-name').disabled = true;
    $('o-name').blur(); $('scr-over').classList.remove('kb');
    Sfx.play('coin');
  }
  function openBoard() {
    const b = Save.get('board'), latest = Save.get('lastEntryT'), box = $('bd-list');
    box.textContent = '';
    if (!b.length) { const d = document.createElement('div'); d.className = 'bd-empty'; d.textContent = '還沒有紀錄，快去打一場！'; box.appendChild(d); }
    b.forEach(function (e, i) {
      const r = document.createElement('div'); r.className = 'bd-row' + (e.t === latest ? ' me' : '');
      [['bd-rk', i + 1], ['bd-nm', e.name], ['bd-sc', e.score], ['bd-lv', 'Lv ' + e.level], ['bd-dt', fmtDate(e.t)]].forEach(function (c) {
        const sp = document.createElement('span'); sp.className = c[0]; sp.textContent = c[1]; r.appendChild(sp);
      });
      box.appendChild(r);
    });
    showOnly('scr-board');
  }
  function fmtDate(t) { const d = new Date(t); return (d.getMonth() + 1) + '/' + d.getDate(); }

  // ================= 商店（只用金幣）=================
  function openShop() { renderShop(); showOnly('scr-shop'); }
  function renderShop() {
    $('sh-coins').textContent = Save.get('coins');
    const list = $('sh-list'); list.textContent = '';
    function row(icon, name, desc, right) {
      const r = document.createElement('div'); r.className = 'sh-row';
      const i = document.createElement('div'); i.className = 'sh-ic'; i.textContent = icon;
      const m = document.createElement('div'); m.className = 'sh-mid';
      const n = document.createElement('b'); n.textContent = name;
      const d = document.createElement('small'); d.textContent = desc;
      m.appendChild(n); m.appendChild(d);
      r.appendChild(i); r.appendChild(m); r.appendChild(right); list.appendChild(r);
    }
    function btn(text, cls, off, fn) {
      const b = document.createElement('button'); b.className = 'btn small ' + cls; b.textContent = text; b.disabled = !!off; b.onclick = fn; return b;
    }
    C.shop.items.forEach(function (it) {
      const coins = Save.get('coins');
      if (it.kind === 'item') {
        const w = document.createElement('div'); w.className = 'sh-r';
        const own = document.createElement('span'); own.textContent = '擁有 ' + Items.count(it.id);
        w.appendChild(own);
        w.appendChild(btn('💰' + it.price, 'gold', coins < it.price, function () { buy(it); }));
        row(it.icon, it.name, it.desc, w);
      } else {
        const owned = Save.get('ownedThemes').indexOf(it.id) >= 0;
        const w = document.createElement('div'); w.className = 'sh-r';
        if (!owned) w.appendChild(btn('💰' + it.price, 'gold', coins < it.price, function () { buy(it); }));
        else w.appendChild(btn(Save.get('theme') === it.id ? '使用中' : '使用', Save.get('theme') === it.id ? 'gray' : '', Save.get('theme') === it.id, function () { Save.set('theme', it.id); Sfx.play('click'); renderShop(); }));
        row(it.icon, it.name, it.desc, w);
      }
    });
    // 預設主題（永遠擁有，可以切回來）
    if (C.shop.items.some(function (i) { return i.kind === 'theme' && Save.get('ownedThemes').indexOf(i.id) >= 0; })) {
      const w = document.createElement('div'); w.className = 'sh-r';
      const on = Save.get('theme') === 'classic';
      w.appendChild(btn(on ? '使用中' : '使用', on ? 'gray' : '', on, function () { Save.set('theme', 'classic'); Sfx.play('click'); renderShop(); }));
      row('🟥', '經典方塊', '原本的方塊樣子', w);
    }
  }
  function buy(it) {
    const coins = Save.get('coins');
    if (coins < it.price) return;
    Save.set('coins', coins - it.price);
    if (it.kind === 'item') { const inv = Object.assign({}, Save.get('inv')); inv[it.id] = (inv[it.id] || 0) + 1; Save.set('inv', inv); }
    else { const ow = Save.get('ownedThemes').slice(); ow.push(it.id); Save.set('ownedThemes', ow); Save.set('theme', it.id); }
    track('shop_buy', { item: it.id });
    Sfx.play('coin'); renderShop(); refreshStart();
  }
  function refreshStart() {
    $('st-best').textContent = Save.get('best');
    $('st-lv').textContent = 'Lv ' + Save.get('bestLevel');
    $('st-coins').textContent = Save.get('coins');
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
    const refreshSound = function () {
      $('btn-sound').textContent = Save.get('sound') ? '音效：開' : '音效：關';
      $('btn-music').textContent = Save.get('music') ? '音樂：開' : '音樂：關';
      $('btn-vib').textContent = Save.get('vibrate') ? '震動：開' : '震動：關';
    };
    let setFrom = 'scr-start';
    const openSet = function (from) { setFrom = from; refreshSound(); showOnly('scr-set'); };
    Sfx.musicInit(function () { return state === 'play' && !paused && !Ads.active && Save.get('music'); });
    refreshSound();
    refreshStart();

    $('btn-start').onclick = function () { Sfx.unlock(); Sfx.play('click'); startRound(); };
    $('btn-sound').onclick = function () { Save.set('sound', !Save.get('sound')); refreshSound(); Sfx.unlock(); Sfx.play('click'); };
    $('btn-music').onclick = function () { Save.set('music', !Save.get('music')); refreshSound(); Sfx.unlock(); Sfx.play('click'); };
    $('btn-vib').onclick = function () { Save.set('vibrate', !Save.get('vibrate')); refreshSound(); Sfx.play('click'); buzz(30); };
    $('btn-set').onclick = function () { Sfx.unlock(); Sfx.play('click'); openSet('scr-start'); };
    $('btn-pause-set').onclick = function () { Sfx.play('click'); hide('scr-pause'); openSet('scr-pause'); };
    $('btn-set-close').onclick = function () { Sfx.play('click'); showOnly(null); if (setFrom === 'scr-pause') show('scr-pause'); else showOnly('scr-start'); };
    $('btn-pause').onclick = pauseGame;
    $('btn-resume').onclick = resumeGame;
    $('btn-restart').onclick = function () { leaveRound('restart'); hide('scr-pause'); startRound(); };
    $('btn-home').onclick = function () { leaveRound('quit'); state = 'start'; paused = false; hide('hud'); refreshStart(); showOnly('scr-start'); };
    $('btn-again').onclick = function () { Sfx.play('click'); startRound(); };
    $('btn-over-home').onclick = function () { Sfx.play('click'); state = 'start'; paused = false; hide('hud'); refreshStart(); showOnly('scr-start'); };
    $('btn-shop').onclick = function () { Sfx.play('click'); openShop(); };
    $('btn-board').onclick = function () { Sfx.play('click'); openBoard(); };
    $('btn-shop-close').onclick = function () { Sfx.play('click'); refreshStart(); showOnly('scr-start'); };
    $('btn-board-close').onclick = function () { Sfx.play('click'); showOnly('scr-start'); };
    // 確定鍵用 pointerdown：輸入框收鍵盤時版面會動，用 click 容易點不到
    $('btn-name-ok').addEventListener('pointerdown', function (e) { e.preventDefault(); confirmName(); });
    $('btn-name-ok').onclick = confirmName;
    $('o-name').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); confirmName(); } });
    $('o-name').addEventListener('input', function () { const v = Array.from($('o-name').value); if (v.length > C.board.nameMax) $('o-name').value = v.slice(0, C.board.nameMax).join(''); });
    $('o-name').addEventListener('focus', function () { $('scr-over').classList.add('kb'); });
    $('o-name').addEventListener('blur', function () { $('scr-over').classList.remove('kb'); });
    $('btn-double').onclick = function () {
      Ads.rewarded('看完廣告，本局金幣加倍', function () {
        Save.add('coins', roundCoins); doubled = true; Sfx.play('coin'); refreshOver();
      });
    };
    $('btn-copy').onclick = copyLog;
    $('btn-stats-close').onclick = function () { refreshStart(); showOnly('scr-start'); };

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
    boot: boot, askRevive: askRevive, endGame: function (s, r, info) { endGame(s, r, info); }, setScore: setScore, setLevel: setLevel,
    Items: Items,
    isPlaying: function () { return state === 'play' && !paused && !Ads.active; },
    Save: Save, Sfx: Sfx, Ads: Ads, track: track, buzz: buzz,
    _stats: statsData, _log: function () { return log; }, _lastEntry: function () { return lastEntry; }
  };
  window.Core = Core;
  window.Save = Save; window.Sfx = Sfx; window.Ads = Ads;
  window.track = track; window.buzz = buzz;
})();
