import { planImport, venueNameKey } from '../plan';
import { parseSessionCsv } from '../sessionImport';

const read = (csv: string) => parseSessionCsv(csv).sessions;

describe('venueNameKey', () => {
  it('folds case and whitespace so one room stays one room', () => {
    expect(venueNameKey('  PokerStars ')).toBe(venueNameKey('pokerstars'));
  });
});

describe('planImport', () => {
  const csv = [
    'Date,Site,Result',
    '2024-01-15,PokerStars,120',
    '2024-01-16,GGPoker,-40',
    '2024-01-17,PokerStars,60',
  ].join('\n');

  it('writes everything when nothing has been imported before', () => {
    const plan = planImport(read(csv), new Set(), []);
    expect(plan.writes).toHaveLength(3);
    expect(plan.duplicates).toBe(0);
  });

  it('skips rows whose keys are already stored', () => {
    const sessions = read(csv);
    const plan = planImport(sessions, new Set([sessions[0].importKey]), []);
    expect(plan.writes).toHaveLength(2);
    expect(plan.duplicates).toBe(1);
    expect(plan.writes[0].importKey).toBe(sessions[1].importKey);
  });

  it('skips the whole file on a second run', () => {
    const sessions = read(csv);
    const plan = planImport(sessions, new Set(sessions.map((s) => s.importKey)), []);
    expect(plan.writes).toEqual([]);
    expect(plan.duplicates).toBe(3);
    expect(plan.venuesToCreate).toEqual([]);
  });

  it('names each new venue once, in the order the file used', () => {
    const plan = planImport(read(csv), new Set(), []);
    expect(plan.venuesToCreate).toEqual(['PokerStars', 'GGPoker']);
  });

  it('reuses a venue that already exists, whatever its casing', () => {
    const plan = planImport(read(csv), new Set(), ['  pokerstars  ']);
    expect(plan.venuesToCreate).toEqual(['GGPoker']);
  });

  it('does not create a venue for a row it is skipping', () => {
    const sessions = read(csv);
    const ggpoker = sessions.find((session) => session.venueName === 'GGPoker');
    const plan = planImport(sessions, new Set([ggpoker!.importKey]), []);
    expect(plan.venuesToCreate).toEqual(['PokerStars']);
  });

  it('keeps file order in the rows it writes', () => {
    const plan = planImport(read(csv), new Set(), []);
    expect(plan.writes.map((session) => session.line)).toEqual([2, 3, 4]);
  });
});
