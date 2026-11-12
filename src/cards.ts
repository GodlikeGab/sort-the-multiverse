/** Card categories, in the order the first version used for review and export. */
export const CATEGORIES = [
  'Planeswalkers', 'Creatures', 'Artifacts', 'Instants', 'Sorceries',
  'Enchantments', 'Battles', 'Lands', 'Other',
] as const;
export type Category = (typeof CATEGORIES)[number];

/** One category per card, from the front face's type line (an artifact creature is a creature). */
export function categoryOf(typeLine: string | null | undefined): Category {
  const t = (typeLine ?? '').split('//')[0];
  if (/\bCreature\b/.test(t)) return 'Creatures';
  if (/\bPlaneswalker\b/.test(t)) return 'Planeswalkers';
  if (/\bBattle\b/.test(t)) return 'Battles';
  if (/\bLand\b/.test(t)) return 'Lands';
  if (/\bArtifact\b/.test(t)) return 'Artifacts';
  if (/\bEnchantment\b/.test(t)) return 'Enchantments';
  if (/\bInstant\b/.test(t)) return 'Instants';
  if (/\bSorcery\b/.test(t)) return 'Sorceries';
  return 'Other';
}

export const categoryRank = (c: string) => {
  const i = (CATEGORIES as readonly string[]).indexOf(c);
  return i < 0 ? CATEGORIES.length : i;
};
