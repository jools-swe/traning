'use strict';

/* =========================================================
   Träning – en vy, en knapp.
   All data sparas lokalt i telefonen (localStorage).
   Ingen nätverkstrafik, inga tredjepartsberoenden.
   ========================================================= */

const STORAGE_KEY = 'traning.config.v1';
const MAX_IMPORT_BYTES = 100_000;
const REPS_STEP_ESTIMATE_S = 40; // för tidsuppskattning på startskärmen
const TAP_LOCK_MS = 800;          // skydd mot dubbeltryck vid stegbyte
const HOLD_TO_QUIT_MS = 700;

const LIMITS = { name: 40, items: 40, sets: 20, reps: 999, seconds: 3600, weight: 999, rest: 900, prep: 30 };

const DEFAULT_CONFIG = {
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
  prep: 5,
  sound: 'on', // 'on' | 'always' | 'off'
};

/* ---------- Validering (används vid laddning och import) ---------- */

function clampInt(v, min, max, fallback) {
  const n = typeof v === 'string' ? Number(v.replace(',', '.')) : Number(v);
  if (!Number.isFinite(n)) return fallback;
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
  const o = raw && typeof raw === 'object' ? raw : {};
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

function cleanConfig(raw) {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {};
  const list = (a) => (Array.isArray(a) ? a.slice(0, LIMITS.items).map(cleanItem) : []);
  return {
    warmup: list(o.warmup),
    exercises: list(o.exercises),
    restBetween: clampInt(o.restBetween, 0, LIMITS.rest, 120),
    prep: clampInt(o.prep, 0, LIMITS.prep, 5),
    sound: ['on', 'always', 'off'].includes(o.sound) ? o.sound : 'on',
  };
}

/* ---------- Lagring ---------- */

function loadConfig() {
  try {
    const s = localStorage.getItem(STORAGE_KEY);
    if (s) return cleanConfig(JSON.parse(s));
  } catch { /* trasig data → standard */ }
  return cleanConfig(DEFAULT_CONFIG);
}

function saveConfig() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(config)); } catch { /* fullt/privat läge */ }
}

let config = loadConfig();

/* ---------- Hjälpare ---------- */

const $ = (id) => document.getElementById(id);

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
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

const fmtNum = (n) => String(n).replace('.', ',');
const displayName = (it) => it.name.trim() || 'Övning';

function itemMeta(it) {
  const amount = it.type === 'time' ? fmtTime(it.seconds) : String(it.reps);
  let s = it.sets > 1 ? `${it.sets} × ${amount}` : amount;
  if (it.type === 'reps' && it.sets === 1) s += ' reps';
  if (it.weight) s += ` · ${fmtNum(it.weight)} kg`;
  return s;
}

function stepDescription(step) {
  if (step.kind === 'rest') return `Vila ${fmtTime(step.seconds)}`;
  let s = step.title + ' · ' + (step.mode === 'time' ? fmtTime(step.seconds) : `${step.reps} reps`);
  if (step.weight) s += ` · ${fmtNum(step.weight)} kg`;
  return s;
}

/* ---------- Bygg passet till en platt kö av steg ---------- */

function buildQueue(cfg) {
  const items = [
    ...cfg.warmup.map((it) => ({ ...it, warmup: true })),
    ...cfg.exercises.map((it) => ({ ...it, warmup: false })),
  ];
  const steps = [];

  items.forEach((it, idx) => {
    const name = displayName(it);
    for (let s = 1; s <= it.sets; s++) {
      const setText = it.sets > 1 ? `Set ${s} av ${it.sets}` : '';
      const label = it.warmup ? ['Uppvärmning', setText].filter(Boolean).join(' · ') : (setText || 'Övning');

      const prev = steps[steps.length - 1];
      if (it.type === 'time' && cfg.prep > 0 && (!prev || prev.kind !== 'rest')) {
        steps.push({ kind: 'prep', mode: 'time', label: 'Gör dig redo', title: name, seconds: cfg.prep });
      }

      steps.push({
        kind: 'work', mode: it.type, label, title: name,
        reps: it.reps, seconds: it.seconds, weight: it.weight,
      });

      const lastSet = s === it.sets;
      const nextItem = items[idx + 1];
      let rest = 0;
      if (!lastSet) rest = it.rest;
      else if (nextItem && !nextItem.warmup) rest = cfg.restBetween; // ingen vila inom uppvärmningen
      if (rest > 0) steps.push({ kind: 'rest', mode: 'time', label: 'Vila', title: '', seconds: rest });
    }
  });

  // "Nästa:"-text för varje steg
  steps.forEach((st, i) => {
    const after = steps.slice(i + 1).filter((x) => x.kind === 'work');
    const nxt = st.kind === 'prep' ? after[1] : after[0]; // under "gör dig redo" visas övningen redan
    st.next = nxt ? stepDescription(nxt) : 'Sista!';
  });
  return steps;
}

