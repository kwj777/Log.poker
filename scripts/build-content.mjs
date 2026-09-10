/**
 * The content pages: four guides, written once and rendered here.
 *
 *   node scripts/build-content.mjs           write public/<slug>.html
 *   node scripts/build-content.mjs --check   fail if any file is out of date
 *
 * ## Why a generator rather than four hand-written pages
 *
 * They share a head, a mark, a nav, a footer and about a hundred lines of CSS,
 * and log.poker paints with no external request of any kind, not even a font,
 * so that CSS has to be inline on every one of them. Four copies of it is four
 * chances to change three. The same argument that put the icons in a script
 * puts these here, and `--check` is the test that the committed output is what
 * this file would produce.
 *
 * ## Why the numbers are computed
 *
 * Every figure in every table below is derived here rather than typed, from
 * the same formulas the app itself uses. A poker page that gets its own
 * arithmetic wrong is worse than no page, and a number typed from memory is
 * how that happens. `src/site/__tests__/content.test.ts` reads the published
 * HTML back and checks each one against `src/domain/variance.ts` and against
 * plain combinatorics, so the tables are verified as published rather than as
 * intended.
 *
 * ## What these pages are for
 *
 * Somebody searching "am I running bad or playing bad" has a real question
 * with a real answer, and the answer is the reason Log exists. The pages are
 * written to be worth the click on their own: each one answers the question in
 * full, with the arithmetic shown, and mentions the app that does it once at
 * the end. A page that withholds the answer to make you install something is
 * the genre this is trying not to be in.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { GUIDES } from './pages.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = join(ROOT, 'public');
const SITE = 'https://log.poker';

/* --------------------------------------------------------------- the math */

/**
 * Standard normal CDF (Abramowitz and Stegun 26.2.17). The same approximation
 * as `normalCdf` in src/domain/variance.ts, which the test holds it to.
 */
const normalCdf = (z) => {
  const sign = z < 0 ? -1 : 1;
  const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
};

/** Two-sided 95%, as Z_SCORES[95] in src/domain/variance.ts has it. */
const Z95 = 1.96;

/** n choose k, exact for the small n this needs. */
const choose = (n, k) => {
  let result = 1;
  for (let i = 0; i < k; i += 1) result = (result * (n - i)) / (i + 1);
  return result;
};

/**
 * The example player. Five big blinds an hour with a standard deviation of
 * fifty is an ordinary live winner, and it is an *example*: the whole point of
 * the running-bad page is that these two numbers have to come from your own
 * results, so the page shows the shape of the answer rather than claiming to
 * know yours.
 */
const EXAMPLE = { winRate: 5, stdDev: 50 };

/** Expected result, 95% envelope and probability of being behind, after h hours. */
const afterHours = (hours, { winRate, stdDev } = EXAMPLE) => {
  const expected = winRate * hours;
  const spread = Z95 * stdDev * Math.sqrt(hours);
  return {
    hours,
    expected,
    lower: expected - spread,
    upper: expected + spread,
    behind: normalCdf(-(winRate * Math.sqrt(hours)) / stdDev),
  };
};

const VARIANCE_ROWS = [20, 50, 100, 250, 500, 1000].map((h) => afterHours(h));

/**
 * Exact equity for `outs` cards, from the flop with two cards to come and from
 * the turn with one. Forty-seven unseen cards on the flop and forty-six on the
 * turn: your two and the board are known to you, and everything else is not.
 */
const outsRow = (outs) => ({
  outs,
  byRiver: 1 - choose(47 - outs, 2) / choose(47, 2),
  onRiver: outs / 46,
  ruleOfFour: (4 * outs) / 100,
  ruleOfTwo: (2 * outs) / 100,
});

const OUTS_ROWS = [2, 4, 6, 8, 9, 12, 15, 21].map(outsRow);

/**
 * Risk of ruin for a bankroll of `buyIns` hundred-big-blind buy-ins.
 *
 * A winning player's results are a random walk with upward drift, and the
 * chance that such a walk ever touches zero from a starting height B is
 * exp(-2wB/s^2). It assumes the win rate and the swings stay what they are and
 * that the stake never changes, which is why the page says out loud that it is
 * a floor rather than a promise.
 */
const ruin = (buyIns, winRate, stdDev = EXAMPLE.stdDev) =>
  Math.exp((-2 * winRate * (buyIns * 100)) / (stdDev * stdDev));

