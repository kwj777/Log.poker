/**
 * The web build: an app and a marketing site in one deploy.
 *
 * log.poker is primarily the front door for three apps, and Log itself lives
 * under /app. Expo does not know that, so this script runs the export and then
 * puts its output where the site expects it.
 *
 * The rule is one line and it maintains itself: **everything the bundler
 * emitted moves under /app, and everything that came from `public/` stays at
 * the root.** The names in `public/` are read at build time rather than listed
 * here, so adding a file there never needs a change in this file.
 *
 * Doing it by moving files rather than by rewriting URLs is what keeps
 * `netlify.toml` short. The prerendered routes land as real files at the paths
 * that serve them, so /app/history is a document rather than a rewrite, and the
 * only rule left is the client-router fallback for the paths that were never
 * prerendered, like /app/session/<id>.
 *
 * `experiments.baseUrl` in app.json is the other half: it makes the export
 * reference its own bundle at /app/_expo rather than /_expo, which is where
 * this script then puts it.
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, renameSync, rmSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'dist');
const PUBLIC = join(ROOT, 'public');
const APP = join(DIST, 'app');

/** The marketing front door, which becomes the site's index. */
const HOME = 'home.html';

rmSync(DIST, { recursive: true, force: true });
execFileSync('npx', ['expo', 'export', '--platform', 'web'], { cwd: ROOT, stdio: 'inherit' });

const fromPublic = new Set(readdirSync(PUBLIC));
mkdirSync(APP, { recursive: true });

const moved = [];
for (const entry of readdirSync(DIST)) {
  if (entry === 'app' || fromPublic.has(entry)) continue;
  renameSync(join(DIST, entry), join(APP, entry));
  moved.push(entry);
}

if (!existsSync(join(DIST, HOME))) {
  throw new Error(`public/${HOME} is the site's index and was not exported`);
}
renameSync(join(DIST, HOME), join(DIST, 'index.html'));

// The app's own shell has to survive the move, or /app serves nothing.
if (!existsSync(join(APP, 'index.html'))) {
  throw new Error('the export produced no app/index.html');
}

console.log(`\n${moved.length} bundler outputs moved under /app: ${moved.join(', ')}`);
console.log(`${HOME} is now the site index; ${[...fromPublic].length} public files stayed at the root`);
