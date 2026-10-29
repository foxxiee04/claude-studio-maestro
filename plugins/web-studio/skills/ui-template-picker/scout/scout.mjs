#!/usr/bin/env node
import { chromium } from 'playwright-core';
import sharp from 'sharp';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync } from 'node:fs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const CATALOG_PATH = path.join(SCRIPT_DIR, 'catalog.json');
const THUMBS_DIR = path.join(SCRIPT_DIR, 'thumbs');
const GALLERY_TEMPLATE = path.resolve(SCRIPT_DIR, '..', 'assets', 'gallery.html');

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

const GETLAYERS_EXTRACT = () =>
  [...document.querySelectorAll('a[href*="/layer/"]')].map((a) => {
    let c = a;
    for (let i = 0; i < 6 && c && !c.querySelector('img,video'); i++) c = c.parentElement;
    const m = c?.querySelector('img,video');
    return {
      title: (a.innerText || '').trim().split('\n')[0],
      url: a.href,
      image: m ? m.currentSrc || m.src || m.getAttribute('poster') || '' : '',
      text: (c?.innerText || '').replace(/\s+/g, ' ').trim(),
    };
  });

const HORIZONX_EXTRACT = () => {
  const urlOf = (el) => {
    let value =
      el.currentSrc ||
      el.src ||
      el.getAttribute('data-src') ||
      el.getAttribute('poster') ||
      '';
    if (!value) {
      const srcset =
        el.getAttribute('srcset') || el.getAttribute('data-srcset') || '';
      value = (srcset.split(',')[0] || '').trim().split(/\s+/)[0] || '';
    }
    return value;
  };
  const isBad = (value) => {
    const lower = value.toLowerCase();
    return !value || lower.split('?')[0].endsWith('.svg') || lower.includes('logo');
  };
  const isPreferred = (value) =>
    /cover|cdn\.horizonx\.so|\/images\/tools\//i.test(value);
  const pickImage = (root) => {
    if (!root) return '';
    const urls = [...root.querySelectorAll('img,video')]
      .map(urlOf)
      .filter((value) => !isBad(value));
    if (!urls.length) return '';
    return urls.find(isPreferred) || urls[0];
  };
  return [...document.querySelectorAll('a[href*="/explore/"], a[href*="/tools/"]')].map((a) => {
    let c = a;
    for (let i = 0; i < 4 && c && !(c.innerText || '').trim(); i++) {
      const parent = c.parentElement;
      if (!parent) break;
      const nested = parent.querySelectorAll('a[href*="/explore/"], a[href*="/tools/"]');
      if (nested.length > 1) break;
      c = parent;
    }
    let image = pickImage(a);
    if (!image) {
      let card = a;
      for (let i = 0; i < 3 && card; i++) {
        card = card.parentElement;
        if (!card) break;
        const nested = card.querySelectorAll('a[href*="/explore/"], a[href*="/tools/"]');
        if (nested.length > 1) break;
        image = pickImage(card);
        if (image) break;
      }
    }
    const lines = (c?.innerText || '')
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);
    const isNoise = (line) => /^(new|premium|free|pro|logo|horizonx|·)$/i.test(line);
    const alt = (a.querySelector('img')?.alt || '').trim();
    const altIsName =
      alt && !/^logo$/i.test(alt) && !/^horizonx'?s? avatar$/i.test(alt);
    const title = altIsName
      ? alt
      : lines.find((line) => !isNoise(line)) || lines[0] || '';
    const titleIndex = lines.findIndex((line) => line === title);
    const tail = titleIndex >= 0 ? lines.slice(titleIndex + 1) : lines;
    const desc = tail.find((line) => line !== title && !isNoise(line)) || '';
    return {
      url: a.href,
      image,
      alt,
      title,
      desc,
      text: lines.join(' ').slice(0, 200),
    };
  });
};

const WEBILD_EXTRACT = () =>
  [...document.querySelectorAll('img')]
    .filter((m) => {
      const raw = m.currentSrc || m.src || '';
      let decoded = raw;
      try {
        decoded = decodeURIComponent(raw);
      } catch {
        decoded = raw;
      }
      return /\/templates\//.test(raw) || /\/templates\//.test(decoded);
    })
    .map((m) => {
      let c = m;
      for (let i = 0; i < 6 && c && (c.innerText || '').trim().length < 3; i++) c = c.parentElement;
      const lines = (c?.innerText || '')
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      return {
        title: m.alt || lines[0] || '',
        desc: lines.find((l) => l !== m.alt) || '',
        image: m.currentSrc || m.src,
      };
    });

const UILIVE_EXTRACT = () =>
  [...document.querySelectorAll('a[href*="/post/"]')].map((a) => {
    const m = a.querySelector('img');
    return {
      url: a.href,
      image: m ? m.currentSrc || m.src : '',
      title: m?.alt || (a.innerText || '').split('\n')[0].trim(),
    };
  });

