/**
 * Where a purchase made at another one of the family's apps lands.
 *
 * One purchase covers all three, and `log.poker`, `untilt.poker` and
 * `tiltproof.poker` are three registrable domains: no cookie crosses them and
 * no storage is shared. Untilt redirects here with a one-time code in the URL
 * fragment; this trades it for a token and signs the person in as themselves.
 * `src/auth/handoff.ts` is the exchange, and Untilt's `HANDOFF.md` is the
 * protocol.
 *
 * ## The order of the first three lines matters
 *
 * Read the fragment, replace the URL, then do anything else. A fragment is
 * never sent to a server, so the code is in nobody's access log -- but it is
 * in this tab's history until the URL is replaced, and a back button or a
 * shared screen is enough. Replacing first means the only copy left is the one
 * in memory, and it is spent seconds later.
 *
 * It is done before the exchange rather than after, deliberately. A failed
 * exchange must not leave the code in the URL either: it is dead by then, and
 * leaving a dead credential in somebody's history buys nothing.
 *
 * ## Nothing here signs anybody out
 *
 * Every way this can fail leaves the device exactly as it was, which for most
 * people is signed out, with the ordinary sign-in one screen away. The one
 * case that changes anything already held is a hand-off for a *different*
 * person, and that one asks first: on this side a change of subject is a
 * change of bucket, so swapping quietly would move somebody's history out from
 * under them with nothing on screen to say so.
 *
 * ## Web only
 *
 * A code in a URL fragment is a browser mechanism. `HANDOFF.md` says in as
 * many words that native has its own way across and its own threat model, and
 * neither is this. On a phone this route says so rather than spinning.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';

import { getSession, signIn } from '../src/auth';
import { claimHandoff, codeFromFragment } from '../src/auth/handoff';
import { getRepository, recomposeRepository } from '../src/data';
import { Button } from '../src/components/Button';
import { Card } from '../src/components/Card';
import { PageMeta } from '../src/components/PageMeta';
import { Screen } from '../src/components/Screen';
import { Text } from '../src/components/Text';
import {
  handoffFailed,
  handoffWouldAdopt,
  handoffWouldSwitch,
} from '../src/features/account/copy';
import { spacing } from '../src/theme';

type Stage =
  /** Reading the fragment and trading it. Nothing has changed yet. */
  | { kind: 'working' }
  /**
   * A hand-off this device should not take without being asked. Held in
   * memory, not stored, until it is.
   *
   * `switch` is a device already signed in as somebody else. `adopt` is one
   * signed in as nobody with a log of its own, which is the same question
   * pointing the other way: see the effect below.
   */
  | { kind: 'asking'; token: string; because: 'switch' | 'adopt' }
  | { kind: 'done' }
  | { kind: 'failed'; message: string };

/**
 * The code, taken out of the URL and out of history in one step.
 *
 * `replaceState` rather than assigning to `location.hash`, which would leave a
 * `#` behind and push an entry. Wrapped because a browser that refuses it is
 * not a reason to abandon the hand-off -- the code is still spent seconds
 * later either way, and a history entry is the smaller harm.
 */
const takeCode = (): string | null => {
  if (Platform.OS !== 'web' || typeof window === 'undefined') return null;

  const code = codeFromFragment(window.location.hash || '');
  try {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  } catch {
    /* Left in the URL. Dead in ninety seconds regardless. */
  }
  return code;
};

