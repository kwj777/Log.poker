/**
 * Following a hand-off, which is the half that needs a platform.
 *
 * The URLs themselves are in `links.ts` and are pure. This file exists only
 * because opening one needs `Linking`, and that import is what keeps a module
 * out of the Node test runner; see the header over there.
 */

import { Linking } from 'react-native';

export const openHandOff = (url: string): void => {
  void Linking.openURL(url).catch(() => {
    // A missing browser or a blocked pop-up is not worth an error dialog over a
    // cross-promo link.
  });
};
