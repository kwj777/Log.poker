/**
 * The card art, and the hand diagrams the blog posts inline.
 *
 * A poker hand is a hundred lines of coordinates, and a post that told one in
 * hand-written SVG would be unreadable and would look different from the last
 * one. So each figure is a short spec below, and this turns it into a card
 * table: cream faces, the family's palette, a gold edge on the cards that
 * mattered, and a face-down back carrying the mark.
 *
 * The **SVG is the artifact**, committed under `content/blog/figures`, and
 * `scripts/build-blog.mjs` inlines it. Nothing in the site build runs this
 * file. Run it by hand after changing a spec, and check the SVG in with the
 * post:
 *
 *     node scripts/draw-hand.mjs
 *
 * An argument writes the figures somewhere else instead, which is how
 * `src/site/__tests__/blog.test.ts` checks that the committed SVGs are still
 * the ones these specs describe.
 *
 * `scripts/build-og.mjs` imports the card drawing and the specs from here, so
 * the hand on a share card is drawn by the same code as the hand in the post.
 *
 * A card is `<rank><suit>`: `As`, `Td`, `2c`. A trailing `!` gives it the gold
 * edge that marks it as part of the hand being told. `?` as the rank is a card
 * whose rank is genuinely not remembered, and `??` is one nobody ever saw.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(process.argv[2] ?? join(ROOT, 'content', 'blog', 'figures'));

const W = 420;
export const CARD = { w: 54, h: 76, r: 5 };
const GAP = 8;
/** The break between the flop and the streets that follow it. */
const STREET_GAP = 16;
/** A row is a label, then the cards. Anything below that is added to it. */
const LABEL = 16;
const CARD_TOP = 26;
const ROW = CARD_TOP + CARD.h;
const ROW_GAP = 34;

const CREAM = '#e8e4da';
const RIM = '#2e3a35';
const GOLD = '#c9a86a';
const FOREST = '#3d4a44';
const DIM = '#828e89';
const MUTED = '#b7c0ba';
const RED = '#b7343f';
const BLACK = '#242b28';

/** The family's ink, for anything else drawing on the same table. */
export const PALETTE = { CREAM, RIM, GOLD, FOREST, DIM, MUTED, RED, BLACK, GROUND: '#1c211f' };

const SUITS = { d: '♦', h: '♥', s: '♠', c: '♣' };
const NAMES = { d: 'diamonds', h: 'hearts', s: 'spades', c: 'clubs' };
const SPOKEN = { A: 'Ace', K: 'King', Q: 'Queen', J: 'Jack', T: 'Ten' };
export const PIP_FONT = "'Segoe UI Symbol','Apple Symbols','Arial Unicode MS','DejaVu Sans',sans-serif";
export const SERIF = "Georgia,'Times New Roman','Liberation Serif','Nimbus Roman',serif";
export const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Liberation Sans',Arial,sans-serif";
const INK = { gold: GOLD, muted: MUTED, dim: DIM };

const label = (x, y, text, fill = DIM) =>
  `  <text x="${x}" y="${y}" font-family="${SANS}" font-size="11" letter-spacing="2.2"
    text-anchor="middle" fill="${fill}">${text}</text>`;

const street = (x, y, text) =>
  `  <text x="${x}" y="${y}" font-family="${SANS}" font-size="9.5" letter-spacing="1.8"
    text-anchor="middle" fill="${DIM}">${text}</text>`;

/** "ME" and then "Straight flush, six high": who, and what they ended up with. */
const outcome = (y, who, what, ink) =>
  `  <text x="${W / 2}" y="${y}" text-anchor="middle" font-family="${SERIF}" font-size="14" fill="${INK[ink]}">` +
  `<tspan font-family="${SANS}" font-size="10" letter-spacing="1.8" fill="${DIM}">${who} </tspan>${what}</text>`;

