/**
 * Reading the player's own settings back off disk.
 *
 * Shared by both repositories, because a setting is one thing and a value that
 * has stopped being a number should mean the same on SQLite as it does on
 * IndexedDB. The SQLite side stores JSON in a text column and the IndexedDB
 * side stores the value structured, so what arrives here is `unknown` either
 * way and is validated rather than trusted.
 *
 * ## Why an unreadable value reads as unasked
 *
 * There is no error to report to. A preference is read on launch, by a store
 * that is already handling a database that failed to open, and a starting
 * balance that came back as the string "null" is not a crash -- it is a
 * question the player can answer again in one field. Falling back to unasked
 * costs them one number; refusing to load costs them the app.
 *
 * Null is a real answer here in only one direction: it means unasked, and zero
 * means a player who started from nothing. Nothing may collapse the two, which
 * is the difference between a dashboard that says "bankroll" and one that does
 * not.
 */

import type { Preferences, StartingBalance } from './repository';

/** Every key this table may hold, which is what a write is checked against. */
export const PREFERENCE_KEYS = ['startingBalance'] as const;

export type PreferenceKey = (typeof PREFERENCE_KEYS)[number];

export const DEFAULT_PREFERENCES: Preferences = { startingBalance: null };

/**
 * A stored balance is money with a currency on it, so both have to be there.
 *
 * A whole number of cents, like money everywhere else in this app. Negative is
 * allowed and is not a mistake: somebody who started logging while down to
 * borrowed money has a real answer, and refusing it would make them lie to
 * their own log. Half of a balance -- an amount with no currency, a currency
 * with no amount -- is not a balance, and reads as unasked.
 */
const asBalance = (value: unknown): StartingBalance | null => {
  if (typeof value !== 'object' || value === null) return null;
  const { cents, currency } = value as Partial<StartingBalance>;
  if (!Number.isSafeInteger(cents)) return null;
  if (typeof currency !== 'string' || currency === '') return null;
  return { cents: cents as number, currency };
};

export const toPreferences = (stored: ReadonlyMap<string, unknown>): Preferences => ({
  startingBalance: asBalance(stored.get('startingBalance')),
});

/** The keys of a patch, ignoring anything this table does not know about. */
export const patchedKeys = (patch: Partial<Preferences>): PreferenceKey[] =>
  PREFERENCE_KEYS.filter((key) => key in patch);
