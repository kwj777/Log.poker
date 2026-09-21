/**
 * The live session.
 *
 * This is the screen that is open on a phone face-down next to a stack of chips,
 * so it is built around three things a player does mid-session -- rebuy, log a
 * hand, cash out -- each one tap from the top of the screen. Everything else is
 * information, not interaction.
 */

import { useMemo, useState } from 'react';
import { StyleSheet, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { AmountInput } from '../../src/components/AmountInput';
import { Button } from '../../src/components/Button';
import { ErrorNote, describeFailure } from '../../src/components/ErrorNote';
import { Card } from '../../src/components/Card';
import { MoodPicker } from '../../src/components/MoodPicker';
import { Screen } from '../../src/components/Screen';
import { SectionHeader } from '../../src/components/SectionHeader';
import { Sheet } from '../../src/components/Sheet';
import { StatTile } from '../../src/components/StatTile';
import { Text } from '../../src/components/Text';
import { successFeedback, warningFeedback } from '../../src/components/haptics';
import { formatEntry, formatMoney, formatStakes, parseAmount } from '../../src/domain/money';
import { formatSessionDate, formatTimeOfDay } from '../../src/features/sessions/format';
import { parseCount } from '../../src/domain/import/values';
import { formatDuration, rebuyTotal, totalInvested } from '../../src/domain/stats';
import { fromHoursAndMinutes, isAhead } from '../../src/domain/clock';
import { GAME_TYPE_LABELS } from '../../src/domain/types';
import type { MoodScore } from '../../src/domain/types';
import { HandRow } from '../../src/features/sessions/HandRow';
import { MidSessionCheckIn } from '../../src/features/sessions/MidSessionCheckIn';
import { DurationInput } from '../../src/features/sessions/WhenInput';
import { useElapsed } from '../../src/features/sessions/LiveTimer';
import { useHandsForSession, useLogStore } from '../../src/store/useLogStore';
import { colors, radius, resultColor, spacing, typography } from '../../src/theme';
import { PageMeta } from '../../src/components/PageMeta';

/**
 * How long a session has to have run before the app stops believing the clock.
 *
 * Twelve hours is past a long live session and well short of a phone that went
 * in a pocket. The point is not to catch every forgotten cash-out -- it is to
 * stop the app writing an elapsed time it has no reason to trust, silently,
 * into a rate that divides by hours played.
 */
export const IMPLAUSIBLE_SESSION_MS = 12 * 60 * 60 * 1000;

export default function ActiveSessionScreen() {
  const session = useLogStore((state) => state.activeSession);
  const hands = useHandsForSession(session?.id ?? null);
  const addRebuy = useLogStore((state) => state.addRebuy);
  const removeRebuy = useLogStore((state) => state.removeRebuy);
  const endSession = useLogStore((state) => state.endSession);

  const [rebuyOpen, setRebuyOpen] = useState(false);
  const [rebuyAmount, setRebuyAmount] = useState('');
  const [cashOutOpen, setCashOutOpen] = useState(false);
  const [cashOutAmount, setCashOutAmount] = useState('');
  const [endMood, setEndMood] = useState<MoodScore | null>(null);
  const [finishPosition, setFinishPosition] = useState('');
  const [entrants, setEntrants] = useState('');
  const [failed, setFailed] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Which rebuy is a tap away from being removed, if any. */
  const [confirmingRebuy, setConfirmingRebuy] = useState<string | null>(null);
  /**
   * How long the player says they actually played, when the clock is not
   * worth believing. Empty means "the clock is right", which is the ordinary
   * case and the one that must stay one tap.
   */
  const [playedHours, setPlayedHours] = useState('');
  const [playedMinutes, setPlayedMinutes] = useState('');

  const elapsed = useElapsed(session?.startedAt ?? null);
  const invested = useMemo(
    () => (session ? totalInvested(session, session.rebuys) : 0),
    [session],
  );

  if (!session) {
    // Reachable if the session was ended in another tab or window; send the
    // player somewhere real rather than rendering an empty shell.
    return (
      <Screen>
        <PageMeta title="Live session · Log" />
        <View style={styles.empty}>
          <Text variant="heading" center>
            No session running
          </Text>
          {/* The cash-out's own failure is drawn here as well as below,
              because this is where it now lands. `endSession` re-reads the log
              whether or not its later writes threw, so a night whose result
              landed and whose mood did not takes this branch before the catch
              has finished speaking, and a message set into the other branch is
              a message nothing draws. */}
          <ErrorNote message={failed} />
          <Button
            label="Back to dashboard"
            style={styles.emptyAction}
            onPress={() => router.replace('/')}
          />
        </View>
      </Screen>
    );
  }

  const { currency } = session;
  const tournament = session.format === 'tournament';
  /** What one entry costs, which is what a re-entry costs again. */
  const entryCost = session.buyIn + (session.fee ?? 0);
  // A tournament is re-entered, not rebought. The word on the button is the
  // whole difference between the two screens, so it is worth getting right.
  const rebuyWord = tournament ? 'Re-entry' : 'Rebuy';
  const cashOutCents = parseAmount(cashOutAmount);
  const projected = cashOutCents === null ? null : cashOutCents - invested;

  /**
   * A session the clock can no longer be trusted about.
   *
   * The commonest mistake in live logging is not cashing out: you rack up, you
   * drive home, you go to bed, and you remember the next morning. Until now
   * the app wrote whatever the clock said -- eleven hours -- and that number
   * divides straight into the hourly rate and into `estimatePlayer`, which
   * models a win rate per hour of play. One forgotten session moves the
   * variance verdict this app exists to give.
   */
  const implausible = elapsed >= IMPLAUSIBLE_SESSION_MS;
  const played = fromHoursAndMinutes(playedHours, playedMinutes);
  // Empty leaves the clock alone, which keeps the ordinary cash-out one tap.
  const correctingLength = playedHours.trim() !== '' || playedMinutes.trim() !== '';
  const lengthInvalid = correctingLength && played === null;
  const correctedEnd = played === null ? null : session.startedAt + played;
  /**
   * A length that finishes the session after now, which is the typo this field
   * exists to catch a different half of.
   *
   * 40 in the hours box for 4 is the mistake, and it was only caught when it
   * made the text unreadable. Written through, it goes into the hourly rate at
   * a tenth of the truth and sits at the end of the variance window as the
   * most recently ended session. The edit screen has refused exactly this
   * since it grew the same control, with the same hint; `isAhead` is in
   * `domain/clock` for it.
   */
  const endAhead = correctedEnd !== null && isAhead(correctedEnd);

  const commitRebuy = async () => {
    const amount = parseAmount(rebuyAmount);
    if (amount === null || amount <= 0 || busy) return;
    setBusy(true);
    setFailed(null);
    try {
      await addRebuy(session.id, amount);
      successFeedback();
      setRebuyOpen(false);
      setRebuyAmount('');
    } catch (error) {
      // There was no catch here at all, so a throw was an unhandled rejection:
      // the sheet stayed open, the spinner stopped, and nothing said the money
      // had not gone in.
      setFailed(describeFailure(error, `That ${rebuyWord.toLowerCase()} could not be saved.`));
    } finally {
      setBusy(false);
    }
  };

  /**
   * Take a rebuy back out.
   *
   * A rebuy is typed into a sheet at a table with a hand going on, and a
   * misplaced decimal is the easiest mistake on this screen to make: the
   * amount is pre-filled with the buy-in, so a tap too many puts real money
   * into the log that never left anybody's pocket. It is part of
   * `totalInvested`, so until now that mistake moved the session's result and
   * the only way out of it was deleting the session.
   */
  const dropRebuy = async (rebuyId: string) => {
    if (busy) return;
    setBusy(true);
    setFailed(null);
    try {
      await removeRebuy(rebuyId);
      setConfirmingRebuy(null);
    } catch (error) {
      setFailed(describeFailure(error, `That ${rebuyWord.toLowerCase()} could not be removed.`));
    } finally {
      setBusy(false);
    }
  };

  const commitCashOut = async () => {
    if (cashOutCents === null || cashOutCents < 0 || busy || lengthInvalid || endAhead) return;
    setBusy(true);
    setFailed(null);
    try {
      await endSession(session.id, cashOutCents, endMood, {
        finishPosition: parseCount(finishPosition),
        entrants: parseCount(entrants),
        // Left out unless the player said otherwise, so the ordinary cash-out
        // is stamped now exactly as it always was.
        ...(correctedEnd === null ? {} : { endedAt: correctedEnd }),
      });
      warningFeedback();
      setCashOutOpen(false);
      // `ended` is what tells the detail screen this is the session that just
      // finished rather than one opened from History, which is the whole of
      // when `PostSessionReset` is allowed to appear. Nothing else sets it.
      router.replace(`/session/${session.id}?ended=1`);
    } catch (error) {
      // The worst one to lose silently: this is the moment the result is
      // written, and the sheet closing is the only thing that ever said so.
      //
      // Two different failures arrive here, and they want different words.
      // `endSession` writes the cash-out first and the tournament result and
      // the end mood after it, and re-reads the log either way, so by the time
      // this line runs the store already knows which happened. A session that
      // is gone from it is one that closed: what failed was a field and a
      // finish, which Edit can still fix, and telling the player their night
      // could not be closed out would send them back for something they
      // already have.
      //
      // **Said in front of the detail rather than behind it.** Both sentences
      // used to be handed to `describeFailure` as its *fallback*, and that
      // returns `error.message` whenever the thrown value is an `Error`
      // carrying one. Everything that realistically throws here does: a Dexie
      // or SQLite quota or constraint error, and the repository's own
      // `NotFoundError` and `ConstraintError`, which build their message in
      // the constructor. So the branch resolved to the chosen words only for
      // an `Error` whose message is literally empty, which nothing in this
      // codebase constructs, and the reasoning above it had never once
      // reached a screen.
      //
      // The detail still goes on the line, after. "The database is full" is
      // the difference between trying again and going and clearing space.
      const closed = useLogStore.getState().activeSession === null;
      const said = closed
        ? 'The session was closed, but not everything was saved. You can fix it in Edit.'
        : 'That session could not be closed out.';
      const detail = describeFailure(error, '');
      setFailed(detail === '' ? said : `${said} (${detail})`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Screen
        footer={
          <Button
            label="Cash out & end session"
            onPress={() => {
              // One `failed` string drives the note in three places: the
              // rebuys card, the rebuy sheet and this one. Nothing cleared it
              // when a sheet opened, only when an action was attempted, so a
              // rebuy that would not save presented itself again inside the
              // cash-out sheet as though the cash-out had failed, before it
              // had been tried.
              setFailed(null);
              setCashOutAmount('');
              setEndMood(null);
              // Left empty, always. Empty means "the clock is right", which
              // keeps the ordinary cash-out exactly what it was: one number
              // and a tap, stamped now.
              setPlayedHours('');
              setPlayedMinutes('');
              setCashOutOpen(true);
            }}
            accessibilityHint="Records your final stack and closes the session"
          />
        }
      >
        <PageMeta title="Live session · Log" />
        <View style={styles.header}>
          <View style={styles.liveRow}>
            <View style={styles.liveDot} />
            <Text variant="overline" color={colors.accent}>
              Live
            </Text>
          </View>
          <Text variant="display">{formatDuration(elapsed)}</Text>
          <Text color={colors.textSecondary}>
            {session.venue?.name ?? 'Unknown venue'} ·{' '}
            {tournament
              ? formatEntry(session.buyIn, session.fee, currency)
              : session.stakes === null
                ? GAME_TYPE_LABELS[session.gameType]
                : `${formatStakes(session.stakes, currency)} · ${GAME_TYPE_LABELS[session.gameType]}`}
          </Text>
        </View>

        <View style={styles.tiles}>
          <StatTile label="On the table" value={formatMoney(invested, { currency })} />
          <StatTile
            label={tournament ? 'Re-entries' : 'Rebuys'}
            value={String(session.rebuys.length)}
            hint={
              session.rebuys.length > 0
                ? // The rebuys themselves. `invested` is buy-in *plus the entry
                  // fee* plus rebuys, so subtracting the buy-in alone put a
                  // tournament's fee under a label that says "Re-entries".
                  formatMoney(rebuyTotal(session.rebuys), { currency })
                : 'None yet'
            }
          />
          {/* `--` while the read is out, which is what every other unknown
              number in the app shows. */}
          <StatTile
            label="Hands"
            value={hands === null ? '--' : String(hands.length)}
            hint="logged"
          />
        </View>

        <View style={styles.actions}>
          <Button
            label={tournament ? 'Re-enter' : 'Rebuy'}
            variant="secondary"
            size="medium"
            style={styles.action}
            leading={<Ionicons name="add-circle-outline" size={18} color={colors.text} />}
            onPress={() => {
              setFailed(null);
              // A re-entry costs what the tournament advertises, which is the
              // buy-in and the fee: `totalInvested` counts both, and the
              // Variance tab gives the fee a tile of its own. Seeded with the
              // buy-in alone this opened on a number no tournament sells, and
              // short by exactly the part that is never coming back.
              setRebuyAmount(String(entryCost / 100));
              setRebuyOpen(true);
            }}
          />
          <Button
            label="Log hand"
            variant="secondary"
            size="medium"
            style={styles.action}
            leading={<Ionicons name="documents-outline" size={18} color={colors.text} />}
            onPress={() => router.push('/session/hand')}
          />
        </View>

        {/*
          Said on the screen rather than only inside the cash-out sheet,
          because somebody who left a session running will often open the app,
          see a number that is wrong, and not know the app can be told. It is
          a line of text and no buttons: the correction belongs at cash-out,
          where the player is already saying how the session went.
        */}
        {implausible ? (
          <Card style={styles.longRunning}>
            <Text variant="bodyStrong">Still playing?</Text>
            <Text color={colors.textSecondary} style={styles.longRunningBody}>
              This has been running since {formatSessionDate(session.startedAt)} at{' '}
              {formatTimeOfDay(session.startedAt)}. If you finished earlier, cash out and say
              how long you actually played, so your hourly rate is not measured against the
              clock.
            </Text>
          </Card>
        ) : null}

        <MidSessionCheckIn session={session} elapsedMs={elapsed} />

        <SectionHeader
          title={hands === null ? 'Hands this session' : `Hands this session (${hands.length})`}
        />
        {hands === null ? null : hands.length === 0 ? (
          <Card>
            <Text color={colors.textSecondary}>
              Nothing logged yet. Tap <Text variant="bodyStrong">Log hand</Text> when something
              is worth remembering. It takes about ten seconds.
            </Text>
          </Card>
        ) : (
          <View>
            {hands.map((hand) => (
              <HandRow
                key={hand.id}
                hand={hand}
                currency={currency}
                onPress={() => router.push(`/session/hand?id=${hand.id}`)}
              />
            ))}
          </View>
        )}

        {session.rebuys.length > 0 ? (
          <>
            <SectionHeader title={tournament ? 'Re-entries' : 'Rebuys'} />
            <Card>
              {session.rebuys.map((rebuy, index) => (
                <View key={rebuy.id} style={styles.rebuyRow}>
                  <Text color={colors.textSecondary} style={styles.rebuyLabel}>
                    {tournament ? 'Re-entry' : 'Rebuy'} {index + 1} ·{' '}
                    {formatDuration(rebuy.at - session.startedAt)} in
                  </Text>
                  {confirmingRebuy === rebuy.id ? (
                    <View style={styles.rebuyActions}>
                      <Button
                        label="Keep"
                        variant="secondary"
                        size="small"
                        onPress={() => setConfirmingRebuy(null)}
                      />
                      <Button
                        label="Remove"
                        variant="danger"
                        size="small"
                        loading={busy}
                        onPress={() => void dropRebuy(rebuy.id)}
                      />
                    </View>
                  ) : (
                    <View style={styles.rebuyActions}>
                      <Text variant="bodyStrong">{formatMoney(rebuy.amount, { currency })}</Text>
                      <Button
                        label="Remove"
                        accessibilityLabel={`Remove ${
                          tournament ? 're-entry' : 'rebuy'
                        } ${index + 1}, ${formatMoney(rebuy.amount, { currency })}`}
                        variant="ghost"
                        size="small"
                        onPress={() => setConfirmingRebuy(rebuy.id)}
                      />
                    </View>
                  )}
                </View>
              ))}
              <ErrorNote message={confirmingRebuy === null ? null : failed} />
            </Card>
          </>
        ) : null}
      </Screen>

      <Sheet
        visible={rebuyOpen}
        onClose={() => setRebuyOpen(false)}
        title={tournament ? 'Add a re-entry' : 'Add a rebuy'}
      >
        <AmountInput
          value={rebuyAmount}
          onChangeText={setRebuyAmount}
          currency={currency}
          presets={
            // A tournament re-entry is the advertised entry or two of them.
            // Half a buy-in is a cash-game top-up and not a thing a
            // tournament sells, and the entry is the buy-in plus the fee.
            tournament
              ? [entryCost, entryCost * 2].map(Math.round)
              : [session.buyIn / 2, session.buyIn, session.buyIn * 2].map(Math.round)
          }
          autoFocus
          accessibilityLabel={`${rebuyWord} amount`}
        />
        <Button
          label={tournament ? 'Add re-entry' : 'Add rebuy'}
          onPress={() => void commitRebuy()}
          style={styles.sheetAction}
          disabled={(parseAmount(rebuyAmount) ?? 0) <= 0}
          loading={busy}
        />
        <ErrorNote message={failed} />
      </Sheet>

      <Sheet
        visible={cashOutOpen}
        onClose={() => setCashOutOpen(false)}
        title={tournament ? 'Finish up' : 'Cash out'}
      >
        <Text color={colors.textSecondary} style={styles.sheetHint}>
          {tournament
            ? `Enter what you won, or leave it at zero. The entry cost ${formatMoney(invested, {
                currency,
              })} over ${formatDuration(elapsed)}.`
            : `Count your chips. You put ${formatMoney(invested, {
                currency,
              })} on the table over ${formatDuration(elapsed)}.`}
        </Text>
        <AmountInput
          value={cashOutAmount}
          onChangeText={setCashOutAmount}
          currency={currency}
          placeholder="0"
          autoFocus
          accessibilityLabel={tournament ? 'Prize won' : 'Cash-out amount'}
        />

        {tournament ? (
          <>
            <Text variant="overline" color={colors.textTertiary} style={styles.sheetLabel}>
              Where did you finish? (optional)
            </Text>
            <View style={styles.finishRow}>
              <TextInput
                value={finishPosition}
                onChangeText={setFinishPosition}
                placeholder="Place"
                placeholderTextColor={colors.textTertiary}
                inputMode="numeric"
                accessibilityLabel="Finishing position"
                style={styles.finishInput}
              />
              <Text color={colors.textTertiary}>of</Text>
              <TextInput
                value={entrants}
                onChangeText={setEntrants}
                placeholder="Entrants"
                placeholderTextColor={colors.textTertiary}
                inputMode="numeric"
                accessibilityLabel="Number of entrants"
                style={styles.finishInput}
              />
            </View>
          </>
        ) : null}

        {projected !== null ? (
          <Text variant="heading" color={resultColor(projected)} style={styles.projection}>
            {formatMoney(projected, { currency, signed: true })} for the session
          </Text>
        ) : null}

        {implausible ? (
          <>
            <Text variant="overline" color={colors.textTertiary} style={styles.sheetLabel}>
              How long did you actually play?
            </Text>
            <DurationInput
              hours={playedHours}
              minutes={playedMinutes}
              onChangeHours={setPlayedHours}
              onChangeMinutes={setPlayedMinutes}
              invalid={lengthInvalid || endAhead}
              hint={
                lengthInvalid
                  ? 'Hours and minutes, or leave both empty to use the clock.'
                  : endAhead
                    ? 'That length runs past now. Check the hours.'
                    : correctedEnd === null
                      ? `Leave it empty and the clock stands: ${formatDuration(elapsed)}.`
                      : `Finishing ${formatSessionDate(correctedEnd)} at ${formatTimeOfDay(
                          correctedEnd,
                        )}.`
              }
            />
          </>
        ) : null}

        <Text variant="overline" color={colors.textTertiary} style={styles.sheetLabel}>
          How are you leaving? (optional)
        </Text>
        <MoodPicker value={endMood} onChange={setEndMood} compact />

        <Button
          label={tournament ? 'End tournament' : 'End session'}
          onPress={() => void commitCashOut()}
          style={styles.sheetAction}
          disabled={cashOutCents === null || cashOutCents < 0 || lengthInvalid || endAhead}
          loading={busy}
        />
        <ErrorNote message={failed} />
      </Sheet>
    </>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingTop: spacing.xl,
    gap: spacing.xs,
  },
  liveRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  liveDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.accent,
  },
  finishRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  finishInput: {
    ...typography.body,
    flex: 1,
    color: colors.text,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  tiles: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.xl,
  },
  actions: {
    flexDirection: 'row',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  action: {
    flex: 1,
  },
  rebuyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  longRunning: {
    marginTop: spacing.lg,
    borderColor: colors.accentDim,
  },
  longRunningBody: {
    marginTop: spacing.xs,
    lineHeight: 22,
  },
  rebuyLabel: {
    flexShrink: 1,
  },
  rebuyActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  sheetHint: {
    marginBottom: spacing.md,
    lineHeight: 22,
  },
  sheetLabel: {
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  sheetAction: {
    marginTop: spacing.xl,
  },
  projection: {
    marginTop: spacing.md,
  },
  empty: {
    paddingTop: spacing.xxxl,
    gap: spacing.xl,
  },
  emptyAction: {
    alignSelf: 'stretch',
  },
});
