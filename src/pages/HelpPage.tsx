import { Link } from 'react-router-dom';

/** The in-app guide: what you can do and how everything works. */
export default function HelpPage() {
  return (
    <main className="page help" style={{ maxWidth: 760 }}>
      <div className="page-head"><h1>How it works</h1></div>
      <p className="muted" style={{ marginTop: 0 }}>
        Look at every card your commander could play, one at a time, and narrow them down round by round until only your deck is left.
      </p>

      <h2>1. Create a project</h2>
      <ul>
        <li><strong>Name, format and deck size.</strong> Commander 100, Constructed 60, or any number.</li>
        <li><strong>Commander (optional).</strong> The pool is limited to its color identity automatically.</li>
        <li><strong>Search builder.</strong> Combine text, types, colors, mana, stats, printing, legality, price and flags. The raw box takes any Scryfall syntax.</li>
        <li><strong>Count before you commit.</strong> The bar at the bottom shows how many cards match and the exact query.</li>
        <li><strong>Swipe order.</strong> Card type then A–Z, name, mana value, color or random. You can change it later.</li>
      </ul>
      <p className="muted small">Creating the project downloads every matching card. Keep the app open until it finishes.</p>

      <h2>2. Swipe</h2>
      <table>
        <thead><tr><th>Decision</th><th>Swipe</th><th>Keyboard</th></tr></thead>
        <tbody>
          <tr><td style={{ color: 'var(--keep)' }}>Keep</td><td>right</td><td>Enter or →</td></tr>
          <tr><td style={{ color: 'var(--cut)' }}>Cut</td><td>left</td><td>Space or ←</td></tr>
          <tr><td style={{ color: 'var(--maybe)' }}>Maybe</td><td>up</td><td>↓ or ↑</td></tr>
          <tr><td style={{ color: 'var(--bad)' }}>Bad</td><td>down</td><td>B</td></tr>
          <tr><td>Undo</td><td>↶ button</td><td>Z</td></tr>
          <tr><td>Flip a double-faced card</td><td>tap the card</td><td>F</td></tr>
          <tr><td>Oracle text</td><td>long-press or <em>i</em></td><td>I</td></tr>
        </tbody>
      </table>
      <ul style={{ marginTop: 10 }}>
        <li><strong>Saved as you go.</strong> Every swipe is stored at once. Close the app and resume on the same card.</li>
        <li><strong>Undo is unlimited</strong> within the current round.</li>
        <li><strong>Type filter.</strong> The chips above the card show reviewed/total per card type. Tap one to swipe only that type.</li>
        <li><strong>Bulk.</strong> Decide many cards at once by card type and mana value, for example cut every remaining land. One Undo reverts the batch.</li>
        <li><strong>Nothing to sway you.</strong> The app never shows a card's price or how popular it is, so each card is judged on what it does. The header estimates the time left at your pace.</li>
        <li><strong>Bad</strong> adds the card to a global list. Those cards are hidden from all your projects, unless a project is set to ignore the list.</li>
      </ul>

      <h2>3. Finish the round</h2>
      <ul>
        <li><strong>Resolve maybes.</strong> Each Maybe comes back for a final Keep or Cut.</li>
        <li><strong>Summary.</strong> Pool size → kept count, and how many are still to cut to reach your target.</li>
        <li><strong>Review lists.</strong> Keep, Maybe, Cut and Bad, grouped by card type. Search by name, tap a card to move it to another list.</li>
        <li><strong>Start the next round.</strong> The kept cards become the new pool. Repeat until the kept count equals the target.</li>
        <li><strong>History.</strong> Every round's lists stay available from the project page.</li>
      </ul>

      <h2>4. Basics, target and stats</h2>
      <ul>
        <li><strong>Basic lands fill the gap.</strong> You do not need to know the number in advance. Narrow down the non-basic cards, then the round summary shows the open slots; set the basics yourself or tap <em>Fill with basics</em>, which splits them by the mana symbols of your kept cards.</li>
        <li><strong>Planning ahead.</strong> If you already know roughly how many basics you want, enter them early: the target and the “over the deck size” count then account for them.</li>
        <li><strong>Target.</strong> Non-basic target = deck size − basics − commander. It updates as you change the counts.</li>
        <li><strong>Kept cards.</strong> Counts by type, land total, mana curve and average mana value.</li>
        <li><strong>Deck complete</strong> appears when a finished round's kept cards exactly fill the target.</li>
      </ul>

      <h2>5. Export</h2>
      <ul>
        <li><strong>Export to ManaBox</strong> downloads a .txt with one card per line under headers such as // COMMANDER and // CREATURES. Basics are listed under // LANDS with their counts.</li>
        <li><strong>Copy</strong> puts the same text on the clipboard.</li>
      </ul>

      <h2>Managing projects</h2>
      <ul>
        <li><strong>Rename</strong> with the ✎ next to the project name.</li>
        <li><strong>Re-sort</strong> the cards still to review from the project page.</li>
        <li><strong>New project from this search</strong> opens the builder pre-filled, to tweak the search. A project's own search cannot be changed once created.</li>
        <li><strong>Delete</strong> removes the project and its progress.</li>
      </ul>

      <h2>Your data and backups</h2>
      <ul>
        <li><strong>Saved instantly.</strong> Every swipe is written to this phone the moment you make it.</li>
        <li><strong>Automatic snapshots.</strong> A few seconds after you stop swiping, the app keeps a snapshot on the phone: the latest state and one per day. Deleting a project or restoring sets the previous state aside first.</li>
        <li><strong>Automatic copy outside the phone.</strong> Connect GitHub once on the <Link to="/data">Data</Link> page and every snapshot is also uploaded to your own account. A lost, reset or wiped phone can then be restored completely.</li>
        <li><strong>Status.</strong> The home screen shows when the last backup was made, and a red notice if one ever fails.</li>
        <li><strong>Internet</strong> is needed to search Scryfall, load card images and upload backups, not to open the app.</li>
      </ul>
    </main>
  );
}