const RUIN_BUY_INS = [5, 10, 20, 30, 40];
const RUIN_RATES = [
  { winRate: 2.5, label: 'A small winner, 2.5 bb/hour' },
  { winRate: 5, label: 'A solid winner, 5 bb/hour' },
  { winRate: 8, label: 'A strong winner, 8 bb/hour' },
];

/* ------------------------------------------------------------ formatting */

const bb = (value) => `${value >= 0 ? '+' : ''}${Math.round(value).toLocaleString('en-US')}`;
const pct = (value, places = 1) => `${(value * 100).toFixed(places)}%`;

/**
 * Three significant figures, whatever the magnitude, with the trailing zeros
 * trimmed and an honest floor.
 *
 * Fixed decimals printed exp(-8) as "0.03%", so a reader dividing the two
 * cells the prose compares got 61 where the prose said 55. The numbers are
 * exact; only the rounding was lying. The floor is where the model's own
 * assumptions swamp the digits, and printing more of them there would be a
 * different kind of lie.
 */
const pctSignificant = (value) => {
  if (value < 0.00001) return 'under 0.001%';
  const places = Math.min(6, Math.max(1, Math.ceil(-Math.log10(value * 100)) + 2));
  return `${(value * 100).toFixed(places).replace(/\.?0+$/, '')}%`;
};
/** "1 in 6" reads as a frequency; "15.9%" reads as a statistic. Both help. */
const oneIn = (value) => `1 in ${Math.round(1 / value).toLocaleString('en-US')}`;

const WORDS = [
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine',
  'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen',
  'seventeen', 'eighteen', 'nineteen', 'twenty',
];

/** The same frequency in prose, where digits read as a typo. */
const oneInWords = (value) => {
  const n = Math.round(1 / value);
  return `one time in ${WORDS[n] ?? n.toLocaleString('en-US')}`;
};

/* --------------------------------------------------------------- the shell */

/**
 * The family mark, on the 200 grid it is drawn on everywhere else. Nothing is
 * lit: an app icon turns exactly one ring gold, and this is every app.
 */
const MARK = `<svg class="mark" viewBox="0 0 200 200" role="img" aria-label="Three nested triangles sharing a baseline">
          <g fill="none" stroke-linejoin="round" stroke-linecap="round">
            <path d="M100 125 L100 163" stroke="#c9a86a" stroke-width="8" />
            <path d="M34 125 L166 125 L100 37 Z" stroke="#9aae80" stroke-width="6" />
            <path d="M56 125 L100 66 L144 125" stroke="#75886a" stroke-width="6" />
            <path d="M78 125 L100 96 L122 125" stroke="#55665e" stroke-width="6" />
          </g>
        </svg>`;

/**
 * The site's tokens and type, copied from public/home.html rather than shared
 * through a stylesheet, because a stylesheet is a request and the rule here is
 * that a page paints with none. What is added below the shared part is the
 * long-form typography these pages need and the front page does not: headings
 * inside an article, tables that scroll on a phone, and a callout.
 */
