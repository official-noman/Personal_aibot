# ✨ Persona — Personal AI Assistant

**Persona** holo ekta offline-first, private, installable Personal Assistant PWA.
Daily kaj, ghum, check-in, notes, location reminder — sob ek jaygay. Sathe ekta
floating AI chat brain, jake Banglish e kotha bollei kaj kore dey.

Data sob tomar phone-e (`localStorage` + `IndexedDB`). Kono account nei, kono
backend nei, kono tracking nei.

> **Build step nei, framework nei, npm dependency nei.** `index.html` browser e
> khullei chole.

---

## 🌟 Ki ki ache

### 🧠 AI chat brain — duita mode

| Mode | Kokhon chole | Ki lage |
|---|---|---|
| **Offline brain** (default) | Sob shomoy, net chara-o | Kichu na |
| **AI mode** (Gemini) | Key/passphrase dile | Gemini API key |

- **Floating chat head** — jekono screen theke ✨ e tap, drag kore jekhane khushi rakha jay
- **Offline intent parser** — Banglish/Bangla/English mishiye bujhte pare
  (*"kal bikel 5 tay bazar korte hobe"*, *"uthe gechi"*)
- **AI mode e action gulo local-i thake** — LLM shudhu *kon action* ta thik kore,
  chalay app er nijer registry. Tai LLM icche moto kichu korte pare na.

### 📸 Chobi pathano (vision)
- `＋` button, **paste**, ba **drag-drop** — tinta bhabei chobi attach hoy (max 4/message)
- Pathanor age nijei resize + compress hoy (long edge 1152px JPEG), jate token
  ar quota duitai bache
- Chobi thake **IndexedDB** te, `localStorage` e na — na hole quota shesh hoye jeto
- Chat e thumbnail, tap korle full-screen

### ⚡ Premium AI experience
- **Streaming uttor** — word-by-word ashe, 5 second dead wait nei
- **Stop button** — majhpothe thamano jay, ja eseche ta thake
- **Uttor er size control** — Chhoto / Majhari / Boro / Bistarito
- **Live model list** — tomar key diye Google er kachhe jiggesh kore asol model gulo dekhay
- **Usage meter** — aajker request + token, 7 diner chart
- **Copy / ⟳ Abar / Abar chesta** protita AI reply te
- Error gulo manush-pora Banglish e — raw API dump kokhono na

### 📍 Radars (geo-fencing)
- *"Dhanmondi gele boi kinte mone koriyo"* — bollei ba map e pin korlei set
- Ekbar set korle native GPS diye background e track kore (net lage na), 200m er
  moddhe aslei alarm
- **Photon (OpenStreetMap)** geocoding — kono map API key lage na (Leaflet.js)

### ♾️ Infinite memory (local RAG)
- **Transformers.js + WebAssembly** — browser er vitorei embedding model
  (all-MiniLM-L6-v2) chole, zero hosting cost
- *"Save memory amar dog er nam Max"* → semantic vector hoye IndexedDB te
- Pore pet food er kotha jiggesh korle nijer memory theke context niye uttor dey

### ⏰ Alarm & Web Audio engine
- **Kono MP3 nei** — Web Audio API diye math (oscillator) theke 6 rokom ringtone
  (Classic, Chime, Digital, Norom, Ripple)
- App bondho thakleo notification + vibration; notification e tap korle alarm screen

### 💼 Daily tools
Tasks · Sleep tracker · Mood check-in · Notes · Pins (dua/rule) · Sheet log

---

## 🚀 Local e chalano

```bash
python3 -m http.server 8000
```
Tarpor `http://localhost:8000`.

> `file://` diye kholo na — service worker, notification ar geolocation kaj korbe na.

### AI mode on korte (local)
```bash
cp config.local.example.js config.local.js
```
Tarpor `config.local.js` e nijer Gemini key boshao ([aistudio.google.com](https://aistudio.google.com)
theke free te pabe). File ta **gitignored** — key kokhono commit hobe na.

File ta na thakleo cholbe — tokhon chat settings (⚙️) theke hate key dite hobe.

---

## 🌐 Deploy (Cloudflare Pages)

App ta static, kintu **AI key ta browser e pathano jabe na** — site public hole
je keu devtools khule key niye nite parbe. Tai key thake ekta Cloudflare Pages
Function e, browser shudhu nijer domain e call kore:

```
Browser ──x-persona-pass──▶ /api/gemini/… ──+GEMINI_KEY──▶ Google
        (key nei)            (Pages Function)   (secret ekhane)
```

**Setup:**

1. Repo ta GitHub e push koro, Cloudflare Pages e connect koro
   (`functions/` folder Cloudflare nijei dhore nibe — kono config lage na)
2. Pages project → **Settings → Environment variables** e duita **secret** add koro:

   | Name | Value |
   |---|---|
   | `GEMINI_KEY` | tomar Gemini API key |
   | `PERSONA_PASS` | nijer banano ekta passphrase |

3. Redeploy koro
4. Protita device e (phone, office PC, basar PC…) app khule → ✨ → ⚙️ →
   **Cloud access** e passphrase ta ekbar dao. Oi device e mone thakbe.

**Function ta local e test korte:**
```bash
npx wrangler pages dev . --binding GEMINI_KEY=xxx PERSONA_PASS=yyy
```

> PWA, service worker ar geolocation er jonno **HTTPS** lagbe — Cloudflare
> automatic diye dey.

---

## 🔐 Privacy & security

- **Sob data phone e** — `localStorage` (state) ar `IndexedDB` (AI memory, chobi).
  Kono server e kichu jay na.
- **AI mode off thakle kichui phone er baire jay na.** On thakle tomar message ar
  attach kora chobi Google er Gemini API te jay — ei kotha ta app er settings e-o lekha.
- **Key kokhono repo te na.** Local e `config.local.js` (gitignored), hosted e
  Cloudflare secret.
- Passphrase gate quota churi thekay, kintu site ta nijei public — puro site lukate
  chaile Cloudflare Access lagabe.

---

## 📁 File gulo

| File | Ki ache |
|---|---|
| `index.html` | Sob view er markup, sheet/modal, script tag (order matters) |
| `app.js` | Storage layer (`DB`), state, render, nav, notification, due-check |
| `chat.js` | Chat brain — Banglish NLU parser, action registry, Gemini mode, vision |
| `alarm.js` | Alarm tone synth (WebAudio), ringing/snooze/dismiss |
| `geo.js` | Geo-fencing, Leaflet map, Photon geocoding |
| `memory.js` | Local RAG — embedding + IndexedDB vector store |
| `styles.css` | Sob style (single file, CSS variable theme) |
| `sw.js` | Cache-first service worker |
| `functions/api/gemini/[[path]].js` | Cloudflare proxy — key server side rakhe |
| `config.local.example.js` | Local key config er template |

---

## 🛠️ Tech stack

- **Frontend:** HTML5, CSS3 (vanilla, CSS variables, dark + light theme), ES2020 JS
- **Storage:** `localStorage` (state), `IndexedDB` (AI memory vector + chobi)
- **AI:** Gemini API (streaming SSE + vision), `@xenova/transformers` (in-browser
  embedding), custom lexical intent parser
- **Maps:** Leaflet.js + Photon geocoding (OSM)
- **PWA:** Service worker, Web App Manifest, Notifications API, Web Audio API
- **Edge:** Cloudflare Pages Functions

---
*Created with ❤️ to make personal life organized & smart!*
