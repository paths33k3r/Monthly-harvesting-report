/* ═══════════════════════════════════════════════════════
   NOOB DRUMMER – game.js
   Guitar Hero-style drum rhythm game, 100 levels
═══════════════════════════════════════════════════════ */
'use strict';

// ─────────────────────────────────────────────────────
// ❶  CONSTANTS & CONFIG
// ─────────────────────────────────────────────────────
const LANES = 5;
const LANE_KEYS = ['a', 's', 'd', 'f', ' ']; // 0=HiHat 1=Snare 2=Tom 3=Floor 4=Kick
const LANE_NAMES = ['HI-HAT', 'SNARE', 'TOM', 'FLOOR', 'KICK'];
const LANE_DRUM_IDS = ['gameHihat', 'gameSnare', 'gameTom', null, 'gameBass']; // null=bass managed separately

const WINDOW_PERFECT = 55;  // ms either side for PERFECT
const WINDOW_GOOD    = 130; // ms either side for GOOD
const HP_MAX = 100;
const HP_MISS_PENALTY = 8;

const UNLOCKS = [
  { level: 10, name: 'Glow Sticks',     icon: '✨', cls: 'sticks-glow',    type: 'sticks' },
  { level: 20, name: 'Band T-Shirt',    icon: '🎸', cls: 'outfit-band',    type: 'outfit' },
  { level: 30, name: 'Bucket Hat',      icon: '🧢', cls: 'hat-bucket',     type: 'hat'    },
  { level: 40, name: 'Chrome Snare',    icon: '🥁', cls: 'kit-chrome',     type: 'kit'    },
  { level: 50, name: 'Platform Boots',  icon: '👢', cls: 'boots-platform', type: 'boots'  },
  { level: 60, name: 'Neon Drum Kit',   icon: '💡', cls: 'kit-neon',       type: 'kit'    },
  { level: 70, name: 'Mohawk',          icon: '🤘', cls: 'hat-mohawk',     type: 'hat'    },
  { level: 80, name: 'Leather Jacket',  icon: '🧥', cls: 'outfit-leather', type: 'outfit' },
  { level: 90, name: 'Gold Drum Kit',   icon: '🏅', cls: 'kit-gold',       type: 'kit'    },
  { level:100, name: 'Rockstar Outfit', icon: '⭐', cls: 'outfit-rockstar', type: 'outfit' },
];

// ─────────────────────────────────────────────────────
// ❷  LEVEL CONFIG GENERATOR
// ─────────────────────────────────────────────────────
function getLevelConfig(lvl) {
  /* Returns { bpm, activeLanes, noteSpeed, difficulty } */
  lvl = Math.max(1, Math.min(100, lvl));
  let bpm, activeLanes, difficulty;

  if (lvl <= 10) {
    bpm = 60 + (lvl - 1) * 2;
    activeLanes = 2;
    difficulty = 'NOOB';
  } else if (lvl <= 30) {
    bpm = 80 + (lvl - 11) * 3;
    activeLanes = 3;
    difficulty = 'BEGINNER';
  } else if (lvl <= 60) {
    bpm = 105 + (lvl - 31) * 2;
    activeLanes = 4;
    difficulty = 'INTERMEDIATE';
  } else if (lvl <= 85) {
    bpm = 140 + (lvl - 61) * 2;
    activeLanes = 5;
    difficulty = 'ADVANCED';
  } else {
    bpm = 168 + (lvl - 86) * 2;
    activeLanes = 5;
    difficulty = 'ROCKSTAR';
  }

  // px/ms – notes fall from top to hit zone
  const noteSpeed = 0.25 + (bpm - 60) * 0.0022;

  return { bpm, activeLanes, noteSpeed, difficulty };
}

