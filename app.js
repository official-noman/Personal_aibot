/* ============================================================
   Persona — personal companion PWA
   Offline: sob data phone-er localStorage e.
   ============================================================ */
'use strict';

/* ---------- storage ---------- */
const DB = {
  get(k, f) { try { const v = localStorage.getItem('shathi.' + k); return v ? JSON.parse(v) : f; } catch (e) { return f; } },
  /* quota bhorle localStorage throw kore — silent na rekhe user ke janai */
  set(k, v) {
    try { localStorage.setItem('shathi.' + k, JSON.stringify(v)); return true; }
    catch (e) {
      console.error('[persona] storage e lekha gelo na', k, e);
      if (typeof toast === 'function') toast('Phone er storage bhore geche — purono data muche dekho');
      return false;
    }
  },
};

let tasks       = DB.get('tasks', []);
let sleeps      = DB.get('sleeps', []);
let activeSleep = DB.get('activeSleep', null);      // { start: iso } | null
let checkins    = DB.get('checkins', []);
let notes       = DB.get('notes', []);
let sheetRows   = DB.get('sheetRows', []);
let pins        = DB.get('pins', []);               // { id, cat, title, text, wake, ts }
let clItems     = DB.get('clItems', defaultChecklist());
let clLog       = DB.get('clLog', {});              // { 'YYYY-MM-DD': [itemId] }
let uiTheme     = DB.get('theme', 'dark');

const save = {
  tasks: () => DB.set('tasks', tasks),
  sleeps: () => DB.set('sleeps', sleeps),
  active: () => DB.set('activeSleep', activeSleep),
  checkins: () => DB.set('checkins', checkins),
  notes: () => DB.set('notes', notes),
  sheetRows: () => DB.set('sheetRows', sheetRows),
  pins: () => DB.set('pins', pins),
  clItems: () => DB.set('clItems', clItems),
  clLog: () => DB.set('clLog', clLog),
};

function defaultChecklist() {
  return [
    { id: 'c_namaz', label: 'Namaz porechi', emoji: '🙏' },
    { id: 'c_water', label: 'Pani kheyechi', emoji: '💧' },
    { id: 'c_exercise', label: 'Exercise korechi', emoji: '🏃' },
    { id: 'c_read', label: 'Boi porechi', emoji: '📖' },
  ];
}

