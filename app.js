'use strict';

/* =========================================================
   Träning – en vy, en knapp.
   Två pass: AMRAP complex och Eget pass.
   All data sparas lokalt i telefonen (localStorage).
   Ingen nätverkstrafik, inga tredjepartsberoenden.
   ========================================================= */

const STORAGE_KEY = 'traning.config.v1';
const HISTORY_KEY = 'traning.history.v1';
const MAX_IMPORT_BYTES = 200_000;
const MAX_HISTORY = 300;
const REPS_STEP_ESTIMATE_S = 40; // för tidsuppskattning på startskärmen
const TAP_LOCK_MS = 800;          // skydd mot dubbeltryck
const HOLD_TO_QUIT_MS = 700;
const AMRAP_MINUTES = [15, 20, 30];

const LIMITS = { name: 40, items: 40, sets: 20, reps: 999, seconds: 3600, weight: 999, rest: 900, prep: 30, amrapReps: 100 };

const DEFAULT_CONFIG = {
  mode: 'amrap', // 'amrap' | 'custom'
  amrap: {
    minutes: 20,
    weight: 16,
    reps: 10,
    exercises: ['Bent over row', 'Goblet squat', 'Push ups (close grip på KB)', 'Curl', 'KB swing', 'Thruster'],
  },
  custom: {
    warmup: [
      { name: 'Hopprep', type: 'time', sets: 1, reps: 10, seconds: 180, weight: null, rest: 0 },
      { name: 'Armhävningar', type: 'reps', sets: 1, reps: 10, seconds: 30, weight: null, rest: 0 },
    ],
    exercises: [
      { name: 'Knäböj', type: 'reps', sets: 3, reps: 8, seconds: 30, weight: 60, rest: 90 },
      { name: 'Marklyft', type: 'reps', sets: 3, reps: 5, seconds: 30, weight: 80, rest: 120 },
      { name: 'Planka', type: 'time', sets: 3, reps: 10, seconds: 45, weight: null, rest: 60 },
    ],
    restBetween: 120,
  },
  prep: 5,
  sound: 'on', // 'on' | 'always' | 'off'
};

/* ---------- Validering (vid laddning och import) ---------- */

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function clampInt(v, min, max, fallback) {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
  if (v === null || v === '' || !Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function cleanWeight(v) {
  if (v === null || v === undefined || v === '') return null;
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(LIMITS.weight, Math.round(n * 4) / 4);
}

function cleanName(v) {
  return String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, LIMITS.name);
}

function cleanItem(raw) {
  const o = isObj(raw) ? raw : {};
  return {
    name: cleanName(o.name).trim() || 'Övning',
    type: o.type === 'time' ? 'time' : 'reps',
    sets: clampInt(o.sets, 1, LIMITS.sets, 1),
    reps: clampInt(o.reps, 1, LIMITS.reps, 10),
    seconds: clampInt(o.seconds, 1, LIMITS.seconds, 30),
    weight: cleanWeight(o.weight),
    rest: clampInt(o.rest, 0, LIMITS.rest, 60),
  };
}

function cleanAmrap(raw) {
  const o = isObj(raw) ? raw : DEFAULT_CONFIG.amrap;
  const names = Array.isArray(o.exercises) ? o.exercises : [];
  return {
    minutes: AMRAP_MINUTES.includes(Number(o.minutes)) ? Number(o.minutes) : 20,
    weight: cleanWeight(o.weight),
    reps: clampInt(o.reps, 1, LIMITS.amrapReps, 10),
    exercises: names.slice(0, LIMITS.items).map((n) => cleanName(n).trim()).filter(Boolean),
  };
}

function cleanCustom(raw) {
  const o = isObj(raw) ? raw : DEFAULT_CONFIG.custom;
  const list = (a) => (Array.isArray(a) ? a.slice(0, LIMITS.items).map(cleanItem) : []);
  return {
    warmup: list(o.warmup),
    exercises: list(o.exercises),
    restBetween: clampInt(o.restBetween, 0, LIMITS.rest, 120),
  };
}

function cleanConfig(raw) {
  const o = isObj(raw) ? raw : {};
  // Äldre version hade warmup/exercises direkt på toppnivå → flytta in under "custom".
  const legacy = !isObj(o.custom) && (Array.isArray(o.warmup) || Array.isArray(o.exercises));
  return {
    mode: o.mode === 'custom' ? 'custom' : 'amrap',
    amrap: cleanAmrap(o.amrap),
    custom: cleanCustom(legacy ? o : o.custom),
    prep: clampInt(o.prep, 0, LIMITS.prep, 5),
    sound: ['on', 'always', 'off'].includes(o.sound) ? o.sound : 'on',
  };
}

function cleanResult(o) {
  if (!isObj(o)) return null;
  const t = Date.parse(o.d);
  const min = Number(o.min);
  if (!Number.isFinite(t) || !AMRAP_MINUTES.includes(min)) return null;
  return {
    d: new Date(t).toISOString(),
    min,
    kg: cleanWeight(o.kg),
    r: clampInt(o.r, 0, 999, 0),
    x: clampInt(o.x, 0, 99, 0),
    n: clampInt(o.n, 1, 99, 6),
  };
}

const cleanHistory = (a) => (Array.isArray(a) ? a.slice(-MAX_HISTORY).map(cleanResult).filter(Boolean) : []);

/* ---------- Lagring ---------- */

function loadJSON(key) {
  try { const s = localStorage.getItem(key); return s ? JSON.parse(s) : undefined; } catch { return undefined; }
}
function saveJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* fullt/privat läge */ }
}

