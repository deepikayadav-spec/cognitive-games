/* Shared engine for the cognitive ability games.

   A game calls CG.create({...}) with its rules text and a buildLevel(api, board)
   function. The engine owns the top bar, the session clock, the per-level clock,
   scoring, the intro / pause / results screens and the sound blips, so each game
   file only has to draw its own board and say right() or wrong().            */
window.CG = (function () {
  "use strict";

  function el(tag, cls, text){
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function fmt(s){
    s = Math.max(0, Math.round(s));
    var m = Math.floor(s / 60), r = s % 60;
    return (m < 10 ? '0' : '') + m + ':' + (r < 10 ? '0' : '') + r;
  }
  function shuffle(a){
    for (var i = a.length - 1; i > 0; i--){
      var j = (Math.random() * (i + 1)) | 0, t = a[i];
      a[i] = a[j]; a[j] = t;
    }
    return a;
  }
  function pick(a){ return a[(Math.random() * a.length) | 0]; }
  function randInt(n){ return (Math.random() * n) | 0; }

  /* ---------- sound: short blips, no audio files ---------- */
  var actx = null, muted = false;
  function beep(freq, ms, type){
    if (muted) return;
    try {
      if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
      var o = actx.createOscillator(), g = actx.createGain();
      o.type = type || 'sine'; o.frequency.value = freq;
      g.gain.setValueAtTime(0.06, actx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, actx.currentTime + ms / 1000);
      o.connect(g); g.connect(actx.destination);
      o.start(); o.stop(actx.currentTime + ms / 1000);
    } catch (e) { /* blocked audio never blocks the game */ }
  }

  function create(cfg){
    var S = {
      level:1, score:0, right:0, wrong:0, attempts:0,
      sessionLeft:cfg.session, levelLeft:0,
      running:false, paused:false, locked:false
    };
    var levelTimer = null, sessionTimer = null, levelDeadline = 0;

    /* ---------- chrome ---------- */
    var stage = el('div', 'stage');
    var bar = el('div', 'bar');
    var btnPause = el('button', 'ic', '❚❚'); btnPause.title = 'Pause';
    var btnSound = el('button', 'ic', '🔊'); btnSound.title = 'Sound';
    var lvlEl = el('div', 'lvl', 'Level 1');
    var scoreWrap = el('div', 'scorebar');
    var scoreFill = el('div', 'fill');
    var scoreVal = el('span', 'v', '0');
    scoreWrap.appendChild(scoreFill); scoreWrap.appendChild(scoreVal);
    var clockEl = el('div', 'clock', fmt(cfg.levelTime || cfg.session));
    var nameEl = el('div', 'name', cfg.name);
    [btnPause, btnSound, lvlEl, scoreWrap, clockEl, nameEl].forEach(function (n){ bar.appendChild(n); });

    var session = el('div', 'session');
    var sessionFill = el('i');
    session.appendChild(sessionFill);

    var promptEl = el('div', 'prompt', cfg.prompt || '');
    var board = el('div', 'board');
    var flashEl = el('div', 'flash');
    board.appendChild(flashEl);

    stage.appendChild(bar); stage.appendChild(session);
    stage.appendChild(promptEl); stage.appendChild(board);
    document.body.appendChild(stage);

    var back = el('a', 'backlink', '← All games');
    back.href = 'index.html';
    document.body.appendChild(back);

    /* ---------- overlays ---------- */
    function overlay(id){
      var o = el('div', 'overlay'); o.id = id; o.hidden = true;
      document.body.appendChild(o);
      return o;
    }
    var introEl = overlay('introScreen'); introEl.hidden = false;
    var pauseEl = overlay('pauseScreen');
    var endEl = overlay('endScreen');

    var introSheet = el('div', 'sheet');
    introSheet.appendChild(el('h1', null, cfg.name));
    introSheet.appendChild(el('div', 'sub', cfg.tag));
    (cfg.intro || []).forEach(function (p){ introSheet.appendChild(el('p', null, p)); });
    introSheet.appendChild(el('h2', null, 'How to Play'));
    var ul = el('ul');
    (cfg.howto || []).forEach(function (t){ ul.appendChild(el('li', null, t)); });
    introSheet.appendChild(ul);
    var btnPlay = el('button', 'play', 'Play');
    introSheet.appendChild(btnPlay);
    introEl.appendChild(introSheet);

    var pauseSheet = el('div', 'sheet');
    pauseSheet.style.width = 'min(420px,100%)';
    var pauseH = el('h1', null, 'Paused'); pauseH.style.fontSize = '32px';
    var pauseStats = el('div', 'results');
    var pScore = el('b', null, '0'), pLevel = el('b', null, '1'), pTime = el('b', null, '');
    [['Score', pScore], ['Level', pLevel], ['Time left', pTime]].forEach(function (r){
      var row = el('div'); row.appendChild(el('span', null, r[0])); row.appendChild(r[1]);
      pauseStats.appendChild(row);
    });
    var btnResume = el('button', 'play', 'Resume');
    var btnRestart = el('button', 'ghost', 'Restart');
    [pauseH, pauseStats, btnResume, btnRestart].forEach(function (n){ pauseSheet.appendChild(n); });
    pauseEl.appendChild(pauseSheet);

    var endSheet = el('div', 'sheet');
    endSheet.style.width = 'min(460px,100%)';
    var endH = el('h1', null, 'Time up'); endH.style.fontSize = '34px';
    var endSub = el('div', 'sub', '');
    var endStats = el('div', 'results');
    var eScore = el('b', null, '0'), eLevel = el('b', null, '0'), eAcc = el('b', null, '0 / 0');
    [['Final score', eScore], ['Levels reached', eLevel], ['Correct', eAcc]].forEach(function (r){
      var row = el('div'); row.appendChild(el('span', null, r[0])); row.appendChild(r[1]);
      endStats.appendChild(row);
    });
    var btnAgain = el('button', 'play', 'Play again');
    var btnHub = el('a', 'ghost', 'Back to all games');
    btnHub.href = 'index.html'; btnHub.style.textDecoration = 'none';
    [endH, endSub, endStats, btnAgain, btnHub].forEach(function (n){ endSheet.appendChild(n); });
    endEl.appendChild(endSheet);

    /* ---------- api handed to the game ---------- */
    function setScore(n){
      S.score = n;
      scoreVal.textContent = S.score;
      var pct = Math.max(0, Math.min(100, (S.score / (cfg.scoreFull || 60)) * 100));
      scoreFill.style.width = pct + '%';
    }
    function flash(text, good){
      flashEl.textContent = text;
      flashEl.className = 'flash on ' + (good ? 'good' : 'bad');
      setTimeout(function (){ flashEl.className = 'flash ' + (good ? 'good' : 'bad'); }, 520);
    }
    function clearBoard(){
      board.innerHTML = '';
      board.appendChild(flashEl);
    }
    function stopLevelClock(){
      clearInterval(levelTimer);
      levelTimer = null;
    }
    function startLevelClock(seconds){
      stopLevelClock();
      if (!seconds){ clockEl.textContent = fmt(S.sessionLeft); return; }
      S.levelLeft = seconds;
      levelDeadline = Date.now() + seconds * 1000;
      clockEl.textContent = fmt(seconds);
      levelTimer = setInterval(function (){
        if (S.paused){ levelDeadline += 250; return; }
        S.levelLeft = (levelDeadline - Date.now()) / 1000;
        clockEl.textContent = fmt(S.levelLeft);
        if (S.levelLeft <= 0){
          stopLevelClock();
          if (!S.locked) api.wrong('Too slow');
        }
      }, 250);
    }

    var api = {
      level: function (){ return S.level; },
      score: function (){ return S.score; },
      board: board,
      el: el, shuffle: shuffle, pick: pick, randInt: randInt, beep: beep,

      right: function (msg, points){
        if (S.locked) return;
        S.locked = true;
        S.attempts++; S.right++;
        setScore(S.score + (points === undefined ? cfg.pointsRight : points));
        flash(msg || ('+' + (points === undefined ? cfg.pointsRight : points)), true);
        beep(880, 140);
        stopLevelClock();
        api.after(cfg.nextDelay || 700, api.nextLevel);
      },
      wrong: function (msg, points){
        if (S.locked) return;
        S.locked = true;
        S.attempts++; S.wrong++;
        setScore(S.score - (points === undefined ? cfg.pointsWrong : points));
        flash(msg || ('−' + (points === undefined ? cfg.pointsWrong : points)), false);
        beep(220, 200, 'square');
        stopLevelClock();
        api.after(cfg.nextDelay || 700, api.nextLevel);
      },
      /* a timeout that respects pause and dies on restart */
      after: function (ms, fn){
        var id = setTimeout(function (){
          if (!S.running) return;
          if (S.paused){ api.after(120, fn); return; }
          fn();
        }, ms);
        return id;
      },
      nextLevel: function (){
        if (!S.running) return;
        S.level++;
        lvlEl.textContent = 'Level ' + S.level;
        runLevel();
      },
      locked: function (){ return S.locked; },
      prompt: function (t){ promptEl.textContent = t; },
      clearBoard: clearBoard,
      end: finish
    };

    function runLevel(){
      S.locked = false;
      clearBoard();
      var secs = typeof cfg.levelTime === 'function' ? cfg.levelTime(S.level) : cfg.levelTime;
      startLevelClock(secs);
      cfg.buildLevel(api, board);
    }

    /* ---------- session clock ---------- */
    function tickSession(){
      if (!S.running || S.paused) return;
      S.sessionLeft -= 0.25;
      sessionFill.style.transform = 'scaleX(' + Math.max(0, S.sessionLeft / cfg.session) + ')';
      if (!cfg.levelTime) clockEl.textContent = fmt(S.sessionLeft);
      if (S.sessionLeft <= 0) finish();
    }

    function finish(){
      if (!S.running) return;
      S.running = false;
      stopLevelClock();
      clearInterval(sessionTimer);
      eScore.textContent = S.score;
      eLevel.textContent = S.level;
      eAcc.textContent = S.right + ' / ' + S.attempts;
      var pct = S.attempts ? S.right / S.attempts : 0;
      endSub.textContent = S.score <= 0 ? 'Keep practising'
        : pct > 0.8 ? 'Excellent' : pct > 0.55 ? 'Good going' : 'Room to improve';
      endEl.hidden = false;
    }

    function start(){
      clearInterval(sessionTimer); stopLevelClock();
      S.level = 1; S.right = 0; S.wrong = 0; S.attempts = 0;
      S.sessionLeft = cfg.session; S.running = true; S.paused = false; S.locked = false;
      lvlEl.textContent = 'Level 1';
      setScore(0);
      sessionFill.style.transform = 'scaleX(1)';
      introEl.hidden = true; pauseEl.hidden = true; endEl.hidden = true;
      sessionTimer = setInterval(tickSession, 250);
      runLevel();
    }

    function togglePause(force){
      if (!S.running) return;
      S.paused = force === undefined ? !S.paused : force;
      if (S.paused){
        pScore.textContent = S.score;
        pLevel.textContent = S.level;
        pTime.textContent = fmt(S.sessionLeft);
      }
      pauseEl.hidden = !S.paused;
    }

    btnPlay.addEventListener('click', start);
    btnAgain.addEventListener('click', start);
    btnRestart.addEventListener('click', start);
    btnResume.addEventListener('click', function (){ togglePause(false); });
    btnPause.addEventListener('click', function (){ togglePause(); });
    btnSound.addEventListener('click', function (){
      muted = !muted;
      btnSound.textContent = muted ? '🔇' : '🔊';
    });
    window.addEventListener('keydown', function (e){
      var t = e.target;
      if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT')) return;
      if (e.key.toLowerCase() === 'p') togglePause();
    });

    return api;
  }

  return {create:create, el:el, shuffle:shuffle, pick:pick, randInt:randInt, beep:beep};
})();
