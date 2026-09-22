/**
 * Reading a file the player chose -- the web half.
 *
 * Metro swaps this in for `pickCsvFile.ts` on the web build, the same way the
 * repository factory picks Dexie over SQLite. A plain `<input type="file">`
 * created on demand, rather than a rendered one: react-native-web has no element
 * for it, and a hidden DOM node living in the tree would be one more thing that
 * has to survive every re-render.
 *
 * The file never leaves the browser -- it is read with `FileReader` and parsed in
 * this tab, which is the same promise the rest of Log makes about your data.
 */

export interface PickedFile {
  name: string;
  text: string;
}

const ACCEPT = '.csv,.tsv,.txt,text/csv,text/tab-separated-values,text/plain';

/**
 * `null` means the player backed out, and nothing else. A file that cannot be
 * read throws, because the alternative is a picker that takes a choice and
 * leaves the screen unchanged, which reads as the app ignoring the tap.
 */
export const pickCsvFile = (): Promise<PickedFile | null> =>
  new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = ACCEPT;

    // Dismissing the dialog fires `cancel`, not `change`. Without it the promise
    // would never settle and the button would sit in its busy state for good.
    input.addEventListener('cancel', () => resolve(null));
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve({ name: file.name, text: String(reader.result ?? '') });
      reader.onerror = () => reject(new Error(`${file.name} could not be read.`));
      reader.readAsText(file);
    });

    input.click();
  });
