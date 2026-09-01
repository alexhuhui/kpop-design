#!/usr/bin/env node
'use strict';

// Scans images/<category>/ and writes designs.json.
//
// Folder = category. To add a design: drop a PNG in the right folder and run
// `npm run manifest`. Nothing else.
//
// Alongside the manifest this generates resized JPEG derivatives under
// images/_derived/, because a phone rendering a 400px-wide column should not
// download a 3 MB print-resolution PNG. The originals are never modified.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const png = require('./lib/png');
const jpeg = require('./lib/jpeg');

const ROOT = path.join(__dirname, '..');
const IMAGES_DIR = path.join(ROOT, 'images');
const DERIVED_DIR = path.join(IMAGES_DIR, '_derived');
const MANIFEST = path.join(ROOT, 'designs.json');
const CACHE = path.join(ROOT, '.build-cache.json');

// ---------------------------------------------------------------------------
// Edit these by hand.
// ---------------------------------------------------------------------------

// Folder name -> display label, for casing the title-caser gets wrong.
const LABEL_OVERRIDES = {
  'chikai': 'CHIKAI',
  'promise': 'PROMISE',
  'bed-of-thorns': 'Bed of Thorns',
  'city-pop-singles': 'City Pop Singles',
  'savior': 'SAVIOR',
  'txt-lemon': 'Lemon',
  'txt-wear-suits': 'Wear Suits',
  'txt-side-profile': 'Side Profiles',
  'drama-poster': 'Drama Poster',
  'tak-adil': 'Tak Adil',
  'yeonjun-ghost-girl': 'Ghost Girl',
  'taehyun-highball': 'Highball',
  'beomgyu-retro-poster': 'Beomgyu Retro',
  'kai-retro': 'Kai Retro',
  'han-jisung-retro-poster': 'Han Jisung Retro',
  'nicholas-retro-poster': 'Nicholas Retro',
  'enhypen': 'ENHYPEN',
  'misc': 'Odds & Ends',
};

// Order of the filter bar. Anything not listed is appended alphabetically.
const CATEGORY_ORDER = [
  'chikai',
  'city-pop-singles',
  'promise',
  'bed-of-thorns',
  'savior',
  'txt-lemon',
  'txt-wear-suits',
  'txt-side-profile',
  'drama-poster',
  'tak-adil',
  'yeonjun-ghost-girl',
  'taehyun-highball',
  'beomgyu-retro-poster',
  'kai-retro',
  'han-jisung-retro-poster',
  'nicholas-retro-poster',
  'enhypen',
  'misc',
];

// Longest first — 'huening-kai' has to win against a shorter prefix match.
const MEMBERS = ['tomorrow-x-together', 'huening-kai', 'han-jisung', 'sunghoon', 'beomgyu', 'nicholas', 'jungwon', 'yeonjun', 'taehyun', 'soobin', 'zizan', 'kai'];

// Words the title-caser must not touch.
const WORD_OVERRIDES = { txt: 'TXT', vol: 'Vol', ii: 'II', iii: 'III', iv: 'IV', v: 'V' };

// Kept lowercase unless they lead the phrase.
const MINOR_WORDS = new Set(['of', 'with', 'and', 'the', 'a', 'an', 'to', 'for', 'in', 'on']);

// '<category>/<filename>' -> alt text, when the derived text is not good enough.
const ALT_OVERRIDES = {
  'savior/01-savior.png': 'SAVIOR — drama poster',
};

// ---------------------------------------------------------------------------

const WIDTHS = [400, 800, 1200, 1600];
const MAX_WIDTH = 1600;
const LQIP_WIDTH = 24;
const LQIP_QUALITY = 35;

// These designs carry heavy film grain, which is expensive to encode and
// invisible at small sizes. Spend the bytes where the pixels are actually seen.
function qualityFor(width) {
  if (width <= 400) return 68;
  if (width <= 800) return 74;
  return 80;
}

function titleCase(slug) {
  return slug
    .split('-')
    .filter(Boolean)
    .map((w, i) => {
      if (WORD_OVERRIDES[w]) return WORD_OVERRIDES[w];
      if (i > 0 && MINOR_WORDS.has(w)) return w;
      return w.charAt(0).toUpperCase() + w.slice(1);
    })
    .join(' ');
}

function labelFor(slug) {
  return LABEL_OVERRIDES[slug] || titleCase(slug);
}

// '02-yeonjun-ghost-girl.png' in 'city-pop-singles'
//   -> 'Yeonjun, Ghost Girl — City Pop Singles'
function altFor(category, label, filename) {
  const override = ALT_OVERRIDES[`${category}/${filename}`];
  if (override) return override;

  const stem = path.basename(filename, path.extname(filename)).replace(/^\d+-/, '');
  const member = MEMBERS.find((m) => stem === m || stem.startsWith(`${m}-`));

  if (!member) return `${titleCase(stem)} — ${label}`;
  const rest = stem.slice(member.length).replace(/^-/, '');
  const who = titleCase(member);
  return rest ? `${who}, ${titleCase(rest)} — ${label}` : `${who} — ${label}`;
}