/* ---------- utils ---------- */
const $  = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
const dayKey = (d = new Date()) => d.toLocaleDateString('en-CA');
const esc = (s) => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function linkify(text) {
  return esc(text).replace(/(https?:\/\/[^\s]+)/g, url => `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);
}

function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.classList.remove('hidden');
  clearTimeout(toast._t); toast._t = setTimeout(() => t.classList.add('hidden'), 2200);
}
function bytesToBase64Url(bytes) {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
function base64UrlToBytes(str) {
  const b64 = String(str || '').replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(str.length / 4) * 4, '=');
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}
function encodeBackupLinkData(data) {
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(data)));
}
function decodeBackupLinkData(str) {
  return JSON.parse(new TextDecoder().decode(base64UrlToBytes(str)));
}
function fmtDue(iso) {
  return new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
}
function fmtClock(iso) {
  return new Date(iso).toLocaleString('en-GB', { weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
}
function hoursBetween(a, b) { return (b - a) / 3600000; }
function humanDur(hrs) {
  const h = Math.floor(hrs), m = Math.round((hrs - h) * 60);
  return `${h} ghonta ${m} min`;
}

/* ============================================================
   NAVIGATION
   ============================================================ */
const TITLES = { home: 'Aaj', tasks: 'Kaj', sleep: 'Ghum', checklist: 'Checklist', checkin: 'Check-in', notes: 'Notes', sheet: 'Sheet', helpdesk: 'AI Help Desk', pins: 'Uthe ja dekhbo' };
const EYEBROWS = { home: 'Persona', tasks: 'Ki korte hobe', sleep: 'Bishram', checklist: 'Aajker obhyash', checkin: 'Nijer shathe', notes: 'Mone rakho', sheet: 'Date-time log', helpdesk: 'Guide & commands', pins: 'Ghum theke uthe' };
let currentView = 'home';
let viewStack = [];

function navTo(view, opts = {}) {
  if (view === 'more') { openSheet(); return; }
  closeSheet();
  if (!opts.replace && view !== currentView) viewStack.push(currentView);
  currentView = view;
  $$('.view').forEach(v => v.classList.toggle('hidden', v.dataset.view !== view));
  $$('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.nav === view));
  $('#viewTitle').textContent = TITLES[view] || 'Persona';
  $('#viewEyebrow').textContent = EYEBROWS[view] || 'Persona';
  window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  updateTopActions();
  render(view);
}
function goBack() {
  const prev = viewStack.pop();
  if (prev) navTo(prev, { replace: true });
  else navTo('home', { replace: true });
}
function updateTopActions() {
  $('#backBtn').disabled = currentView === 'home' && !viewStack.length;
  $('#homeBtn').disabled = currentView === 'home';
}
function render(view) {
  ({ home: renderHome, tasks: renderTasks, sleep: renderSleep, checklist: renderChecklist,
     checkin: renderCheckin, notes: renderNotes, sheet: renderSheet, helpdesk: renderHelpDesk, pins: renderPins }[view] || (() => {}))();
}
$$('.nav-btn').forEach(b => b.onclick = () => navTo(b.dataset.nav));
$('#backBtn').onclick = goBack;
$('#homeBtn').onclick = () => { viewStack = []; navTo('home', { replace: true }); };
document.addEventListener('click', e => {
  const g = e.target.closest('[data-goto]');
  if (g) navTo(g.dataset.goto);
});

/* more sheet */
function openSheet() { $('#moreSheet').classList.remove('hidden'); }
function closeSheet() { $('#moreSheet').classList.add('hidden'); }
$$('[data-close="more"]').forEach(el => el.onclick = closeSheet);

function closeOverlays() {
  ['#moreSheet', '#alarmSheet', '#chatPanel', '#sleepMode', '#wakeMode', '#alarmMode'].forEach(s => {
    const el = $(s);
    if (el) el.classList.add('hidden');
  });
  if (typeof chatOpen !== 'undefined') {
    chatOpen = false;
    const head = $('#chatHead');
    if (head) head.classList.remove('hidden');
  }
  if (typeof stopRinging === 'function') stopRinging();
}
function overlayBack() {
  closeOverlays();
  updateTopActions();
}
function overlayHome() {
  closeOverlays();
  viewStack = [];
  navTo('home', { replace: true });
}
$$('[data-overlay-back]').forEach(b => b.onclick = overlayBack);
$$('[data-overlay-home]').forEach(b => b.onclick = overlayHome);

function applyTheme() {
  document.body.classList.toggle('light', uiTheme === 'light');
  const b = $('#themeToggleBtn');
  if (b) {
    b.querySelector('span').textContent = uiTheme === 'light' ? '🌙' : '☀️';
    b.querySelector('b').textContent = uiTheme === 'light' ? 'Dark mode' : 'Light mode';
    b.querySelector('small').textContent = uiTheme === 'light' ? 'Rater jonno dark UI' : 'Diner jonno white UI';
  }
}
function toggleTheme() {
  uiTheme = uiTheme === 'light' ? 'dark' : 'light';
  DB.set('theme', uiTheme);
  applyTheme();
}

/* ============================================================
   HOME
   ============================================================ */
function greetingText() {
  const h = new Date().getHours();
  if (h < 5) return 'Onek raat holo';
  if (h < 12) return 'Shubho shokal';
  if (h < 17) return 'Shubho dupur';
  if (h < 20) return 'Shubho shondha';
  return 'Shubho raat';
}
function renderHome() {
  const today = dayKey();
  $('#greeting').innerHTML = `<b>${greetingText()}!</b> Ei-to tomar din.`;

  // sleep hero
  const hero = $('#sleepHero');
  if (activeSleep) {
    hero.classList.add('awake');
    $('#sleepHeroLabel').textContent = 'Ghumacche';
    $('#sleepHeroMain').textContent = 'Uthe gechi?';
    $('#sleepHeroSub').textContent = 'Tap kore ghum shesh koro';
    $('#sleepHeroCta').textContent = '☀️';
  } else {
    hero.classList.remove('awake');
    const last = [...sleeps].sort((a, b) => b.date.localeCompare(a.date))[0];
    $('#sleepHeroLabel').textContent = 'Ghumer shomoy?';
    $('#sleepHeroMain').textContent = 'Ghumate jao';
    $('#sleepHeroSub').textContent = last ? `Kal ghumiyecho ${last.hours}h` : 'Tap kore raat shuru koro';
    $('#sleepHeroCta').textContent = '🌙';
  }

  // stats
  const activeToday = tasks.filter(t => !t.done && (!t.due || dayKey(new Date(t.due)) <= today));
  $('#statTasksLeft').textContent = activeToday.length;
  const doneToday = (clLog[today] || []).length;
  $('#statChecklist').textContent = `${doneToday}/${clItems.length}`;
  const lastSleep = [...sleeps].sort((a, b) => b.date.localeCompare(a.date))[0];
  $('#statSleep').textContent = lastSleep ? lastSleep.hours + 'h' : '–';

  // data summary hint
  const doneTasks = tasks.filter(t => t.done);
  const oldDone = doneTasks.filter(t => t.created && (Date.now() - t.created) > 30 * 24 * 3600 * 1000);
  const summaryEl = $('#homeDataSummary');
  if (summaryEl) {
    const total = tasks.length + notes.length + sheetRows.length + pins.length;
    let hint = `📦 ${total} total data — ${tasks.filter(t=>!t.done).length} active task, ${notes.length} note, ${sheetRows.length} sheet entry`;
    if (oldDone.length >= 5) hint += ` · <span style="color:var(--amber)">${oldDone.length}ta purono done task ache — <b data-act="cleandone" style="cursor:pointer;text-decoration:underline">clean koro</b></span>`;
    summaryEl.innerHTML = hint;
    summaryEl.querySelector('[data-act="cleandone"]')?.addEventListener('click', () => {
      if (!confirm(`${oldDone.length}ta 30 diner beshi purono done task delete korben?`)) return;
      tasks = tasks.filter(t => !oldDone.find(o => o.id === t.id));
      save.tasks(); renderHome(); toast(`${oldDone.length}ta purono task clean holo 🧹`);
    });
  }

  // check-in prompt
  const h = new Date().getHours();
  const kind = h < 12 ? 'morning' : (h >= 18 ? 'evening' : null);
  const p = $('#checkinPrompt');
  if (kind && !checkins.some(c => c.date === today && c.kind === kind)) {
    $('#checkinPromptText').textContent = kind === 'morning' ? 'Shokaler check-in baki' : 'Rater check-in baki';
    p.classList.remove('hidden');
    $('#checkinPromptBtn').onclick = () => navTo('checkin');
  } else p.classList.add('hidden');

  // today tasks
  const box = $('#homeTasks');
  const list = activeToday.slice(0, 5);
  if (!list.length) box.innerHTML = `<div class="empty">Aaj kono kaj baki nei 🎉</div>`;
  else { box.innerHTML = list.map(taskItemHTML).join(''); wireTasks(box); }

  // checklist chips
  renderHomeChecklist();
}
function renderHomeChecklist() {
  const wrap = $('#homeChecklist');
  const today = dayKey();
  const done = new Set(clLog[today] || []);
  if (!clItems.length) { wrap.innerHTML = `<div class="chip-empty">Kono option nei — Checklist e giye add koro.</div>`; return; }
  wrap.innerHTML = clItems.map(it =>
    `<button class="chip ${done.has(it.id) ? 'on' : ''}" data-cl="${it.id}">${it.emoji || '•'} ${esc(it.label)}</button>`).join('');
  $$('#homeChecklist .chip').forEach(c => c.onclick = () => { toggleChecklist(c.dataset.cl); renderHomeChecklist(); refreshStat(); });
}
function refreshStat() {
  const today = dayKey();
  $('#statChecklist').textContent = `${(clLog[today] || []).length}/${clItems.length}`;
}

$('#sleepHero').onclick = () => { if (activeSleep) openWake(); else startSleep(); };

/* ============================================================
   TASKS
   ============================================================ */
let taskFilter = 'active';
function taskItemHTML(t) {
  let badge = '';
  if (t.due) {
    const over = !t.done && new Date(t.due) < new Date();
    badge = `<span class="badge ${over ? 'overdue' : 'due'}">⏰ ${esc(fmtDue(t.due))}</span>`;
  }
  return `<div class="item ${t.done ? 'done' : ''}" data-id="${t.id}">
    <div class="check ${t.done ? 'on' : ''}" data-act="toggle">${t.done ? '✓' : ''}</div>
    <div class="item-body"><div class="item-title">${esc(t.title)}</div>${badge ? `<div class="item-meta">${badge}</div>` : ''}</div>
    <button class="del" data-act="del">🗑</button></div>`;
}
function wireTasks(root) {
  $$('.item', root).forEach(el => {
    const id = el.dataset.id;
    el.querySelector('[data-act="toggle"]').onclick = () => toggleTask(id);
    const d = el.querySelector('[data-act="del"]'); if (d) d.onclick = () => delTask(id);
  });
}
function renderTasks() {
  const box = $('#taskList');
  let list = tasks;
  if (taskFilter === 'active') list = tasks.filter(t => !t.done);
  if (taskFilter === 'done') list = tasks.filter(t => t.done);
  list = [...list].sort((a, b) => {
    if (!!a.due !== !!b.due) return a.due ? -1 : 1;
    if (a.due && b.due) return a.due.localeCompare(b.due);
    return b.created - a.created;
  });
  box.innerHTML = list.length ? list.map(taskItemHTML).join('') : `<div class="empty">Ekhane kono kaj nei.</div>`;
  wireTasks(box);
}
function addTask(title, due) {
  tasks.push({ id: uid(), title: title.trim(), due: due || null, done: false, notified: false, created: Date.now() });
  save.tasks(); toast('Kaj add holo'); render(currentView); checkDueTasks();
}
function toggleTask(id) { const t = tasks.find(x => x.id === id); if (!t) return; t.done = !t.done; if (t.done) t.notified = true; save.tasks(); render(currentView); }
function delTask(id) { 
  if (!confirm('Kaj ti delete korben?')) return;
  tasks = tasks.filter(x => x.id !== id); save.tasks(); render(currentView); toast('Kaj muche gelo'); 
}
$('#taskForm').onsubmit = e => {
  e.preventDefault();
  const title = $('#taskTitle').value, time = $('#taskTime').value;
  if (!title.trim()) return;
  addTask(title, time ? new Date(time).toISOString() : null);
  e.target.reset();
};
$$('#taskFilter .seg-btn').forEach(b => b.onclick = () => {
  taskFilter = b.dataset.filter;
  $$('#taskFilter .seg-btn').forEach(x => x.classList.toggle('active', x === b));
  renderTasks();
});

/* ============================================================
   SLEEP
   ============================================================ */
let smTick = null;

function startSleep() {
  activeSleep = { start: new Date().toISOString() };
  save.active();
  openSleepMode();
  toast('Shundor ghum hok 🌙');
}
function openSleepMode() {
  if (!activeSleep) return;
  $('#smStart').textContent = 'Shuru: ' + fmtClock(activeSleep.start);
  makeStars();
  $('#sleepMode').classList.remove('hidden');
  tickSleep();
  clearInterval(smTick);
  smTick = setInterval(tickSleep, 1000);
}
function tickSleep() {
  if (!activeSleep) return;
  const ms = Date.now() - new Date(activeSleep.start).getTime();
  const s = Math.max(0, Math.floor(ms / 1000));
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  $('#smTimer').textContent = `${hh}:${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}
function makeStars() {
  const box = $('#stars');
  if (box.childElementCount) return;
  let html = '';
  for (let i = 0; i < 40; i++) {
    html += `<i style="left:${Math.random() * 100}%;top:${Math.random() * 100}%;animation-delay:${(Math.random() * 3).toFixed(1)}s"></i>`;
  }
  box.innerHTML = html;
}
$('#sleepStartBtn').onclick = () => { if (activeSleep) openSleepMode(); else startSleep(); };
$('#cancelSleepBtn').onclick = () => {
  activeSleep = null; save.active(); clearInterval(smTick);
  $('#sleepMode').classList.add('hidden');
  toast('Ghum batil'); render(currentView);
};
$('#wakeBtn').onclick = () => { $('#sleepMode').classList.add('hidden'); clearInterval(smTick); openWake(); };

function openWake() {
  if (!activeSleep) return;
  const start = new Date(activeSleep.start).getTime();
  const end = Date.now();
  const hrs = Math.round(hoursBetween(start, end) * 100) / 100;

  // auto-save (dedupe by wake date)
  const date = dayKey();
  sleeps = sleeps.filter(s => s.date !== date);
  sleeps.push({ id: uid(), date, hours: hrs, note: '', start: activeSleep.start, end: new Date(end).toISOString() });
  save.sleeps();
  activeSleep = null; save.active();

  $('#wakeSlept').textContent = `Tumi ghumiyecho ${humanDur(hrs)} · auto-save holo ✅`;

  // wake cards = pinned items
  const cards = pins.filter(p => p.wake);
  const wc = $('#wakeCards');
  if (cards.length) {
    wc.innerHTML = cards.map((p, i) => `
      <div class="wake-card" style="animation-delay:${.1 + i * .08}s">
        <div class="pin-cat-tag">${esc(catLabel(p.cat))}</div>
        ${p.title ? `<div class="wake-card-title">${esc(p.title)}</div>` : ''}
        <div class="wake-card-text">${linkify(p.text)}</div>
      </div>`).join('');
  } else {
    wc.innerHTML = `<div class="wake-card"><div class="wake-card-text">Uthe dekhar jonno kichu pin korona.<br>"Uthe ja dekhbo" theke dua / niyom add koro.</div></div>`;
  }
  $('#wakeMode').classList.remove('hidden');
}
$('#startDayBtn').onclick = () => { $('#wakeMode').classList.add('hidden'); navTo('home'); toast('Shundor ekta din katuk ☀️'); };

function renderSleep() {
  $('#sleepStartBtn').querySelector('.big-sleep-text').textContent = activeSleep ? 'Ghum cholche…' : 'Ghumate jachhi';
  $('#sleepStartBtn').querySelector('.big-sleep-sub').textContent = activeSleep ? 'Tap kore timer dekho' : 'Count-up timer shuru hobe';
  $('#sleepDate').value = $('#sleepDate').value || dayKey();

  const sorted = [...sleeps].sort((a, b) => b.date.localeCompare(a.date));
  const last7 = sorted.slice(0, 7);
  const avg = last7.length ? last7.reduce((s, x) => s + x.hours, 0) / last7.length : null;
  $('#sleepAvg').textContent = avg != null ? avg.toFixed(1) + 'h' : '–';
  $('#sleepLast').textContent = sorted[0] ? sorted[0].hours + 'h' : '–';

  // chart
  const byDate = Object.fromEntries(sleeps.map(s => [s.date, s.hours]));
  const days = [];
  for (let i = 6; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); days.push({ key: dayKey(d), label: d.toLocaleDateString('en', { weekday: 'short' })[0] }); }
  const maxH = Math.max(9, ...days.map(d => byDate[d.key] || 0));
  $('#sleepChart').innerHTML = days.map(d => {
    const h = byDate[d.key];
    const pct = h ? Math.max(5, (h / maxH) * 100) : 3;
    return `<div class="bar-wrap"><span class="bar-val">${h != null ? h : ''}</span><div class="bar ${h == null ? 'empty-bar' : ''}" style="height:${pct}%"></div><span class="bar-label">${d.label}</span></div>`;
  }).join('');

  // pin preview
  const pv = $('#sleepPinPreview');
  const wc = pins.filter(p => p.wake);
  pv.innerHTML = wc.length
    ? wc.slice(0, 4).map(p => `<div class="item"><div class="item-body"><div class="pin-cat-tag">${esc(catLabel(p.cat))}</div><div class="item-title">${esc(p.title || p.text)}</div></div></div>`).join('')
    : `<div class="empty">Kichu pin korle uthe dekhabo. <b data-goto="pins" style="color:var(--a-blue)">Add koro →</b></div>`;

  // history
  const box = $('#sleepList');
  box.innerHTML = sorted.length ? sorted.slice(0, 30).map(s => `
    <div class="item" data-id="${s.id}"><div class="item-body">
      <div class="item-title">${s.hours} ghonta ${moonRating(s.hours)}</div>
      <div class="item-meta">${esc(new Date(s.date).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' }))}${s.note ? ' · ' + esc(s.note) : ''}</div>
    </div><button class="del" data-act="del">🗑</button></div>`).join('') : `<div class="empty">Ekhono kono ghum log korona.</div>`;
  $$('#sleepList .item').forEach(el => el.querySelector('[data-act="del"]').onclick = () => {
    if (!confirm('Ei ghum log ti delete korben?')) return;
    sleeps = sleeps.filter(x => x.id !== el.dataset.id); save.sleeps(); renderSleep(); toast('Muche gelo');
  });
}
function moonRating(h) { if (h >= 7 && h <= 9) return '😴 dhap'; if (h < 5) return '😟 kom'; if (h < 7) return '😐 aro dorkar'; return '🙂 beshi'; }
$('#sleepManualForm').onsubmit = e => {
  e.preventDefault();
  const hours = parseFloat($('#sleepHours').value), date = $('#sleepDate').value || dayKey();
  if (isNaN(hours)) return;
  sleeps = sleeps.filter(s => s.date !== date);
  sleeps.push({ id: uid(), date, hours, note: '' });
  save.sleeps(); e.target.reset(); toast('Ghum log holo'); renderSleep();
};

/* ============================================================
   CHECKLIST
   ============================================================ */
const CL_EMOJIS = ['✅', '🙏', '💧', '🏃', '📖', '💪', '🧹', '📞', '💊', '🍎', '🌅', '📝', '🧘', '☀️', '💻', '🛒'];
let clEmoji = '✅';
let clManageOpen = false;

function toggleChecklist(id) {
  const today = dayKey();
  const arr = clLog[today] || [];
  clLog[today] = arr.includes(id) ? arr.filter(x => x !== id) : [...arr, id];
  save.clLog();
}
function renderChecklist() {
  const today = dayKey();
  const done = new Set(clLog[today] || []);
  $('#checklistDate').textContent = new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

  const total = clItems.length, dc = clItems.filter(it => done.has(it.id)).length;
  const pct = total ? Math.round(dc / total * 100) : 0;
  $('#ringPct').textContent = pct + '%';
  $('#ringCount').textContent = `${dc}/${total}`;
  $('#ringFg').style.strokeDashoffset = 327 - (327 * pct / 100);
  $('#checklistMsg').textContent = total === 0 ? 'Option add kore shuru koro'
    : pct === 100 ? 'Shob shesh! darun 🎉' : pct === 0 ? 'Aajker kaj shuru koro' : `Cholche — ${total - dc}ta baki`;

  // rows
  const box = $('#checklistItems');
  box.innerHTML = clItems.length ? clItems.map(it => `
    <div class="cl-row ${done.has(it.id) ? 'on' : ''}" data-cl="${it.id}">
      <span class="cl-emoji">${it.emoji || '•'}</span>
      <span class="cl-label">${esc(it.label)}</span>
      <span class="cl-check">${done.has(it.id) ? '✓' : ''}</span>
    </div>`).join('') : `<div class="empty">Kono option nei. "Option manage" theke tomar moto add koro.</div>`;
  $$('#checklistItems .cl-row').forEach(r => r.onclick = () => { toggleChecklist(r.dataset.cl); renderChecklist(); });

  renderClManage();
  renderClHistory();
}
function renderClManage() {
  $('#checklistManage').classList.toggle('hidden', !clManageOpen);
  if (!clManageOpen) return;
  const pick = $('#clEmojiPick');
  pick.innerHTML = CL_EMOJIS.map(e => `<button type="button" class="emoji-opt ${e === clEmoji ? 'sel' : ''}" data-e="${e}">${e}</button>`).join('');
  $$('#clEmojiPick .emoji-opt').forEach(b => b.onclick = () => { clEmoji = b.dataset.e; renderClManage(); });
  const ml = $('#checklistManageList');
  ml.innerHTML = clItems.length ? clItems.map(it => `<span class="chip del-chip" data-del="${it.id}">${it.emoji || '•'} ${esc(it.label)}</span>`).join('')
    : `<div class="chip-empty">Ekhono kono option nei.</div>`;
  $$('#checklistManageList .del-chip').forEach(c => c.onclick = () => {
    if (!confirm('Ei option ti checklist theke delete korben?')) return;
    clItems = clItems.filter(x => x.id !== c.dataset.del);
    save.clItems(); renderChecklist(); toast('Option baad');
  });
}
function renderClHistory() {
  const strip = $('#checklistHistory');
  const total = clItems.length;
  let html = '';
  for (let i = 6; i >= 0; i--) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const key = dayKey(d), n = (clLog[key] || []).length;
    const cls = total && n >= total ? 'full' : n > 0 ? 'some' : '';
    html += `<div class="wk-day"><div class="wk-dot ${cls}">${n || ''}</div><div class="wk-label">${d.toLocaleDateString('en', { weekday: 'short' })[0]}</div></div>`;
  }
  strip.innerHTML = html;
}
$('#manageChecklistBtn').onclick = () => { clManageOpen = !clManageOpen; renderClManage(); };
$('#clAddBtn').onclick = () => {
  const label = $('#clNewLabel').value.trim();
  if (!label) return;
  clItems.push({ id: uid(), label, emoji: clEmoji });
  save.clItems(); $('#clNewLabel').value = ''; renderChecklist(); toast('Option add holo');
};
$('#clNewLabel').addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); $('#clAddBtn').click(); } });

