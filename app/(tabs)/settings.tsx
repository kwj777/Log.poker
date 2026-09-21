/**
 * Settings and about.
 *
 * Short by design. The real controls are venue management, the session-summary
 * import and the dev-only demo seeder; everything else is information about
 * where your data lives, which is a question worth answering plainly and now
 * has two answers: on this device, and on the server too if the card below
 * this one has been used. The copy has to carry both, because the paragraph
 * saying otherwise sat directly above that card for the length of one deploy.
 *
 * ## Why the result of an action is tagged with the card it happened on
 *
 * Four things here report back: a venue removal, an export, a reset and the
 * demo seeder. They used to share one `message` string rendered in exactly one
 * place -- inside the developer card, which is gated on `ALLOW_DEMO_SEED` and
 * therefore on `__DEV__`. So in a real build an export said nothing, a failed
 * export said nothing, and clearing the entire log said nothing: the spinner
 * stopped and the screen sat there, which from a foot away is what success and
 * failure both look like. A screen test covered it and passed, because
 * `jest-expo` defines `__DEV__`.
 *
 * `Report` carries which card it belongs to, and each card renders its own. A
 * single banner at the top would have been less code and worse: this screen is
 * several times longer than a phone, and Reset is at the bottom of it. Tagging
 * is also what makes the dev-only render impossible to reintroduce, since a
 * section that never draws is a section whose report is never seen missing.
 */

