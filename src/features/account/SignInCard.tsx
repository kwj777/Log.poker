/**
 * Signing in, in two steps, in Settings.
 *
 * An address, then the code that is mailed to it. Never the link: mail opens
 * links in the browser, always, so somebody who tapped one on a phone would be
 * signed in to Safari and come back to an app as signed out as they left it.
 * The code is the same credential in a shape that can be typed into whatever is
 * holding it. See `src/auth/signin.ts`.
 *
 * ## Why this is behind a flag
 *
 * Signing in currently unlocks nothing, because the thing it unlocks is not
 * built. A player who typed their address, waited for mail, read a code off a
 * phone and typed it in would arrive back at a screen that looks exactly as it
 * did before, having gained nothing. That is worse than an absence, so
 * `ALLOW_SIGN_IN` keeps it out of production builds entirely rather than
 * merely hiding it, the same way the demo seeder above it is kept out.
 *
 * What it is for meanwhile is the one thing nothing else can do: prove the
 * whole chain end to end against the live endpoint. Both halves of it are
 * tested against fakes and held together by a written contract, which is
 * exactly the arrangement that produces a bug neither side can see.
 *
 * Turning it on is this one line in `src/config.ts`, when sync lands.
 */

import { useCallback, useEffect, useState } from 'react';
import { Platform, StyleSheet, TextInput, View } from 'react-native';

import { getSession, signIn, signOut, type Session } from '../../auth';
import { redeemCode, requestCode } from '../../auth/signin';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Text } from '../../components/Text';
import { colors, radius, spacing } from '../../theme';
import { CODE_SENT, NOTHING_LEAVES, describeSession, messageFor, type Stage } from './copy';

export const SignInCard = () => {
  const [session, setSession] = useState<Session | null>(null);
  const [stage, setStage] = useState<Stage>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    // A held token is read once on mount. There is nothing to subscribe to:
    // this card is the only thing in the app that can change it.
    void getSession().then(setSession);
  }, []);

  const reset = useCallback(() => {
    setStage('email');
    setCode('');
    setNote(null);
    setProblem(null);
  }, []);

  const ask = async () => {
    setBusy(true);
    setProblem(null);
    setNote(null);
    const asked = await requestCode(email);
    setBusy(false);
    if (!asked.ok) {
      setProblem(messageFor(asked.reason, 'email'));
      return;
    }
    // Conditional, and it has to stay that way: see `copy.ts`.
    setNote(CODE_SENT);
    setStage('code');
  };

  const redeem = async () => {
    setBusy(true);
    setProblem(null);
    const traded = await redeemCode(email, code);
    if (!traded.ok) {
      setBusy(false);
      setProblem(messageFor(traded.reason, 'code'));
      return;
    }

    const held = await signIn(traded.token);
    setBusy(false);
    if (held === null) {
      // A token the server minted and this build cannot read. Not the player's
      // problem to solve and not one more tries will fix, so it is named as
      // ours rather than dressed up as a bad code.
      setProblem('The sign-in answered with something this app could not read.');
      return;
    }
    setSession(held);
    setNote(null);
  };

  const leave = async () => {
    setBusy(true);
    await signOut();
    setSession(null);
    setEmail('');
    reset();
    setBusy(false);
  };

  if (session) {
    return (
      <Card>
        <Text color={colors.textSecondary} style={styles.body}>
          {describeSession(session.syncs)}
        </Text>
        <Text variant="caption" color={colors.textTertiary} style={styles.note}>
          {/* Signing out is not a wipe, and the one place to say so is the
              button that sounds like it might be. */}
          Signing out forgets the token and nothing else. Your log is yours and
          it is already here.
        </Text>
        <Button label="Sign out" variant="secondary" size="medium" onPress={() => void leave()} loading={busy} />
      </Card>
    );
  }

  return (
    <Card>
      <Text color={colors.textSecondary} style={styles.body}>
        {NOTHING_LEAVES}
      </Text>

      {stage === 'email' ? (
        <>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor={colors.textTertiary}
            style={styles.input}
            keyboardType="email-address"
            inputMode="email"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            returnKeyType="send"
            onSubmitEditing={() => void ask()}
            accessibilityLabel="The email address you paid with"
          />
          <Button
            label="Email me a code"
            variant="secondary"
            size="medium"
            onPress={() => void ask()}
            loading={busy}
            disabled={email.trim() === ''}
            style={styles.action}
          />
        </>
      ) : (
        <>
          <TextInput
            value={code}
            onChangeText={setCode}
            placeholder="ABCD-2345"
            placeholderTextColor={colors.textTertiary}
            style={styles.input}
            autoCapitalize="characters"
            autoCorrect={false}
            // One-time codes autofill from the notification on both platforms,
            // which is the difference between reading a code off a lock screen
            // and typing it from memory in a card room.
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
            returnKeyType="done"
            onSubmitEditing={() => void redeem()}
            accessibilityLabel="The code from the email"
          />
          <View style={styles.actions}>
            <Button label="Use another address" variant="ghost" size="small" onPress={reset} />
            <Button
              label="Sign in"
              variant="secondary"
              size="small"
              onPress={() => void redeem()}
              loading={busy}
              disabled={code.trim() === ''}
            />
          </View>
        </>
      )}

      {note ? (
        <Text variant="caption" color={colors.textSecondary} style={styles.note}>
          {note}
        </Text>
      ) : null}
      {problem ? (
        <Text variant="caption" color={colors.danger} style={styles.note}>
          {problem}
        </Text>
      ) : null}
    </Card>
  );
};

const styles = StyleSheet.create({
  body: {
    lineHeight: 23,
    marginBottom: spacing.lg,
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
  action: {
    marginTop: spacing.md,
  },
  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  note: {
    marginTop: spacing.md,
    lineHeight: 18,
  },
});
