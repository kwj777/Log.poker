/**
 * API nothing uses: an export no file names twice, a prop nothing passes.
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
 * The second test asks the same question of component props, where the answer
 * has to be drawn one file further out: a component naturally writes its own
 * prop three times -- the interface, the destructure, the point of use -- and
 * none of those is a caller. It is the weaker guard of the two, deliberately:
 * a prop only a test ever passes counts as reached, which is how `standalone`
 * on `SessionRow` survived long enough to be found by hand.
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

const PROPS = /(?:^|\n)(?:export )?interface (\w*Props) \{([\s\S]*?)\n\}/g;

describe('every prop a component declares', () => {
  it('is passed by something other than the file that declares it', () => {
    // A prop nothing passes is worse than a dead export, because it takes its
    // default with it: `showEndPoint` made `showEndPoint && last` a permanently
    // true guard on the dashboard's curve, `retryLabel` fixed the button's
    // words while looking configurable, and `standalone` was a whole branch of
    // `SessionRow` that only a test ever rendered.
    //
    // Outside the declaring file this time, since a component naturally names
    // its own props three times -- in the interface, in the destructure and at
    // the point of use -- and none of those is a caller. A test counts as one:
    // it is somebody rendering the component with that prop, which is enough
    // to say it is reachable.
    const files = tracked();
    const code = files.map((path) => withoutComments(readFileSync(join(ROOT, path), 'utf8')));
    const unpassed: string[] = [];

    for (const [index, path] of files.entries()) {
      if (!path.startsWith('src/') || path.includes('__tests__')) continue;
      for (const [, shape, fields] of code[index].matchAll(PROPS)) {
        for (const line of fields.split('\n')) {
          const field = line.match(/^ {2}(\w+)\??:/);
          if (field === null) continue;
          const mentions = new RegExp(`\\b${field[1]}\\b`, 'g');
          const elsewhere = code.reduce(
            (sum, body, at) => (at === index ? sum : sum + (body.match(mentions) ?? []).length),
            0,
          );
          if (elsewhere === 0) unpassed.push(`${path}: ${shape}.${field[1]}`);
        }
      }
    }

    expect(unpassed).toEqual([]);
  });
});
