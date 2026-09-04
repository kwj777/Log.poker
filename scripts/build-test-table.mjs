/**
 * The test table in the README, generated.
 *
 *   node scripts/build-test-table.mjs           rewrite the table from a real run
 *   node scripts/build-test-table.mjs --check   fail if it is out of date
 *   node scripts/build-test-table.mjs --from f  read a jest --json file instead
 *                                               of running the suite again
 *
 * ## Why this exists
 *
 * The table is derived data that was kept by hand, and it showed. It conflicted
 * on every merge into a feature branch, without exception: both sides always
 * carried a count that went stale the moment the branches parted, so there was
 * never anything to reconcile and the only correct resolution was to run the
 * suite and transcribe. Three merges in a row spent effort on a number a machine
 * can read off in one command.
 *
 * ## What is generated and what is not
 *
 * The counts are generated. The descriptions are not: "two devices disagreeing,
 * and who wins" is the reason to have the table at all, and nothing can derive
 * it from a suite name. So this reads the descriptions back out of the README
 * and writes them again beside fresh numbers. The README stays the place you
 * edit the prose; this file owns only the digits.
 *
 * A suite that appears with no description gets a placeholder, which `--check`
 * then fails on. A new suite deserves a sentence from a person, and the failure
 * is how it gets asked for.
 *
 * ## Why it is not part of `npm test`
 *
 * It runs the suite to find out what the suite does, so `npm test` cannot run
 * it without running itself. `--from` takes a `jest --json` file for anyone who
 * would rather not pay for the second run.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const README = join(ROOT, 'README.md');
const PLACEHOLDER = 'TODO: what this suite is for';

/**
 * The suite whose only job is to check the table this script writes.
 *
 * It is excluded from the green-run guard below, and it has to be: a mangled
 * table turns it red, and refusing to write while it is red would mean the one
 * thing that fixes a broken table cannot run while the table is broken.
 */
const SELF_CHECK_SUITE = 'readme';

/* ------------------------------------------------------------- the numbers */

const runJest = () => {
  // Jest writes the report to stdout and its progress to stderr, so only the
  // first is captured. `--silent` drops console output from the tests
  // themselves, which would otherwise land in the middle of the JSON.
  //
  // A failing run still prints a complete report and exits non-zero, so the
  // report is read out of the thrown error rather than lost with it.
  try {
    return JSON.parse(
      execFileSync('npx', ['jest', '--json', '--silent'], {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        maxBuffer: 64 * 1024 * 1024,
      }),
    );
  } catch (error) {
    const report = error.stdout ?? error.output?.[1];
    if (typeof report !== 'string' || report.trim() === '') throw error;
    return JSON.parse(report);
  }
};

/** `src/domain/__tests__/stats.test.ts` becomes `stats`. */
const suiteName = (path) => basename(path).replace(/\.test\.tsx?$/, '');

const readSuites = (report) =>
  report.testResults.map((result) => ({
    name: suiteName(result.name),
    count: result.assertionResults.length,
  }));

/* -------------------------------------------------------------- the table */

const BLOCK = /```\nTest Suites: .*?\n```/s;

/**
 * Pull the descriptions out of the table that is already there.
 *
 * Deliberately tolerant about spacing: somebody hand-editing a description
 * should not have to get the column alignment right for their words to survive
 * the next run.
 */
export const readDescriptions = (readme) => {
  const block = BLOCK.exec(readme);
  const descriptions = new Map();
  if (!block) return descriptions;

  for (const line of block[0].split('\n')) {
    const row = /^ {2}(\S+)\s+(\d+)\s{2,}(.+)$/.exec(line);
    if (row) descriptions.set(row[1], row[3].trim());
  }
  return descriptions;
};

/**
 * Sorted by size, then by name. Ties break alphabetically so the order is a
 * function of the results and nothing else: a rule anybody can reproduce beats
 * a hand-chosen order that only the person who chose it can restore.
 */
export const renderBlock = (suites, descriptions) => {
  const sorted = [...suites].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  const tests = sorted.reduce((sum, suite) => sum + suite.count, 0);

  const nameWidth = Math.max(...sorted.map((suite) => suite.name.length)) + 1;
  const countWidth = Math.max(3, ...sorted.map((suite) => String(suite.count).length));

  const rows = sorted.map((suite) => {
    const description = descriptions.get(suite.name) ?? PLACEHOLDER;
    return `  ${suite.name.padEnd(nameWidth)}${String(suite.count).padStart(countWidth)}   ${description}`;
  });

  return [
    '```',
    `Test Suites: ${sorted.length} passed`,
    `Tests:       ${tests} passed`,
    '',
    ...rows,
    '```',
  ].join('\n');
};

export const replaceBlock = (readme, block) => {
  if (!BLOCK.test(readme)) {
    throw new Error('No test table found in README.md. Expected a fenced block starting "Test Suites:".');
  }
  return readme.replace(BLOCK, () => block);
};

/* ------------------------------------------------------------------ main */

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const check = process.argv.includes('--check');
  const fromIndex = process.argv.indexOf('--from');
  const from = fromIndex === -1 ? null : process.argv[fromIndex + 1];

  const report = from ? JSON.parse(readFileSync(from, 'utf8')) : runJest();

  // Every row of the table ends in the word "passed". Writing one from a red
  // run would put a number under that word that nothing had earned. Failures in
  // the table's own suite are the exception, since regenerating is their fix.
  const broken = report.testResults.filter(
    (result) =>
      result.assertionResults.some((assertion) => assertion.status === 'failed') &&
      suiteName(result.name) !== SELF_CHECK_SUITE,
  );
  if (broken.length > 0) {
    const names = broken.map((result) => suiteName(result.name)).join(', ');
    console.error(`The suite is not green (${names}), and this table says "passed". Fix the tests first.`);
    process.exit(1);
  }

  const suites = readSuites(report);
  const readme = readFileSync(README, 'utf8');
  const block = renderBlock(suites, readDescriptions(readme));
  const next = replaceBlock(readme, block);

  const missing = block
    .split('\n')
    .filter((line) => line.includes(PLACEHOLDER))
    .map((line) => line.trim().split(/\s+/)[0]);

  if (check) {
    if (next !== readme) {
      console.error('The README test table is out of date. Run: npm run test:table');
      process.exit(1);
    }
    if (missing.length > 0) {
      console.error(`No description in the README for: ${missing.join(', ')}`);
      process.exit(1);
    }
    console.log(`Test table is up to date: ${suites.length} suites.`);
  } else {
    writeFileSync(README, next);
    console.log(`README test table: ${suites.length} suites, ${suites.reduce((sum, s) => sum + s.count, 0)} tests.`);
    for (const name of missing) console.log(`  ${name} has no description yet; write one in the README.`);
  }
}
