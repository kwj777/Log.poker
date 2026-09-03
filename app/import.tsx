/**
 * Import session summaries.
 *
 * Log is a live-poker journal, and an online player's history already exists in
 * a file somewhere -- a PokerTracker or Holdem Manager session report, a
 * PokerCraft export, a spreadsheet they have kept for years. This screen is the
 * one door into the app that does not involve typing a session out by hand.
 *
 * The shape of it is deliberately: choose a file, *see what it read*, then
 * import. An importer that writes straight to the database is one nobody runs a
 * second time, because the first time it lands 300 wrong rows in a bankroll
 * curve with no way to tell what happened. Everything the parser was unsure
 * about is on screen before the button is live.
 */

import { useMemo, useState } from 'react';
import { Platform, StyleSheet, TextInput, View } from 'react-native';
import { router } from 'expo-router';

import { Button } from '../src/components/Button';
import { Card } from '../src/components/Card';
import { Chip } from '../src/components/Chip';
import { PageMeta } from '../src/components/PageMeta';
import { Screen } from '../src/components/Screen';
import { SectionHeader } from '../src/components/SectionHeader';
import { Text } from '../src/components/Text';
import { successFeedback } from '../src/components/haptics';
import { FIELD_LABELS, parseSessionCsv, type ImportField } from '../src/domain/import';
import { formatMoney } from '../src/domain/money';
import { CAN_PICK_FILE, pickCsvFile } from '../src/features/import/pickCsvFile';
import { useLogStore, type ImportSummary } from '../src/store/useLogStore';
import { colors, radius, resultColor, spacing, typography } from '../src/theme';

const formatDay = (timestamp: number): string =>
  new Date(timestamp).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

