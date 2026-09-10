/**
 * Handing the player a file -- the native half.
 *
 * There is no download on a phone, so the file is written into the cache
 * directory and offered to the share sheet, which is where "put this in
 * Dropbox", "mail it to myself" and "open it in Numbers" all live. What
 * happens to it after that is the operating system's business, which is the
 * point: Log does not need to know, and does not want to.
 *
 * ## Why this one gets a dependency and the import picker did not
 *
 * `pickCsvFile.ts` declined two native modules on the argument that nobody
 * keeps their tracker exports on a phone, and pasting works everywhere. The
 * asymmetry is deliberate rather than an oversight. **Your log is on your
 * phone.** Getting it off is the whole feature, there is nothing to paste
 * from, and an export that only worked in a browser would be an export the
 * players who use the app most cannot reach.
 *
 * ## The cache directory, not documents
 *
 * A file the system may delete when it needs the space, which is right: this
 * one exists for as long as it takes the share sheet to hand it somewhere
 * permanent. Writing it into documents would leave a copy of somebody's whole
 * poker history sitting in the app for ever, which is a thing to have on
 * purpose or not at all.
 */

import { File, Paths } from 'expo-file-system';
import { isAvailableAsync, shareAsync } from 'expo-sharing';

export interface SaveResult {
  /** False when the player backed out, which is not a failure. */
  saved: boolean;
}

export const CAN_SAVE_FILE = true;

export const saveCsv = async (name: string, text: string): Promise<SaveResult> => {
  if (!(await isAvailableAsync())) return { saved: false };

  const file = new File(Paths.cache, name);
  // Overwritten rather than appended to: exporting twice in one day must not
  // produce a file holding the log twice.
  file.create({ overwrite: true });
  file.write(text);

  await shareAsync(file.uri, {
    mimeType: 'text/csv',
    UTI: 'public.comma-separated-values-text',
    dialogTitle: 'Your log',
  });
  return { saved: true };
};
