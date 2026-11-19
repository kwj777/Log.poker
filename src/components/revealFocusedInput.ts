/**
 * Scroll the field being typed into back above the keyboard, on Android.
 *
 * Lifting the frame (`keyboardBehavior`) keeps the footer clear, but a field
 * that sat low on a long page is still below the fold once the frame is
 * shorter. iOS scrolls it back by itself, through
 * `automaticallyAdjustKeyboardInsets`, which Android does not have. Android's
 * own scroll view is supposed to do the same when it shrinks, but on a Moto G
 * the sign-in email on Settings stayed under the keyboard, so this does it on
 * purpose rather than hoping.
 *
 * `Screen` calls it whenever its scroll area gets shorter while the keyboard
 * is up, which is the moment the frame has just been lifted.
 */
import { Keyboard, TextInput, type ScrollView } from 'react-native';

/** Room left between the field and the top of the keyboard, in dp. */
export const REVEAL_MARGIN = 24;

/**
 * How far to scroll down so a field ending at `fieldBottom` clears a scroll
 * area ending at `areaBottom`, both in window coordinates. Zero when it
 * already does.
 */
export function revealDistance(fieldBottom: number, areaBottom: number, margin = REVEAL_MARGIN): number {
  return Math.max(0, fieldBottom + margin - areaBottom);
}

type Measurable = {
  measureInWindow: (callback: (x: number, y: number, width: number, height: number) => void) => void;
};

export function revealFocusedInput(scroll: ScrollView | null, offset: number): void {
  if (scroll === null || !Keyboard.isVisible()) return;
  const field = TextInput.State.currentlyFocusedInput() as unknown as Measurable | null;
  if (field === null) return;
  const area = scroll as unknown as Measurable;
  area.measureInWindow((_ax, ay, _aw, ah) => {
    field.measureInWindow((_fx, fy, _fw, fh) => {
      const distance = revealDistance(fy + fh, ay + ah);
      if (distance > 0) scroll.scrollTo({ y: offset + distance, animated: true });
    });
  });
}
