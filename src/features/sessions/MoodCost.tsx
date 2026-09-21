/**
 * What arriving rattled costs, said only when the record actually says it.
 *
 * The number comes from `domain/mood.ts`, which groups sessions by the score
 * logged *before* the cards rather than after, and refuses to report a gap that
 * is inside the noise. This is the screen half, and it has one job beyond
 * rendering: **not becoming an advertisement**.
 *
 * That is a live risk here in a way it is not elsewhere in the app. The card
 * has an Untilt hand-off under it, so there is a standing incentive for the
 * copy to find tilt expensive. Three of the four states below therefore say
 * some version of *no* and show no hand-off at all, including the state where
 * the comparison settles in the other direction and the player's rattled
 * sessions are their better ones. An analysis that only speaks when it supports
 * the upsell is an advertisement wearing a lab coat, and the front door of this
 * site makes a specific promise about not doing that.
 */

import { StyleSheet, View } from 'react-native';

import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { SectionHeader } from '../../components/SectionHeader';
import { Text } from '../../components/Text';
import {
  MIN_HOURS_PER_GROUP,
  MIN_SESSIONS_PER_GROUP,
  worthActingOn,
  type MoodComparison,
} from '../../domain/mood';
import { colors, spacing } from '../../theme';
import { openLink } from '../family/hooks';
import { untiltHandOff } from '../family/links';

const rate = (bbPerHour: number): string => `${Math.abs(bbPerHour).toFixed(1)} bb/hr`;

const round = (value: number): string => Math.round(value).toLocaleString('en-US');

/**
 * The line under every state, because the grouping is the surprising part.
 *
 * Somebody reading a number about mood assumes it came from how the session
 * felt. It came from how the session *started*, and that difference is the
 * reason the number is worth anything: the end-of-session score is downstream
 * of the result, so a split on it would mostly report that losing feels bad.
 */
const Basis = () => (
  <Text variant="caption" color={colors.textTertiary} style={styles.basis}>
    Grouped by the mood you logged before the cards, never the one after. The
    score at the end of a session is partly the session’s doing, so it cannot
    say anything about what you brought to it.
  </Text>
);

export const MoodCost = ({ comparison }: { comparison: MoodComparison }) => {
  const { steady, rattled, differenceBbPerHour, settled, blocker, hoursNeeded } = comparison;

  // Nothing logged that can be measured at all. No card: an empty state here
  // would be a prompt to go and generate data for a feature, which is the
  // wrong way round.
  if (blocker === 'no-data') return null;

  const body = (): React.ReactNode => {
    if (settled && differenceBbPerHour !== null && differenceBbPerHour < 0) {
      const total = Math.abs(differenceBbPerHour) * rattled.hours;
      return (
        <>
          <Text color={colors.textSecondary} style={styles.body}>
            Sessions you started rattled run{' '}
            <Text variant="bodyStrong" color={colors.loss}>
              {rate(differenceBbPerHour)} below
            </Text>{' '}
            the ones you started calm. Across the {round(rattled.hours)} hours you
            have played that way, that is about{' '}
            <Text variant="bodyStrong" color={colors.text}>
              {round(total)} big blinds
            </Text>
            .
          </Text>
          <Basis />
        </>
      );
    }

    if (settled && differenceBbPerHour !== null) {
      // The direction nobody expects, reported anyway. Suppressing it would
      // make every other state a sales pitch by omission.
      return (
        <>
          <Text color={colors.textSecondary} style={styles.body}>
            Sessions you started rattled run{' '}
            <Text variant="bodyStrong" color={colors.text}>
              {rate(differenceBbPerHour)} above
            </Text>{' '}
            the ones you started calm. That is not what anyone expects and it is
            what your own record says. Whatever is costing you, on this evidence
            it is not the state you sit down in.
          </Text>
          <Basis />
        </>
      );
    }

    if (blocker === 'thin-steady' || blocker === 'thin-rattled') {
      return (
        <>
          <Text color={colors.textSecondary} style={styles.body}>
            Not enough to compare yet. You have logged{' '}
            <Text variant="bodyStrong" color={colors.text}>
              {steady.sessions}
            </Text>{' '}
            session{steady.sessions === 1 ? '' : 's'} started calm and{' '}
            <Text variant="bodyStrong" color={colors.text}>
              {rattled.sessions}
            </Text>{' '}
            started rattled. This needs {MIN_SESSIONS_PER_GROUP} sessions and{' '}
            {MIN_HOURS_PER_GROUP} hours on each side before either number means
            anything.
          </Text>
          <Basis />
        </>
      );
    }

    // Both groups are there and the gap is inside the noise. The refusal leads
    // and the number follows, rather than the other way round: a gap read first
    // and disclaimed second is a gap somebody acts on.
    return (
      <>
        <Text color={colors.textSecondary} style={styles.body}>
          Nothing to report yet. The gap between your calm and rattled sessions
          is inside the noise, which at your swings means a difference this size
          turns up often enough by chance that it is not worth acting on.
          {differenceBbPerHour !== null ? (
            <>
              {' '}
              For the record it currently runs {rate(differenceBbPerHour)}{' '}
              {differenceBbPerHour < 0 ? 'below' : 'above'}.
            </>
          ) : null}
          {hoursNeeded !== null ? (
            <> Another {round(hoursNeeded)} hours or so on the thinner side would settle it.</>
          ) : null}
        </Text>
        <Basis />
      </>
    );
  };

  // The hand-off only ever appears behind a settled finding pointing the wrong
  // way. Not behind a maybe, and not behind a refusal. The condition lives in
  // the domain so that something can test it; see `worthActingOn`.
  const offerUntilt = worthActingOn(comparison);

  return (
    <>
      <SectionHeader title="What tilt costs you" />
      <Card>
        {body()}
        {offerUntilt ? (
          <View style={styles.action}>
            <Text variant="caption" color={colors.textTertiary} style={styles.actionHint}>
              Knowing that is one thing. Doing something about it before you sit
              down is the other.
            </Text>
            <Button
              label={untiltHandOff().label}
              variant="secondary"
              size="medium"
              onPress={() => openLink(untiltHandOff().url)}
            />
          </View>
        ) : null}
      </Card>
    </>
  );
};

const styles = StyleSheet.create({
  body: {
    lineHeight: 22,
  },
  basis: {
    marginTop: spacing.md,
    lineHeight: 18,
  },
  action: {
    marginTop: spacing.lg,
    gap: spacing.sm,
  },
  actionHint: {
    lineHeight: 18,
  },
});
