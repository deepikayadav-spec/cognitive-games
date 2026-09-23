/* Shared engine for the cognitive ability games.

   A game calls CG.create({...}) with its rules text and a buildLevel(api, board)
   function. The engine owns the top bar, the session clock, the per-level clock,
   scoring, streaks, the confetti, the intro / pause / results screens and the
   sound blips, so each game file only has to draw its own board and say
   api.right() or api.wrong().

   Scoring, timers and level progression are untouched by the styling: the
   numbers a game passes in are the numbers the player gets.                  */
window.CG = (function () {
  "use strict";

  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

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
  function chime(){                                   /* three rising notes */
    [660, 880, 1170].forEach(function (f, i){ setTimeout(function (){ beep(f, 120); }, i * 90); });
  }

  /* ---------- confetti ---------- */
  var CONF_COLOURS = ['#FFD15C', '#4B8DF8', '#3DD68C', '#F3705A', '#9B7BFF', '#FFFFFF'];
  function confetti(count, originX, originY){
    if (reduced) return;
    var layer = el('div', 'conf');
    document.body.appendChild(layer);
    var x = originX === undefined ? window.innerWidth / 2 : originX;
    var y = originY === undefined ? window.innerHeight * 0.34 : originY;
    for (var i = 0; i < (count || 26); i++){
      var p = el('i');
      var ang = Math.random() * Math.PI * 2;
      var dist = 90 + Math.random() * 260;
      p.style.left = x + 'px';
      p.style.top = y + 'px';
      p.style.background = CONF_COLOURS[(Math.random() * CONF_COLOURS.length) | 0];
      p.style.setProperty('--dx', Math.cos(ang) * dist + 'px');
      p.style.setProperty('--dy', (Math.sin(ang) * dist + 220) + 'px');
      p.style.setProperty('--rot', (Math.random() * 900 - 450) + 'deg');
      p.style.setProperty('--dur', (0.9 + Math.random() * 0.7) + 's');
      layer.appendChild(p);
    }
    setTimeout(function (){ layer.remove(); }, 1900);
  }

  /* streak lines, deliberately short */
  var STREAK_WORDS = ['', '', '2 in a row', '3 in a row 🔥', 'on fire 🔥', 'unreal 🔥', 'untouchable 🔥'];
  function streakLine(n){
    if (n < 2) return '';
    return STREAK_WORDS[Math.min(n, STREAK_WORDS.length - 1)];
  }

  function create(cfg){
    var S = {
      level:1, score:0, right:0, wrong:0, attempts:0,
      streak:0, bestStreak:0,
      sessionLeft:cfg.session, levelLeft:0,
      running:false, paused:false, locked:false
    };
    var levelTimer = null, sessionTimer = null, levelDeadline = 0;

    /* ---------- chrome ---------- */
    var stage = el('div', 'stage');
    var bar = el('div', 'bar');
    var btnPause = el('button', 'ic', '❚❚'); btnPause.title = 'Pause';
    var btnSound = el('button', 'ic', '🔊'); btnSound.title = 'Sound';
    var lvlEl = el('div', 'lvl', 'Lvl 1');
    var scoreWrap = el('div', 'scorebar');
    var scoreFill = el('div', 'fill');
    var scoreVal = el('span', 'v', '0');
    scoreWrap.appendChild(scoreFill); scoreWrap.appendChild(scoreVal);
    var streakEl = el('div', 'streak'); streakEl.id = 'streak';
    var clockEl = el('div', 'clock', fmt(cfg.levelTime || cfg.session));
    var nameEl = el('div', 'name', cfg.name);
    [btnPause, btnSound, lvlEl, scoreWrap, streakEl, clockEl, nameEl]
      .forEach(function (n){ bar.appendChild(n); });

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

    var back = el('a', 'backlink', '← all games');
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
    introSheet.appendChild(el('h2', null, 'How it works'));
    var ul = el('ul');
    (cfg.howto || []).forEach(function (t){ ul.appendChild(el('li', null, t)); });
    introSheet.appendChild(ul);
    var btnPlay = el('button', 'play', cfg.playLabel || "Let's go");
    introSheet.appendChild(btnPlay);
    introEl.appendChild(introSheet);

    var pauseSheet = el('div', 'sheet');
    pauseSheet.style.width = 'min(420px,100%)';
    var pauseH = el('h1', null, 'Paused'); pauseH.style.fontSize = 'clamp(26px,5vw,38px)';
    var pauseStats = el('div', 'results');
    var pScore = el('b', null, '0'), pLevel = el('b', null, '1'), pTime = el('b', null, '');
    [['Score', pScore], ['Level', pLevel], ['Time left', pTime]].forEach(function (r){
      var row = el('div'); row.appendChild(el('span', null, r[0])); row.appendChild(r[1]);
      pauseStats.appendChild(row);
    });
    var btnResume = el('button', 'play', 'Resume');
    var btnRestart = el('button', 'ghost', 'Start over');
    [pauseH, pauseStats, btnResume, btnRestart].forEach(function (n){ pauseSheet.appendChild(n); });
    pauseEl.appendChild(pauseSheet);

    var endSheet = el('div', 'sheet');
    endSheet.style.width = 'min(480px,100%)';
    var endH = el('h1', null, "Time's up");
    var endSub = el('div', 'sub', '');
    var endStats = el('div', 'results');
    var eScore = el('b', null, '0'), eLevel = el('b', null, '0'),
        eAcc = el('b', null, '0 / 0'), eStreak = el('b', null, '0');
    [['Score', eScore], ['Level reached', eLevel], ['Correct', eAcc], ['Best streak', eStreak]]
      .forEach(function (r){
        var row = el('div'); row.appendChild(el('span', null, r[0])); row.appendChild(r[1]);
        endStats.appendChild(row);
      });
    var shareRow = el('div', 'share');
    var shareText = el('span');
    var shareBtn = el('button', null, 'Copy');
    shareRow.appendChild(shareText); shareRow.appendChild(shareBtn);
    var btnAgain = el('button', 'play', 'Run it back');
    var btnHub = el('a', 'ghost', 'Try another game');
    btnHub.href = 'index.html';
    [endH, endSub, endStats, shareRow, btnAgain, btnHub].forEach(function (n){ endSheet.appendChild(n); });
    endEl.appendChild(endSheet);

    /* ---------- scoring ---------- */
    function setScore(n){
      S.score = n;
      scoreVal.textContent = S.score;
      scoreVal.className = 'v' + (S.score < 0 ? ' neg' : '');
      var pct = Math.max(0, Math.min(100, (S.score / (cfg.scoreFull || 60)) * 100));
      scoreFill.style.width = pct + '%';
    }
    function showStreak(){
      var line = streakLine(S.streak);
      if (line){
        streakEl.textContent = line;
        streakEl.className = 'streak on';
      } else {
        streakEl.className = 'streak';
      }
    }
    function flash(text, good){
      flashEl.textContent = text;
      flashEl.className = 'flash ' + (good ? 'good' : 'bad');
      void flashEl.offsetWidth;                       /* restart the animation */
      flashEl.className = 'flash on ' + (good ? 'good' : 'bad');
      setTimeout(function (){ flashEl.className = 'flash ' + (good ? 'good' : 'bad'); }, 850);
    }
    function clearBoard(){
      board.innerHTML = '';
      board.appendChild(flashEl);
    }
    function stopLevelClock(){
      clearInterval(levelTimer);
      levelTimer = null;
      clockEl.classList.remove('low');
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
        clockEl.classList.toggle('low', S.levelLeft <= 5);
        if (S.levelLeft <= 0){
          stopLevelClock();
          if (!S.locked) api.wrong('too slow');
        }
      }, 250);
    }

    var api = {
      level: function (){ return S.level; },
      score: function (){ return S.score; },
      board: board,
      el: el, shuffle: shuffle, pick: pick, randInt: randInt, beep: beep, confetti: confetti,

      right: function (msg, points){
        if (S.locked) return;
        S.locked = true;
        S.attempts++; S.right++;
        S.streak++;
        S.bestStreak = Math.max(S.bestStreak, S.streak);
        var gain = points === undefined ? cfg.pointsRight : points;
        setScore(S.score + gain);
        flash(msg || ('+' + gain), true);
        showStreak();
        if (S.streak >= 3){ chime(); confetti(34); } else { beep(880, 140); confetti(16); }
        stopLevelClock();
        api.after(cfg.nextDelay || 700, api.nextLevel);
      },
      wrong: function (msg, points){
        if (S.locked) return;
        S.locked = true;
        S.attempts++; S.wrong++;
        S.streak = 0;
        showStreak();
        var loss = points === undefined ? cfg.pointsWrong : points;
        setScore(S.score - loss);
        flash(msg || ('−' + loss), false);
        beep(220, 200, 'square');
        stopLevelClock();
        api.after(cfg.nextDelay || 700, api.nextLevel);
      },
      /* a timeout that respects pause and dies on restart */
      after: function (ms, fn){
        return setTimeout(function (){
          if (!S.running) return;
          if (S.paused){ api.after(120, fn); return; }
          fn();
        }, ms);
      },
      nextLevel: function (){
        if (!S.running) return;
        S.level++;
        lvlEl.textContent = 'Lvl ' + S.level;
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
      if (!cfg.levelTime){
        clockEl.textContent = fmt(S.sessionLeft);
        clockEl.classList.toggle('low', S.sessionLeft <= 20);
      }
      if (S.sessionLeft <= 0) finish();
    }

    /* a vibe label instead of a dry verdict */
    function verdict(){
      var acc = S.attempts ? S.right / S.attempts : 0;
      if (S.score <= 0) return 'warming up 🌱';
      if (acc > 0.85 && S.bestStreak >= 4) return 'certified cracked 🧠';
      if (acc > 0.75) return 'sharp 🎯';
      if (acc > 0.55) return 'solid 💪';
      return 'getting there 📈';
    }

    function finish(){
      if (!S.running) return;
      S.running = false;
      stopLevelClock();
      clearInterval(sessionTimer);
      streakEl.className = 'streak';
      eScore.textContent = S.score;
      eLevel.textContent = S.level;
      eAcc.textContent = S.right + ' / ' + S.attempts;
      eStreak.textContent = S.bestStreak;
      endSub.textContent = verdict();
      var line = 'I scored ' + S.score + ' on ' + cfg.name + ' — level ' + S.level +
                 ', best streak ' + S.bestStreak + '. Beat that 👀';
      shareText.textContent = line;
      shareBtn.textContent = 'Copy';
      shareBtn.onclick = function (){
        try {
          navigator.clipboard.writeText(line);
          shareBtn.textContent = 'Copied ✓';
        } catch (e){
          /* clipboard is blocked offline in some browsers — select it instead */
          var r = document.createRange();
          r.selectNodeContents(shareText);
          var sel = window.getSelection();
          sel.removeAllRanges(); sel.addRange(r);
          shareBtn.textContent = 'Select + copy';
        }
      };
      if (S.score > 0) confetti(46);
      endEl.hidden = false;
    }

    function start(){
      clearInterval(sessionTimer); stopLevelClock();
      S.level = 1; S.right = 0; S.wrong = 0; S.attempts = 0;
      S.streak = 0; S.bestStreak = 0;
      S.sessionLeft = cfg.session; S.running = true; S.paused = false; S.locked = false;
      lvlEl.textContent = 'Lvl 1';
      setScore(0);
      showStreak();
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

  return {
    create:create, el:el, shuffle:shuffle, pick:pick, randInt:randInt,
    beep:beep, chime:chime, confetti:confetti, streakLine:streakLine, reduced:reduced
  };
})();
