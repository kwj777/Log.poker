/**
 * Finding one thing in a log that has years in it.
 *
 * ## Why this is not part of `SessionFilter`
 *
 * The chips on Sessions go through `filterSessions`, which is the in-memory
 * twin of the repository's own filter and is pinned to match it field for
 * field -- the two disagreeing about a date range or a format is a bug class
 * that has already cost this repository once. A text search is not that kind
 * of filter: it is not a column, both repositories would have to grow a LIKE
 * and an index to implement it, and the contract suite would have to pin what
 * "matches" means in SQLite and in IndexedDB separately. For a log that is
 * already entirely in memory on the screen doing the searching, that is a lot
 * of machinery to answer a question a loop answers.
 *
 * ## Every word, anywhere
 *
 * `aria bad` finds a note about a bad beat written at Aria, in either order,
 * and `ari` finds Aria -- because somebody searching their own log is
 * remembering rather than querying, and a search that needs the whole word is
 * one that fails on the try before the one that works. Case is ignored for the
 * same reason.
 *
 * Words rather than the raw string, so a search is not defeated by having
 * typed the room and the note in the order the screen does not happen to
 * concatenate them in.
 */

/** A query with nothing in it matches everything, which is what an empty box means. */
export const searchTerms = (query: string): string[] =>
  query.trim().toLowerCase().split(/\s+/).filter((term) => term.length > 0);

/**
 * Whether every term appears somewhere in the given fields.
 *
 * Nulls are skipped rather than treated as empty strings, which matters only
 * in that most of these fields are usually null: a hand has no note more often
 * than it has one.
 */
export const matchesTerms = (
  terms: readonly string[],
  ...fields: (string | null | undefined)[]
): boolean => {
  if (terms.length === 0) return true;
  const haystack = fields
    .filter((field): field is string => typeof field === 'string' && field.length > 0)
    .join(' ')
    .toLowerCase();
  return terms.every((term) => haystack.includes(term));
};
