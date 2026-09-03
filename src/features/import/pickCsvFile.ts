/**
 * Reading a file the player chose -- the native half.
 *
 * There is no file picker on iOS or Android without adding a native module, and
 * an import feature is not worth a dependency and a rebuild to the one platform
 * where nobody keeps their tracker exports. Pasting works everywhere, so that is
 * the path on device; `pickCsvFile.web.ts` replaces this file in the web bundle,
 * where a picker costs nothing.
 */

export interface PickedFile {
  name: string;
  text: string;
}

export const CAN_PICK_FILE = false;

export const pickCsvFile = async (): Promise<PickedFile | null> => null;
