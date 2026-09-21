/**
 * One venue in Settings, and the two things that could not be done to it.
 *
 * A venue is free text typed once, at a table, usually one-handed, and it was
 * write-once from then on. `renameVenue` had existed in the store since venues
 * did and had no caller anywhere outside its own unit test, so a typo was
 * permanent. Removing one is refused while anything is logged against it --
 * which is right, and meant a misspelled room with a single session behind it
 * stayed on the dashboard forever.
 *
 * ## Rename, and the rename that is really a merge
 *
 * Renaming "Aria High Limt" is the common case and is one field. Renaming it
 * to a name another venue already has is not a rename at all: two rows cannot
 * be one row by being called the same thing, and letting it through would
 * produce exactly the split log that `domain/venues` exists to prevent. So
 * that case offers the merge instead, which is what somebody typing it meant.
 *
 * ## Merge asks first
 *
 * It moves every session off one venue and removes it, and nothing in this app
 * undoes anything. The count is in the question because it is the number that
 * tells somebody whether they picked the row they meant.
 */

import { useState } from 'react';
import { Platform, StyleSheet, TextInput, View } from 'react-native';

import { Button } from '../../components/Button';
import { Chip } from '../../components/Chip';
import { Text } from '../../components/Text';
import { findVenueNamed } from '../../domain/venues';
import type { Venue } from '../../domain/types';
import { colors, radius, spacing } from '../../theme';

interface VenueRowProps {
  venue: Venue;
  /** Every other venue: merge targets, and what a new name could collide with. */
  others: readonly Venue[];
  busy: boolean;
  /** Each reports its own failure and answers whether the row should close. */
  onRename: (id: string, name: string) => Promise<boolean>;
  onMerge: (fromId: string, into: Venue) => Promise<boolean>;
  onRemove: (id: string) => Promise<boolean>;
}

export const VenueRow = ({
  venue,
  others,
  busy,
  onRename,
  onMerge,
  onRemove,
}: VenueRowProps) => {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(venue.name);
  /** The venue picked to merge into, held until the question is answered. */
  const [mergeInto, setMergeInto] = useState<Venue | null>(null);

  const open = () => {
    setName(venue.name);
    setMergeInto(null);
    setEditing(true);
  };

  const close = () => {
    setEditing(false);
    setMergeInto(null);
  };

  const trimmed = name.trim();
  /** A different venue already under this name, which makes this a merge. */
  const collides = findVenueNamed(others, trimmed);
  const unchanged = trimmed === venue.name;
  const canSave = trimmed !== '' && !unchanged && collides === null;

  const rename = async () => {
    if (!canSave) return;
    if (await onRename(venue.id, trimmed)) close();
  };

  const merge = async (into: Venue) => {
    if (await onMerge(venue.id, into)) close();
  };

  const remove = async () => {
    if (await onRemove(venue.id)) close();
  };

  const caption = `${venue.isHomeGame ? 'Home game · ' : ''}${venue.sessionCount} session${
    venue.sessionCount === 1 ? '' : 's'
  }`;

  if (!editing) {
    return (
      <View style={styles.row}>
        <View style={styles.body}>
          <Text variant="bodyStrong" numberOfLines={1}>
            {venue.name}
          </Text>
          <Text variant="caption" color={colors.textTertiary}>
            {caption}
          </Text>
        </View>
        <Button
          label="Edit"
          variant="ghost"
          size="small"
          accessibilityLabel={`Edit ${venue.name}`}
          onPress={open}
        />
      </View>
    );
  }

  if (mergeInto !== null) {
    return (
      <View style={styles.editor}>
        <Text variant="bodyStrong">
          Move {venue.sessionCount} session{venue.sessionCount === 1 ? '' : 's'} to{' '}
          {mergeInto.name}?
        </Text>
        <Text variant="caption" color={colors.textTertiary}>
          {venue.name} is removed afterwards. This cannot be undone.
        </Text>
        <View style={styles.actions}>
          <Button label="Cancel" variant="ghost" size="small" onPress={() => setMergeInto(null)} />
          <Button
            label="Merge"
            variant="danger"
            size="small"
            disabled={busy}
            onPress={() => void merge(mergeInto)}
          />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.editor}>
      <TextInput
        value={name}
        onChangeText={setName}
        placeholder="Venue name"
        placeholderTextColor={colors.textTertiary}
        style={styles.input}
        autoCapitalize="words"
        returnKeyType="done"
        onSubmitEditing={() => void rename()}
        accessibilityLabel={`Name for ${venue.name}`}
      />

      {collides !== null ? (
        <Text variant="caption" color={colors.textTertiary}>
          {collides.name} is already in your log. Two rooms cannot share a name, but they can
          be one room.
        </Text>
      ) : null}

      <View style={styles.actions}>
        {venue.sessionCount === 0 ? (
          <Button
            label="Remove"
            variant="ghost"
            size="small"
            disabled={busy}
            onPress={() => void remove()}
          />
        ) : null}
        <View style={styles.spacer} />
        <Button label="Cancel" variant="ghost" size="small" onPress={close} />
        {collides !== null ? (
          <Button
            label={`Merge into ${collides.name}`}
            size="small"
            disabled={busy}
            onPress={() => setMergeInto(collides)}
          />
        ) : (
          <Button
            label="Save"
            size="small"
            disabled={!canSave || busy}
            onPress={() => void rename()}
          />
        )}
      </View>

      {/*
        The other way in. Renaming into a collision is how somebody who did not
        know merge existed arrives at it; this is for somebody who does, and who
        does not want to type the other room's name exactly to get there.
      */}
      {others.length > 0 ? (
        <View style={styles.merge}>
          <Text variant="caption" color={colors.textTertiary}>
            Or fold this room into another one:
          </Text>
          <View style={styles.chips}>
            {others.map((other) => (
              <Chip
                key={other.id}
                label={other.name}
                onPress={() => setMergeInto(other)}
              />
            ))}
          </View>
        </View>
      ) : null}
    </View>
  );
};

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.md,
  },
  body: {
    flex: 1,
    gap: 2,
  },
  editor: {
    gap: spacing.sm,
    paddingVertical: spacing.sm,
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
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  spacer: {
    flex: 1,
  },
  merge: {
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  chips: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
  },
});
