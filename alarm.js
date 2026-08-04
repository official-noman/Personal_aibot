/* ============================================================
   Persona — alarm engine
   Ringtone (Web Audio die banano, kono file lage na), fullscreen
   alarm popup, snooze, vibration, ar (browser support korle)
   app bondho thakleo notification.
   ============================================================ */
'use strict';

let alarmCfg = DB.get('alarm', { tone: 'classic', vol: 0.8, vibrate: true, snooze: 5, popup: true });
const saveAlarm = () => DB.set('alarm', alarmCfg);

/* ============================================================
   RINGTONES — sequence of [frequency, seconds]; 0 = chup
   ============================================================ */
const TONES = {
  classic: { label: '⏰ Classic', type: 'square', gain: .5, seq: [[880, .16], [0, .09], [880, .16], [0, .09], [880, .16], [0, .75]] },
  chime:   { label: '🔔 Chime',   type: 'sine',   gain: .7, seq: [[523, .28], [659, .28], [784, .28], [1047, .55], [0, .8]] },
  digital: { label: '📟 Digital', type: 'sawtooth', gain: .35, seq: [[1200, .07], [0, .05], [1200, .07], [0, .05], [1200, .07], [0, .05], [1200, .07], [0, .9]] },
  gentle:  { label: '🌊 Norom',   type: 'sine',   gain: .55, seq: [[392, .5], [523, .5], [440, .5], [0, 1.1]] },
  ripple:  { label: '💧 Ripple',  type: 'triangle', gain: .6, seq: [[1047, .12], [784, .12], [1047, .12], [0, .3], [1047, .12], [784, .12], [0, 1]] },
  none:    { label: '🔇 Awaj chara', silent: true },
};

let audioCtx = null;
let ringTimer = null, ringStop = null, vibeTimer = null;

/* mobile browser prothom user-tap chara audio bajate dey na */
function unlockAudio() {
  if (!audioCtx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    audioCtx = new AC();
  }
  if (audioCtx.state === 'suspended') audioCtx.resume();
  return audioCtx;
}
['pointerdown', 'touchstart', 'keydown'].forEach(ev =>
  document.addEventListener(ev, unlockAudio, { once: true, passive: true }));

/** Ekbar tone sequence bajay. @returns {number} koto second lagbe */
function playSeq(toneKey, volume) {
  const tone = TONES[toneKey] || TONES.classic;
  if (tone.silent) return 1.2;
  const ctx = unlockAudio();
  if (!ctx) return 1.2;

  let at = ctx.currentTime + 0.02;
  for (const [freq, dur] of tone.seq) {
    if (freq > 0) {
      const osc = ctx.createOscillator();
      const g = ctx.createGain();
      osc.type = tone.type;
      osc.frequency.setValueAtTime(freq, at);
      /* click-noise komanor jonno chhoto fade in/out */
      const peak = Math.max(0.0001, (volume ?? 0.8) * tone.gain);
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(peak, at + 0.012);
      g.gain.setValueAtTime(peak, at + dur - 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      osc.connect(g); g.connect(ctx.destination);
      osc.start(at); osc.stop(at + dur + 0.02);
    }
    at += dur;
  }
  return at - ctx.currentTime;
}

/** Loop kore bajate thake, joto khon na thamano hoy (max 60s) */
function startRinging() {
  stopRinging();
  const tone = alarmCfg.tone || 'classic';
  const startedAt = Date.now();
  const loop = () => {
    if (Date.now() - startedAt > 60000) return stopRinging();   // 60s por nijei thambe
    const dur = playSeq(tone, alarmCfg.vol);
    ringTimer = setTimeout(loop, Math.max(600, dur * 1000));
  };
  loop();
  if (alarmCfg.vibrate && navigator.vibrate) {
    const buzz = () => navigator.vibrate([400, 200, 400, 200, 400]);
    buzz();
    vibeTimer = setInterval(buzz, 2000);
    setTimeout(() => { clearInterval(vibeTimer); vibeTimer = null; }, 30000);
  }
  ringStop = () => {};
}
function stopRinging() {
  clearTimeout(ringTimer); ringTimer = null;
  clearInterval(vibeTimer); vibeTimer = null;
  if (navigator.vibrate) navigator.vibrate(0);
  ringStop = null;
}

/* ============================================================
   ALARM POPUP
   ============================================================ */
let ringingTask = null;

function fireAlarm(task) {
  ringingTask = task;

  /* system notification — app minimize thakleo eta ashe */
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    const opts = {
      body: task.title,
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      tag: 'task-' + task.id,
      requireInteraction: true,               // nijei miliye jabe na
      vibrate: alarmCfg.vibrate ? [400, 200, 400] : undefined,
      data: { taskId: task.id },
    };
    if (swReg && swReg.showNotification) swReg.showNotification('⏰ Kaj-er shomoy', opts);
    else new Notification('⏰ Kaj-er shomoy', opts);
  }

  if (!alarmCfg.popup) { startRinging(); return; }

  $('#alarmTitle').textContent = task.title;
  $('#alarmTime').textContent = task.due ? fmtDue(task.due) : '';
  $('#alarmSnoozeBtn').textContent = `${alarmCfg.snooze} min por abar`;
  $('#alarmMode').classList.remove('hidden');
  startRinging();
}

