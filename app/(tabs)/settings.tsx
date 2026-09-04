/**
 * Settings and about.
 *
 * Short by design. The real controls are venue management, the session-summary
 * import and the dev-only demo seeder; everything else is information about
 * where your data lives -- which, with no account and no server, is a question
 * worth answering plainly.
 */

import { useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';

import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { Screen } from '../../src/components/Screen';
import { SectionHeader } from '../../src/components/SectionHeader';
import { Text } from '../../src/components/Text';
import { ALLOW_DEMO_SEED, ALLOW_SIGN_IN } from '../../src/config';
import { getRepository, STORAGE_ENGINE } from '../../src/data';
import { seedDemoData } from '../../src/data/seed';
import { SignInCard } from '../../src/features/account/SignInCard';
import { FamilyCrossPromo } from '../../src/features/family/FamilyCrossPromo';
import { useLogStore } from '../../src/store/useLogStore';
import { colors, spacing } from '../../src/theme';
import { PageMeta } from '../../src/components/PageMeta';

export default function SettingsScreen() {
  const venues = useLogStore((state) => state.venues);
  const sessions = useLogStore((state) => state.sessions);
  const hands = useLogStore((state) => state.hands);
  const deleteVenue = useLogStore((state) => state.deleteVenue);
  const refresh = useLogStore((state) => state.refresh);
  const clearAll = useLogStore((state) => state.clearAll);

  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);

  const seed = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const repository = await getRepository();
      const result = await seedDemoData(repository);
      await refresh();
      setMessage(`Seeded ${result.sessions} sessions, ${result.hands} hands.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Seeding failed');
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setBusy(true);
    try {
      await clearAll();
      setConfirmingReset(false);
      setMessage('All data cleared.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <PageMeta title="Settings · Log" />

      <View style={styles.header}>
        <Text variant="title">Settings</Text>
      </View>

      <SectionHeader title="Venues" />
      <Card style={styles.venues}>
        {venues.length === 0 ? (
          <Text color={colors.textSecondary}>
            Venues are created when you start a session.
          </Text>
        ) : (
          venues.map((venue) => (
            <View key={venue.id} style={styles.venueRow}>
              <View style={styles.venueBody}>
                <Text variant="bodyStrong" numberOfLines={1}>
                  {venue.name}
                </Text>
                <Text variant="caption" color={colors.textTertiary}>
                  {venue.isHomeGame ? 'Home game · ' : ''}
                  {venue.sessionCount} session{venue.sessionCount === 1 ? '' : 's'}
                </Text>
              </View>
              {venue.sessionCount === 0 ? (
                <Button
                  label="Remove"
                  variant="ghost"
                  size="small"
                  onPress={() => void deleteVenue(venue.id)}
                />
              ) : null}
            </View>
          ))
        )}
      </Card>

      <SectionHeader title="Import" />
      <Card>
        <Text color={colors.textSecondary} style={styles.body}>
          Play online? Export a session summary from your site or your tracker and bring the
          whole history in at once, rather than typing it out.
        </Text>
        <Button
          label="Import sessions"
          variant="secondary"
          size="medium"
          onPress={() => router.push('/import')}
        />
      </Card>

      <SectionHeader title="Your data" />
      <Card>
        <Text color={colors.textSecondary} style={styles.body}>
          Everything stays on this device. There is no account and no server: Log
          stores your sessions in {STORAGE_ENGINE} and never sends them anywhere.
        </Text>
        <View style={styles.dataStats}>
          <Text variant="caption" color={colors.textTertiary}>
            {sessions.length} session{sessions.length === 1 ? '' : 's'} · {hands.length} hand
            {hands.length === 1 ? '' : 's'} · {venues.length} venue
            {venues.length === 1 ? '' : 's'}
          </Text>
        </View>
        {Platform.OS === 'web' ? (
          <Text variant="caption" color={colors.textTertiary} style={styles.webNote}>
            On the web your log lives in this browser’s storage. Install Log to your home
            screen and it keeps working with no reception at all.
          </Text>
        ) : null}
      </Card>

      {ALLOW_SIGN_IN ? (
        <>
          <SectionHeader title="Your other devices" />
          <SignInCard />
        </>
      ) : null}

      {ALLOW_DEMO_SEED ? (
        <>
          <SectionHeader title="Developer" />
          <Card>
            <Text color={colors.textSecondary} style={styles.body}>
              Load a demo dataset: 20 mixed-result sessions with hands and mood entries,
              enough to populate the dashboard and the variance view.
            </Text>
            <Button
              label="Load demo data"
              variant="secondary"
              size="medium"
              onPress={() => void seed()}
              loading={busy}
            />
            {message ? (
              <Text variant="caption" color={colors.accent} style={styles.message}>
                {message}
              </Text>
            ) : null}
          </Card>
        </>
      ) : null}

      <SectionHeader title="Reset" />
      <Card>
        {confirmingReset ? (
          <>
            <Text color={colors.textSecondary} style={styles.body}>
              Delete every session, hand, mood entry and venue on this device. This cannot
              be undone.
            </Text>
            <View style={styles.confirmActions}>
              <Button
                label="Cancel"
                variant="secondary"
                size="small"
                onPress={() => setConfirmingReset(false)}
              />
              <Button label="Delete everything" variant="danger" size="small" onPress={() => void reset()} />
            </View>
          </>
        ) : (
          <Button
            label="Clear all data"
            variant="danger"
            size="medium"
            onPress={() => setConfirmingReset(true)}
          />
        )}
      </Card>

      <FamilyCrossPromo exclude={['log']} style={styles.family} />

      <View style={styles.about}>
        <Text variant="caption" color={colors.textTertiary} center>
          Log · log.poker
        </Text>
        <Text variant="caption" color={colors.textTertiary} center>
          The session log that keeps you off tilt.
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingTop: spacing.xl,
  },
  venues: {
    paddingVertical: spacing.xs,
  },
  venueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  venueBody: {
    flex: 1,
    gap: 2,
  },
  body: {
    lineHeight: 23,
    marginBottom: spacing.lg,
  },
  dataStats: {
    marginTop: -spacing.sm,
  },
  webNote: {
    marginTop: spacing.md,
    lineHeight: 18,
  },
  message: {
    marginTop: spacing.md,
  },
  confirmActions: {
    flexDirection: 'row',
    gap: spacing.sm,
    justifyContent: 'flex-end',
  },
  family: {
    marginTop: spacing.xxl,
  },
  about: {
    marginTop: spacing.xxl,
    marginBottom: spacing.xl,
    gap: spacing.xs,
  },
});