// The same parse altFor runs, but kept apart instead of joined into a sentence.
// The grid's hover scrim wants two lines, and the series is already the heading
// above it, so it is dropped here. An ALT_OVERRIDES entry is a whole sentence
// with no seam to split on, so an overridden file gets no caption rather than a
// guessed one.
function captionFor(category, filename) {
  if (ALT_OVERRIDES[`${category}/${filename}`]) return { member: null, title: null };

  const stem = path.basename(filename, path.extname(filename)).replace(/^\d+-/, '');
  const member = MEMBERS.find((m) => stem === m || stem.startsWith(`${m}-`));

  if (!member) return { member: null, title: titleCase(stem) };
  const rest = stem.slice(member.length).replace(/^-/, '');
  return { member: titleCase(member), title: rest ? titleCase(rest) : null };
}

// Box filter: each destination pixel averages the source rectangle it covers.
// Right choice here because every derivative is a large downscale.
function resize(image, targetWidth) {
  const { width: sw, height: sh, channels, data } = image;
  const dw = targetWidth;
  const dh = Math.max(1, Math.round((sh * dw) / sw));
  const out = Buffer.allocUnsafe(dw * dh * 3);

  const xRatio = sw / dw;
  const yRatio = sh / dh;

  for (let y = 0; y < dh; y++) {
    const y0 = Math.floor(y * yRatio);
    const y1 = Math.max(y0 + 1, Math.min(sh, Math.ceil((y + 1) * yRatio)));
    for (let x = 0; x < dw; x++) {
      const x0 = Math.floor(x * xRatio);
      const x1 = Math.max(x0 + 1, Math.min(sw, Math.ceil((x + 1) * xRatio)));

      let r = 0, g = 0, b = 0, n = 0;
      for (let sy = y0; sy < y1; sy++) {
        let p = (sy * sw + x0) * channels;
        for (let sx = x0; sx < x1; sx++) {
          r += data[p];
          g += data[p + 1];
          b += data[p + 2];
          p += channels;
          n++;
        }
      }
      const o = (y * dw + x) * 3;
      out[o] = (r / n) | 0;
      out[o + 1] = (g / n) | 0;
      out[o + 2] = (b / n) | 0;
    }
  }

  return { width: dw, height: dh, channels: 3, data: out };
}

