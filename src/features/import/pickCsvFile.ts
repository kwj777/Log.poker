/**
 * Reading a file the player chose -- the native half.
 *
 * This file used to return `null` and declare `CAN_PICK_FILE = false`, on the
 * argument that a picker was "not worth a dependency and a rebuild to the one
 * platform where nobody keeps their tracker exports". Both halves of that turned
 * out to be wrong, in opposite directions.
 *
 * The dependency is gone: `expo-file-system`, already here for `saveCsv`, grew
 * `File.pickFileAsync` and it is the same `UIDocumentPickerViewController` a
 * separate picker module would have added. Nothing new is installed and nothing
 * needs rebuilding, because the native side of the app has not changed.
 *
 * And the premise was wrong anyway. The app's own export writes a CSV, hands it
 * to the share sheet, and the obvious place to put it is Files -- so the one
 * file this app is certain a player has on their phone is one it made, and the
 * import screen would not open it. Moving a log from an old phone to a new one
 * went through a desktop browser or it did not happen.
 *
 * `pickCsvFile.web.ts` replaces this file in the web bundle, where the same job
 * is an `<input type="file">`.
 */

import { File } from 'expo-file-system';

export interface PickedFile {
  name: string;
  text: string;
}

export const CAN_PICK_FILE = true;

/**
 * Wide on purpose.
 *
 * `text/*` becomes `UTType.text` on iOS, which covers CSV, TSV and plain text
 * together, and it is a legal wildcard for Android's document provider. The
 * temptation is to name the three types exactly, and the failure mode of
 * getting that list one entry short is the worst one this screen has: the file
 * is grayed out in the picker, with nothing on screen to say why or what to do
 * instead. Letting a wrong file through costs a line of red text on a screen
 * built to show exactly that, under a heading that says "Can't read that" and
 * lists the columns it found.
 */
const TYPES = 'text/*';

export const pickCsvFile = async (): Promise<PickedFile | null> => {
  const picked = await File.pickFileAsync({ mimeTypes: TYPES });
  if (picked.canceled) return null;

  // iOS opens the picker with `asCopy: true`, so this is a copy in the app's own
  // container rather than a security-scoped handle into somebody's iCloud Drive,
  // and reading it needs no ceremony.
  return { name: picked.result.name, text: await picked.result.text() };
};