/* ============================================================
   CHECK-IN
   ============================================================ */
const CHECKIN_Q = {
  morning: [
    { id: 'mood', type: 'mood', label: 'Mejaj kemon?' },
    { id: 'focus', type: 'text', label: 'Aaj shobcheye important kaj ki?', ph: 'Ekta kaj lekho…' },
    { id: 'grateful', type: 'text', label: 'Ki niye bhalo lagche?', ph: 'Optional…' },
  ],
  evening: [
    { id: 'mood', type: 'mood', label: 'Din shesh e mejaj kemon?' },
    { id: 'done', type: 'text', label: 'Aaj ki korle?', ph: 'Ja korle lekho…' },
    { id: 'improve', type: 'text', label: 'Kal ki better korte chao?', ph: 'Optional…' },
  ],
};
const MOODS = ['😫', '😕', '😐', '🙂', '😄'];
let checkinKind = 'morning', selMood = null;
function renderCheckin() {
  const h = new Date().getHours();
  checkinKind = h < 14 ? 'morning' : 'evening'; selMood = null;
  $('#checkinKindLabel').textContent = checkinKind === 'morning' ? '🌅 Shokaler check-in' : '🌙 Rater check-in';
  $('#checkinQuestions').innerHTML = CHECKIN_Q[checkinKind].map(q =>
    q.type === 'mood'
      ? `<div class="q-block"><div class="q-label">${q.label}</div><div class="mood-row" id="moodRow">${MOODS.map((m, i) => `<div class="mood" data-mood="${i}">${m}</div>`).join('')}</div></div>`
      : `<div class="q-block"><div class="q-label">${q.label}</div><input type="text" data-q="${q.id}" placeholder="${esc(q.ph || '')}" autocomplete="off" /></div>`
  ).join('');
  $$('#moodRow .mood').forEach(m => m.onclick = () => { selMood = +m.dataset.mood; $$('#moodRow .mood').forEach(x => x.classList.toggle('sel', x === m)); });

  const box = $('#checkinList');
  const sorted = [...checkins].sort((a, b) => b.ts - a.ts);
  box.innerHTML = sorted.length ? sorted.slice(0, 20).map(c => {
    const fields = Object.entries(c.answers).filter(([k, v]) => k !== 'mood' && v).map(([, v]) => `<div class="item-meta">${esc(v)}</div>`).join('');
    return `<div class="item" data-id="${c.id}"><div class="item-body">
      <div class="item-title">${MOODS[c.answers.mood] ?? '📝'} ${c.kind === 'morning' ? 'Shokal' : 'Raat'} · ${esc(new Date(c.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }))}</div>${fields}
    </div><button class="del" data-act="del">🗑</button></div>`;
  }).join('') : `<div class="empty">Ekhono kono check-in nei.</div>`;
  $$('#checkinList .item').forEach(el => el.querySelector('[data-act="del"]').onclick = () => {
    if (!confirm('Check-in delete korben?')) return;
    checkins = checkins.filter(x => x.id !== el.dataset.id); save.checkins(); renderCheckin();
  });
}
$('#checkinForm').onsubmit = e => {
  e.preventDefault();
  const answers = { mood: selMood };
  $$('#checkinQuestions input[data-q]').forEach(i => answers[i.dataset.q] = i.value.trim());
  const date = dayKey();
  checkins = checkins.filter(c => !(c.date === date && c.kind === checkinKind));
  checkins.push({ id: uid(), date, kind: checkinKind, answers, ts: Date.now() });
  save.checkins(); toast('Check-in save holo 🙌'); renderCheckin();
};

