/**
 * "More from the family".
 *
 * Log, Untilt and TiltProof are three answers to the same problem — Log records
 * what happened, Untilt deals with how it felt, TiltProof drills what to do
 * differently. The cross-promo is deliberately quiet: one card, no badges, no
 * interstitials. A tracker that nags you to buy the other apps is the exact
 * cluttered thing this category is already full of.
 */

import { Linking, StyleSheet, View, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

import { Card } from '../../components/Card';
import { Text } from '../../components/Text';
import { FAMILY_LINKS } from '../../config';
import { colors, radius, spacing } from '../../theme';

export type FamilyApp = 'log' | 'untilt' | 'tiltproof';

interface FamilyEntry {
  key: FamilyApp;
  name: string;
  tagline: string;
  url: string;
  icon: React.ComponentProps<typeof Ionicons>['name'];
}

const FAMILY: readonly FamilyEntry[] = [
  {
    key: 'log',
    name: 'Log',
    tagline: 'The session log that keeps you off tilt.',
    url: FAMILY_LINKS.log,
    icon: 'stats-chart',
  },
  {
    key: 'untilt',
    name: 'Untilt.poker',
    tagline: 'Mental game work for the sessions that get to you.',
    url: FAMILY_LINKS.untilt,
    icon: 'heart-outline',
  },
  {
    key: 'tiltproof',
    name: 'TiltProof',
    tagline: 'Odds and spot training, so the maths is automatic.',
    url: FAMILY_LINKS.tiltproof,
    icon: 'flash-outline',
  },
];

interface FamilyCrossPromoProps {
  exclude?: readonly FamilyApp[];
  style?: ViewStyle;
}

export const FamilyCrossPromo = ({ exclude = [], style }: FamilyCrossPromoProps) => {
  const entries = FAMILY.filter((entry) => !exclude.includes(entry.key));
  if (entries.length === 0) return null;

  return (
    <View style={style}>
      <Text variant="overline" color={colors.textTertiary} style={styles.heading}>
        More from the family
      </Text>
      <Card style={styles.card}>
        {entries.map((entry, index) => (
          <Card
            key={entry.key}
            onPress={() => void Linking.openURL(entry.url)}
            accessibilityLabel={`Open ${entry.name}`}
            style={[
              styles.row,
              index === entries.length - 1 ? styles.lastRow : null,
            ] as unknown as ViewStyle}
          >
            <View style={styles.rowInner}>
              <View style={styles.icon}>
                <Ionicons name={entry.icon} size={18} color={colors.accent} />
              </View>
              <View style={styles.body}>
                <Text variant="bodyStrong">{entry.name}</Text>
                <Text variant="caption" color={colors.textTertiary}>
                  {entry.tagline}
                </Text>
              </View>
              <Ionicons name="open-outline" size={16} color={colors.textTertiary} />
            </View>
          </Card>
        ))}
      </Card>
    </View>
  );
};

const styles = StyleSheet.create({
  heading: {
    marginBottom: spacing.sm,
  },
  card: {
    paddingVertical: 0,
    paddingHorizontal: 0,
  },
  row: {
    backgroundColor: 'transparent',
    borderWidth: 0,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    borderRadius: 0,
    paddingVertical: spacing.lg,
    paddingHorizontal: spacing.lg,
  },
  lastRow: {
    borderBottomWidth: 0,
  },
  rowInner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  icon: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accentDim,
  },
  body: {
    flex: 1,
    gap: 2,
  },
});