// ─────────────────────────────────────────────────────
// ❸  AUDIO ENGINE (Web Audio API – no files needed)
// ─────────────────────────────────────────────────────
const AudioEngine = (() => {
  let ctx = null;
  function init() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
  }

  function playKick() {
    init();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.setValueAtTime(150, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    gain.gain.setValueAtTime(1, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.5);
    osc.start(); osc.stop(ctx.currentTime + 0.5);
  }

  function playSnare() {
    init();
    const bufferSize = ctx.sampleRate * 0.2;
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.8, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass'; filter.frequency.value = 1200;
    source.connect(filter); filter.connect(gain); gain.connect(ctx.destination);
    source.start();
  }

  function playHihat(open = false) {
    init();
    const bufferSize = ctx.sampleRate * (open ? 0.35 : 0.08);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.4, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + (open ? 0.35 : 0.08));
    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass'; filter.frequency.value = 7000;
    source.connect(filter); filter.connect(gain); gain.connect(ctx.destination);
    source.start();
  }

  function playTom(freq = 120) {
    init();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    gain.gain.setValueAtTime(0.7, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.start(); osc.stop(ctx.currentTime + 0.3);
  }

  function playMiss() {
    init();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.connect(gain); gain.connect(ctx.destination);
    osc.frequency.setValueAtTime(200, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + 0.15);
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
    osc.start(); osc.stop(ctx.currentTime + 0.2);
  }

  function playByLane(lane) {
    switch(lane) {
      case 0: playHihat(); break;
      case 1: playSnare(); break;
      case 2: playTom(110); break;
      case 3: playTom(80); break;
      case 4: playKick(); break;
    }
  }

  return { init, playKick, playSnare, playHihat, playTom, playMiss, playByLane };
})();

// ─────────────────────────────────────────────────────
// ❹  GAME STATE
// ─────────────────────────────────────────────────────
const State = {
  currentScreen: 'menu',
  level: 1,
  score: 0,
  combo: 0,
  maxCombo: 0,
  hp: HP_MAX,
  perfects: 0,
  goods: 0,
  misses: 0,
  highScores: {},   // { [level]: number }
  earnedLevels: 1,  // highest level ever completed
  unlocksEarned: new Set(), // Set of unlock levels
  paused: false,
  playing: false,
  config: null,
  notes: [],        // active note objects
  pendingNotes: [], // scheduled notes
  gameRafId: null,
  beatTimer: null,
  levelStartTime: 0,
  levelDuration: 30000, // ms per level
  levelProgress: 0,
};

// ─────────────────────────────────────────────────────
// ❺  SCREEN MANAGER
// ─────────────────────────────────────────────────────
const Screens = {
  show(id) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    document.getElementById('screen-' + id).classList.add('active');
    State.currentScreen = id;
  }
};

// ─────────────────────────────────────────────────────
// ❻  CHARACTER ANIMATOR  (image-swap approach)
// ─────────────────────────────────────────────────────
const CHAR_SPRITES = {
  idle:     'assets/drummer_idle.png',
  hitLeft:  'assets/drummer_hit_left.png',
  hitRight: 'assets/drummer_hit_right.png',
  kick:     'assets/drummer_kick.png',
};

const Character = {
  _poseTimer: null,

  // Swap all character imgs to a given pose, then revert to idle
  _setPose(pose, durationMs = 180) {
    const imgs = ['gameCharImg', 'menuCharImg', 'loadoutCharImg']
      .map(id => document.getElementById(id)).filter(Boolean);
    const src = CHAR_SPRITES[pose] || CHAR_SPRITES.idle;
    imgs.forEach(img => {
      img.src = src;
      img.classList.add('char-hit');
    });
    clearTimeout(Character._poseTimer);
    Character._poseTimer = setTimeout(() => {
      imgs.forEach(img => {
        img.src = CHAR_SPRITES.idle;
        img.classList.remove('char-hit');
      });
    }, durationMs);
  },

  // Only animate the in-game character on hit
  hit(lane) {
    const img = document.getElementById('gameCharImg');
    if (!img) return;

    let pose;
    if (lane === 4) {
      pose = 'kick';
    } else if (lane === 0 || lane === 2) {
      pose = 'hitLeft';
    } else {
      pose = 'hitRight';
    }

    img.src = CHAR_SPRITES[pose];
    img.classList.add('char-hit');
    clearTimeout(Character._poseTimer);
    Character._poseTimer = setTimeout(() => {
      img.src = CHAR_SPRITES.idle;
      img.classList.remove('char-hit');
    }, 200);
  },

  // Show idle on all character images
  refreshAll() {
    ['gameCharImg', 'menuCharImg', 'loadoutCharImg'].forEach(id => {
      const img = document.getElementById(id);
      if (img) img.src = CHAR_SPRITES.idle;
    });
  }
};