/* ============================================================
   NOTES
   ============================================================ */
let noteQuery = '';
function renderNotes() {
  const box = $('#noteList');
  let list = [...notes].sort((a, b) => b.ts - a.ts);
  if (noteQuery) { const q = noteQuery.toLowerCase(); list = list.filter(n => n.text.toLowerCase().includes(q)); }
  box.innerHTML = list.length ? list.map(n => `
    <div class="item" data-id="${n.id}"><div class="item-body">
      <div class="note-text">${linkify(n.text)}</div>
      <div class="item-meta">${esc(new Date(n.ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }))}</div>
    </div><button class="del" data-act="del">🗑</button></div>`).join('')
    : `<div class="empty">${noteQuery ? 'Kichu pawa gelo na.' : 'Ekhono kono note nei.'}</div>`;
  $$('#noteList .item').forEach(el => el.querySelector('[data-act="del"]').onclick = () => {
    if (!confirm('Ei note ti delete korben?')) return;
    notes = notes.filter(x => x.id !== el.dataset.id); save.notes(); renderNotes(); toast('Note muche gelo');
  });
}
$('#noteForm').onsubmit = e => {
  e.preventDefault();
  const text = $('#noteText').value.trim(); if (!text) return;
  notes.push({ id: uid(), text, ts: Date.now() });
  save.notes(); e.target.reset(); updateNoteCounter(); toast('Note save holo'); renderNotes();
};
function updateNoteCounter() {
  const ta = $('#noteText'), counter = $('#noteCharCount');
  if (!ta || !counter) return;
  const len = ta.value.length;
  counter.textContent = len > 0 ? `${len} char` : '';
  counter.style.color = len > 800 ? 'var(--amber)' : 'var(--haze)';
}
$('#noteText')?.addEventListener('input', updateNoteCounter);
$('#noteText')?.addEventListener('keydown', e => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); $('#noteForm').dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }
});
$('#noteSearch').addEventListener('input', e => { noteQuery = e.target.value; renderNotes(); });

