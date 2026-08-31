# CLAUDE.md

This file tells Claude Code (claude.ai/code) how to work in this repository.

## Commands

```bash
npm run manifest   # scan images/, write designs.json + images/_derived/
npm run serve      # node scripts/serve.js — required, because fetch() of designs.json fails on file://
```

There is no test, no linter, no bundler, and no `node_modules`. The build is one Node script,
and it uses builtins only.

## Hard constraints

- **Zero dependencies.** No npm package, no CDN link, no web font, no framework. The PNG
  decoder and the JPEG encoder are hand-written in `scripts/lib/`. The local server is
  hand-written in `scripts/serve.js`, because `npx serve` downloads and runs an unpinned
  package on every call and binds to every network interface. Do not solve a problem by adding
  a dependency.
- **No `localStorage` and no `sessionStorage`.** The filter state lives in `location.hash`.
- **Two orange tokens, two jobs.** `--accent` (`#f97316`) is 2.6:1 on the page background. Use
  it for a fill only. `--accent-text` (`#96410a`) is for text. `--accent-dim` (`#c2500f`) is
  for a border or a focus ring on a light background. The viewer keeps `--accent` for its own
  focus ring, because that ring sits on a near-black backdrop and reaches 5.6:1 there.
- **`--border` is a hairline, `--border-control` is a control edge.** `--border` (`#e8e2d8`) is
  1.3:1 and draws rules between blocks. The edge of the search field or a filter chip uses
  `--border-control` (`#948b7c`, 3.4:1), which WCAG 1.4.11 requires. A hover state must never
  make an edge fainter than its resting state.
- **Do not delete `.nojekyll`.** Jekyll ignores an underscore-prefixed path, and that would
  erase `images/_derived/` on deploy.
- Every image needs real alt text. Images-only is a visual decision, not an accessibility one.
- **Any form field stays at 16px below 768px**, or iOS zooms the page on focus. The rule at the
  foot of `style.css` names `.search__input` on purpose. A `:where()` selector carries zero
  specificity and would lose to the class in silence.
- **The `Content-Security-Policy` meta tag in `index.html` is a contract.** It is
  `default-src 'none'` plus named exceptions, and `data:` appears on `img-src` only. Any inline
  script, inline style, or external host breaks the page in the console. That is the point. If
  a change needs one, change the policy in the same commit and say why.

## Architecture

There are three moving parts: a build script, a manifest, and a page that renders the manifest.

**`scripts/build-manifest.js`** is the only place that knows about the filesystem.
**A folder name is a category and a filter button.** To add a category, add a folder. You never
edit the HTML or the JavaScript. For each PNG the build emits JPEG derivatives at 400, 800,
1200 and 1600px, capped at the source width, into `images/_derived/`. It also emits a 24px
blurred LQIP as a data URI and an average color. All of it goes into `designs.json`.

A hand-edited config block at the top of that file controls presentation: `LABEL_OVERRIDES`
(folder to display label), `CATEGORY_ORDER` (filter order), `LAYOUTS` (folder to section
shape), `MEMBERS` (names split off the front of a filename for alt text — **longest first**, so
`huening-kai` beats `kai`), `WORD_OVERRIDES` and `ALT_OVERRIDES`.

**Each series renders in its own shape, but only in the All view.** `LAYOUTS` maps a folder to
one of `masonry` (the default — columns, nothing cropped), `carousel` (a horizontal scroll-snap
row), `feature` (the first image full width and uncropped, the rest a strip below it) or
`uniform` (equal cover-cropped cards). The mix is what the whole gallery looks like. A single
series drops every section back to `masonry`, because inside one series there is nothing for a
shape to contrast with. `app.js` swaps `data-layout` and the matching `sizes` at filter time,
so the manifest value is the *All* shape, not a fixed one. The manifest carries the name.
`style.css` styles `[data-layout="…"]`. `app.js` reads it and picks a matching `sizes` string.
To add a layout, add a CSS block, a `SIZES` entry and a name in `VALID_LAYOUTS`. Nothing else.
A cropping layout drops its crop below 480px, where there is one column and a crop is pure loss.