// ─────────────────────────────────────────────────────
// ❼  BEAT / NOTE GENERATOR
// ─────────────────────────────────────────────────────
const BeatGen = {
  // Generate a full pattern for the level (array of {lane, time} in ms)
  generate(config, durationMs) {
    const { bpm, activeLanes } = config;
    const msBeat = (60 / bpm) * 1000; // ms per beat
    const msSubdivision = msBeat / 2;  // 8th-note spacing
    const notes = [];

    let t = 800; // start after 800ms buffer
    const endTime = durationMs - 500;

    // Active lane pool – always include kick (4) if activeLanes >= 4
    const lanePool = [];
    if (activeLanes >= 1) lanePool.push(0, 1);      // hihat, snare
    if (activeLanes >= 3) lanePool.push(2);          // tom
    if (activeLanes >= 4) lanePool.push(3);          // floor
    if (activeLanes >= 5) lanePool.push(4);          // kick

    let lastLanes = [];

    while (t < endTime) {
      // Decide how many simultaneous notes (chord chance increases with level)
      const maxNow = activeLanes <= 2 ? 1 : (activeLanes <= 4 ? (Math.random() < .2 ? 2 : 1) : (Math.random() < .3 ? 2 : 1));
      const available = lanePool.filter(l => !lastLanes.includes(l));
      const shuffled = available.sort(() => Math.random() - 0.5);
      const batch = shuffled.slice(0, maxNow);

      batch.forEach(lane => notes.push({ lane, time: t }));
      lastLanes = batch;

      // Vary timing — sometimes double-time, sometimes longer gaps
      const roll = Math.random();
      if (roll < 0.2 && activeLanes >= 3) {
        t += msSubdivision / 2; // 16th note (roll)
      } else if (roll < 0.6) {
        t += msSubdivision;     // 8th note
      } else {
        t += msBeat;            // quarter note (breathing room)
      }
    }

    return notes;
  }
};

// ─────────────────────────────────────────────────────
// ❽  NOTE RENDERER & PHYSICS
// ─────────────────────────────────────────────────────
const NoteRenderer = {
  noteElements: [], // { el, lane, hitTime, scored }

  init() {
    this.noteElements = [];
    // Clear old notes
    document.querySelectorAll('.note').forEach(n => n.remove());
  },

  // Spawn a note element
  spawn(lane, hitTime) {
    const laneEl = document.getElementById('lane-' + lane);
    if (!laneEl || laneEl.classList.contains('inactive')) return;

    const el = document.createElement('div');
    el.className = 'note';
    el.dataset.lane = lane;
    el.textContent = LANE_NAMES[lane];
    laneEl.appendChild(el);

    // position: start above screen
    el.style.top = '-50px';

    this.noteElements.push({ el, lane, hitTime, scored: false });
  },

  // Called every frame with current game time
  update(now, config) {
    const hitZoneY = this._hitZoneTopY(); // px from top of lane to hit zone top

    this.noteElements = this.noteElements.filter(note => {
      if (note.scored && note.scored !== 'alive') return false;  // note.scored='miss' means keep briefly

      const elapsed = hitTime => {
        const timeToHit = note.hitTime - now;        // negative = already passed
        const speedPx = config.noteSpeed;             // px per ms
        const laneEl = document.getElementById('lane-' + note.lane);
        if (!laneEl) return;
        const laneH = laneEl.clientHeight;
        const hitZoneCenter = laneH - 80 - 35;       // bottom 80px padding + half note

        const topPx = hitZoneCenter - timeToHit * speedPx;
        note.el.style.top = topPx + 'px';

        // If note fell below screen — missed
        if (topPx > laneH + 60) {
          if (!note.scored) {
            note.scored = 'miss';
            this._onMiss(note.lane);
          }
          note.el.remove();
          return false; // remove from array
        }
        return true;
      };

      return elapsed() !== false;
    });
  },

  _hitZoneTopY() {
    const hz = document.getElementById('hz-0');
    if (!hz) return 0;
    return hz.getBoundingClientRect().top;
  },

  // Try to hit the closest note on this lane
  tryHit(lane, now) {
    // Find best candidate
    let best = null, bestDelta = Infinity;
    for (const note of this.noteElements) {
      if (note.lane !== lane || note.scored) continue;
      const delta = Math.abs(note.hitTime - now);
      if (delta < bestDelta) { bestDelta = delta; best = note; }
    }
    if (!best) return 'empty';

    if (bestDelta <= WINDOW_PERFECT) {
      best.scored = 'perfect';
      this._flashNote(best.el, '#00e5ff');
      setTimeout(() => best.el.remove(), 80);
      return 'perfect';
    } else if (bestDelta <= WINDOW_GOOD) {
      best.scored = 'good';
      this._flashNote(best.el, '#ffe033');
      setTimeout(() => best.el.remove(), 80);
      return 'good';
    } else {
      return 'empty'; // too early/late – don't consume
    }
  },

  _flashNote(el, color) {
    el.style.background = color;
    el.style.opacity = '0';
  },

  _onMiss(lane) {
    // handled by HitDetector
    HitDetector.recordMiss(lane);
  },

  clear() {
    this.noteElements.forEach(n => n.el && n.el.remove());
    this.noteElements = [];
  }
};

