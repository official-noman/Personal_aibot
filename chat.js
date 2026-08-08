/* ============================================================
   Persona AI — chat brain
   Chat e likhle nijei kaj kore: task, ghum, checklist, note, pin.
   Duita mode:
     1) offline brain  — rule + NLU parser, kono key lage na (default)
     2) LLM mode       — nijer Gemini key dile free-form kotha bujhbe,
                         kintu action gulo ekhankar registry theke-i chalay
   app.js er global gulo (tasks, addTask, save, render...) ekhane use hoy.
   ============================================================ */
'use strict';

/* ---------- storage ---------- */
/* config.local.js (gitignored) thakle sekhankar key ta default — kichu na kore-i AI mode chole */
const LOCAL_CFG = (typeof window !== 'undefined' && window.PERSONA_CONFIG) || {};
const DEFAULT_KEY = LOCAL_CFG.key || '';
const DEFAULT_MODEL = LOCAL_CFG.model || 'gemini-3.6-flash';
const AI_DEFAULTS = { on: !!DEFAULT_KEY, key: DEFAULT_KEY, pass: '', model: DEFAULT_MODEL, len: 'mid' };

let chatLog = DB.get('chat', []);
let aiCfg = Object.assign({}, AI_DEFAULTS, DB.get('ai', {}));
/* purono hardcoded default theke migrate — user nijer icchay onno model dile ta thakbe */
if (aiCfg.model === 'gemini-2.5-flash') aiCfg.model = DEFAULT_MODEL;
/* age theke chalano install e key faka chhilo — default key ta bosiye di */
if (!aiCfg.key && DEFAULT_KEY) { aiCfg.key = DEFAULT_KEY; aiCfg.on = true; }

const usingDefaultKey = () => !!DEFAULT_KEY && aiCfg.key === DEFAULT_KEY;

/* ---------- Gemini kothay call hobe ----------
   Duita rasta:
   1) Nijer key hate thakle (local dev / config.local.js) — sorasori Google e.
   2) Key na thakle — nijer domain er `/api/gemini` proxy (Cloudflare Pages
      Function), jekhane key ta server side secret. Browser e key jay na, tai
      public URL theke keu key churi korte pare na. Gate: passphrase header.
   Erfole ek-i app office/basha/phone sob jaygay chole — protita device e
   shudhu ekbar passphrase dite hoy. */
const PROXY_BASE = '/api/gemini';
const usingProxy = () => !aiCfg.key && !!aiCfg.pass;
const aiConfigured = () => !!(aiCfg.key || aiCfg.pass);

function apiTarget(path, params = {}) {
  const q = new URLSearchParams(params);
  if (aiCfg.key) {
    q.set('key', aiCfg.key);
    return { url: `https://generativelanguage.googleapis.com/v1beta/${path}?${q}`, headers: {} };
  }
  return { url: `${PROXY_BASE}/${path}?${q}`, headers: { 'x-persona-pass': aiCfg.pass || '' } };
}

let aiModels = DB.get('aiModels', []);      // API theke fetch kora model ID list
let aiUsage  = DB.get('aiUsage', {});       // { 'YYYY-MM-DD': { req, in, out } }

const saveChat = () => DB.set('chat', chatLog.slice(-120));
const saveAi = () => DB.set('ai', aiCfg);

/* ============================================================
   CHOBI STORE — IndexedDB
   base64 chobi localStorage e rakhle quota (~5MB) sathe sathe shesh hoye jay,
   tai chobi ekhane thake ar chatLog e shudhu id.
   ============================================================ */
const IMG = {
  _db: null,
  open() {
    if (this._db) return this._db;
    this._db = new Promise((res, rej) => {
      const req = indexedDB.open('PersonaImgDB', 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('imgs')) d.createObjectStore('imgs', { keyPath: 'id' });
      };
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error || new Error('IndexedDB khola gelo na'));
    });
    return this._db;
  },
  async put(rec) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const tx = db.transaction('imgs', 'readwrite');
      tx.objectStore('imgs').put(rec);
      tx.oncomplete = () => res(rec.id);
      tx.onerror = () => rej(tx.error || new Error('Chobi save hoy ni'));
    });
  },
  async get(id) {
    const db = await this.open();
    return new Promise((res, rej) => {
      const r = db.transaction('imgs', 'readonly').objectStore('imgs').get(id);
      r.onsuccess = () => res(r.result || null);
      r.onerror = () => rej(r.error || new Error('Chobi pora gelo na'));
    });
  },
  async keys() {
    const db = await this.open();
    return new Promise((res, rej) => {
      const r = db.transaction('imgs', 'readonly').objectStore('imgs').getAllKeys();
      r.onsuccess = () => res(r.result || []);
      r.onerror = () => rej(r.error || new Error('Chobi list pawa gelo na'));
    });
  },
  async del(ids) {
    if (!ids.length) return;
    const db = await this.open();
    return new Promise((res, rej) => {
      const tx = db.transaction('imgs', 'readwrite');
      const st = tx.objectStore('imgs');
      ids.forEach(id => st.delete(id));
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error || new Error('Chobi mucha gelo na'));
    });
  },
  /* chatLog trim hole je chobi gulo ar kono message e nei, segulo mucha */
  async gc() {
    try {
      const keep = new Set();
      chatLog.forEach(m => (m.imgs || []).forEach(id => keep.add(id)));
      pendingImgs.forEach(im => keep.add(im.id));
      const orphan = (await this.keys()).filter(id => !keep.has(id));
      if (orphan.length) {
        await this.del(orphan);
        orphan.forEach(id => imgCache.delete(id));
      }
    } catch (e) { console.warn('[persona-ai] chobi gc fail', e); }
  },
};

/* ---------- chobi prep (resize + compress) ---------- */
const IMG_MAX = 1152;        // Gemini tile size er sathe mane jay, quality-o thake
const IMG_THUMB = 240;
const MAX_ATTACH = 4;        // ek message e sorbochcho koyta chobi
const MAX_CTX_IMGS = 4;      // ek request e (history soho) sorbochcho koyta chobi

const imgCache = new Map();  // id -> { thumb, full }
let pendingImgs = [];        // pathanor age composer e attach kora chobi

const b64 = (dataUrl) => dataUrl.slice(dataUrl.indexOf(',') + 1);

function fileToImage(file) {
  return new Promise((res, rej) => {
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => { URL.revokeObjectURL(url); res(im); };
    im.onerror = () => { URL.revokeObjectURL(url); rej(new Error(`"${file.name}" chobi hishebe pora gelo na`)); };
    im.src = url;
  });
}