let config = (() => { const raw = loadJSON(STORAGE_KEY); return cleanConfig(raw === undefined ? DEFAULT_CONFIG : raw); })();
let history = cleanHistory(loadJSON(HISTORY_KEY));

const saveConfig = () => saveJSON(STORAGE_KEY, config);
const saveHistory = () => saveJSON(HISTORY_KEY, history);
const persist = saveConfig;

/* ---------- Hjälpare ---------- */

const $ = (id) => document.getElementById(id);
const now = () => performance.now();

function el(tag, props = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined) n.append(c);
  return n;
}

function fmtTime(totalSeconds) {
  const s = Math.max(0, Math.ceil(totalSeconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

const fmtNum = (n) => String(n).replace('.', ',');
const fmtKg = (kg) => (kg ? `${fmtNum(kg)} kg` : '');
const fmtDate = (iso) => new Date(iso).toLocaleDateString('sv-SE', { day: 'numeric', month: 'short' });
const displayName = (it) => it.name.trim() || 'Övning';
const joinDot = (...parts) => parts.filter(Boolean).join(' · ');

function fmtScore(res) {
  const r = `${res.r} ${res.r === 1 ? 'runda' : 'rundor'}`;
  return res.x > 0 ? `${r} + ${res.x}` : r;
}

/* ---------- AMRAP: resultat ---------- */

const better = (a, b) => !b || a.r > b.r || (a.r === b.r && a.x > b.x);

function bestFor(minutes) {
  return history.filter((h) => h.min === minutes).reduce((best, h) => (better(h, best) ? h : best), null);
}

const amrapNames = () => config.amrap.exercises.map((s) => s.trim()).filter(Boolean);

/* ---------- Eget pass: bygg en platt kö av steg ---------- */

function itemMeta(it) {
  const amount = it.type === 'time' ? fmtTime(it.seconds) : String(it.reps);
  let s = it.sets > 1 ? `${it.sets} × ${amount}` : amount;
  if (it.type === 'reps' && it.sets === 1) s += ' reps';
  if (it.weight) s += ` · ${fmtKg(it.weight)}`;
  return s;
}

function stepDescription(step) {
  return joinDot(step.title, step.mode === 'time' ? fmtTime(step.seconds) : `${step.reps} reps`, fmtKg(step.weight));
}

function buildQueue(custom, prep) {
  const items = [
    ...custom.warmup.map((it) => ({ ...it, warmup: true })),
    ...custom.exercises.map((it) => ({ ...it, warmup: false })),
  ];
  const steps = [];

  items.forEach((it, idx) => {
    const name = displayName(it);
    for (let s = 1; s <= it.sets; s++) {
      const setText = it.sets > 1 ? `Set ${s} av ${it.sets}` : '';
      const label = it.warmup ? joinDot('Uppvärmning', setText) : (setText || 'Övning');

      const prev = steps[steps.length - 1];
      if (it.type === 'time' && prep > 0 && (!prev || prev.kind !== 'rest')) {
        steps.push({ kind: 'prep', mode: 'time', label: 'Gör dig redo', title: name, seconds: prep });
      }

      steps.push({ kind: 'work', mode: it.type, label, title: name, reps: it.reps, seconds: it.seconds, weight: it.weight });

      const nextItem = items[idx + 1];
      let rest = 0;
      if (s < it.sets) rest = it.rest;
      else if (nextItem && !nextItem.warmup) rest = custom.restBetween; // ingen vila inom uppvärmningen
      if (rest > 0) steps.push({ kind: 'rest', mode: 'time', label: 'Vila', title: '', seconds: rest });
    }
  });

  steps.forEach((st, i) => {
    const after = steps.slice(i + 1).filter((x) => x.kind === 'work');
    const nxt = st.kind === 'prep' ? after[1] : after[0]; // under "gör dig redo" visas övningen redan
    st.next = nxt ? `Nästa: ${stepDescription(nxt)}` : 'Sista!';
  });
  return steps;
}

const estimateSeconds = (steps) => steps.reduce((sum, st) => sum + (st.mode === 'time' ? st.seconds : REPS_STEP_ESTIMATE_S), 0);

/* ---------- Ljud ---------- */

let audioCtx = null;

function setupAudio() {
  // 'playback' gör att pip hörs även med ljudlöst-knappen på, men kan pausa annan musik.
  try { if (navigator.audioSession) navigator.audioSession.type = config.sound === 'always' ? 'playback' : 'auto'; } catch { /* stöds ej */ }
  if (config.sound === 'off') return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    audioCtx = audioCtx || new Ctx();
    audioCtx.resume();
    const src = audioCtx.createBufferSource(); // tyst buffert låser upp ljud på iOS
    src.buffer = audioCtx.createBuffer(1, 1, 22050);
    src.connect(audioCtx.destination);
    src.start(0);
  } catch { audioCtx = null; }
}

function tone(freq, dur, delay = 0, vol = 0.9) {
  const t = audioCtx.currentTime + delay;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'triangle';
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(vol, t + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(t);
  osc.stop(t + dur + 0.05);
}

function beep(kind = 'short') {
  if (!audioCtx || config.sound === 'off') return;
  try {
    if (kind === 'short') tone(880, 0.12);
    else if (kind === 'long') tone(1320, 0.5);
    else if (kind === 'tick') tone(660, 0.05, 0, 0.35);           // bekräftar tryck
    else if (kind === 'round') { tone(990, 0.08, 0, 0.6); tone(1320, 0.12, 0.1, 0.6); } // ny runda
    else if (kind === 'warn') { tone(880, 0.15); tone(880, 0.15, 0.25); }            // 1 min kvar
  } catch { /* ignorera */ }
}

/* ---------- Håll skärmen vaken ---------- */

let wakeLock = null;

async function keepAwake() {
  try {
    if ('wakeLock' in navigator && document.visibilityState === 'visible' && !wakeLock) {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    }
  } catch { wakeLock = null; }
}

function allowSleep() {
  if (wakeLock) wakeLock.release().catch(() => {});
  wakeLock = null;
}

/* ---------- Vyer ---------- */

const views = ['home', 'run', 'done', 'settings'];
function show(name) {
  for (const v of views) $(`view-${v}`).hidden = v !== name;
  window.scrollTo(0, 0);
}

function renderHome() {
  if (config.mode === 'amrap') {
    const a = config.amrap;
    const ok = amrapNames().length > 0;
    const best = bestFor(a.minutes);
    $('start').disabled = !ok;
    $('home-summary').textContent = ok ? joinDot(`AMRAP ${a.minutes} min`, fmtKg(a.weight)) : 'Lägg till övningar via kugghjulet';
    $('home-record').textContent = ok && best ? `Rekord: ${fmtScore(best)}` : '';
  } else {
    const steps = buildQueue(config.custom, config.prep);
    const work = steps.filter((s) => s.kind === 'work').length;
    const n = config.custom.warmup.length + config.custom.exercises.length;
    $('start').disabled = work === 0;
    $('home-summary').textContent = work === 0
      ? 'Lägg till övningar via kugghjulet'
      : `${n} övningar · ca ${Math.max(1, Math.round(estimateSeconds(steps) / 60))} min`;
    $('home-record').textContent = '';
  }
}

/* ---------- Gemensamt för båda passtyperna ---------- */

let run = null;
let ticker = null;

function beginRun(state) {
  setupAudio();
  keepAwake();
  run = state;
  show('run');
  clearInterval(ticker);
  ticker = setInterval(() => (run && run.type === 'amrap' ? amrapTick() : customTick()), 100);
}

function showFigure(name) {
  const on = Figures.play(Figures.match(name));
  $('view-run').classList.toggle('has-figure', on);
}

function stopRun() {
  Figures.stop();
  clearInterval(ticker);
  ticker = null;
  allowSleep();
}

function quitWorkout() {
  stopRun();
  run = null;
  renderHome();
  show('home');
}

function showDone({ score = '', summary = '', badge = '' }) {
  $('done-score').textContent = score;
  $('done-score').hidden = !score;
  $('done-summary').textContent = summary;
  $('done-badge').textContent = badge;
  $('done-badge').hidden = !badge;
  beep('long');
  show('done');
}

function startWorkout() {
  if (config.mode === 'amrap') startAmrap();
  else startCustom();
}

function onStageTap() {
  if (!run || now() < run.lockUntil) return;
  if (run.type === 'amrap') amrapNext();
  else customTap();
}

function onSkip() {
  if (!run || now() < run.lockUntil) return;
  if (run.type === 'amrap') {
    if (run.phase === 'prep') amrapBeginWork();
    else amrapNext();
  } else enterStep(run.i + 1);
}

function onBack() {
  if (!run) return;
  if (run.type === 'amrap') amrapBack();
  else customBack();
}

/* ---------- AMRAP ---------- */

function startAmrap() {
  const names = amrapNames();
  if (!names.length) return;
  const a = config.amrap;
  beginRun({
    type: 'amrap', names, reps: a.reps, weight: a.weight, minutes: a.minutes,
    totalMs: a.minutes * 60_000, phase: 'prep', endAt: now() + config.prep * 1000,
    ex: 0, round: 0, lockUntil: 0, lastBeep: null, shownSec: null, warned: false,
    best: bestFor(a.minutes),
  });
  if (config.prep <= 0) amrapBeginWork();
  else renderAmrap();
}

function amrapBeginWork() {
  run.phase = 'work';
  run.endAt = now() + run.totalMs;
  run.lastBeep = null;
  run.lockUntil = now() + TAP_LOCK_MS;
  renderAmrap();
}

function amrapNext() {
  if (run.phase !== 'work') return;
  run.ex += 1;
  if (run.ex >= run.names.length) { run.ex = 0; run.round += 1; beep('round'); } else beep('tick');
  run.lockUntil = now() + TAP_LOCK_MS;
  renderAmrap();
}

function amrapBack() {
  if (run.phase !== 'work') return;
  if (run.ex > 0) run.ex -= 1;
  else if (run.round > 0) { run.round -= 1; run.ex = run.names.length - 1; }
  renderAmrap();
}

function renderAmrap() {
  const v = $('view-run');
  const prep = run.phase === 'prep';
  const n = run.names.length;
  v.dataset.kind = prep ? 'prep' : 'amrap';
  v.classList.remove('paused');

  $('run-count').textContent = run.best ? `Rekord ${fmtScore(run.best)}` : `AMRAP ${run.minutes} min`;
  $('run-title').hidden = false;
  if (prep) {
    $('run-label').textContent = 'Gör dig redo';
    $('run-title').textContent = `AMRAP ${run.minutes} min`;
    $('run-sub').textContent = joinDot(`${run.reps} reps`, fmtKg(run.weight));
    $('run-next').textContent = `Först: ${run.names[0]}`;
    $('run-hint').textContent = '';
  } else {
    $('run-label').textContent = `Runda ${run.round + 1} · ${run.ex + 1}/${n}`;
    $('run-title').textContent = run.names[run.ex];
    $('run-sub').textContent = joinDot(`${run.reps} reps`, fmtKg(run.weight));
    $('run-next').textContent = `Nästa: ${run.names[(run.ex + 1) % n]}`;
    $('run-hint').textContent = run.round === 0 && run.ex === 0 ? 'Tryck när du är klar' : '';
  }
  $('run-back').classList.toggle('invisible', prep || (run.round === 0 && run.ex === 0));
  showFigure(prep ? run.names[0] : run.names[run.ex]);
  run.shownSec = null;
  renderAmrapClock();
}

function renderAmrapClock() {
  const rem = Math.max(0, run.endAt - now());
  const sec = Math.ceil(rem / 1000);
  if (sec === run.shownSec) return;
  run.shownSec = sec;
  $('run-value').textContent = fmtTime(sec);
  const work = run.phase === 'work';
  $('run-progress').style.width = work ? `${(1 - rem / run.totalMs) * 100}%` : '0%';
  $('view-run').classList.toggle('final', work && rem <= 60_000);
}

function amrapTick() {
  const rem = run.endAt - now();
  const sec = Math.ceil(rem / 1000);
  if (run.phase === 'work' && !run.warned && rem <= 60_000 && run.totalMs > 60_000) { run.warned = true; beep('warn'); }
  if (sec <= 3 && sec >= 1 && sec !== run.lastBeep) { run.lastBeep = sec; beep('short'); }
  if (rem <= 0) {
    if (run.phase === 'prep') { beep('long'); amrapBeginWork(); } else finishAmrap();
    return;
  }
  renderAmrapClock();
}

function finishAmrap() {
  const result = { d: new Date().toISOString(), min: run.minutes, kg: run.weight, r: run.round, x: run.ex, n: run.names.length };
  const prevBest = run.best;
  history.push(result);
  if (history.length > MAX_HISTORY) history = history.slice(-MAX_HISTORY);
  saveHistory();
  stopRun();
  run = null;
  let badge = '';
  if (!prevBest) badge = 'Första resultatet på den här tiden';
  else if (better(result, prevBest)) badge = 'Nytt rekord!';
  else badge = `Rekord: ${fmtScore(prevBest)}`;
  showDone({ score: fmtScore(result), summary: joinDot(`AMRAP ${result.min} min`, fmtKg(result.kg)), badge });
}

/* ---------- Eget pass ---------- */

function startCustom() {
  const steps = buildQueue(config.custom, config.prep);
  if (!steps.some((s) => s.kind === 'work')) return;
  beginRun({ type: 'custom', steps, i: 0, endAt: 0, remainingMs: 0, paused: false, lockUntil: 0, lastBeep: null, startedAt: Date.now() });
  enterStep(0);
}

function enterStep(i) {
  if (!run) return;
  if (i >= run.steps.length) return finishCustom();
  run.i = Math.max(0, i);
  const st = run.steps[run.i];
  run.paused = false;
  run.lastBeep = null;
  run.lockUntil = now() + TAP_LOCK_MS;
  if (st.mode === 'time') {
    run.remainingMs = st.seconds * 1000;
    run.endAt = now() + run.remainingMs;
  }
  renderStep();
}

function renderStep() {
  const st = run.steps[run.i];
  const view = $('view-run');
  view.dataset.kind = st.kind;
  view.classList.toggle('paused', run.paused);
  view.classList.remove('final');

  const workTotal = run.steps.filter((s) => s.kind === 'work').length;
  let pos = run.steps.slice(0, run.i + 1).filter((s) => s.kind === 'work').length;
  if (st.kind !== 'work') pos += 1; // under vila: visa numret på det som kommer
  $('run-count').textContent = `${Math.min(pos, workTotal)} / ${workTotal}`;
  $('run-progress').style.width = `${(run.i / run.steps.length) * 100}%`;

  $('run-label').textContent = st.label;
  $('run-title').textContent = st.title;
  $('run-title').hidden = st.kind === 'rest';
  $('run-sub').textContent = st.kind === 'work' ? fmtKg(st.weight) : '';
  $('run-next').textContent = st.next;
  $('run-back').classList.toggle('invisible', run.i === 0);
  showFigure(st.kind === 'rest' ? null : st.title);
  renderValue();
}

function renderValue() {
  const st = run.steps[run.i];
  if (st.mode === 'time') {
    $('run-value').textContent = fmtTime(run.remainingMs / 1000);
    $('run-hint').textContent = run.paused ? 'Pausad – tryck för att fortsätta' : '';
  } else {
    $('run-value').replaceChildren(String(st.reps), el('small', { text: 'reps' }));
    $('run-hint').textContent = 'Tryck när du är klar';
  }
}

function customTick() {
  const st = run.steps[run.i];
  if (st.mode !== 'time' || run.paused) return;
  const prevSec = Math.ceil(run.remainingMs / 1000);
  run.remainingMs = Math.max(0, run.endAt - now());
  const sec = Math.ceil(run.remainingMs / 1000);
  if (sec <= 3 && sec >= 1 && sec !== run.lastBeep) { run.lastBeep = sec; beep('short'); }
  if (run.remainingMs <= 0) { beep('long'); enterStep(run.i + 1); return; }
  if (sec !== prevSec) renderValue();
}

function customTap() {
  const st = run.steps[run.i];
  if (st.mode === 'reps') { enterStep(run.i + 1); return; }
  // tidssteg: tryck = paus / fortsätt
  if (run.paused) {
    run.paused = false;
    run.endAt = now() + run.remainingMs;
  } else {
    run.paused = true;
    run.remainingMs = Math.max(0, run.endAt - now());
  }
  $('view-run').classList.toggle('paused', run.paused);
  renderValue();
}

function customBack() {
  if (run.i === 0) return;
  let j = run.i - 1;
  while (j > 0 && run.steps[j].kind === 'prep') j--;
  enterStep(j);
}

function finishCustom() {
  const minutes = Math.max(1, Math.round((Date.now() - run.startedAt) / 60000));
  const sets = run.steps.filter((s) => s.kind === 'work').length;
  stopRun();
  run = null;
  showDone({ summary: `${minutes} min · ${sets} set` });
}

/* Avsluta kräver att man håller inne X – så man inte råkar avbryta. */
function setupHoldToQuit() {
  const btn = $('run-quit');
  let timer = null;
  const cancel = () => { clearTimeout(timer); timer = null; btn.classList.remove('holding'); };
  btn.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    btn.classList.add('holding');
    timer = setTimeout(() => { cancel(); quitWorkout(); }, HOLD_TO_QUIT_MS);
  });
  btn.addEventListener('pointerup', () => {
    if (timer && run) $('run-hint').textContent = 'Håll inne ✕ för att avsluta';
    cancel();
  });
  btn.addEventListener('pointerleave', cancel);
  btn.addEventListener('pointercancel', cancel);
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && run) {
    keepAwake();
    if (audioCtx) audioCtx.resume().catch(() => {});
  }
});