// ─────────────────────────────────────────────────────
// ❾  HIT DETECTOR & SCORER
// ─────────────────────────────────────────────────────
const HitDetector = {
  active: false,

  setup() {
    this.active = true;
  },
  teardown() {
    this.active = false;
  },

  onKey(lane) {
    if (!this.active || State.paused) return;
    AudioEngine.playByLane(lane);
    Character.hit(lane);
    this._flashHitZone(lane);

    const now = performance.now() - State.levelStartTime;
    const result = NoteRenderer.tryHit(lane, now);

    if (result === 'perfect') {
      State.combo++;
      State.perfects++;
      const pts = 300 * Math.max(1, State.combo);
      State.score += pts;
      if (State.combo > State.maxCombo) State.maxCombo = State.combo;
      UIManager.showFeedback('PERFECT!', 'perfect');
    } else if (result === 'good') {
      State.combo++;
      State.goods++;
      const pts = 100 * Math.max(1, State.combo);
      State.score += pts;
      if (State.combo > State.maxCombo) State.maxCombo = State.combo;
      UIManager.showFeedback('GOOD', 'good');
    }
    // 'empty' = no note near — no penalty for pressing wrong time
    UIManager.updateHUD();
  },

  recordMiss(lane) {
    if (!this.active) return;
    State.combo = 0;
    State.misses++;
    State.hp = Math.max(0, State.hp - HP_MISS_PENALTY);
    AudioEngine.playMiss();
    UIManager.showFeedback('MISS', 'miss');
    UIManager.updateHUD();
    if (State.hp <= 0) GameManager.onGameOver();
  },

  _flashHitZone(lane) {
    const hz = document.getElementById('hz-' + lane);
    if (!hz) return;
    hz.classList.remove('flash');
    void hz.offsetWidth;
    hz.classList.add('flash');

    const lane_el = document.getElementById('lane-' + lane);
    if (lane_el) {
      lane_el.classList.remove('flash');
      void lane_el.offsetWidth;
      lane_el.classList.add('flash');
    }
  }
};

