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