function scaleToJpeg(im, max, quality) {
  const scale = Math.min(1, max / Math.max(im.width, im.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(im.width * scale));
  c.height = Math.max(1, Math.round(im.height * scale));
  const ctx = c.getContext('2d');
  /* JPEG e alpha nei — sada na bhorle transparent PNG/screenshot kalo hoye jay */
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(im, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', quality);
}

/** File → { id, full, thumb } — resize kore na pathale token ar quota dutoi pure jay. */
async function prepImage(file) {
  if (!/^image\//.test(file.type || '')) throw new Error(`"${file.name}" chobi na`);
  if (file.size > 25 * 1024 * 1024) throw new Error(`"${file.name}" onek boro (25MB+)`);
  const im = await fileToImage(file);
  return {
    id: 'img_' + uid(),
    full: scaleToJpeg(im, IMG_MAX, 0.72),
    thumb: scaleToJpeg(im, IMG_THUMB, 0.7),
    ts: Date.now(),
  };
}

/* ============================================================
   TEXT NORMALIZATION
   ============================================================ */
const BN_DIGIT = { '০': '0', '১': '1', '২': '2', '৩': '3', '৪': '4', '৫': '5', '৬': '6', '৭': '7', '৮': '8', '৯': '9' };

function norm(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[০-৯]/g, d => BN_DIGIT[d])
    /* dot/colon shudhu tokhon-i rakhbo jokhon duipashe digit — "7.5" ar "7:30" bachbe,
       kintu "hobe." ba "day:" er punctuation jabe */
    .replace(/(?<!\d)[.:]|[.:](?!\d)/g, ' ')
    .replace(/[,!?;"'`()\[\]।“”‘’]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
/* word-ish match: " x " padding die partial-word false hit komay */
function has(t, words) {
  const p = ' ' + t + ' ';
  return words.some(w => p.includes(' ' + w + ' ') || p.includes(' ' + w));
}
function hasAny(t, words) { return words.some(w => t.includes(w)); }

/* ============================================================
   TIME / DATE PARSING (Banglish + Bangla + English)
   ============================================================ */
const TOD = [
  { k: ['bhor', 'vor', 'ভোর'], h: 5 },
  { k: ['shokal', 'sokal', 'shokale', 'sokale', 'morning', 'সকাল', 'সকালে'], h: 8 },
  { k: ['dupur', 'dupure', 'noon', 'দুপুর', 'দুপুরে'], h: 13 },
  { k: ['bikel', 'bikal', 'bikele', 'afternoon', 'বিকেল', 'বিকালে'], h: 16 },
  { k: ['sondha', 'shondha', 'sondhya', 'evening', 'সন্ধ্যা', 'সন্ধ্যায়'], h: 18 },
  { k: ['rat', 'raat', 'rate', 'raate', 'night', 'রাত', 'রাতে'], h: 21 },
];
const WEEKDAY = [
  { k: ['robibar', 'rabibar', 'sunday', 'রবিবার'], d: 0 },
  { k: ['sombar', 'shombar', 'somobar', 'monday', 'সোমবার'], d: 1 },
  { k: ['mongolbar', 'mangalbar', 'tuesday', 'মঙ্গলবার'], d: 2 },
  { k: ['budhbar', 'budbar', 'wednesday', 'বুধবার'], d: 3 },
  { k: ['brihospotibar', 'bishudbar', 'thursday', 'বৃহস্পতিবার'], d: 4 },
  { k: ['shukrobar', 'sukrobar', 'friday', 'শুক্রবার'], d: 5 },
  { k: ['shonibar', 'sonibar', 'saturday', 'শনিবার'], d: 6 },
];

/* "sare 7" = 7.5, "der" = 1.5, "adha" = 0.5, "poune 8" = 7.75 */
function fractionWord(t) {
  if (/\bder\b|\bদেড়/.test(t)) return 1.5;
  if (/\bar?dha\b|\badha\b|\bহাফ\b|\bhalf\b|\bআধা/.test(t)) return 0.5;
  return null;
}

/**
 * Text theke ekta somoy ber kore.
 * @returns {{ when: Date|null, hits: string[] }} hits = ja title theke kete felte hobe
 */
function parseWhen(text) {
  const t = norm(text);
  const hits = [];
  const now = new Date();
  let dayOff = null, hour = null, min = 0, rel = null;

  /* --- relative: "20 min por", "2 ghonta pore", "adha ghonta por" --- */
  let m = t.match(/(\d+(?:\.\d+)?)\s*(min|mins|minit|minute|minutes|মিনিট)\s*(por|pore|later|baade|bade)?/);
  if (m) { rel = +m[1]; hits.push(m[0]); }
  if (rel == null) {
    m = t.match(/(\d+(?:\.\d+)?)\s*(ghonta|ghanta|ghonta|hour|hours|hr|ঘণ্টা|ঘন্টা)\s*(por|pore|later|baade|bade)/);
    if (m) { rel = +m[1] * 60; hits.push(m[0]); }
  }
  if (rel == null) {
    m = t.match(/(adha|ardha|আধা|half)\s*(ghonta|ghanta|hour|ঘণ্টা|ঘন্টা)\s*(por|pore|later)?/);
    if (m) { rel = 30; hits.push(m[0]); }
  }
  if (rel != null) {
    return { when: new Date(now.getTime() + rel * 60000), hits };
  }

  /* --- day words --- */
  const DAYW = [
    { k: ['aaj', 'aj', 'aajke', 'ajke', 'today', 'আজ', 'আজকে'], o: 0 },
    { k: ['kal', 'kalke', 'agamikal', 'tomorrow', 'কাল', 'কালকে', 'আগামীকাল'], o: 1 },
    { k: ['porshu', 'porsu', 'পরশু'], o: 2 },
  ];
  for (const d of DAYW) {
    const hit = d.k.find(w => has(t, [w]));
    if (hit) { dayOff = d.o; hits.push(hit); break; }
  }
  /* weekday: "shukrobar" -> shamner oi din */
  if (dayOff == null) {
    for (const w of WEEKDAY) {
      const hit = w.k.find(x => t.includes(x));
      if (hit) {
        const diff = (w.d - now.getDay() + 7) % 7;
        dayOff = diff === 0 ? 7 : diff;
        hits.push(hit);
        break;
      }
    }
  }

  /* --- time of day word --- */
  let todHour = null;
  for (const p of TOD) {
    const hit = p.k.find(w => has(t, [w]));
    if (hit) { todHour = p.h; hits.push(hit); break; }
  }

  /* --- explicit clock: "5 ta", "5:30 e", "5 tay", "17:00", "5 pm" --- */
  m = t.match(/(\d{1,2})\s*[:.]\s*(\d{2})\s*(am|pm)?/) ||
      t.match(/(\d{1,2})\s*(?:ta|tay|tar|tae|টা|টায়)\b/) ||
      t.match(/(\d{1,2})\s*(am|pm)\b/);
  if (m) {
    let h = +m[1];
    const mm = /^\d{2}$/.test(m[2]) ? +m[2] : 0;
    /* am/pm 2nd ba 3rd group e thakte pare — minute ke bhule am/pm bhaba jabe na */
    const ap = [m[2], m[3]].map(x => (x || '').toLowerCase()).find(x => x === 'am' || x === 'pm') || '';
    if (ap === 'pm' && h < 12) h += 12;
    else if (ap === 'am' && h === 12) h = 0;
    else if (!ap && todHour != null) {
      /* "bikel 5" -> 17 : tod onujayi 12 ghonta shift */
      if (todHour >= 12 && h < 12) h += 12;
      if (todHour < 12 && h === 12) h = 0;
    } else if (!ap && h <= 7) {
      /* "5 tay" — sadharoto bikel 5 bojhay, shokal na */
      h += 12;
    }
    if (h >= 0 && h <= 23 && mm >= 0 && mm <= 59) { hour = h; min = mm; hits.push(m[0]); }
  }
  if (hour == null && todHour != null) hour = todHour;

  if (dayOff == null && hour == null) return { when: null, hits: [] };

  const d = new Date(now);
  d.setSeconds(0, 0);
  if (dayOff != null) d.setDate(d.getDate() + dayOff);

  if (hour != null) {
    d.setHours(hour, min, 0, 0);
    /* somoy periye gele ar din specify na thakle porer din */
    if (d.getTime() <= now.getTime() && dayOff == null) d.setDate(d.getDate() + 1);
  } else if (dayOff === 0) {
    /* "aaj"/"today" bola hoyeche kintu somoy na — periye jawa 9 ta na diye
       shamner ghonta te rakhi, na hole reminder shathe shathe overdue */
    d.setTime(now.getTime() + 60 * 60000);
    d.setMinutes(d.getMinutes() > 30 ? 0 : 30, 0, 0);
    if (d.getTime() <= now.getTime()) d.setHours(d.getHours() + 1);
  } else {
    d.setHours(9, 0, 0, 0);              // onno din bola hoyeche, somoy na -> shokal 9
  }

  return { when: d, hits };
}

/* ghum ghonta: "sare 7 ghonta", "7.5 ghonta", "der ghonta" */
function parseHours(text) {
  const t = norm(text);
  let m = t.match(/(\d+(?:\.\d+)?)\s*(?:ghonta|ghanta|hour|hours|hr|h\b|ঘণ্টা|ঘন্টা)/);
  if (m) {
    let v = +m[1];
    if (/\bsare\b|\bsara\b|\bসাড়ে/.test(t)) v += 0.5;
    if (/\bpoune\b|\bপৌনে/.test(t)) v -= 0.25;
    return v;
  }
  const f = fractionWord(t);
  if (f && /ghonta|ghanta|hour|ঘণ্টা|ঘন্টা/.test(t)) return f;
  m = t.match(/(\d+(?:\.\d+)?)\s*(?:ghum|ghumi|ঘুম)/);
  if (m) return +m[1];
  return null;
}

/* ============================================================
   FUZZY MATCH — "bazar kaj ta done" -> kon task?
   ============================================================ */
const STOP = new Set(['ta', 'ti', 'tar', 'er', 'e', 'ke', 'r', 'the', 'a', 'kaj', 'task', 'ei', 'oi', 'amar', 'ami']);
function tokens(s) { return norm(s).split(' ').filter(w => w && !STOP.has(w)); }

function score(query, candidate) {
  const q = tokens(query), c = tokens(candidate);
  if (!q.length || !c.length) return 0;
  const cs = norm(candidate), qs = norm(query);
  if (cs === qs) return 1;
  let hit = 0;
  for (const w of q) {
    if (c.some(x => x === w || (w.length > 3 && (x.startsWith(w) || w.startsWith(x))))) hit++;
    else if (w.length > 3 && cs.includes(w)) hit += 0.8;
  }
  return hit / q.length;
}
/** best match ba null (threshold er niche hole null) */
function bestMatch(query, list, getText, threshold = 0.5) {
  let best = null, bs = 0;
  for (const item of list) {
    const s = score(query, getText(item));
    if (s > bs) { bs = s; best = item; }
  }
  return bs >= threshold ? best : null;
}

/* ============================================================
   ACTIONS — chat, LLM duitai ekhan theke-i kaj kore
   ============================================================ */
function refresh() { try { render(currentView); } catch (e) { /* view nei */ } }
function plural(n, one, many) { return n === 1 ? one : (many || one); }

const ACTIONS = {
  task_add({ title, due }) {
    if (!title || !title.trim()) return { text: 'Kaj-er naam ta bolo — "kal 5 tay bazar korte hobe" erokom.' };
    const iso = due ? new Date(due).toISOString() : null;
    addTask(title, iso);
    const t = tasks[tasks.length - 1];
    if (!iso) {
      chatPending = { type: 'task_time', id: t.id };
      return { text: `Add korlam: **${title}**\nKokhon mone koriye dibo?`, chips: ['Aaj rat 9 tay', 'Kal shokal 9 tay', '1 ghonta por', 'Lagbe na'] };
    }
    const late = new Date(iso).getTime() <= Date.now();
    return { text: `Add korlam: **${title}**\n⏰ ${fmtDue(iso)} e mone koriye dibo.${late ? '\n⚠️ Ei shomoy to periye geche — onno shomoy bolle bodle dibo.' : ''}` };
  },

  task_done({ query }) {
    const open = tasks.filter(t => !t.done);
    if (!open.length) return { text: 'Baki kono kaj-i nei 🎉' };
    const t = query ? bestMatch(query, open, x => x.title) : (open.length === 1 ? open[0] : null);
    if (!t) return { text: 'Kon kaj ta? Ektu naam bolo.', chips: open.slice(0, 4).map(x => x.title + ' done') };
    if (!t.done) toggleTask(t.id);
    const left = tasks.filter(x => !x.done).length;
    return { text: `✅ **${t.title}** shesh. ${left ? `Aro ${left} ta baki.` : 'Shob kaj shesh! 🎉'}` };
  },

  task_delete({ query }) {
    const t = bestMatch(query || '', tasks, x => x.title);
    if (!t) return { text: 'Kon kaj ta muchbo bujhi nai. Naam ta likho.' };
    delTask(t.id);
    return { text: `🗑 **${t.title}** muche dilam.` };
  },

  task_list() {
    const open = [...tasks.filter(t => !t.done)].sort((a, b) => (a.due || 'z').localeCompare(b.due || 'z'));
    if (!open.length) return { text: 'Baki kono kaj nei 🎉', chips: ['Notun kaj add koro'] };
    const lines = open.slice(0, 10).map(t => `• ${t.title}${t.due ? ` — ⏰ ${fmtDue(t.due)}` : ''}`);
    return { text: `${open.length} ta kaj baki:\n${lines.join('\n')}`, goto: 'tasks' };
  },

  sleep_start() {
    if (activeSleep) return { text: 'Timer to age thekei cholche 🌙' };
    startSleep();
    return { text: 'Shubho ratri 🌙 Timer chalu korlam. Uthe "uthe gechi" likhle hisheb kore rakhbo.' };
  },

  sleep_end() {
    if (!activeSleep) return { text: 'Kono ghum-timer chalu nei. Manual e log korte chao? "kal 7 ghonta ghumiyechi" likho.' };
    $('#sleepMode').classList.add('hidden');
    openWake();
    const s = [...sleeps].sort((a, b) => b.date.localeCompare(a.date))[0];
    return { text: `Shuprobhat ☀️ ${humanDur(s.hours)} ghumiyecho — save kore dilam.` };
  },

  sleep_log({ hours, date }) {
    if (hours == null || isNaN(hours)) return { text: 'Koto ghonta ghumiyecho? Jemon: "kal 7 ghonta ghumiyechi".' };
    const d = date || dayKey();
    sleeps = sleeps.filter(s => s.date !== d);
    sleeps.push({ id: uid(), date: d, hours, note: '' });
    save.sleeps(); refresh();
    return { text: `😴 ${d} — ${humanDur(hours)} log holo. ${moonRating(hours)}` };
  },

  sleep_stats() {
    const sorted = [...sleeps].sort((a, b) => b.date.localeCompare(a.date));
    if (!sorted.length) return { text: 'Ekhono kono ghum log nei.' };
    const last7 = sorted.slice(0, 7);
    const avg = last7.reduce((s, x) => s + x.hours, 0) / last7.length;
    return { text: `Shesh raat: **${sorted[0].hours}h** ${moonRating(sorted[0].hours)}\n7 diner gor: **${avg.toFixed(1)}h**`, goto: 'sleep' };
  },

  checklist_toggle({ query }) {
    const it = bestMatch(query || '', clItems, x => x.label, 0.45);
    if (!it) {
      return { text: 'Kon ta? Ekhonkar option gulo:', chips: clItems.slice(0, 5).map(x => x.label) };
    }
    const before = (clLog[dayKey()] || []).includes(it.id);
    toggleChecklist(it.id); refresh();
    const done = (clLog[dayKey()] || []).length;
    return { text: `${before ? '↩️ Off korlam' : '✅'} **${it.label}** — aaj ${done}/${clItems.length} shesh.` };
  },

  checklist_add({ label, emoji }) {
    if (!label || !label.trim()) return { text: 'Option er naam ta bolo.' };
    clItems.push({ id: uid(), label: label.trim(), emoji: emoji || '✅' });
    save.clItems(); refresh();
    return { text: `Checklist e add holo: ${emoji || '✅'} **${label}**` };
  },

  checklist_status() {
    const done = (clLog[dayKey()] || []);
    if (!clItems.length) return { text: 'Checklist e kono option nei. "checklist e pani khawa add koro" likho.' };
    const left = clItems.filter(i => !done.includes(i.id));
    return {
      text: `Aaj ${done.length}/${clItems.length} shesh.` + (left.length ? `\nBaki: ${left.map(i => (i.emoji || '') + ' ' + i.label).join(', ')}` : ' Shob shesh 🎉'),
      chips: left.slice(0, 4).map(i => i.label), goto: 'checklist',
    };
  },

  note_add({ text }) {
    if (!text || !text.trim()) return { text: 'Ki likhe rakhbo?' };
    notes.push({ id: uid(), text: text.trim(), ts: Date.now() });
    save.notes(); refresh();
    return { text: `📝 Note save korlam:\n"${text.trim()}"` };
  },

  note_search({ query }) {
    const q = norm(query || '');
    const list = notes.filter(n => norm(n.text).includes(q)).sort((a, b) => b.ts - a.ts);
    if (!list.length) return { text: `"${query}" niye kono note pelam na.` };
    return { text: `${list.length} ta note pelam:\n${list.slice(0, 5).map(n => '• ' + n.text).join('\n')}`, goto: 'notes' };
  },

  sheet_add({ title, note, when, cat }) {
    if (!title && !note) return { text: 'Sheet e ki save korbo? Title ba note ta bolo.' };
    addSheetRow({ title: title || note, note: note || '', when: when || new Date(), cat: cat || 'General' });
    refresh();
    const last = sheetRows[sheetRows.length - 1];
    return { text: `📊 Sheet e save holo:\n**${last.title || 'Untitled'}**\n${fmtDue(last.when)} · ${last.cat}`, goto: 'sheet' };
  },

  sheet_list({ query }) {
    const q = norm(query || '');
    let list = [...sheetRows].sort((a, b) => new Date(b.when) - new Date(a.when));
    if (q) list = list.filter(r => norm([r.title, r.note, r.cat].join(' ')).includes(q));
    if (!list.length) return { text: q ? `"${query}" niye sheet row pelam na.` : 'Sheet e ekhono kono row nei.', goto: 'sheet' };
    return { text: `${list.length} ta sheet row:\n${list.slice(0, 6).map(r => `• ${fmtDue(r.when)} — ${r.title || r.note}`).join('\n')}`, goto: 'sheet' };
  },

  pin_add({ text, cat, title, wake }) {
    if (!text || !text.trim()) return { text: 'Ki pin korbo? Lekha ta dao.' };
    pins.push({ id: uid(), cat: cat || 'reminder', title: title || '', text: text.trim(), wake: wake !== false, ts: Date.now() });
    save.pins(); refresh();
    return { text: `📌 Pin holo (${catLabel(cat || 'reminder')}). Ghum theke uthle dekhabo.` };
  },

  checkin_save({ mood, text }) {
    const h = new Date().getHours();
    const kind = h < 14 ? 'morning' : 'evening';
    const date = dayKey();
    checkins = checkins.filter(c => !(c.date === date && c.kind === kind));
    checkins.push({ id: uid(), date, kind, answers: { mood: mood ?? null, note: (text || '').trim() }, ts: Date.now() });
    save.checkins(); refresh();
    return { text: `${MOODS[mood] ?? '📝'} ${kind === 'morning' ? 'Shokaler' : 'Rater'} check-in save holo.` };
  },

  stats_today() {
    const today = dayKey();
    const left = tasks.filter(t => !t.done && (!t.due || dayKey(new Date(t.due)) <= today)).length;
    const cl = (clLog[today] || []).length;
    const s = [...sleeps].sort((a, b) => b.date.localeCompare(a.date))[0];
    return {
      text: `**Aajker obostha**\n• Kaj baki: ${left} ${plural(left, 'ta')}\n• Checklist: ${cl}/${clItems.length}\n• Shesh ghum: ${s ? s.hours + 'h' : '–'}`,
      chips: ['Ki ki kaj baki', 'Checklist dekhao'],
    };
  },

  backup_export() { $('#exportBtn').click(); return { text: '⬇️ Backup file download hocche.' }; },

  navigate({ view }) {
    const v = { home: 'home', tasks: 'tasks', sleep: 'sleep', checklist: 'checklist', checkin: 'checkin', notes: 'notes', sheet: 'sheet', helpdesk: 'helpdesk', pins: 'pins', geo: 'geo' }[view];
    if (!v) return { text: 'Kon page e jabo bujhi nai.' };
    if (v === 'geo' && typeof openGeoView === 'function') { closeChat(); openGeoView(); return { text: 'Radar page e niye gelam.', silent: true }; }
    closeChat(); navTo(v);
    return { text: `${TITLES[v]} e niye gelam.`, silent: true };
  },

  /* ---------- chhoto-khato buddhi: hisheb, tarikh, web khoj ---------- */
  calc({ expr, val }) {
    const out = Math.round(val * 10000) / 10000;
    return { text: `**${expr} = ${out}**` };
  },

  date_answer({ kind }) {
    const now = new Date();
    const bn = { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' };
    if (kind === 'time') return { text: `Ekhon **${now.toLocaleTimeString('en-GB', { hour: 'numeric', minute: '2-digit', hour12: true })}**` };
    if (kind === 'day') return { text: `Aaj **${now.toLocaleDateString('en-GB', { weekday: 'long' })}**` };
    return { text: `Aaj **${now.toLocaleDateString('en-GB', bn)}**` };
  },

  async web_answer({ query }) {
    const q = (query || '').trim();
    if (!q) return { text: 'Ki khujbo bolo.' };
    if (!navigator.onLine) {
      return { text: `Net nei, tai khujte parchi na. 📴\nNet ashle abar jiggesh koro — ba note kore rakhi?`, chips: [`Likhe rakho ${q}`] };
    }
    const hit = await webLookup(q);
    if (!hit) {
      return {
        text: `"${q}" niye kichu pelam na 😕 Google e dekhte paro:`,
        link: { label: 'Google e khojo →', url: 'https://www.google.com/search?q=' + encodeURIComponent(q) },
      };
    }
    return {
      text: `**${hit.title}**\n${hit.extract}\n\n_— ${hit.source}_`,
      link: { label: 'Google e aro →', url: 'https://www.google.com/search?q=' + encodeURIComponent(q) },
    };
  },

  help() {
    return {
      text: `Ami ja ja korte pari — clear format e likhle mismatch kom hoy:\n• **Kaj/alarm**: "kal bikel 5 tay bazar korte hobe"\n• **Sheet**: "sheet e save koro: 5 Aug 8pm client call - payment follow-up"\n• **Note**: "likhe rakho — ammar oshudh kena lagbe"\n• **Geo alarm**: "geo alarm: Banani gele kola kinte mone koriyo"\n• **Correct**: vul add hole "oi kaj ta delete" ba same kaj abar correct time diye bolo\n• **Dekhao**: "ki ki kaj baki", "sheet dekhao", "radar dekhao"`,
      chips: ['AI Help Desk', 'Sheet dekhao', 'Ki ki kaj baki', 'Radar dekhao'],
    };
  },
};

/* ============================================================
   CHHOTO BUDDHI — hisheb, tarikh, ar free web khoj (kono API key lage na)
   ============================================================ */

/** "23*45 koto hoy", "50 er 15%" — nirapod, shudhu digit+operator cholbe */
function tryMath(raw) {
  const t = norm(raw);
  const pct = t.match(/(\d+(?:\.\d+)?)\s*(?:er|of)\s*(\d+(?:\.\d+)?)\s*%/);
  if (pct) return { expr: `${pct[1]} er ${pct[2]}%`, val: (+pct[1]) * (+pct[2]) / 100 };

  const cleaned = t
    .replace(/[×x]/g, '*').replace(/[÷]/g, '/')
    .replace(/\b(koto|hoy|hobe|kotoy|equals?|calculate|hisheb)\b|=/g, ' ')
    .replace(/\s+/g, ' ').trim();
  if (!/\d/.test(cleaned) || !/[+\-*/]/.test(cleaned)) return null;
  if (!/^[\d\s+\-*/().]+$/.test(cleaned)) return null;      // identifier dhukte parbe na
  try {
    const val = Function('"use strict"; return (' + cleaned + ')')();
    return (typeof val === 'number' && isFinite(val)) ? { expr: cleaned, val } : null;
  } catch (e) { return null; }
}

async function fetchJSON(url, ms = 8000) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), ms);
  try {
    const r = await fetch(url, { signal: ac.signal });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) { return null; }
  finally { clearTimeout(timer); }
}

/* Wikipedia — CORS khola, key lage na */
async function wikiLook(lang, q) {
  const url = `https://${lang}.wikipedia.org/w/api.php?action=query&generator=search&gsrsearch=` +
    encodeURIComponent(q) + `&gsrlimit=1&prop=extracts&exintro=1&explaintext=1&format=json&origin=*`;
  const d = await fetchJSON(url);
  const pages = d?.query?.pages;
  if (!pages) return null;
  const p = Object.values(pages)[0];
  if (!p || !p.extract) return null;
  const extract = p.extract.split('\n')[0].slice(0, 420).trim();
  if (extract.length < 20) return null;
  return { title: p.title, extract, source: `Wikipedia (${lang})` };
}

/* DuckDuckGo instant answer — eo free, key lage na */
async function ddgLook(q) {
  const d = await fetchJSON('https://api.duckduckgo.com/?format=json&no_html=1&skip_disambig=1&q=' + encodeURIComponent(q));
  const text = (d?.AbstractText || d?.Answer || '').trim();
  if (!text || text.length < 15) return null;
  return { title: d.Heading || q, extract: text.slice(0, 420), source: 'DuckDuckGo' };
}

/** Bangla wiki → English wiki → DuckDuckGo, je age pay */
async function webLookup(q) {
  const hasBangla = /[ঀ-৿]/.test(q);
  const order = hasBangla ? ['bn', 'en'] : ['en', 'bn'];
  for (const lang of order) {
    const hit = await wikiLook(lang, q);
    if (hit) return hit;
  }
  return await ddgLook(q);
}

const SEARCH_CMD = ['google koro', 'google kore', 'google e dekho', 'search koro', 'search kore', 'khuje dao', 'khoje dao', 'khuje ber koro', 'google', 'search', 'wikipedia'];
const QWORDS = ['ki', 'kake', 'kothay', 'kobe', 'keno', 'kivabe', 'kemne', 'kake', 'kon', 'karo', 'mane ki', 'ke ',
  'what', 'who', 'where', 'when', 'why', 'how', 'which', 'define', 'meaning'];

/* ============================================================
   INTENT PARSER (offline brain)
   ============================================================ */
const KW = {
  done: ['done', 'shesh', 'sesh', 'hoye gche', 'hoye geche', 'hoyeche', 'hoise', 'hoiche', 'kore felechi', 'kore felsi', 'complete', 'sompanno', 'শেষ', 'হয়েছে'],
  del: ['delete', 'muche', 'mucho', 'bad dao', 'baad dao', 'remove', 'cancel koro', 'মুছে'],
  list: ['ki ki kaj', 'kaj gulo', 'kaj koto', 'koto kaj', 'task list', 'kaj baki', 'baki kaj', 'kaj dekhao', 'list dekhao', 'কাজ'],
  addTask: ['korte hobe', 'kora lagbe', 'kortey hobe', 'mone koriye dio', 'mone koriye dao', 'reminder dao', 'reminder set', 'add koro', 'add kore', 'task add', 'kaj add', 'notun kaj', 'kaj ache', 'jete hobe', 'dite hobe', 'ante hobe', 'kinte hobe', 'porte hobe', 'lagbe', 'করতে হবে', 'মনে করিয়ে',
    /* english */
    'add in tasklist', 'add to tasklist', 'add in task', 'add to task', 'add in todo', 'add to todo',
    'remind me', 'set reminder', 'set a reminder', 'reminder at', 'add task', 'new task', 'i need to', 'i have to'],
  sleepStart: ['ghumate jachhi', 'ghumate jassi', 'ghumate jai', 'ghumte jachhi', 'shute jachhi', 'sute jassi', 'good night', 'shubho ratri', 'ghum e jachhi', 'ghumai', 'ghumacchi', 'ঘুমাতে যাচ্ছি', 'শুভ রাত্রি'],
  wake: ['uthe gechi', 'uthe gesi', 'uthlam', 'uthe porechi', 'good morning', 'shuprobhat', 'jege gechi', 'উঠে গেছি', 'সুপ্রভাত'],
  sleepLog: ['ghumiyechi', 'ghumaisi', 'ghumiyechilam', 'ghum hoyeche', 'ghumalam', 'ঘুমিয়েছি'],
  sleepStat: ['koto ghum', 'ghum koto', 'ghumer hisheb', 'ghum stat', 'ghum kemon'],
  note: ['likhe rakho', 'likhe rakh', 'note koro', 'note rakho', 'mone rakho', 'note kore rakho', 'লিখে রাখো', 'নোট'],
  noteFind: ['note khojo', 'note khoj', 'note ache', 'note e ki'],
  sheetAdd: ['sheet e save', 'sheet e rakho', 'sheet add', 'sheet e add', 'log koro', 'entry rakho', 'row add'],
  sheetList: ['sheet dekhao', 'sheet list', 'sheet kholo', 'log dekhao', 'entry dekhao'],
  pin: ['pin koro', 'pin kore rakho', 'uthe dekhabo', 'uthe dekhte chai', 'pin kor'],
  clAdd: ['checklist e add', 'checklist add', 'option add', 'checklist e notun', 'obhyash add'],
  clStat: ['checklist kemon', 'checklist dekhao', 'checklist status', 'aajker checklist', 'ki ki korlam'],
  stats: ['aaj kemon', 'ajker obostha', 'summary', 'status', 'kemon gelo', 'kemon chole', 'report'],
  backup: ['backup', 'export', 'data save koro'],
  help: ['help', 'ki korte paro', 'ki paro', 'sahajjo', 'kivabe', 'সাহায্য'],
  no: ['na', 'lagbe na', 'lagbena', 'thak', 'thak lagbe na', 'no', 'cancel', 'বাদ'],
  geoAdd: ['geo alarm', 'location alarm', 'geo reminder', 'geo add', 'location reminder', 'gele mone', 'gele amake', 'gele remind', 'gele reminder', 'gele bolo', 'jaygay gele', 'kachhe gele', 'reach korle', 'pouchle', 'pounchle', 'pouche gele', 'gele korte', 'গেলে মনে'],
  geoList: ['geo list', 'geo dekhao', 'geo koto', 'radar dekhao', 'radar list', 'kon kon jaygay', 'jaygay reminder gulo'],
  geoDel: ['geo delete', 'geo muche', 'geo bad', 'geo remove', 'radar muche', 'radar baad'],
  geoOn: ['location on', 'location chalu', 'geo on', 'geo chalu', 'tracking on', 'tracking chalu', 'radar on'],
  geoOff: ['location off', 'location bondho', 'geo off', 'geo bondho', 'tracking off', 'tracking bondho', 'radar off'],
  saveMem: ['mone rakho', 'mone rakh', 'memory add', 'save memory', 'remember that', 'remember', 'মনে রাখো'],
};
const MOOD_WORDS = [
  { k: ['khub kharap', 'জঘন্য', 'terrible', 'awful'], v: 0 },
  { k: ['kharap', 'bhalo na', 'valo na', 'mon kharap', 'bad', 'খারাপ'], v: 1 },
  { k: ['moto muti', 'motamuti', 'thik ache', 'ok', 'okay', 'chole', 'মোটামুটি'], v: 2 },
  { k: ['bhalo', 'valo', 'good', 'fine', 'ভালো'], v: 3 },
  { k: ['darun', 'osadharon', 'khub bhalo', 'khub valo', 'great', 'amazing', 'দারুণ'], v: 4 },
];

/* command noise ja title e thakbe na.
   NOTE: "hobe"/"lagbe" eka rakhchi — "chul katte hbe" title tahole thik thake. */
const NOISE = [
  'mone koriye dio', 'mone koriye dao', 'mone kore dio', 'reminder dao', 'reminder set koro', 'reminder set',
  'add kore dao', 'add kore dio', 'add koro', 'add kore', 'task add koro', 'kaj add koro',
  'amake', 'amar', 'ami', 'please', 'plz', 'ekta', 'notun kaj', 'notun task', 'task', 'kaj ta', 'kaj',
  'kora lagbe', 'kore dio', 'kore felte hobe',
  /* english command gulo */
  'add in tasklist', 'add to tasklist', 'add in task list', 'add to task list', 'add in todo', 'add to todo',
  'in tasklist', 'to tasklist', 'tasklist', 'task list', 'todo list', 'todo',
  'set a reminder', 'set reminder', 'reminder at', 'remind me at', 'remind me', 'reminder', 'remind',
  'add it', 'add this', 'add', 'day',
];

/* user quote e likhle oita-i title — "battery kinte hobe" day: today */
function quotedTitle(raw) {
  const m = String(raw || '').match(/["“”'‘’]([^"“”'‘’]{2,80})["“”'‘’]/);
  return m ? m[1].trim() : '';
}
function cleanTitle(raw, hits) {
  let t = norm(raw);
  for (const h of hits) t = t.split(h).join(' ');
  for (const n of NOISE) t = t.split(' ' + n + ' ').join(' ');
  NOISE.forEach(n => {
    t = t.replace(new RegExp('(^|\\s)' + n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\s|$)', 'g'), ' ');
  });
  t = t.replace(/\s+/g, ' ').trim();
  return t ? t[0].toUpperCase() + t.slice(1) : '';
}
/* "note koro X" -> X ; keyword er por ja ache */
function after(raw, keys) {
  const t = norm(raw);
  for (const k of keys) {
    const i = t.indexOf(k);
    if (i >= 0) return t.slice(i + k.length).replace(/^[\s—:-]+/, '').trim();
  }
  return '';
}

/* somoy-shobdo bad dile ar kichu na thakle = eta shudhu somoy-er uttor */
const TIME_FILLER = new Set(['e', 'te', 'tay', 'ta', 'tar', 'por', 'pore', 'baade', 'bade', 'koro', 'kore', 'dio', 'dao', 'set', 'kore dio', 'ok', 'accha', 'thik ache']);
function isOnlyTime(raw, hits) {
  let t = norm(raw);
  for (const h of hits) t = t.split(h).join(' ');
  return t.split(/\s+/).filter(w => w && !TIME_FILLER.has(w)).length === 0;
}

let chatPending = null;   // multi-turn context

/**
 * Ekta message porey ki korte hobe thik kore.
 * @returns {{action:string, args:object, sure:boolean}}
 */
function parseIntent(raw) {
  const t = norm(raw);
  if (!t) return { action: 'help', args: {}, sure: false };

  /* ---- pending (multi-turn) ---- */
  if (chatPending && chatPending.type === 'task_time') {
    const p = chatPending; chatPending = null;
    if (has(t, KW.no)) return { action: '_noop', args: { text: 'Thik ache, shomoy chara-i rakhlam.' }, sure: true };
    const w = parseWhen(raw);
    /* shudhu tokhon-i shomoy hishebe nibo jokhon puro message-ta somoy —
       na hole "aajker checklist kemon" er "aaj" ke reminder mone kore boshbe */
    if (w.when && isOnlyTime(raw, w.hits)) {
      return { action: '_settime', args: { id: p.id, when: w.when.toISOString() }, sure: true };
    }
    /* na hole normal parse e jabo */
  }

  /* ---- sleep (agey, karon "ghumate jachhi" te "jachhi" ache) ---- */
  if (hasAny(t, KW.sleepStart)) return { action: 'sleep_start', args: {}, sure: true };
  if (hasAny(t, KW.wake)) return { action: 'sleep_end', args: {}, sure: true };
  if (hasAny(t, KW.sleepLog)) {
    const hrs = parseHours(raw);
    const w = parseWhen(raw);
    let date = dayKey();
    if (/\bkal\b|\bkalke\b|gotokal|গতকাল|কাল/.test(t) && w.when) {
      const d = new Date(); d.setDate(d.getDate() - 1); date = dayKey(d);
    }
    return { action: 'sleep_log', args: { hours: hrs, date }, sure: hrs != null };
  }
  if (hasAny(t, KW.sleepStat)) return { action: 'sleep_stats', args: {}, sure: true };

  /* ---- help / stats / backup ---- */
  if (/ai help desk|help desk|guide dekhao/.test(t)) return { action: 'navigate', args: { view: 'helpdesk' }, sure: true };
  if (hasAny(t, KW.help)) return { action: 'help', args: {}, sure: true };
  if (hasAny(t, KW.backup)) return { action: 'backup_export', args: {}, sure: true };
  if (hasAny(t, KW.clStat)) return { action: 'checklist_status', args: {}, sure: true };
  if (hasAny(t, KW.stats)) return { action: 'stats_today', args: {}, sure: true };

  /* ---- note ---- */
  if (hasAny(t, KW.saveMem)) return { action: 'save_memory', args: { fact: after(raw, KW.saveMem) || raw }, sure: true };
  if (hasAny(t, KW.noteFind)) return { action: 'note_search', args: { query: after(raw, KW.noteFind) }, sure: true };
  if (hasAny(t, KW.sheetList)) return { action: 'sheet_list', args: { query: after(raw, KW.sheetList) }, sure: true };
  if (hasAny(t, KW.sheetAdd)) {
    const w = parseWhen(raw);
    const body = after(raw, KW.sheetAdd) || cleanTitle(raw, w.hits) || raw;
    const [title, ...rest] = body.split(/\s+-\s+|:/);
    return { action: 'sheet_add', args: { title: (title || body).trim(), note: rest.join(' - ').trim(), when: w.when ? w.when.toISOString() : null }, sure: true };
  }
  if (hasAny(t, KW.note)) return { action: 'note_add', args: { text: after(raw, KW.note) || raw }, sure: true };

  /* ---- pin ---- */
  if (hasAny(t, KW.pin)) {
    const text = after(raw, KW.pin) || raw;
    const cat = /dua|দোয়া/.test(t) ? 'dua' : /niyom|rule|নিয়ম/.test(t) ? 'rule' : 'reminder';
    return { action: 'pin_add', args: { text, cat, wake: true }, sure: true };
  }

  /* ---- checklist ---- */
  if (hasAny(t, KW.clAdd)) {
    return { action: 'checklist_add', args: { label: after(raw, KW.clAdd) }, sure: true };
  }
  /* "checklist e boi pora add koro" — je kono shajano bhabe */
  if (/checklist|obhyash|অভ্যাস/.test(t) && hasAny(t, ['add', 'notun', 'jog koro', 'যোগ'])) {
    const label = cleanTitle(t.replace(/checklist|obhyash|অভ্যাস/g, ' '), ['add koro', 'add kore dao', 'add', 'notun', 'jog koro', ' e ']);
    return { action: 'checklist_add', args: { label }, sure: true };
  }
  /* "namaz porechi" — checklist option er shathe mile jay kina */
  const clHit = bestMatch(raw, clItems, x => x.label, 0.6);
  if (clHit && !hasAny(t, KW.addTask)) return { action: 'checklist_toggle', args: { query: raw }, sure: true };

  /* ---- task ---- */
  const wantsAdd = hasAny(t, KW.addTask) || /\b\w{2,}(?:te|ite|ate|ete)\s+(?:hobe|hbe|habe|hoibe|lagbe)\b/.test(t);
  if (hasAny(t, KW.del)) return { action: 'task_delete', args: { query: cleanTitle(raw, KW.del) }, sure: true };
  /* "add to task list" e 'task list' ache — tai add-intent thakle list dekhabo na */
  if (hasAny(t, KW.list) && !wantsAdd) return { action: 'task_list', args: {}, sure: true };
  if (hasAny(t, KW.done)) {
    const q = cleanTitle(raw, KW.done);
    return { action: 'task_done', args: { query: q }, sure: true };
  }
  /* mood / check-in */
  const mood = MOOD_WORDS.slice().reverse().find(m => hasAny(t, m.k));
  if (mood && /mood|mejaj|mon|feel|lagche|মেজাজ|মন/.test(t)) {
    return { action: 'checkin_save', args: { mood: mood.v, text: raw }, sure: true };
  }
  /* navigation */
  const navHit = { home: ['home e', 'aaj dekhao'], tasks: ['kaj er page', 'task page'], sleep: ['ghum page', 'ghum dekhao'], checklist: ['checklist page'], notes: ['note dekhao', 'notes dekhao'], sheet: ['sheet page', 'sheet dekhao', 'log page'], helpdesk: ['ai help desk', 'help desk', 'guide dekhao'], pins: ['pin dekhao'], checkin: ['check in dekhao', 'checkin dekhao'], geo: ['radar page', 'radar dekhao', 'geo page', 'geo dekhao', 'location page'] };
  for (const [v, keys] of Object.entries(navHit)) if (hasAny(t, keys)) return { action: 'navigate', args: { view: v }, sure: true };

  /* ---- geo / location reminder ---- */
  if (hasAny(t, KW.geoOn)) return { action: 'geo_enable', args: {}, sure: true };
  if (hasAny(t, KW.geoOff)) return { action: 'geo_disable', args: {}, sure: true };
  if (hasAny(t, KW.geoList)) return { action: 'geo_list', args: {}, sure: true };
  if (hasAny(t, KW.geoDel)) {
    const q = cleanTitle(raw, KW.geoDel);
    return { action: 'geo_delete', args: { query: q }, sure: true };
  }
  if (hasAny(t, KW.geoAdd)) {
    /* "Dhanmondi gele amake boi kinar kotha mone koriye dio" */
    const geoText = t
      .replace(/^(geo|location)\s+(alarm|reminder)\s*/i, '')
      .replace(/^alarm\s*/i, '')
      .replace(/^[\s:-]+/, '');
    const parts = geoText.split(/\s*gele\s*/i);
    let place = '', label = '';
    if (parts.length >= 2) {
      place = parts[0].replace(/^(ami |amake |amar |)/, '').trim();
      label = parts.slice(1).join(' ')
        .replace(/\b(amake|amar|mone koriye dio|mone koriye dao|mone koriyo|mone korio|remind koro|reminder|remind me|bolo|bolbe)\b/g, ' ')
        .replace(/\s+/g, ' ').trim();
    }
    if (!label && !place) {
      label = cleanTitle(raw, KW.geoAdd);
    }
    return { action: 'geo_add', args: { label: label ? label[0].toUpperCase() + label.slice(1) : '', place }, sure: true };
  }

  if (wantsAdd) {
    const w = parseWhen(raw);
    return { action: 'task_add', args: { title: quotedTitle(raw) || cleanTitle(raw, w.hits), due: w.when ? w.when.toISOString() : null }, sure: true };
  }

  /* ---- chhoto buddhi: hisheb / tarikh / khoj ----
     ei gulo somoy-fallback er AGE, na hole "aaj ki bar" ke reminder mone kore boshe */
  const math = tryMath(raw);
  if (math) return { action: 'calc', args: math, sure: true };

  if (/koto baje|somoy koto|what time|ekhon koto/.test(t)) return { action: 'date_answer', args: { kind: 'time' }, sure: true };
  if (/ki bar|kon bar|what day|which day/.test(t)) return { action: 'date_answer', args: { kind: 'day' }, sure: true };
  if (/koto tarikh|aajker tarikh|what.s the date|today.s date|date koto/.test(t)) return { action: 'date_answer', args: { kind: 'date' }, sure: true };

  if (hasAny(t, SEARCH_CMD)) {
    return { action: 'web_answer', args: { query: after(raw, SEARCH_CMD) || raw }, sure: true };
  }

  /* somoy ache mane sombhoboto reminder */
  const w = parseWhen(raw);
  if (w.when && w.hits.length) {
    return { action: 'task_add', args: { title: quotedTitle(raw) || cleanTitle(raw, w.hits), due: w.when.toISOString() }, sure: false };
  }

  /* proshno-r moto shonale web e dekhi (shob app-intent er por, tai kaj-e badha dey na) */
  if ((hasAny(t, QWORDS) || /\?\s*$/.test(String(raw))) && t.split(' ').length >= 2) {
    return { action: 'web_answer', args: { query: raw }, sure: false };
  }

  /* kichu bujhi nai */
  return { action: '_unknown', args: { raw }, sure: false };
}

/* internal actions */
ACTIONS._noop = ({ text }) => ({ text });
ACTIONS._settime = ({ id, when }) => {
  const t = tasks.find(x => x.id === id);
  if (!t) return { text: 'Kaj ta pelam na.' };
  t.due = when; t.notified = false; save.tasks(); refresh(); checkDueTasks();
  return { text: `⏰ **${t.title}** — ${fmtDue(when)} e mone koriye dibo.` };
};
ACTIONS._unknown = ({ raw }) => ({
  text: `Ekdom bujhlam na 🤔 Eta ki kaj hishebe rakhbo, na khuje dekhbo?`,
  chips: [`Kaj: ${String(raw).slice(0, 24)}`, 'Note kore rakho', `Google koro ${String(raw).slice(0, 30)}`],
  link: { label: 'Google e khojo →', url: 'https://www.google.com/search?q=' + encodeURIComponent(raw) },
});

/* kichu action (web khoj) async — tai shob-tai await kore chalai */
async function runAction(name, args) {
  const fn = ACTIONS[name];
  if (!fn) return { text: 'Ei kaj ta ekhono pari na.' };
  try { return await fn(args || {}); }
  catch (e) {
    console.error('[persona-ai] action fail', name, e);
    return { text: `Kaj ta korte giye somossa holo (${name}: ${e.message}).` };
  }
}

/* ============================================================
   LLM MODE (optional) — Gemini free tier
   ============================================================ */
const LLM_TOOLS = `
task_add{title:string, due?:ISO datetime}
task_done{query:string}       task_delete{query:string}      task_list{}
sleep_start{}  sleep_end{}    sleep_log{hours:number, date?:YYYY-MM-DD}   sleep_stats{}
checklist_toggle{query:string}  checklist_add{label:string, emoji?:string}  checklist_status{}
note_add{text:string}   note_search{query:string}
sheet_add{title:string, note?:string, when?:ISO datetime, cat?:string}  sheet_list{query?:string}
pin_add{text:string, cat?:"dua"|"rule"|"reminder", title?:string, wake?:boolean}
checkin_save{mood:0..4, text?:string}
stats_today{}  backup_export{}  navigate{view:"home"|"tasks"|"sleep"|"checklist"|"checkin"|"notes"|"sheet"|"helpdesk"|"pins"|"geo"}  help{}
geo_add{label:string, place:string, radius?:number}  geo_list{}  geo_delete{query:string}  geo_enable{}  geo_disable{}
save_memory{fact:string}`;

function stateSummary() {
  const open = tasks.filter(t => !t.done).slice(0, 20).map(t => `- ${t.title}${t.due ? ' (due ' + t.due + ')' : ''}`);
  const doneIds = new Set(clLog[dayKey()] || []);
  return [
    `Ekhon: ${new Date().toString()}`,
    `Baki kaj (${tasks.filter(t => !t.done).length}):`, open.join('\n') || '- nei',
    `Checklist option: ${clItems.map(i => i.label + (doneIds.has(i.id) ? ' [aaj done]' : '')).join(', ') || 'nei'}`,
    `Ghum cholche: ${activeSleep ? 'ha, shuru ' + activeSleep.start : 'na'}`,
    `Shesh ghum: ${[...sleeps].sort((a, b) => b.date.localeCompare(a.date))[0]?.hours ?? '-'} h`,
    `Note count: ${notes.length}, Sheet row: ${typeof sheetRows !== 'undefined' ? sheetRows.length : 0}, Pin count: ${pins.length}`,
    `Geo-reminder: ${typeof geoTasks !== 'undefined' ? geoTasks.length : 0} ta`,
  ].join('\n');
}

/* ---------- uttor er size ---------- */
const LEN_OPTS = {
  short: { label: 'Chhoto',    tokens: 500,  hint: '1–2 line — quick jobab',        style: 'Uttor khub chhoto rakho — sorbochcho 2 line.' },
  mid:   { label: 'Majhari',   tokens: 1200, hint: '3–5 line — default',            style: 'Uttor chhoto rakho — sorbochcho 5 line.' },
  long:  { label: 'Boro',      tokens: 2600, hint: '1–2 paragraph — byakkha soho',  style: 'Ek theke dui paragraph porjonto uttor dite paro.' },
  full:  { label: 'Bistarito', tokens: 6000, hint: 'Full — heading, step, list',    style: 'Bistarito uttor dao — dorkar hole heading, bullet ar step-by-step byakkha use koro.' },
};
const lenCfg = () => LEN_OPTS[aiCfg.len] || LEN_OPTS.mid;

/* ---------- model list ---------- */
const FALLBACK_MODELS = [
  'gemini-3.6-flash', 'gemini-3.6-pro',
  'gemini-flash-latest', 'gemini-pro-latest',
  'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.5-pro',
];

/** Tomar nijer key diye Google er kachhe jiggesh kore asol model list ene rakhe. */
async function fetchModels() {
  if (!aiConfigured()) throw new Error('Age API key ba passphrase dao, tarpor model list ana jabe');
  const t = apiTarget('models', { pageSize: 200 });
  const res = await fetch(t.url, { headers: t.headers });
  if (!res.ok) throw await apiError(res);
  const data = await res.json();
  const list = (data.models || [])
    .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map(m => String(m.name || '').replace(/^models\//, ''))
    .filter(n => n.startsWith('gemini'))
    .sort();
  if (!list.length) throw new Error('Ei key te generateContent kore emon kono model nei');
  aiModels = list;
  DB.set('aiModels', aiModels);
  return list;
}

/* ---------- error → manush-pora bhasha ---------- */
const ERR_MAP = {
  400: 'Request ta API nilo na — API key ba model ID thik nei.',
  401: 'API key ta invalid. aistudio.google.com theke notun key nao.',
  403: 'Ei key te permission nei — key ta enable ache kina dekho.',
  404: 'Ei model ta tomar key te nei. Settings e "Refresh" diye asol list theke beche nao.',
  429: 'Quota/rate limit shesh. Ektu por abar try koro.',
  500: 'Google er server e somossa hoyeche. Abar try koro.',
  503: 'Model ta ekhon overloaded. Ektu por abar try koro.',
};

async function apiError(res) {
  let detail = '';
  try { detail = (await res.json())?.error?.message || ''; }
  catch (_) { detail = await res.text().catch(() => ''); }
  /* proxy mode e 401 mane key na, passphrase bhul */
  const base = (usingProxy() && res.status === 401)
    ? 'Passphrase ta thik nei — settings er "Cloud access" e thik ta dao.'
    : (ERR_MAP[res.status] || `API error ${res.status}.`);
  const e = new Error(detail ? `${base} (${String(detail).slice(0, 120)})` : base);
  e.status = res.status;
  return e;
}

/* ---------- usage tracking ---------- */
function trackUsage(um) {
  if (!um) return;
  const k = dayKey();
  const d = aiUsage[k] || (aiUsage[k] = { req: 0, in: 0, out: 0 });
  d.req += 1;
  d.in += um.promptTokenCount || 0;
  d.out += (um.candidatesTokenCount || 0) + (um.thoughtsTokenCount || 0);
  const days = Object.keys(aiUsage).sort();
  while (days.length > 30) delete aiUsage[days.shift()];
  DB.set('aiUsage', aiUsage);
  renderUsage();
}

/**
 * Adhek-asha JSON theke ekta string field er joto tuku eseche toto tuku ber kore.
 * Streaming e `{"reply":"Hoye ge` porjonto ashle-o user ke live text dekhate pari.
 */
function partialJsonString(buf, key) {
  const kk = `"${key}"`;
  const ki = buf.indexOf(kk);
  if (ki < 0) return '';
  const ci = buf.indexOf(':', ki + kk.length);
  if (ci < 0) return '';
  let i = ci + 1;
  while (i < buf.length && /\s/.test(buf[i])) i++;
  if (buf[i] !== '"') return '';
  i++;
  let out = '';
  while (i < buf.length) {
    const ch = buf[i];
    if (ch === '\\') {
      const n = buf[i + 1];
      if (n === undefined) break;                      // escape adhek eseche, porer chunk e ashbe
      if (n === 'u') {
        if (i + 6 > buf.length) break;
        out += String.fromCharCode(parseInt(buf.slice(i + 2, i + 6), 16));
        i += 6; continue;
      }
      out += ({ n: '\n', t: '\t', r: '\r', b: '\b', f: '\f' }[n] ?? n);
      i += 2; continue;
    }
    if (ch === '"') break;
    out += ch; i++;
  }
  return out;
}

/**
 * History + ekhonkar chobi diye Gemini `contents` banay.
 * Chobi bhari, tai sob mile MAX_CTX_IMGS tar beshi kokhono pathai na.
 */
async function buildContents(userText, images) {
  const cur = (images || []).slice(0, MAX_ATTACH);
  let budget = Math.max(0, MAX_CTX_IMGS - cur.length);

  const hist = chatLog.slice(-10).filter(m => !m.warn && !m.streaming && (m.text || (m.imgs || []).length));
  /* natun theke purono dike ghure budget bilai — sob theke relevant chobi gulo tikbe */
  const allow = new Set();
  for (let i = hist.length - 1; i >= 0 && budget > 0; i--) {
    if (hist[i].role !== 'u') continue;
    for (const id of (hist[i].imgs || [])) {
      if (budget <= 0) break;
      allow.add(id); budget--;
    }
  }

  const out = [];
  for (const m of hist) {
    const role = m.role === 'u' ? 'user' : 'model';
    const parts = [];
    if (role === 'user') {
      for (const id of (m.imgs || [])) {
        if (!allow.has(id)) continue;
        const rec = imgCache.get(id) || await IMG.get(id).catch(() => null);
        if (rec) parts.push({ inlineData: { mimeType: 'image/jpeg', data: b64(rec.full) } });
      }
    }
    if (m.text) parts.push({ text: m.text });
    if (!parts.length) continue;
    /* Gemini pashapashi ek-i role pochondo kore na — merge kore di */
    const last = out[out.length - 1];
    if (last && last.role === role) last.parts.push(...parts);
    else out.push({ role, parts });
  }

  const parts = cur.map(im => ({ inlineData: { mimeType: 'image/jpeg', data: b64(im.full) } }));
  parts.push({ text: userText || 'Ei chobi ta dekho ar bujhiye dao.' });
  const last = out[out.length - 1];
  if (last && last.role === 'user') last.parts.push(...parts);
  else out.push({ role: 'user', parts });
  return out;
}

let aiAbort = null;   // cholte thaka request — Stop button ekhane abort kore

/**
 * Gemini ke jiggesh kore. SSE streaming, tai uttor word-by-word ashe.
 * `onDelta(text)` protibar notun tuku niye dak pore.
 */
async function askLLM(userText, memCtx = '', images = [], onDelta = null) {
  const L = lenCfg();
  const sys = `Tumi "Persona" — ekta personal companion app er assistant. User Banglish/Bangla/English mishiye kotha bole. Tumi-o Banglish e uttor dao. ${L.style}
Tomar kachhe ei tool gulo ache:${LLM_TOOLS}
Jodi user er kono personal kotha/facts pash (jemon pet er nam, allergy, pochondo, favourite khabar), tahole save_memory tool call korbe.
User er kotha bujhe joto gulo dorkar toto action banao. Kono action dorkar na hole actions faka rakho.
User chobi pathale chobi ta dhore-i uttor dao — ki dekhcho ta bolo, ar dorkar hole sekhan theke task/note banao.
App er ekhonkar obostha:
${stateSummary()}
${memCtx ? 'User er byapare tomar purano memory (Semantic Search results):\n' + memCtx : ''}
Shudhu ei JSON format e uttor dao: {"reply":"...","actions":[{"name":"task_add","args":{"title":"..."}}],"chips":["..."]}`;

  const t = apiTarget(`models/${aiCfg.model}:streamGenerateContent`, { alt: 'sse' });
  const body = {
    systemInstruction: { parts: [{ text: sys }] },
    contents: await buildContents(userText, images),
    generationConfig: { responseMimeType: 'application/json', temperature: 0.4, maxOutputTokens: L.tokens },
  };

  aiAbort = new AbortController();
  const ac = aiAbort;
  let timedOut = false;
  const timeoutMs = L.tokens > 2000 ? 120000 : 60000;
  const timer = setTimeout(() => { timedOut = true; ac.abort(); }, timeoutMs);

  let json = '', shown = '', finish = '', usage = null;
  const feed = (text) => {
    for (const line of text.split('\n')) {
      const t = line.trim();
      if (!t.startsWith('data:')) continue;
      const payload = t.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      let chunk;
      try { chunk = JSON.parse(payload); } catch (_) { continue; }
      const c = chunk.candidates?.[0];
      json += (c?.content?.parts || []).map(p => p.text || '').join('');
      if (c?.finishReason) finish = c.finishReason;
      if (chunk.usageMetadata) usage = chunk.usageMetadata;
      const partial = partialJsonString(json, 'reply');
      if (onDelta && partial && partial !== shown) { shown = partial; onDelta(partial); }
    }
  };

  try {
    const res = await fetch(t.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...t.headers },
      body: JSON.stringify(body),
      signal: aiAbort.signal,
    });
    if (!res.ok) throw await apiError(res);

    if (res.body && res.body.getReader) {
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const cut = buf.lastIndexOf('\n');
        if (cut < 0) continue;
        feed(buf.slice(0, cut));
        buf = buf.slice(cut + 1);
      }
      if (buf.trim()) feed(buf);
    } else {
      feed(await res.text());       // stream support na thakle ek shathe
    }
  } catch (e) {
    if (e.name === 'AbortError') {
      /* timeout ar user er Stop — duita alada jinish, alada bhabe handle korte hobe */
      if (timedOut) throw new Error(`${Math.round(timeoutMs / 1000)}s eo API uttor dilo na. Net ba model dekho.`);
      const err = new Error('Thamano hoyeche');
      err.aborted = true; err.partial = shown;
      throw err;
    }
    throw e;
  } finally {
    clearTimeout(timer);
    aiAbort = null;
  }

  trackUsage(usage);

  let out;
  try { out = JSON.parse(json); }
  catch (_) {
    if (!shown) throw new Error('AI er uttor ta pora gelo na — abar chesta koro');
    out = { reply: shown, actions: [], chips: [] };    // JSON kete geche, text tuku bachai
  }
  out._finish = finish;
  return out;
}

/* ============================================================
   CHAT ENGINE
   ============================================================ */
function pushMsg(role, text, extra = {}) {
  const m = { mid: uid(), role, text, ts: Date.now(), ...extra };
  chatLog.push(m); saveChat(); renderChat();
  return m;
}

/**
 * Ek dfa AI turn — streaming reply, tarpor action gulo chalay.
 * `true` ferot dile AI parlo; `false` dile caller offline brain e chole jabe.
 */
async function runAiTurn(text, images) {
  const holder = pushMsg('b', '', { via: 'ai', streaming: true, src: { text, imgs: (images || []).map(i => i.id) } });
  setStreaming(true);
  try {
    let memCtx = '';
    if (typeof RAG !== 'undefined' && RAG.ready) {
      const mems = await RAG.search(text, 3);
      if (mems.length) memCtx = mems.map(m => '- ' + m.text).join('\n');
    }

    const out = await askLLM(text, memCtx, images, delta => {
      holder.text = delta;
      paintStream(holder);
    });

    const results = [];
    for (const a of (out.actions || [])) results.push(await runAction(a.name, a.args));
    const extra = results.filter(r => r && r.text && !r.silent).map(r => r.text).join('\n');

    holder.text = [out.reply, extra].filter(Boolean).join('\n\n') || 'Hoye gelo ✅';
    holder.chips = out.chips || [];
    delete holder.streaming;
    /* uttor ta token limit e kete gele user ke bolo ki korte hobe */
    if (out._finish === 'MAX_TOKENS') {
      holder.chips = [...holder.chips, '⚙️ Uttor er size barao'];
      holder.truncated = true;
    }
    saveChat(); renderChat();
    return true;
  } catch (e) {
    /* user nijei Stop chepeche — eta fail na, tai warn ba offline fallback kichui na */
    if (e.aborted) {
      const i = chatLog.indexOf(holder);
      if (e.partial) {
        holder.text = e.partial;
        holder.stopped = true;
        delete holder.streaming;
      } else if (i >= 0) {
        chatLog.splice(i, 1);
        toast('Thamano holo');
      }
      saveChat(); renderChat();
      return true;
    }
    console.warn('[persona-ai] LLM fail, offline brain e ferot', e);
    const i = chatLog.indexOf(holder);
    if (i >= 0) chatLog.splice(i, 1);
    pushMsg('b', `AI mode kaj korlo na — ${e.message}`, { warn: true, retry: true });
    return false;
  } finally {
    setStreaming(false);
  }
}

/** Kono AI reply abar generate koray (⟳ button). */
async function regenerate(mid) {
  const i = chatLog.findIndex(m => m.mid === mid);
  if (i < 0) return;
  const src = chatLog[i].src;
  if (!src) { toast('Ei message ta abar banano jabe na'); return; }
  chatLog.splice(i, 1);
  saveChat(); renderChat();
  const imgs = [];
  for (const id of (src.imgs || [])) {
    const rec = imgCache.get(id) || await IMG.get(id).catch(() => null);
    if (rec) imgs.push(rec);
  }
  await runAiTurn(src.text, imgs);
}

async function handleUserText(raw, attachments) {
  const text = String(raw || '').trim();
  const imgs = attachments || [];
  if (!text && !imgs.length) return;

  for (const im of imgs) {
    imgCache.set(im.id, im);
    try { await IMG.put(im); }
    catch (e) { console.error('[persona-ai] chobi save fail', im.id, e); }
  }
  pushMsg('u', text, imgs.length ? { imgs: imgs.map(i => i.id) } : {});

  const aiReady = aiCfg.on && aiConfigured() && navigator.onLine;
  if (imgs.length && !aiReady) {
    pushMsg('b', 'Chobi bujhte AI mode lagbe — ⚙️ theke nijer Gemini key diye AI mode on koro. (Net na thakleo AI cholbe na.)', { warn: true });
    if (!text) return;
  }

  setTyping(true);
  try {
    if (aiReady && await runAiTurn(text, imgs)) return;

    const intent = parseIntent(text);

    /* offline RAG memory recall (no LLM required) */
    if ((intent.action === '_unknown' || intent.action === 'web_answer') && typeof RAG !== 'undefined' && RAG.ready) {
       const mems = await RAG.search(text, 1);
       if (mems.length > 0 && mems[0].score > 0.4) {
          pushMsg('b', `🧠 Amar memory theke:\n"${mems[0].text}"`);
          return;
       }
    }

    const r = await runAction(intent.action, intent.args);
    if (!r.silent) pushMsg('b', r.text, { chips: r.chips || [], goto: r.goto, link: r.link });
  } finally {
    setTyping(false);
    IMG.gc();
  }
}

/* ============================================================
   CHAT UI
   ============================================================ */
let chatOpen = false;

function mdLite(s) {
  return esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(/\n/g, '<br>');
}

const LEN_CHIP = '⚙️ Uttor er size barao';

function scrollChat() {
  const box = $('#chatBody');
  if (box) box.scrollTop = box.scrollHeight;
}

function imgGridHtml(m) {
  const ids = m.imgs || [];
  if (!ids.length) return '';
  return `<div class="msg-imgs${ids.length === 1 ? ' one' : ''}">${ids.map(id => {
    const rec = imgCache.get(id);
    return rec
      ? `<button class="msg-img" data-img="${esc(id)}" type="button" aria-label="Chobi boro kore dekho"><img src="${rec.thumb}" alt="Pathano chobi"></button>`
      : `<button class="msg-img ph" data-img="${esc(id)}" type="button" aria-label="Chobi load hocche"></button>`;
  }).join('')}</div>`;
}

function msgHtml(m) {
  const cls = ['msg', m.role === 'u' ? 'me' : 'bot'];
  if (m.warn) cls.push('warn');
  if (m.streaming) cls.push('streaming');

  const body = m.streaming && !m.text
    ? '<span class="think"><i></i><i></i><i></i></span>'
    : mdLite(m.text) + (m.streaming ? '<span class="caret"></span>' : '');

  const foot = [];
  if (m.via === 'ai' && !m.streaming) {
    foot.push(`<button class="msg-act" data-copy="${esc(m.mid || '')}" type="button" title="Copy">Copy</button>`);
    if (m.src) foot.push(`<button class="msg-act" data-regen="${esc(m.mid || '')}" type="button" title="Abar banao">⟳ Abar</button>`);
  }
  if (m.retry) foot.push('<button class="msg-act" data-retry="1" type="button">↻ Abar chesta</button>');
  if (m.stopped) foot.push('<span class="msg-note">⏹ thamano hoyeche</span>');
  if (m.truncated) foot.push('<span class="msg-note">uttor ta kete geche</span>');

  return `<div class="${cls.join(' ')}" data-mid="${esc(m.mid || '')}">
      ${imgGridHtml(m)}
      <div class="bubble">${body}</div>
      <div class="msg-foot">
        ${m.via === 'ai' ? `<span class="msg-tag">${esc(aiCfg.model)}</span>` : ''}
        ${foot.join('')}
      </div>
    </div>`;
}

function renderChat() {
  const box = $('#chatBody');
  if (!box) return;
  if (!chatLog.length) {
    box.innerHTML = `<div class="chat-intro">
        <div class="chat-intro-ico">✨</div>
        <b>Ami Persona</b>
        <p>Ja korte chao just likhe dao — kaj, ghum, checklist, note, sob ami kore dibo.
        AI mode on thakle chobi-o pathate paro.</p>
      </div>`;
  } else {
    box.innerHTML = chatLog.map(msgHtml).join('');
  }

  box.querySelectorAll('[data-copy]').forEach(b => b.onclick = () => {
    const m = chatLog.find(x => x.mid === b.dataset.copy);
    if (!m) return;
    navigator.clipboard?.writeText(m.text).then(() => toast('Copy hoye geche'),
      () => toast('Copy kora gelo na'));
  });
  box.querySelectorAll('[data-regen]').forEach(b => b.onclick = () => regenerate(b.dataset.regen));
  box.querySelectorAll('[data-retry]').forEach(b => b.onclick = () => {
    const lastUser = [...chatLog].reverse().find(m => m.role === 'u');
    if (lastUser) regenerateFromUser(lastUser);
  });
  box.querySelectorAll('.msg-img').forEach(b => b.onclick = () => openLightbox(b.dataset.img));

  /* shesh message er chips */
  const last = chatLog[chatLog.length - 1];
  const chipBox = $('#chatChips');
  const chips = (last && last.role === 'b' && last.chips && last.chips.length)
    ? last.chips
    : (!chatLog.length ? ['Ki ki kaj baki', 'Aaj kemon gelo', 'Ghumate jachhi', 'Ki korte paro?'] : []);
  chipBox.innerHTML = chips.map(c => `<button class="chat-chip">${esc(c)}</button>`).join('');
  $$('#chatChips .chat-chip').forEach(b => b.onclick = () => {
    if (b.textContent === LEN_CHIP) { openSettings(); return; }
    handleUserText(b.textContent);
  });
  if (last && last.goto) {
    chipBox.insertAdjacentHTML('afterbegin', `<button class="chat-chip go" data-goto-chat="${last.goto}">Dekhao →</button>`);
    const g = chipBox.querySelector('[data-goto-chat]');
    g.onclick = () => { closeChat(); navTo(last.goto); };
  }
  if (last && last.link) {
    chipBox.insertAdjacentHTML('afterbegin',
      `<a class="chat-chip go" href="${esc(last.link.url)}" target="_blank" rel="noopener noreferrer">${esc(last.link.label)}</a>`);
  }
  scrollChat();
  hydrateImgs();
}

/** IDB theke thumb ene placeholder gulo bhore dey (render sync rakhar jonno alada). */
async function hydrateImgs() {
  for (const el of $$('#chatBody .msg-img.ph')) {
    const id = el.dataset.img;
    let rec = imgCache.get(id);
    if (!rec) rec = await IMG.get(id).catch(() => null);
    el.classList.remove('ph');
    if (rec) { imgCache.set(id, rec); el.innerHTML = `<img src="${rec.thumb}" alt="Pathano chobi">`; }
    else { el.classList.add('gone'); el.textContent = '🖼'; el.disabled = true; }
  }
}

/** Streaming cholakalin shudhu oi bubble tuku badlai — puro list re-render korle scroll lafai. */
function paintStream(m) {
  setTyping(false);
  const el = $(`#chatBody .msg[data-mid="${m.mid}"] .bubble`);
  if (!el) { renderChat(); return; }
  el.innerHTML = mdLite(m.text) + '<span class="caret"></span>';
  scrollChat();
}

/** "Abar chesta" — shesh user message ta diye AI turn abar chalay. */
async function regenerateFromUser(userMsg) {
  const i = chatLog.findIndex(m => m.warn && m.retry);
  if (i >= 0) chatLog.splice(i, 1);
  saveChat(); renderChat();
  const imgs = [];
  for (const id of (userMsg.imgs || [])) {
    const rec = imgCache.get(id) || await IMG.get(id).catch(() => null);
    if (rec) imgs.push(rec);
  }
  setTyping(true);
  try { await runAiTurn(userMsg.text, imgs); }
  finally { setTyping(false); }
}

/* ---------- lightbox ---------- */
async function openLightbox(id) {
  const rec = imgCache.get(id) || await IMG.get(id).catch(() => null);
  if (!rec) { toast('Chobi ta ar nei'); return; }
  const box = $('#imgLightbox');
  box.querySelector('img').src = rec.full;
  box.classList.remove('hidden');
}
function closeLightbox() {
  const box = $('#imgLightbox');
  if (!box || box.classList.contains('hidden')) return false;
  box.classList.add('hidden');
  box.querySelector('img').src = '';
  return true;
}

/* ---------- composer attachment tray ---------- */
function renderAttachTray() {
  const tray = $('#chatAttach');
  if (!tray) return;
  tray.classList.toggle('hidden', !pendingImgs.length);
  tray.innerHTML = pendingImgs.map(im => `
    <div class="att">
      <img src="${im.thumb}" alt="Attach kora chobi">
      <button class="att-x" type="button" data-drop="${esc(im.id)}" aria-label="Chobi ta shorao">✕</button>
    </div>`).join('');
  tray.querySelectorAll('[data-drop]').forEach(b => b.onclick = () => {
    pendingImgs = pendingImgs.filter(i => i.id !== b.dataset.drop);
    renderAttachTray();
  });
}

async function addFiles(files) {
  const list = [...files].filter(f => /^image\//.test(f.type || ''));
  if (!list.length) return;
  const room = MAX_ATTACH - pendingImgs.length;
  if (room <= 0) { toast(`Ek message e sorbochcho ${MAX_ATTACH} ta chobi`); return; }
  if (list.length > room) toast(`Prothom ${room} ta chobi neya holo`);
  for (const f of list.slice(0, room)) {
    try { pendingImgs.push(await prepImage(f)); }
    catch (e) { console.error('[persona-ai] chobi prep fail', e); toast(e.message); }
  }
  renderAttachTray();
}

/** Send button ⇄ Stop button. */
function setStreaming(on) {
  const btn = $('#chatSend');
  if (!btn) return;
  btn.classList.toggle('stop', on);
  btn.setAttribute('aria-label', on ? 'Thamao' : 'Pathao');
  btn.textContent = on ? '■' : '➤';
}

function setTyping(on) {
  const el = $('#chatTyping');
  if (el) el.classList.toggle('hidden', !on);
  const box = $('#chatBody');
  if (on && box) box.scrollTop = box.scrollHeight;
}

function openChat() {
  chatOpen = true;
  $('#chatPanel').classList.remove('hidden');
  $('#chatHead').classList.add('hidden');
  renderChat();
  setTimeout(() => $('#chatInput').focus(), 120);
}
function closeChat() {
  chatOpen = false;
  $('#chatPanel').classList.add('hidden');
  $('#chatHead').classList.remove('hidden');
  $('#chatSettings').classList.add('hidden');
}

/* ---- chat head: draggable, position mone rakhe ---- */
function initChatHead() {
  const head = $('#chatHead');
  const pos = DB.get('chatHeadPos', null);
  if (pos) { head.style.left = pos.x + 'px'; head.style.top = pos.y + 'px'; head.style.right = 'auto'; head.style.bottom = 'auto'; }

  let dragging = false, moved = false, sx = 0, sy = 0, ox = 0, oy = 0;
  const down = e => {
    const p = e.touches ? e.touches[0] : e;
    dragging = true; moved = false;
    const r = head.getBoundingClientRect();
    sx = p.clientX; sy = p.clientY; ox = r.left; oy = r.top;
  };
  const move = e => {
    if (!dragging) return;
    const p = e.touches ? e.touches[0] : e;
    const dx = p.clientX - sx, dy = p.clientY - sy;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
    if (!moved) return;
    e.preventDefault();
    const w = head.offsetWidth, h = head.offsetHeight;
    const x = Math.min(Math.max(6, ox + dx), window.innerWidth - w - 6);
    const y = Math.min(Math.max(6, oy + dy), window.innerHeight - h - 6);
    head.style.left = x + 'px'; head.style.top = y + 'px';
    head.style.right = 'auto'; head.style.bottom = 'auto';
  };
  const up = () => {
    if (!dragging) return;
    dragging = false;
    if (moved) {
      const r = head.getBoundingClientRect();
      DB.set('chatHeadPos', { x: Math.round(r.left), y: Math.round(r.top) });
    } else openChat();
  };
  head.addEventListener('mousedown', down);
  head.addEventListener('touchstart', down, { passive: true });
  window.addEventListener('mousemove', move);
  window.addEventListener('touchmove', move, { passive: false });
  window.addEventListener('mouseup', up);
  window.addEventListener('touchend', up);
}

/* ============================================================
   SETTINGS (AI mode)
   ============================================================ */
const CUSTOM_MODEL = '__custom__';

function setStatus(text, kind = '') {
  const el = $('#aiStatus');
  if (!el) return;
  el.textContent = text;
  el.className = 'set-status' + (kind ? ' ' + kind : '');
}

function renderModelSelect() {
  const sel = $('#aiModel');
  if (!sel) return;
  const list = [...new Set([...(aiModels.length ? aiModels : FALLBACK_MODELS), aiCfg.model])].filter(Boolean);
  sel.innerHTML = list.map(m => `<option value="${esc(m)}"${m === aiCfg.model ? ' selected' : ''}>${esc(m)}</option>`).join('')
    + `<option value="${CUSTOM_MODEL}">Onno model — hate likho…</option>`;
  sel.value = aiCfg.model;
  $('#aiModelCustom').classList.add('hidden');
}

function renderLenSeg() {
  const box = $('#aiLen');
  if (!box) return;
  box.innerHTML = Object.entries(LEN_OPTS).map(([k, v]) =>
    `<button type="button" class="seg-btn${k === aiCfg.len ? ' on' : ''}" data-len="${k}">${esc(v.label)}</button>`).join('');
  box.querySelectorAll('[data-len]').forEach(b => b.onclick = () => {
    aiCfg.len = b.dataset.len; saveAi(); renderLenSeg();
  });
  $('#aiLenHint').textContent = `${lenCfg().hint} · sorbochcho ~${lenCfg().tokens} token`;
}

const fmtTok = (n) => n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(n);

function renderUsage() {
  const box = $('#aiUsageBox');
  if (!box) return;
  const today = aiUsage[dayKey()] || { req: 0, in: 0, out: 0 };
  const days = [...Array(7)].map((_, i) => {
    const d = new Date(); d.setDate(d.getDate() - (6 - i));
    return aiUsage[dayKey(d)] || { req: 0, in: 0, out: 0 };
  });
  const peak = Math.max(1, ...days.map(d => d.in + d.out));
  box.innerHTML = `
    <div class="usage-top">
      <b>${today.req}</b><span>request</span>
      <b>${fmtTok(today.in + today.out)}</b><span>token</span>
    </div>
    <div class="usage-bars" aria-hidden="true">
      ${days.map((d, i) => {
        const tok = d.in + d.out;
        return `<span class="day${i === 6 ? ' today' : ''}">${tok ? `<i style="height:${Math.max(8, Math.round(tok / peak * 100))}%"></i>` : ''}</span>`;
      }).join('')}
    </div>
    <p class="set-status">Shesh 7 din · in ${fmtTok(today.in)} / out ${fmtTok(today.out)} aaj. Chobi pathale token onek beshi lage.</p>`;
}

function renderAiSettings() {
  $('#aiToggle').checked = !!aiCfg.on;

  /* default key ta input e dekhai na — khali rekhe placeholder e bujhiye di,
     jate bhul kore edit/leak na hoy. Notun key likhle-i override hoye jabe. */
  const dflt = usingDefaultKey();
  const keyBox = $('#aiKey');
  keyBox.value = dflt ? '' : (aiCfg.key || '');
  keyBox.placeholder = dflt
    ? 'Default key cholche'
    : 'Gemini API key (aistudio.google.com)';
  $('#aiKeyReset').classList.toggle('hidden', dflt || !DEFAULT_KEY);
  $('#aiPass').value = aiCfg.pass || '';
  if (usingProxy()) setStatus('Cloud proxy diye cholche — key server e ✓', 'ok');
  else if (dflt) setStatus('Default key (config.local.js) cholche ✓', 'ok');
  else if (!aiConfigured()) setStatus('Passphrase ba nijer key — jekono ekta dao.');

  renderModelSelect();
  renderLenSeg();
  renderUsage();
  const live = !!(aiCfg.on && aiConfigured());
  $('#chatModeTag').textContent = live ? aiCfg.model : 'Offline brain';
  $('#chatModeTag').classList.toggle('on', live);
}

function openSettings() {
  $('#chatSettings').classList.remove('hidden');
  renderAiSettings();
}

/** Key ta thik ki na ekta chhoto call diye jachai kore — bhul key niye chup thakar cheye bhalo. */
async function verifyKey() {
  if (!aiConfigured()) { setStatus('Key ba passphrase dao — tarpor ami connection test kore dibo.'); return; }
  setStatus('Connection check korchi…');
  try {
    const list = await fetchModels();
    if (!list.includes(aiCfg.model)) {
      const alt = list.find(m => m.includes('flash')) || list[0];
      setStatus(`Connected ✓ — kintu "${aiCfg.model}" ei key te nei, tai "${alt}" set korlam.`, 'warn');
      aiCfg.model = alt; saveAi();
    } else {
      setStatus(`Connected ✓ · ${list.length} ta model pawa gelo`, 'ok');
    }
    renderModelSelect();
    $('#chatModeTag').textContent = aiCfg.on && aiConfigured() ? aiCfg.model : 'Offline brain';
  } catch (e) {
    setStatus(e.message, 'bad');
  }
}

function initChatUI() {
  $('#chatClose').onclick = closeChat;

  $('#chatForm').onsubmit = e => {
    e.preventDefault();
    if (aiAbort) { aiAbort.abort(); return; }      // streaming cholakalin ei button = Stop
    const v = $('#chatInput').value;
    const imgs = pendingImgs;
    $('#chatInput').value = '';
    pendingImgs = [];
    renderAttachTray();
    handleUserText(v, imgs);
  };

  /* ---- chobi attach: button, paste, drag-drop ---- */
  $('#chatAttachBtn').onclick = () => $('#chatFile').click();
  $('#chatFile').onchange = e => { addFiles(e.target.files); e.target.value = ''; };
  $('#chatPanel').addEventListener('paste', e => {
    const files = [...(e.clipboardData?.files || [])];
    if (files.length) { e.preventDefault(); addFiles(files); }
  });
  $('#chatPanel').addEventListener('dragover', e => { e.preventDefault(); $('#chatPanel').classList.add('drop'); });
  $('#chatPanel').addEventListener('dragleave', () => $('#chatPanel').classList.remove('drop'));
  $('#chatPanel').addEventListener('drop', e => {
    e.preventDefault();
    $('#chatPanel').classList.remove('drop');
    addFiles(e.dataTransfer?.files || []);
  });

  /* ---- settings ---- */
  $('#chatGear').onclick = () => { $('#chatSettings').classList.toggle('hidden'); renderAiSettings(); };
  $('#aiToggle').onchange = e => { aiCfg.on = e.target.checked; saveAi(); renderAiSettings(); };
  $('#aiKey').onchange = e => {
    const v = e.target.value.trim();
    /* khali kore dile default key thakle sekhane-i ferot jai, AI mode mora rakhi na */
    aiCfg.key = v || DEFAULT_KEY;
    if (aiCfg.key) aiCfg.on = true;
    saveAi(); renderAiSettings();
    if (v) verifyKey();
  };
  $('#aiPass').onchange = e => {
    aiCfg.pass = e.target.value.trim();
    if (aiCfg.pass) aiCfg.on = true;
    saveAi(); renderAiSettings();
    if (aiCfg.pass) verifyKey();          // passphrase thik ki na ekhoni jachai kore di
  };
  $('#aiKeyReset').onclick = () => {
    aiCfg.key = DEFAULT_KEY; aiCfg.on = !!DEFAULT_KEY;
    saveAi(); renderAiSettings();
    toast('Default key e ferot');
  };
  $('#aiModel').onchange = e => {
    if (e.target.value === CUSTOM_MODEL) {
      const inp = $('#aiModelCustom');
      inp.classList.remove('hidden'); inp.value = aiCfg.model; inp.focus();
      return;
    }
    aiCfg.model = e.target.value; saveAi(); renderAiSettings();
  };
  $('#aiModelCustom').onchange = e => {
    const v = e.target.value.trim();
    if (!v) return;
    aiCfg.model = v; saveAi(); renderAiSettings();
  };
  $('#aiModelRefresh').onclick = async () => {
    const btn = $('#aiModelRefresh');
    btn.disabled = true; setStatus('Model list anchi…');
    try {
      const list = await fetchModels();
      renderModelSelect();
      setStatus(`${list.length} ta model pawa gelo ✓`, 'ok');
    } catch (e) { setStatus(e.message, 'bad'); }
    finally { btn.disabled = false; }
  };

  $('#chatClear').onclick = () => {
    chatLog = []; saveChat(); renderChat(); IMG.gc();
  };
  $('#imgLightbox').onclick = closeLightbox;
  $('#openChatBtn').onclick = () => { closeSheet(); openChat(); };
  document.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (closeLightbox()) return;
    if (chatOpen) closeChat();
  });

  initChatHead();
  renderAiSettings();
  renderChat();
  renderAttachTray();
  IMG.gc();
  handleLaunchParams();
}

/**
 * Manifest shortcut (?chat=1, ?do=sleep) ar Android share-target (?text=…) handle kore.
 * Onno app theke text share korle shetai chat message hishebe chole ashe.
 */
function handleLaunchParams() {
  const p = new URLSearchParams(location.search);
  const shared = [p.get('title'), p.get('text'), p.get('url')].filter(Boolean).join(' ').trim();
  const wantsChat = p.has('chat') || shared;
  const doAction = p.get('do');

  if (doAction === 'sleep') runAction('sleep_start', {}).then(r => toast(r.text));
  if (wantsChat) {
    openChat();
    if (shared) handleUserText(shared);
  }
  /* URL porishkar kori jate reload e abar na chole */
  if (p.toString()) history.replaceState({}, '', location.pathname + location.hash);
}

initChatUI();
