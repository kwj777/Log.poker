/**
 * Leaving the app, which is the half that needs a platform.
 *
 * The URLs themselves are in `links.ts` and are pure. This file exists only
 * because opening one needs `Linking`, and that import is what keeps a module
 * out of the Node test runner; see the header over there.
 *
 * Named for the act rather than for the hand-off it was written for. The
 * hand-offs all came through here and three other links did not -- the two in
 * Settings and the cross-promo rows, which is the exact case the catch below
 * describes -- and a helper the callers who need it do not recognize is a
 * helper half the callers skip.
 */

import { Linking } from 'react-native';

/**
 * Open a URL outside the app, and do not care whether it worked.
 *
 * **The catch is the whole point.** `openURL` rejects when nothing on the
 * device handles the scheme, which is an ordinary state rather than a bug: a
 * phone with no mail app set up, a browser blocking a pop-up, a tablet with no
 * default browser. A bare call leaves that rejection unhandled, which is a red
 * box in development and nothing at all in a shipped build -- and either way
 * the player has already been told what they need to know by the screen, which
 * prints the support address beside the button for this reason.
 */
export const openLink = (url: string): void => {
  void Linking.openURL(url).catch(() => {
    // Nothing to say and nowhere to say it. See above.
  });
};