function dismissAlarm() {
  stopRinging();
  $('#alarmMode').classList.add('hidden');
  ringingTask = null;
}
function snoozeAlarm() {
  const t = ringingTask;
  dismissAlarm();
  if (!t) return;
  const task = tasks.find(x => x.id === t.id);
  if (!task) return;
  task.due = new Date(Date.now() + (alarmCfg.snooze || 5) * 60000).toISOString();
  task.notified = false;
  save.tasks(); render(currentView); syncScheduledAlarms();
  toast(`${alarmCfg.snooze} min por abar mone koriye dibo`);
}
function completeFromAlarm() {
  const t = ringingTask;
  dismissAlarm();
  if (t) { toggleTask(t.id); toast('✅ Shesh kore dilam'); }
}

/* ============================================================
   APP BONDHO THAKLEO ALARM — Notification Triggers API
   (Chrome Android e ache; na thakle app khola/background e chole)
   ============================================================ */
const canScheduleOffline = () =>
  typeof Notification !== 'undefined' && 'showTrigger' in Notification.prototype && typeof TimestampTrigger !== 'undefined';

let lastSig = '';
async function syncScheduledAlarms() {
  if (!canScheduleOffline() || !swReg || Notification.permission !== 'granted') return;
  const due = tasks.filter(t => !t.done && t.due && new Date(t.due).getTime() > Date.now() + 1000);
  const sig = due.map(t => t.id + '@' + t.due).join('|');
  if (sig === lastSig) return;                       // bar bar re-schedule korar dorkar nei
  lastSig = sig;
  try {
    const old = await swReg.getNotifications({ includeTriggered: true, tag: '' });
    old.filter(n => n.tag && n.tag.startsWith('sched-')).forEach(n => n.close());
    for (const t of due.slice(0, 40)) {
      await swReg.showNotification('⏰ Kaj-er shomoy', {
        tag: 'sched-' + t.id,
        body: t.title,
        icon: 'icons/icon-192.png',
        badge: 'icons/icon-192.png',
        requireInteraction: true,
        showTrigger: new TimestampTrigger(new Date(t.due).getTime()),
        data: { taskId: t.id },
      });
    }
  } catch (e) { console.warn('[alarm] schedule fail', e); }
}

/* ============================================================
   SETTINGS UI
   ============================================================ */
