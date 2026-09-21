/**
 * Venue selection, with inline creation.
 *
 * Venues are sorted most-played first, so a regular's room is always the first
 * chip. Adding one never leaves the screen -- a player standing at a new table
 * should not have to navigate into settings to log where they are.
 *
 * ## Typing a room you already have picks it instead of adding a second one
 *
 * This is the only place a person creates a venue, and it used to hand
 * whatever was typed straight to `onCreate`. So "aria" on a night the chip
 * said "Aria" made a second room, and from then on the dashboard had two rows
 * for one place and the bankroll was split between them. The importer has
 * folded names since it shipped, for exactly this reason; `domain/venues` is
 * that rule where both can reach it.
 *
 * Selecting rather than warning, because there is no decision to put in front
 * of somebody at a table: they meant the room they already have. The line
 * underneath says what happened, so it does not read as the Add button having
 * been ignored.
 */

import { useState } from 'react';
import { Platform, StyleSheet, TextInput, View } from 'react-native';

import { Button } from '../../components/Button';
import { Chip } from '../../components/Chip';
import { Text } from '../../components/Text';
import { findVenueNamed } from '../../domain/venues';
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
  /** The room that was already there, said once after picking it. */
  const [matched, setMatched] = useState<string | null>(null);

  /** Shown live, so the Add button says what it is about to do before it is pressed. */
  const existing = findVenueNamed(venues, name);

  const done = (venue: Venue) => {
    onChange(venue.id);
    setName('');
    setIsHomeGame(false);
    setAdding(false);
  };

  const submit = async () => {
    const trimmed = name.trim();
    if (trimmed === '' || saving) return;
    if (existing !== null) {
      // Their room, under whatever casing they typed this time.
      setMatched(existing.name);
      done(existing);
      return;
    }
    setSaving(true);
    setMatched(null);
    try {
      done(await onCreate(trimmed, isHomeGame));
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
              label={existing === null ? 'Add' : 'Use it'}
              size="small"
              onPress={() => void submit()}
              disabled={name.trim() === ''}
              loading={saving}
            />
          </View>
          {existing !== null ? (
            <Text variant="caption" color={colors.textTertiary}>
              {existing.name} is already in your log.
            </Text>
          ) : null}
        </View>
      ) : null}

      {matched !== null && !adding ? (
        <Text variant="caption" color={colors.textTertiary} style={styles.hint}>
          Picked {matched}, which was already in your log.
        </Text>
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
