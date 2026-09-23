/**
 * The import screen's other half: a file of hand histories rather than a
 * spreadsheet of sessions.
 *
 * Same shape as the session import on purpose. Choose a file, see what it
 * read and where every hand is going, then import. The "where" is the part
 * this half adds. Each sitting in the file shows the session it matched, and
 * the player can send it somewhere else, which is both the answer to "can I
 * put these hands in a session?" and the way out when a file's clock was
 * read wrong.
 */

import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';

import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { ChipGroup, type Option } from '../../components/Chip';
import { SectionHeader } from '../../components/SectionHeader';
import { Text } from '../../components/Text';
import { successFeedback } from '../../components/haptics';
import {
  BIG_POT_BB,
  candidateSessions,
  defaultDestination,
  groupSittings,
  isBigPot,
  parseHandHistory,
  sittingImportKey,
  type Destination,
  type Sitting,
} from '../../domain/import/handHistory';
import { formatMoney, formatStakes } from '../../domain/money';
import { GAME_TYPE_LABELS, type SessionWithChildren } from '../../domain/types';
import { useLogStore, type HandImportSummary } from '../../store/useLogStore';
import { colors, resultColor, spacing } from '../../theme';
import { formatSessionDate, formatSessionSpan, formatTimeOfDay } from '../sessions/format';

/** Destinations as chip values: a session id, or one of two words no id can be. */
type Choice = string;
const NEW: Choice = '+new';
const SKIP: Choice = '+skip';

const toChoice = (destination: Destination): Choice =>
  destination.kind === 'session' ? destination.sessionId : destination.kind === 'new' ? NEW : SKIP;

const fromChoice = (choice: Choice): Destination =>
  choice === NEW ? { kind: 'new' } : choice === SKIP ? { kind: 'skip' } : { kind: 'session', sessionId: choice };

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`;

const chips = (hundredths: number): string => (hundredths / 100).toLocaleString('en-US');

/** `PokerStars · NLHE $0.01/$0.02`, `GGPoker · Tournament #123`, `PokerStars · NLHE 25/50 play money`. */
const describeGame = (sitting: Sitting): string => {
  const first = sitting.hands[0];
  const game = GAME_TYPE_LABELS[first.gameType];
  if (first.format === 'tournament') {
    return `${sitting.site} · Tournament${first.tournamentId === null ? '' : ` #${first.tournamentId}`}`;
  }
  if (first.smallBlind === null || first.bigBlind === null) return `${sitting.site} · ${game}`;
  if (first.currency === null) {
    return `${sitting.site} · ${game} ${chips(first.smallBlind)}/${chips(first.bigBlind)} play money`;
  }
  const stakes = formatStakes(
    { smallBlind: first.smallBlind, bigBlind: first.bigBlind },
    first.currency,
  );
  return `${sitting.site} · ${game} ${stakes}`;
};

const describeSession = (session: SessionWithChildren): string => {
  const venue = session.venue?.name ?? 'Unknown venue';
  if (session.endedAt === null) return `Running now · ${venue}`;
  return `${formatSessionDate(session.startedAt)} ${formatTimeOfDay(session.startedAt)} · ${venue}`;
};

interface Props {
  /** The file. The screen keys this component on it, so a new file starts over. */
  text: string;
}

