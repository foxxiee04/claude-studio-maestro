#!/usr/bin/env node
import { chromium } from 'playwright-core';
import sharp from 'sharp';
import path from 'node:path';
import fs from 'node:fs';

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const ORIENTATIONS = new Set(['landscape', 'portrait', 'squarish']);

function usage() {
  return [
    'usage: node scout/photos.mjs --out <absolute dir> --q "<query>|<orientation>|<count>" [--q ...]',
    '                              [--width 1600] [--sheet <png path>]',
  ].join('\n');
}

function parseArgs(argv) {
  const opts = { out: null, queries: [], width: 1600, sheet: null };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const take = () => {
      const value = argv[++i];
      if (value == null) throw new Error(`missing value for ${arg}`);
      return value;
    };
    if (arg === '--out') opts.out = take();
    else if (arg === '--q') opts.queries.push(take());
    else if (arg === '--width') opts.width = take();
    else if (arg === '--sheet') opts.sheet = take();
    else if (arg === '--help' || arg === '-h') {
      console.log(usage());
      process.exit(0);
    } else throw new Error(`unknown argument: ${arg}`);
  }
  if (!opts.out) throw new Error('--out is required');
  if (!opts.queries.length) throw new Error('at least one --q is required');

  const width = Number.parseInt(opts.width, 10);
  if (!Number.isFinite(width) || width < 100) throw new Error('--width must be >= 100');
  opts.width = width;

  opts.queries = opts.queries.map((raw) => {
    const parts = raw.split('|');
    const query = (parts[0] || '').trim();
    let orientation = (parts[1] || 'landscape').trim().toLowerCase();
    if (!ORIENTATIONS.has(orientation)) orientation = 'landscape';
    const count = Number.parseInt(parts[2], 10);
    return {
      query,
      orientation,
      count: Number.isFinite(count) && count > 0 ? Math.min(count, 30) : 4,
    };
  });
  if (opts.queries.some((q) => !q.query)) throw new Error('empty query in --q');
  return opts;
}

function slugify(query) {
  return query.toLowerCase().trim().replace(/\s+/g, '-');
}

function photoIdFromUrl(src) {
  const clean = src.split('?')[0];
  const match = clean.match(/\/photo-(.+)$/);
  return match ? match[1] : '';
}

async function launchBrowser() {
  try {
    return await chromium.launch({ channel: 'msedge', headless: true });
  } catch {
    return await chromium.launch({ channel: 'chrome', headless: true });
  }
}

async function collect(browser, { query, orientation, count }, seen) {
  const slug = slugify(query);
  const url = `https://unsplash.com/s/photos/${encodeURIComponent(slug)}?orientation=${encodeURIComponent(orientation)}`;
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: UA,
  });
  const page = await context.newPage();
  const picked = [];
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    try {
      await page.waitForFunction(() => !document.title.includes('Checking'), null, {
        timeout: 20000,
        polling: 250,
      });
    } catch {
      console.error(`warn: still on the checking page for "${query}"`);
    }
    await page.waitForTimeout(2000);
    for (let i = 0; i < 2; i++) {
      await page.evaluate(() => window.scrollBy(0, window.innerHeight * 0.9));
      await page.waitForTimeout(800);
    }

    const found = await page.evaluate(() =>
      [...document.querySelectorAll('img')]
        .filter((m) => /images\.unsplash\.com\/photo-/.test(m.src))
        .map((m) => ({ alt: m.alt || '', src: m.src.split('?')[0] }))
    );

    for (const item of found) {
      if (picked.length >= count) break;
      if (item.src.includes('plus.unsplash.com')) continue;
      const id = photoIdFromUrl(item.src);
      if (!id || seen.has(id)) continue;
      seen.add(id);
      picked.push({ alt: item.alt.trim().replace(/\s+/g, ' '), id });
    }
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  }
  return { query, orientation, slug, picked, pageUrl: url };
}

async function downloadAndSave(photo, { slug, index, width, out }) {
  const url = `https://images.unsplash.com/photo-${photo.id}?w=${width}&q=80&fm=jpg`;
  const res = await fetch(url, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.timeout(30000),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) throw new Error('empty image');

  const stats = await sharp(buf).resize({ width: 48 }).removeAlpha().stats();
  const channels = stats.channels || [];
  const r = channels[0]?.mean ?? 0;
  const g = channels[1]?.mean ?? r;
  const b = channels[2]?.mean ?? r;
  const luma = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);

  const webp = await sharp(buf)
    .resize({ width, withoutEnlargement: true })
    .webp({ quality: 78 })
    .toBuffer();
  const meta = await sharp(webp).metadata();

  const file = `${slug}-${index}.webp`;
  const absPath = path.join(out, file);
  fs.writeFileSync(absPath, webp);

  return {
    file,
    query: photo.query,
    orientation: photo.orientation,
    alt: photo.alt,
    id: photo.id,
    luma,
    width: meta.width || width,
    height: meta.height || 0,
    page: `https://unsplash.com/photos/${photo.id}`,
    absPath,
  };
}