/* ============================================================
   SHEET / DATE-TIME LOG
   ============================================================ */
let sheetQuery = '';
let sheetEditId = null;
function addSheetRow({ when, title, note, cat }) {
  const iso = when ? new Date(when).toISOString() : new Date().toISOString();
  sheetRows.push({ id: uid(), when: iso, title: (title || '').trim(), note: (note || '').trim(), cat: (cat || 'General').trim(), ts: Date.now() });
  save.sheetRows();
  updateSheetCatSuggestions();
}
function updateSheetCatSuggestions() {
  const dl = $('#sheetCatList');
  if (!dl) return;
  const cats = [...new Set(sheetRows.map(r => r.cat).filter(Boolean))];
  dl.innerHTML = cats.map(c => `<option value="${esc(c)}"></option>`).join('');
  const tdl = $('#sheetTitleList');
  if (!tdl) return;
  const titles = [...new Set(sheetRows.map(r => r.title).filter(Boolean))];
  tdl.innerHTML = titles.map(t => `<option value="${esc(t)}"></option>`).join('');
}
function renderSheet() {
  const box = $('#sheetList');
  let list = [...sheetRows].sort((a, b) => new Date(b.when) - new Date(a.when) || b.ts - a.ts);
  if (sheetQuery) {
    const q = sheetQuery.toLowerCase();
    list = list.filter(r => [r.title, r.note, r.cat].some(v => String(v || '').toLowerCase().includes(q)));
  }
  $('#sheetCount').textContent = `${list.length} row`;

  const grouped = {};
  list.forEach(r => {
    const t = (r.title || 'Untitled').trim().toLowerCase();
    const actualTitle = (r.title || 'Untitled').trim();
    if (!grouped[t]) grouped[t] = { title: actualTitle, items: [] };
    grouped[t].items.push(r);
  });

  if (list.length === 0) {
    box.innerHTML = `<div class="empty">${sheetQuery ? 'Kichu pawa gelo na.' : 'Ekhono kono sheet row nei.'}</div>`;
  } else {
    let html = '';
    for (const key in grouped) {
      const g = grouped[key];
      html += `<div class="sheet-group">
        <div class="sheet-group-header">
          <div class="sheet-group-title-wrap">
            <h3 class="sheet-group-title">${esc(g.title)}</h3>
            <span class="sheet-group-count">${g.items.length} entry</span>
          </div>
          <button class="btn btn-soft btn-sm sheet-group-add" type="button" data-title="${esc(g.title)}">＋ Add</button>
        </div>
        <div class="sheet-group-items">
          ${g.items.map(r => `
            <div class="sheet-row" data-id="${r.id}">
              <div class="sheet-date">${esc(new Date(r.when).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: '2-digit', hour: 'numeric', minute: '2-digit', hour12: true }))}</div>
              <div class="sheet-main">
                <div class="sheet-note">${r.note ? linkify(r.note) : 'Kono details nei'}</div>
              </div>
              <div class="sheet-cat">${esc(r.cat || 'General')}</div>
              <div class="sheet-row-actions">
                <button class="mini-action" data-act="edit" title="Edit">✎</button>
                <button class="del" data-act="del">🗑</button>
              </div>
            </div>`).join('')}
        </div>
      </div>`;
    }
    box.innerHTML = html;

    $$('#sheetList .sheet-row').forEach(el => {
      const id = el.dataset.id;
      el.querySelector('[data-act="edit"]').onclick = () => editSheetRow(id);
      el.querySelector('[data-act="del"]').onclick = () => {
        if (!confirm('Ei row ti delete korben?')) return;
        sheetRows = sheetRows.filter(x => x.id !== id);
        save.sheetRows(); renderSheet(); toast('Row muche gelo');
      };
    });
    $$('#sheetList .sheet-group-add').forEach(btn => {
      btn.onclick = () => {
        $('#sheetTitle').value = btn.dataset.title;
        $('#sheetNote').value = '';
        $('#sheetNote').focus();
        $('#sheetForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
      };
    });
  }
}
function editSheetRow(id) {
  const row = sheetRows.find(x => x.id === id);
  if (!row) return;
  sheetEditId = id;
  $('#sheetTime').value = row.when ? row.when.slice(0, 16) : '';
  $('#sheetTitle').value = row.title || '';
  $('#sheetNote').value = row.note || '';
  $('#sheetCat').value = row.cat || '';
  $('#sheetSaveBtn').textContent = 'Update';
  $('#sheetForm').scrollIntoView({ behavior: 'smooth', block: 'start' });
}
$('#sheetForm').onsubmit = e => {
  e.preventDefault();
  const title = $('#sheetTitle').value.trim();
  const note = $('#sheetNote').value.trim();
  if (!title && !note) return;
  if (sheetEditId) {
    const row = sheetRows.find(x => x.id === sheetEditId);
    if (row) {
      row.when = new Date($('#sheetTime').value || row.when || new Date()).toISOString();
      row.title = title;
      row.note = note;
      row.cat = ($('#sheetCat').value || 'General').trim();
      row.ts = Date.now();
      save.sheetRows();
      toast('Sheet row update holo');
    }
    sheetEditId = null;
    $('#sheetSaveBtn').textContent = 'Save';
  } else {
    addSheetRow({ when: $('#sheetTime').value || new Date(), title, note, cat: $('#sheetCat').value || 'General' });
    toast('Sheet row save holo');
  }
  e.target.reset();
  renderSheet();
};
$('#sheetSearch').addEventListener('input', e => { sheetQuery = e.target.value; renderSheet(); });

