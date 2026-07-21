# Handover — Sugarcane Farm Manager

Read this first if you're a fresh Claude Code session picking this project back up with no memory of prior work. It's kept in the repo root so it survives cache loss.

**Last updated:** 2026-07-21, after commit `00dd85a` ("Add subtle update-available banner for installed PWAs").

## What this is

A single-file, offline-first PWA for Philippine sugarcane smallholders. No build step, no frontend framework — `index.html` is the entire app (~4800+ lines: HTML, CSS, and two `<script>` blocks). Live at **https://farmmanagerapp.netlify.app**. Repo: **github.com/lmreynaagricultural/sugarcane-farm-manager**, deployed via Netlify's GitHub integration — every push to `main` auto-deploys to production. There is no staging environment for direct-to-main pushes; larger features go through a feature branch + PR + Netlify Deploy Preview instead (see "Branching strategy" below).

The user (Lance Reyna) is non-technical-facing but tests every change live on his own phone and reports real bugs from real usage — treat his bug reports as authoritative even when they seem to contradict the code at first glance.

## File map

| File | Purpose |
|---|---|
| `index.html` | The entire app: UI, styles, all client logic. Edit this for almost everything. |
| `onboarding.html` | Standalone full onboarding guide (real DOCTYPE/head/body page, not a fragment). Opened by the "?" header button in a new tab. Built from a Claude Artifact — see "Onboarding guide" below before touching it. |
| `sw.js` | Service worker. Cache-first for app-shell files, network-first for everything else (weather API, map tiles, CDN scripts). **`CACHE_NAME` must be bumped on every deploy that changes `index.html`, `onboarding.html`, `manifest.json`, or the icons** — the app shell is cache-first, so without a bump returning users keep the old version indefinitely. Current value: `sugarcane-farm-v20`. |
| `manifest.json` | PWA manifest — install-to-home-screen metadata, brand colors. |
| `functions/sync.js` | Netlify Function — cloud sync to Supabase. Reads `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` from Netlify env vars. |
| `functions/log.js` | Netlify Function — client error logging to a Supabase table. Same env vars. |
| `package.json` (root, **not** inside `functions/`) | Holds `@supabase/supabase-js`. Netlify does NOT auto-install a Function's own `functions/package.json` deps — this bit us once already (see Known gotchas). |
| `netlify.toml` | `functions = "functions"`, `node_bundler = "esbuild"`. |

## Brand system (Lance Reyna brand guide v1.0)

CSS custom properties defined in `index.html`'s `:root` (~line 19) and a `prefers-color-scheme: dark` override block right after it:

- Navy `--text: #152A4A` (primary text/ink, not literally named `--navy`)
- Teal/green `--green: #2FC9A4` (growth, positive actions, CTAs)
- Burnt orange `--amber: #C85A0A` (warnings, urgent, and doubles as the general "accent" color for things like the help button)
- Off-white `--bg2/--bg3: #F5F3F0`
- Sentence case throughout, only 400/500 font weights, flat design — no gradients or shadows except small toast/modal drop-shadows.
- `--green` and `--amber` are theme-invariant (same hex in light and dark); most other tokens (`--text`, `--bg`, the `*-light`/`*-text` pairs) flip in the dark-mode media query — check both before hardcoding a color.

## Known gotchas / fixes already applied (don't redo these)

