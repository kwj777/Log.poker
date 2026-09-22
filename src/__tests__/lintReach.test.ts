/**
 * What `npm run lint` actually looks at.
 *
 * `eslint-config-expo` names `**` + `/*.ts` and `.tsx`, and Netlify's functions
 * are `.mts`. So `eslint .` walked past `sync.mts`, `signin.mts` and
 * `signin-sweep.mts` -- the whole of the server, and the most security-
 * sensitive code in this repository -- and the CI job that runs it did too. An
 * undefined identifier in the sync endpoint passed with exit 0.
 *
 * Asserted by resolving the real config and linting text at those paths, rather
 * than by reading `eslint.config.js` for a glob: the question is whether a rule
 * fires on that file, and a config can name a file and still apply nothing.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(__dirname, '..', '..');
const FUNCTIONS = join(ROOT, 'netlify', 'functions');

interface Message {
  ruleId: string | null;
  severity: number;
  message: string;
}

/**
 * Lint text as if it were at that path, through the CLI the build runs.
 *
 * `--stdin-filename` is what makes this the real question: eslint resolves the
 * config for that path, so the answer is whatever `npm run lint` would say
 * about a file living there. Through the CLI rather than the Node API because
 * the flat-config loader imports dynamically, which Jest's module registry
 * cannot do without a flag this repository does not set.
 */
const lintAt = (relative: string, code: string): Message[] => {
  try {
    const out = execFileSync(
      'npx',
      ['eslint', '--no-color', '--format', 'json', '--stdin', '--stdin-filename', relative],
      { cwd: ROOT, input: code, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
    return (JSON.parse(out) as { messages: Message[] }[])[0].messages;
  } catch (error) {
    // eslint exits non-zero when it finds an error, and prints the report to
    // stdout either way.
    const out = (error as { stdout?: string }).stdout ?? '';
    return (JSON.parse(out) as { messages: Message[] }[])[0].messages;
  }
};

describe('the serverless functions', () => {
  it('are these four, and three of them are the extension eslint walked past', () => {
    // This asserted the `.mts` files alone, under the name "are all
    // TypeScript" -- which was false the whole time, because `chip-scan.mjs`
    // is a deployed function too (netlify.toml routes `/api/chip-scan` at it),
    // and which passed whether or not it was there, because the filter took it
    // out before the comparison.
    //
    // The whole listing now, so a fifth function of any extension shows up
    // here rather than in nothing. If one is ever renamed to `.ts` the test
    // below stops proving anything, and this is where that shows.
    expect(readdirSync(FUNCTIONS).sort()).toEqual([
      'chip-scan.mjs',
      'signin-sweep.mts',
      'signin.mts',
      'sync.mts',
    ]);
  });

  it('and every one of them is reached by the linter, whatever it is called', () => {
    // The `.mjs` one always was: ESLint 9 targets `.js`, `.cjs` and `.mjs` by
    // default. The three `.mts` ones were not, which is what the override in
    // `eslint.config.js` is for, and what the case below proves it fixed.
    for (const name of readdirSync(FUNCTIONS)) {
      const messages = lintAt(`netlify/functions/${name}`, 'const unusedOnPurpose = 1;\n');
      // A rule that fired, not any message: a path with no configuration gets
      // "File ignored because no matching configuration was supplied", which
      // is a message and is the opposite of being linted.
      const rules = messages.filter((message) => message.ruleId !== null);
      expect([name, rules.length > 0]).toEqual([name, true]);
    }
  }, 60_000);

  it('are linted, so an error in one fails the build', () => {
    const messages = lintAt(
      'netlify/functions/sync.mts',
      'export const handler = (): number => someIdentifierNothingDefines;\n',
    );

    expect(messages.filter((message) => message.severity === 2).length).toBeGreaterThan(0);
    expect(messages.map((message) => message.ruleId)).toContain('no-undef');
  }, 60_000);

  it('and their own globals are not errors, or the gate would be noise', () => {
    // A function reads the request, answers with a `Response`, and talks to
    // `process.env`. A gate that flagged those would be turned off within a
    // week.
    const messages = lintAt(
      'netlify/functions/sync.mts',
      [
        'export default async (request: Request): Promise<Response> => {',
        '  const key = process.env.SYNC_SECRET ?? "";',
        '  const url = new URL(request.url);',
        '  console.error(url.pathname);',
        '  return new Response(key, { headers: new Headers() });',
        '};',
      ].join('\n'),
    );

    expect(messages.filter((message) => message.severity === 2)).toEqual([]);
  }, 60_000);
});

describe('documentation the compiler throws away', () => {
  /**
   * TypeScript attaches only the last JSDoc block to a declaration.
   *
   * So two stacked `/** ...` blocks mean the first one documents nothing: no
   * hover, no tooling, and in this repository's case a confident paragraph
   * sitting directly above the wrong symbol while the one it was written for
   * has no doc at all. Nine of those had accumulated, including the warning in
   * `SqlRepository` about `INSERT OR REPLACE` firing `ON DELETE CASCADE` and
   * taking a session's hands with it.
   *
   * A file header followed by the first declaration's doc is the one legal
   * shape, and is why the check starts at line two.
   */
  const stacked = (source: string): number[] => {
    const lines: number[] = [];
    const pattern = /\/\*\*(?:(?!\*\/)[\s\S])*\*\/\s*\n\s*\/\*\*/g;
    for (const match of source.matchAll(pattern)) {
      const line = source.slice(0, match.index).split('\n').length;
      if (line > 1) lines.push(line);
    }
    return lines;
  };

  it('is not stacked anywhere the compiler would discard it', () => {
    const walk = (dir: string): string[] =>
      readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
        const path = `${dir}/${entry.name}`;
        if (entry.isDirectory()) return entry.name === '__tests__' ? [] : walk(path);
        return /\.tsx?$/.test(entry.name) ? [path] : [];
      });

    const offenders = [...walk('src'), ...walk('app')].flatMap((path) =>
      stacked(readFileSync(join(ROOT, path), 'utf8')).map((line) => `${path}:${line}`),
    );
    expect(offenders).toEqual([]);
  });

  it('and the check sees one when there is one', () => {
    // A tripwire for the tripwire: the pattern above is easy to write so that
    // it matches nothing, which would pass this suite forever.
    const planted = ['const a = 1;', '/** first */', '/** second */', 'const b = 2;'].join('\n');
    expect(stacked(planted)).toEqual([2]);
    expect(stacked(['/** header */', '/** first */', 'const a = 1;'].join('\n'))).toEqual([]);
  });
});


