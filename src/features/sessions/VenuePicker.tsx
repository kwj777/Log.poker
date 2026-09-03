/**
 * Venue selection, with inline creation.
 *
 * Venues are sorted most-played first, so a regular's room is always the first
 * chip. Adding one never leaves the screen -- a player standing at a new table
 * should not have to navigate into settings to log where they are.
 */

import { useState } from 'react';
import { Platform, StyleSheet, TextInput, View } from 'react-native';

import { Button } from '../../components/Button';
import { Chip } from '../../components/Chip';
import { Text } from '../../components/Text';
import type { Venue } from '../../domain/types';
import { colors, radius, spacing } from '../../theme';

interface VenuePickerProps {
  venues: readonly Venue[];
  value: string | null;
  onChange: (venueId: string) => void;
  onCreate: (name: string, isHomeGame: boolean) => Promise<Venue>;
}

export const VenuePicker = ({ venues, value, onChange, onCreate }: VenuePickerProps) => {
  const [adding, setAdding] = useState(venues.length === 0);
  const [name, setName] = useState('');
  const [isHomeGame, setIsHomeGame] = useState(false);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const trimmed = name.trim();
    if (trimmed === '' || saving) return;
    setSaving(true);
    try {
      const venue = await onCreate(trimmed, isHomeGame);
      onChange(venue.id);
      setName('');
      setIsHomeGame(false);
      setAdding(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <View>
      <View style={styles.chips}>
        {venues.map((venue) => (
          <Chip
            key={venue.id}
            label={venue.name}
            selected={venue.id === value}
            onPress={() => onChange(venue.id)}
          />
        ))}
        {adding ? null : (
          <Chip label="+ New venue" onPress={() => setAdding(true)} />
        )}
      </View>

      {adding ? (
        <View style={styles.form}>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Venue name"
            placeholderTextColor={colors.textTertiary}
            style={styles.input}
            autoFocus={venues.length > 0}
            autoCapitalize="words"
            returnKeyType="done"
            onSubmitEditing={() => void submit()}
            accessibilityLabel="New venue name"
          />
          <View style={styles.formRow}>
            <Chip
              label="Home game"
              selected={isHomeGame}
              onPress={() => setIsHomeGame((current) => !current)}
            />
            <View style={styles.spacer} />
            {venues.length > 0 ? (
              <Button label="Cancel" variant="ghost" size="small" onPress={() => setAdding(false)} />
            ) : null}
            <Button
              label="Add"
              size="small"
              onPress={() => void submit()}
              disabled={name.trim() === ''}
              loading={saving}
            />
          </View>
        </View>
      ) : null}

      {venues.length === 0 && !adding ? (
        <Text variant="caption" color={colors.textTertiary} style={styles.hint}>
          Add the room or home game you’re playing in.
        </Text>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
  form: {
    marginTop: spacing.md,
    gap: spacing.sm,
  },
  formRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  spacer: {
    flex: 1,
  },
  input: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    fontSize: 16,
    minHeight: 48,
    paddingHorizontal: spacing.lg,
    ...Platform.select({ web: { outlineStyle: 'none' as 'solid' }, default: {} }),
  },
  hint: {
    marginTop: spacing.sm,
  },
});
