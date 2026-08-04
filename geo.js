/* ============================================================
   Persona — Geofencing / Location-based reminder engine

   Jethay jaoa hobe shekhane gele reminder bajbe:
   • Chat e bolo: "Dhanmondi gele amake boi kinar kotha mone koriye dio"
   • Radar page e map e tap kore pin add koro
   • Haversine formula die distance check
   • Background e GPS watch, range e dhukle notification + vibration

   Free APIs: Open-Meteo geocoding (CORS open, key lage na),
   Leaflet.js tiles (OpenStreetMap, free).
   ============================================================ */
'use strict';

/* ---------- storage ---------- */
let geoTasks = DB.get('geo', []);
// { id, label, lat, lon, radius (m), notified (today key), created, emoji?, placeName? }
let geoCfg = DB.get('geoCfg', { enabled: false, radius: 200, interval: 30, sound: true });
const saveGeo = () => DB.set('geo', geoTasks);
const saveGeoCfg = () => DB.set('geoCfg', geoCfg);

/* ---------- haversine distance (meter) ---------- */
function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/* ---------- geocoding (Photon API / OpenStreetMap — free, CORS open, key lage na, detailed) ---------- */
async function geocode(query) {
  if (!query || !query.trim()) return null;
  const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=5`;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const d = await r.json();
    if (!d.features || !d.features.length) return null;
    return d.features.map(f => {
      const p = f.properties;
      const geo = f.geometry.coordinates;
      return {
        name: [p.name, p.street, p.city, p.state, p.country].filter(Boolean).join(', '),
        shortName: p.name || p.street || p.city || 'Unknown',
        lat: geo[1],
        lon: geo[0],
        country: p.country,
      };
    });
  } catch (e) { console.warn('[geo] geocode fail', e); return null; }
}

/* ---------- reverse geocode (for "ekhane reminder" type commands) ---------- */
async function reverseGeocode(lat, lon) {
  /* Open-Meteo doesn't do reverse — fallback to label */
  return `📍 ${lat.toFixed(4)}, ${lon.toFixed(4)}`;
}

/* ---------- geolocation permission + tracking ---------- */
let watchId = null;
let lastPos = null;

function requestLocation() {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error('Geolocation support nei'));
    navigator.geolocation.getCurrentPosition(
      pos => { lastPos = pos.coords; resolve(pos.coords); },
      err => reject(err),
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 }
    );
  });
}

function startWatch() {
  if (watchId != null) return;
  if (!('geolocation' in navigator)) return;
  watchId = navigator.geolocation.watchPosition(
    pos => {
      lastPos = pos.coords;
      checkGeoProximity();
    },
    err => console.warn('[geo] watch error', err),
    { enableHighAccuracy: true, timeout: 30000, maximumAge: 15000 }
  );
}

function stopWatch() {
  if (watchId != null) {
    navigator.geolocation.clearWatch(watchId);
    watchId = null;
  }
}

/* ---------- proximity check ---------- */
function checkGeoProximity() {
  if (!lastPos || !geoTasks.length) return;
  const today = dayKey();
  let changed = false;

  for (const gt of geoTasks) {
    /* already notified today for this task */
    if (gt.notified === today) continue;

    const dist = haversine(lastPos.latitude, lastPos.longitude, gt.lat, gt.lon);
    const radius = gt.radius || geoCfg.radius || 200;

    if (dist <= radius) {
      gt.notified = today;
      changed = true;
      fireGeoNotif(gt, Math.round(dist));
    }
  }
  if (changed) saveGeo();
}

function fireGeoNotif(gt, dist) {
  const title = `📍 ${gt.placeName || 'Kachhe eshe gecho!'}`;
  const body = `${gt.label} (${dist}m dure)`;

  /* notification */
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
    const opts = {
      body,
      icon: 'icons/icon-192.png',
      badge: 'icons/icon-192.png',
      tag: 'geo-' + gt.id,
      requireInteraction: true,
      vibrate: geoCfg.sound ? [200, 100, 200, 100, 200] : undefined,
      data: { geoId: gt.id },
    };
    if (swReg && swReg.showNotification) swReg.showNotification(title, opts);
    else new Notification(title, opts);
  }

  /* vibration (haptic premium feel) */
  if (navigator.vibrate && geoCfg.sound) navigator.vibrate([200, 100, 200, 100, 200]);

  /* in-app alarm sound (reuse alarm engine) */
  if (typeof playSeq === 'function' && geoCfg.sound) {
    playSeq('chime', 0.6);
  }

  /* toast in app */
  toast(`📍 ${gt.label} — ${gt.placeName || ''} er kachhe!`);
}

/* ---------- add a geo-task (from chat or from UI) ---------- */
function addGeoTask(label, lat, lon, placeName, radius) {
  const gt = {
    id: uid(),
    label: label || 'Reminder',
    lat,
    lon,
    radius: radius || geoCfg.radius || 200,
    placeName: placeName || '',
    notified: null,
    emoji: '📍',
    created: Date.now(),
  };
  geoTasks.push(gt);
  saveGeo();
  ensureGeoWatch();
  return gt;
}

function removeGeoTask(id) {
  geoTasks = geoTasks.filter(g => g.id !== id);
  saveGeo();
  if (!geoTasks.length) stopWatch();
}

function ensureGeoWatch() {
  if (geoTasks.length > 0 && geoCfg.enabled) startWatch();
  else stopWatch();
}

/* ---------- auto-check on app wake ---------- */
function geoResumeCheck() {
  if (!geoCfg.enabled || !geoTasks.length) return;
  requestLocation().then(() => checkGeoProximity()).catch(() => {});
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) geoResumeCheck();
});

/* ============================================================
   GEO UI — Radars page
   ============================================================ */
const LEAFLET_CSS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css';
const LEAFLET_JS = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
let leafletLoaded = false;
let geoMap = null;
let geoMarkers = [];

function loadLeaflet() {
  if (leafletLoaded) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const link = document.createElement('link');
    link.rel = 'stylesheet'; link.href = LEAFLET_CSS;
    document.head.appendChild(link);
    const script = document.createElement('script');
    script.src = LEAFLET_JS;
    script.onload = () => { leafletLoaded = true; resolve(); };
    script.onerror = reject;
    document.head.appendChild(script);
  });
}

function initGeoMap() {
  if (!leafletLoaded || !$('#geoMapWrap')) return;
  if (geoMap) { geoMap.remove(); geoMap = null; }

  const el = document.createElement('div');
  el.id = 'geoMapView'; el.style.height = '280px'; el.style.borderRadius = 'var(--radius-sm)';
  el.style.overflow = 'hidden'; el.style.marginBottom = '14px';
  $('#geoMapWrap').innerHTML = '';
  $('#geoMapWrap').appendChild(el);

  const center = lastPos ? [lastPos.latitude, lastPos.longitude] : [23.8103, 90.4125]; // Dhaka default
  geoMap = L.map('geoMapView', { attributionControl: false }).setView(center, 14);
  L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OSM',
    maxZoom: 19,
  }).addTo(geoMap);

  /* user location marker */
  if (lastPos) {
    L.circleMarker([lastPos.latitude, lastPos.longitude], {
      radius: 8, fillColor: '#4f9dff', fillOpacity: 0.9, color: '#fff', weight: 2,
    }).addTo(geoMap).bindPopup('📍 Tumi ekhane');
  }

  /* geo-task markers */
  refreshMapMarkers();

  /* tap to add */
  geoMap.on('click', e => {
    $('#geoAddLat').value = e.latlng.lat.toFixed(6);
    $('#geoAddLon').value = e.latlng.lng.toFixed(6);
    $('#geoAddPlace').value = `📍 ${e.latlng.lat.toFixed(4)}, ${e.latlng.lng.toFixed(4)}`;
    /* show preview marker */
    if (geoMap._previewMarker) geoMap.removeLayer(geoMap._previewMarker);
    geoMap._previewMarker = L.marker([e.latlng.lat, e.latlng.lng], { opacity: 0.7 })
      .addTo(geoMap).bindPopup('Ekhane pin korbo?').openPopup();
    $('#geoAddForm').scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
}

function refreshMapMarkers() {
  if (!geoMap) return;
  geoMarkers.forEach(m => geoMap.removeLayer(m));
  geoMarkers = [];
  const today = dayKey();
  for (const gt of geoTasks) {
    const done = gt.notified === today;
    const circle = L.circle([gt.lat, gt.lon], {
      radius: gt.radius || geoCfg.radius || 200,
      color: done ? '#3ad29f' : '#b57bff',
      fillColor: done ? '#3ad29f' : '#b57bff',
      fillOpacity: 0.15,
      weight: 2,
    }).addTo(geoMap);
    const marker = L.marker([gt.lat, gt.lon]).addTo(geoMap)
      .bindPopup(`<b>${gt.label}</b><br>${gt.placeName || ''}<br>${done ? '✅ Aaj notified' : '⏳ Active'}`);
    geoMarkers.push(circle, marker);
  }
}

function renderGeoList() {
  const box = $('#geoList');
  if (!box) return;
  const today = dayKey();
  if (!geoTasks.length) {
    box.innerHTML = '<div class="empty">Kono geo-reminder nei. Chat e bolo ba niche map e tap kore add koro.</div>';
    return;
  }
  box.innerHTML = geoTasks.map(gt => {
    const done = gt.notified === today;
    const dist = lastPos ? Math.round(haversine(lastPos.latitude, lastPos.longitude, gt.lat, gt.lon)) : null;
    return `<div class="item ${done ? 'done' : ''}" data-geo-id="${gt.id}">
      <div class="item-body">
        <div class="item-title">${esc(gt.label)}</div>
        <div class="item-meta">
          📍 ${esc(gt.placeName || `${gt.lat.toFixed(4)}, ${gt.lon.toFixed(4)}`)}
          ${dist != null ? ` · ${dist < 1000 ? dist + 'm' : (dist / 1000).toFixed(1) + 'km'} dure` : ''}
          · ${gt.radius || geoCfg.radius}m radius
        </div>
        <div class="item-meta">${done ? '✅ Aaj notified' : '⏳ Active'}</div>
      </div>
      <div style="display:flex;flex-direction:column;gap:6px">
        <button class="pin-star" data-act="reset" title="Reset notification">🔄</button>
        <button class="del" data-act="del">🗑</button>
      </div>
    </div>`;
  }).join('');

  $$('#geoList .item').forEach(el => {
    const id = el.dataset.geoId;
    el.querySelector('[data-act="del"]').onclick = () => {
      removeGeoTask(id);
      renderGeoPage();
      toast('Geo-reminder baad');
    };
    el.querySelector('[data-act="reset"]').onclick = () => {
      const g = geoTasks.find(x => x.id === id);
      if (g) { g.notified = null; saveGeo(); renderGeoPage(); toast('Reset — abar kachhe gele bajbe'); }
    };
  });
}

async function renderGeoPage() {
  /* geo-toggle */
  const tog = $('#geoToggle');
  if (tog) tog.checked = geoCfg.enabled;

  /* permission status */
  const st = $('#geoPermStatus');
  if (st) {
    if (!('geolocation' in navigator)) {
      st.innerHTML = '❌ Ei browser-e location support nei.';
    } else if (lastPos) {
      st.innerHTML = `✅ Location access ache · ${geoTasks.length} ta radar active`;
    } else {
      st.innerHTML = '⚠️ Location permission deowa hoyni — "Chalu koro" button e tap koro.';
    }
  }

  renderGeoList();
  if (leafletLoaded && geoMap) refreshMapMarkers();
}

async function openGeoView() {
  /* navigate to geo view */
  closeSheet();
  $$('.view').forEach(v => v.classList.toggle('hidden', v.dataset.view !== 'geo'));
  $$('.nav-btn').forEach(b => b.classList.toggle('active', false));
  $$('.nav-btn[data-nav="more"]').forEach(b => b.classList.add('active'));
  $('#viewTitle').textContent = 'Radars';
  $('#viewEyebrow').textContent = '📍 Geo-reminders';
  currentView = 'geo';

  /* try to get current location */
  try {
    await requestLocation();
  } catch (e) { /* permission denied / timeout — map still shows, just no user marker */ }

  /* load leaflet & init map */
  try {
    await loadLeaflet();
    initGeoMap();
  } catch (e) {
    console.warn('[geo] leaflet load fail', e);
    if ($('#geoMapWrap')) $('#geoMapWrap').innerHTML = '<div class="empty">Map load korte parlam na. Net lage.</div>';
  }

  renderGeoPage();
}

function initGeoUI() {
  /* "Aro" menu entry */
  const btn = $('#geoNavBtn');
  if (btn) btn.onclick = openGeoView;

  /* geo toggle */
  const tog = $('#geoToggle');
  if (tog) tog.onchange = async (e) => {
    geoCfg.enabled = e.target.checked;
    saveGeoCfg();
    if (geoCfg.enabled) {
      try {
        await requestLocation();
        startWatch();
        toast('📍 Location tracking chalu');
      } catch (err) {
        toast('Location permission dao — browser e Allow koro');
        geoCfg.enabled = false;
        saveGeoCfg();
        tog.checked = false;
      }
    } else {
      stopWatch();
      toast('Location tracking bondho');
    }
    renderGeoPage();
  };

  /* radius setting */
  const rad = $('#geoRadius');
  if (rad) {
    rad.value = geoCfg.radius || 200;
    rad.onchange = e => {
      geoCfg.radius = Math.max(50, Math.min(2000, +e.target.value || 200));
      saveGeoCfg();
      if ($('#geoRadVal')) $('#geoRadVal').textContent = geoCfg.radius + 'm';
    };
    if ($('#geoRadVal')) $('#geoRadVal').textContent = (geoCfg.radius || 200) + 'm';
  }

  /* add form submit */
  const form = $('#geoAddForm');
  if (form) form.onsubmit = e => {
    e.preventDefault();
    const label = $('#geoAddLabel').value.trim();
    const lat = parseFloat($('#geoAddLat').value);
    const lon = parseFloat($('#geoAddLon').value);
    const place = $('#geoAddPlace').value.trim();
    if (!label) { toast('Ki mone koriye dibo seta likho'); return; }
    if (isNaN(lat) || isNaN(lon)) { toast('Map e tap kore ba search kore jaygay pin dao'); return; }
    addGeoTask(label, lat, lon, place, geoCfg.radius);
    form.reset();
    if (geoMap && geoMap._previewMarker) { geoMap.removeLayer(geoMap._previewMarker); geoMap._previewMarker = null; }
    renderGeoPage();
    if (geoMap) refreshMapMarkers();
    toast('📍 Geo-reminder add holo');
  };

  /* geo search */
  const searchBtn = $('#geoSearchBtn');
  if (searchBtn) searchBtn.onclick = async () => {
    const q = $('#geoSearchInput').value.trim();
    if (!q) return;
    const results = await geocode(q);
    const box = $('#geoSearchResults');
    if (!results || !results.length) {
      box.innerHTML = '<div class="empty">Kichu pelam na. Alada naam diye try koro.</div>';
      return;
    }
    box.innerHTML = results.map((r, i) =>
      `<button class="sheet-item geo-search-item" data-idx="${i}" type="button">
        <span>📍</span><div><b>${esc(r.shortName)}</b><small>${esc(r.name)}</small></div>
      </button>`
    ).join('');
    box._results = results;
    $$('#geoSearchResults .geo-search-item').forEach(b => b.onclick = () => {
      const r = box._results[+b.dataset.idx];
      $('#geoAddLat').value = r.lat.toFixed(6);
      $('#geoAddLon').value = r.lon.toFixed(6);
      $('#geoAddPlace').value = r.shortName;
      box.innerHTML = '';
      if (geoMap) {
        geoMap.setView([r.lat, r.lon], 15);
        if (geoMap._previewMarker) geoMap.removeLayer(geoMap._previewMarker);
        geoMap._previewMarker = L.marker([r.lat, r.lon], { opacity: 0.7 })
          .addTo(geoMap).bindPopup(r.shortName).openPopup();
      }
      toast(`📍 ${r.shortName} select holo — niche label likhe Add koro`);
    });
  };

  /* "ekhane reminder" — current location */
  const hereBtn = $('#geoHereBtn');
  if (hereBtn) hereBtn.onclick = async () => {
    try {
      const pos = await requestLocation();
      $('#geoAddLat').value = pos.latitude.toFixed(6);
      $('#geoAddLon').value = pos.longitude.toFixed(6);
      $('#geoAddPlace').value = `📍 Ekhonkar jaygay (${pos.latitude.toFixed(4)}, ${pos.longitude.toFixed(4)})`;
      if (geoMap) {
        geoMap.setView([pos.latitude, pos.longitude], 16);
        if (geoMap._previewMarker) geoMap.removeLayer(geoMap._previewMarker);
        geoMap._previewMarker = L.marker([pos.latitude, pos.longitude], { opacity: 0.7 })
          .addTo(geoMap).bindPopup('📍 Ekhane').openPopup();
      }
      toast('📍 Ekhonkar location set holo');
    } catch (e) {
      toast('Location pelam na — permission dao');
    }
  };

  /* "locate me" button */
  const locBtn = $('#geoLocateBtn');
  if (locBtn) locBtn.onclick = async () => {
    try {
      const pos = await requestLocation();
      if (geoMap) geoMap.setView([pos.latitude, pos.longitude], 16);
      toast('📍 Tomar jaygay niye gelam');
    } catch (e) { toast('Location pelam na'); }
  };

  /* resume watch if had tasks */
  if (geoCfg.enabled && geoTasks.length) {
    requestLocation().then(() => startWatch()).catch(() => {});
  }
}

/* ============================================================
   CHAT INTEGRATION — geo actions for the brain
   ============================================================ */
/* These are added to ACTIONS in chat.js, but defined here so geo.js
   is self-contained and chat.js just calls them. */

const GEO_ACTIONS = {
  async geo_add({ label, place, radius }) {
    if (!label) return { text: 'Ki mone koriye dibo seta bolo — ar kothay? Jemon: "Dhanmondi gele boi kinte mone koriyo"' };
    if (!place) return { text: `"${label}" — kothay gele mone koriye dibo? Jaygay naam bolo.`, chips: ['Dhanmondi', 'Mirpur', 'Uttara', 'Ekhane'] };

    /* "ekhane" = current location */
    if (/\bekhane\b|\beikhane\b|\bhere\b|\bcurrent\b|\bni[jk]er\b/.test(place.toLowerCase())) {
      try {
        const pos = await requestLocation();
        const gt = addGeoTask(label, pos.latitude, pos.longitude, 'Ekhonkar jaygay', radius);
        return { text: `📍 Ekhonkar jaygay geo-reminder add holo:\n**${label}**\nKachhe ashle (${gt.radius}m) mone koriye dibo.`, goto: 'geo' };
      } catch (e) {
        return { text: '📍 Location pelam na — browser-e permission dao, ba jaygay naam bolo.' };
      }
    }

    /* geocode the place */
    if (!navigator.onLine) return { text: '📴 Net nei — jaygay khujte net lage. Net ashle abar try koro.' };
    const results = await geocode(place);
    if (!results || !results.length) {
      return { text: `"${place}" khuje pelam na 😕 Alada naam diye try koro, ba Radar page e map e tap kore add koro.`, goto: 'geo' };
    }

    const r = results[0];
    const gt = addGeoTask(label, r.lat, r.lon, r.shortName, radius);
    return {
      text: `📍 Geo-reminder add holo:\n**${label}**\n📌 ${r.name}\nOi jaygay ${gt.radius}m er bhetor gele mone koriye dibo.`,
      goto: 'geo',
    };
  },

  geo_list() {
    if (!geoTasks.length) return { text: '📍 Kono geo-reminder nei. "Dhanmondi gele boi kinte mone koriyo" erkm likho.', goto: 'geo' };
    const today = dayKey();
    const lines = geoTasks.slice(0, 8).map(gt => {
      const done = gt.notified === today;
      const dist = lastPos ? Math.round(haversine(lastPos.latitude, lastPos.longitude, gt.lat, gt.lon)) : null;
      return `• ${done ? '✅' : '📍'} ${gt.label} — ${gt.placeName || ''}${dist != null ? ` (${dist < 1000 ? dist + 'm' : (dist / 1000).toFixed(1) + 'km'})` : ''}`;
    });
    return { text: `${geoTasks.length} ta geo-reminder:\n${lines.join('\n')}`, goto: 'geo' };
  },

  geo_delete({ query }) {
    if (!query) return { text: 'Kon geo-reminder ta muchbo? Naam bolo.' };
    const gt = bestMatch(query, geoTasks, x => x.label + ' ' + (x.placeName || ''), 0.4);
    if (!gt) return { text: `"${query}" niye kono geo-reminder pelam na.` };
    removeGeoTask(gt.id);
    return { text: `🗑 **${gt.label}** (${gt.placeName || ''}) geo-reminder muche dilam.` };
  },

  async geo_enable() {
    geoCfg.enabled = true; saveGeoCfg();
    try {
      await requestLocation();
      startWatch();
      return { text: '📍 Location tracking chalu holo. Geo-reminder kachhe gele bajbe.' };
    } catch (e) {
      geoCfg.enabled = false; saveGeoCfg();
      return { text: '📍 Location permission dao — browser "Allow" button e tap koro, tarpor abar bolo.' };
    }
  },

  geo_disable() {
    geoCfg.enabled = false; saveGeoCfg(); stopWatch();
    return { text: '📍 Location tracking bondho korlam. Geo-reminder bajbe na jokhon porjonto abar chalu koro.' };
  },
};

/* Register geo actions in ACTIONS (chat.js er global) */
Object.assign(ACTIONS, GEO_ACTIONS);

/* ============================================================
   INIT
   ============================================================ */
function initGeo() {
  initGeoUI();
  /* periodic proximity check (app khola thakle) */
  setInterval(() => {
    if (geoCfg.enabled && geoTasks.length && lastPos) checkGeoProximity();
  }, (geoCfg.interval || 30) * 1000);
}
initGeo();