/* ============================================================
   AI HELP DESK
   ============================================================ */
function renderHelpDesk() {
  const box = $('#helpDeskList');
  box.innerHTML = [
    ['⏰', 'Task/alarm', 'kal bikel 5 tay bazar korte hobe'],
    ['📍', 'Geo alarm', 'geo alarm: banani gele kola kinte mone koriyo'],
    ['📊', 'Sheet row', 'sheet e save koro: 5 Aug 8pm client call - payment follow-up'],
    ['📝', 'Note', 'likhe rakho: ammar oshudh kena lagbe'],
    ['✅', 'Correct/delete', 'bazar task ta delete / oi kaj ta done'],
    ['✨', 'Chat head', 'Web app-er vitore draggable. App-er baire Messenger-style bubble native Android app chara reliable na.'],
  ].map(([ico, title, ex]) => `
    <div class="help-row">
      <div class="help-ico">${ico}</div>
      <div><b>${esc(title)}</b><small>${esc(ex)}</small></div>
    </div>`).join('');
}

/* ============================================================
   PINS (wake cards)
   ============================================================ */
let pinCat = 'dua';
function catLabel(cat) { return ({ dua: '🤲 Dua', rule: '📏 Niyom', reminder: '💡 Reminder' }[cat]) || ('⭐ ' + cat); }
function renderPins() {
  const box = $('#pinList');
  const sorted = [...pins].sort((a, b) => b.ts - a.ts);
  box.innerHTML = sorted.length ? sorted.map(p => `
    <div class="item ${p.wake ? '' : 'pin-off'}" data-id="${p.id}"><div class="item-body">
      <div class="pin-cat-tag">${esc(catLabel(p.cat))}</div>
      ${p.title ? `<div class="item-title">${esc(p.title)}</div>` : ''}
      <div class="note-text">${linkify(p.text)}</div>
      <div class="item-meta">${p.wake ? '☀️ uthe dekhabo' : 'uthe dekhabo na'}</div>
    </div>
    <div style="display:flex;flex-direction:column;gap:6px">
      <button class="pin-star" data-act="wake" title="Uthe dekhabo toggle">${p.wake ? '📌' : '📍'}</button>
      <button class="del" data-act="del">🗑</button>
    </div></div>`).join('') : `<div class="empty">Ekhono kichu pin korona.</div>`;
  $$('#pinList .item').forEach(el => {
    const id = el.dataset.id;
    el.querySelector('[data-act="wake"]').onclick = () => { const p = pins.find(x => x.id === id); p.wake = !p.wake; save.pins(); renderPins(); };
    el.querySelector('[data-act="del"]').onclick = () => { 
      if (!confirm('Pin ti delete korben?')) return;
      pins = pins.filter(x => x.id !== id); save.pins(); renderPins(); toast('Pin baad'); 
    };
  });
}
$$('#pinCatSeg .seg-btn').forEach(b => b.onclick = () => {
  pinCat = b.dataset.cat;
  $$('#pinCatSeg .seg-btn').forEach(x => x.classList.toggle('active', x === b));
  $('#pinCustomCat').classList.toggle('hidden', pinCat !== 'custom');
});
$('#pinForm').onsubmit = e => {
  e.preventDefault();
  const text = $('#pinText').value.trim(); if (!text) return;
  let cat = pinCat;
  if (cat === 'custom') { cat = $('#pinCustomCat').value.trim() || 'Custom'; }
  pins.push({ id: uid(), cat, title: $('#pinTitle').value.trim(), text, wake: $('#pinWake').checked, ts: Date.now() });
  save.pins(); e.target.reset(); pinCat = 'dua';
  $$('#pinCatSeg .seg-btn').forEach((x, i) => x.classList.toggle('active', i === 0));
  $('#pinCustomCat').classList.add('hidden');
  toast('Pin holo 📌'); renderPins();
};