const STYLE = `      :root {
        --ground: #1c211f; --raised: #232a27; --rim: #2e3a35; --ring: #333f39;
        --gold: #c9a86a; --sage: #6b7a5e; --forest: #3d4a44;
        --cream: #e8e4da; --muted: #b7c0ba; --dim: #828e89;
        --serif: Georgia, "Times New Roman", "Nimbus Roman", serif;
        --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
        color-scheme: dark;
      }
      * { box-sizing: border-box; }
      html { -webkit-text-size-adjust: 100%; }
      body {
        margin: 0; background: var(--ground); color: var(--cream);
        font-family: var(--sans); font-size: 16px; line-height: 1.62;
        -webkit-font-smoothing: antialiased;
      }
      .wrap {
        max-width: 40rem; margin: 0 auto;
        padding: clamp(1.75rem, 6vw, 3rem) clamp(1.25rem, 6vw, 2rem) 3rem;
        display: flex; flex-direction: column; gap: clamp(2rem, 6vw, 3rem);
      }
      .top { display: flex; align-items: center; gap: .7rem; }
      .top .mark { width: 34px; height: auto; flex: none; }
      .top a { color: var(--muted); text-decoration: none; font-size: .8rem; letter-spacing: .18em; text-transform: uppercase; }
      .top a:hover, .top a:focus-visible { color: var(--cream); }
      h1 {
        font-family: var(--serif); font-weight: normal; margin: 0;
        font-size: clamp(1.9rem, 7.5vw, 2.6rem); line-height: 1.1; text-wrap: balance;
      }
      h2 {
        font-family: var(--serif); font-weight: normal; margin: 0;
        font-size: clamp(1.3rem, 4vw, 1.5rem); line-height: 1.25;
      }
      h3 { font-family: var(--sans); font-weight: 600; margin: 0; font-size: 1rem; letter-spacing: .01em; }
      .eyebrow {
        margin: 0 0 .4rem; font-size: .68rem; letter-spacing: .22em;
        text-transform: uppercase; color: var(--dim);
      }
      .lede {
        margin: .9rem 0 0; color: var(--muted); font-family: var(--serif);
        font-size: clamp(1.04rem, 2.6vw, 1.18rem); line-height: 1.55;
      }
      section { display: flex; flex-direction: column; gap: 1.05rem; }
      p { margin: 0; }
      ul { margin: 0; padding-left: 1.15rem; display: flex; flex-direction: column; gap: .5rem; }
      li::marker { color: var(--forest); }
      strong { color: var(--cream); font-weight: 600; }
      em { color: var(--cream); font-style: italic; }
      code {
        font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
        font-size: .92em; color: var(--gold); background: var(--raised);
        border: 1px solid var(--rim); border-radius: 2px; padding: .05em .35em;
      }
      .scroll { overflow-x: auto; -webkit-overflow-scrolling: touch; }
      table { border-collapse: collapse; width: 100%; min-width: 30rem; font-size: .88rem; }
      /* Below the scroller rather than inside it: a <caption> inherits the
         table's min-width, so on a phone the note explaining the table could
         only be read by swiping the table sideways. */
      .caption { margin-top: .7rem; color: var(--dim); font-size: .78rem; line-height: 1.5; }
      th, td { padding: .5rem .65rem; text-align: right; border-bottom: 1px solid var(--rim); }
      th:first-child, td:first-child { text-align: left; white-space: nowrap; }
      thead th { color: var(--dim); font-weight: 600; font-size: .72rem; letter-spacing: .1em; text-transform: uppercase; white-space: nowrap; }
      tbody tr:last-child td { border-bottom: none; }
      td.num { font-variant-numeric: tabular-nums; }
      td.lit { color: var(--gold); }
      .note {
        border-left: 2px solid var(--forest); padding-left: 1.15rem;
        display: flex; flex-direction: column; gap: .7rem;
      }
      .note p { font-family: var(--serif); font-size: 1.02rem; color: var(--muted); line-height: 1.55; }
      .next {
        border: 1px solid var(--rim); border-radius: 3px; background: var(--raised);
        padding: 1.1rem 1.2rem; display: flex; flex-direction: column; gap: .55rem;
      }
      .next .verb { font-size: .67rem; letter-spacing: .22em; text-transform: uppercase; color: var(--gold); }
      .next .name { font-family: var(--serif); font-size: 1.24rem; }
      .next p { color: var(--muted); font-size: .93rem; }
      a { color: var(--gold); text-underline-offset: 2px; }
      :focus-visible { outline: 2px solid var(--gold); outline-offset: 3px; }
      footer {
        border-top: 1px solid var(--rim); padding-top: 1.5rem;
        color: var(--dim); font-size: .8rem; line-height: 1.55;
        display: flex; flex-direction: column; gap: .9rem;
      }
      footer nav { display: flex; flex-wrap: wrap; gap: .35rem 1rem; }
      footer strong { color: var(--muted); }`;

/** Every guide, in the order the footer lists them. */
/** The guides cross-link each other; the list itself lives in `pages.mjs`. */
const NAV = GUIDES;

const HELPLINE = `<p>
          These are record keeping and practice tools, not gambling advice. If
          poker has stopped being a choice: in the US, the National Problem
          Gambling Helpline is <strong>1-800-522-4700</strong>, 24/7, free and
          confidential. Anywhere else,
          <a href="https://gamblingtherapy.org">Gambling Therapy</a> is free,
          answers in any language, and is not a phone call.
        </p>`;

/**
 * One page.
 *
 * The JSON-LD is generated from the same title, description and slug as the
 * meta tags, so the two cannot disagree. It claims nothing that is not on the
 * page: no rating, no author invented for the byline, no date pretending the
 * page was revised when it was not.
 */