- **Netlify Function deps**: put Supabase (or any function dependency) in the **root** `package.json`, not `functions/package.json`. Netlify's own build log says this explicitly if you get it wrong — you'll see a "module not found" at function runtime, not build time.
- **401 on `/sync` or `/log`**: almost always a stale `SUPABASE_SERVICE_KEY` in Netlify env vars, not a code bug. Check Netlify site settings → Environment variables first.
- **Service worker cache**: cache-first app shell means content changes are invisible to returning users until `CACHE_NAME` in `sw.js` is bumped. This was missed for a long stretch earlier (stuck at v1) — always bump it as part of any `index.html`/`onboarding.html`/`manifest.json`/icon change. As of commit `00dd85a` there's also an in-app update banner (see below) that surfaces new versions to already-installed users, but the cache bump is still what makes the new version exist to be surfaced.
- **Leaflet map z-index**: all 4 map containers have `isolation: isolate` — without it Leaflet's internal z-index (up to 1000) escapes any containing stacking context and renders over the sticky header.
- **Duplicate form-field IDs**: the consent modal (static HTML, always in DOM) and the account panel (dynamically injected) both had `auth-email`/`auth-password`/`auth-error` IDs at one point, so `getElementById` silently resolved to the wrong (hidden) copy. Fixed with unique `ap-*` prefixed IDs in the account panel. If you add a third sign-in surface, give it its own ID prefix too.
- **`recentRainfallMm()`**: has a hard 60-day cap and iteration guard on its day-by-day loop. A malformed/ancient `lastIrrigated` date across many fields on every render was a real phone-freeze risk before this was added — don't remove the cap.
- **Radio streams**: only `https://` station URLs are offered (filtered from the Radio Browser API results) — plain-HTTP streams triggered "connection not fully secure" warnings.

## Local dev / verification workflow (no dev server, no build)

There's no bundler and no local server config. The practical workflow used throughout this project:

1. Edit `index.html` directly with a text editor / Edit tool.
2. **Syntax-check the inline `<script>` blocks** before shipping — the file is too large for quick manual review. Node.js is installed but often isn't on PATH in a fresh shell; find it explicitly if `node` isn't recognized:
   ```powershell
   Get-Command node -ErrorAction SilentlyContinue
   # if empty, it's usually at:
   & "C:\Program Files\nodejs\node.exe" --version
   ```
   Then run something like:
   ```js
   const fs = require('fs');
   const html = fs.readFileSync('index.html', 'utf8');
   const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
   scripts.forEach((s, i) => { try { new Function(s); } catch (e) { console.log('ERROR in block', i, e.message); } });
   ```