/* ============================================================
   BACKUP & SHARE
   ============================================================ */

/* --- helpers --- */
const BACKUP_FILENAME = 'persona-backup.json';   // fixed name — puranotai overwrite hobe

function buildBackupData() {
  return { tasks, sleeps, checkins, notes, sheetRows, pins, clItems, clLog, _v: 3, _at: new Date().toISOString() };
}

function applyBackupData(d) {
  tasks = Array.isArray(d.tasks) ? d.tasks : [];
  sleeps = Array.isArray(d.sleeps) ? d.sleeps : [];
  checkins = Array.isArray(d.checkins) ? d.checkins : [];
  notes = Array.isArray(d.notes) ? d.notes : [];
  sheetRows = Array.isArray(d.sheetRows) ? d.sheetRows : [];
  pins = Array.isArray(d.pins) ? d.pins : [];
  clItems = Array.isArray(d.clItems) ? d.clItems : defaultChecklist();
  clLog = d.clLog && typeof d.clLog === 'object' ? d.clLog : {};
  Object.values(save).forEach(fn => fn());
  updateSheetCatSuggestions();
}

function backupSummary(d) {
  return `${d.tasks?.length || 0} task, ${d.notes?.length || 0} note, ${d.sheetRows?.length || 0} sheet row`;
}

function makeRestoreLink(data) {
  const url = new URL(location.href);
  url.search = '';
  url.hash = '';
  url.searchParams.set('restore', encodeBackupLinkData(data));
  return url.toString();
}

function markBackupDone() {
  DB.set('lastBackupTs', Date.now());
  updateBackupUI();
}

function updateBackupUI() {
  const ts  = DB.get('lastBackupTs', null);
  const lbl = $('#lastBackupLabel');
  const bar = $('#backupReminderBar');
  if (!lbl) return;

  if (!ts) {
    lbl.textContent = 'Ekhono backup neoa hoyni ⚠️';
    if (bar) { bar.textContent = '⚠️ Backup neoa hoyni — ekhoni niye rakho!'; bar.classList.remove('hidden'); }
    return;
  }

  const diffH = (Date.now() - ts) / 3600000;
  const diffD = Math.floor(diffH / 24);
  const timeStr = new Date(ts).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });

  if (diffH < 1) {
    lbl.textContent = `✅ Eikhuni backup neoa hoyeche`;
    if (bar) bar.classList.add('hidden');
  } else if (diffD < 1) {
    lbl.textContent = `⏱ ${Math.floor(diffH)} ghonta age — ${timeStr}`;
    if (bar) bar.classList.add('hidden');
  } else {
    lbl.textContent = `⚠️ ${diffD} din age — ${timeStr}`;
    if (bar) { bar.textContent = `⚠️ ${diffD} din backup neoa hoyni — ekhoni niye rakho!`; bar.classList.remove('hidden'); }
  }

  // nav-btn badge ("Aro" button)
  const moreBtn = $('[data-nav="more"]');
  if (moreBtn) moreBtn.classList.toggle('backup-due', diffD >= 1);
}

/* --- Cloud / Share --- */
async function doCloudShare() {
  const data = buildBackupData();
  const str  = JSON.stringify(data, null, 2);
  const file = new File([str], BACKUP_FILENAME, { type: 'application/json' });
  const restoreLink = makeRestoreLink(data);
  const shareText = `Persona backup (${backupSummary(data)}). PC/phone e open korle restore option ashbe:\n${restoreLink}`;

  if (navigator.share && navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Persona Backup', text: 'Amar Persona app er full backup' });
      markBackupDone();
      closeSheet();
      toast('Backup share holo ☁️');
    } catch (e) {
      if (e.name !== 'AbortError') toast('Share kora gelo na');
    }
  } else if (navigator.share) {
    try {
      await navigator.share({ title: 'Persona Backup Link', text: shareText, url: restoreLink });
      markBackupDone();
      closeSheet();
      toast('Backup link share holo ☁️');
    } catch (e) {
      if (e.name !== 'AbortError') {
        await copyRestoreLink(restoreLink);
        doDownloadBackup();
      }
    }
  } else {
    await copyRestoreLink(restoreLink);
    doDownloadBackup();
  }
}

$('#cloudShareBtn')?.addEventListener('click', doCloudShare);
$('#cloudSharePageBtn')?.addEventListener('click', doCloudShare);