const render = ({ slug, title, description, updated, body }) => {
  const url = `${SITE}${slug}`;
  const others = NAV.filter(([href]) => href !== slug);
  return `<!doctype html>
<!--
  Generated by scripts/build-content.mjs. Edit the page there, not here:
  "npm run build:content" rewrites this file, and "npm run build:content -- --check"
  fails if it has drifted.
-->
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>${title}</title>
    <meta name="description" content="${description}" />
    <link rel="canonical" href="${url}" />
    <meta name="theme-color" content="#1c211f" />
    <meta name="color-scheme" content="dark" />
    <link rel="icon" href="/icons/icon-192.png" />
    <link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />
    <meta property="og:type" content="article" />
    <meta property="og:site_name" content="Log" />
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:url" content="${url}" />
    <script type="application/ld+json">
${JSON.stringify(
  {
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: title,
    description,
    url,
    dateModified: updated,
    inLanguage: 'en',
    isAccessibleForFree: true,
    publisher: { '@type': 'Organization', name: 'Log', url: SITE },
  },
  null,
  2,
)
  .split('\n')
  .map((line) => `      ${line}`)
  .join('\n')}
    </script>
    <style>
${STYLE}
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="top">
        ${MARK}
        <a href="/">Log &middot; Learn, Observe, Ground</a>
      </div>

${body}

      <footer>
        <nav>
          <a href="/">The three apps</a>
${others.map(([href, label]) => `          <a href="${href}">${label}</a>`).join('\n')}
          <a href="/blog">The Log Blog</a>
          <a href="/sitemap">Sitemap</a>
        </nav>
        ${HELPLINE}
      </footer>
    </div>
  </body>
</html>
`;
};

/** The one call to action each page ends on, after it has answered the question. */
const next = ({ verb, name, href, what }) => `      <section>
        <div class="next">
          <span class="verb">${verb}</span>
          <span class="name">${name}</span>
          <p>${what}</p>
          <p><a href="${href}">${href.startsWith('/') ? `log.poker${href}` : href.replace('https://', '')}</a></p>
        </div>
      </section>`;

/* ---------------------------------------------------------------- page 1 */

const runningBad = {
  slug: '/running-bad',
  title: 'Running bad or playing bad? How to tell the difference',
  description:
    'A winning poker player is behind after 100 hours about one time in six. Here is the arithmetic that says whether a losing stretch is ordinary, and what it takes to know your own numbers.',
  updated: '2026-09-03',
  body: `      <header>
        <p class="eyebrow">Observe</p>
        <h1>Running bad, or playing bad?</h1>
        <p class="lede">
          It is the question every losing stretch provokes, and it has an
          answer. Not a certain one, but a useful one: whether a stretch like
          this is ordinary for a player with your win rate and your swings.
          For most rough stretches, it is.
        </p>
      </header>

      <section>
        <h2>The short version</h2>
        <p>
          Poker results are a random walk with a small drift. Over a stretch of
          <code>h</code> hours, a player who wins <code>w</code> big blinds an
          hour with a standard deviation of <code>s</code> big blinds an hour
          finishes with an expected <code>w &times; h</code> and a spread of
          about <code>s &times; &radic;h</code>.
        </p>
        <p>
          The drift grows with time. The spread grows with the square root of
          time. That single mismatch is the whole story of a downswing: over a
          weekend the spread dwarfs the drift, and over a year the drift wins.
        </p>
      </section>

      <section>
        <h2>What ordinary looks like</h2>
        <p>
          Take a live winner at 5 big blinds an hour with a standard deviation
          of 50. Those two numbers are an example and nothing more, but the
          shape they produce is the shape everyone's looks like.
        </p>
        <div class="scroll">
          <table aria-describedby="table-note">
            <thead>
              <tr>
                <th scope="col">After</th>
                <th scope="col">Expected</th>
                <th scope="col">95% band</th>
                <th scope="col">Chance of being behind</th>
              </tr>
            </thead>
            <tbody>
${VARIANCE_ROWS.map(
  (row) => `              <tr>
                <td>${row.hours.toLocaleString('en-US')} hours</td>
                <td class="num">${bb(row.expected)} bb</td>
                <td class="num">${bb(row.lower)} to ${bb(row.upper)} bb</td>
                <td class="num${row.hours <= 100 ? ' lit' : ''}">${pct(row.behind)} <span style="color:var(--dim)">(${oneIn(row.behind)})</span></td>
              </tr>`,
).join('\n')}
            </tbody>
          </table>
        </div>
        <p class="caption" id="table-note">
          The 95% band is where 19 stretches out of 20 finish. Anything
          inside it is unremarkable, which is a different claim from
          "good".
        </p>
        <p>
          Read the last column again. This player is a genuine winner, and
          after a hundred hours at the table they are still behind
          <strong>${oneInWords(VARIANCE_ROWS[2].behind)}</strong>. Not because
          anything went wrong. That is simply what ${VARIANCE_ROWS[2].hours}
          hours of this much variance looks like.
        </p>
        <p>
          A hundred hours is two or three months of playing a couple of nights
          a week. Most players have never had a sample long enough to be
          confident about their own win rate, and have had many samples long
          enough to feel certain they are broken.
        </p>
      </section>

      <section>
        <h2>Why the answer has to use your numbers</h2>
        <p>
          The table above is somebody else's. Two players at the same stake can
          have standard deviations 40% apart, and the band scales directly with
          it: the loose aggressive player's ordinary month would be a crisis for
          the nit and the nit's would be a quiet week for them.
        </p>
        <p>
          There is no way around measuring your own. You need the result and
          the duration of each session, in big blinds so that stakes pool
          together, and you need enough of them that the estimate is not itself
          noise. Twenty hours and eight sessions is the floor where the numbers
          start to mean something, and it is a floor rather than a target.
        </p>
        <div class="note">
          <p>
            One thing the arithmetic cannot do: prove you are playing well. A
            stretch inside the band is consistent with running bad <em>and</em>
            with a leak that costs you less than the noise hides. What it rules
            out is the panic, which is worth a great deal on its own, because
            the panic is what makes the leak.
          </p>
        </div>
      </section>

      <section>
        <h2>What to do with a stretch that is outside the band</h2>
        <p>
          One stretch in forty finishes below a 95% band, so seeing one is not
          evidence of much. Two things are worth doing anyway, and neither is
          quitting.
        </p>
        <ul>
          <li>
            <strong>Check the sample, not the story.</strong> Was it one stake
            or four? One game type? A run of sessions that all started after
            midnight? A band computed across conditions you no longer play in
            is answering a question you did not ask.
          </li>
          <li>
            <strong>Protect the bankroll before the ego.</strong> A stretch this
            cold does not predict the next one, but it has already changed how
            much cushion you have. That is an arithmetic problem with an
            arithmetic answer.
          </li>
        </ul>
        <p>
          And the thing that is genuinely not variance: the decisions you make
          in the ten minutes after a hand goes wrong. Those are not in any
          band, and they are the only part of a downswing you control.
        </p>
      </section>

${next({
  verb: 'Observe',
  name: 'Log',
  href: '/app',
  what:
    'Log estimates both numbers from your own completed sessions, draws the band around your real curve, and answers the question at the top of this page in a sentence. A session takes under ten seconds to record. All of it is free, it works offline, and it needs no account: nothing leaves your device unless you sign in to carry it to another one.',
})}
`,
};

