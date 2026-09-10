/**
 * The log, as rows somebody else's software can read.
 *
 * This is the other half of `src/domain/import`, and it is deliberately the
 * same vocabulary: **the headers are the ones the importer already knows**, so
 * a file this writes is a file Log can read back. That is worth more than it
 * costs. It makes the export a backup rather than a printout, it means moving
 * between two devices without signing in is a file rather than a retype, and
 * it gives the round trip a test that runs the real importer over the real
 * writer rather than checking a column list against itself.
 *
 * ## Numbers, not formatted money
 *
 * `12.50`, not `$12.50`. The importer reads either, but a spreadsheet only
 * sums one of them, and the first thing anybody does with this file is sum a
 * column. The currency has a column of its own, which is where that belongs
 * when a log can hold more than one.
 *
 * ## ISO dates
 *
 * Unambiguous, sortable as text, and the one date format the importer never
 * has to guess the order of. A log exported here and read back cannot land in
 * May because it was written in April by somebody whose spreadsheet is set to
 * the other convention.
 */

import { fromCents } from '../money';
import type { Hand, SessionWithChildren } from '../types';

/** `12.5` for 1250 cents, and an empty cell for nothing at all. */
const money = (cents: number | null | undefined): string =>
  cents == null ? '' : fromCents(cents).toFixed(2);

/** A local ISO stamp: what the clock said, not what UTC said. */
const stamp = (at: number | null): string => {
  if (at === null) return '';
  const date = new Date(at);
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    ` ${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
};

/**
 * Blinds as one cell, in the shape `parseStakes` reads back.
 *
 * Plain numbers rather than `$1/$2`, for the same reason as every other money
 * column, and the ante in the parenthesis the parser looks for.
 */
const stakes = (session: SessionWithChildren): string => {
  if (session.stakes === null) return '';
  const { smallBlind, bigBlind, ante } = session.stakes;
  const base = `${fromCents(smallBlind)}/${fromCents(bigBlind)}`;
  // `(ante 5)`, not `(5 ante)`. The importer's ante pattern reads the word and
  // then the number, and the app's own `formatStakes` writes it the other way
  // round -- so the display format is the one shape this must not copy.
  return ante != null && ante > 0 ? `${base} (ante ${fromCents(ante)})` : base;
};

/**
 * Every rebuy folded into the buy-in, because the importer has no column for
 * them and a session that cost 300 should not export as though it cost 100.
 *
 * The rebuys are not lost anywhere a person can see: the total is what the app
 * itself calls invested, and it is what every number on the dashboard is
 * computed from. What a re-import loses is when each one happened, which is a
 * real loss and a smaller one than the money being wrong.
 */
const invested = (session: SessionWithChildren): number =>
  session.buyIn + session.rebuys.reduce((sum, rebuy) => sum + rebuy.amount, 0);

export const SESSION_HEADERS = [
  'Started',
  'Ended',
  'Format',
  'Game',
  'Stakes',
  'Venue',
  'Buy-in',
  'Fee',
  'Cash-out',
  'Entrants',
  // Not `Finish`, which this app's own importer reads as the end *time*: it is
  // an alias of `endedAt`, and a column called that is silently dropped as a
  // duplicate of `Ended`. The round-trip test is what found it.
  'Finish position',
  'Currency',
  'Notes',
] as const;

export const sessionRow = (session: SessionWithChildren): string[] => [
  stamp(session.startedAt),
  stamp(session.endedAt),
  session.format,
  session.gameType,
  stakes(session),
  session.venue?.name ?? '',
  money(invested(session)),
  money(session.fee),
  money(session.cashOut),
  session.entrants == null ? '' : String(session.entrants),
  session.finishPosition == null ? '' : String(session.finishPosition),
  session.currency,
  session.notes ?? '',
];

/** Oldest first, which is the order a spreadsheet is read in. */
export const sessionRows = (sessions: readonly SessionWithChildren[]): string[][] =>
  [...sessions]
    .sort((a, b) => a.startedAt - b.startedAt)
    .map(sessionRow);

/**
 * The hands, which are notes rather than a hand history.
 *
 * A hand here is the cards the player was dealt, the runout if they recorded
 * one, where they were sitting, what they tagged it, one line about what
 * happened, and optionally what the pot swung. The board is written in the
 * same notation as the cards and is empty on most rows, because it is optional
 * and most hands are logged at the table before there is a runout to log.
 *
 * The importer has no columns for any of this and does not read hands at all,
 * so this file does not round-trip. It is here because a note somebody typed
 * at a table is theirs, and an export that left it behind would be a partial
 * answer to "can I have my data".
 */
export const HAND_HEADERS = [
  'At',
  'Session',
  'Venue',
  'Cards',
  'Board',
  'Position',
  'Tags',
  'Pot swing',
  'Currency',
  'Note',
] as const;

export const handRows = (
  hands: readonly Hand[],
  sessions: readonly SessionWithChildren[],
): string[][] => {
  const byId = new Map(sessions.map((session) => [session.id, session]));
  return [...hands]
    .sort((a, b) => a.at - b.at)
    .map((hand) => {
      const session = byId.get(hand.sessionId);
      return [
        stamp(hand.at),
        // The session's own start, which is what names it on every screen.
        // Its id would be stable and mean nothing to anybody reading this.
        stamp(session?.startedAt ?? null),
        session?.venue?.name ?? '',
        hand.holeCards ?? '',
        hand.board ?? '',
        hand.position ?? '',
        hand.tags.join(' '),
        money(hand.amount),
        session?.currency ?? '',
        hand.note ?? '',
      ];
    });
};

/**
 * What the file is called when it lands in somebody's downloads.
 *
 * Dated, because the second thing anybody does after exporting twice is try to
 * tell the two files apart, and a browser that has already got `log-sessions.csv`
 * saves the next one as `log-sessions (1).csv`. Named for the app first so the
 * two sort together next to whatever else is in there.
 */
export const exportFileName = (kind: 'sessions' | 'hands', at: number = Date.now()): string => {
  const date = new Date(at);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `log-${kind}-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.csv`;
};