/* ---------- Inställningar: byggstenar ---------- */

function textField(label, get, set) {
  const input = el('input', { type: 'text', value: get(), maxlength: LIMITS.name, autocomplete: 'off', enterkeyhint: 'done' });
  input.addEventListener('input', () => { set(cleanName(input.value)); persist(); });
  return el('label', { class: 'field' }, el('span', { text: label }), input);
}

function numField(label, get, set, { min, max, decimal = false, optional = false }) {
  const input = el('input', {
    type: 'text',
    inputmode: decimal ? 'decimal' : 'numeric',
    value: get() === null ? '' : fmtNum(get()),
    placeholder: optional ? '–' : null,
    autocomplete: 'off',
    enterkeyhint: 'done',
  });
  const parse = () => {
    const raw = input.value.trim();
    if (raw === '') return optional ? null : undefined;
    return decimal ? cleanWeight(raw) : clampInt(raw, min, max, undefined);
  };
  input.addEventListener('input', () => {
    const v = parse();
    if (v !== undefined) { set(v); persist(); }
  });
  input.addEventListener('change', () => {
    const v = get();
    input.value = v === null ? '' : fmtNum(v);
  });
  return el('label', { class: 'field' }, el('span', { text: label }), input);
}

function segmented(options, get, set) {
  const wrap = el('div', { class: 'seg', role: 'group' });
  for (const [value, text] of options) {
    wrap.append(el('button', {
      type: 'button', text, 'aria-pressed': String(get() === value),
      onclick: (e) => {
        set(value); persist();
        for (const b of wrap.children) b.setAttribute('aria-pressed', String(b === e.currentTarget));
      },
    }));
  }
  return wrap;
}

