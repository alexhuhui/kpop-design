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
- **Two radii, two jobs.** `--radius` (`3px`) is focus rings, code chips and small chrome.
  `--radius-card` (`16px`) is tiles only. `.tile__btn` carries `overflow: hidden` so the image
  and the caption scrim over it can never round by different amounts.
- **The grid is two columns from zero width**, three at 1024, four at 1440, five at 1600, six
  at 2000. One column on a phone turns a wall into a slideshow. `--gap` (`0.75rem`) is the air
  that makes a card read as an object rather than a tile in a mosaic; `--pad` stays smaller on a
  phone so the gutter never out-spaces the page margin. If you change a column count, change
  `GRID_SIZES` in `app.js` in the same edit, or every phone downloads a desktop-sized file.
- **The tile caption is desktop-only, by construction.** `.tile__cap` is `display: none` outside
  `@media (hover: hover)`. A phone has no hover, so the alternative is a gradient welded over the
  bottom of all 48 posters forever. On touch the card stays pure image and the tap opens the
  viewer, which carries the name. The scrim is `aria-hidden`: the button's accessible name is
  already the image's `alt`, which says the member, the design *and* the series.
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
(folder to display label), `CATEGORY_ORDER` (filter order), `MEMBERS` (names split off the front of a filename for alt text — **longest first**, so
`huening-kai` beats `kai`), `WORD_OVERRIDES` and `ALT_OVERRIDES`.

**A folder of one member's designs is named for the group, not the member.** `images/enhypen/`
holds `01-sunghoon.png` through `09-jungwon.png` and labels as ENHYPEN, so alt text reads
"Sunghoon — ENHYPEN". A folder named `sunghoon` would derive "Sunghoon — Sunghoon", which is the
stutter below, and it would spend a filter chip on a member rather than on a body of work.

**The gallery is one wall, not a stack of sections.** Every series is jumbled into a single
masonry grid — `<ul class="grid">`, CSS `column-count`, two columns from zero — and the chips
filter it rather than carving it up. There is no `<section>` and no `<h2>`: in the All view a
heading would cut 57 designs into 17 labelled blocks, and in a filtered view it would label the
only thing on screen. The series is not lost. It is in every tile's `alt`, in the tile's hover
caption, and in the viewer's bottom bar.

There used to be a `LAYOUTS` config mapping a folder to `masonry`, `carousel`, `feature` or
`uniform`, swapped at filter time via `data-layout`. It is gone — config, CSS, `applyLayout()`,
the per-layout `SIZES` table and the `layout` field in the manifest. Do not reintroduce it. The
shapes only ever rendered in the All view and only ever contrasted with *each other*; a single
wall leaves them nothing to contrast with, so they became 90 lines of CSS drawing a distinction
the page no longer makes.

`app.js` builds the wall order with `interleave()`: round-robin across the series, one from each
in turn. Consecutive tiles are therefore almost never the same series, and the order is
deterministic, so a shared link's neighbours never move and prev/next means the same thing
twice. Relative order inside a series survives, so filtering to one chip still shows `01`, `02`,
`03` in order.

**Multicol fills down, not across.** Column 1 gets the first *n* tiles in DOM order, then column
2. This is why `EAGER_COUNT` is `1`: "the first six in the DOM" is six tiles down the left edge,
mostly below the fold, while the tops of the other columns wait. The browser's own lazy
heuristic is viewport-aware and gets this right where a DOM-order guess cannot.

Each image also gets a stable `id` of `<folder>/<file stem>`. That id is the deep link.

The build fails loudly instead of quietly. It warns on byte-identical duplicates, colliding
ids, and derivatives that the manifest promises but the disk does not hold. It
reports source bytes against shipped bytes, and the cache hit rate.

`captionFor()` runs the same parse as `altFor()` but keeps the halves apart, and the manifest
carries them as `member` and `title` for the grid's hover scrim; `app.js` appends the series
label to it, because the wall has no headings and that scrim is the only place a desktop reader
learns which series a design belongs to without opening it. A file with an `ALT_OVERRIDES` entry
gets no caption rather than a guessed one — an override is a whole sentence with no seam.

The build derives the alt text. `02-yeonjun-ghost-girl.png` in `city-pop-singles/` becomes
*"Yeonjun, Ghost Girl — City Pop Singles"*. Watch for a stutter when a folder name repeats the
member name. Shorten the label instead of adding an override.

`.build-cache.json` keys every derivative on the SHA-1 of the source file, so a rebuild after
you add one design re-encodes one design. The build prunes a derivative when its source is gone.

**`app.js`** is one IIFE, ES5-style, with no build step. It fetches `designs.json` once. The
LQIPs ride inside it, so a single request paints the whole page with no blank tile and no
layout shift. The intrinsic `width` and `height` come from the manifest as **attributes**, not
as an inline `aspect-ratio`, so nothing reflows as images stream in. The script builds the wall,
the filter bar and the search field. Then it runs the
viewer: a focus trap, `Escape`, arrow, `Home` and `End` navigation, swipe, and prefetch on
intent gated by `navigator.connection`.

**The viewer's bottom bar is where a phone learns what it is looking at.** The tile caption is
desktop-only by construction, so `.lightbox__bar` carries the name — member, design, series —
beside the counter, in one flex row so a long title pushes the position instead of sliding under
it. The bar is a single `role="status"` region: arrowing announces the name and the position in one
breath rather than two interleaved ones. `.lightbox__stage` reserves padding for the close button
and this bar, so chrome never lands on the artwork; the arrows still float over the image edge,
because stealing 60px a side from a 375px screen costs more than it buys. The image cross-fades
with a `transition`, not a keyframe — swapping `src` does not restart an animation, and the old
`animation: fade-in` therefore only ever ran on the first open.

**The chips wrap; they do not scroll.** A single scrolling row put 18 series into 2237px of
track, which is three chips of nineteen on a 375px screen — a filter you cannot see is a filter
that does not exist. `.filters__list` is `flex-wrap` clamped to two rows, and at 1440px that
holds every chip with no scrolling at all. Narrower, a `.filters__more` disclosure opens the
rest and picking a chip snaps it shut, because the bar is sticky and an open one covers the wall
it just filtered.

Three things about that bar are load-bearing. The clamp is built from `--chip-h`, `--chip-gap`
and `--list-pad` rather than written as one guessed length: guess it and you clip the padding,
`scrollHeight` then exceeds `clientHeight` on a bar that actually fits, and `measureFilters()`
shows a toggle that would do nothing. `measureFilters()` answers "does it overflow?" by
unclamping for one frame and comparing, so the CSS is what answers, and it early-returns on an
unchanged `clientWidth` because its `ResizeObserver` watches the element it resizes. And
`syncChipInertness()` marks every clipped chip `inert`: clipped is not gone, and without it Tab
scrolls a focus ring into a box the design says is two rows tall (WCAG 2.2, 2.4.11). `.tile`'s
`scroll-margin-top` (`11rem`, `6.5rem` on a phone) is measured against the *collapsed* bar.

The search field lives in the masthead, level with the title. The chips have the rows below to
themselves. The chip and the search box **compose**. A design has to satisfy both, and every
search token has to match. A hidden tile leaves the flow, so the survivors close up into a wall
with no gaps. Search is **not** in the URL on purpose, because a live field would rewrite the address
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
source PNGs (about 30 MB deployed against about 181 MB in the repository), because the page
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
