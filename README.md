# Persona

Offline-first personal companion PWA — task, ghum tracking, daily checklist,
mood check-in, notes/pins, ar ekta Banglish chat assistant je nijei sob kaj
kore dey.

Kono backend nei, kono account nei, kono build step nei. Sob data tomar
phone-er `localStorage` e thake.

## Ki ki ache

- **Kaj** — task add/complete, due time, alarm + notification
- **Ghum** — sleep start/wake, duration history, rating
- **Checklist** — roj er obhyash, customizable, history
- **Check-in** — mood log, roj er chhoto proshno
- **Notes & Pins** — dua / niyom / reminder, "uthe ja dekhbo" list
- **Chat** — Banglish e likho: *"kal shokal 8 tay doctor er appointment"* →
  task + alarm set hoye jabe. Offline e-i kaj kore.
- **Alarm** — WebAudio diye tone, snooze/dismiss, app bondho thakleo notification

## Chalano

```bash
git clone https://github.com/official-noman/Personal_aibot.git
cd Personal_aibot
python3 -m http.server 8000
```

Tarpor phone/browser e `http://localhost:8000`. Chrome e "Add to Home screen"
dile app er moto install hoye jabe.

> `file://` diye kholo na — service worker, offline cache ar notification kaj
> korbe na.

## AI mode (optional)

Default e chat **offline brain** diye chole — kono key lage na, internet o na.

Aro free-form kotha bujhate chaile Settings → AI te nijer
[Gemini API key](https://aistudio.google.com/apikey) dao. Key shudhu tomar
browser er localStorage e thake, ar shudhu Google er API te jay — amader kachhe
kichu ashe na (server-i to nei).

## Structure

```
index.html    markup + view gulo
app.js        storage, state, render, notification
chat.js       chat brain (NLU parser + optional Gemini)
alarm.js      alarm tone, ringing, snooze
styles.css    sob style
sw.js         offline cache
```

Developer detail er jonno [CLAUDE.md](CLAUDE.md) dekho.
