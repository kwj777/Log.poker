/**
 * A question mark beside a label, and what it opens.
 *
 * ## Not a tooltip, because a tooltip needs a mouse
 *
 * The obvious build is hover text. It would work on the web and be invisible on
 * a phone, which is where this app mostly is: a player standing at a table is
 * not hovering anything. So it is a tap, and what it opens is `Sheet` -- the one
 * overlay primitive already proven to behave the same on iOS, Android and web,
 * with the Escape key handled for the browser.
 *
 * ## Why a whole list rather than one term at a time
 *
 * The affordance sits in `SectionHeader`'s existing `action` slot, so it
 * explains a section rather than a word. That is the better unit here anyway.
 * Nobody wonders what `HJ` means in isolation; they wonder what the row of
 * abbreviations is, and reading the nine seats in order answers a question they
 * had not finished forming. It also means the chips stay chips: tapping one
 * picks a position, which is what a player wants ninety-nine times out of a
 * hundred, and overloading that gesture to sometimes mean "define this" would
 * be a worse trade than an extra tap on a question mark.
 *
 * Entries come from `domain/glossary.ts`, where the position and tag sets are
 * keyed by their unions so the compiler asks about a new one.
 */

import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import type { GlossaryEntry } from '../domain/glossary';
import { colors, layout, radius, spacing, typography } from '../theme';
import { Sheet } from './Sheet';
import { TapArea } from './TapArea';
import { Text } from './Text';
import { tapFeedback } from './haptics';

interface ExplainProps {
  /** What the sheet is called. Usually the section's own title. */
  title: string;
  entries: readonly GlossaryEntry[];
  /**
   * Spoken by a screen reader instead of "question mark". Defaults to naming
   * the title, because "button, ?" tells somebody nothing about what it opens.
   */
  label?: string;
}

/** Thirteen a side, the badge being 22 against a floor of 48. Native and web. */
const BADGE_SLOP = Math.ceil((layout.tapTarget - 22) / 2);

export const Explain = ({ title, entries, label }: ExplainProps) => {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label ?? `What these mean: ${title}`}
        accessibilityHint="Opens a short explanation"
        // The badge draws at 22 and the floor is 48, so it needs 13 a side
        // rather than the 8 it had -- which left it at 38 and still short.
        //
        // `TapArea` is the web half of the same number: react-native-web drops
        // `hitSlop` entirely, so this said "13 a side" about native alone.
        hitSlop={BADGE_SLOP}
        onPress={() => {
          tapFeedback();
          setOpen(true);
        }}
        style={({ pressed }) => [styles.badge, pressed ? styles.pressed : null]}
      >
        <TapArea slop={BADGE_SLOP} />
        <Text style={typography.caption} color={colors.textTertiary}>
          ?
        </Text>
      </Pressable>

      <Sheet visible={open} onClose={() => setOpen(false)} title={title}>
        <View style={styles.list}>
          {entries.map((entry) => (
            <View key={entry.term} style={styles.entry}>
              <Text variant="bodyStrong">{entry.term}</Text>
              <Text color={colors.textSecondary} style={styles.says}>
                {entry.says}
              </Text>
            </View>
          ))}
        </View>
      </Sheet>
    </>
  );
};

const styles = StyleSheet.create({
  badge: {
    minWidth: 22,
    height: 22,
    paddingHorizontal: spacing.xs,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  pressed: {
    backgroundColor: colors.surfaceActive,
  },
  list: {
    gap: spacing.lg,
  },
  entry: {
    gap: 2,
  },
  says: {
    lineHeight: 21,
  },
});