function estimateSeconds(steps) {
  return steps.reduce((sum, st) => sum + (st.mode === 'time' ? st.seconds : REPS_STEP_ESTIMATE_S), 0);
}

/* ---------- Ljud ---------- */

let audioCtx = null;

function setupAudio() {
  // 'playback' gör att pip hörs även med ljudlöst-knappen på, men kan pausa annan musik.
  try {
    if (navigator.audioSession) navigator.audioSession.type = config.sound === 'always' ? 'playback' : 'auto';
  } catch { /* stöds ej */ }
  if (config.sound === 'off') return;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    audioCtx = audioCtx || new Ctx();
    audioCtx.resume();
    // tyst buffert låser upp ljud på iOS (måste ske i ett tryck)
    const src = audioCtx.createBufferSource();
    src.buffer = audioCtx.createBuffer(1, 1, 22050);
    src.connect(audioCtx.destination);
    src.start(0);
  } catch { audioCtx = null; }
}

function beep(long = false) {
  if (!audioCtx || config.sound === 'off') return;
  try {
    const t = audioCtx.currentTime;
    const dur = long ? 0.5 : 0.12;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.value = long ? 1320 : 880;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.9, t + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.05);
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
  const steps = buildQueue(config);
  const work = steps.filter((s) => s.kind === 'work').length;
  const n = config.warmup.length + config.exercises.length;
  $('start').disabled = work === 0;
  $('home-summary').textContent = work === 0
    ? 'Lägg till övningar via kugghjulet'
    : `${n} övningar · ca ${Math.max(1, Math.round(estimateSeconds(steps) / 60))} min`;
}

/* ---------- Kör passet ---------- */

let run = null;
let ticker = null;

function startWorkout() {
  const steps = buildQueue(config);
  if (!steps.some((s) => s.kind === 'work')) return;
  setupAudio();
  keepAwake();
  run = { steps, i: 0, endAt: 0, remainingMs: 0, paused: false, lockUntil: 0, lastBeep: null, startedAt: Date.now() };
  show('run');
  enterStep(0);
  clearInterval(ticker);
  ticker = setInterval(tick, 100);
}

function enterStep(i) {
  if (!run) return;
  if (i >= run.steps.length) return finishWorkout();
  run.i = Math.max(0, i);
  const st = run.steps[run.i];
  run.paused = false;
  run.lastBeep = null;
  run.lockUntil = performance.now() + TAP_LOCK_MS;
  if (st.mode === 'time') {
    run.remainingMs = st.seconds * 1000;
    run.endAt = performance.now() + run.remainingMs;
  }
  renderStep();
}

function renderStep() {
  const st = run.steps[run.i];
  const view = $('view-run');
  view.dataset.kind = st.kind;
  view.classList.toggle('paused', run.paused);

  const workTotal = run.steps.filter((s) => s.kind === 'work').length;
  let pos = run.steps.slice(0, run.i + 1).filter((s) => s.kind === 'work').length;
  if (st.kind !== 'work') pos += 1; // under vila: visa numret på det som kommer
  $('run-count').textContent = `${Math.min(pos, workTotal)} / ${workTotal}`;
  $('run-progress').style.width = `${(run.i / run.steps.length) * 100}%`;

  $('run-label').textContent = st.label;
  $('run-title').textContent = st.kind === 'rest' ? '' : st.title;
  $('run-title').hidden = st.kind === 'rest';
  $('run-sub').textContent = st.kind === 'work' && st.weight ? `${fmtNum(st.weight)} kg` : '';
  $('run-next').textContent = st.next === 'Sista!' ? 'Sista!' : `Nästa: ${st.next}`;
  $('run-back').classList.toggle('invisible', run.i === 0);

  renderValue();
}

function renderValue() {
  const st = run.steps[run.i];
  const value = $('run-value');
  if (st.mode === 'time') {
    value.textContent = fmtTime(run.remainingMs / 1000);
    $('run-hint').textContent = run.paused ? 'Pausad – tryck för att fortsätta' : '';
  } else {
    value.replaceChildren(String(st.reps), el('small', { text: 'reps' }));
    $('run-hint').textContent = 'Tryck när du är klar';
  }
}

function tick() {
  if (!run) return;
  const st = run.steps[run.i];
  if (st.mode !== 'time' || run.paused) return;
  const prevSec = Math.ceil(run.remainingMs / 1000);
  run.remainingMs = Math.max(0, run.endAt - performance.now());
  const sec = Math.ceil(run.remainingMs / 1000);

  if (sec <= 3 && sec >= 1 && sec !== run.lastBeep) { run.lastBeep = sec; beep(false); }
  if (run.remainingMs <= 0) { beep(true); enterStep(run.i + 1); return; }
  if (sec !== prevSec) renderValue();
}

function onStageTap() {
  if (!run || performance.now() < run.lockUntil) return;
  const st = run.steps[run.i];
  if (st.mode === 'reps') { enterStep(run.i + 1); return; }
  // tidssteg: tryck = paus / fortsätt
  if (run.paused) {
    run.paused = false;
    run.endAt = performance.now() + run.remainingMs;
  } else {
    run.paused = true;
    run.remainingMs = Math.max(0, run.endAt - performance.now());
  }
  $('view-run').classList.toggle('paused', run.paused);
  renderValue();
}

