/**
 * Where a link that names nothing lands.
 *
 * ## Why this exists
 *
 * `app.json` declares `"scheme": "logpoker"`, so the operating system will
 * hand this app any `logpoker://...` URL somebody taps, and the web build
 * answers every path under `/app`. Neither of those checks first that the
 * path is one of ours. Without this file, a URL that resolves to no route at
 * all fell through to the framework's own unmatched screen -- which is a
 * developer's debugging aid, drawn in the framework's default styling rather
 * than this app's, and it says "Unmatched Route" to somebody who tapped a link
 * in a message from a friend.
 *
 * The cases are ordinary: a link typed by hand with a letter missing, a link
 * from an older build to a screen that has been renamed since, a session id in
 * a bookmark for a session that has been deleted, and anything a share sheet
 * or a chat app mangles on the way past. All of those now land somewhere that
 * looks like Log and has the way back on it.
 *
 * ## What is deliberately not here
 *
 * Universal links -- `https://log.poker/app/...` opening the app rather than
 * the browser -- are not declared, because they are only half a client-side
 * change. They need an `apple-app-site-association` and an `assetlinks.json`
 * served from the domain itself, and declaring the app half without the server
 * half produces links that silently keep opening the browser. That is a
 * deploy, not a file in this repository.
 *
 * The same goes for the hand-off: `claim.tsx` is web-only on purpose, and
 * `HANDOFF.md` says native has its own way across and its own threat model.
 * Accepting a one-time credential off a custom-scheme URL is a protocol
 * decision, not a routing one.
 */

import { StyleSheet, View } from 'react-native';
import { Stack, router, usePathname } from 'expo-router';

import { Button } from '../src/components/Button';
import { PageMeta } from '../src/components/PageMeta';
import { Screen } from '../src/components/Screen';
import { Text } from '../src/components/Text';
import { colors, spacing } from '../src/theme';

export default function NotFoundScreen() {
  // Shown, because it is the one thing anybody can act on: a person reporting
  // a link that does not work can say which link, and a person who typed it
  // can see where the letter went missing.
  const pathname = usePathname();

  return (
    <Screen>
      {/* The tab bar is not under this route, so the title is its own. */}
      <Stack.Screen options={{ title: 'Not found · Log' }} />
      <PageMeta title="Not found · Log" />
      <View style={styles.body}>
        <Text variant="title" center>
          That link goes nowhere
        </Text>
        <Text color={colors.textSecondary} center style={styles.detail}>
          Nothing in Log answers {pathname}. It may have been a link from an older version, or a
          session that has since been deleted.
        </Text>
        <Button label="Open your log" onPress={() => router.replace('/')} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: {
    paddingTop: spacing.xxxl,
    gap: spacing.lg,
  },
  detail: {
    lineHeight: 22,
  },
});