Each image also gets a stable `id` of `<folder>/<file stem>`. That id is the deep link.

The build fails loudly instead of quietly. It warns on byte-identical duplicates, colliding
ids, unknown layouts, and derivatives that the manifest promises but the disk does not hold. It
reports source bytes against shipped bytes, and the cache hit rate.

The build derives the alt text. `02-yeonjun-ghost-girl.png` in `city-pop-singles/` becomes
*"Yeonjun, Ghost Girl — City Pop Singles"*. Watch for a stutter when a folder name repeats the
member name. Shorten the label instead of adding an override.

`.build-cache.json` keys every derivative on the SHA-1 of the source file, so a rebuild after
you add one design re-encodes one design. The build prunes a derivative when its source is gone.

**`app.js`** is one IIFE, ES5-style, with no build step. It fetches `designs.json` once. The
LQIPs ride inside it, so a single request paints the whole page with no blank tile and no
layout shift. The intrinsic `width` and `height` come from the manifest as **attributes**, not
as an inline `aspect-ratio`, so a cropping layout can override the ratio in CSS. The script
builds one `<section>` per series, the filter bar and the search field. Then it runs the
viewer: a focus trap, `Escape`, arrow, `Home` and `End` navigation, swipe, and prefetch on
intent gated by `navigator.connection`.

The search field lives in the masthead, level with the title. The chips have the row below to
themselves. The chip and the search box **compose**. A design has to satisfy both, and every
search token has to match. A section whose tiles are all filtered out hides its heading with
them. Search is **not** in the URL on purpose, because a live field would rewrite the address
on every keystroke. `/` moves focus to it. `Escape` clears it.

**The URL.** `#savior` is a series. `#savior/01-savior` is one design, open in the viewer. The
first half of an id names the filter to apply, so a shared link lands on a coherent set instead
of a lone image. Every write is `history.replaceState`, which is linkable and survives a reload
without filling the back button, and which fires no `hashchange`, so a write never re-enters
the reader.

**The viewer holds an index into `state.visible`, and `refresh()` rebuilds that list.** So
`applyHash()` sets the filter, then closes the viewer, then refreshes — in that order. The
close writes the address bar, and it has to write the series being navigated to. `open()` locks
the scroll only when the viewer is closed, because a second lock reads the offset off a body
that is already pinned and gets 0.

**Versioned URLs.** Every image URL carries `?v=<sha1[0:8]>`. When you replace an image the URL
changes, so a stale cached copy is impossible.

**`scripts/serve.js`** serves the folder for local preview. It binds to `127.0.0.1`, refuses a
path that climbs out of the root, sends `no-store` and `X-Content-Type-Options: nosniff`, and
serves no directory listing. It is a development tool. Nothing deploys it.

## Deploy

`.github/workflows/pages.yml` runs on a push to `main`. It runs `npm run manifest`, then copies
the browser-requested files only into `_site/` and publishes that folder. It never uploads the
source PNGs (about 20 MB deployed against about 145 MB in the repository), because the page
requests `srcset[*].src` and `full`, never `item.src`. It caches derivatives between runs, keyed
on `hashFiles('images/*/*.png')`.

Pages must be set to **Source: GitHub Actions**, not "Deploy from a branch". `designs.json` and
`images/_derived/` are gitignored and exist in CI only.

Every URL in the page is relative and there is no `<base>` tag, so the site works at a user
subpath and at an organization root without a code change. `README.md` holds the naming and
settings guide.

**The source PNGs are committed and they are large.** Git keeps a binary forever. Compress a
new design at squoosh.app *before* its first commit.

## Rulebooks

`rulebooks/` holds three portable principle references (UI/UX, Security, Engineering) with no
project-specific content. Read them for a significant change. Do not treat them as documentation
of this codebase, and do not edit them.