export default function ImportScreen() {
  const importSessions = useLogStore((state) => state.importSessions);

  const [text, setText] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [dayFirst, setDayFirst] = useState(false);
  const [busy, setBusy] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const reading = useMemo(
    () => (text.trim() === '' ? null : parseSessionCsv(text, dayFirst ? { dateOrder: 'dmy' } : {})),
    [text, dayFirst],
  );

  const totals = useMemo(() => {
    if (!reading || reading.sessions.length === 0) return null;
    const starts = reading.sessions.map((session) => session.draft.startedAt);
    return {
      net: reading.sessions.reduce(
        (sum, session) => sum + session.draft.cashOut - session.draft.buyIn,
        0,
      ),
      currency: reading.sessions[0].draft.currency,
      from: Math.min(...starts),
      to: Math.max(...starts),
      venues: Array.from(new Set(reading.sessions.map((session) => session.venueName))),
    };
  }, [reading]);

  const replaceText = (next: string, name: string | null) => {
    setText(next);
    setFileName(name);
    setSummary(null);
    setFailure(null);
    // Only the file itself can say which way its dates run; a toggle left over
    // from the last file would silently misread this one.
    setDayFirst(false);
  };

  const choose = async () => {
    const picked = await pickCsvFile();
    if (picked) replaceText(picked.text, picked.name);
  };

  const runImport = async () => {
    if (!reading || reading.sessions.length === 0) return;
    setBusy(true);
    setFailure(null);
    try {
      const result = await importSessions(reading.sessions);
      setSummary(result);
      setText('');
      setFileName(null);
      if (result.imported > 0) successFeedback();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'The import could not be written.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <PageMeta title="Import sessions · Log" />

      <View style={styles.header}>
        <Text variant="title">Import sessions</Text>
        <Text color={colors.textSecondary} style={styles.lede}>
          If you play online, your history is already written down: your site or your tracker
          did it. Export a session summary as CSV and drop it in here.
        </Text>
      </View>

      <SectionHeader title="The file" />
      <Card>
        <Text variant="caption" color={colors.textTertiary} style={styles.spec}>
          One row per session, with a header row on top. It needs a date column, and either a
          result column or a buy-in and a cash-out. Stakes, site, game, duration and notes are
          used when they are there.
        </Text>
        {CAN_PICK_FILE ? (
          <Button
            label={fileName ?? 'Choose a CSV file…'}
            variant="secondary"
            size="medium"
            onPress={() => void choose()}
          />
        ) : null}
        <TextInput
          value={text}
          onChangeText={(next) => replaceText(next, null)}
          placeholder={
            CAN_PICK_FILE ? '…or paste the rows here' : 'Paste the rows here'
          }
          placeholderTextColor={colors.textTertiary}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Session summary rows"
          style={styles.paste}
        />
        <Text variant="caption" color={colors.textTertiary}>
          Nothing is uploaded. The file is read on this device and stays there, like everything
          else in Log.
        </Text>
      </Card>

      {reading && reading.error !== null ? (
        <>
          <SectionHeader title="Can’t read that" />
          <Card>
            <Text color={colors.loss} style={styles.body}>
              {reading.error}
            </Text>
            {reading.headers.length > 0 ? (
              <Text variant="caption" color={colors.textTertiary}>
                Columns found: {reading.headers.join(', ')}
              </Text>
            ) : null}
          </Card>
        </>
      ) : null}

      {reading && reading.error === null && totals ? (
        <>
          <SectionHeader title="What it reads" />
          <Card>
            <View style={styles.headline}>
              <Text variant="heading">
                {reading.sessions.length} session{reading.sessions.length === 1 ? '' : 's'}
              </Text>
              <Text variant="heading" color={resultColor(totals.net)}>
                {formatMoney(totals.net, { currency: totals.currency, signed: true })}
              </Text>
            </View>
            <Text variant="caption" color={colors.textTertiary} style={styles.range}>
              {formatDay(totals.from)} - {formatDay(totals.to)} · {totals.venues.join(', ')}
            </Text>

            <View style={styles.mapping}>
              {(Object.keys(reading.columns?.matched ?? {}) as ImportField[]).map((field) => (
                <View key={field} style={styles.mappingRow}>
                  <Text variant="caption" color={colors.textTertiary}>
                    {reading.columns?.matched[field]}
                  </Text>
                  <Text variant="caption" color={colors.textSecondary}>
                    → {FIELD_LABELS[field]}
                  </Text>
                </View>
              ))}
            </View>

            {reading.columns && reading.columns.unmapped.length > 0 ? (
              <Text variant="caption" color={colors.textTertiary} style={styles.ignored}>
                Ignored: {reading.columns.unmapped.join(', ')}
              </Text>
            ) : null}

            {!reading.dateOrderCertain || dayFirst ? (
              <View style={styles.toggle}>
                <Chip
                  label="Dates are day-first"
                  selected={dayFirst}
                  onPress={() => setDayFirst((current) => !current)}
                />
              </View>
            ) : null}
          </Card>

          {reading.warnings.length > 0 ? (
            <>
              <SectionHeader title="Worth knowing" />
              <Card>
                {reading.warnings.map((warning, index) => (
                  <View key={`${warning.line}-${index}`} style={styles.warning}>
                    <Text variant="caption" color={colors.accent}>
                      {warning.line === null ? '•' : `Line ${warning.line}`}
                    </Text>
                    <Text variant="caption" color={colors.textSecondary} style={styles.warningBody}>
                      {warning.message}
                    </Text>
                  </View>
                ))}
              </Card>
            </>
          ) : null}

          <Button
            label={`Import ${reading.sessions.length} session${
              reading.sessions.length === 1 ? '' : 's'
            }`}
            onPress={() => void runImport()}
            loading={busy}
            style={styles.action}
          />
        </>
      ) : null}

      {failure !== null ? (
        <Card style={styles.action}>
          <Text color={colors.loss}>{failure}</Text>
        </Card>
      ) : null}

      {summary !== null ? (
        <>
          <SectionHeader title="Done" />
          <Card>
            <Text variant="bodyStrong" style={styles.summaryLine}>
              {summary.imported === 0
                ? 'Nothing new to add.'
                : `Imported ${summary.imported} session${summary.imported === 1 ? '' : 's'}.`}
            </Text>
            {summary.duplicates > 0 ? (
              <Text variant="caption" color={colors.textSecondary} style={styles.summaryLine}>
                {summary.duplicates} {summary.duplicates === 1 ? 'was' : 'were'} already in your
                log and {summary.duplicates === 1 ? 'was' : 'were'} skipped: importing the same
                export again only ever adds what is new.
              </Text>
            ) : null}
            {summary.venuesCreated.length > 0 ? (
              <Text variant="caption" color={colors.textTertiary} style={styles.summaryLine}>
                Added {summary.venuesCreated.join(', ')} to your venues.
              </Text>
            ) : null}
            <Button
              label="Back to settings"
              variant="secondary"
              size="medium"
              onPress={() => router.back()}
            />
          </Card>
        </>
      ) : null}

      <View style={styles.footer}>
        <Button label="Done" variant="ghost" size="medium" onPress={() => router.back()} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    paddingTop: spacing.xl,
    gap: spacing.sm,
  },
  lede: {
    lineHeight: 23,
  },
  spec: {
    lineHeight: 18,
    marginBottom: spacing.lg,
  },
  paste: {
    ...typography.caption,
    color: colors.text,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.md,
    marginTop: spacing.md,
    marginBottom: spacing.md,
    minHeight: 120,
    // A monospaced face keeps pasted columns lined up, which is most of what
    // makes a wrong delimiter obvious at a glance.
    fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' }),
    textAlignVertical: 'top',
  },
  body: {
    lineHeight: 23,
    marginBottom: spacing.sm,
  },
  headline: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  range: {
    marginTop: spacing.xs,
  },
  mapping: {
    marginTop: spacing.lg,
    gap: spacing.xs,
  },
  mappingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  ignored: {
    marginTop: spacing.md,
    lineHeight: 18,
  },
  toggle: {
    flexDirection: 'row',
    marginTop: spacing.lg,
  },
  warning: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingVertical: spacing.xs,
  },
  warningBody: {
    flex: 1,
    lineHeight: 18,
  },
  action: {
    marginTop: spacing.xl,
  },
  summaryLine: {
    marginBottom: spacing.md,
    lineHeight: 20,
  },
  footer: {
    marginTop: spacing.xxl,
    marginBottom: spacing.xl,
  },
});