describe('what this repository says it cannot do', () => {
  /**
   * Three comments said the repository's runner cannot render a component,
   * and `jest.config.js` declares a second project whose own header says "**ui**
   * is everything that renders". Both cards those comments were about are
   * rendered in it, by tests that were already passing when the comments were
   * written -- so nobody was talked out of a render test, but the next person
   * reading one of those files is told the runner is half of what it is.
   *
   * A file may still say its own project cannot render, which is true of every
   * `.test.ts` in the node project and is why two of these say so now.
   */
  const claim = /this repository'?s [^.]{0,80}?cannot render/;

  const walk = (dir: string): string[] =>
    readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) => {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) return walk(path);
      return /\.tsx?$/.test(entry.name) ? [path] : [];
    });

  /** Comment wrapping flattened, since every one of these spanned two lines. */
  const flat = (source: string): string => source.replace(/\n\s*\*/g, ' ').replace(/\s+/g, ' ');

  it('does not include rendering a component, which the ui project does', () => {
    const offenders = [...walk('src'), ...walk('app')].filter((path) =>
      claim.test(flat(readFileSync(join(ROOT, path), 'utf8'))),
    );
    expect(offenders).toEqual([]);
  });

  it('and the check sees one when there is one', () => {
    expect(claim.test(flat("/**\n * this repository's test runner cannot\n * render a component.\n */"))).toBe(
      true,
    );
    expect(claim.test(flat("/** this file's project is plain ts-jest and cannot render a component. */"))).toBe(
      false,
    );
  });
});