/* ---------- Inställningar: flikar och aktivt pass ---------- */

let settingsTab = config.mode;

function renderTabs() {
  for (const b of $('tabs').children) b.setAttribute('aria-selected', String(b.dataset.tab === settingsTab));
  $('panel-amrap').hidden = settingsTab !== 'amrap';
  $('panel-custom').hidden = settingsTab !== 'custom';
  for (const b of document.querySelectorAll('.active-btn')) {
    const active = b.dataset.mode === config.mode;
    b.classList.toggle('active', active);
    b.textContent = active ? '✓ Körs när du trycker Starta' : 'Kör det här passet';
  }
}

/* ---------- Inställningar: AMRAP ---------- */

function renderAmrapSettings() {
  const a = config.amrap;
  $('amrap-settings').replaceChildren(
    el('div', { class: 'field' },
      el('span', { text: 'Tid' }),
      segmented(AMRAP_MINUTES.map((m) => [m, `${m} min`]), () => a.minutes, (v) => { a.minutes = v; renderAmrapHistory(); }),
    ),
    el('div', { class: 'grid-2' },
      numField('Vikt kettlebell (kg)', () => a.weight, (v) => { a.weight = v; }, { decimal: true, optional: true }),
      numField('Reps per övning', () => a.reps, (v) => { a.reps = v; }, { min: 1, max: LIMITS.amrapReps }),
    ),
  );
}