3. The in-app browser preview tool (`mcp__Claude_Browser__*`) is **unreliable for `file://` URLs** — it frequently serves stale tab content or errors "no site is open" even right after a successful `navigate` call. When it misbehaves, prefer `javascript_tool` calls against whatever tab id IS responding (check with `tabs_context` first) over trying to force a fresh navigate/screenshot. Don't burn much time fighting it — fall back to static checks (syntax check, tag-balance check, grep) if it stalls twice.
4. Commit, push to `main`, then verify the deploy actually went out (don't just assume a push = a live deploy):
   ```bash
   curl -s -H "Authorization: Bearer $NETLIFY_TOKEN" \
     "https://api.netlify.com/api/v1/sites/46e0cee6-58f8-4f0e-aa8e-b87c9e7951a5/deploys?per_page=1"
   ```
   Look for `"state":"ready"` and confirm `commit_ref` matches your latest commit. `$NETLIFY_TOKEN` is already set in this environment as a Personal Access Token — don't ask the user for Netlify credentials, just use it.
5. For a bigger feature you want the user to test before it's live for everyone: feature branch → PR → Netlify auto-generates a Deploy Preview URL on the PR. GitHub PR creation without `gh` CLI available can be done via `mcp__claude-in-chrome__*` browser automation in the user's real authenticated Chrome (used previously to submit a PR form since `gh` wasn't installed).

## Branching strategy

- Direct-to-`main`: bug fixes, small/safe features, anything the user is fine seeing go live immediately.
- Feature branch + PR + Deploy Preview: bigger, riskier, or "let me test this before it's live" features.

## Onboarding guide — editing notes

`onboarding.html` was originally built as a Claude Artifact (published at `https://claude.ai/code/artifact/414bc56a-79cd-4384-96d0-4f88e3d28767`, favicon 🌾) from a source file at `C:\Users\msiba\Desktop\Sessions\farm-manager-onboarding.html`. That source file is an **Artifact content-fragment** — it starts directly with `<style>`, no `<!DOCTYPE>`/`<html>`/`<head>`/`<body>`. The in-app `onboarding.html` is that same content wrapped in a real document shell (see the small Node script pattern used to build it — read the fragment, wrap with DOCTYPE/head/title/viewport-meta/body, write to the repo).

**The fragment source is ~1.4MB** (11 real embedded screenshots + ~14 hand-drawn SVG icons, all base64-inlined) — well past the Read tool's token limit. Editing pattern that worked: small targeted Node.js scripts with unique-anchor-string `replace()` calls (never the Edit tool on this file), plus a tag-balance verification script counting `<div>`/`<section>`/`<svg>`/`<style>` open vs. close tags before trusting any edit. If the user provides new screenshots to add, they typically land in `~/Downloads` — locate the newest files there, base64-embed via a script, verify balance, then re-wrap and rewrite `onboarding.html`.

If the guide content needs to change going forward, decide whether to edit the Desktop fragment source first (and re-wrap into the repo copy) or edit the repo's `onboarding.html` directly — they are two independent files now and will drift if only one is edited.

## Onboarding UX in the live app (shipped, commit `ffb9a77`)

- **First-run carousel**: 5-slide welcome modal (`#onboarding-modal`, `ONBOARDING_SLIDES` array, `openOnboardingModal()`/`onboardingNext()`/`onboardingPrev()`/`closeOnboardingModal()`). Shows automatically on first load via `maybeShowOnboarding()`, which skips itself if the user already has data, is signed in, or already dismissed the consent modal once (`sc_onboarding_seen` / `sc_dismissed_consent` in `localStorage`). This is a condensed in-app walkthrough, distinct from the full guide.
- **"?" header button** (`#hdr-help-btn`, burnt orange, next to "Sync now"): calls `openOnboardingGuide()`, which does `window.open('onboarding.html', '_blank')` — opens the **full** guide, not the carousel. These two are intentionally separate; don't merge them.

## Auto-update banner (shipped, commit `00dd85a`)

Installed PWAs can stay open for days, so the app now checks for a new service worker on tab-focus and hourly while open (`reg.update()`). When a genuinely new SW takes control (`controllerchange` fires with `hadController` already `true` — the very first activation on a fresh install is deliberately excluded from this), a small dismissible pill (`showUpdateBanner()`, `#sc-update-banner`) appears bottom-center: "A new version is ready" + Refresh/×. It does **not** auto-reload — that was a deliberate choice to avoid wiping in-progress form data on a farm data-entry app.

## Feature areas already built (context for future work, not pending)

- Moisture/rainfall correlation: single source of truth `moistureStatusInfo(d)` / `moistureDisplay(d)`, used by field cards, the Overview soil-moisture chart, and `getStatus()` — keep these in sync if you touch the moisture logic; don't let one surface diverge.
- Crop advisory: `STAGE_TARGETS`, `parseFertMixNPK()`, `recentRainfallMm()`, `suggestNextAction()` are all defined and working, but their per-field-card display was deliberately removed ("overkill" per the user) — logic stays, UI surface doesn't currently show it. Ask before re-adding a visible advisory display.
- Bulk field-stage update dropdown next to "+ Add field" (`bulkSetAllFieldsStage()`), individual per-field stage dropdowns still work independently.
- Mobile tab bar: icon-only under 640px (`.tab-label` hidden, icon enlarged), swipe left/right between tabs (`initTabSwipe()`, ignores touches starting on the map/tables/charts/modals, requires clear horizontal dominance so vertical scrolling is never mistaken for a swipe).
- Google sign-in on both the consent modal and the account panel (`authSignInWithGoogle(btnId, errId)`, generalized after the ID-collision bug above).
- World Radio easter egg in Settings (`RADIO_API_HOSTS`, `loadRadioStations()`, HTTPS-only streams).
- Install-to-home-screen button (`installApp()`, `#hdr-install-btn`, wired to `beforeinstallprompt`/`appinstalled`).

## Nothing is currently pending

As of `00dd85a`, all requested work (401 fix, brand rebrand, moisture correlation, bulk stage update, mobile tabs/swipe, onboarding carousel + full guide + help button, auto-update banner) is shipped and confirmed live on production. If you're reading this because a session got cut, there's no unfinished thread to pick back up — just ask the user what's next, or check `git log` for anything past this file's "last updated" commit if time has passed.