async function copyRestoreLink(link) {
  try {
    await navigator.clipboard.writeText(link);
    toast('Restore link copy holo — WhatsApp/Gmail e paste koro');
    closeSheet();
  } catch (e) {
    toast('Share support nei — backup download hochhe');
  }
}

/* --- Download to phone --- */
function doDownloadBackup() {
  const blob = new Blob([JSON.stringify(buildBackupData(), null, 2)], { type: 'application/json' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = BACKUP_FILENAME;    // same filename protibar — browser overwrite korbe
  a.click();
  URL.revokeObjectURL(a.href);
  markBackupDone();
}

$('#exportBtn').onclick = () => {
  doDownloadBackup();
  closeSheet();
  toast('Backup download holo ⬇️ — puranotai replace hoyeche');
};

/* --- Import / Restore --- */
$('#importBtn').onclick  = () => $('#importFile').click();
$('#importFile').onchange = e => {
  const f = e.target.files[0]; if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const d = JSON.parse(r.result);
      if (!d || typeof d !== 'object') { toast('File ta valid backup na'); return; }
      const hasCurrentData = tasks.length || notes.length || sheetRows.length;
      if (hasCurrentData && !confirm(`Ekhonkar shob data replace hoye jabe!\nFile te ${d.tasks?.length || 0} task, ${d.notes?.length || 0} note, ${d.sheetRows?.length || 0} sheet row ache.\n\nCurrent data ki age download hobe? OK = hya`)) {
        e.target.value = ''; return;
      }
      // current data auto-save before overwrite
      if (hasCurrentData) doDownloadBackup();
      applyBackupData(d);
      closeSheet(); navTo('home'); toast('Backup restore holo ✅');
    } catch (err) { toast('File porte parlam na — valid JSON ba Persona backup dao'); }
  };
  r.readAsText(f); e.target.value = '';
};

/* --- Auto Snapshot (daily, localStorage only) --- */
let autoSnapshotData = DB.get('autoSnapshot', null);
if (autoSnapshotData) $('#restoreSnapshotBtn').classList.remove('hidden');
$('#restoreSnapshotBtn').onclick = () => {
  if (!confirm('Ekhonkar shob data muche ager diner auto-backup restore hobe. Sure?')) return;
  const d = autoSnapshotData;
  applyBackupData(d);
  closeSheet(); navTo('home'); toast('Auto-backup theke restore holo ✅');
};

/* ============================================================
   NOTIFICATIONS + REMINDERS
   ============================================================ */
let swReg = null;
let swReloading = false;
async function initSW() {
  if (!('serviceWorker' in navigator)) return;
  /* notun SW active hole ekbar reload — na hole purono cache theke purono UI dekhabe.
     prothom install e controller chilo na, tokhon reload dorkar nei. */
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (swReloading || !hadController) return;
    swReloading = true;
    location.reload();
  });
  try {
    swReg = await navigator.serviceWorker.register('sw.js');
    swReg.update();                                  // proti load e notun version khoje
  } catch (e) { console.warn('SW fail', e); }
}
function updateNotifBtn() {
  const b = $('#notifBtn');
  if (!('Notification' in window)) { b.style.display = 'none'; return; }
  b.classList.toggle('on', Notification.permission === 'granted');
}
async function requestNotif() {
  if (!('Notification' in window)) { toast('Ei browser notification support kore na'); return; }
  if (Notification.permission === 'granted') fireNotif('Persona', 'Reminder age thekei on ✅');
  else {
    const p = await Notification.requestPermission();
    if (p === 'granted') fireNotif('Persona', 'Reminder chalu holo 🔔');
    else toast('Permission deowa hoyni');
  }
  updateNotifBtn(); checkDueTasks();
}
$('#notifBtn').onclick = requestNotif;
function fireNotif(title, body) {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const opts = { body, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', tag: 'persona' };
  if (swReg && swReg.showNotification) swReg.showNotification(title, opts); else new Notification(title, opts);
}
function checkDueTasks() {
  const now = Date.now(); let changed = false;
  tasks.forEach(t => {
    if (t.due && !t.done && !t.notified && new Date(t.due).getTime() <= now) {
      /* alarm.js thakle purota — awaj, vibration, popup, notification */
      if (typeof fireAlarm === 'function') fireAlarm(t);
      else fireNotif('⏰ Kaj-er shomoy', t.title);
      t.notified = true; changed = true;
    }
  });
  if (changed) { save.tasks(); if (['tasks', 'home'].includes(currentView)) render(currentView); }
  if (typeof syncScheduledAlarms === 'function') syncScheduledAlarms();
}
setInterval(checkDueTasks, 30000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkDueTasks(); });

/* ============================================================
   INIT
   ============================================================ */
function checkAutoSnapshot() {
  const today = dayKey();
  if (DB.get('lastSnapshotDate') !== today) {
    if (tasks.length || notes.length || sheetRows.length || pins.length) {
      const data = { tasks, sleeps, checkins, notes, sheetRows, pins, clItems, clLog, _v: 3, _at: new Date().toISOString() };
      DB.set('autoSnapshot', data);
      DB.set('lastSnapshotDate', today);
      autoSnapshotData = data;
      $('#restoreSnapshotBtn').classList.remove('hidden');
    }
  }
}

function init() {
  applyTheme();
  $('#themeToggleBtn').onclick = toggleTheme;
  updateNotifBtn();
  initSW();
  checkAutoSnapshot();
  updateBackupUI();
  updateSheetCatSuggestions();
  navTo('home');
  if (activeSleep) openSleepMode();  // resume ongoing sleep
  checkDueTasks();
  maybeRestoreFromLink();
}
init();

function maybeRestoreFromLink() {
  const params = new URLSearchParams(location.search);
  const packed = params.get('restore');
  if (!packed) return;
  try {
    const d = decodeBackupLinkData(packed);
    if (!d || typeof d !== 'object') throw new Error('Invalid backup');
    const hasCurrentData = tasks.length || notes.length || sheetRows.length || pins.length;
    const ok = confirm(`Persona backup pawa geche: ${backupSummary(d)}.\n\nEi device e restore korbo?${hasCurrentData ? '\nCurrent data age download hobe.' : ''}`);
    if (ok) {
      if (hasCurrentData) doDownloadBackup();
      applyBackupData(d);
      markBackupDone();
      toast('Link theke backup restore holo ✅');
      navTo('home', { replace: true });
    }
  } catch (e) {
    toast('Restore link ta valid na');
  } finally {
    history.replaceState(null, '', location.pathname);
  }
}
