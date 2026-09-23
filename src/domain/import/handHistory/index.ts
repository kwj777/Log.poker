/**
 * Hand-history import: the text a poker site writes for every hand, read into
 * the hands the player was dealt.
 *
 * `sessionImport.ts` explains why Log once said it would never do this: a hand
 * history is an action-level record, and Log's `Hand` is a journal entry about
 * a hand. Both halves of that are still true. What changed is the question the
 * player asked, which was "when I import tonight's hands, do they go into
 * tonight's session?" -- and a journal entry needs exactly what a hand history
 * has at the top and bottom of it: the cards, the board, the seat, what it did
 * to the stack, and when. The street-by-street action in between is read only
 * to work out the money, and is not kept.
 *
 * Files are read hand by hand and a hand that cannot be read is skipped with a
 * reason, never guessed at. A file from a site this does not know produces an
 * error that says so, rather than an empty preview.
 */

import { dealtCounts } from './common';
import { BRACKET_FAMILY_START, parseBracketFamilyHand } from './bracketFamily';
import { STARS_FAMILY_START, parseStarsFamilyHand } from './starsFamily';
import type { HandHistoryResult, HandHistoryWarning, HandSite, ParsedHand } from './types';

export * from './types';
export * from './sittings';

/** Every line ending in use: Windows, Unix, and the bare return of an older Mac export. */
const LINE_BREAK = /\r\n|\r|\n/;

const isStart = (line: string): boolean =>
  STARS_FAMILY_START.test(line) || BRACKET_FAMILY_START.test(line);

/**
 * Whether a piece of text is hand histories rather than a spreadsheet.
 *
 * The import screen takes both through the same door, and this is how it
 * decides which reader to hand the file to. The first line that is not blank
 * decides it, since every format this reads opens with its hand header.
 */
export const looksLikeHandHistory = (text: string): boolean => {
  const first = text
    .replace(/^﻿/, '')
    .split(LINE_BREAK)
    .find((line) => line.trim() !== '');
  return first !== undefined && isStart(first.trim());
};

/**
 * Break a file into one block of lines per hand.
 *
 * partypoker opens a hand with 888poker's `#Game No` line and then its own
 * `***** Hand History for Game` line, and both are starts. The second one
 * straight after the first is the same hand, not another; splitting there
 * left every partypoker hand with a one-line twin that was read as an 888poker
 * hand with no date, and warned about.
 */
const splitHands = (text: string): string[][] => {
  const hands: string[][] = [];
  let current: string[] | null = null;
  for (const raw of text.replace(/^﻿/, '').split(LINE_BREAK)) {
    const line = raw.replace(/^﻿/, '').trimEnd();
    const continues =
      current !== null && current.length === 1 && /^#Game No/.test(current[0]);
    if (isStart(line.trim()) && !continues) {
      current = [line.trim()];
      hands.push(current);
      continue;
    }
    if (current && line.trim() !== '') current.push(line);
  }
  return hands;
};

export const parseHandHistory = (text: string): HandHistoryResult => {
  const hands: ParsedHand[] = [];
  const warnings: HandHistoryWarning[] = [];
  const sites: HandSite[] = [];
  const seen = new Set<string>();
  let skipped = 0;
  let watched = 0;

  const blocks = splitHands(text);
  const counts = dealtCounts(blocks);
  for (const block of blocks) {
    const read = BRACKET_FAMILY_START.test(block[0])
      ? parseBracketFamilyHand(block, counts)
      : parseStarsFamilyHand(block, counts);
    if ('skip' in read) {
      skipped += 1;
      // Hands the player only watched are the common case in a file somebody
      // saved from a table they were not sitting at, and one line each would
      // bury anything worth reading. They are counted instead.
      if (read.skip.startsWith('No cards were dealt')) watched += 1;
      else warnings.push({ handId: read.handId, message: read.skip });
      continue;
    }
    const { hand } = read;
    // The same hand twice, which a tracker's combined export and a site's own
    // file will both produce: once is what happened.
    const key = `${hand.site}:${hand.handId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!sites.includes(hand.site)) sites.push(hand.site);
    hands.push(hand);
  }

  if (watched > 0) {
    warnings.unshift({
      handId: null,
      message: `${watched} hand${watched === 1 ? '' : 's'} had no cards dealt to you, so ${
        watched === 1 ? 'it is one' : 'they are ones'
      } you watched rather than played. Skipped.`,
    });
  }

  hands.sort((a, b) => a.at - b.at);
  return { hands, warnings, skipped, sites };
};
