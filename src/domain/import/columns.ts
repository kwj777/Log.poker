/**
 * Header matching.
 *
 * Nobody agrees on what to call these columns. PokerTracker writes "Total
 * Buyin"; a spreadsheet kept for six years writes "In"; PokerCraft writes
 * "Profit"; somebody's own file writes "P/L". Asking the player to map eleven
 * columns by hand before they can see anything is how an import feature goes
 * unused, so the common spellings are listed here and matched automatically.
 *
 * Matching is on an exact normalized string -- lowercased, with everything that
 * is not a letter or a digit removed, so `Buy-In ($)` and `buy in` and `BuyIn`
 * are one key. Deliberately not substring matching: `rebuy in` contains `buy in`,
 * and a fuzzy match that silently files rebuys as the buy-in is worse than no
 * match at all, because the player would never see it happen.
 */

export const IMPORT_FIELDS = [
  'startedAt',
  'endedAt',
  'duration',
  'gameType',
  'stakes',
  'venue',
  'buyIn',
  'cashOut',
  'result',
  'currency',
  'notes',
] as const;

export type ImportField = (typeof IMPORT_FIELDS)[number];

/** What each field is called on screen when the import explains what it matched. */
export const FIELD_LABELS: Record<ImportField, string> = {
  startedAt: 'Start',
  endedAt: 'End',
  duration: 'Duration',
  gameType: 'Game',
  stakes: 'Stakes',
  venue: 'Site',
  buyIn: 'Buy-in',
  cashOut: 'Cash-out',
  result: 'Result',
  currency: 'Currency',
  notes: 'Notes',
};

export const normalizeHeader = (header: string): string =>
  header.toLowerCase().replace(/[^a-z0-9]/g, '');

const ALIASES: Record<ImportField, readonly string[]> = {
  startedAt: [
    'date', 'datetime', 'day', 'when', 'start', 'started', 'startdate', 'starttime',
    'startedat', 'sessionstart', 'sessiondate', 'begin', 'began', 'dateplayed',
    'playedon', 'datetimeplayed', 'localstarttime', 'startdatetime',
  ],
  endedAt: [
    'end', 'ended', 'endat', 'endedat', 'enddate', 'endtime', 'enddatetime',
    'finish', 'finished', 'finishtime', 'sessionend', 'stoptime', 'stopped',
  ],
  duration: [
    'duration', 'length', 'hours', 'hrs', 'hoursplayed', 'minutes', 'mins',
    'sessionlength', 'timeplayed', 'playtime', 'elapsed', 'durationhours',
    'durationminutes', 'durationmins', 'timeatable', 'tabletime',
  ],
  gameType: ['game', 'gametype', 'variant', 'type', 'format', 'gameformat', 'limittype'],
  stakes: ['stakes', 'stake', 'blinds', 'blind', 'limit', 'level', 'tablestakes', 'gamelimit'],
  venue: [
    'site', 'venue', 'room', 'pokersite', 'pokerroom', 'network', 'location',
    'cardroom', 'platform', 'skin', 'client', 'operator',
  ],
  buyIn: [
    'buyin', 'buyins', 'totalbuyin', 'totalbuyins', 'boughtin', 'bought', 'invested',
    'totalinvested', 'amountin', 'in', 'buyinamount', 'totalbuyinamount', 'stakein',
  ],
  cashOut: [
    'cashout', 'cashouts', 'cashedout', 'totalcashout', 'totalcashouts', 'amountout',
    'out', 'finalstack', 'endingstack', 'endstack', 'cashoutamount', 'totalout',
  ],
  result: [
    'result', 'results', 'profit', 'net', 'netprofit', 'netwon', 'netwin', 'won',
    'winnings', 'pl', 'profitloss', 'amountwon', 'netresult', 'netamount',
    'totalprofit', 'win', 'winloss', 'plusminus', 'gain', 'total',
  ],
  currency: ['currency', 'ccy', 'currencycode', 'cur'],
  notes: ['notes', 'note', 'comment', 'comments', 'description', 'remarks', 'memo'],
};

/**
 * Reverse index, built once. Two fields claiming the same alias would be a bug
 * in the table above, so the first one in `IMPORT_FIELDS` order wins and the
 * collision stays invisible rather than becoming order-dependent at runtime.
 */
const FIELD_BY_ALIAS = ((): Map<string, ImportField> => {
  const map = new Map<string, ImportField>();
  for (const field of IMPORT_FIELDS) {
    for (const alias of ALIASES[field]) {
      if (!map.has(alias)) map.set(alias, field);
    }
  }
  return map;
})();

export interface ColumnMap {
  /** Column index for each field the header row supplied. */
  indexes: Partial<Record<ImportField, number>>;
  /** The header text that claimed each field, so the UI can show its work. */
  matched: Partial<Record<ImportField, string>>;
  /** Headers that matched nothing. Ignored, but worth showing. */
  unmapped: string[];
  /** Headers that lost to an earlier column for the same field. */
  duplicates: { header: string; field: ImportField }[];
}

/**
 * Match a header row to fields. The leftmost column wins a contested field,
 * which matches how these files are written: the canonical column comes first
 * and the derived ones (`Profit/100 hands`, `Net USD`) come after.
 */
export const resolveColumns = (header: readonly string[]): ColumnMap => {
  const indexes: Partial<Record<ImportField, number>> = {};
  const matched: Partial<Record<ImportField, string>> = {};
  const unmapped: string[] = [];
  const duplicates: { header: string; field: ImportField }[] = [];

  header.forEach((text, index) => {
    const field = FIELD_BY_ALIAS.get(normalizeHeader(text));
    if (field === undefined) {
      if (text.trim() !== '') unmapped.push(text);
      return;
    }
    if (indexes[field] !== undefined) {
      duplicates.push({ header: text, field });
      return;
    }
    indexes[field] = index;
    matched[field] = text;
  });

  return { indexes, matched, unmapped, duplicates };
};