// ─────────────────────────────────────────────────────
// ❿  UI MANAGER
// ─────────────────────────────────────────────────────
const UIManager = {
  feedbackTimer: null,

  updateHUD() {
    document.getElementById('hudScore').textContent = State.score.toLocaleString();
    document.getElementById('hudCombo').textContent = '×' + State.combo;
    document.getElementById('hudLevel').textContent = State.level;
    document.getElementById('hudHp').textContent = State.hp;
    const fill = document.getElementById('hpBarFill');
    fill.style.width = State.hp + '%';
    if (State.hp > 60) fill.style.background = 'linear-gradient(90deg,#00ff88,#00e5ff)';
    else if (State.hp > 30) fill.style.background = 'linear-gradient(90deg,#ffe033,#ff8c00)';
    else fill.style.background = 'linear-gradient(90deg,#ff3b5c,#ff8c00)';
  },

  showFeedback(text, type) {
    const el = document.getElementById('hitFeedback');
    el.className = 'hit-feedback';
    el.textContent = text;
    void el.offsetWidth;
    el.classList.add('show', type);
    clearTimeout(this.feedbackTimer);
    this.feedbackTimer = setTimeout(() => { el.className = 'hit-feedback'; }, 560);
  },

  setLaneActive(laneIdx, active) {
    const el = document.getElementById('lane-' + laneIdx);
    if (el) el.classList.toggle('inactive', !active);
  },

  applyLevelLanes(config) {
    for (let i = 0; i < LANES; i++) {
      this.setLaneActive(i, i < config.activeLanes);
    }
  },

  showLevelSelect(lvl) {
    const cfg = getLevelConfig(lvl);
    document.getElementById('lsLevel').textContent = lvl;
    document.getElementById('lsDifficulty').textContent = 'Difficulty: ' + cfg.difficulty;
    document.getElementById('lsLanes').textContent = 'Active Lanes: ' + cfg.activeLanes + ' / 5';
    document.getElementById('lsBpm').textContent = 'BPM: ~' + cfg.bpm;
    document.getElementById('lsHighScore').textContent = 'Best Score: ' + (State.highScores[lvl] || 0).toLocaleString();
    document.getElementById('levelSlider').value = lvl;
  },

  buildLoadout() {
    const container = document.getElementById('loadoutUnlocks');
    container.innerHTML = '';
    UNLOCKS.forEach(u => {
      const earned = State.unlocksEarned.has(u.level);
      const div = document.createElement('div');
      div.className = 'unlock-entry' + (earned ? ' earned' : '');
      div.innerHTML = `
        <span class="ue-level">LVL ${u.level}</span>
        <span class="ue-icon">${u.icon}</span>
        <span class="ue-name">${u.name}</span>
        <span class="ue-badge">${earned ? '✓ OWNED' : '🔒 LOCKED'}</span>
      `;
      container.appendChild(div);
    });
    // No CSS unlock application needed — image-based character
  },

  showCompleteScreen(newUnlock) {
    document.getElementById('sbScore').textContent   = State.score.toLocaleString();
    document.getElementById('sbPerfect').textContent = State.perfects;
    document.getElementById('sbGood').textContent    = State.goods;
    document.getElementById('sbMiss').textContent    = State.misses;
    document.getElementById('sbCombo').textContent   = State.maxCombo;
    document.getElementById('sbBest').textContent    = (State.highScores[State.level] || 0).toLocaleString();

    const unlockBox = document.getElementById('unlockBox');
    if (newUnlock) {
      unlockBox.style.display = '';
      document.getElementById('unlockItemName').textContent = newUnlock.icon + ' ' + newUnlock.name;
      unlockBox.animate([{opacity:0,transform:'scale(.8)'},{opacity:1,transform:'scale(1)'}], {duration:500,easing:'ease-out'});
    } else {
      unlockBox.style.display = 'none';
    }
    Screens.show('complete');
  },

  showGameOver() {
    document.getElementById('goScore').textContent = State.score.toLocaleString();
    document.getElementById('goCombo').textContent = State.maxCombo;
    document.getElementById('goLevel').textContent = State.level;
    Screens.show('gameover');
  }
};

