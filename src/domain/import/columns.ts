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
  'format',
  'gameType',
  'stakes',
  'venue',
  'buyIn',
  'fee',
  'cashOut',
  'result',
  'entrants',
  'finishPosition',
  'currency',
  'notes',
] as const;

export type ImportField = (typeof IMPORT_FIELDS)[number];

/** What each field is called on screen when the import explains what it matched. */
export const FIELD_LABELS: Record<ImportField, string> = {
  startedAt: 'Start',
  endedAt: 'End',
  duration: 'Duration',
  format: 'Cash / tournament',
  gameType: 'Game',
  stakes: 'Stakes',
  venue: 'Site',
  buyIn: 'Buy-in',
  fee: 'Entry fee',
  cashOut: 'Cash-out',
  result: 'Result',
  entrants: 'Entrants',
  finishPosition: 'Finish',
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
  // Not a bare `finish`. A tournament export's "Finish" column is the place
  // somebody came, and `finishPosition` claims the same word below: first-wins
  // handed it to this field, so the position was read as an end time, parsed to
  // nothing, and dropped without landing in `unmapped` or `duplicates` -- the
  // preview showed "Finish -> End", which reads as plausible. The compound
  // spellings stay, because none of them names a placing.
  endedAt: [
    'end', 'ended', 'endat', 'endedat', 'enddate', 'endtime', 'enddatetime',
    'finished', 'finishtime', 'finishedat', 'sessionend', 'stoptime', 'stopped',
  ],
  duration: [
    'duration', 'length', 'hours', 'hrs', 'hoursplayed', 'minutes', 'mins',
    'sessionlength', 'timeplayed', 'playtime', 'elapsed', 'durationhours',
    'durationminutes', 'durationmins', 'timeatable', 'tabletime',
  ],
  // `format` and `gameformat` belong to the cash/tournament discriminator rather
  // than to the variant: in these exports "Format" is overwhelmingly Cash or
  // Tournament, while the variant column is called Game or Type. A wrong guess
  // here is visible -- the preview shows what matched what before anything is
  // written -- which is why it is worth taking the likelier reading.
  format: [
    'format', 'gameformat', 'sessiontype', 'sessionformat', 'tabletype',
    'cashortournament', 'cashtournament', 'playtype',
  ],
  gameType: ['game', 'gametype', 'variant', 'type', 'limittype'],
  stakes: ['stakes', 'stake', 'blinds', 'blind', 'limit', 'level', 'tablestakes', 'gamelimit'],
  venue: [
    'site', 'venue', 'room', 'pokersite', 'pokerroom', 'network', 'location',
    'cardroom', 'platform', 'skin', 'client', 'operator',
  ],
  buyIn: [
    'buyin', 'buyins', 'totalbuyin', 'totalbuyins', 'boughtin', 'bought', 'invested',
    'totalinvested', 'amountin', 'in', 'buyinamount', 'totalbuyinamount', 'stakein',
  ],
  fee: ['fee', 'fees', 'rake', 'entryfee', 'buyinfee', 'tournamentfee', 'totalrake', 'juice'],
  cashOut: [
    'cashout', 'cashouts', 'cashedout', 'totalcashout', 'totalcashouts', 'amountout',
    'out', 'finalstack', 'endingstack', 'endstack', 'cashoutamount', 'totalout',
    'prize', 'prizes', 'prizewon', 'winnings2', 'payout', 'totalpayout',
  ],
  entrants: [
    'entrants', 'players', 'fieldsize', 'field', 'runners', 'totalentrants',
    'numberofentrants', 'playersentered', 'totalplayers',
  ],
  finishPosition: [
    'finish', 'finishposition', 'finishingposition', 'place', 'placed', 'position',
    'rank', 'finishedin', 'placefinished',
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
 * Reverse index, built once. Two fields claiming the same alias is a bug in the
 * table above, so the first one in `IMPORT_FIELDS` order wins and nothing is
 * order-dependent at runtime.
 *
 * That was the whole of the guarantee, and it was not one: first-wins makes a
 * collision *stable*, not visible. `finish` was claimed by both `endedAt` and
 * `finishPosition` for as long as the table has existed, and the losing field
 * simply never matched -- silently, because a stolen header is neither
 * `unmapped` nor a `duplicate`. So the collisions are collected here and
 * asserted empty by the suite, which is the only thing that would have caught
 * it.
 */
const collisions: { alias: string; kept: ImportField; shadowed: ImportField }[] = [];

const FIELD_BY_ALIAS = ((): Map<string, ImportField> => {
  const map = new Map<string, ImportField>();
  for (const field of IMPORT_FIELDS) {
    for (const alias of ALIASES[field]) {
      const kept = map.get(alias);
      if (kept !== undefined) collisions.push({ alias, kept, shadowed: field });
      else map.set(alias, field);
    }
  }
  return map;
})();

/** Aliases two fields both claim. Empty, and `columns.test.ts` keeps it so. */
export const ALIAS_COLLISIONS: readonly { alias: string; kept: ImportField; shadowed: ImportField }[] =
  collisions;

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
