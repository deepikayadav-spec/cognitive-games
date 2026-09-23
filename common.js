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

  /* ---------- sound ----------
     One small synth: every cue is a few oscillators through an envelope and a
     shared lowpass, so nothing is loaded from disk and the games still work
     offline. Browsers block audio until the first gesture, so the context is
     created lazily and resumed on the first tap.                             */
  var actx = null, master = null, muted = false;

  function audio(){
    if (muted) return null;
    try {
      if (!actx){
        actx = new (window.AudioContext || window.webkitAudioContext)();
        master = actx.createGain();
        master.gain.value = 0.22;
        var warm = actx.createBiquadFilter();
        warm.type = 'lowpass';
        warm.frequency.value = 5200;
        master.connect(warm);
        warm.connect(actx.destination);
      }
      if (actx.state === 'suspended' && actx.resume){
        // a rejected resume (no gesture yet) must not surface as an unhandled rejection
        var r = actx.resume();
        if (r && r.catch) r.catch(function (){});
      }
      return actx;
    } catch (e){ return null; }
  }
  document.addEventListener('pointerdown', function once(){
    audio();
    document.removeEventListener('pointerdown', once);
  }, {passive:true});

  /* one voice: freq (optionally gliding), a shape, and an ADSR-ish envelope */
  function voice(opt){
    var ctx = audio();
    if (!ctx) return;
    var t0 = ctx.currentTime + (opt.delay || 0);
    var dur = opt.dur || 0.18;
    var o = ctx.createOscillator();
    var g = ctx.createGain();
    o.type = opt.type || 'sine';
    o.frequency.setValueAtTime(opt.freq, t0);
    if (opt.to) o.frequency.exponentialRampToValueAtTime(Math.max(30, opt.to), t0 + dur);
    if (opt.detune) o.detune.setValueAtTime(opt.detune, t0);

    var peak = opt.peak === undefined ? 0.5 : opt.peak;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + (opt.attack || 0.008));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);

    o.connect(g); g.connect(master);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }
  function chord(freqs, opt){
    opt = opt || {};
    freqs.forEach(function (f, i){
      voice({freq:f, type:opt.type || 'triangle', dur:opt.dur || 0.22,
             peak:(opt.peak || 0.4) / (1 + i * 0.25), delay:(opt.delay || 0) + i * (opt.gap || 0.07),
             attack:opt.attack});
    });
  }


  /* ---------- applause ----------
     One clap is a 30-60ms burst of band-passed noise. A room full of people is
     a few dozen of those scattered across half a second, with a soft noise
     swell underneath for the body of the crowd. */
  var noiseBuf = null;
  function noise(ctx){
    if (noiseBuf) return noiseBuf;
    var len = Math.floor(ctx.sampleRate * 1.2);
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    var d = noiseBuf.getChannelData(0);
    for (var i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return noiseBuf;
  }

  function clap(ctx, at, peak){
    var src = ctx.createBufferSource();
    src.buffer = noise(ctx);
    src.playbackRate.value = 0.85 + Math.random() * 0.4;

    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1100 + Math.random() * 1500;   /* the crack of a palm */
    bp.Q.value = 0.7 + Math.random() * 1.1;

    var hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 600;

    var g = ctx.createGain();
    var dur = 0.03 + Math.random() * 0.04;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(peak, at + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, at + dur);

    src.connect(bp); bp.connect(hp); hp.connect(g); g.connect(master);
    src.start(at);
    src.stop(at + dur + 0.02);
  }

  /* size: 1 a small ripple, 2 a proper round, 3 the whole room */
  function applause(size){
    var ctx = audio();
    if (!ctx) return;
    var t0 = ctx.currentTime + 0.02;
    var count = [14, 26, 44][Math.min(size, 3) - 1] || 20;
    var spread = [0.45, 0.62, 0.85][Math.min(size, 3) - 1] || 0.5;
    var peak = [0.16, 0.22, 0.3][Math.min(size, 3) - 1] || 0.18;

    for (var i = 0; i < count; i++){
      /* front-loaded, the way a crowd starts together then scatters */
      var when = t0 + Math.pow(Math.random(), 1.7) * spread;
      clap(ctx, when, peak * (0.55 + Math.random() * 0.75));
    }

    /* the body of the crowd underneath the individual claps */
    var body = ctx.createBufferSource();
    body.buffer = noise(ctx);
    body.loop = true;
    var bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1500;
    bp.Q.value = 0.5;
    var g = ctx.createGain();
    var dur = spread + 0.35;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak * 0.42, t0 + 0.09);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    body.connect(bp); bp.connect(g); g.connect(master);
    body.start(t0);
    body.stop(t0 + dur + 0.05);
  }

  /* the cues the games actually use */
  var SFX = {
    tap:    function (){ voice({freq:300, type:'square', dur:0.05, peak:0.16}); },
    select: function (){ voice({freq:640, type:'triangle', dur:0.09, peak:0.3});
                         voice({freq:960, type:'sine', dur:0.07, peak:0.14, delay:0.02}); },
    move:   function (){ voice({freq:420, type:'sine', dur:0.08, peak:0.26, to:520}); },
    blocked:function (){ voice({freq:150, type:'square', dur:0.07, peak:0.2, to:110}); },
    correct:function (){ chord([523.25, 659.25, 783.99], {gap:0.055, dur:0.26, peak:0.4});
                         voice({freq:1567, type:'sine', dur:0.2, peak:0.1, delay:0.14});
                         applause(1); },
    streak: function (){ chord([659.25, 830.61, 987.77, 1318.5],
                               {gap:0.055, dur:0.3, peak:0.5, type:'triangle'});
                         voice({freq:2093, type:'sine', dur:0.34, peak:0.09, delay:0.2});
                         applause(2); },
    wrong:  function (){ voice({freq:196, type:'sawtooth', dur:0.26, peak:0.32, to:110});
                         voice({freq:190, type:'square', dur:0.2, peak:0.1, detune:18}); },
    levelUp:function (){ chord([392, 523.25, 659.25, 1046.5], {gap:0.045, dur:0.24, peak:0.38}); },
    tick:   function (){ voice({freq:1180, type:'sine', dur:0.045, peak:0.12}); },
    start:  function (){ chord([261.63, 392, 523.25], {gap:0.06, dur:0.3, peak:0.35}); },
    over:   function (){ chord([523.25, 392, 311.13, 261.63], {gap:0.12, dur:0.5, peak:0.4,
                               type:'triangle'}); },
    win:    function (){ chord([523.25, 659.25, 783.99, 1046.5, 1318.5],
                               {gap:0.08, dur:0.44, peak:0.45});
                         applause(3); },
    clap:   function (){ applause(1); }
  };
  function sfx(name){ if (SFX[name]) SFX[name](); }

  /* kept so older calls keep working */
  function beep(freq, ms, type){
    voice({freq:freq, type:type === 'square' ? 'square' : 'sine', dur:(ms || 140) / 1000, peak:0.3});
  }
  function chime(){ sfx('streak'); }
  function setMuted(v){
    muted = !!v;
    if (master) master.gain.value = muted ? 0 : 0.22;
  }
  function isMuted(){ return muted; }

  /* ---------- colour helpers, for shapes that need depth ---------- */
  function shade(hex, amt){
    var n = parseInt(hex.slice(1), 16);
    var r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    var f = function (c){
      return Math.max(0, Math.min(255, Math.round(amt > 0 ? c + (255 - c) * amt : c * (1 + amt))));
    };
    return '#' + ((1 << 24) + (f(r) << 16) + (f(g) << 8) + f(b)).toString(16).slice(1);
  }
  var gradSeq = 0;
  /* a top-lit gradient plus its id, so an SVG shape reads as a solid object */
  function grad(colour){
    var id = 'g' + (++gradSeq);
    return {
      id: id,
      defs: '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1">' +
            '<stop offset="0" stop-color="' + shade(colour, 0.34) + '"/>' +
            '<stop offset="0.55" stop-color="' + colour + '"/>' +
            '<stop offset="1" stop-color="' + shade(colour, -0.3) + '"/>' +
            '</linearGradient></defs>',
      fill: 'url(#' + id + ')'
    };
  }

  /* ---------- confetti ---------- */
  var CONF_COLOURS = ['#F5EFBB', '#C62B2C', '#5BD69A', '#DCC471', '#FFFFFF', '#941A1B'];
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
    var crest = el('img', 'crest');
    crest.src = 'niat-logo.png';
    crest.alt = 'NIAT';
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
    [crest, btnPause, btnSound, lvlEl, scoreWrap, streakEl, clockEl, nameEl]
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
    var sheetCrest = el('img', 'crest');
    sheetCrest.src = 'niat-logo.png';
    sheetCrest.alt = 'NIAT';
    introSheet.appendChild(sheetCrest);
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
        var low = S.levelLeft <= 5;
        if (low && !clockEl.classList.contains('low')) sfx('tick');
        clockEl.classList.toggle('low', low);
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
      el: el, shuffle: shuffle, pick: pick, randInt: randInt,
      beep: beep, sfx: sfx, applause: applause, confetti: confetti, grad: grad, shade: shade,

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
        if (S.streak >= 3){ sfx('streak'); confetti(34); } else { sfx('correct'); confetti(16); }
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
        sfx('wrong');
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
      sfx(S.score > 0 ? 'win' : 'over');
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
      sfx('start');
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
      setMuted(!isMuted());
      btnSound.textContent = isMuted() ? '🔇' : '🔊';
      if (!isMuted()) sfx('select');
    });
    window.addEventListener('keydown', function (e){
      var t = e.target;
      if (t && (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT')) return;
      if (e.key.toLowerCase() === 'p') togglePause();
    });
    [btnPlay, btnAgain, btnRestart, btnResume, btnPause].forEach(function (b){
      b.addEventListener('pointerdown', function (){ sfx('tap'); });
    });

    return api;
  }

  return {
    create:create, el:el, shuffle:shuffle, pick:pick, randInt:randInt,
    beep:beep, chime:chime, sfx:sfx, applause:applause, setMuted:setMuted, isMuted:isMuted,
    shade:shade, grad:grad,
    confetti:confetti, streakLine:streakLine, reduced:reduced
  };
})();
