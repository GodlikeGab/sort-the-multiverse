# Sort the Multiverse

A Magic: The Gathering deck-building swiper for your phone. Build a Scryfall search, then
swipe through the results round by round until only your deck is left. The aim is the best
possible deck for a commander, reached by looking at every card it could play.

It is an installable web app: once it is on your home screen it opens full-screen like any
other app, and everything you do is saved on the phone. There is no server and no account.
The only things that need internet are searching Scryfall and loading card images.

## Put it on your phone

The app has to be published once to a web address (any free static host works). After that
the PC is never needed again.

### Published with GitHub Pages

The app lives at **https://godlikegab.github.io/sort-the-multiverse/**.

To publish a new version after changing the code, run this in the project folder on the PC:

```powershell
npm run deploy
```

It builds the app and pushes the result to the repository's `gh-pages` branch, which GitHub
Pages serves. The site updates within a minute or two; on the phone, close the app fully and
open it again. Your saved projects on the phone are not touched.

### Install on the phone

Open the address in the phone's browser, then:

- **Android (Chrome):** menu **⋮ → Add to Home screen → Install**.
- **iPhone (Safari):** **Share → Add to Home Screen**.

Open it from the home-screen icon from then on. Installing also tells the phone to keep the
app's data.

## Using it

### New project

- **Name, format, deck size** (Commander 100, Constructed 60, or any number) and an optional
  **commander**, which limits the pool to its color identity.
- **Search builder**: text (name, oracle, flavor, keywords), type line (types, supertypes,
  subtypes), colors and color identity (exactly / including / at most), mana (value, cost
  symbols, produces), power / toughness / loyalty, printing (rarity, set, year, artist),
  format legality (legal / banned / restricted), price (USD, EUR), and flags (`is:commander`,
  paper / Arena / MTGO). Everything combines.