/** The family mark, for the back of a card nobody turned over. */
const back = (x, y) => `  <g>
    <title>A card that was never shown</title>
    <rect x="${x}" y="${y}" width="${CARD.w}" height="${CARD.h}" rx="${CARD.r}"
      fill="${FOREST}" stroke="${RIM}" stroke-width="1" />
    <g transform="translate(${x + CARD.w / 2 - 22} ${y + CARD.h / 2 - 22}) scale(0.22)"
      fill="none" stroke-linejoin="round" stroke-linecap="round" opacity="0.75">
      <path d="M100 125 L100 163" stroke="${GOLD}" stroke-width="8" />
      <path d="M34 125 L166 125 L100 37 Z" stroke="#9aae80" stroke-width="6" />
      <path d="M56 125 L100 66 L144 125" stroke="#75886a" stroke-width="6" />
      <path d="M78 125 L100 96 L122 125" stroke="#55665e" stroke-width="6" />
    </g>
  </g>`;

/** One card face, at the size every hand on this site is drawn at. */
export const card = (x, y, spec) => {
  if (spec.startsWith('??')) return back(x, y);

  const played = spec.endsWith('!');
  const [rank, suit] = (played ? spec.slice(0, -1) : spec).split(/(?=[dhsc]$)/);
  const color = suit === 'd' || suit === 'h' ? RED : BLACK;
  const unknown = rank === '?';
  return `  <g>
    <title>${unknown ? `A ${NAMES[suit].slice(0, -1)}, and I could not tell you which` : `${SPOKEN[rank] ?? rank} of ${NAMES[suit]}`}</title>
    <rect x="${x}" y="${y}" width="${CARD.w}" height="${CARD.h}" rx="${CARD.r}"
      fill="${CREAM}" stroke="${played ? GOLD : RIM}" stroke-width="${played ? 2 : 1}"${unknown ? ' stroke-dasharray="4 3"' : ''} />
    <text x="${x + 7}" y="${y + 22}" font-family="${SERIF}" font-size="19"
      fill="${unknown ? '#8f8a80' : color}">${rank}</text>
    <text x="${x + CARD.w / 2}" y="${y + 58}" font-family="${PIP_FONT}" font-size="27"
      text-anchor="middle" fill="${color}">${SUITS[suit]}</text>
  </g>`;
};

/** Card positions for a run of cards, with the wider break after the flop. */
const spread = (count, streets) => {
  const width = CARD.w * count + GAP * (count - 1) + (streets ? STREET_GAP : 0);
  const start = (W - width) / 2;
  return Array.from({ length: count }, (_, index) =>
    start + index * (CARD.w + GAP) + (streets && index >= 3 ? STREET_GAP : 0));
};