import { useState } from 'react';
import { Linking, Platform, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';

import { AmountInput } from '../../src/components/AmountInput';
import { Button } from '../../src/components/Button';
import { Card } from '../../src/components/Card';
import { ErrorNote, describeFailure } from '../../src/components/ErrorNote';
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
import { formatMoney, fromCents, parseAmount } from '../../src/domain/money';
import { primaryCurrency } from '../../src/domain/stats';
import { DEMO_SESSION_COUNT, seedDemoData } from '../../src/data/seed';
import { SignInCard } from '../../src/features/account/SignInCard';
import { VenueRow } from '../../src/features/venues/VenueRow';
import { FamilyCrossPromo } from '../../src/features/family/FamilyCrossPromo';
import { useLogStore } from '../../src/store/useLogStore';
import { colors, spacing } from '../../src/theme';
import { releaseLabel } from '../../src/version';
import { PageMeta } from '../../src/components/PageMeta';

/** Which card an action reports under. */
type ReportSection = 'venues' | 'bankroll' | 'export' | 'reset' | 'seed';

interface Report {
  section: ReportSection;
  text: string;
  /** Failures get `ErrorNote`, which is bordered and announced as an alert. */
  failed: boolean;
}

/**
 * The result of the last action, under the button that caused it.
 *
 * Successes are a caption rather than a note, because a caption is what a
 * confirmation should look like -- and live so that somebody who cannot see it
 * appear is still told, which is the whole point of saying anything at all.
 */
const ReportNote = ({ report, section }: { report: Report | null; section: ReportSection }) => {
  if (report === null || report.section !== section) return null;
  if (report.failed) return <ErrorNote message={report.text} />;
  return (
    <Text
      variant="caption"
      color={colors.accent}
      style={styles.message}
      accessibilityLiveRegion="polite"
    >
      {report.text}
    </Text>
  );
};

export default function SettingsScreen() {
  const venues = useLogStore((state) => state.venues);
  const sessions = useLogStore((state) => state.sessions);
  const handCount = useLogStore((state) => state.handCount);
  const moodEntries = useLogStore((state) => state.moodEntries);
  const startingBalance = useLogStore((state) => state.startingBalance);
  const setStartingBalance = useLogStore((state) => state.setStartingBalance);
  const deleteVenue = useLogStore((state) => state.deleteVenue);
  const renameVenue = useLogStore((state) => state.renameVenue);
  const mergeVenues = useLogStore((state) => state.mergeVenues);
  const refresh = useLogStore((state) => state.refresh);
  const clearAll = useLogStore((state) => state.clearAll);

  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);

  const say = (section: ReportSection, text: string, failed = false) =>
    setReport({ section, text, failed });

  /**
   * Run one venue write, report what it did, and say whether the row may close.
   *
   * Awaited and caught rather than fired off, which is what removal was: a
   * `void deleteVenue(id)` with no catch at all, so a delete that threw left
   * the row on screen and the rejection unhandled. The boolean is what the row
   * needs and the only thing it needs -- a failed write leaves the editor open
   * with what was typed still in it.
   */
  const venueWrite = async (run: () => Promise<string>, whenItFails: string) => {
    setBusy(true);
    setReport(null);
    try {
      say('venues', await run());
      return true;
    } catch (error) {
      say('venues', describeFailure(error, whenItFails), true);
      return false;
    } finally {
      setBusy(false);
    }
  };

  const removeVenue = (id: string) =>
    venueWrite(async () => {
      await deleteVenue(id);
      return 'Venue removed.';
    }, 'Could not remove that venue.');

  const rename = (id: string, name: string) =>
    venueWrite(async () => {
      await renameVenue(id, name);
      return `Renamed to ${name}.`;
    }, 'Could not rename that venue.');

  const merge = (fromId: string, into: { id: string; name: string }) =>
    venueWrite(async () => {
      const moved = await mergeVenues(fromId, into.id);
      return `Moved ${moved} session${moved === 1 ? '' : 's'} to ${into.name}.`;
    }, 'Could not merge those venues.');

  const seed = async () => {
    setBusy(true);
    setReport(null);
    try {
      const repository = await getRepository();
      const result = await seedDemoData(repository);
      await refresh();
      say('seed', `Seeded ${result.sessions} sessions, ${result.hands} hands.`);
    } catch (error) {
      say('seed', describeFailure(error, 'Seeding failed'), true);
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
    setReport(null);
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
        say('export', `Exported ${rows.length} ${rows.length === 1 ? noun : plural}.`);
      }
    } catch (error) {
      say('export', describeFailure(error, 'Export failed'), true);
    } finally {
      setBusy(false);
    }
  };

  /**
   * What the player had behind them before the first logged session.
   *
   * Seeded from what is stored and adjusted during render rather than synced
   * in an effect, the way session detail seeds its notes: an effect would
   * render an empty field first and then fill it, so somebody opening this
   * screen would watch their own balance appear.
   */
  const [balanceDraft, setBalanceDraft] = useState('');
  const [seededFrom, setSeededFrom] = useState<number | null | undefined>(undefined);
  if (seededFrom !== (startingBalance?.cents ?? null)) {
    setSeededFrom(startingBalance?.cents ?? null);
    setBalanceDraft(startingBalance === null ? '' : String(fromCents(startingBalance.cents)));
  }

  /**
   * The money a balance would be in: whatever the log is mostly in.
   *
   * Not a picker. A player with two currencies has one bankroll they think in,
   * and a screen that asked them to choose would be asking a question to avoid
   * making an assumption that is right almost every time. The dashboard shows
   * profit rather than a bankroll for the currency this is not in, which is
   * the honest behavior either way.
   */
  const balanceCurrency = primaryCurrency(sessions);
  const draftCents = parseAmount(balanceDraft);

  const saveBalance = async () => {
    if (draftCents === null) return;
    setBusy(true);
    setReport(null);
    try {
      await setStartingBalance({ cents: draftCents, currency: balanceCurrency });
      say('bankroll', `Starting balance set to ${formatMoney(draftCents, { currency: balanceCurrency })}.`);
    } catch (error) {
      say('bankroll', describeFailure(error, 'Could not save that.'), true);
    } finally {
      setBusy(false);
    }
  };

  const clearBalance = async () => {
    setBusy(true);
    setReport(null);
    try {
      await setStartingBalance(null);
      say('bankroll', 'Cleared. The dashboard shows your profit again.');
    } catch (error) {
      say('bankroll', describeFailure(error, 'Could not clear that.'), true);
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setBusy(true);
    setReport(null);
    try {
      await clearAll();
      setConfirmingReset(false);
      say('reset', 'All data cleared.');
    } catch (error) {
      say('reset', describeFailure(error, 'Could not clear your data.'), true);
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
            <VenueRow
              key={venue.id}
              venue={venue}
              others={venues.filter((other) => other.id !== venue.id)}
              busy={busy}
              onRename={rename}
              onMerge={merge}
              onRemove={removeVenue}
            />
          ))
        )}
        <ReportNote report={report} section="venues" />
      </Card>

      {/*
        The number that makes the dashboard headline true.

        It said "Bankroll" over cumulative profit from zero, which is not a
        bankroll: it differs from one by whatever the player sat down with, and
        for somebody down over their logged sessions it was negative, which no
        bankroll has ever been. The app ships a guide about how big a bankroll
        should be and had nowhere to put the number that guide is about.

        Optional, and the dashboard says "Profit" without it, which is what it
        has been showing all along.
      */}
      <SectionHeader title="Bankroll" />
      <Card>
        <Text color={colors.textSecondary} style={styles.body}>
          What you had behind you before your first logged session. With it, the dashboard
          shows your bankroll and what you have won or lost since. Without it, it shows what
          you have won or lost, which is what it showed before.
        </Text>
        <AmountInput
          value={balanceDraft}
          onChangeText={setBalanceDraft}
          currency={balanceCurrency}
          accessibilityLabel="Starting balance"
        />
        <View style={styles.balanceRow}>
          {startingBalance === null ? null : (
            <Button
              label="Clear"
              variant="ghost"
              size="small"
              disabled={busy}
              onPress={() => void clearBalance()}
            />
          )}
          <View style={styles.spacer} />
          <Button
            label="Save"
            variant="secondary"
            size="small"
            disabled={busy || draftCents === null}
            onPress={() => void saveBalance()}
          />
        </View>
        <Text variant="caption" color={colors.textTertiary} style={styles.exportNote}>
          Kept on this device, and not carried to your other ones even when you are signed in.
        </Text>
        <ReportNote report={report} section="bankroll" />
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
          here and every finished session lands as the session it came from, which makes it a
          backup as well as a record. A night still in progress is written down with the rest,
          but it has no result yet, so it is the one row an import will pass over. The other two
          files are records.
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
        <ReportNote report={report} section="export" />
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
              Load a demo dataset: {DEMO_SESSION_COUNT} mixed-result sessions with hands and mood entries,
              enough to populate the dashboard and the variance view.
            </Text>
            <Button
              label="Load demo data"
              variant="secondary"
              size="medium"
              onPress={() => void seed()}
              loading={busy}
            />
            <ReportNote report={report} section="seed" />
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
        <ReportNote report={report} section="reset" />
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
  body: {
    lineHeight: 23,
    marginBottom: spacing.lg,
  },
  balanceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  spacer: {
    flex: 1,
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
