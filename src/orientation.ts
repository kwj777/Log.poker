/**
 * Nothing to do off Android: iOS is portrait from app.json and does not link
 * expo-screen-orientation, and the web rotates however the browser does.
 * The Android file says why it exists.
 */
export function usePhonePortrait(): void {}