/* ---------------------------------------------------------------- page 2 */

const bankroll = {
  slug: '/bankroll',
  title: 'How big a bankroll, and where 20 buy-ins comes from',
  description:
    'Risk of ruin has a closed form: exp(-2wB/s squared). Run the numbers and the famous 20 buy-in rule turns out to depend far more on your win rate than on the 20.',
  updated: '2026-09-03',
  body: `      <header>
        <p class="eyebrow">Observe</p>
        <h1>How big a bankroll?</h1>
        <p class="lede">
          Everyone has heard 20 buy-ins, or 30, or 50. The number by itself is
          useless, because the thing it protects against depends on two
          quantities nobody quotes alongside it. Here is the actual formula and
          what it says.
        </p>
      </header>

      <section>
        <h2>Risk of ruin, exactly</h2>
        <p>
          Treat results as the same random walk as before: drift <code>w</code>
          big blinds an hour, standard deviation <code>s</code> big blinds an
          hour. Starting from a bankroll of <code>B</code> big blinds, the
          chance that the walk ever touches zero is
        </p>
        <p><code>risk of ruin = e<sup>-2wB/s&sup2;</sup></code></p>
        <p>
          Three things fall straight out of that, and all three are worth more
          than the rule of thumb.
        </p>
        <ul>
          <li>
            Risk of ruin falls <em>exponentially</em> in bankroll. Each extra
            buy-in is worth more than the last one was, in proportion.
          </li>
          <li>
            It falls exponentially in win rate too, and in exactly the same way.
            Doubling your win rate does what doubling your bankroll does.
          </li>
          <li>
            It rises with the <em>square</em> of the standard deviation. A game
            with 40% more swing needs twice the roll for the same safety.
          </li>
        </ul>
      </section>

      <section>
        <h2>The numbers</h2>
        <p>
          At a standard deviation of 50 big blinds an hour, with buy-ins of 100
          big blinds:
        </p>
        <div class="scroll">
          <table aria-describedby="table-note">
            <thead>
              <tr>
                <th scope="col">Win rate</th>
${RUIN_BUY_INS.map((n) => `                <th scope="col">${n} buy-ins</th>`).join('\n')}
              </tr>
            </thead>
            <tbody>
${RUIN_RATES.map(
  ({ winRate, label }) => `              <tr>
                <td>${label}</td>
${RUIN_BUY_INS.map((n) => {
  const value = ruin(n, winRate);
  return `                <td class="num${n === 20 ? ' lit' : ''}">${pctSignificant(value)}</td>`;
}).join('\n')}
              </tr>`,
).join('\n')}
            </tbody>
          </table>
        </div>
        <p class="caption" id="table-note">
          Chance of ever going broke, if the win rate and the swings stay
          what they are and you never move down. That last clause is doing
          a lot of work, and it is why these are floors rather than
          promises.
        </p>
        <p>
          Look along the 20 buy-in column. For the solid winner it is
          ${pctSignificant(ruin(20, 5))}, which is about as safe as anything in
          poker gets. For the small winner, the same 20 buy-ins is
          <strong>${pctSignificant(ruin(20, 2.5))}</strong>, roughly
          ${Math.round(ruin(20, 2.5) / ruin(20, 5))} times riskier, at the same
          stake with the same swings.
        </p>
        <p>
          The second bullet above is sitting in that table if you read it
          diagonally: ${pctSignificant(ruin(5, 5))} appears at 5 buy-ins for
          the solid winner and at 10 for the small one, and
          ${pctSignificant(ruin(10, 5))} appears at 10 and at 20. Doubling the
          win rate really does buy exactly what doubling the roll buys.
        </p>
        <p>
          That is the part the rule of thumb hides. Twenty buy-ins is not a
          property of the game. It is a property of the game <em>and</em> how
          much you beat it for, and most people quoting it have never measured
          the second half.
        </p>
      </section>

      <section>
        <h2>What the formula leaves out</h2>
        <ul>
          <li>
            <strong>Moving down.</strong> Nobody actually plays their last buy-in
            at the same stake. Dropping a level partway through resets the walk
            in units that are twice as large, which is why real players survive
            rolls this model would ruin.
          </li>
          <li>
            <strong>Life.</strong> Bankroll leaving the table for rent is a
            second, steady, downward drift, and it belongs in <code>w</code>. A
            player who withdraws their whole win rate has a risk of ruin of one.
          </li>
          <li>
            <strong>Your win rate is an estimate.</strong> This is the big one.
            The formula wants a true win rate and you have a measurement, and
            over a few hundred hours that measurement is worth about as much as
            the band on the
            <a href="/running-bad">running bad page</a> suggests. Being wrong by
            2 bb an hour moves you between two rows of the table above.
          </li>
        </ul>
        <div class="note">
          <p>
            The honest use of this table is not to find the smallest roll you
            can survive on. It is to see how much of your safety comes from the
            number you know least well, and to keep enough cushion that being
            wrong about it is survivable.
          </p>
        </div>
      </section>

${next({
  verb: 'Observe',
  name: 'Log',
  href: '/app',
  what:
    'Both inputs to the formula come out of a session log and nowhere else. Log estimates your win rate and your standard deviation from your own completed sessions, in big blinds, so sessions at different stakes pool into one answer instead of three guesses.',
})}
`,
};

