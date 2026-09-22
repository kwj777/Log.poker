/**
 * Who the keyboard goes back to when a sheet closes.
 *
 * The bug these came from is web-only and lives in react-native-web's own
 * focus trap: it captures `document.activeElement` in a mount-time effect,
 * which on both of this app's sheets is the sheet's own `autoFocus` field
 * rather than the button that opened it. That element is gone by unmount, so
 * its `document.contains` guard skips the restore and focus lands on
 * `document.body`. Measured through react-dom in jsdom before and after the
 * fix: `body` either way before, the opener either way after.
 *
 * That measurement is not in here, because there is nowhere for it to live:
 * the `ui` project is `jest-expo`'s native preset, where `Platform.OS` is
 * `ios` and there is no document at all. What is in here is the pair of rules
 * `Sheet` applies, which is the part that can be asked a question in the
 * project that does exist. The timing -- read the opener while rendering,
 * give it back on dismiss -- is pinned by the comments in `Sheet`, and both
 * halves were checked by reverting them one at a time.
 */

import { focusHost, focusedIn, returnFocusTo, type FocusHost } from '../returnFocus';

/** A document with exactly the two things this reads from one. */
const host = (activeElement: unknown, held: unknown[] = [activeElement]): FocusHost => ({
  activeElement,
  contains: (node) => held.includes(node),
});

const button = () => {
  let focused = 0;
  return { focus: () => (focused += 1), focusedCount: () => focused };
};

describe('reading who has the keyboard', () => {
  it('is whoever has it, when that is something that could be given it back', () => {
    const opener = button();
    expect(focusedIn(host(opener))).toBe(opener);
  });

  it('is nobody on a platform with no document, which is every native one', () => {
    // `Sheet` renders on iOS and Android too, and there the whole question is
    // moot rather than unanswered.
    expect(focusHost()).toBeNull();
    expect(focusedIn(null)).toBeNull();
  });

  it('and nobody when the answer is the body, which is what nothing focused means', () => {
    // `document.activeElement` is never null in a real browser -- it falls
    // back to `body`, which cannot take focus. Restoring to it would be the
    // failure this exists to fix, dressed up as a fix.
    expect(focusedIn(host({ tagName: 'BODY' }))).toBeNull();
  });
});

describe('giving it back', () => {
  it('focuses the opener', () => {
    const opener = button();
    expect(returnFocusTo(opener, host(null, [opener]))).toBe(true);
    expect(opener.focusedCount()).toBe(1);
  });

  it('but not one the page has moved on from', () => {
    // A row deleted from under the sheet, or a screen that navigated away.
    // Focusing a detached node quietly focuses nothing, so the call would look
    // like it worked and leave the keyboard on the body.
    const opener = button();
    expect(returnFocusTo(opener, host(null, []))).toBe(false);
    expect(opener.focusedCount()).toBe(0);
  });

  it('and does nothing at all when there was nobody to remember', () => {
    expect(returnFocusTo(null, host(null))).toBe(false);
    expect(returnFocusTo(button(), null)).toBe(false);
  });
});
