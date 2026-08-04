# ✨ Persona — Personal AI Assistant

**Persona** holo ekta 100% offline-first, private ebang highly intelligent Personal Assistant PWA (Progressive Web App). Eta tomar daily kaj, ghum, check-in, notes ar location-based reminders—sob kichu ek jaygay track kore. Er moddhe ache ekta floating AI chat brain, jeta tumi kotha bollei kaj kore dibe!

---

## 🌟 Key Features

### 🧠 AI Chat Brain (Offline & LLM Ready)
- **Floating Chat Head:** Jekono screen theke ✨ icon e tap kore chat open kora jay. Drag kore screen er jekono jaygay rakha jay.
- **Offline Intent Parser:** Net na thakleo Banglish/Bangla/English e kotha bujhte pare (jemon: *"kal bikel 5 tay bazar korte hobe"*, *"uthe gechi"*).
- **LLM Integration:** Gemini API key dile eta aro smart hoye jay, tokhon natural conversation chalano jay. (Settings theke API key add kora jay).

### 📍 Radars (Geo-fencing & Location Reminders)
- **Jaygay gele Reminder:** *"Dhanmondi gele boi kinte mone koriyo"* — ei kotha chat e bollei ba map e pin korlei location reminder set hoye jabe.
- **Offline Tracking:** Ekbar jayga set korle, phone er native GPS diye background e track korbe (net lagbe na). 200m er ashepashe aslei alarm beje uthbe!
- **Free Geocoding:** Photon API (OpenStreetMap) use korechi, jar fole Farmgate ba Panthapath er moto choto elakao khuje pabe. Kono map API key lage na! (Leaflet.js included).

### ♾️ Infinite Memory (Local RAG Pipeline)
- **Transformers.js & WebAssembly:** Zero hosting cost e browser er vetorei AI model (all-MiniLM-L6-v2) run kore!
- **100% Private:** Tumi jokhon *"Save memory amar dog er nam Max"* bolbe, tokon etar Semantic Vector embedding banie phone er **IndexedDB** te save kore rakhbe.
- **Smart Recall:** Pore jokhon kono pet food er kotha jiges korbe, app nijer memory theke "User has a dog named Max" context ta bujhe perfect answer dibe!

### ⏰ Professional Alarm & Web Audio Engine
- **Custom Ringtones:** Kono MP3 file lagbe na! **Web Audio API** use kore math (Oscillators) diye 6 dhoroner premium ringtone (Classic, Chime, Digital, Norom, Ripple) toiri kora hoyeche.
- **Background Notification API:** App close thakleo thik time e notification asbe ar vibrate korbe. PWA Notification click korle alarm er screen popup hobe.

### 💼 Daily Life Tools
- **Tasks & Todos:** Kaj er list, due date ar time track kora.
- **Sleep Tracker:** Ghumate jaoa ar othar hisheb, daily stats.
- **Check-ins:** Mood track kora ar short note lekha.
- **Notes & Pins:** Uthar por (Wake up) ba emergency dua ba rule pin kore rakha.

---

## 🚀 Kibhabe Run Korbe?

Project ta fully Vanilla HTML/CSS/JS diye banano, kono build tool ba npm dependency nai (no node_modules). Tumi just ekta local server on korei run korte parbe:

```bash
# Terminal e ei command ta dao
python3 -m http.server 8123
```
Tarpor browser e giye `http://localhost:8123` open koro.

---

## 🌐 Deployment (Cloudflare Pages / Vercel / GitHub Pages)

App ta completely static ar serverless. Tai tumi easily free te deploy korte parbe:
1. Ei repo ta GitHub e push koro.
2. Cloudflare Pages ba Vercel e connect kore deploy koro.
3. *Note:* PWA, Service Worker ar Geolocation properly kaj korar jonno obossoi **HTTPS (SSL)** thakte hobe (jeta Cloudflare automatically diye dey).

---

## 🛠️ Tech Stack & Architecture
- **Frontend:** HTML5, CSS3 (Vanilla, CSS Variables for Dark Theme), JavaScript (ES6+).
- **Storage:** `localStorage` (state er jonno), `IndexedDB` (AI Memory er vector database er jonno).
- **AI & NLP:** `@xenova/transformers` (WASM in-browser AI), Regex & Custom Lexical Token Matching (Offline Intent Parser).
- **Maps:** Leaflet.js, Photon Geocoding API (OSM).
- **PWA:** Service Worker (`sw.js`), Web App Manifest (`manifest.json`), Web Notifications API.

---
*Created with ❤️ to make personal life organized & smart!*