export default function ClaimScreen() {
  const [stage, setStage] = useState<Stage>({ kind: 'working' });

  // Strict mode mounts effects twice in development, and this one spends a
  // single-use credential. Without the guard the second pass trades a code the
  // first pass already spent, and the screen reports a failed hand-off on a
  // hand-off that worked.
  const started = useRef(false);

  /** Store the token and go. The data layer is holding the plain local
   *  repository, composed before there was a token to compose with, so it is
   *  asked again before anything can sync. `SignInCard` does the same. */
  const keep = useCallback(async (token: string) => {
    const held = await signIn(token);
    if (held === null) {
      // A token Untilt minted and this build cannot read. Not the player's
      // problem and not one more try will fix it, so it is named as ours.
      setStage({
        kind: 'failed',
        message: 'The hand-off answered with something this app could not read.',
      });
      return;
    }
    recomposeRepository();
    setStage({ kind: 'done' });
    router.replace('/');
  }, []);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    // Every branch inside the async body rather than beside it. Two of them
    // settle without waiting for anything, and doing that synchronously here
    // would be setting state directly in an effect; the screen renders
    // `working` for a tick either way, because that is what it is doing.
    void (async () => {
      if (Platform.OS !== 'web') {
        setStage({
          kind: 'failed',
          message:
            'Signing in from a link like this happens in a browser. Open it there, or sign in ' +
            'below.',
        });
        return;
      }

      const code = takeCode();
      if (code === null) {
        setStage({
          kind: 'failed',
          message:
            'There is nothing to sign in with on this link. Sign in below and this device picks ' +
            'up where your account left off.',
        });
        return;
      }

      const traded = await claimHandoff(code);
      if (!traded.ok) {
        setStage({ kind: 'failed', message: handoffFailed(traded.reason) });
        return;
      }

      // Somebody else already signed in here. Asked rather than swapped: the
      // sessions this device syncs live under whoever it is signed in as. The
      // token is held in memory and stored only if they say yes -- and the
      // code is spent either way, which is correct, because a hand-off that
      // was offered and declined is one that happened.
      const held = await getSession();
      if (held !== null) {
        setStage({ kind: 'asking', token: traded.token, because: 'switch' });
        return;
      }

      // **And a device signed in as nobody, with a log already on it.**
      //
      // The same question pointing the other way, and it was not being asked.
      // A first sign-in is `cursors.subject === null`, which `settle` answers
      // with `pushed: 0`: send everything, from the beginning. That is right
      // for a sign-in somebody chose, where the log on this device is theirs
      // and joining their account is the point. It is exactly wrong for a link
      // somebody else sent, because the account at the other end is theirs,
      // and what goes up is every session on this device.
      //
      // Nothing here can tell those apart, so the log is what decides. An
      // empty device has nothing to lose and takes the link silently, which is
      // the ordinary way in and the whole point of this screen. A device with
      // sessions on it gets asked first, because a push into somebody else's
      // bucket is not something this side can take back.
      const repository = await getRepository();
      if ((await repository.listSessions({ limit: 1 })).length > 0) {
        setStage({ kind: 'asking', token: traded.token, because: 'adopt' });
        return;
      }

      await keep(traded.token);
    })();
  }, [keep]);

  return (
    <Screen>
      <PageMeta title="Signing you in · Log" />
      <Card>
        {stage.kind === 'working' ? (
          <Text>Signing you in&#8230;</Text>
        ) : null}

        {stage.kind === 'done' ? <Text>Done. Opening your log&#8230;</Text> : null}

        {stage.kind === 'asking' ? (
          <View style={styles.stack}>
            <Text>
              {stage.because === 'switch' ? handoffWouldSwitch : handoffWouldAdopt}
            </Text>
            <Button
              label={
                stage.because === 'switch' ? 'Switch to that account' : 'Sign in to that account'
              }
              onPress={() => void keep(stage.token)}
            />
            <Button
              label={stage.because === 'switch' ? 'Keep this one' : 'Leave this device as it is'}
              variant="ghost"
              onPress={() => router.replace('/')}
            />
          </View>
        ) : null}

        {stage.kind === 'failed' ? (
          <View style={styles.stack}>
            <Text>{stage.message}</Text>
            <Button label="Open your log" onPress={() => router.replace('/')} />
          </View>
        ) : null}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  stack: { gap: spacing.md },
});