const RUDRAYTE_EXTRACT = () =>
  [...document.querySelectorAll('img')]
    .filter((m) => /\/projects\//.test(m.currentSrc || m.src))
    .map((m) => ({ title: m.alt, image: m.currentSrc || m.src }));

const PROMPTMOTION_EXTRACT = () =>
  [...document.querySelectorAll('a[href]')]
    .filter(
      (a) =>
        a.querySelector('img,video') &&
        /^\/[a-z0-9-]+-[0-9a-f]{6,7}$/i.test(new URL(a.href).pathname)
    )
    .map((a) => {
      const m = a.querySelector('img,video');
      return {
        url: a.href,
        image: m.getAttribute('poster') || m.currentSrc || m.src || m.dataset?.src || '',
        title: (a.innerText || m.alt || '').replace(/\s+/g, ' ').trim(),
      };
    });

const MOTIONSITES_EXTRACT = () =>
  [...document.querySelectorAll('h2,h3,h4')].map((h) => {
    let c = h;
    for (let i = 0; i < 5 && c && !c.querySelector('img,video'); i++) c = c.parentElement;
    const m = c?.querySelector('img,video');
    const btn = c?.querySelector('[aria-label="Copy prompt"],[aria-label="Unlock prompt"]');
    return {
      title: h.innerText.trim(),
      cat: (h.nextElementSibling?.innerText || '').trim(),
      image: m ? (m.getAttribute('poster') || m.currentSrc || m.src || '') : '',
      locked: btn?.getAttribute('aria-label') === 'Unlock prompt',
      hasCopy: btn?.getAttribute('aria-label') === 'Copy prompt',
    };
  }).filter((x) => x.title && x.image);

const SOURCES = {
  getlayers: {
    sourceName: 'GetLayers',
    origin: 'https://www.getlayers.ai',
    pages: [
      { url: 'https://www.getlayers.ai/templates', category: 'template' },
      { url: 'https://www.getlayers.ai/sections', category: 'section' },
      { url: 'https://www.getlayers.ai/3d-scenes', category: '3d' },
      { url: 'https://www.getlayers.ai/gradients', category: 'gradient' },
    ],
    extract: GETLAYERS_EXTRACT,
    build: buildGetlayers,
    dedupe: 'url',
  },
  horizonx: {
    sourceName: 'HorizonX',
    origin: 'https://horizonx.so',
    pages: [
      { url: 'https://horizonx.so/explore', category: 'template' },
      { url: 'https://horizonx.so/tools', category: 'tool' },
    ],
    extract: HORIZONX_EXTRACT,
    build: buildHorizonx,
    dedupe: 'url',
    scrollExtract: true,
  },
  webild: {
    sourceName: 'Webild',
    origin: 'https://www.webild.io',
    pages: [{ url: 'https://www.webild.io/templates', category: 'template' }],
    extract: WEBILD_EXTRACT,
    build: buildWebild,
    dedupe: 'title',
  },
  uilive: {
    sourceName: 'ui.live',
    origin: 'https://ui.live',
    pages: [{ url: 'https://ui.live/explore', category: 'design' }],
    extract: UILIVE_EXTRACT,
    build: buildUilive,
    dedupe: 'url',
  },
  rudrabyte: {
    sourceName: 'RudraByte',
    origin: 'https://www.rudrabyte.site',
    pages: [{ url: 'https://www.rudrabyte.site/projects', category: 'project' }],
    extract: RUDRAYTE_EXTRACT,
    build: buildRudrabyte,
    dedupe: 'title',
  },
  promptmotion: {
    sourceName: 'Prompt Motion',
    origin: 'https://prompt-motion.com',
    pages: [{ url: 'https://prompt-motion.com/', category: 'motion' }],
    extract: PROMPTMOTION_EXTRACT,
    build: buildPromptmotion,
    dedupe: 'url',
  },
  motionsites: {
    sourceName: 'MotionSites',
    origin: 'https://motionsites.ai',
    pages: [{ url: 'https://motionsites.ai/', category: 'template' }],
    extract: MOTIONSITES_EXTRACT,
    build: buildMotionsites,
    dedupe: 'title',
    wheelScroll: true,
    maxCards: 120,
    context: {
      permissions: ['clipboard-read', 'clipboard-write'],
    },
    capturePrompts: captureMotionsitesPrompts,
    gotoWaitUntil: 'commit',
    readySelector: 'h2,h3,h4',
  },
};

const SOURCE_ORDER = Object.keys(SOURCES);
const THEME_RANK = { light: 0, mid: 1, dark: 2, unknown: 3 };

function clean(value) {
  return String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
}

function slugify(value) {
  return clean(value)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function slugFromUrl(value) {
  try {
    const u = new URL(value);
    const parts = u.pathname.split('/').filter(Boolean);
    return slugify(decodeURIComponent(parts[parts.length - 1] || ''));
  } catch {
    return '';
  }
}

function titleCase(value) {
  return clean(value)
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function firstPart(value) {
  let s = clean(value);
  s = s.replace(/^[\d\s.,·|•\-–—]+/, '');
  s = (s.split(/\s*[|·•—–]\s*/)[0] || '').trim();
  if (s.length > 70) s = s.slice(0, 70).replace(/\s+\S*$/, '');
  return s;
}

function cleanTag(value) {
  return clean(value)
    .replace(/^[\s\-–—·|:]+/, '')
    .replace(/[\s\-–—·|:]+$/, '')
    .slice(0, 40);
}

function unwrapImage(raw, pageUrl) {
  if (!raw || typeof raw !== 'string') return '';
  const value = raw.trim();
  if (!value || value.startsWith('data:')) return '';
  try {
    const absolute = new URL(value, pageUrl);
    if (absolute.href.includes('/_next/image?url=')) {
      const inner = absolute.searchParams.get('url');
      if (inner) {
        let decoded = inner;
        if (decoded.startsWith('/')) decoded = absolute.origin + decoded;
        return /^https?:\/\//i.test(decoded) ? decoded : absolute.href;
      }
    }
    return /^https?:\/\//i.test(absolute.href) ? absolute.href : '';
  } catch {
    return '';
  }
}

function makeItem({ source, sourceName, title, url, image, category, tags, price, desc = '', slug, index = 0 }) {
  const finalSlug = slug || slugFromUrl(url) || slugify(title) || `item-${index + 1}`;
  return {
    id: `${source}:${finalSlug}`,
    source,
    sourceName,
    title,
    url,
    image,
    category,
    tags: Array.isArray(tags) ? tags.filter(Boolean) : [],
    price,
    desc,
    luma: null,
    theme: 'unknown',
    dominant: null,
    thumb: null,
    fetchedAt: null,
  };
}

function buildGetlayers(raw, page, source) {
  const out = [];
  raw.forEach((r, index) => {
    const title = clean(r.title);
    if (!title) return;
    const image = unwrapImage(r.image, page.url);
    if (!image) return;
    const text = clean(r.text);
    let price = 'unknown';
    let tag = '';
    const premium = text.match(/\bPremium\b([\s\S]*)$/i);
    const free = text.match(/\bFree\b([\s\S]*)$/i);
    if (premium) {
      price = 'premium';
      tag = premium[1];
    } else if (free) {
      price = 'free';
      tag = free[1];
    }
    tag = cleanTag(tag);
    out.push(
      makeItem({
        source,
        sourceName: SOURCES[source].sourceName,
        title,
        url: r.url,
        image,
        category: page.category,
        tags: tag ? [tag] : [],
        price,
        desc: '',
        slug: slugFromUrl(r.url),
        index,
      })
    );
  });
  return out;
}

function buildHorizonx(raw, page, source) {
  const out = [];
  raw.forEach((r, index) => {
    const image = unwrapImage(r.image, page.url);
    if (!image || !r.url) return;
    const slug = slugFromUrl(r.url);
    const title = clean(r.title) || firstPart(r.text) || titleCase(slug);
    if (!title) return;
    let category = 'template';
    const haystack = `${title} ${clean(r.desc)}`;
    if (/\/tools\//.test(r.url)) category = 'tool';
    else if (/\bhero\b/i.test(haystack)) category = 'hero';
    else if (/\bui kit\b|\bkit\b/i.test(haystack)) category = 'kit';
    out.push(
      makeItem({
        source,
        sourceName: SOURCES[source].sourceName,
        title,
        url: r.url,
        image,
        category,
        tags: [],
        price: 'paid',
        desc: clean(r.desc),
        slug,
        index,
      })
    );
  });
  return out;
}

function buildWebild(raw, page, source) {
  const out = [];
  const pageUrl = page.url;
  raw.forEach((r, index) => {
    const title = clean(r.title);
    if (!title) return;
    const image = unwrapImage(r.image, pageUrl);
    if (!image) return;
    out.push(
      makeItem({
        source,
        sourceName: SOURCES[source].sourceName,
        title,
        url: pageUrl,
        image,
        category: 'template',
        tags: [],
        price: 'account',
        desc: clean(r.desc),
        slug: slugify(title),
        index,
      })
    );
  });
  return out;
}

function buildUilive(raw, page, source) {
  const out = [];
  raw.forEach((r, index) => {
    const image = unwrapImage(r.image, page.url);
    if (!image || !r.url) return;
    const slug = slugFromUrl(r.url);
    const title = clean(r.title) || titleCase(slug);
    if (!title) return;
    out.push(
      makeItem({
        source,
        sourceName: SOURCES[source].sourceName,
        title,
        url: r.url,
        image,
        category: 'design',
        tags: [],
        price: 'free',
        desc: '',
        slug,
        index,
      })
    );
  });
  return out;
}

function buildRudrabyte(raw, page, source) {
  const out = [];
  raw.forEach((r, index) => {
    const title = clean(r.title);
    if (!title) return;
    const image = unwrapImage(r.image, page.url);
    if (!image) return;
    out.push(
      makeItem({
        source,
        sourceName: SOURCES[source].sourceName,
        title,
        url: page.url,
        image,
        category: 'project',
        tags: [],
        price: 'unknown',
        desc: '',
        slug: slugify(title),
        index,
      })
    );
  });
  return out;
}

function buildPromptmotion(raw, page, source) {
  const out = [];
  raw.forEach((r, index) => {
    const image = unwrapImage(r.image, page.url);
    if (!image || !r.url) return;
    const slug = slugFromUrl(r.url);
    const title = clean(r.title) || titleCase(slug);
    if (!title) return;
    out.push(
      makeItem({
        source,
        sourceName: SOURCES[source].sourceName,
        title,
        url: r.url,
        image,
        category: 'motion',
        tags: ['motion'],
        price: 'free',
        desc: '',
        slug,
        index,
      })
    );
  });
  return out;
}

function motionsitesCategory(cat) {
  const value = clean(cat);
  if (!value) return 'template';
  if (/^hero\b/i.test(value)) return 'hero';
  if (/^(landing page|saas|agency|social media|apps)$/i.test(value)) return 'template';
  if (/(section|pricing|footer)$/i.test(value)) return 'section';
  return 'template';
}

function buildMotionsites(raw, page, source) {
  const out = [];
  raw.forEach((r, index) => {
    const title = clean(r.title);
    if (!title) return;
    const image = unwrapImage(r.image, page.url);
    if (!image) return;
    const cat = clean(r.cat);
    const prompt = String(r.prompt ?? '').trim().slice(0, 20000);
    const item = makeItem({
      source,
      sourceName: SOURCES[source].sourceName,
      title,
      url: 'https://motionsites.ai/',
      image,
      category: motionsitesCategory(cat),
      tags: [cat, 'motion'],
      price: r.locked ? 'premium' : 'free',
      desc: cat,
      slug: slugify(title),
      index,
    });
    if (prompt && item.price !== 'premium') item.prompt = prompt;
    out.push(item);
  });
  return out;
}

async function captureMotionsitesPrompts(page, raw, knownPrompts = new Set()) {
  const targets = raw.filter(
    (r) =>
      r &&
      r.hasCopy &&
      r.title &&
      !knownPrompts.has(clean(r.title).toLowerCase())
  );
  if (!targets.length) return;
  const readClipboard = () =>
    page.evaluate(() => navigator.clipboard.readText());
  let warned = false;
  let copied = 0;
  let emptyStreak = 0;
  for (const entry of targets) {
    const startUrl = page.url();
    let handle = null;
    try {
      await page.evaluate(() => navigator.clipboard.writeText('')).catch(() => {});
      handle = await page.evaluateHandle((title) => {
        const headings = [...document.querySelectorAll('h2,h3,h4')];
        const h = headings.find((el) => (el.innerText || '').trim() === title);
        if (!h) return null;
        let c = h;
        for (let i = 0; i < 5 && c && !c.querySelector('img,video'); i++) {
          c = c.parentElement;
        }
        return c?.querySelector('[aria-label="Copy prompt"]') || null;
      }, entry.title);
      const el = handle.asElement();
      if (!el) continue;
      await el.scrollIntoViewIfNeeded({ timeout: 5000 }).catch(() => {});
      await el.click({ timeout: 8000 });
      let text = '';
      for (let i = 0; i < 16; i++) {
        await page.waitForTimeout(250);
        try {
          text = await readClipboard();
        } catch (err) {
          if (!warned) {
            warned = true;
            console.warn(
              `warning: could not read clipboard on motionsites (${
                err?.message || err
              }); prompts left empty`
            );
          }
          break;
        }
        if (text) break;
      }
      if (page.url() !== startUrl) {
        await page
          .goBack({ waitUntil: 'domcontentloaded', timeout: 30000 })
          .catch(() => {});
        await page.waitForTimeout(600);
      } else {
        await page.keyboard.press('Escape').catch(() => {});
      }
      text = String(text ?? '').trim().slice(0, 20000);
      if (text) {
        entry.prompt = text;
        copied++;
        emptyStreak = 0;
      } else {
        emptyStreak++;
        if (emptyStreak >= 3) {
          console.warn(
            `warning: motionsites stopped returning prompts (site copy limit reached); stored ${copied} prompt(s)`
          );
          break;
        }
      }
    } catch (err) {
      if (!warned) {
        warned = true;
        console.warn(
          `warning: motionsites prompt capture failed (${
            err?.message || err
          }); continuing without prompts`
        );
      }
      if (page.url() !== startUrl) {
        await page
          .goBack({ waitUntil: 'domcontentloaded', timeout: 30000 })
          .catch(() => {});
      } else {
        await page.keyboard.press('Escape').catch(() => {});
      }
    } finally {
      if (handle) await handle.dispose().catch(() => {});
    }
  }
}

function themeFromLuma(luma) {
  if (typeof luma !== 'number' || Number.isNaN(luma)) return 'unknown';
  if (luma >= 175) return 'light';
  if (luma <= 95) return 'dark';
  return 'mid';
}

function hexFromRgb(c) {
  const part = (v) =>
    Math.max(0, Math.min(255, Math.round(Number(v) || 0)))
      .toString(16)
      .padStart(2, '0');
  return `#${part(c?.r)}${part(c?.g)}${part(c?.b)}`;
}

async function autoScroll(page, options = {}) {
  if (options.wheel) {
    const maxCards = options.maxCards || 120;
    await page.mouse.move(720, 450);
    let stable = 0;
    for (let round = 0; round < 300; round++) {
      await page.mouse.wheel(0, 1200);
      await page.waitForTimeout(400);
      const info = await page.evaluate(() => ({
        cards: document.querySelectorAll(
          '[aria-label="Copy prompt"],[aria-label="Unlock prompt"]'
        ).length,
        height: Math.max(
          document.documentElement.scrollHeight,
          document.body.scrollHeight
        ),
        y: window.scrollY,
      }));
      if (info.cards >= maxCards) break;
      if (info.y + 900 >= info.height - 100) {
        stable++;
        if (stable > 80) break;
      } else {
        stable = 0;
      }
    }
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(800);
    return;
  }
  let previous = -1;
  for (let round = 0; round < 15; round++) {
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(1200);
    const count = await page.evaluate(
      () => document.querySelectorAll('a[href], img').length
    );
    if (count === previous) break;
    previous = count;
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(800);
  await page.evaluate(async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    let y = 0;
    let guard = 0;
    while (guard++ < 500) {
      const height =
        document.documentElement.scrollHeight || document.body.scrollHeight;
      if (y >= height) break;
      window.scrollTo(0, y);
      await sleep(150);
      y += 900;
    }
    window.scrollTo(0, document.documentElement.scrollHeight || document.body.scrollHeight);
    await sleep(300);
    window.scrollTo(0, 0);
  });
  await page.waitForTimeout(600);
}

async function launchBrowser() {
  try {
    return await chromium.launch({ channel: 'msedge', headless: true });
  } catch {
    return await chromium.launch({ channel: 'chrome', headless: true });
  }
}

function dedupeItems(items, mode) {
  const seen = new Set();
  const out = [];
  const idCount = new Map();
  for (const item of items) {
    const key = mode === 'title' ? clean(item.title).toLowerCase() : item.url;
    if (seen.has(key)) continue;
    seen.add(key);
    let id = item.id;
    if (idCount.has(id)) {
      const n = idCount.get(id) + 1;
      idCount.set(id, n);
      id = `${id}-${n}`;
    } else {
      idCount.set(id, 1);
    }
    out.push({ ...item, id });
  }
  return out;
}

async function crawlSource(browser, key, previousById = new Map()) {
  const def = SOURCES[key];
  const knownPrompts = new Set(
    [...previousById.values()]
      .filter((i) => i.source === key && i.prompt)
      .map((i) => clean(i.title).toLowerCase())
  );
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    userAgent: UA,
    ...(def.context || {}),
  });
  const attempted = [];
  const errors = [];
  const collected = [];
  let succeeded = 0;
  try {
    for (const p of def.pages) {
      attempted.push(p.url);
      let page;
      try {
        page = await context.newPage();
        await page.goto(p.url, {
          waitUntil: def.gotoWaitUntil || 'domcontentloaded',
          timeout: 60000,
        });
        if (def.gotoWaitUntil === 'commit' && def.readySelector) {
          await page
            .waitForSelector(def.readySelector, { timeout: 30000 })
            .catch(() => {});
        }
        await page.waitForTimeout(def.readySelector ? 5000 : 2500);
        await autoScroll(page, {
          wheel: def.wheelScroll,
          maxCards: def.maxCards,
        });
        let raw = await page.evaluate(def.extract);
        if (def.maxCards && Array.isArray(raw) && raw.length > def.maxCards) {
          raw = raw.slice(0, def.maxCards);
        }
        if (def.capturePrompts && Array.isArray(raw)) {
          await def.capturePrompts(page, raw, knownPrompts);
        }
        if (def.scrollExtract) {
          const parts = Array.isArray(raw) ? [raw] : [];
          let height = await page.evaluate(() =>
            Math.max(
              document.documentElement.scrollHeight,
              document.body.scrollHeight
            )
          );
          for (let y = 0; y <= height; y += 600) {
            await page.evaluate((pos) => window.scrollTo(0, pos), y);
            await page.waitForTimeout(500);
            const part = await page.evaluate(def.extract);
            if (Array.isArray(part)) parts.push(part);
            const nextHeight = await page.evaluate(() =>
              Math.max(
                document.documentElement.scrollHeight,
                document.body.scrollHeight
              )
            );
            if (nextHeight > height) height = nextHeight;
          }
          const merged = new Map();
          for (const entry of parts.flat()) {
            if (!entry || !entry.url) continue;
            const prev = merged.get(entry.url);
            if (!prev) {
              merged.set(entry.url, { best: entry, image: entry.image || '' });
              continue;
            }
            if (!prev.image && entry.image) prev.image = entry.image;
            const prevLength = (prev.best.text || '').length;
            const nextLength = (entry.text || '').length;
            if (
              nextLength > prevLength ||
              (nextLength === prevLength && entry.desc && !prev.best.desc)
            ) {
              prev.best = entry;
            }
          }
          raw = [...merged.values()].map(({ best, image }) => ({
            ...best,
            image: image || best.image,
          }));
        }
        const built = def.build(Array.isArray(raw) ? raw : [], p, key);
        collected.push(...built);
        succeeded++;
      } catch (err) {
        errors.push(`${p.url}: ${err?.message || err}`);
      } finally {
        if (page) await page.close().catch(() => {});
      }
    }
  } finally {
    await context.close().catch(() => {});
  }
  if (succeeded === 0) {
    throw new Error(errors.join(' | ') || 'no pages crawled');
  }
  const items = dedupeItems(collected, def.dedupe).map((item) => ({
    ...item,
    fetchedAt: new Date().toISOString(),
  }));
  return { items, pages: attempted, error: errors.length ? errors.join(' | ') : null };
}

async function loadCatalog() {
  try {
    const raw = await fs.readFile(CATALOG_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      updatedAt: parsed.updatedAt || null,
      sources: parsed.sources && typeof parsed.sources === 'object' ? parsed.sources : {},
      items: Array.isArray(parsed.items) ? parsed.items : [],
    };
  } catch (err) {
    if (err?.code !== 'ENOENT') {
      console.warn(`warning: could not read catalog.json (${err.message}); starting fresh`);
    }
    return { updatedAt: null, sources: {}, items: [] };
  }
}

function thumbName(id) {
  return (
    id
      .replace(/:/g, '-')
      .replace(/[^a-zA-Z0-9_-]+/g, '-')
      .replace(/^-+|-+$/g, '') + '.webp'
  );
}

async function analyzeOne(item) {
  const referer = `${SOURCES[item.source]?.origin || 'https://example.com'}/`;
  const res = await fetch(item.image, {
    headers: { 'User-Agent': UA, Referer: referer },
    signal: AbortSignal.timeout(20000),
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) throw new Error('empty image');

  const stats = await sharp(buf)
    .resize(48, 48, { fit: 'inside' })
    .removeAlpha()
    .stats();
  const channels = stats.channels || [];
  const r = channels[0]?.mean ?? 0;
  const g = channels[1]?.mean ?? r;
  const b = channels[2]?.mean ?? r;
  const luma = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);
  const dominant = stats.dominant ? hexFromRgb(stats.dominant) : null;

  const name = thumbName(item.id);
  const thumbAbs = path.join(THUMBS_DIR, name);
  await fs.mkdir(THUMBS_DIR, { recursive: true });
  await sharp(buf)
    .resize({ width: 360, withoutEnlargement: true })
    .webp({ quality: 62 })
    .toFile(thumbAbs);

  item.luma = luma;
  item.theme = themeFromLuma(luma);
  item.dominant = dominant;
  item.thumb = `thumbs/${name}`;
}

async function analyzeItems(items, previousById, noImages) {
  let cursor = 0;
  const worker = async () => {
    while (true) {
      const index = cursor++;
      if (index >= items.length) return;
      const item = items[index];
      const prev = previousById.get(item.id);
      if (
        prev &&
        prev.image === item.image &&
        prev.thumb &&
        existsSync(path.join(SCRIPT_DIR, prev.thumb))
      ) {
        item.luma = typeof prev.luma === 'number' ? prev.luma : null;
        item.theme = prev.theme || themeFromLuma(item.luma);
        item.dominant = prev.dominant || null;
        item.thumb = prev.thumb;
        continue;
      }
      if (noImages || !item.image) {
        item.luma = null;
        item.theme = 'unknown';
        item.dominant = null;
        item.thumb = null;
        continue;
      }
      try {
        await analyzeOne(item);
      } catch {
        item.luma = null;
        item.theme = 'unknown';
        item.dominant = null;
        item.thumb = null;
      }
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
}

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) {
      out._.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    if (eq > 2) {
      out[arg.slice(2, eq)] = arg.slice(eq + 1);
      continue;
    }
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function listValues(value) {
  if (value === undefined || value === true || value === null) return [];
  return String(value)
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function buildFilters(args) {
  return {
    theme: listValues(args.theme),
    source: listValues(args.source),
    category: listValues(args.category),
    price: listValues(args.price),
    q: clean(args.q && args.q !== true ? args.q : ''),
    ids: listValues(args.ids),
  };
}

function applyFilters(items, filters) {
  let out = items;
  if (filters.theme.length) {
    out = out.filter((i) => filters.theme.includes(String(i.theme || 'unknown').toLowerCase()));
  }
  if (filters.source.length) {
    out = out.filter((i) => filters.source.includes(String(i.source).toLowerCase()));
  }
  if (filters.category.length) {
    out = out.filter((i) => filters.category.includes(String(i.category).toLowerCase()));
  }
  if (filters.price.length) {
    out = out.filter((i) => filters.price.includes(String(i.price).toLowerCase()));
  }
  if (filters.q) {
    const words = filters.q.toLowerCase().split(/\s+/).filter(Boolean);
    out = out.filter((item) => {
      const haystack = [item.title, ...(item.tags || []), item.desc, item.category]
        .join(' ')
        .toLowerCase();
      return words.every((w) => haystack.includes(w));
    });
  }
  return out;
}

function sortItems(items) {
  return [...items].sort((a, b) => {
    const ra = THEME_RANK[a.theme] ?? 3;
    const rb = THEME_RANK[b.theme] ?? 3;
    if (ra !== rb) return ra - rb;
    const la = typeof a.luma === 'number' ? a.luma : -1;
    const lb = typeof b.luma === 'number' ? b.luma : -1;
    if (la !== lb) return lb - la;
    return String(a.id).localeCompare(String(b.id));
  });
}

function balanceBySource(sorted, limit, perSource) {
  const groups = new Map();
  for (const item of sorted) {
    const key = String(item.source ?? '');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  const ordered = [
    ...SOURCE_ORDER.filter((key) => groups.has(key)),
    ...[...groups.keys()].filter((key) => !SOURCE_ORDER.includes(key)),
  ];
  const cap = perSource && perSource > 0 ? perSource : Infinity;
  const queues = ordered.map((key) => groups.get(key).slice(0, cap));
  const max = limit && limit > 0 ? limit : Infinity;
  const out = [];
  let took = true;
  while (out.length < max && took) {
    took = false;
    for (const queue of queues) {
      if (!queue.length) continue;
      out.push(queue.shift());
      took = true;
      if (out.length >= max) break;
    }
  }
  return out;
}

function selectItems(items, filters, limit, options = {}) {
  if (filters.ids.length) {
    const byId = new Map(items.map((i) => [i.id, i]));
    let selected = filters.ids.map((id) => byId.get(id)).filter(Boolean);
    if (limit && limit > 0) selected = selected.slice(0, limit);
    return selected;
  }
  return balanceBySource(
    sortItems(applyFilters(items, filters)),
    limit,
    options.perSource
  );
}

function parseLimit(value, fallback) {
  const n = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

async function cmdUpdate(args) {
  const requestedSources = listValues(args.sources);
  if (
    requestedSources.length &&
    requestedSources.some((s) => !SOURCES[s])
  ) {
    const bad = requestedSources.filter((s) => !SOURCES[s]);
    throw new Error(
      `Unknown source(s): ${bad.join(', ')}. Known: ${SOURCE_ORDER.join(', ')}`
    );
  }
  const toRun = requestedSources.length ? requestedSources : SOURCE_ORDER;
  const noImages = args['no-images'] === true || args['no-images'] === 'true';
  const previous = await loadCatalog();
  const previousById = new Map(previous.items.map((i) => [i.id, i]));

  let browser = null;
  const newItems = [];
  const statusUpdates = {};
  try {
    try {
      browser = await launchBrowser();
    } catch (err) {
      console.error(`warning: could not launch a browser (${err.message})`);
    }
    for (const key of toRun) {
      if (!browser) {
        const kept = previous.items.filter((i) => i.source === key);
        statusUpdates[key] = {
          count: kept.length,
          ok: false,
          error: 'browser launch failed',
          pages: [],
        };
        continue;
      }
      try {
        const result = await crawlSource(browser, key, previousById);
        newItems.push(...result.items);
        statusUpdates[key] = {
          count: result.items.length,
          ok: true,
          error: result.error,
          pages: result.pages,
        };
      } catch (err) {
        const kept = previous.items.filter((i) => i.source === key);
        statusUpdates[key] = {
          count: kept.length,
          ok: false,
          error: err?.message || String(err),
          pages: SOURCES[key].pages.map((p) => p.url),
        };
      }
    }
  } finally {
    if (browser) await browser.close().catch(() => {});
  }

  for (const item of newItems) {
    if (item.prompt || item.price === 'premium') continue;
    const prev = previousById.get(item.id);
    if (prev?.prompt) item.prompt = prev.prompt;
  }

  await analyzeItems(newItems, previousById, noImages);

  const preserved = previous.items.filter((i) => !toRun.includes(i.source));
  const failedSources = new Set(
    toRun.filter((key) => !statusUpdates[key]?.ok)
  );
  for (const item of previous.items) {
    if (failedSources.has(item.source)) preserved.push(item);
  }

  const items = [...preserved, ...newItems];
  const order = new Map(SOURCE_ORDER.map((s, i) => [s, i]));
  items.sort(
    (a, b) =>
      (order.get(a.source) ?? 99) - (order.get(b.source) ?? 99) ||
      String(a.title).localeCompare(String(b.title))
  );

  const sources = { ...previous.sources };
  for (const key of toRun) {
    sources[key] = statusUpdates[key];
  }
  for (const key of SOURCE_ORDER) {
    if (!(key in sources)) continue;
    sources[key].count = items.filter((i) => i.source === key).length;
  }

  const catalog = {
    updatedAt: new Date().toISOString(),
    sources,
    items,
  };
  await fs.writeFile(CATALOG_PATH, `${JSON.stringify(catalog, null, 2)}\n`, 'utf8');

  for (const key of toRun) {
    const status = statusUpdates[key];
    const label = status.ok ? 'ok' : 'fail';
    const err = status.error ? `  (${clean(status.error).slice(0, 160)})` : '';
    console.log(`${key.padEnd(12)} ${label.padEnd(4)} ${status.count} items${err}`);
  }
  const okCount = Object.values(sources).filter((s) => s?.ok).length;
  console.log(`total        ${items.length} items from ${okCount} ok source(s)`);
}

async function readCatalogOrFail() {
  const catalog = await loadCatalog();
  if (!catalog.updatedAt && catalog.items.length === 0) {
    throw new Error('No catalog found. Run: node scout/scout.mjs update');
  }
  return catalog;
}

async function cmdList(args) {
  const catalog = await readCatalogOrFail();
  const filters = buildFilters(args);
  const limit = parseLimit(args.limit, 40);
  const perSource = parseLimit(args['per-source'], 0);
  const selected = selectItems(catalog.items, filters, limit, { perSource });
  if (!selected.length) {
    console.log('no items match the filters');
    return;
  }
  for (const item of selected) {
    const luma = typeof item.luma === 'number' ? String(item.luma) : '-';
    const marker = item.prompt ? ' P' : '';
    console.log(
      `${item.id} | ${item.theme} ${luma} | ${item.category} | ${item.price}${marker} | ${item.title} | ${item.url}`
    );
  }
  console.log(`-- ${selected.length} item(s)`);
}

async function cmdPrompt(args) {
  const id = args._[0];
  if (!id) throw new Error('prompt requires an item id');
  const catalog = await readCatalogOrFail();
  const item = catalog.items.find((i) => i.id === id);
  if (!item?.prompt) {
    console.log(`No free prompt stored for ${id}`);
    process.exitCode = 1;
    return;
  }
  console.log(item.prompt);
}

async function cmdStats() {
  const catalog = await readCatalogOrFail();
  const countBy = (key) => {
    const map = new Map();
    for (const item of catalog.items) {
      const value = String(item[key] ?? 'unknown') || 'unknown';
      map.set(value, (map.get(value) || 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  };
  console.log(`updatedAt: ${catalog.updatedAt || 'never'}`);
  console.log(`total: ${catalog.items.length}`);
  console.log('sources:');
  for (const key of SOURCE_ORDER) {
    const status = catalog.sources[key];
    const count = catalog.items.filter((i) => i.source === key).length;
    if (!status && count === 0) continue;
    const ok = status ? (status.ok ? 'ok' : 'fail') : '?';
    const err = status?.error ? ` (${clean(status.error).slice(0, 80)})` : '';
    console.log(`  ${key.padEnd(12)} ${String(count).padStart(4)}  ${ok}${err}`);
  }
  console.log('themes:');
  for (const [theme, count] of countBy('theme')) console.log(`  ${theme.padEnd(10)} ${count}`);
  console.log('categories:');
  for (const [category, count] of countBy('category')) {
    console.log(`  ${category.padEnd(10)} ${count}`);
  }
}

async function cmdGallery(args) {
  if (!args.out || args.out === true) {
    throw new Error('gallery requires --out <file.html>');
  }
  const outPath = path.resolve(process.cwd(), String(args.out));

  let template;
  try {
    template = await fs.readFile(GALLERY_TEMPLATE, 'utf8');
  } catch (err) {
    if (err?.code === 'ENOENT') {
      throw new Error(
        `Gallery template not found: ${GALLERY_TEMPLATE}. Expected assets/gallery.html in the ui-template-picker skill.`
      );
    }
    throw err;
  }
  const hasCatalogSlot = template.includes('/*__CATALOG__*/[]');
  const hasMetaSlot = template.includes('/*__META__*/{}');
  if (!hasCatalogSlot || !hasMetaSlot) {
    const missing = [];
    if (!hasCatalogSlot) missing.push('/*__CATALOG__*/[]');
    if (!hasMetaSlot) missing.push('/*__META__*/{}');
    throw new Error(
      `gallery.html is missing placeholder(s): ${missing.join(', ')}. Not writing a broken gallery.`
    );
  }

  const catalog = await readCatalogOrFail();
  const filters = buildFilters(args);
  const limit = parseLimit(args.limit, 120);
  const perSource = parseLimit(args['per-source'], 0);
  let selected;
  if (filters.ids.length) {
    selected = selectItems(catalog.items, filters, limit, { perSource });
  } else {
    let pool = applyFilters(catalog.items, filters);
    if (!filters.category.includes('motion')) {
      pool = pool.filter((i) => i.category !== 'motion');
    }
    selected = balanceBySource(sortItems(pool), limit, perSource);
  }

  const galleryItems = [];
  for (const item of selected) {
    const copy = { ...item };
    if (item.thumb) {
      try {
        const buf = await fs.readFile(path.join(SCRIPT_DIR, item.thumb));
        copy.thumbData = `data:image/webp;base64,${buf.toString('base64')}`;
      } catch {
        // thumb file missing: leave thumbData out
      }
    }
    galleryItems.push(copy);
  }

  const meta = {
    title: args.title && args.title !== true ? String(args.title) : 'Template gallery',
    note: args.note && args.note !== true ? String(args.note) : '',
    generatedAt: new Date().toISOString(),
    total: galleryItems.length,
    filters: {
      theme: filters.theme,
      source: filters.source,
      category: filters.category,
      price: filters.price,
      q: filters.q,
      ids: filters.ids,
      limit,
      perSource,
    },
  };

  const escapeJson = (value) =>
    JSON.stringify(value).replace(/<\//g, '<\\/');
  let html = template.replace('/*__CATALOG__*/[]', () => escapeJson(galleryItems));
  html = html.replace('/*__META__*/{}', () => escapeJson(meta));

  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, html, 'utf8');
  console.log(outPath);
  console.log(`${galleryItems.length} item(s)`);
}

function usage() {
  console.log(`Usage:
  node scout/scout.mjs update [--sources a,b] [--no-images]
  node scout/scout.mjs list [filters] [--limit 40] [--per-source N]
  node scout/scout.mjs prompt <id>
  node scout/scout.mjs stats
  node scout/scout.mjs gallery --out <file.html> [filters] [--ids id1,id2] [--limit 120] [--per-source N] [--title "..."] [--note "..."]

Filters: --theme light,mid --source getlayers,horizonx --category template,hero
         --price free,premium --q "luxury hotel"`);
}

async function main() {
  const argv = process.argv.slice(2);
  const command = argv[0];
  const args = parseArgs(argv.slice(1));
  switch (command) {
    case 'update':
      await cmdUpdate(args);
      break;
    case 'list':
      await cmdList(args);
      break;
    case 'prompt':
      await cmdPrompt(args);
      break;
    case 'stats':
      await cmdStats();
      break;
    case 'gallery':
      await cmdGallery(args);
      break;
    case undefined:
    case '-h':
    case '--help':
    case 'help':
      usage();
      break;
    default:
      usage();
      throw new Error(`Unknown command: ${command}`);
  }
}

main().catch((err) => {
  console.error(`error: ${err?.message || err}`);
  process.exitCode = 1;
});
