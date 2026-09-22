/**
 * Handing the keyboard back to whatever opened an overlay.
 *
 * React Native Web's `Modal` already tries. Its focus trap captures
 * `document.activeElement` in a mount-time effect and re-focuses it on unmount,
 * which is the right rule applied one moment too late: by the time that effect
 * runs, an `autoFocus` inside the modal has already taken the focus, so what it
 * captures is the modal's own input. That element is gone by unmount, the
 * `document.contains` guard skips the restore, and focus lands on
 * `document.body` -- every close path, not only Escape. Both of this app's
 * sheets put an `autoFocus` amount field inside one.
 *
 * So `Sheet` reads the opener itself, while it still can. The two rules are
 * here rather than inline because the platform they run on is one the suite
 * cannot render: the `ui` project is `jest-expo`'s native preset, where
 * `Platform.OS` is `ios` and there is no document at all. A function taking the
 * document as an argument can be tested in the project that does exist.
 */

/** As much of an element as re-focusing one needs. */
export interface Focusable {
  focus: () => void;
}

/** And as much of a document. */
export interface FocusHost {
  activeElement: unknown;
  contains: (node: unknown) => boolean;
}

/** The document, where there is one. Native has none, which is the answer. */
export const focusHost = (): FocusHost | null => {
  const host = (globalThis as { document?: unknown }).document;
  return typeof host === 'object' && host !== null && 'activeElement' in host
    ? (host as unknown as FocusHost)
    : null;
};

const focusable = (node: unknown): node is Focusable =>
  typeof node === 'object' && node !== null && typeof (node as Focusable).focus === 'function';

/**
 * Who has the keyboard now, if it is something that could be given it back.
 *
 * `document.body` is the answer when nothing in particular is focused, and it
 * is not focusable, so it reads as nobody -- which is what it means.
 */
export const focusedIn = (host: FocusHost | null): Focusable | null =>
  host !== null && focusable(host.activeElement) ? host.activeElement : null;

/**
 * Give it back, unless the page has moved on.
 *
 * An opener that has been unmounted in the meantime -- a row that was deleted
 * from under the sheet, a screen that navigated away -- is no longer anywhere
 * to put the keyboard, and focusing a detached node quietly focuses nothing.
 * Answers whether it did, which is the only observable a caller has.
 */
export const returnFocusTo = (opener: Focusable | null, host: FocusHost | null): boolean => {
  if (opener === null || host === null || !host.contains(opener)) return false;
  opener.focus();
  return true;
};
