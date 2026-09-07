/**
 * House style, enforced.
 *
 * Two rules, both about copy a player might read and about the comments and
 * docs around it:
 *
 *  - No en or em dashes. Rewrite as a comma, a colon, or parentheses.
 *  - American spellings.
 *
 * The same rule holds in all three repositories in this family, and this one
 * was the last to enforce it: 241 dashes across 85 files and every British
 * spelling below had accumulated here while the other two were clean, because
 * nothing was checking. A rule nobody checks is a preference.
 *
 * Run it with `npm run check:prose`. It reads tracked files and new ones that
 * are not ignored, so a file is checked before it is committed rather than
 * after; anything ignored, `dist/` included, is out of scope.
 *
 * The list of spellings only ever catches the words on it, which is not a
 * hypothetical: `rasterised` sat in the icon script here, in TiltProof and in
 * Untilt at once. When one gets past, add it and its near neighbors.
 *
 * This file exempts itself. It has to name the things it bans.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const SKIP = new Set(['package-lock.json', 'scripts/check-prose.mjs']);
const BINARY = /\.(png|jpg|jpeg|gif|ico|ttf|otf|woff2?|jks|p8|p12|keystore)$/i;

const DASHES = /[\u2013\u2014]/;

/**
 * Not a full list, just the forms that have actually turned up here. Add to it
 * whenever one gets past: `polarised` sat in the drill copy 21 times and
 * `rasterised` in the icon scripts, both for weeks, because a list only catches
 * the words on it.
 */
const BRITISH = [
  'favourite', 'colour', 'coloured', 'behaviour', 'honour', 'honours', 'neighbour',
  'maths', 'recognise', 'recognised', 'recognising', 'memorise', 'memorised', 'memorising',
  'organise', 'organised', 'apologise', 'realise', 'realised', 'analyse', 'analysed',
  'pluralise', 'pluralised', 'normalise', 'normalised', 'initialise', 'initialised',
  'serialise', 'serialised', 'prioritise', 'prioritised', 'summarise', 'summarised',
  'serialisation', 'normalisation', 'initialisation', 'organisation', 'realisation',
  'visualisation', 'customisation', 'optimisation', 'authorisation', 'categorisation',
  'specialisation', 'standardisation', 'synchronisation', 'utilisation', 'localisation',
  'categorise', 'categorised', 'generalise', 'generalised', 'specialise', 'specialised',
  'optimise', 'optimised', 'customise', 'customised', 'visualise', 'visualised',
  'synchronise', 'synchronised', 'authorise', 'authorised', 'emphasise', 'emphasised',
  'minimise', 'minimised', 'maximise', 'maximised', 'utilise', 'utilised', 'capitalise',
  'standardise', 'standardised', 'itemise', 'itemised',
  'levelled', 'levelling', 'modelling', 'labelled', 'travelling', 'cancelled',
  'totalled', 'totalling',
  'centre', 'centred', 'centring', 'grey', 'practise', 'licence', 'defence', 'offence',
  'whilst', 'amongst', 'learnt', 'programme', 'metre', 'judgement', 'ageing', 'sceptical',
  'burnt', 'spelt', 'dreamt', 'cheque', 'catalogue', 'storey', 'fibre', 'litre',
  'travelled', 'traveller', 'counsellor', 'signalling', 'fuelled', 'marvellous',
  'polarise', 'polarised', 'polarising', 'polarisation',
  'rasterise', 'rasterised', 'rasteriser', 'rasterises', 'rasterising',
  'pluralise', 'pluralises', 'deserialise', 'deserialised', 'deserialising',
  'randomise', 'randomised', 'randomising', 'reorganise', 'reorganised', 'reorganising',
  'generalise', 'sanitise', 'sanitised', 'tokenise', 'tokenised', 'localise', 'localised',
  'criticise', 'criticised', 'synthesise', 'synthesised', 'paralyse', 'paralysed',
  'humour', 'flavour', 'rumour', 'armour', 'odour', 'vapour', 'labour', 'harbour',
];

/**
 * Word-bounded, suffix-tolerant, and it treats a capital as a boundary too.
 *
 * A plain `\b...\b` around the list has two holes, and both were open here:
 * `colours` walked past `colour`, and `centreX` walked past `centre`, so the
 * plural of a banned word and the camelCase compound of one were both legal.
 */
/** `colour` and `Colour`, without the /i flag that would blind the lookahead. */
const eitherCase = (word) => `[${word[0].toUpperCase()}${word[0]}]${word.slice(1)}`;

const BRITISH_RE = new RegExp(
  `\\b(${BRITISH.map(eitherCase).join('|')})(s|es|d|ed|r|rs|ing|ly|ment|ments)?(?![a-z])`,
);

const files = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], {
  encoding: 'utf8',
})
  .split('\n')
  .filter((file) => file !== '' && !SKIP.has(file) && !BINARY.test(file));

const problems = [];

for (const file of files) {
  let contents;
  try {
    contents = readFileSync(file, 'utf8');
  } catch {
    continue;
  }

  contents.split('\n').forEach((line, index) => {
    const where = `${file}:${index + 1}`;
    if (DASHES.test(line)) problems.push(`${where}: en or em dash\n    ${line.trim()}`);
    const british = BRITISH_RE.exec(line);
    if (british !== null) problems.push(`${where}: British spelling "${british[1]}"\n    ${line.trim()}`);
  });
}

if (problems.length > 0) {
  console.error(`House style: ${problems.length} problem${problems.length === 1 ? '' : 's'}.\n`);
  for (const problem of problems) console.error(`  ${problem}\n`);
  console.error('Rewrite dashes as a comma, a colon or parentheses, and use American spellings.');
  process.exit(1);
}

console.log(`House style: ${files.length} files clean.`);