/** Lays the rows out top to bottom and reports how tall the drawing came out. */
const draw = (name, { title, desc, rows }) => {
  const parts = [];
  let y = 0;

  for (const row of rows) {
    if (row.type === 'note') {
      parts.push(label(W / 2, y + 11, row.text));
      y += 11 + ROW_GAP;
      continue;
    }

    const groups = row.type === 'hands' ? row.groups : [{ label: row.label, cards: row.cards }];
    if (row.type === 'hands') {
      const centers = groups.length === 1 ? [W / 2] : [W * 0.29, W * 0.71];
      groups.forEach((group, index) => {
        const center = centers[index];
        const start = center - (CARD.w * group.cards.length + GAP * (group.cards.length - 1)) / 2;
        parts.push(label(center, y + LABEL, group.label));
        group.cards.forEach((spec, position) =>
          parts.push(card(start + position * (CARD.w + GAP), y + CARD_TOP, spec)));
      });
    } else {
      const streets = Boolean(row.streets);
      const at = spread(row.cards.length, streets);
      parts.push(label(W / 2, y + LABEL, row.label));
      row.cards.forEach((spec, index) => parts.push(card(at[index], y + CARD_TOP, spec)));
      if (streets) {
        parts.push(street(at[1] + CARD.w / 2, y + ROW + 16, 'FLOP'));
        parts.push(street(at[3] + CARD.w / 2, y + ROW + 16, 'TURN'));
        parts.push(street(at[4] + CARD.w / 2, y + ROW + 16, 'RIVER'));
      }
    }

    let bottom = y + ROW + (row.streets ? 16 : 0);
    for (const [who, what, ink] of row.outcomes ?? []) {
      bottom += 22;
      parts.push(outcome(bottom, who, what, ink ?? 'muted'));
    }
    y = bottom + ROW_GAP;
  }

  const height = y - ROW_GAP + 8;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${height}" role="img"
  aria-labelledby="${name}-title ${name}-desc">
  <title id="${name}-title">${title}</title>
  <desc id="${name}-desc">${desc}</desc>

${parts.join('\n')}
</svg>
`;
};

export const FIGURES = {
  /** The bomb pot: two boards, one deck, and every six in it face up. */
  'bomb-pot-hand': {
    title: 'A double-board bomb pot, scooped',
    desc: `My hand: the two and four of diamonds. His hand: the jack of clubs and six of
    spades. Board one runs three, five and six of diamonds, then a jack of spades and a
    six of clubs, giving me a six-high straight flush and him sixes full of jacks. Board
    two runs the jack of hearts, three of spades and five of clubs, then the six of
    hearts, with the river unrecorded, giving me a six-high straight and him jacks and
    sixes. Gold-edged cards are the ones that made my hand.`,
    rows: [
      {
        type: 'hands',
        groups: [
          { label: 'MY HAND', cards: ['2d!', '4d!'] },
          { label: 'HIS HAND', cards: ['Jc', '6s'] },
        ],
      },
      {
        label: 'BOARD ONE',
        cards: ['3d!', '5d!', '6d!', 'Js', '6c'],
        streets: true,
        outcomes: [['ME', 'Straight flush, six high', 'gold'], ['HIM', 'Sixes full of jacks', 'muted']],
      },
      {
        label: 'BOARD TWO',
        cards: ['Jh', '3s!', '5c!', '6h!', '??'],
        streets: true,
        outcomes: [['ME', 'Straight, six high', 'gold'], ['HIM', 'Jacks and sixes', 'muted']],
      },
    ],
  },

  /** The fold: a hand I remember by suit, and the two spades that came after. */
  'folded-flush': {
    title: 'The flush that arrived after the fold',
    desc: `My hand: the ace of spades and a second spade whose rank I do not remember.
    The flop came the nine of spades, the seven of hearts and the two of clubs, leaving
    me ace high with a backdoor flush draw, and I folded to a bet. The turn was the four
    of spades and the river the queen of spades, which would have made me the nut flush.
    Gold-edged cards are the five spades that never got to be a hand.`,
    rows: [
      { type: 'hands', groups: [{ label: 'MY HAND', cards: ['As!', '?s!'] }] },
      { type: 'note', text: 'FOLDED ON THE FLOP' },
      {
        label: 'THE FLOP',
        cards: ['9s!', '7h', '2c'],
        outcomes: [['ME', 'Ace high, and a backdoor draw', 'muted']],
      },
      {
        label: 'THE TURN AND THE RIVER',
        cards: ['4s!', 'Qs!'],
        outcomes: [['WOULD HAVE BEEN', 'The nut flush', 'gold']],
      },
    ],
  },
};

/**
 * The cards a figure marks as part of the hand, split the way they were
 * dealt: the two that were mine, then what the board gave. A share card opens
 * on those rather than on a logo, and the split is what keeps the row
 * readable as a hand instead of as five cards in a line.
 */
export const playedHand = (name) => {
  const rows = FIGURES[name]?.rows ?? [];
  const mine = rows.find((row) => row.type === 'hands')?.groups[0]?.cards ?? [];
  const board = rows
    .filter((row) => row.type !== 'hands' && row.type !== 'note')
    .flatMap((row) => row.cards ?? []);
  const played = (cards) => cards.filter((spec) => spec.endsWith('!'));
  return { hole: played(mine), board: played(board) };
};

// Importing this file must not write anything, so only a direct run draws.
if (resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  mkdirSync(OUT, { recursive: true });
  for (const [name, spec] of Object.entries(FIGURES)) {
    const svg = draw(name, { ...spec, desc: spec.desc.replace(/\s+/g, ' ').trim() });
    writeFileSync(join(OUT, `${name}.svg`), svg);
    console.log(`${name}.svg  ${svg.length} bytes`);
  }
}