/* ---------------------------------------------------------------- page 3 */

const potOdds = {
  slug: '/pot-odds',
  title: 'Pot odds, outs, and where the rule of 4 goes wrong',
  description:
    'The rule of 2 and 4 is close enough with eight outs and badly wrong with fifteen. The exact numbers, why the rule drifts, and the condition almost nobody states out loud.',
  updated: '2026-09-03',
  body: `      <header>
        <p class="eyebrow">Learn</p>
        <h1>Pot odds, outs, and the rule that is nearly right</h1>
        <p class="lede">
          Count your outs, multiply by four on the flop and two on the turn.
          It is the best shortcut in poker and it has two failure modes, one of
          which costs money every session.
        </p>
      </header>

      <section>
        <h2>Pot odds in one line</h2>
        <p>
          You are being asked to call <code>c</code> into a pot that already
          holds <code>p</code>. Calling wins <code>p + c</code> when it is good
          and loses <code>c</code> when it is not, so it breaks even when you
          are good <code>c / (p + 2c)</code> of the time.
        </p>
        <p>
          A $20 call into a $60 pot needs 20 / 100, so 20%. That is the number
          to compare your equity against, and everything below is about getting
          the equity right.
        </p>
      </section>

      <section>
        <h2>The exact equities</h2>
        <p>
          After the flop you have seen five cards, so 47 are unseen. Two of them
          are coming. The chance that none of your <code>k</code> outs
          arrives is the chance both cards come from the other
          <code>47 - k</code>, and everything else is the chance you hit.
        </p>
        <div class="scroll">
          <table aria-describedby="table-note">
            <thead>
              <tr>
                <th scope="col">Outs</th>
                <th scope="col">By the river</th>
                <th scope="col">Rule of 4</th>
                <th scope="col">River only</th>
                <th scope="col">Rule of 2</th>
              </tr>
            </thead>
            <tbody>
${OUTS_ROWS.map((row) => {
  const drift = row.ruleOfFour - row.byRiver;
  const bad = drift > 0.02;
  return `              <tr>
                <td>${row.outs}${row.outs === 9 ? ' (flush draw)' : row.outs === 8 ? ' (open-ended)' : row.outs === 4 ? ' (gutshot)' : ''}</td>
                <td class="num">${pct(row.byRiver)}</td>
                <td class="num${bad ? ' lit' : ''}">${pct(row.ruleOfFour, 0)}</td>
                <td class="num">${pct(row.onRiver)}</td>
                <td class="num">${pct(row.ruleOfTwo, 0)}</td>
              </tr>`;
}).join('\n')}
            </tbody>
          </table>
        </div>
        <p class="caption" id="table-note">
          Exact, by counting: 1 - C(47-k, 2) / C(47, 2) with two cards to
          come, and k / 46 with one.
        </p>
        <p>
          Through nine outs the rule is within a point, which is closer than
          your read is. Past twelve it drifts, and at fifteen outs it claims
          ${pct(OUTS_ROWS[6].ruleOfFour, 0)} against a real
          ${pct(OUTS_ROWS[6].byRiver)}, an overstatement of about
          ${Math.round((OUTS_ROWS[6].ruleOfFour - OUTS_ROWS[6].byRiver) * 100)}
          points. The reason is simple double counting: multiplying by four
          counts the runouts where you hit twice, once for each card.
        </p>
      </section>

      <section>
        <h2>The condition nobody states</h2>
        <p>
          The rule of 4 answers "how often do I get there by the river". You
          only get to use that answer if <strong>no further bet stands between
          you and the river</strong>, which in practice means one of you is
          all-in.
        </p>
        <p>
          Facing a flop bet with more money behind, the card you are about to
          see is the turn, and only the turn. The right number is the
          <em>river only</em> column, and the flush draw everyone calls a 36%
          shot is a ${pct(OUTS_ROWS[4].onRiver)} shot for the price in front of
          you. Using the by-the-river number for a call that only buys one card
          is the single most expensive habit this shortcut creates.
        </p>
        <div class="note">
          <p>
            Implied odds are the honest counter-argument, and they are real: the
            money you win on the turn when you hit can more than cover the gap.
            But implied odds are an estimate of somebody else's future behavior,
            and the two-card equity is an estimate of nothing. Do not let one
            quietly stand in for the other.
          </p>
        </div>
      </section>

      <section>
        <h2>Counting the outs themselves</h2>
        <p>
          The arithmetic above is exact, and the input to it usually is not.
          Two ways the count goes wrong more often than the multiplication does:
        </p>
        <ul>
          <li>
            <strong>Outs that lose anyway.</strong> The card that fills your
            straight also puts three to a flush out there. It is not an out, and
            counting it is how an 8-out draw becomes a 6-out draw with a story.
          </li>
          <li>
            <strong>Double counted overlaps.</strong> A flush draw plus an
            open-ended straight draw is 15 outs, not 17: two of the straight
            cards are already in the flush count.
          </li>
        </ul>
      </section>

${next({
  verb: 'Learn',
  name: 'TiltProof',
  href: 'https://tiltproof.poker',
  what:
    'Drills that make the count automatic: real spots, an answer marked against a hand evaluator rather than a table somebody typed up, and the exact equity shown next to what you said. The early levels and the whole glossary are free. The point is to stop needing the shortcut.',
})}
`,
};

