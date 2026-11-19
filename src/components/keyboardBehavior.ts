/**
 * How a `KeyboardAvoidingView` gets out of the keyboard's way, per platform.
 *
 * `padding` on iOS and Android, nothing on the web.
 *
 * Android used to be left out on the theory that `adjustResize` shrinks the
 * window for the keyboard, so there is nothing left to avoid. That stopped
 * being true when React Native made every window edge to edge, which it now
 * does on every Android version: an edge-to-edge window is not resized, the
 * keyboard is drawn over it, and the app is told the keyboard's size instead.
 * A `Modal` is its own window and is made edge to edge too, which is how the
 * cash-out sheet came to have its amount under the keyboard on a Moto G.
 *
 * `padding` is safe even where a window does still resize, because
 * `KeyboardAvoidingView` pads by how much the keyboard overlaps its own frame,
 * not by the keyboard's height. A frame the system already moved clear has no
 * overlap left, and gets no padding.
 *
 * The web is left alone because a browser resizes its own viewport.
 */
import { Platform } from 'react-native';

export const keyboardBehavior = (os: string = Platform.OS): 'padding' | undefined =>
  os === 'web' ? undefined : 'padding';