function escapeXml(value) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

async function buildContactSheet(entries, sheetPath) {
  const cellW = 300;
  const cellH = 200;
  const labelH = 26;
  const gap = 8;
  const pad = 12;
  const cols = 5;
  const rows = Math.ceil(entries.length / cols);
  const width = pad * 2 + cols * cellW + (cols - 1) * gap;
  const height = pad * 2 + rows * (cellH + labelH) + (rows - 1) * gap;

  const tiles = [];
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    const base = await sharp(entry.absPath)
      .resize(cellW, cellH, { fit: 'cover', position: 'centre' })
      .toBuffer();

    let label = `${entry.file}  L${entry.luma}`;
    if (label.length > 46) label = `${label.slice(0, 45)}…`;
    const labelSvg = Buffer.from(
      `<svg width="${cellW}" height="${labelH}" xmlns="http://www.w3.org/2000/svg">` +
        `<rect width="100%" height="100%" fill="#101014"/>` +
        `<text x="8" y="18" font-family="Segoe UI, Arial, sans-serif" font-size="12" fill="#eaeaf2">${escapeXml(label)}</text>` +
        `</svg>`
    );

    const tile = await sharp(base)
      .extend({ bottom: labelH, background: '#101014' })
      .composite([{ input: labelSvg, top: cellH, left: 0 }])
      .png()
      .toBuffer();

    tiles.push({
      input: tile,
      left: pad + (i % cols) * (cellW + gap),
      top: pad + Math.floor(i / cols) * (cellH + labelH + gap),
    });
  }

  const sheet = await sharp({
    create: { width, height, channels: 3, background: '#08080b' },
  })
    .composite(tiles)
    .png()
    .toBuffer();

  fs.mkdirSync(path.dirname(sheetPath), { recursive: true });
  fs.writeFileSync(sheetPath, sheet);
  return { width, height, rows };
}

function mergePhotosJson(out, fresh) {
  const filePath = path.join(out, 'photos.json');
  let existing = [];
  if (fs.existsSync(filePath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      if (Array.isArray(parsed)) existing = parsed;
      else console.error('warn: existing photos.json is not an array, replacing it');
    } catch {
      console.error('warn: could not parse existing photos.json, replacing it');
    }
  }

  const incoming = new Map(fresh.map((entry) => [entry.file, entry]));
  const merged = [];
  for (const entry of existing) {
    if (!entry || typeof entry.file !== 'string') continue;
    if (incoming.has(entry.file)) {
      merged.push(incoming.get(entry.file));
      incoming.delete(entry.file);
    } else {
      merged.push(entry);
    }
  }
  for (const entry of incoming.values()) merged.push(entry);

  fs.writeFileSync(filePath, `${JSON.stringify(merged, null, 2)}\n`);
  return filePath;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const out = path.resolve(opts.out);
  fs.mkdirSync(out, { recursive: true });
  const sheetPath = opts.sheet ? path.resolve(opts.sheet) : path.join(out, '_contact-sheet.png');

  const seen = new Set();
  const results = [];
  let browser;
  try {
    browser = await launchBrowser();
    for (const spec of opts.queries) {
      let collected;
      try {
        collected = await collect(browser, spec, seen);
      } catch (err) {
        console.error(`warn: could not search "${spec.query}": ${err.message}`);
        continue;
      }
      if (!collected.picked.length) {
        console.error(`warn: no free photos found for "${spec.query}"`);
        continue;
      }
      let index = 1;
      for (const photo of collected.picked) {
        try {
          const entry = await downloadAndSave(
            { ...photo, query: spec.query, orientation: spec.orientation },
            { slug: collected.slug, index, width: opts.width, out }
          );
          results.push(entry);
          index += 1;
        } catch (err) {
          console.error(`warn: could not download ${photo.id}: ${err.message}`);
        }
      }
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  if (!results.length) {
    console.error('no photos downloaded');
    process.exitCode = 1;
    return;
  }

  const clean = results.map(({ absPath, ...rest }) => rest);
  const jsonPath = mergePhotosJson(out, clean);

  for (const entry of clean) {
    console.log(`${entry.file}  L${entry.luma}  ${entry.width}x${entry.height}  ${entry.page}  ${entry.alt}`);
  }
  console.log(jsonPath);

  try {
    const sheet = await buildContactSheet(results, sheetPath);
    console.log(`${sheetPath}  ${sheet.width}x${sheet.height} (${sheet.rows} row${sheet.rows === 1 ? '' : 's'})`);
  } catch (err) {
    console.error(`warn: could not build contact sheet: ${err.message}`);
  }
}

main().catch((err) => {
  console.error(`error: ${err.message}`);
  console.error(usage());
  process.exitCode = 2;
});