// ─────────────────────────────────────────────────────
// ⓫  GAME MANAGER
// ─────────────────────────────────────────────────────
const GameManager = {
  scheduledBeats: [],
  scheduleIdx:   0,

  startLevel(lvl) {
    State.level     = lvl;
    State.score     = 0;
    State.combo     = 0;
    State.maxCombo  = 0;
    State.hp        = HP_MAX;
    State.perfects  = 0;
    State.goods     = 0;
    State.misses    = 0;
    State.paused    = false;
    State.playing   = true;

    State.config    = getLevelConfig(lvl);

    AudioEngine.init();
    NoteRenderer.init();
    HitDetector.setup();
    UIManager.applyLevelLanes(State.config);
    UIManager.updateHUD();
    Character.refreshAll();

    // Generate beat pattern
    const duration = State.levelDuration;
    this.scheduledBeats = BeatGen.generate(State.config, duration);
    this.scheduleIdx = 0;

    State.levelStartTime = performance.now();

    Screens.show('game');

    // Start game loop
    if (State.gameRafId) cancelAnimationFrame(State.gameRafId);
    this._loop();
  },

  _loop() {
    if (!State.playing) return;
    if (!State.paused) {
      const now = performance.now() - State.levelStartTime;

      // Spawn scheduled notes
      while (this.scheduleIdx < this.scheduledBeats.length) {
        const beat = this.scheduledBeats[this.scheduleIdx];
        const timeToHit = beat.time - now;
        // Spawn early enough so note travels from top to hit zone
        const spawnAhead = 1600 + (1 - State.config.noteSpeed) * 200;
        if (timeToHit <= spawnAhead) {
          NoteRenderer.spawn(beat.lane, beat.time);
          this.scheduleIdx++;
        } else {
          break;
        }
      }

      NoteRenderer.update(now, State.config);

      // Level complete when all beats scheduled + notes cleared
      if (this.scheduleIdx >= this.scheduledBeats.length && NoteRenderer.noteElements.length === 0 && now > 2000) {
        this.onLevelComplete();
        return;
      }
    }
    State.gameRafId = requestAnimationFrame(() => this._loop());
  },

  onLevelComplete() {
    if (!State.playing) return;
    State.playing = false;
    HitDetector.teardown();
    NoteRenderer.clear();

    // Save high score
    if (!State.highScores[State.level] || State.score > State.highScores[State.level]) {
      State.highScores[State.level] = State.score;
    }
    save();

    // Unlock check
    let newUnlock = null;
    const unlockForThisLevel = UNLOCKS.find(u => u.level === State.level);
    if (unlockForThisLevel && !State.unlocksEarned.has(State.level)) {
      State.unlocksEarned.add(State.level);
      newUnlock = unlockForThisLevel;
      Character.refreshAll();
      save();
    }

    if (State.level > State.earnedLevels) State.earnedLevels = State.level;

    UIManager.showCompleteScreen(newUnlock);
  },

  onGameOver() {
    if (!State.playing) return;
    State.playing = false;
    HitDetector.teardown();
    NoteRenderer.clear();
    if (State.gameRafId) cancelAnimationFrame(State.gameRafId);
    save();
    setTimeout(() => UIManager.showGameOver(), 400);
  },

  pause() {
    State.paused = true;
    Screens.show('pause');
    // keep game screen visible behind
    document.getElementById('screen-game').classList.add('active');
  },

  resume() {
    State.paused = false;
    State.levelStartTime += performance.now() - (State.levelStartTime + (performance.now() - State.levelStartTime)); // keep time synced
    Screens.show('game');
    this._loop();
  }
};

// ─────────────────────────────────────────────────────
// ⓬  PERSISTENCE (localStorage)
// ─────────────────────────────────────────────────────
function save() {
  const data = {
    highScores:    State.highScores,
    earnedLevels:  State.earnedLevels,
    unlocksEarned: [...State.unlocksEarned],
  };
  try { localStorage.setItem('noob_drummer_save', JSON.stringify(data)); } catch(e) {}
}

function load() {
  try {
    const raw = localStorage.getItem('noob_drummer_save');
    if (!raw) return;
    const data = JSON.parse(raw);
    if (data.highScores)    State.highScores    = data.highScores;
    if (data.earnedLevels)  State.earnedLevels  = data.earnedLevels;
    if (data.unlocksEarned) State.unlocksEarned = new Set(data.unlocksEarned);
  } catch(e) {}
}