/* ---------------------------------------------------------------- page 4 */

const tilt = {
  slug: '/tilt',
  title: 'Tilt is a state before it is a decision',
  description:
    'The hand that set you off costs one pot. The two hours after it cost more, and they are the only part of a downswing you actually control. What tilt does, and what works at the table.',
  updated: '2026-09-03',
  body: `      <header>
        <p class="eyebrow">Ground</p>
        <h1>Tilt is a state before it is a decision</h1>
        <p class="lede">
          Everything on the other pages here is arithmetic about things you do
          not control. This is the one page about the part you do.
        </p>
      </header>

      <section>
        <h2>The arithmetic of it</h2>
        <p>
          A bad beat costs you the pot, and the pot is the small number. Say it
          takes two hours to come back to yourself, and over those two hours
          you play three big blinds an hour worse than usual: wider preflop,
          one more thin call, one bluff at somebody who was never folding.
        </p>
        <p>
          That is six big blinds, on top of the pot, off a hand that was already
          decided. Do it twice a month and you have given back the win rate the
          <a href="/bankroll">bankroll math</a> was counting on, and the
          <a href="/running-bad">band</a> will not show it to you as a leak,
          because it looks exactly like variance from the outside.
        </p>
        <div class="note">
          <p>
            This is the asymmetry worth sitting with. Variance is large,
            unavoidable and eventually neutral. Tilt is smaller, avoidable and
            never neutral. Almost all the attention goes to the first one.
          </p>
        </div>
      </section>

      <section>
        <h2>What is actually happening</h2>
        <p>
          Tilt gets discussed as a character failing, which is both unkind and
          useless. What it is closer to is a physiological state: a stress
          response, with a heart rate and a breathing pattern and a narrowed
          attention, that arrived before you had an opinion about it.
        </p>
        <p>
          That matters for one practical reason. You cannot reason your way out
          of a state you did not reason your way into. Telling yourself the call
          was correct does not work, because the part of you that needs
          convincing is not listening to arguments. What does work is changing
          the state directly, and the state has physical inputs.
        </p>
      </section>

      <section>
        <h2>What works at the table</h2>
        <ul>
          <li>
            <strong>Sit out one orbit.</strong> Not as punishment. The single
            most reliable predictor of a tilt hand is that it came within a few
            minutes of the last one, and standing up breaks that.
          </li>
          <li>
            <strong>Breathe out longer than you breathe in.</strong> The
            crudest possible intervention, and the one that acts on the state
            rather than on the story about it. A long exhale is a direct lever
            on the system that is currently running you.
          </li>
          <li>
            <strong>Name the number.</strong> "That was a 4 big blind pot" is
            not a coping mechanism, it is a correction. Tilt inflates the size
            of what just happened, and saying the real figure out loud deflates
            it faster than reassurance does.
          </li>
          <li>
            <strong>Decide the stop-loss before the session.</strong> A limit
            set in advance is a decision by somebody who was not upset. A limit
            set at the time is a negotiation you will lose.
          </li>
        </ul>
        <p>
          And the one that is not a technique: notice it earlier. Almost nobody
          catches tilt at the start, because at the start it does not feel like
          tilt. It feels like clarity, and a sudden certainty about what
          somebody else has.
        </p>
      </section>

      <section>
        <h2>What does not work</h2>
        <ul>
          <li>
            <strong>Playing through it to prove a point.</strong> The point gets
            proved to nobody and costs the six big blinds above.
          </li>
          <li>
            <strong>Reviewing the hand immediately.</strong> Do review it. Not
            now: the review you do while upset finds the answer you are already
            committed to.
          </li>
          <li>
            <strong>Moving up to get it back.</strong> Larger stakes have larger
            swings, and the
            <a href="/bankroll">risk of ruin formula</a> squares that term. This
            is the single fastest way to turn a bad night into a bad year.
          </li>
        </ul>
      </section>

${next({
  verb: 'Ground',
  name: 'Untilt',
  href: 'https://untilt.poker',
  what:
    'Short guided sessions written for poker players rather than adapted from something else: before you sit down, between the hands, and after the last one. The at-the-table resets are free, permanently, because the moment you need one is not the moment to be asked for a card.',
})}
`,
};

/* ------------------------------------------------------------------ main */

const PAGES = [runningBad, bankroll, potOdds, tilt];

const check = process.argv.includes('--check');
let stale = 0;

for (const page of PAGES) {
  const target = join(PUBLIC, `${page.slug.slice(1)}.html`);
  const html = render(page);
  let current = null;
  try {
    current = readFileSync(target, 'utf8');
  } catch {
    current = null;
  }

  if (check) {
    if (current !== html) {
      stale += 1;
      console.error(`${page.slug} is out of date. Run: npm run build:content`);
    }
    continue;
  }

  writeFileSync(target, html);
  console.log(`public${page.slug}.html  ${Math.round(html.length / 102.4) / 10}KB  ${page.title}`);
}

if (check) {
  if (stale > 0) process.exit(1);
  console.log(`${PAGES.length} content pages are up to date.`);
}
