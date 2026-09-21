/**
 * Handing the player a file -- the web half.
 *
 * Metro swaps this in for `saveCsv.ts` on the web build, the same way it does
 * for the import picker and the repository factory. A blob and an anchor
 * clicked once, which is what a download is on the web and costs nothing.
 *
 * The file is built in this tab out of a database in this tab. Nothing is
 * uploaded to be converted and nothing is fetched to convert it, which is the
 * same promise the rest of Log makes about your data -- and it is a promise
 * worth keeping hardest at the moment somebody asks for all of it at once.
 */

export interface SaveResult {
  /** Always true here: a click on an anchor is a download, and it cannot fail. */
  saved: boolean;
}

export const CAN_SAVE_FILE = true;

export const saveCsv = async (name: string, text: string): Promise<SaveResult> => {
  // `text/csv;charset=utf-8` and the BOM the writer puts in front, because
  // between them they are what stops Excel reading an accented venue name as
  // the local code page.
  const blob = new Blob([text], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();

  // Freed on the next tick rather than immediately: revoking it in the same
  // turn as the click races the browser's own read of the blob, and the
  // failure that produces is an empty file rather than an error.
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return { saved: true };
};
