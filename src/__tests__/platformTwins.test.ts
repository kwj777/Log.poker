/**
 * The files Metro swaps, and whether they still agree.
 *
 * Six modules ship twice. Five have a `.web.ts` half for the browser bundle
 * and a plain one for iOS and Android; `orientation` has an `.android.ts`
 * half and a plain one for iOS and the web. Metro picks between them by filename, so
 * every importer writes one path and gets whichever half the platform build
 * chose. That makes the pair a single module with two implementations, and
 * the thing a caller depends on is that both implement the same names.
 *
 * Nothing checked that. `repositoryFactory.ts` said the two "export the same
 * `createRepository` signature" and credited "the `satisfies` check in each
 * one" with keeping them from drifting -- a check that appears in neither
 * file, and could not do that job anyway, since a missing export is not a
 * type error in the file that does not have it. Deleting `STORAGE_ENGINE`
 * from the web half left `tsc --noEmit` and `eslint` both green, and the only
 * consequence would have been Settings reading "Log stores your sessions in
 * on this device".
 *
 * Values only. A type may be declared in one half and imported from it by the
 * other -- `RepositoryFactory` is, which is what stops the annotation on both
 * `createRepository`s being two unrelated annotations -- and types are erased
 * before Metro ever chooses a file, so they cannot go missing at runtime.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');

const VALUE_EXPORT = /^export (?:const|function|class|enum) (\w+)/gm;

const valuesIn = (path: string): string[] =>
  [...readFileSync(join(ROOT, path), 'utf8').matchAll(VALUE_EXPORT)].map(([, name]) => name).sort();

/** Every platform half in `src`, paired with the file it stands in for. */
const twins = (): [string, string][] =>
  execFileSync('git', ['ls-files', 'src'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter((path) => /\.(web|android|ios)\.tsx?$/.test(path))
    .map((half) => [half, half.replace(/\.(web|android|ios)\.(tsx?)$/, '.$2')]);

describe('a module that ships twice', () => {
  it('is these six, so a seventh arrives here rather than unnoticed', () => {
    expect(twins().map(([half]) => half)).toEqual([
      'src/auth/tokenStore.web.ts',
      'src/data/repositoryFactory.web.ts',
      'src/features/export/saveCsv.web.ts',
      'src/features/import/pickCsvFile.web.ts',
      'src/orientation.android.ts',
      'src/sync/cursorStore.web.ts',
    ]);
  });

  it.each(twins())('exports the same values from both halves: %s', (web, native) => {
    expect(valuesIn(web)).toEqual(valuesIn(native));
  });
});