function skipStep() {
  if (!run || performance.now() < run.lockUntil) return;
  enterStep(run.i + 1);
}

function backStep() {
  if (!run || run.i === 0) return;
  let j = run.i - 1;
  while (j > 0 && run.steps[j].kind === 'prep') j--;
  enterStep(j);
}

function stopRun() {
  clearInterval(ticker);
  ticker = null;
  allowSleep();
}

function finishWorkout() {
  const minutes = Math.max(1, Math.round((Date.now() - run.startedAt) / 60000));
  const sets = run.steps.filter((s) => s.kind === 'work').length;
  stopRun();
  run = null;
  $('done-summary').textContent = `${minutes} min · ${sets} set`;
  beep(true);
  show('done');
}

function quitWorkout() {
  stopRun();
  run = null;
  renderHome();
  show('home');
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
    tick();
  }
});

/* ---------- Inställningar ---------- */

const openItems = new WeakSet();

function persist() { saveConfig(); }

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
  const list = config[listKey];
  const container = $(listKey === 'warmup' ? 'list-warmup' : 'list-exercises');
  container.replaceChildren(
    ...(list.length ? list.map((it, i) => renderItem(listKey, it, i, list)) : [el('p', { class: 'empty', text: 'Inget här än.' })]),
  );
}

function renderGeneral() {
  $('general').replaceChildren(
    el('div', { class: 'grid-2' },
      numField('Vila mellan övningar (sek)', () => config.restBetween, (v) => { config.restBetween = v; }, { min: 0, max: LIMITS.rest }),
      numField('Nedräkning före tidsövning (sek)', () => config.prep, (v) => { config.prep = v; }, { min: 0, max: LIMITS.prep }),
    ),
    el('div', { class: 'field' },
      el('span', { text: 'Pip' }),
      segmented([['on', 'På'], ['always', 'Även ljudlöst'], ['off', 'Av']], () => config.sound, (v) => { config.sound = v; }),
    ),
  );
}

function renderSettings() {
  renderList('warmup');
  renderList('exercises');
  renderGeneral();
}

function move(listKey, index, dir) {
  const list = config[listKey];
  const j = index + dir;
  if (j < 0 || j >= list.length) return;
  [list[index], list[j]] = [list[j], list[index]];
  persist();
  renderList(listKey);
}

function removeItem(listKey, index) {
  const it = config[listKey][index];
  if (!confirm(`Ta bort ${displayName(it)}?`)) return;
  config[listKey].splice(index, 1);
  persist();
  renderList(listKey);
}

function addItem(listKey) {
  if (config[listKey].length >= LIMITS.items) return;
  const it = cleanItem({ name: '', type: 'reps', sets: listKey === 'warmup' ? 1 : 3, reps: 10, rest: 90 });
  it.name = '';
  config[listKey].push(it);
  openItems.add(it);
  persist();
  renderList(listKey);
  const container = $(listKey === 'warmup' ? 'list-warmup' : 'list-exercises');
  const input = container.lastElementChild?.querySelector('input');
  if (input) input.focus();
}

/* ---------- Backup ---------- */

async function exportConfig() {
  const json = JSON.stringify(config, null, 2);
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

async function importConfig(file) {
  if (!file) return;
  if (file.size > MAX_IMPORT_BYTES) { alert('Filen är för stor.'); return; }
  try {
    const data = JSON.parse(await file.text());
    const next = cleanConfig(data);
    if (!next.warmup.length && !next.exercises.length) { alert('Hittade inga övningar i filen.'); return; }
    if (!confirm('Ersätta nuvarande pass med filens innehåll?')) return;
    config = next;
    saveConfig();
    renderSettings();
  } catch {
    alert('Kunde inte läsa filen.');
  }
}

/* ---------- Start ---------- */

function init() {
  $('start').addEventListener('click', startWorkout);
  $('open-settings').addEventListener('click', () => { renderSettings(); show('settings'); });
  $('close-settings').addEventListener('click', () => { saveConfig(); renderHome(); show('home'); });
  $('done-close').addEventListener('click', () => { renderHome(); show('home'); });

  $('run-stage').addEventListener('click', onStageTap);
  $('run-skip').addEventListener('click', skipStep);
  $('run-back').addEventListener('click', backStep);
  setupHoldToQuit();

  for (const btn of document.querySelectorAll('[data-add]')) {
    btn.addEventListener('click', () => addItem(btn.dataset.add));
  }
  $('export').addEventListener('click', exportConfig);
  $('import').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', (e) => {
    importConfig(e.target.files[0]);
    e.target.value = '';
  });

  renderHome();
  show('home');

  // Be iOS att inte rensa lagrad data
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js', { updateViaCache: 'none' }).catch(() => {});
  }
}

document.addEventListener('DOMContentLoaded', init);