function renderAmrapList() {
  const list = config.amrap.exercises;
  $('amrap-list').replaceChildren(...(list.length ? list.map((name, i) => {
    const input = el('input', { type: 'text', value: name, maxlength: LIMITS.name, autocomplete: 'off', enterkeyhint: 'done', 'aria-label': `Övning ${i + 1}` });
    input.addEventListener('input', () => { list[i] = cleanName(input.value); persist(); });
    return el('div', { class: 'name-row' },
      el('span', { class: 'name-num', text: String(i + 1) }),
      input,
      el('button', { type: 'button', class: 'mini-btn', text: '↑', 'aria-label': 'Flytta upp', disabled: i === 0,
        onclick: () => { [list[i - 1], list[i]] = [list[i], list[i - 1]]; persist(); renderAmrapList(); } }),
      el('button', { type: 'button', class: 'mini-btn del', text: '✕', 'aria-label': 'Ta bort',
        onclick: () => { if (!name.trim() || confirm(`Ta bort ${name.trim()}?`)) { list.splice(i, 1); persist(); renderAmrapList(); } } }),
    );
  }) : [el('p', { class: 'empty', text: 'Inga övningar än.' })]));
}

function addAmrapExercise() {
  if (config.amrap.exercises.length >= LIMITS.items) return;
  config.amrap.exercises.push('');
  persist();
  renderAmrapList();
  $('amrap-list').lastElementChild?.querySelector('input')?.focus();
}