- **Raw Scryfall query**: any [Scryfall syntax](https://scryfall.com/docs/syntax), added to
  the builder's criteria.
- The bar at the bottom shows the **live result count** and the exact query.
- **Swipe order**: card type then A–Z, name, mana value, color, or random.

Creating the project downloads every page of results. Keep the app open until it finishes;
big pools (every card in a commander's colors) take a minute or two.

### Swiping

| Action | Swipe | Key (on a computer) |
| ------ | ----- | --- |
| Keep   | right | `Enter` or `→` |
| Cut    | left  | `Space` or `←` |
| Maybe  | up    | `↓` or `↑` |
| Bad    | down  | `B` |
| Undo (unlimited) | ↶ button | `Z` |
| Flip a double-faced card | tap the card | `F` |
| Oracle text | long-press, or the *i* button | `I` |

Every swipe is saved immediately. Close the app at any point and pick up where you left off.

**Type filter.** The row of chips above the card (All, Creatures, Artifacts, …) shows
reviewed/total for each card type. Tap one to swipe only that type; tap it again for all.

**Bulk.** The *Bulk…* chip decides many unreviewed cards at once: pick a card type and/or a
mana value range, see how many cards match, then cut, keep or maybe them all. One Undo
reverts the whole batch.

**Nothing to sway you.** The app never shows a card's price or how popular it is, and it
cannot order or bulk-cut cards by either, so every card is judged on what it does. The header
estimates the time left at your current pace.

**Bad** puts the card on a global bad-cards list. Those cards are hidden from all your
projects. Each project has a toggle to ignore the list, and the *Bad cards* page lets you take
cards off it.

### Rounds

- Round 1's pool is the full search result.
- When every card is reviewed, you **resolve each Maybe** as Keep or Cut.
- The **summary** shows pool size → kept count and how many cards are still to cut.
- **Review lists.** Each round has Keep, Maybe, Cut and Bad lists, grouped by card type and
  sorted A–Z, with a search box to find a card by name. In the current round, tap any card to
  move it to another list.
- **Start next round** makes the kept cards the new pool.
- The project page keeps the **history of all rounds**; open any round to see its lists.

### Basic lands and the target

You do not need to know the number of basics in advance: they fill whatever the kept cards
leave open. When a round is finished, the summary shows the **open slots** (deck size − commander
− kept cards − basics). Set the counts yourself, including snow basics and Wastes, or tap
**Fill with basics**, which splits the open slots by how often each colour's mana symbol
appears in your kept cards. The counts stay editable, there and on the project page.

If you already know roughly how many basics you want, enter them early so the target and the
"over the deck size" count account for them.

**Non-basic target = deck size − basics − commander.** It updates live. When a finished
round's kept cards exactly fill the target, the project is marked **Deck complete**.

**Kept cards** on the project page shows counts by type, total lands, the mana curve and
average mana value of what you have kept so far.

**Export to ManaBox** downloads the kept cards as a `.txt` file (there is also a copy
button), one card per line under section headers:

```
// COMMANDER
1 Lathril, Blade of the Elves

// CREATURES
1 Elvish Mystic
1 Llanowar Elves

// LANDS
8 Swamp
9 Forest
```

### Managing a project

- **Rename** it with the ✎ next to its name.
- **Re-sort** the cards still to review at any time (for example card type in round 1, mana
  value in round 2). Cards already decided are untouched.
- **New project from this search** opens the builder pre-filled with the project's settings.
- **Help** in the top bar is the same guide inside the app.

## Your data and backups

Your progress is protected in three layers, all automatic:

1. **Saved on the phone instantly.** Every swipe is written the moment you make it.
2. **Snapshots on the phone.** About 20 seconds after you stop swiping (and when you leave
   the app) a snapshot is taken: the latest state, plus one per day for the last five days
   you used the app. Before a project is deleted or a restore replaces your data, the previous
   state is set aside too. *Data → Snapshots on this phone* restores any of them.
3. **A copy outside the phone.** Once you connect GitHub, the same snapshot is uploaded to a
   secret gist in your own account. If the phone is lost, reset, or its browser data is
   cleared, install the app again, connect with a token, and tap *Restore*. The card texts and
   images are re-downloaded from Scryfall.

### Turning on the off-phone backup (once)

1. In the app, open **Data** and tap **Create an access token on GitHub**.
2. On GitHub, leave only **gist** ticked, set *Expiration* to **No expiration**, and generate
   the token.
3. Paste it into the app and tap **Connect**. The app uploads a backup and reads it back to
   confirm it works.

The token stays on the phone and can only read and write your gists. The home screen shows
"Backed up to GitHub …" when all is well, and a red notice if an upload ever fails.

Notes:

- A backup holds your decisions and card names, not prices or images.
- An empty app never overwrites an existing backup, and a backup made by another device is
  never overwritten without asking.
- GitHub keeps the history of every upload on the gist's page, as a last resort.
- **Backup file** on the Data page still saves a complete copy to a file by hand.
- Different devices each have their own projects; restoring a backup is how you move them.

## Good to know

- **Basic lands are left out of searches** (`-t:basic` is added) because you add them as counts.
- **A project's search is fixed** once created. To change it, create a new project.
- **Card count check**: after a download the app compares what it saved with what Scryfall
  reported and warns on the project page if they differ.
- **CAD prices**: Scryfall does not provide them, so the price filter offers USD and EUR.
- **Scryfall etiquette**: requests carry an `Accept` header and are spaced at least 100 ms
  apart, per the [API guidelines](https://scryfall.com/docs/api). Browsers set the
  `User-Agent` themselves; a web page is not allowed to change it.

## Development (Windows)

Needs [Node.js](https://nodejs.org) 20 or newer.

```powershell
npm install
npm run dev
```

Opens on `http://localhost:5173` with hot reload. `npm run build` writes the publishable app
to `dist`; `npm run preview` serves that build on port 4173.

```
src/query.ts      search builder → Scryfall query
src/scryfall.ts   Scryfall client (paging, rate limit)
src/store.ts      all saved data (IndexedDB): projects, rounds, undo log, bad list, backup
src/pages/        the screens
public/sw.js      keeps the app itself available offline
```
