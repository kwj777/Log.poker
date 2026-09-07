/**
 * The words on screen, and whether the explanations still match them.
 *
 * A glossary is the easiest thing in a codebase to let rot: nothing breaks when
 * a label is renamed and the entry explaining it is not, the screen simply goes
 * on defining a word it no longer uses. So most of what is below is not about
 * the prose. It is about anchoring: every entry has to name a label the app
 * actually shows, and every label the app shows in shorthand has to have one.
 *
 * The position and tag sets are `Record<Position, ...>` and
 * `Record<HandTag, ...>`, so a missing seat is a compile error rather than a
 * test failure. What a test can still add is that the entry keys the app
 * displays are the strings the app displays, which the type cannot see.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  HAND_TAG_HELP,
  IMPORT_HELP,
  POSITION_HELP,
  STAT_HELP,
  handTagGlossary,
  importGlossary,
  positionGlossary,
} from '../glossary';
import { FIELD_LABELS, IMPORT_FIELDS } from '../import';
import { HAND_TAGS, HAND_TAG_LABELS, POSITIONS } from '../types';

const ROOT = join(__dirname, '..', '..', '..');
const read = (...parts: string[]): string => readFileSync(join(ROOT, ...parts), 'utf8');

const everyEntry = [
  ...Object.values(POSITION_HELP),
  ...Object.values(HAND_TAG_HELP),
  ...Object.values(IMPORT_HELP),
  ...STAT_HELP,
];

describe('what every entry has to be', () => {
  it('says something, in sentences', () => {
    for (const entry of everyEntry) {
      expect(entry.term.trim()).not.toBe('');
      expect(entry.says.length).toBeGreaterThan(30);
      expect(entry.says.trim()).toMatch(/[.!]$/);
    }
  });

  it('and is not just the term said back', () => {
    // "UTG: under the gun" is a expansion, not an explanation. Every entry has
    // to earn its space by saying something the label does not.
    for (const entry of everyEntry) {
      const withoutTerm = entry.says.toLowerCase().replace(entry.term.toLowerCase(), '');
      expect(withoutTerm.split(/\s+/).filter(Boolean).length).toBeGreaterThan(8);
    }
  });

  it('and uses no shorthand that is not itself explained here', () => {
    // An explanation of `HJ` that leans on `CO` is only useful to somebody who
    // did not need either. Both are in here, which is the test: any bare
    // position abbreviation appearing inside a definition must have an entry.
    const explained = new Set(Object.values(POSITION_HELP).map((e) => e.term));
    for (const entry of everyEntry) {
      for (const token of entry.says.match(/\b(UTG1?|MP|LJ|HJ|CO|BTN|SB|BB)\b/g) ?? []) {
        expect(explained.has(token)).toBe(true);
      }
    }
  });
});

describe('the seats', () => {
  it('are all there, and named exactly as the picker labels them', () => {
    // `POSITION_OPTIONS` in the hand screen maps each `Position` straight to its
    // own string, so the chip reads `HJ` and the sheet has to as well.
    for (const position of POSITIONS) {
      expect(POSITION_HELP[position].term).toBe(position);
    }
  });

  it('and read in seat order, which is the order worth reading them in', () => {
    // Alphabetical would put the button between the blinds. The sequence is the
    // explanation: somebody scanning it learns where the seats are relative to
    // each other without any entry having to say so.
    expect(positionGlossary().map((entry) => entry.term)).toEqual([...POSITIONS]);
  });

  it('and explain the button in terms of acting last, which is the whole reason', () => {
    expect(POSITION_HELP.BTN.says).toMatch(/last to act/i);
    expect(POSITION_HELP.SB.says).toMatch(/first/i);
  });
});

describe('the tags', () => {
  it('are named exactly as the chips label them, question mark and all', () => {
    // `misplayed?` keeps its question mark on the chip, so an entry titled
    // `misplayed` would sit next to it looking like a different thing.
    for (const tag of HAND_TAGS) {
      expect(HAND_TAG_HELP[tag].term).toBe(HAND_TAG_LABELS[tag]);
    }
    expect(HAND_TAG_HELP.misplayed.term).toBe('misplayed?');
  });

  it('and read in the order the picker offers them', () => {
    expect(handTagGlossary().map((entry) => entry.term)).toEqual(
      HAND_TAGS.map((tag) => HAND_TAG_LABELS[tag]),
    );
  });
});

describe('the numbers', () => {
  const variance = read('app', '(tabs)', 'variance.tsx');

  it('each name a label that screen actually shows', () => {
    // The anchor rule, and the reason this file is not a general poker
    // glossary: an entry explaining a word the app never prints is an entry
    // nobody will notice going stale.
    //
    // Followed through `anchor` where it is set, because a player calls it the
    // rake and the tile says "Fees paid". The entry is headed with the word
    // somebody would look for and anchored to the one on screen.
    for (const entry of STAT_HELP) {
      expect(variance).toContain(entry.anchor ?? entry.term);
    }
  });

  it('and an anchor is only used where the term genuinely is not printed', () => {
    // Otherwise it becomes the escape hatch that makes the rule above
    // meaningless: anything unanchorable could simply claim to be anchored
    // somewhere else.
    for (const entry of STAT_HELP.filter((one) => one.anchor !== undefined)) {
      expect(variance).not.toContain(entry.term);
    }
  });

  it('and say what a swing is relative to, because the number alone misleads', () => {
    // A standard deviation quoted with no sense of scale reads like a small
    // number. It is usually several times the win rate, and that ratio is the
    // whole reason the confidence band on that screen is as wide as it is.
    const swing = STAT_HELP.find((entry) => entry.term === 'Swing');
    expect(swing?.says).toMatch(/win rate/i);
  });
});

describe('where the help is offered', () => {
  const hand = read('app', 'session', 'hand.tsx');
  const variance = read('app', '(tabs)', 'variance.tsx');

  it('sits beside the shorthand rather than on a page nobody opens', () => {
    // Source-read, because this repository has no component renderer. What it
    // pins is that the three sections carrying jargon each carry the
    // affordance, which is the difference between help and a glossary.
    expect(hand).toMatch(/title="Position"[\s\S]{0,120}positionGlossary\(\)/);
    expect(hand).toMatch(/title="Tag it"[\s\S]{0,120}handTagGlossary\(\)/);
    expect(variance).toMatch(/title="Your numbers"[\s\S]{0,120}STAT_HELP/);
    expect(read('app', 'import.tsx')).toMatch(
      /title="What it reads"[\s\S]{0,160}importGlossary\(\)/,
    );
  });

  it('and opens on a tap rather than a hover, which a phone does not have', () => {
    // The whole reason this is a Sheet and not a tooltip. A hover affordance
    // would work on the web build and be invisible on the platform most of
    // these players are standing at a table holding.
    const explain = read('src', 'components', 'Explain.tsx');
    expect(explain).toContain('<Pressable');
    expect(explain).toContain('onPress={');
    expect(explain).toContain('<Sheet');
    // The hover handlers react-native-web would honor on a desktop browser and
    // silently drop everywhere else. An earlier version of this also refused
    // `title={`, which caught the Sheet's own title prop rather than an HTML
    // tooltip attribute: a blunt pattern matching the thing it was protecting.
    expect(explain).not.toMatch(/onMouseEnter|onMouseOver|onHoverIn/);
  });

  it('and tells a screen reader what it opens, not that it is a question mark', () => {
    const explain = read('src', 'components', 'Explain.tsx');
    expect(explain).toContain('accessibilityRole="button"');
    expect(explain).toMatch(/accessibilityLabel=\{label \?\? `What these mean/);
  });
});

describe('the import columns', () => {
  it('are all there, named exactly as the mapping arrow names them', () => {
    // The screen renders `→ {FIELD_LABELS[field]}`, so these have to be the
    // same strings or the sheet explains columns the arrow never mentioned.
    for (const field of IMPORT_FIELDS) {
      expect(IMPORT_HELP[field].term).toBe(FIELD_LABELS[field]);
    }
  });

  it('and read in the order the mapping lists them', () => {
    expect(importGlossary().map((entry) => entry.term)).toEqual(
      IMPORT_FIELDS.map((field) => FIELD_LABELS[field]),
    );
  });

  it('and tell cash-out and result apart, which is the whole reason for them', () => {
    // A file often carries both and they are not the same measurement. Cash-out
    // is taken directly; a result is a number somebody else already derived, so
    // it fills in only where there is no cash-out column. Getting that backwards
    // is silent, and nobody mapping a spreadsheet could guess it.
    expect(IMPORT_HELP.cashOut.says).toMatch(/direct/i);
    expect(IMPORT_HELP.result.says).toMatch(/derived|only where/i);
  });

  it('and say what happens to a row that is missing something', () => {
    // The import's own promise is that nothing is invented. These are the two
    // columns where that shows, so the help has to say it rather than leave
    // somebody wondering why a session has no win rate.
    expect(IMPORT_HELP.stakes.says).toMatch(/without them|no stakes/i);
    expect(IMPORT_HELP.endedAt.says).toMatch(/ending when it started|per hour/i);
  });
});

describe('the rake', () => {
  const rake = STAT_HELP.find((entry) => entry.term === 'Rake');

  it('is explained where the total is shown, under the label that shows it', () => {
    expect(rake?.anchor).toBe('Fees paid');
  });

  it('and says why the total is tournaments only, rather than leaving it puzzling', () => {
    // Cash rake comes out of the pot, so this app never sees it. Without that
    // sentence a cash player reads "Fees paid: $0" as a bug.
    expect(rake?.says).toMatch(/cash[- ]game rake/i);
    expect(rake?.says).toMatch(/tournament/i);
  });
});
