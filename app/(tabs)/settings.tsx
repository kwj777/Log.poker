/**
 * Settings and about.
 *
 * Short by design. The real controls are venue management, the session-summary
 * import and the dev-only demo seeder; everything else is information about
 * where your data lives, which is a question worth answering plainly and now
 * has two answers: on this device, and on the server too if the card below
 * this one has been used. The copy has to carry both, because the paragraph
 * saying otherwise sat directly above that card for the length of one deploy.
 */

import { useState } from 'react';
import { Linking, Platform, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';

import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { Screen } from '../../src/components/Screen';
import { SectionHeader } from '../../src/components/SectionHeader';
import { Text } from '../../src/components/Text';
import { ALLOW_DEMO_SEED, ALLOW_SIGN_IN, PRIVACY_POLICY, SUPPORT_EMAIL } from '../../src/config';
import { getRepository, STORAGE_ENGINE } from '../../src/data';
import { toCsvFile } from '../../src/domain/export/csv';
import {
  HAND_HEADERS,
  MOOD_HEADERS,
  SESSION_HEADERS,
  exportFileName,
  handRows,
  moodRows,
  sessionRows,
  type ExportKind,
} from '../../src/domain/export/sessionExport';
import { saveCsv } from '../../src/features/export/saveCsv';
import { seedDemoData } from '../../src/data/seed';
import { SignInCard } from '../../src/features/account/SignInCard';
import { FamilyCrossPromo } from '../../src/features/family/FamilyCrossPromo';
import { useLogStore } from '../../src/store/useLogStore';
import { colors, spacing } from '../../src/theme';
import { releaseLabel } from '../../src/version';
import { PageMeta } from '../../src/components/PageMeta';

export default function SettingsScreen() {
  const venues = useLogStore((state) => state.venues);
  const sessions = useLogStore((state) => state.sessions);
  const handCount = useLogStore((state) => state.handCount);
  const moodEntries = useLogStore((state) => state.moodEntries);
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

  /**
   * Write the log out as a file.
   *
   * Read from the repository rather than from the store, which is the source
   * of truth and, since the hands stopped being held in memory, the only place
   * all of them are. An export is a deliberate act somebody waits a moment
   * for, so the one full read it costs is the right kind of expensive.
   */
  const exportCsv = async (kind: ExportKind) => {
    setBusy(true);
    setMessage(null);
    try {
      const repository = await getRepository();
      const all = await repository.listSessions();
      const [headers, rows] =
        kind === 'sessions'
          ? [SESSION_HEADERS, sessionRows(all)]
          : kind === 'hands'
            ? [HAND_HEADERS, handRows(await repository.listHands(), all)]
            : [MOOD_HEADERS, moodRows(await repository.listMoodEntries(), all)];

      const result = await saveCsv(exportFileName(kind), toCsvFile(headers, rows));
      // Backing out of a share sheet is not a failure and gets no message.
      if (result.saved) {
        const noun = kind === 'sessions' ? 'session' : kind === 'hands' ? 'hand' : 'mood entry';
        const plural = kind === 'moods' ? 'mood entries' : `${noun}s`;
        setMessage(`Exported ${rows.length} ${rows.length === 1 ? noun : plural}.`);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Export failed');
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

      <SectionHeader title="Export" />
      <Card>
        <Text color={colors.textSecondary} style={styles.body}>
          Your log as spreadsheets. The sessions file is the only one Log reads back: import it
          here and it lands as the sessions it came from, which makes it a backup as well as a
          record. The other two are records.
        </Text>
        <View style={styles.exportRow}>
          <Button
            label="Sessions"
            variant="secondary"
            size="medium"
            style={styles.exportButton}
            // Nothing to write and nothing to read back: a header row on its own
            // is a file this app's own importer refuses.
            disabled={busy || sessions.length === 0}
            onPress={() => void exportCsv('sessions')}
          />
          <Button
            label="Hands"
            variant="secondary"
            size="medium"
            style={styles.exportButton}
            disabled={busy || handCount === 0}
            onPress={() => void exportCsv('hands')}
          />
          <Button
            label="Moods"
            variant="secondary"
            size="medium"
            style={styles.exportButton}
            disabled={busy || moodEntries.length === 0}
            onPress={() => void exportCsv('moods')}
          />
        </View>
        <Text variant="caption" color={colors.textTertiary} style={styles.exportNote}>
          Hands carry your cards, the board where you logged one, your seat, tags and note.
          Moods carry every score you have given a session, which is what the mood cost on the
          Variance tab is built from.
        </Text>
      </Card>

      <SectionHeader title="Your data" />
      <Card>
        <Text color={colors.textSecondary} style={styles.body}>
          Log stores your sessions in {STORAGE_ENGINE} on this device, and that is
          the whole of it unless you sign in below. Signing in carries your own
          log to your own other devices and sends nothing else, ever.
        </Text>
        <View style={styles.dataStats}>
          <Text variant="caption" color={colors.textTertiary}>
            {sessions.length} session{sessions.length === 1 ? '' : 's'} · {handCount} hand
            {handCount === 1 ? '' : 's'} · {venues.length} venue
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

      {/*
        Help and legal, which is one section because it answers one question:
        where does somebody go when the app is wrong, or when they want to
        know what it does with their log.

        It is also the section an app store requires. A privacy policy URL is
        a field App Store Connect will not accept a build without, and a way
        to reach a human is what a reviewer looks for when the rest of the
        screen is about deleting things.
      */}
      <SectionHeader title="Help and legal" />
      <Card>
        <Text color={colors.textSecondary} style={styles.body}>
          The privacy policy says what Log stores, where, and what leaves this
          device. If something here is wrong, the address below reaches a person.
        </Text>
        <View style={styles.exportRow}>
          <Button
            label="Privacy policy"
            variant="secondary"
            size="medium"
            style={styles.exportButton}
            onPress={() => void Linking.openURL(PRIVACY_POLICY)}
          />
          <Button
            label="Contact support"
            variant="secondary"
            size="medium"
            style={styles.exportButton}
            onPress={() => void Linking.openURL(`mailto:${SUPPORT_EMAIL}`)}
          />
        </View>
        <Text variant="caption" color={colors.textTertiary} style={styles.exportNote}>
          {SUPPORT_EMAIL}
        </Text>
      </Card>

      <View style={styles.about}>
        <Text variant="caption" color={colors.textTertiary} center>
          Log · log.poker
        </Text>
        <Text variant="caption" color={colors.textTertiary} center>
          The session log that keeps you off tilt.
        </Text>
        {/*
          The build, which is the first thing anybody asks about a bug and the
          last thing anybody can find out. See `src/version.ts`.
        */}
        <Text variant="caption" color={colors.textTertiary} center>
          {releaseLabel()}
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
  exportRow: {
    flexDirection: 'row',
    gap: spacing.sm,
  },
  exportButton: {
    flex: 1,
  },
  exportNote: {
    marginTop: spacing.md,
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
