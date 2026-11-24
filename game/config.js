// 所有數值都放在這裡，想調整就改這個檔
window.CONFIG = {
  version: '20261124a',   // 每次更新資產／程式就換一個，瀏覽器才不會抓到舊檔

  // ===== 基本 =====
  title: '殭屍防線',
  version: '1.1',
  saveKey: 'zbd_save',        // 瀏覽器存檔名稱
  width: 540,                 // 畫面邏輯寬（9:16）
  height: 960,                // 畫面邏輯高
  bgColor: '#0f1a14',         // 電腦兩側背景色
  stageColor: '#1b2b21',      // 遊戲畫面底色

  // ===== 金幣 =====
  coinDivisor: 10,            // 金幣 = 分數 ÷ 10（無條件捨去）
  coinLevelBonus: 0.05,       // 金幣再乘以 (1 + 這個數 × (等級 − 1))

  // ===== 廣告 =====
  ads: {
    interstitialEnabled: false, // 插頁廣告開關（預設關閉）
    fakeDurationMs: 3000        // 模擬廣告秒數
  },

  // ===== 數據 =====
  maxLogs: 500,               // 最多保留幾筆紀錄

  // ===== 格子與版面（邏輯座標 540×960）=====
  grid: { size: 8, cell: 30, x: 150, y: 592 },   // 8×8，每格 44
  zombieZone: { top: 0, wallY: 540 },           // 殭屍區在最上方（約畫面 45%），圍牆在 y=540，棋盤在圍牆下方（上下 6:4）
  tray: { y: 896, slotX: [68, 169, 270, 371, 472], maxCell: 28, slotW: 100, topY: 844, h: 108, guaranteeFit: 2 },   // 一次 5 塊；補牌時至少 2 塊現在放得下

  // ===== 殭屍（每放一個方塊，殭屍前進一步）=====
  zombies: {
    spawnY: 150,              // 殭屍出生位置（腳底 y）
    warnDist: 156,             // 離圍牆多近就開始閃紅色警告
    start: 2,                 // 開局幾隻
    max: 9,                   // 畫面上最多幾隻
    depthFar: 0.72,           // 景深：最上方（遠）的殭屍畫成幾倍大
    depthNear: 1.12,          // 景深：貼著圍牆（近）的殭屍畫成幾倍大
    depthFog: 0.7,            // 最遠處的透明度（越遠越淡，像隔著霧）
    spawnGap: 139,             // 同一路上，前一隻要走出這麼遠，後面才會再出
    lanes: [120, 180, 240, 300, 360, 420],  // 殭屍出現的左右位置（以畫面中線 270 為中心，貼牆時的間隔；右邊留給按鈕欄）
    laneNarrow: 0.45,         // 景深：最遠處賽道間隔只剩這個比例（沿著遠處的路收攏），越近越展開
    // step＝每放一個方塊前進幾像素；knock＝被砲彈打中往後退幾像素
    types: {
      normal: { hp: 2, rewardScore: 5, rewardCoins: 1, r: 26, step: 18.6, knock: 234, unlockLevel: 1, weight: 6, color: '#7ed957' },
      fat:    { hp: 5, rewardScore: 15, rewardCoins: 3, r: 34, step: 12.5, knock: 139, unlockLevel: 5, weight: 2, color: '#5fbf45' },
      fast:   { hp: 1, rewardScore: 8, rewardCoins: 1, r: 21, step: 34.1, knock: 234, unlockLevel: 3, weight: 2, color: '#a6ee6a' }
    }
  },

  // ===== 等級（無限關卡）=====
  levels: {
    scoreNeed: 150,           // 本等級內拿到幾分就升級
    spawnEveryStart: 8,       // 每放幾個方塊來新殭屍（1 級）
    spawnEveryLevels: 2,      // 每幾級，間隔少 1
    spawnEveryMin: 3,         // 最快每幾個方塊來新殭屍
    stepPerLevel: 0.04,       // 前進距離倍率 = 1 + 這個數 × (等級 − 1)
    stepPerLevelLate: 0.02,   // 超過 lateFrom 級之後，每級改加這個數
    lateFrom: 15,
    waveEvery: 5,             // 每幾級（5、10、15…）一次多來幾隻
    waveExtra: 2,
    knockback: 187,            // 升級獎勵：所有殭屍往後退幾像素
    bannerSec: 1.2,           // 「LEVEL N！」顯示秒數
    bigCells: 5,              // 幾格以上算大方塊（難放）
    bigBoostPerLevel: 0.1,    // 大方塊／難放方塊的機率，每級多 10%
    moreFrom: 5,              // 從這一級開始，每 moreEvery 級殭屍變多一次
    moreEvery: 5,
    moreMax: 1,               // 每次變多：畫面上限 +1
    moreSpawn: 1,             // 每次變多：出新殭屍的間隔 −1（最短 moreSpawnMin）
    moreSpawnMin: 2,
    bigBoostMax: 2            // 最多變成原本的幾倍
  },

  // ===== 介面 =====
  ui: { stripX: 462, hintText: ['把方塊拖進格子，', '排滿一行就開砲！', '（點一下方塊可以旋轉）'] },

  // ===== 商店（只用金幣）=====
  shop: {
    items: [
      { id: 'bomb',    kind: 'item',  icon: '💣', name: '炸彈',       price: 50,  desc: '點一格，清掉周圍 3×3（不計分）' },
      { id: 'shuffle', kind: 'item',  icon: '🔀', name: '換一組方塊', price: 30,  desc: '重抽托盤上還沒用的方塊' },
      { id: 'freeze',  kind: 'item',  icon: '❄️', name: '冰凍',       price: 40,  desc: '接下來放 3 個方塊，殭屍不前進、不出新殭屍' },
      { id: 'candy',   kind: 'theme', icon: '🍬', name: '糖果方塊',   price: 500, desc: '把方塊換成糖果風格' }
    ],
    bombSize: 1,              // 炸彈範圍：中心往外 1 格 = 3×3
    freezePlacements: 3       // 冰凍持續幾次放置
  },

  // ===== 排行榜 =====
  board: {
    size: 10,
    nameMax: 8,
    names: ['五指山阿伯', '夜市守門員', '巷口防衛隊', '檳榔西施', '便利商店店員', '機車大隊長', '阿公的柑仔店', '泡麵守護者',
            '珍奶續杯王', '滷肉飯戰神', '廟口大富翁', '捷運博愛座', '夜市蚵仔煎', '騎樓攤販王', '鹹酥雞老闆']
  },

  // ===== 砲台 =====
  // ===== 連消 combo（限時）=====
  combo: {
    seconds: 8,               // 每次消除後重新倒數幾秒；時間內再消除，combo +1，超時歸零
    growth: 2,                // 每多 1 個 combo，子彈變成幾倍（1 個 combo = 1 倍、2 個 = 2 倍、3 個 = 4 倍…）
    maxBullets: 16,           // 一次最多打幾發
    volleySec: 1.0,            // 子彈很多時，整批打完最多花幾秒
    bigClearLines: 3,         // 一次消這麼多條，或一次打這麼多發的一半，就閃白光＋短暫慢動作
    slowSec: 0.35, slowScale: 0.4
  },

  // ===== 砲台 =====
  // 塔的進化：前 5 座是箭塔（10/20/30/40 級各多 1 座），45~65 級每 5 級 1 座箭塔→砲塔，70~90 級每 5 級 1 座砲塔→機槍塔
  tower: { arrowDmg: 1, cannonDmg: 3, mgDmg: 3, mgShots: 5, mgGap: 0.05, cannonFrom: 45, mgFrom: 70, every: 5 },
  cannon: { x: 270, shotGap: 0.14, flight: 0.2, recoil: 16,
            perLevels: 10, max: 5, spacing: 76, comboBonus: 2 },   // 每 10 級多 1 個砲塔（最多 5 個）；每多 1 個，combo 倒數 +2 秒

  // ===== 復活 =====
  revive: { clearSize: 4 },    // 清空格子正中央 4×4

  // ===== 手感 =====
  drag: { liftY: 130 },       // 拖曳時方塊浮在手指上方多少，避免被手指擋住

  // ===== 分數 =====
  scoring: {
    perCell: 1,               // 放下方塊：每格 1 分
    perLine: 10,              // 每消除 1 條 10 分
    // 同時消除 n 條的連擊倍率（索引 = 條數）：消除得分 = perLine × 條數 × 倍率
    comboMult: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]
  },

  // ===== 6 種鮮豔顏色 =====
  colors: ['#ff4d5e', '#ff9f1c', '#ffd23f', '#3ddc84', '#3aa7ff', '#b46bff'],
  candyColors: ['#ff6fa8', '#ffb347', '#ffe66d', '#7fe0a8', '#6ec6ff', '#c58bff'],   // 糖果主題

  // ===== 方塊形狀（# 有方塊，. 空；w 是出現機率權重）=====
  shapes: [
    { w: 2, m: ['#'] },                                   // 單格
    { w: 3, m: ['##'] }, { w: 3, m: ['#', '#'] },         // 2 格
    { w: 3, m: ['###'] }, { w: 3, m: ['#', '#', '#'] },   // 3 格直條
    { w: 2, m: ['##', '#.'] }, { w: 2, m: ['##', '.#'] }, // 3 格 L
    { w: 2, m: ['#.', '##'] }, { w: 2, m: ['.#', '##'] },
    { w: 3, m: ['##', '##'] },                            // 方形
    { w: 2, m: ['####'] }, { w: 2, m: ['#', '#', '#', '#'] }, // 4 格直條
    { w: 2, m: ['###', '.#.'] }, { w: 2, m: ['.#.', '###'] }, // T 形
    { w: 2, m: ['#.', '##', '#.'] }, { w: 2, m: ['.#', '##', '.#'] },
    { w: 2, m: ['#.', '#.', '##'] }, { w: 2, m: ['.#', '.#', '##'] }, // 4 格 L
    { w: 2, m: ['##', '#.', '#.'] }, { w: 2, m: ['##', '.#', '.#'] },
    { w: 1, hard: true, m: ['.##', '##.'] }, { w: 1, hard: true, m: ['##.', '.##'] },         // S / Z
    { w: 1, m: ['#####'] }, { w: 1, m: ['#', '#', '#', '#', '#'] },   // 5 格直條
    { w: 1, m: ['.#.', '###', '.#.'] },                               // 十字
    { w: 1, m: ['#..', '#..', '###'] }                                // 大 L
  ]
};