function histRow(left, right) {
  return el('div', { class: 'hist-row' }, el('span', { text: left }), el('span', { text: right }));
}

function renderAmrapHistory() {
  const box = $('amrap-history');
  if (!history.length) {
    box.replaceChildren(el('p', { class: 'empty', text: 'Inga resultat än. Kör ett pass!' }));
    return;
  }
  const records = AMRAP_MINUTES.map((m) => {
    const b = bestFor(m);
    return histRow(`${m} min`, b ? joinDot(fmtScore(b), fmtKg(b.kg), fmtDate(b.d)) : '–');
  });
  const recent = history.slice(-5).reverse().map((h) => histRow(joinDot(fmtDate(h.d), `${h.min} min`), joinDot(fmtScore(h), fmtKg(h.kg))));
  box.replaceChildren(
    el('h3', { text: 'Rekord' }), ...records,
    el('h3', { text: 'Senaste' }), ...recent,
    el('button', { type: 'button', class: 'link-btn', text: 'Rensa resultat', onclick: () => {
      if (!confirm('Radera alla sparade resultat?')) return;
      history = [];
      saveHistory();
      renderAmrapHistory();
    } }),
  );
}

/* ---------- Inställningar: Eget pass ---------- */

const openItems = new WeakSet();
const listEl = (listKey) => $(listKey === 'warmup' ? 'list-warmup' : 'list-exercises');