function averageColor(image) {
  const { data } = image;
  let r = 0, g = 0, b = 0;
  const n = data.length / image.channels;
  for (let p = 0; p < data.length; p += image.channels) {
    r += data[p];
    g += data[p + 1];
    b += data[p + 2];
  }
  const hex = (v) => Math.round(v / n).toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

function loadCache() {
  try {
    return JSON.parse(fs.readFileSync(CACHE, 'utf8'));
  } catch {
    return {};
  }
}

function main() {
  if (!fs.existsSync(IMAGES_DIR)) {
    console.error(`No images/ directory at ${IMAGES_DIR}`);
    process.exit(1);
  }

  const cache = loadCache();
  const nextCache = {};

  const slugs = fs
    .readdirSync(IMAGES_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith('_') && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort((a, b) => {
      const ai = CATEGORY_ORDER.indexOf(a);
      const bi = CATEGORY_ORDER.indexOf(b);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return a.localeCompare(b);
    });

  const categories = [];
  const warnings = [];
  const seenHashes = new Map();   // full source hash -> the first file that had it
  const seenIds = new Map();
  let encoded = 0;
  let reused = 0;
  let sourceBytes = 0;

  for (const slug of slugs) {
    const label = labelFor(slug);
    const dir = path.join(IMAGES_DIR, slug);
    const files = fs
      .readdirSync(dir)
      .filter((f) => /\.(png|jpe?g)$/i.test(f))
      .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));

    const images = [];

    for (const file of files) {
      const abs = path.join(dir, file);
      const buf = fs.readFileSync(abs);
      const fullHash = crypto.createHash('sha1').update(buf).digest('hex');
      const version = fullHash.slice(0, 8);
      const key = `${slug}/${file}`;

      sourceBytes += buf.length;

      // The same bytes under two names encode twice and ship twice.
      const twin = seenHashes.get(fullHash);
      if (twin) warnings.push(`duplicate image: ${key} is byte-identical to ${twin}`);
      else seenHashes.set(fullHash, key);

      let entry = cache[key];
      const outDir = path.join(DERIVED_DIR, slug);
      const stem = path.basename(file, path.extname(file));

      // Everything derived is keyed on the source hash, so a re-run after
      // adding one image only re-encodes that image.
      const stale =
        !entry ||
        entry.v !== version ||
        !entry.srcset ||
        !entry.srcset.every((s) => fs.existsSync(path.join(ROOT, s.src)));

      if (stale) {
        if (!/\.png$/i.test(file)) {
          console.warn(`  skip ${key}: only PNG sources can be resized`);
          continue;
        }
        const image = png.decode(buf);
        fs.mkdirSync(outDir, { recursive: true });

        const targets = WIDTHS.filter((w) => w < image.width);
        const largest = Math.min(image.width, MAX_WIDTH);
        if (!targets.includes(largest)) targets.push(largest);
        targets.sort((a, b) => a - b);

        const srcset = [];
        for (const w of targets) {
          const scaled = w === image.width ? image : resize(image, w);
          const out = path.join(outDir, `${stem}-${w}.jpg`);
          fs.writeFileSync(out, jpeg.encode(scaled, qualityFor(w)));
          srcset.push({ w, h: scaled.height, src: path.relative(ROOT, out).split(path.sep).join('/') });
        }

        const tiny = resize(image, LQIP_WIDTH);
        entry = {
          v: version,
          w: image.width,
          h: image.height,
          tone: averageColor(tiny),
          lqip: `data:image/jpeg;base64,${jpeg.encode(tiny, LQIP_QUALITY).toString('base64')}`,
          srcset,
        };
        encoded++;
        console.log(`  built ${key} (${image.width}x${image.height} -> ${targets.join(', ')})`);
      } else {
        reused++;
      }

      nextCache[key] = entry;

      const rel = path.relative(ROOT, abs).split(path.sep).join('/');
      // Stable, readable, unique across the manifest. This is what a deep link
      // points at: '#chikai/01-soobin'.
      const id = `${slug}/${stem}`;
      const idTwin = seenIds.get(id);
      if (idTwin) warnings.push(`duplicate id: ${id} (${key} and ${idTwin})`);
      else seenIds.set(id, key);

      images.push({
        id,
        src: `${rel}?v=${entry.v}`,
        // The largest derivative, not the PNG: the lightbox wants ~200 KB, not 3 MB.
        full: `${entry.srcset[entry.srcset.length - 1].src}?v=${entry.v}`,
        srcset: entry.srcset.map((s) => ({ ...s, src: `${s.src}?v=${entry.v}` })),
        w: entry.w,
        h: entry.h,
        tone: entry.tone,
        lqip: entry.lqip,
        alt: altFor(slug, label, file),
        ...captionFor(slug, file),
      });
    }

    if (!images.length) {
      console.warn(`  ${slug}: no images, skipped`);
      continue;
    }
    categories.push({ slug, label, images });
  }

  // Prune derivatives whose source is gone or was replaced.
  const live = new Set();
  for (const e of Object.values(nextCache)) for (const s of e.srcset) live.add(s.src);

  let pruned = 0;
  let derivedBytes = 0;
  let derivativeCount = 0;

  if (fs.existsSync(DERIVED_DIR)) {
    for (const sub of fs.readdirSync(DERIVED_DIR)) {
      const subDir = path.join(DERIVED_DIR, sub);
      if (!fs.statSync(subDir).isDirectory()) continue;
      for (const f of fs.readdirSync(subDir)) {
        const abs = path.join(subDir, f);
        const rel = path.relative(ROOT, abs).split(path.sep).join('/');
        if (live.has(rel)) {
          derivedBytes += fs.statSync(abs).size;
          derivativeCount++;
        } else {
          fs.unlinkSync(abs);
          pruned++;
        }
      }
      if (!fs.readdirSync(subDir).length) fs.rmdirSync(subDir);
    }
  }

  // A derivative the manifest promises but the disk does not hold is a broken
  // image on the page. Cheaper to say so here than to find it in production.
  for (const [key, e] of Object.entries(nextCache)) {
    for (const s of e.srcset) {
      if (!fs.existsSync(path.join(ROOT, s.src))) {
        warnings.push(`missing derivative for ${key}: ${s.src}`);
      }
    }
  }

  const total = categories.reduce((n, c) => n + c.images.length, 0);
  const manifest = {
    generated: new Date().toISOString(),
    count: total,
    categories,
  };

  fs.writeFileSync(MANIFEST, `${JSON.stringify(manifest, null, 2)}\n`);
  fs.writeFileSync(CACHE, `${JSON.stringify(nextCache, null, 2)}\n`);

  const kb = (fs.statSync(MANIFEST).size / 1024).toFixed(1);
  console.log(
    `\ndesigns.json: ${total} images in ${categories.length} categories, ${kb} KB` +
      ` (${encoded} built, ${reused} cached)`
  );

  const mb = (n) => `${(n / 1048576).toFixed(1)} MB`;
  const saved = sourceBytes ? Math.round((1 - derivedBytes / sourceBytes) * 100) : 0;
  console.log(
    `derivatives:  ${derivativeCount} files, ${mb(sourceBytes)} source -> ` +
      `${mb(derivedBytes)} shipped (${saved}% smaller)`
  );
  if (pruned) console.log(`pruned:       ${pruned} orphaned derivative${pruned === 1 ? '' : 's'}`);

  if (warnings.length) {
    console.log('');
    for (const w of warnings) console.warn(`WARN  ${w}`);
  }
}

main();
