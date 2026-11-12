## History: first version of Sort the Multiverse (April 2026, built in a regular Claude chat, before this repo)

Purpose: Tinder-style sorter for building a Commander deck (Lumra, Bellow of the Woods) by reviewing every card in the color identity, one card at a time, voting Yes / Maybe / No.

Card pool: 7,083 cards from a plain-text list (one "1 Card Name" per line, grouped under headers like [CREATURES]). 9 categories: Commander, Planeswalkers (the old maybeboard was merged in), Creatures, Artifacts, Instants, Sorceries, Enchantments, Battles, Lands. Sorted A–Z within each category. Scryfall returns ~48 more cards for the same search; those were removed on purpose.

What failed: the phone versions (a local HTML file, then a Claude chat artifact) never loaded card images, because iOS Safari and the artifact sandbox blocked Scryfall. That is why the current version is a hosted web app.

Features of the first version:
- Yes / Maybe / No voting with Undo (no Skip option)
- Remaining-card count and a progress bar
- Left sidebar: filter by card type, with voted/total counts per type
- Right panel: review all voted cards grouped by decision and type; cards can be moved between Yes / Maybe / No afterward
- Auto-save after every vote, a "resume?" prompt on reopen, and export/import of a JSON save file to move progress between devices
- "Export to ManaBox" button: downloads the Yes cards as a .txt, one "1 Card Name" per line, under section headers like "// COMMANDER" and "// CREATURES"

Keyboard shortcuts (chosen by me): Enter = Yes, Space = No, Down arrow = Maybe, Z = Undo.

Look (chosen by me): true black (#000) everywhere, including sidebars and behind the card, with cyan accents and no navy or green tint. Yes = neon green, Maybe = neon yellow, No = bright red on counts, buttons and review tabs; buttons have a dark tinted background matching their color. The card image is as large as possible at real MTG proportions, never clipped, with a little space above and below it.

Known bug to guard against: one rebuild stripped special characters from card names, and cards silently went missing. Watch for accents (Dúnedain, Mjölnir, Lothlórien, Nazgûl, Séance, Ifh-Bíff Efreet), "//" double-faced names, "&" (Groundchuck & Dirtbag), and blank placeholders ("_____-o-saurus", "_____ _____ Rocketship"). Card counts should always be checked after any change to the card data.

Where the project is headed: projects (each one a saved Scryfall-style search with its own swipe progress), a separate "Bad cards" pile apart from Maybe, search filters as complete as Scryfall/ManaBox, and multi-round narrowing (e.g. ~3,000 → ~125 → … → a 100-card deck including basic lands).

## Current version (November 2026, this repo)

A phone-first installable web app (React + Vite + TypeScript, no server). All data is stored on the device in IndexedDB (`src/store.ts`); searches go straight from the browser to Scryfall (`src/scryfall.ts`). Published to GitHub Pages at https://godlikegab.github.io/sort-the-multiverse/ with `npm run deploy` (`scripts/deploy.mjs` builds and force-pushes `dist` to the `gh-pages` branch; no GitHub Actions workflow, because the CLI sign-in lacks the `workflow` scope). Commits use the GitHub noreply email set in this repository's git config, since the repository is public.

Carried over from the first version: true-black look with cyan accent and neon green / yellow / red; keyboard Enter = Keep, Space = Cut, Down = Maybe, Z = Undo (B = Bad is new); type filter with reviewed/total per type; review lists grouped by type with moves between Keep / Maybe / Cut; "Export to ManaBox" .txt with `// SECTION` headers; JSON backup export/import; card-count check after every download.

Deliberately different: decisions are named Keep / Cut / Maybe / Bad; the app resumes silently instead of asking "resume?"; the pool comes from a live Scryfall search, not a fixed text list (so the ~48 hand-removed cards are not excluded, and first-version save files cannot be imported).

Rules for changes: changing the shape of stored data needs an IndexedDB version bump with a migration in `getDb()`; never transform card names (store them exactly as Scryfall returns them); run `npm run build` (it typechecks) before publishing.

Quality-of-life features added after the merge: bulk decide with criteria (type, mana value) undone as one step via a `batch` id in the undo log; a pace estimate; deck stats for kept cards (types, curve); name search in review lists; re-sorting the remaining cards; rename; "New project from this search"; backup reminder; screen wake lock during downloads; an in-app Help page (`src/pages/HelpPage.tsx`) that must be kept in step with the README.

Design principle (decided by the owner, November 2026): the goal is the best possible deck for a commander, reached by considering every eligible card on its merits. The app must not show or use anything that could sway a keep/cut decision: no price, no EDHREC rank or other popularity signal on cards, in card details, in stats, in sort orders or in bulk actions. Price remains available only as an optional search-builder filter that defines the pool.

Basic lands: the number of basics is not known up front; they fill the slots the kept non-basics leave open (1 to 35 or more). The summary and project page show open slots once a round is resolved, with a "Fill with basics" button (`api.fillBasics`, proportional to coloured mana symbols in kept cards). Being under the deck size is normal, not a warning.

Backups (owner requirement: never lose progress, and never have to think about it): `src/autosave.ts` runs a backup cycle about 20 s after the last change, on leaving the app, and at most 90 s apart during continuous use. Each cycle writes a compact snapshot (decisions, card names, undo log; no card texts) to the `snapshots` store (latest, one per day for 5 days, plus `safety:` copies before a delete or restore) and, when the user has connected GitHub with a gist-scoped token, PATCHes it to a secret gist. Safety rules that must be preserved: an app with zero projects never uploads; a backup written by another device is never overwritten without the user's choice; connecting on a fresh device offers restore instead of uploading; restore re-downloads card data from Scryfall by oracle id. The real GitHub calls were verified only against a stand-in API in testing, not against github.com.

iPhone layout (from a real-device screenshot, November 2026): the installed web app extends under the status bar, and iOS then reports a viewport shorter than the screen by the status bar height. `src/viewport.ts` measures this and sets `--app-h` / `--gap-fix`; the swipe page uses `--app-h` and hides the top navigation (`.app:has(.swipe-page) .topbar`) so the card can be full width. Action buttons are sized in `vw` with `flex: none` so they stay round. Check any layout change at 390x844 with safe-area padding in mind; the status-bar quirk itself cannot be reproduced in a desktop browser.

Swipe controls (owner choice, November 2026): no round direction buttons. Below the card there is a row of small colour-coded direction reminders (clickable with a mouse, inert on touch so a stray thumb cannot decide a card) and under it a wide Undo bar with a square info button beside it.

Simplifications asked for by the owner (November 2026), which override earlier paragraphs above where they conflict: (1) every deck is exactly 100 cards, so there is no deck-size choice (`DECK_SIZE` in `src/store.ts`); (2) basic lands are not tracked at all: no basics panel, no "Fill with basics", no basics in the export; the target is 99 cards plus the commander, slots left open are for basics added in ManaBox, and a project is "Deck ready" once a finished round's kept cards fit; (3) the Bulk tool is removed (the undo log still understands `batch` ids from old data); (4) the time estimate remembers the pace per project in localStorage (`stm.pace.<id>`); (5) back buttons are at least 44 px touch targets.
