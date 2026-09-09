/**
 * Signing in, in two steps, in Settings.
 *
 * An address, then the code that is mailed to it. Never the link: mail opens
 * links in the browser, always, so somebody who tapped one on a phone would be
 * signed in to Safari and come back to an app as signed out as they left it.
 * The code is the same credential in a shape that can be typed into whatever is
 * holding it. See `src/auth/signin.ts`.
 *
 * ## Why this is still behind a flag
 *
 * It was behind one because signing in unlocked nothing: a player who typed
 * their address, waited for mail, read a code off a phone and typed it in
 * arrived back at a screen that looked exactly as it did before. That is worse
 * than an absence.
 *
 * It is not that any more. `ALLOW_SIGN_IN` is `true`, and the flag stays for
 * the other reason: `/api/signin` mails a code to anybody who types an
 * address, and a door like that wants a switch. Turning it off strips this
 * card from the build rather than hiding it, and the endpoint's own limits
 * hold in the meantime.
 *
 * What the flag bought while it was off was the one thing nothing else could
 * do: proving the whole chain end to end against the live endpoint. Both
 * halves are tested against fakes and held together by a written contract,
 * which is exactly the arrangement that produces a bug neither side can see,
 * and running it for real is what retired the argument for keeping this dark.
 */

import { useCallback, useEffect, useState } from 'react';
import { Platform, StyleSheet, TextInput, View } from 'react-native';

import { getSession, getToken, signIn, signOut, type Session } from '../../auth';
import { getSyncingRepository, recomposeRepository, type SyncState } from '../../data';
import { redeemCode, requestCode } from '../../auth/signin';
import { eraseRemote } from '../../sync/client';
import { Button } from '../../components/Button';
import { Card } from '../../components/Card';
import { Text } from '../../components/Text';
import { colors, radius, spacing } from '../../theme';
import {
  CODE_SENT,
  ERASE_CONFIRM,
  ERASE_DONE,
  ERASE_EXPLAINS,
  ERASE_FAILED,
  NOTHING_LEAVES,
  describeSession,
  describeSync,
  messageFor,
  type Stage,
} from './copy';

export const SignInCard = () => {
  const [session, setSession] = useState<Session | null>(null);
  const [stage, setStage] = useState<Stage>('email');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const [syncState, setSyncState] = useState<SyncState | null>(null);
  const [confirmingErase, setConfirmingErase] = useState(false);

  useEffect(() => {
    // A held token is read once on mount. There is nothing to subscribe to:
    // this card is the only thing in the app that can change it.
    void getSession().then(setSession);
  }, []);

  useEffect(() => {
    // The sync state does change under this card, on every write anywhere in
    // the app, so this one is a subscription rather than a read.
    let drop: (() => void) | undefined;
    void getSyncingRepository().then((repository) => {
      if (!repository) return;
      setSyncState(repository.current());
      drop = repository.subscribe(setSyncState);
    });
    return () => drop?.();
  }, [session]);

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
    // The data layer composed itself before there was a token to compose with,
    // so it is holding the plain local repository. Nothing syncs until it is
    // asked again.
    recomposeRepository();
    setSession(held);
    setNote(null);
  };

  const leave = async () => {
    setBusy(true);
    // Before the token goes, and through the wrapper rather than around it, so
    // a sync already in flight is fenced and cannot write the old cursors back
    // afterwards. Without this the next person to sign in on this device
    // inherits them and is served the tail of their own history. See
    // `SyncingRepository.forget`.
    await (await getSyncingRepository())?.forget();
    await signOut();
    recomposeRepository();
    setSession(null);
    setEmail('');
    reset();
    setBusy(false);
  };

  /**
   * Delete the server's copy, then sign out.
   *
   * **In that order, and only in that order.** Signing out first would mean a
   * failed deletion left somebody signed out, told nothing was erased, and
   * unable to ask again without signing back in. Erasing first means the worst
   * outcome is a session that is still there and a button that can be pressed
   * again, which is the failure worth having.
   *
   * The cost of that order is a window between the two where a write could push
   * the log back up and rebuild the bucket. It needs a write landing inside a
   * few hundred milliseconds of this tap, on a screen with nothing to write
   * from, and the alternative is the broken promise above.
   */
  const erase = async () => {
    setBusy(true);
    setProblem(null);
    const token = await getToken();
    const gone = token === null ? false : await eraseRemote(token);
    if (!gone) {
      setProblem(ERASE_FAILED);
      setConfirmingErase(false);
      setBusy(false);
      return;
    }
    // The bucket is gone; now so is this device's memory of having filled it.
    // `pushed` said the whole log had been sent, so signing in again pushed
    // nothing and the emptied bucket stayed empty for good.
    await (await getSyncingRepository())?.forget();
    await signOut();
    recomposeRepository();
    setSession(null);
    setEmail('');
    setConfirmingErase(false);
    reset();
    setNote(ERASE_DONE);
    setBusy(false);
  };

  if (session) {
    return (
      <Card>
        <Text color={colors.textSecondary} style={styles.body}>
          {describeSession(session.syncs)}
        </Text>
        {syncState ? (
          <Text
            variant="caption"
            color={syncState.problem ? colors.danger : colors.textTertiary}
            style={styles.note}
          >
            {describeSync(syncState)}
          </Text>
        ) : null}
        <Text variant="caption" color={colors.textTertiary} style={styles.note}>
          {/* Signing out is not a wipe, and the one place to say so is the
              button that sounds like it might be. */}
          Signing out forgets the token and nothing else. Your log is yours and
          it is already here.
        </Text>
        <Button label="Sign out" variant="secondary" size="medium" onPress={() => void leave()} loading={busy} />

        {confirmingErase ? (
          <>
            <Text variant="caption" color={colors.textSecondary} style={styles.note}>
              {ERASE_CONFIRM}
            </Text>
            <View style={styles.actions}>
              <Button
                label="Cancel"
                variant="secondary"
                size="small"
                onPress={() => setConfirmingErase(false)}
              />
              <Button
                label="Erase and sign out"
                variant="danger"
                size="small"
                onPress={() => void erase()}
                loading={busy}
              />
            </View>
          </>
        ) : (
          <>
            <Text variant="caption" color={colors.textTertiary} style={styles.note}>
              {ERASE_EXPLAINS}
            </Text>
            <Button
              label="Erase the copy on the server"
              variant="ghost"
              size="small"
              onPress={() => setConfirmingErase(true)}
              style={styles.action}
            />
          </>
        )}

        {problem ? (
          <Text variant="caption" color={colors.danger} style={styles.note}>
            {problem}
          </Text>
        ) : null}
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
