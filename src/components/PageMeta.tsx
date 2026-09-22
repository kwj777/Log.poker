/**
 * Per-screen document metadata.
 *
 * Expo Router manages the document head through react-helmet, which renders its
 * own `<title>` element ahead of anything written in `+html.tsx`. `document.title`
 * resolves to the *first* title in the head, so a static title in the shell is
 * silently overridden by helmet's empty one -- the browser tab ends up blank.
 * Setting it here is what actually reaches the tab, the bookmark and the
 * pre-rendered HTML.
 *
 * **On a phone this renders nothing, on purpose.** `expo-router/head` is two
 * unrelated components behind one import: react-helmet on the web, and on iOS a
 * registrar for the NSUserActivity that drives Handoff and Spotlight. The native
 * half reads a `origin` out of the Expo config, and with none set it shows the
 * player an alert reading "Expo Head: Add the handoff origin to the Expo
 * Config", from inside a render, for every focused screen carrying one of these.
 *
 * Nothing short of a standalone build can see that. `ExpoHeadModule` is left
 * unset in Expo Go by an explicit check for it, and is unset under Jest because
 * no native module is loaded, and in both cases the import falls back to a shim
 * that renders null. The alert is also the production branch of the code: a
 * development bundle throws instead. So the one build that reaches it is the
 * kind that goes to an app store.
 *
 * Setting the origin is not the fix. Expo Head strips the path off whatever it
 * is given, so the most it can carry is `https://log.poker`, while this app is
 * served from `/app` on that host. Every URL it handed to a Mac would be
 * `https://log.poker/history` rather than `https://log.poker/app/history`, which
 * is a page that does not exist. Handing somebody a 404 is worse than handing
 * them nothing, so the native half stays off until those URLs can be right.
 */

import Head from 'expo-router/head';
import { Platform } from 'react-native';

interface PageMetaProps {
  title: string;
  description?: string;
}

export const PageMeta = ({ title, description }: PageMetaProps) => {
  if (Platform.OS !== 'web') return null;

  return (
    <Head>
      <title>{title}</title>
      {description === undefined ? null : <meta name="description" content={description} />}
    </Head>
  );
};

export const APP_DESCRIPTION =
  'A poker session tracker and hand journal for live cash game and home game players. Log sessions in seconds, track your true hourly rate, and see whether a rough stretch is really outside normal variance.';
