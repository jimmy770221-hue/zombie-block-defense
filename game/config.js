// 所有數值都放在這裡，想調整就改這個檔
window.CONFIG = {
  // ===== 基本 =====
  title: '殭屍防線',
  version: '1.0',
  saveKey: 'zbd_save',        // 瀏覽器存檔名稱
  width: 540,                 // 畫面邏輯寬（9:16）
  height: 960,                // 畫面邏輯高
  bgColor: '#0f1a14',         // 電腦兩側背景色
  stageColor: '#1b2b21',      // 遊戲畫面底色

  // ===== 金幣 =====
  coinDivisor: 10,            // 金幣 = 分數 ÷ 10（無條件捨去）

  // ===== 廣告 =====
  ads: {
    interstitialEnabled: false, // 插頁廣告開關（預設關閉）
    fakeDurationMs: 3000        // 模擬廣告秒數
  },

  // ===== 數據 =====
  maxLogs: 500                // 最多保留幾筆紀錄
};
