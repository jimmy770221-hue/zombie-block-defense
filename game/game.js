// 這款遊戲的玩法（目前是「模板測試用」的簡單範例，第 2 天起換成《殭屍防線》）
// 之後換遊戲只要換這個檔和 config.js
window.Game = (function () {
  let core, taps, ball;
  return {
    init: function (c) { core = c; },
    start: function () {
      taps = 0; ball = { x: 270, y: 300, vx: 180, vy: 140 };
    },
    update: function (dt) {
      ball.x += ball.vx * dt; ball.y += ball.vy * dt;
      if (ball.x < 40 || ball.x > core.W - 40) ball.vx *= -1;
      if (ball.y < 120 || ball.y > core.H - 40) ball.vy *= -1;
    },
    render: function (ctx) {
      ctx.fillStyle = '#9be86b';
      ctx.beginPath(); ctx.arc(ball.x, ball.y, 36, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#fff'; ctx.font = '28px sans-serif'; ctx.textAlign = 'center';
      ctx.fillText('模板測試：點畫面加分，點 10 下結束', core.W / 2, core.H - 90);
    },
    onPointer: function (type) {
      if (type !== 'down') return;
      taps++; core.setScore(taps * 5);
      core.Sfx.play('place'); core.buzz(20);
      if (taps >= 10) { core.Sfx.play('over'); core.endGame(taps * 5, 'demo'); }
    }
  };
})();
