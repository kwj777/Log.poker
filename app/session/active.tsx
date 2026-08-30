/**
 * The live session.
 *
 * This is the screen that is open on a phone face-down next to a stack of chips,
 * so it is built around three things a player does mid-session — rebuy, log a
 * hand, cash out — each one tap from the top of the screen. Everything else is
 * information, not interaction.
 */

import { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';

import { AmountInput } from '../../src/components/AmountInput';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { MoodPicker } from '../../src/components/MoodPicker';
import { Screen } from '../../src/components/Screen';
import { SectionHeader } from '../../src/components/SectionHeader';
import { Sheet } from '../../src/components/Sheet';
import { StatTile } from '../../src/components/StatTile';
import { Text } from '../../src/components/Text';
import { successFeedback, warningFeedback } from '../../src/components/haptics';
import { formatMoney, formatStakes, parseAmount } from '../../src/domain/money';
import { formatDuration, totalInvested } from '../../src/domain/stats';
import type { MoodScore } from '../../src/domain/types';
import { HandRow } from '../../src/features/sessions/HandRow';
import { MidSessionCheckIn } from '../../src/features/sessions/MidSessionCheckIn';
import { useElapsed } from '../../src/features/sessions/LiveTimer';
import { useHandsForSession, useLogStore } from '../../src/store/useLogStore';
import { colors, resultColor, spacing } from '../../src/theme';
import { PageMeta } from '../../src/components/PageMeta';

export default function ActiveSessionScreen() {
  const session = useLogStore((state) => state.activeSession);
  const hands = useHandsForSession(session?.id ?? null);
  const addRebuy = useLogStore((state) => state.addRebuy);
  const endSession = useLogStore((state) => state.endSession);

  const [rebuyOpen, setRebuyOpen] = useState(false);
  const [rebuyAmount, setRebuyAmount] = useState('');
  const [cashOutOpen, setCashOutOpen] = useState(false);
  const [cashOutAmount, setCashOutAmount] = useState('');
  const [endMood, setEndMood] = useState<MoodScore | null>(null);
  const [busy, setBusy] = useState(false);

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
          <Text variant="heading" centre>
            No session running
          </Text>
          <Button
            label="Back to dashboard"
            style={styles.emptyAction}
            onPress={() => router.replace('/')}
          />
        </View>
      </Screen>
    );
  }

  const currency = session.stakes.currency;
  const cashOutCents = parseAmount(cashOutAmount);
  const projected = cashOutCents === null ? null : cashOutCents - invested;

  const commitRebuy = async () => {
    const amount = parseAmount(rebuyAmount);
    if (amount === null || amount <= 0 || busy) return;
    setBusy(true);
    try {
      await addRebuy(session.id, amount);
      successFeedback();
      setRebuyOpen(false);
      setRebuyAmount('');
    } finally {
      setBusy(false);
    }
  };

  const commitCashOut = async () => {
    if (cashOutCents === null || cashOutCents < 0 || busy) return;
    setBusy(true);
    try {
      await endSession(session.id, cashOutCents, endMood);
      warningFeedback();
      setCashOutOpen(false);
      router.replace(`/session/${session.id}`);
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
              setCashOutAmount('');
              setEndMood(null);
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
            {session.venue?.name ?? 'Unknown venue'} · {formatStakes(session.stakes)} ·{' '}
            {session.gameType}
          </Text>
        </View>

        <View style={styles.tiles}>
          <StatTile label="On the table" value={formatMoney(invested, { currency })} />
          <StatTile
            label="Rebuys"
            value={String(session.rebuys.length)}
            hint={
              session.rebuys.length > 0
                ? formatMoney(invested - session.buyIn, { currency })
                : 'None yet'
            }
          />
          <StatTile label="Hands" value={String(hands.length)} hint="logged" />
        </View>

        <View style={styles.actions}>
          <Button
            label="Rebuy"
            variant="secondary"
            size="medium"
            style={styles.action}
            leading={<Ionicons name="add-circle-outline" size={18} color={colors.text} />}
            onPress={() => {
              setRebuyAmount(String(session.buyIn / 100));
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

        <MidSessionCheckIn session={session} elapsedMs={elapsed} />

        <SectionHeader title={`Hands this session (${hands.length})`} />
        {hands.length === 0 ? (
          <Card>
            <Text color={colors.textSecondary}>
              Nothing logged yet. Tap <Text variant="bodyStrong">Log hand</Text> when something
              is worth remembering — it takes about ten seconds.
            </Text>
          </Card>
        ) : (
          <View>
            {hands.map((hand) => (
              <HandRow key={hand.id} hand={hand} currency={currency} />
            ))}
          </View>
        )}

        {session.rebuys.length > 0 ? (
          <>
            <SectionHeader title="Rebuys" />
            <Card>
              {session.rebuys.map((rebuy, index) => (
                <View key={rebuy.id} style={styles.rebuyRow}>
                  <Text color={colors.textSecondary}>
                    Rebuy {index + 1} ·{' '}
                    {formatDuration(rebuy.at - session.startedAt)} in
                  </Text>
                  <Text variant="bodyStrong">{formatMoney(rebuy.amount, { currency })}</Text>
                </View>
              ))}
            </Card>
          </>
        ) : null}
      </Screen>

      <Sheet visible={rebuyOpen} onClose={() => setRebuyOpen(false)} title="Add a rebuy">
        <AmountInput
          value={rebuyAmount}
          onChangeText={setRebuyAmount}
          currency={currency}
          presets={[session.buyIn / 2, session.buyIn, session.buyIn * 2].map(Math.round)}
          autoFocus
          accessibilityLabel="Rebuy amount"
        />
        <Button
          label="Add rebuy"
          onPress={() => void commitRebuy()}
          style={styles.sheetAction}
          disabled={(parseAmount(rebuyAmount) ?? 0) <= 0}
          loading={busy}
        />
      </Sheet>

      <Sheet visible={cashOutOpen} onClose={() => setCashOutOpen(false)} title="Cash out">
        <Text color={colors.textSecondary} style={styles.sheetHint}>
          Count your chips. You put {formatMoney(invested, { currency })} on the table over{' '}
          {formatDuration(elapsed)}.
        </Text>
        <AmountInput
          value={cashOutAmount}
          onChangeText={setCashOutAmount}
          currency={currency}
          placeholder="0"
          autoFocus
          accessibilityLabel="Cash-out amount"
        />

        {projected !== null ? (
          <Text variant="heading" color={resultColor(projected)} style={styles.projection}>
            {formatMoney(projected, { currency, signed: true })} for the session
          </Text>
        ) : null}

        <Text variant="overline" color={colors.textTertiary} style={styles.sheetLabel}>
          How are you leaving? (optional)
        </Text>
        <MoodPicker value={endMood} onChange={setEndMood} compact />

        <Button
          label="End session"
          onPress={() => void commitCashOut()}
          style={styles.sheetAction}
          disabled={cashOutCents === null || cashOutCents < 0}
          loading={busy}
        />
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
    paddingVertical: spacing.sm,
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
