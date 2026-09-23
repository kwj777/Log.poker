/**
 * Import session summaries, or hand histories.
 *
 * Log is a live-poker journal, and an online player's history already exists in
 * a file somewhere -- a PokerTracker or Holdem Manager session report, a
 * PokerCraft export, a spreadsheet they have kept for years, or the hand
 * histories the site itself writes. This screen is the one door into the app
 * that does not involve typing a session or a hand out by hand.
 *
 * One door for both kinds of file, because a player holding a file should not
 * have to know which kind it is to find where it goes. The first line decides:
 * every hand-history format opens with its hand header, and no spreadsheet
 * does. Hand histories go to `HandHistoryPreview`; everything else is read as
 * a session summary, as it always was.
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
import { Explain } from '../src/components/Explain';
import { importGlossary } from '../src/domain/glossary';
import { FIELD_LABELS, draftNet, parseSessionCsv, type ImportField } from '../src/domain/import';
import { looksLikeHandHistory } from '../src/domain/import/handHistory';
import { HandHistoryPreview } from '../src/features/import/HandHistoryPreview';
import { formatMoney } from '../src/domain/money';
import { pickCsvFile } from '../src/features/import/pickCsvFile';
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

  const handHistory = useMemo(() => looksLikeHandHistory(text), [text]);
  const reading = useMemo(
    () =>
      text.trim() === '' || handHistory
        ? null
        : parseSessionCsv(text, dayFirst ? { dateOrder: 'dmy' } : {}),
    [text, dayFirst, handHistory],
  );

  const totals = useMemo(() => {
    if (!reading || reading.sessions.length === 0) return null;
    const starts = reading.sessions.map((session) => session.draft.startedAt);

    /**
     * One figure per currency, in the order the file first uses them.
     *
     * It was one sum and the first row's symbol. `parseSessionCsv` resolves a
     * currency per row -- from a Currency column, or from a symbol in a money
     * cell -- so a file holding two of them was added together and labeled
     * with whichever happened to be first: $300 plus EUR700 minus GBP100
     * printed as "+$900", on the number a player reads to decide whether to
     * press Import.
     *
     * The three tab screens each carry a long comment about having fixed this
     * exact thing, and the dashboard's puts it best: "a bankroll is a sum, and
     * a sum of euros and dollars is neither." They scope to one currency and
     * offer a chip; this is a preview of a file rather than a view of a log,
     * so it says all of them rather than asking which. Log's own export writes
     * a Currency column, so a player with two hits this on their own file.
     */
    const nets = new Map<string, number>();
    for (const session of reading.sessions) {
      const { currency } = session.draft;
      // Through `draftNet`, so the figure the player checks before importing
      // is the app's arithmetic rather than this screen's. Written out here it
      // left the tournament entry fee off, and always in the flattering
      // direction.
      nets.set(currency, (nets.get(currency) ?? 0) + draftNet(session.draft));
    }

    return {
      nets: [...nets].map(([currency, net]) => ({ currency, net })),
      from: Math.min(...starts),
      to: Math.max(...starts),
      venues: Array.from(new Set(reading.sessions.map((session) => session.venueName))),
    };
  }, [reading]);

  /**
   * The reasons the parser wrote down, line by line.
   *
   * Outside both branches below, because the branch it used to live in is the
   * one where it is least needed. `parseSessionCsv` reports an error whenever
   * nothing survived -- "Nothing in that file could be read as a session." --
   * and a file where every row was skipped is exactly that: a file the parser
   * had a specific reason to reject on every line, and those reasons were
   * computed and then thrown away. Month-name dates, Excel serials and a
   * result column that is blank all land there, and the player was left with
   * one generic sentence and a list of the column names.
   */
  const worthKnowing =
    reading && reading.warnings.length > 0 ? (
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
    ) : null;

  const replaceText = (next: string, name: string | null) => {
    setText(next);
    setFileName(name);
    setSummary(null);
    setFailure(null);
  };

  const choose = async () => {
    // A picker that throws is a picker that opened, took a choice, and left the
    // screen exactly as it was. `null` is the player backing out and is the only
    // silent answer either half of `pickCsvFile` is allowed to give.
    let picked;
    try {
      picked = await pickCsvFile();
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'That file could not be read.');
      return;
    }
    if (picked) {
      setFailure(null);
      replaceText(picked.text, picked.name);
      // Only the file itself can say which way its dates run; a toggle left
      // over from the last file would silently misread this one.
      //
      // Here rather than in `replaceText`, which the paste box calls on every
      // keystroke: editing a row already on screen threw away the date order
      // the player had just told the screen about, and both the preview and
      // the write that follows it reverted to month-first. A new file is the
      // thing that invalidates the answer, and typing into one is not that.
      setDayFirst(false);
    }
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
      <PageMeta title="Import · Log" />

      <View style={styles.header}>
        <Text variant="title">Import</Text>
        <Text color={colors.textSecondary} style={styles.lede}>
          If you play online, your history is already written down: your site or your tracker
          did it. Export a session summary as CSV, or save your hand histories, and drop the file
          in here.
        </Text>
      </View>

      <SectionHeader title="The file" />
      <Card>
        <Text variant="caption" color={colors.textTertiary} style={styles.spec}>
          A session summary is one row per session, with a header row on top. It needs a date
          column, and either a result column or a buy-in and a cash-out. Stakes, site, game,
          duration and notes are used when they are there.
        </Text>
        <Text variant="caption" color={colors.textTertiary} style={styles.spec}>
          Hand histories from PokerStars, GGPoker, ACR, Winamax, 888poker and partypoker go
          into the session you were playing when they were dealt, including one still running.
        </Text>
        <Button
          label={fileName ?? 'Choose a file…'}
          variant="secondary"
          size="medium"
          onPress={() => void choose()}
        />
        <TextInput
          value={text}
          onChangeText={(next) => replaceText(next, null)}
          placeholder="…or paste the rows here"
          placeholderTextColor={colors.textTertiary}
          multiline
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Session summary rows or hand histories"
          style={styles.paste}
        />
        <Text variant="caption" color={colors.textTertiary}>
          Nothing is uploaded. The file is read on this device and stays there, like everything
          else in Log.
        </Text>
      </Card>

      {handHistory ? <HandHistoryPreview key={text} text={text} /> : null}

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
          {worthKnowing}
        </>
      ) : null}

      {reading && reading.error === null && totals ? (
        <>
          <SectionHeader
            title="What it reads"
            action={<Explain title="What each column is" entries={importGlossary()} />}
          />
          <Card>
            <View style={styles.headline}>
              <Text variant="heading">
                {reading.sessions.length} session{reading.sessions.length === 1 ? '' : 's'}
              </Text>
              <View style={styles.nets}>
                {totals.nets.map(({ currency, net }) => (
                  <Text key={currency} variant="heading" color={resultColor(net)}>
                    {formatMoney(net, { currency, signed: true })}
                  </Text>
                ))}
              </View>
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

          {worthKnowing}

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
  /** One line per currency, right-aligned under each other. */
  nets: {
    alignItems: 'flex-end',
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