export const HandHistoryPreview = ({ text }: Props) => {
  const sessions = useLogStore((state) => state.sessions);
  const importHands = useLogStore((state) => state.importHands);

  const reading = useMemo(() => parseHandHistory(text), [text]);
  const sittings = useMemo(() => groupSittings(reading.hands), [reading]);

  // Read once: "now" is what decides whether a running session covers the
  // last hand, and it should not move under the player's choices. The screen
  // mounts this afresh for each file.
  const [now] = useState(() => Date.now());

  const [every, setEvery] = useState(false);
  const [chosen, setChosen] = useState<Record<string, Choice>>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [summary, setSummary] = useState<HandImportSummary | null>(null);

  const destinations = useMemo(() => {
    const map = new Map<string, Destination>();
    for (const sitting of sittings) {
      const picked = chosen[sitting.key];
      map.set(
        sitting.key,
        picked === undefined ? defaultDestination(sitting, sessions, now) : fromChoice(picked),
      );
    }
    return map;
  }, [sittings, sessions, chosen, now]);

  const bigPots = reading.hands.filter(isBigPot).length;
  // A new session is made from every hand in its sitting even when none of
  // them is a big pot, so the button has something to do with no hands to write.
  const making = [...destinations.values()].filter((destination) => destination.kind === 'new').length;
  const going = sittings.reduce((sum, sitting) => {
    if (destinations.get(sitting.key)?.kind === 'skip') return sum;
    return sum + (every ? sitting.hands.length : sitting.hands.filter(isBigPot).length);
  }, 0);

  const runImport = async () => {
    setBusy(true);
    setFailure(null);
    try {
      const result = await importHands(sittings, destinations, every);
      setSummary(result);
      if (result.imported > 0 || result.sessionsCreated > 0) successFeedback();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'The import could not be written.');
    } finally {
      setBusy(false);
    }
  };

  if (summary !== null) {
    return (
      <>
        <SectionHeader title="Done" />
        <Card>
          <Text variant="bodyStrong" style={styles.line}>
            {summary.imported === 0 && summary.sessionsCreated === 0
              ? 'Nothing new to add.'
              : `Imported ${plural(summary.imported, 'hand')}.`}
          </Text>
          {summary.sessionsCreated > 0 ? (
            <Text variant="caption" color={colors.textSecondary} style={styles.line}>
              Made {plural(summary.sessionsCreated, 'new session')} for hands that had none to go
              into.
            </Text>
          ) : null}
          {summary.duplicates > 0 ? (
            <Text variant="caption" color={colors.textSecondary} style={styles.line}>
              {plural(summary.duplicates, 'hand')} {summary.duplicates === 1 ? 'was' : 'were'}{' '}
              already in your log and {summary.duplicates === 1 ? 'was' : 'were'} skipped.
            </Text>
          ) : null}
        </Card>
      </>
    );
  }

  if (reading.hands.length === 0) {
    return (
      <>
        <SectionHeader title="Can’t read that" />
        <Card>
          <Text color={colors.loss} style={styles.line}>
            That looks like a hand history, but none of the hands in it are ones you were dealt
            into.
          </Text>
          {reading.warnings.slice(0, 5).map((warning, index) => (
            <Text key={index} variant="caption" color={colors.textSecondary}>
              {warning.handId === null ? '' : `#${warning.handId}: `}
              {warning.message}
            </Text>
          ))}
        </Card>
      </>
    );
  }

  const bigPotLabel = `Big pots (${bigPots})`;
  const everyLabel = `Every hand (${reading.hands.length})`;

  return (
    <>
      <SectionHeader title="What it reads" />
      <Card>
        <Text variant="heading">{plural(reading.hands.length, 'hand')}</Text>
        <Text variant="caption" color={colors.textTertiary} style={styles.line}>
          {reading.sites.join(', ')} · {plural(sittings.length, 'sitting')}
        </Text>
        <ChipGroup
          options={[
            { value: false, label: bigPotLabel },
            { value: true, label: everyLabel },
          ]}
          value={every}
          onChange={setEvery}
        />
        <Text variant="caption" color={colors.textTertiary} style={styles.spec}>
          Your hands are a journal of the ones worth remembering, so a big pot is one that won or
          lost at least {BIG_POT_BB} big blinds. Every hand brings in the whole file.
        </Text>
        {reading.warnings.length > 0 ? (
          <View style={styles.warnings}>
            {reading.warnings.slice(0, 5).map((warning, index) => (
              <Text key={index} variant="caption" color={colors.textSecondary}>
                {warning.handId === null ? '' : `#${warning.handId}: `}
                {warning.message}
              </Text>
            ))}
          </View>
        ) : null}
      </Card>

      <SectionHeader title="Where they go" />
      {sittings.map((sitting) => {
        const destination = destinations.get(sitting.key) as Destination;
        const count = every ? sitting.hands.length : sitting.hands.filter(isBigPot).length;
        const net = sitting.hands.reduce((sum, hand) => sum + hand.net, 0);
        const currency = sitting.hands[0].currency;

        const offered = candidateSessions(sitting, sessions);
        if (
          destination.kind === 'session' &&
          !offered.some((session) => session.id === destination.sessionId)
        ) {
          const matched = sessions.find((session) => session.id === destination.sessionId);
          if (matched) offered.unshift(matched);
        }
        const hasOwn = sessions.some((session) => session.importKey === sittingImportKey(sitting));
        const options: Option<Choice>[] = [
          ...offered.map((session) => ({ value: session.id, label: describeSession(session) })),
          ...(sitting.money && !hasOwn ? [{ value: NEW, label: 'New session' }] : []),
          { value: SKIP, label: 'Leave out' },
        ];

        return (
          <Card key={sitting.key} style={styles.sitting}>
            <View style={styles.headline}>
              <Text variant="bodyStrong" style={styles.title}>
                {describeGame(sitting)}
              </Text>
              {currency !== null ? (
                <Text variant="bodyStrong" color={resultColor(net)}>
                  {formatMoney(net, { currency, signed: true })}
                </Text>
              ) : null}
            </View>
            <Text variant="caption" color={colors.textTertiary} style={styles.line}>
              {formatSessionSpan(sitting.startedAt, sitting.endedAt)} ·{' '}
              {plural(sitting.tables, 'table')} · {plural(sitting.hands.length, 'hand')}
              {every ? '' : `, ${count} big`}
            </Text>
            {!sitting.zoned ? (
              <Text variant="caption" color={colors.accent} style={styles.line}>
                The file does not say what time zone these are in, so they are read as this
                device’s. Check the session below is the right one.
              </Text>
            ) : null}
            {destination.kind === 'skip' && !sitting.money ? (
              <Text variant="caption" color={colors.textSecondary} style={styles.line}>
                No session was running then, and these hands were played for chips, so there is
                no result to make one from. Pick a session, or add it first.
              </Text>
            ) : null}
            <ChipGroup
              options={options}
              value={toChoice(destination)}
              onChange={(choice) => setChosen((current) => ({ ...current, [sitting.key]: choice }))}
            />
          </Card>
        );
      })}

      <Button
        label={
          going > 0
            ? `Import ${plural(going, 'hand')}`
            : making > 0
              ? `Add ${plural(making, 'session')}`
              : 'Nothing to import'
        }
        onPress={() => void runImport()}
        loading={busy}
        disabled={going === 0 && making === 0}
        style={styles.action}
      />

      {failure !== null ? (
        <Card style={styles.action}>
          <Text color={colors.loss}>{failure}</Text>
        </Card>
      ) : null}
    </>
  );
};

const styles = StyleSheet.create({
  line: {
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
    lineHeight: 18,
  },
  spec: {
    marginTop: spacing.sm,
    lineHeight: 18,
  },
  warnings: {
    marginTop: spacing.md,
    gap: spacing.xs,
  },
  headline: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  title: {
    flex: 1,
  },
  sitting: {
    marginBottom: spacing.md,
  },
  action: {
    marginTop: spacing.xl,
  },
});