function renderItem(listKey, it, index, list) {
  const nameEl = el('span', { class: 'item-name', text: displayName(it) });
  const metaEl = el('span', { class: 'item-meta', text: itemMeta(it) });
  const refreshSummary = () => { nameEl.textContent = displayName(it); metaEl.textContent = itemMeta(it); };

  const body = el('div', { class: 'item-body' });
  const details = el('details', { class: 'item' }, el('summary', {}, nameEl, metaEl), body);
  details.open = openItems.has(it);
  details.addEventListener('toggle', () => (details.open ? openItems.add(it) : openItems.delete(it)));

  const upd = (key) => (v) => { it[key] = v; refreshSummary(); };

  const buildBody = () => {
    const amountField = it.type === 'time'
      ? numField('Tid (sek)', () => it.seconds, upd('seconds'), { min: 1, max: LIMITS.seconds })
      : numField('Reps', () => it.reps, upd('reps'), { min: 1, max: LIMITS.reps });

    body.replaceChildren(
      textField('Namn', () => it.name, upd('name')),
      segmented([['reps', 'Reps'], ['time', 'Tid']], () => it.type, (v) => { it.type = v; refreshSummary(); buildBody(); }),
      el('div', { class: 'grid-2' },
        numField('Set', () => it.sets, upd('sets'), { min: 1, max: LIMITS.sets }),
        amountField,
        numField('Vikt (kg)', () => it.weight, upd('weight'), { decimal: true, optional: true }),
        numField('Vila mellan set (sek)', () => it.rest, upd('rest'), { min: 0, max: LIMITS.rest }),
      ),
      el('div', { class: 'item-actions' },
        el('button', { type: 'button', text: '↑', 'aria-label': 'Flytta upp', disabled: index === 0, onclick: () => move(listKey, index, -1) }),
        el('button', { type: 'button', text: '↓', 'aria-label': 'Flytta ner', disabled: index === list.length - 1, onclick: () => move(listKey, index, 1) }),
        el('button', { type: 'button', class: 'del', text: 'Ta bort', onclick: () => removeItem(listKey, index) }),
      ),
    );
  };
  buildBody();
  return details;
}

function renderList(listKey) {
  const list = config.custom[listKey];
  listEl(listKey).replaceChildren(
    ...(list.length ? list.map((it, i) => renderItem(listKey, it, i, list)) : [el('p', { class: 'empty', text: 'Inget här än.' })]),
  );
}

function move(listKey, index, dir) {
  const list = config.custom[listKey];
  const j = index + dir;
  if (j < 0 || j >= list.length) return;
  [list[index], list[j]] = [list[j], list[index]];
  persist();
  renderList(listKey);
}

