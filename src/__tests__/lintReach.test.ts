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
  it('are all TypeScript, which is how they went unlinted', () => {
    // If one is ever renamed to `.ts` this stops being the interesting case,
    // and the test below stops proving anything. Named so that shows up here.
    const mts = readdirSync(FUNCTIONS).filter((name) => name.endsWith('.mts'));
    expect(mts.sort()).toEqual(['signin-sweep.mts', 'signin.mts', 'sync.mts']);
  });

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