function renderAlarmSettings() {
  $('#toneList').innerHTML = Object.entries(TONES).map(([k, v]) =>
    `<button type="button" class="tone-opt ${k === alarmCfg.tone ? 'sel' : ''}" data-tone="${k}">${v.label}</button>`).join('');
  $$('#toneList .tone-opt').forEach(b => b.onclick = () => {
    alarmCfg.tone = b.dataset.tone; saveAlarm(); renderAlarmSettings();
    stopRinging(); playSeq(alarmCfg.tone, alarmCfg.vol);          // beche nilei ekbar shunbe
  });
  $('#alarmVol').value = Math.round((alarmCfg.vol ?? .8) * 100);
  $('#alarmVolVal').textContent = Math.round((alarmCfg.vol ?? .8) * 100) + '%';
  $('#alarmVibrate').checked = !!alarmCfg.vibrate;
  $('#alarmPopup').checked = !!alarmCfg.popup;
  $('#alarmSnooze').value = alarmCfg.snooze || 5;

  const st = $('#alarmSupport');
  const bits = [];
  bits.push(typeof Notification === 'undefined' ? '❌ Notification support nei'
    : Notification.permission === 'granted' ? '✅ Notification chalu'
    : '⚠️ Notification permission deowa hoyni — uporer 🔔 button e tap koro');
  bits.push(canScheduleOffline()
    ? '✅ App bondho thakleo alarm bajbe'
    : '⚠️ App bondho thakle alarm bajbe na — app khola ba background e thakte hobe');
  bits.push(navigator.vibrate ? '✅ Vibration ache' : '❌ Vibration nei');
  st.innerHTML = bits.map(b => `<div>${b}</div>`).join('');
}

function initAlarmUI() {
  $('#alarmSettingsBtn').onclick = () => { closeSheet(); $('#alarmSheet').classList.remove('hidden'); renderAlarmSettings(); };
  $$('[data-close="alarm"]').forEach(el => el.onclick = () => { stopRinging(); $('#alarmSheet').classList.add('hidden'); });

  $('#alarmVol').oninput = e => {
    alarmCfg.vol = +e.target.value / 100; saveAlarm();
    $('#alarmVolVal').textContent = e.target.value + '%';
  };
  $('#alarmVol').onchange = () => { stopRinging(); playSeq(alarmCfg.tone, alarmCfg.vol); };
  $('#alarmVibrate').onchange = e => { alarmCfg.vibrate = e.target.checked; saveAlarm(); if (e.target.checked && navigator.vibrate) navigator.vibrate(200); };
  $('#alarmPopup').onchange = e => { alarmCfg.popup = e.target.checked; saveAlarm(); };
  $('#alarmSnooze').onchange = e => { alarmCfg.snooze = Math.max(1, Math.min(60, +e.target.value || 5)); saveAlarm(); };

  /* "bajiye dekho" — puro alarm-ta jemon bajbe temon kore dekhay */
  $('#alarmTestBtn').onclick = () => {
    $('#alarmSheet').classList.add('hidden');
    fireAlarm({ id: '_test', title: 'Test alarm — এভাবেই বাজবে', due: new Date().toISOString() });
  };
  /* phone e shotti kore jachai korar jonno: 1 min porer ekta ashol reminder */
  $('#alarmTest1minBtn').onclick = () => {
    const due = new Date(Date.now() + 60000).toISOString();
    addTask('Test reminder (1 min por)', due);
    syncScheduledAlarms();
    $('#alarmSheet').classList.add('hidden');
    toast('1 min por bajbe — chaile app ta bondho kore dekho');
  };

  $('#alarmDismissBtn').onclick = dismissAlarm;
  $('#alarmSnoozeBtn').onclick = snoozeAlarm;
  $('#alarmDoneBtn').onclick = completeFromAlarm;

  /* notification e tap kore ashle sound bondho */
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !ringingTask) stopRinging(); });

  /* notification e tap korle SW janay kon task — tokhon alarm screen dekhai */
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.addEventListener('message', e => {
      if (!e.data || e.data.type !== 'alarm-click') return;
      const t = tasks.find(x => x.id === e.data.taskId);
      if (t && !t.done) fireAlarm(t);
    });
  }
  const launched = new URLSearchParams(location.search).get('alarm');
  if (launched) {
    const t = tasks.find(x => x.id === launched);
    if (t && !t.done) fireAlarm(t);
  }

  setTimeout(syncScheduledAlarms, 1500);
  setInterval(syncScheduledAlarms, 60000);
}
initAlarmUI();
