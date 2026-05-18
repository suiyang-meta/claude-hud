# Gumroad Listing — Claude HUD

Copy/paste these into the Gumroad product creation form.

---

## Product name
```
Claude HUD — Floating Usage Meter for Claude.ai
```

## Subtitle (appears under title, max ~160 chars)
```
A tiny floating window that shows your Claude.ai limits as blood bars — so you stop breaking your flow to check how much you've got left.
```

## Price
Set to **Pay what you want** with a **suggested price of $5** and **minimum of $0**.

This lets people download for free if they want, and lets fans tip you more. Conversion rate is highest with PWYW for early indie products.

## Category
```
Software & Utilities → Productivity Tools
```

## Cover image
- Use the hero screenshot (the HUD on a desktop background).
- Size: **1280 × 720** minimum. Aspect 16:9 works best on Gumroad.

## Tags
```
claude, ai, productivity, mac, widget, utility, developer-tools, menu-bar, hud
```

---

## Product description (main body)

```
**Claude HUD is a floating widget that shows your Claude.ai usage as blood bars, right on your desktop. No more clicking into settings every 20 minutes to check how close you are to your limit.**

![hero shot]

You know that moment mid-conversation when you wonder "am I about to get rate-limited?" and you open a new tab, go to settings, scroll to usage, stare at the page, close it, and by the time you come back to Claude you've lost your train of thought?

Claude HUD makes that moment go away.

---

## What you get

- **Mac app** — a small floating window that lives in the corner of your screen, always on top, visible on every workspace. Draggable. Resizable. 70% opacity when idle, 100% on hover.
- **Chrome extension** — runs silently in the background, reads the four usage numbers off claude.ai/settings/usage every 30 seconds, pushes them to the widget over localhost.

Four bars, color-coded:

- **Current session** — how much of your rolling 5-hour session you've used
- **Weekly · All models** — your weekly total across all Claude models
- **Weekly · Sonnet** — your weekly Sonnet-specific limit
- **Routines** — daily routine runs used / available

Green under 50%. Yellow 50–79%. Red at 80%+.

---

## Design choices

- **Zero-click info.** You glance at it. You go back to work.
- **Your data never leaves your machine.** No servers, no analytics, no accounts. The extension talks to the app over localhost (port 27843, your own computer). That's it.
- **No menu bar icon.** I tried that. It was too easy to forget it existed. A floating bar in your peripheral vision actually moves behavior.
- **Right-click menu for controls.** "Launch at Login" is on by default. You can turn it off if you hate background apps.

---

## Requirements

- Mac running macOS 11 (Big Sur) or later — Apple Silicon (M1/M2/M3/M4) only for now
- Chrome or any Chromium-based browser
- A Claude.ai account you're signed into

Intel Macs, Windows, Firefox, Safari — not supported yet. Email me if you want them and I'll prioritize based on demand.

---

## What's in the download

A single zip with:

- `Claude HUD.dmg` — drag to Applications
- `extension/` — the Chrome extension (load unpacked until the Web Store version finishes review)
- `README.md` — 2-minute setup
- `TROUBLESHOOTING.md` — for when something breaks

Full setup takes about 2 minutes. There's no account to create, no tutorial to sit through.

---

## Why I made it

I make dozens of calls to Claude every day and I kept breaking my focus to check my usage. The context switch cost more than the information was worth.

So I built this for myself. It's been running on my desktop for weeks. I figured other heavy Claude users might want it too.

---

## Pay what you want

You can grab it for free — just set the price to $0 at checkout. If you use it and it saves you the "wait am I about to get rate-limited" anxiety, throw a few bucks in. That's what tells me to keep building stuff like this.

---

## Not affiliated with Anthropic

Claude HUD is an independent product by an indie developer. Anthropic didn't make it, didn't ask for it, and isn't responsible for it. I just wanted to solve my own problem and share it.

Questions? hello@claudehud.app
```

---

## Call-to-action on the checkout page
```
Download Claude HUD
```

## After-purchase message (Gumroad sends this as email + shows on download page)

```
Thanks for grabbing Claude HUD! ❤️

You've got one zip file above. Inside:

1. **Claude HUD.dmg** — double-click it, drag the app to Applications
2. **extension/** folder — load this in Chrome (chrome://extensions → Developer mode → Load unpacked)
3. **README.md** — full 2-minute setup guide
4. **TROUBLESHOOTING.md** — if something goes sideways

The first time you open the Mac app, macOS will complain about the developer not being verified. Right-click the app → Open → Open. You only need to do this once.

Reply to this email if anything breaks and I'll fix it. I read every message.

— Sui
```

## Refund policy
```
No-questions-asked refund within 30 days. Just email hello@claudehud.app.
```
(Gumroad requires you to state a policy. This is the most generous / lowest-friction option and it builds trust for $0–5 products.)