// ─────────────────────────────────────────────────────
// ⓭  KEYBOARD INPUT
// ─────────────────────────────────────────────────────
const keysDown = new Set();
document.addEventListener('keydown', e => {
  const key = e.key.toLowerCase();
  if (keysDown.has(key)) return; // prevent repeat
  keysDown.add(key);

  if (State.currentScreen === 'game') {
    const laneIdx = LANE_KEYS.indexOf(key);
    if (laneIdx >= 0) {
      e.preventDefault();
      HitDetector.onKey(laneIdx);
    }
    if (key === 'escape' || key === 'p') {
      e.preventDefault();
      if (State.paused) GameManager.resume();
      else GameManager.pause();
    }
  }

  if (State.currentScreen === 'pause' && (key === 'escape' || key === 'p')) {
    GameManager.resume();
  }
});

document.addEventListener('keyup', e => { keysDown.delete(e.key.toLowerCase()); });

// ─────────────────────────────────────────────────────
// ⓮  UI WIRING (event listeners)
// ─────────────────────────────────────────────────────
function wireButtons() {
  // Menu
  document.getElementById('btnPlay').onclick    = () => { Screens.show('levelselect'); UIManager.showLevelSelect(State.level); };
  document.getElementById('btnLoadout').onclick = () => { UIManager.buildLoadout(); Screens.show('loadout'); };
  document.getElementById('btnHowTo').onclick   = () => Screens.show('howto');

  // How To
  document.getElementById('btnHowToBack').onclick = () => Screens.show('menu');

  // Loadout
  document.getElementById('btnLoadoutBack').onclick = () => Screens.show('menu');

  // Level Select
  const slider = document.getElementById('levelSlider');
  slider.oninput = () => { UIManager.showLevelSelect(+slider.value); State.level = +slider.value; };
  document.getElementById('btnLvlDown').onclick = () => {
    const v = Math.max(1, +slider.value - 1); slider.value = v;
    UIManager.showLevelSelect(v); State.level = v;
  };
  document.getElementById('btnLvlUp').onclick = () => {
    const v = Math.min(100, +slider.value + 1); slider.value = v;
    UIManager.showLevelSelect(v); State.level = v;
  };
  document.getElementById('btnStartGame').onclick = () => GameManager.startLevel(State.level);
  document.getElementById('btnLSBack').onclick    = () => Screens.show('menu');

  // In-game
  document.getElementById('btnPause').onclick = () => GameManager.pause();

  // Pause
  document.getElementById('btnResume').onclick   = () => GameManager.resume();
  document.getElementById('btnQuitPause').onclick = () => { State.playing = false; HitDetector.teardown(); NoteRenderer.clear(); Screens.show('menu'); };

  // Level Complete
  document.getElementById('btnNextLevel').onclick = () => {
    const next = Math.min(100, State.level + 1);
    GameManager.startLevel(next);
  };
  document.getElementById('btnRetryComplete').onclick = () => GameManager.startLevel(State.level);
  document.getElementById('btnMenuComplete').onclick  = () => Screens.show('menu');

  // Game Over
  document.getElementById('btnRetryGO').onclick = () => GameManager.startLevel(State.level);
  document.getElementById('btnMenuGO').onclick  = () => Screens.show('menu');
}

// ─────────────────────────────────────────────────────
// ⓯  TOUCH / MOBILE ON-SCREEN BUTTONS (optional overlay)
// ─────────────────────────────────────────────────────
function addTouchZones() {
  // On mobile — tapping lane fires that key
  for (let i = 0; i < LANES; i++) {
    const laneEl = document.getElementById('lane-' + i);
    if (!laneEl) continue;
    laneEl.addEventListener('pointerdown', e => {
      e.preventDefault();
      if (State.currentScreen === 'game') HitDetector.onKey(i);
    });
  }
}

// ─────────────────────────────────────────────────────
// ⓰  INIT
// ─────────────────────────────────────────────────────
function init() {
  load();
  wireButtons();
  addTouchZones();
  Character.refreshAll();
  Screens.show('menu');
  console.log('%c🥁 NOOB DRUMMER initialised! Use A S D F SPACE to play.', 'color:#00e5ff;font-size:1.1em;');
}

window.addEventListener('DOMContentLoaded', init);
