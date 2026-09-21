/**
 * The box you type into to find one thing in a log with years in it.
 *
 * Two callers, which is why it is a component: Sessions searches rooms and
 * session notes, and Hands searches hand notes and cards. They want the same
 * control and the same clear button, and the alternative was the same twenty
 * lines twice.
 *
 * The clear button rather than only the keyboard's own, because on the web
 * there is no keyboard's own and a search that can be entered and not left is
 * a filter somebody gets stuck inside. It is absent while the box is empty,
 * since a control that does nothing is a control in the way.
 */

import { Platform, Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { colors, layout, radius, spacing, typography } from '../theme';

interface SearchFieldProps {
  value: string;
  onChangeText: (value: string) => void;
  placeholder: string;
  accessibilityLabel: string;
}

export const SearchField = ({
  value,
  onChangeText,
  placeholder,
  accessibilityLabel,
}: SearchFieldProps) => (
  <View style={styles.root}>
    <Ionicons name="search" size={16} color={colors.textTertiary} />
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={colors.textTertiary}
      autoCapitalize="none"
      autoCorrect={false}
      // `search` rather than `text`, so the return key says so and iOS offers
      // the clear button it offers on a search field.
      returnKeyType="search"
      accessibilityLabel={accessibilityLabel}
      style={styles.input}
    />
    {value.length > 0 ? (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Clear the search"
        onPress={() => onChangeText('')}
        // The glyph draws at 18 and the floor is 48, so it needs 15 a side
        // rather than the 8 it had, which left it at 34. `Explain` did this
        // arithmetic for its badge already and said why; this is the same
        // shortfall on the one control whose job is getting a player back out
        // of a filter they cannot see past.
        hitSlop={Math.ceil((layout.tapTarget - 18) / 2)}
      >
        <Ionicons name="close-circle" size={18} color={colors.textTertiary} />
      </Pressable>
    ) : null}
  </View>
);

const styles = StyleSheet.create({
  root: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.md,
    paddingVertical: Platform.OS === 'web' ? spacing.sm : spacing.xs,
  },
  input: {
    ...typography.body,
    flex: 1,
    color: colors.text,
    paddingVertical: spacing.sm,
    ...Platform.select({ web: { outlineStyle: 'none' as 'solid' }, default: {} }),
  },
});
