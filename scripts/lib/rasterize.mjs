/**
 * Headless Chrome as a rasterizer, and the PNG surgery that goes with it.
 *
 * The icons are drawn in code by `scripts/generate-icons.mjs` and need nothing
 * installed. The chip faces are the exception: they set type, so they want a
 * layout engine and the font stacks rather than a viewBox, and what comes off
 * them goes to a printer rather than to a screen.
 *
 * Ported from the same file in the Untilt repository, where the two awkward
 * parts below were worked out. They are worth keeping intact: a face that is
 * nearly the right size is a chip with a stripe of browser chrome fired into
 * the glaze, and nothing about the file says so.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { crc32, deflateSync, inflateSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CANDIDATES = [
  process.env.CHROME,
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

/* ------------------------------------------------------------------- png */

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])), 0);
  return Buffer.concat([head, data, crc]);
}

function readChunks(png) {
  if (!png.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error('not a PNG');
  const chunks = [];
  let at = 8;
  while (at < png.length) {
    const length = png.readUInt32BE(at);
    chunks.push({
      type: png.toString('ascii', at + 4, at + 8),
      data: png.subarray(at + 8, at + 8 + length),
    });
    at += 12 + length;
  }
  return chunks;
}

/** Width and height straight out of the PNG's IHDR chunk. */
export function pngSize(png) {
  if (png.toString('ascii', 1, 4) !== 'PNG') return null;
  return { width: png.readUInt32BE(16), height: png.readUInt32BE(20) };
}

/**
 * Keep the top-left width x height pixels and drop the rest.
 *
 * Only ever trims, which is what makes this safe without a real PNG decoder:
 * every filter type looks backwards, at bytes earlier in its own row and at
 * the same position in the row above, so a prefix of the scanlines, and a
 * prefix of each scanline, still decodes on its own.
 */
export function cropTopLeft(png, width, height) {
  const chunks = readChunks(png);
  const header = chunks.find((c) => c.type === 'IHDR');
  if (!header) throw new Error('PNG has no IHDR');

  const source = { width: header.data.readUInt32BE(0), height: header.data.readUInt32BE(4) };
  const depth = header.data[8];
  const colorType = header.data[9];
  if (header.data[12] !== 0) throw new Error('interlaced PNG is not supported');
  if (depth !== 8) throw new Error(`unsupported bit depth ${depth}`);

  const channels = { 0: 1, 2: 3, 4: 2, 6: 4 }[colorType];
  if (!channels) throw new Error(`unsupported color type ${colorType}`);
  if (width > source.width || height > source.height) {
    throw new Error(`cannot crop ${source.width}x${source.height} up to ${width}x${height}`);
  }
  if (width === source.width && height === source.height) return png;

  const raw = inflateSync(
    Buffer.concat(chunks.filter((c) => c.type === 'IDAT').map((c) => c.data)),
  );

  const sourceStride = 1 + source.width * channels;
  const keep = 1 + width * channels;
  const rows = [];
  for (let y = 0; y < height; y += 1) {
    rows.push(raw.subarray(y * sourceStride, y * sourceStride + keep));
  }

  const ihdr = Buffer.from(header.data);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);

  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(Buffer.concat(rows), { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/* ------------------------------------------------------------------ chrome */

/**
 * A rasterizer, and a scratch directory to work in. Call close() when done.
 *
 * `tool` only ever appears in the message printed when no Chrome can be found,
 * so that the hint names the command the reader actually ran.
 */
export function openRasterizer(tool) {
  const chrome = CANDIDATES.find((path) => existsSync(path));
  if (!chrome) {
    console.error(
      'No Chrome or Chromium found. Install one, or set CHROME to its path:\n' +
        `  CHROME=/path/to/chrome node scripts/${tool}`,
    );
    process.exit(1);
  }

  const work = mkdtempSync(join(tmpdir(), 'log-render-'));
  let counter = 0;

  function run(args) {
    return execFileSync(
      chrome,
      [
        '--headless',
        '--no-sandbox',
        '--disable-gpu',
        '--hide-scrollbars',
        '--force-device-scale-factor=1',
        ...args,
      ],
      { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' },
    );
  }

  /**
   * --window-size sizes the *window*, and Chrome's newer headless mode still
   * reserves a slice of it for browser chrome (87px tall as of Chromium 141)
   * while screenshotting the window in full. The old headless_shell binary
   * reserves nothing. Rather than guess which one we got, ask a page how much
   * room it actually ended up with.
   */
  const inset = (() => {
    const probe = join(work, 'probe.html');
    const asked = 600;
    writeFileSync(
      probe,
      `<!doctype html><meta charset="utf-8"><b id="o"></b>
<script>o.textContent = "SIZE:" + innerWidth + "x" + innerHeight;</script>`,
    );

    const dom = run([`--window-size=${asked},${asked}`, '--dump-dom', `file://${probe}`]);
    const found = /SIZE:(\d+)x(\d+)/.exec(dom);
    if (!found) throw new Error('could not measure the headless viewport');
    return { x: asked - Number(found[1]), y: asked - Number(found[2]) };
  })();

  return {
    /**
     * Screenshot a page, given either its markup or the path to a file, and
     * hand back a PNG that is exactly width x height.
     */
    shot({ html, file, width, height }) {
      const id = `shot-${counter}`;
      counter += 1;
      let source = file;
      if (!source) {
        source = join(work, `${id}.html`);
        writeFileSync(source, html);
      }

      const raw = join(work, `${id}.png`);
      run([
        // The window is grown to give the viewport its full size; the
        // screenshot comes back at window size, so the chrome is trimmed
        // straight back off below.
        `--window-size=${width + inset.x},${height + inset.y}`,
        `--screenshot=${raw}`,
        `file://${source}`,
      ]);

      const png = cropTopLeft(readFileSync(raw), width, height);
      const size = pngSize(png);
      if (!size || size.width !== width || size.height !== height) {
        throw new Error(
          `render came out ${size ? `${size.width}x${size.height}` : 'unreadable'}, ` +
            `expected ${width}x${height}`,
        );
      }
      return png;
    },

    close() {
      rmSync(work, { recursive: true, force: true });
    },
  };
}