function removeItem(listKey, index) {
  const it = config.custom[listKey][index];
  if (!confirm(`Ta bort ${displayName(it)}?`)) return;
  config.custom[listKey].splice(index, 1);
  persist();
  renderList(listKey);
}

function addItem(listKey) {
  const list = config.custom[listKey];
  if (list.length >= LIMITS.items) return;
  const it = cleanItem({ type: 'reps', sets: listKey === 'warmup' ? 1 : 3, reps: 10, rest: 90 });
  it.name = '';
  list.push(it);
  openItems.add(it);
  persist();
  renderList(listKey);
  listEl(listKey).lastElementChild?.querySelector('input')?.focus();
}

/* ---------- Inställningar: allmänt ---------- */

function renderGeneral() {
  $('custom-general').replaceChildren(
    numField('Vila mellan övningar (sek)', () => config.custom.restBetween, (v) => { config.custom.restBetween = v; }, { min: 0, max: LIMITS.rest }),
  );
  $('general').replaceChildren(
    numField('Nedräkning före start / tidsövning (sek)', () => config.prep, (v) => { config.prep = v; }, { min: 0, max: LIMITS.prep }),
    el('div', { class: 'field' },
      el('span', { text: 'Pip' }),
      segmented([['on', 'På'], ['always', 'Även ljudlöst'], ['off', 'Av']], () => config.sound, (v) => { config.sound = v; }),
    ),
  );
}

function renderSettings() {
  renderTabs();
  renderAmrapSettings();
  renderAmrapList();
  renderAmrapHistory();
  renderList('warmup');
  renderList('exercises');
  renderGeneral();
}

/* ---------- Backup ---------- */

async function exportData() {
  const json = JSON.stringify({ app: 'traning', version: 2, config, history }, null, 2);
  const filename = `traning-${new Date().toISOString().slice(0, 10)}.json`;
  const file = new File([json], filename, { type: 'application/json' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      await navigator.share({ files: [file], title: 'Träning – backup' });
      return;
    }
  } catch (e) {
    if (e && e.name === 'AbortError') return;
  }
  const url = URL.createObjectURL(file);
  const a = el('a', { href: url, download: filename });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function importData(file) {
  if (!file) return;
  if (file.size > MAX_IMPORT_BYTES) { alert('Filen är för stor.'); return; }
  try {
    const data = JSON.parse(await file.text());
    const hasWrapper = isObj(data) && isObj(data.config);
    const next = cleanConfig(hasWrapper ? data.config : data);
    const nextHistory = hasWrapper && Array.isArray(data.history) ? cleanHistory(data.history) : null;
    const empty = !next.amrap.exercises.length && !next.custom.warmup.length && !next.custom.exercises.length;
    if (empty) { alert('Hittade inga övningar i filen.'); return; }
    if (!confirm(nextHistory ? 'Ersätta pass och resultat med filens innehåll?' : 'Ersätta passen med filens innehåll?')) return;
    config = next;
    saveConfig();
    if (nextHistory) { history = nextHistory; saveHistory(); }
    settingsTab = config.mode;
    renderSettings();
  } catch {
    alert('Kunde inte läsa filen.');
  }
}

/* ---------- Start ---------- */

function init() {
  Figures.mount($('run-figure'));
  $('start').addEventListener('click', startWorkout);
  $('open-settings').addEventListener('click', () => { settingsTab = config.mode; renderSettings(); show('settings'); });
  $('close-settings').addEventListener('click', () => { saveConfig(); renderHome(); show('home'); });
  $('done-close').addEventListener('click', () => { renderHome(); show('home'); });

  $('run-stage').addEventListener('click', onStageTap);
  $('run-skip').addEventListener('click', onSkip);
  $('run-back').addEventListener('click', onBack);
  setupHoldToQuit();

  for (const b of $('tabs').children) b.addEventListener('click', () => { settingsTab = b.dataset.tab; renderTabs(); });
  for (const b of document.querySelectorAll('.active-btn')) {
    b.addEventListener('click', () => { config.mode = b.dataset.mode; persist(); renderTabs(); });
  }
  for (const b of document.querySelectorAll('[data-add]')) b.addEventListener('click', () => addItem(b.dataset.add));
  $('amrap-add').addEventListener('click', addAmrapExercise);

  $('export').addEventListener('click', exportData);
  $('import').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', (e) => {
    importData(e.target.files[0]);
    e.target.value = '';
  });

  renderHome();
  show('home');

  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).catch(() => {});
  }
}

document.addEventListener('DOMContentLoaded', init);
