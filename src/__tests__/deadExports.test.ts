/**
 * An export nothing names, not even the docs.
 *
 * Seven had accumulated, and three of them carried comments asserting a caller
 * that did not exist -- `setSessionManager` said it worked "the way
 * `setRepository` does" and took a different kind of thing; `byRecencyDesc`
 * called itself "the order every list in the app wants" beside six inline `.at`
 * sorts, three of them ascending; `tablesOf` was "for a caller that wants to
 * walk one at a time" and there was none. None of it cost anything at runtime.
 * What it costs is the next reader, who has no way to tell a seam somebody is
 * about to use from one nobody ever did.
 *
 * The question asked here is deliberately the weakest one that catches them:
 * does the name appear anywhere at all besides the line that declares it --
 * in another module, in a test, in its own file, or in a Markdown file. So an
 * export used once inside its own module passes, a seam a guide names passes
 * (`setRepository` is in SYNC.md and nowhere else), and a type used only
 * structurally passes because its name is still written somewhere. Only a
 * symbol nothing in the repository mentions twice is flagged, which is a fact
 * about the repository rather than a judgment about the design.
 *
 * Comments do not count, which is the half that makes it work: every one of
 * the seven was mentioned in its own docstring, and a comment claiming a
 * caller is exactly the evidence this is meant to disbelieve.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');

/** Tracked source and prose. Anything untracked is not part of the answer. */
const tracked = (): string[] =>
  execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n')
    .filter((path) => /\.(md|ts|tsx|mts|mjs|js)$/.test(path));

/** Block and line comments out, so a docstring cannot vouch for a name. */
const withoutComments = (source: string): string =>
  source.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ');

const DECLARATION = /^export (?:const|function|class|type|interface|enum) (\w+)/gm;

describe('every export in src', () => {
  it('is named somewhere other than the line that declares it', () => {
    const files = tracked();
    const code = files.map((path) => withoutComments(readFileSync(join(ROOT, path), 'utf8')));
    const unreached: string[] = [];

    for (const path of files) {
      // Declared in `src` and not in a test: a test's own helpers are not API.
      if (!path.startsWith('src/') || path.includes('__tests__')) continue;
      for (const [, name] of readFileSync(join(ROOT, path), 'utf8').matchAll(DECLARATION)) {
        const mentions = new RegExp(`\\b${name}\\b`, 'g');
        const total = code.reduce((sum, body) => sum + (body.match(mentions) ?? []).length, 0);
        if (total <= 1) unreached.push(`${path}: ${name}`);
      }
    }

    expect(unreached).toEqual([]);
  });
});
