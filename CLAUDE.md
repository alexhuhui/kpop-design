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
- **Two radii, two jobs.** `--radius` (`3px`) is focus rings, code chips, `kbd`, filmstrip
  thumbnails and small chrome. `--radius-card` (`8px`) is tiles and the shortcut sheet.
  `.tile__card` carries `overflow: hidden` so the image and the caption can never round by
  different amounts. Buttons are pills (`999px`). The filter tabs are not buttons-as-pills: they
  are square, with an underline.
- **The wall is justified rows**, Flickr's and Google Photos' layout, in pure CSS. Each tile
  carries its aspect ratio as `--r` (set by `app.js` through the CSSOM). Its flex-basis is
  `--row × --r` and its `flex-grow` is proportional to `--r`, so every tile in a line grows by
  the same factor and the heights stay equal. `.grid::after` soaks up the last line's leftover
  width, or the last two tiles would stretch across the screen. `--row` is the tile size:
  `110 / 160 / 240px` on a phone and `160 / 240 / 360px` from 640, for S / M / L. Those numbers
  are `ROW` in `app.js`, which builds each tile's `sizes` from them (times `STRETCH`, the most a
  line grows). If you change one, change the other in the same edit, or every phone downloads a
  desktop-sized file. Do not swap this for masonry columns: masonry was the single thing that
  made the site read as a Pinterest clone. `--gap` is `6px`, `10px` from 640 — a seam, not a
  gutter.
- **The tile caption is desktop-only, by construction.** `.tile__cap` is `display: none` outside
  `@media (hover: hover)`. A phone has no hover, so the alternative is a gradient welded over the
  bottom of all 48 posters forever. On touch the card stays pure image and the tap opens the
  viewer, which carries the name. The scrim is `aria-hidden`: the button's accessible name is
  already the image's `alt`, which says the member, the design *and* the series. There is
  nothing clickable on a tile but the tile: Copy link lives in the viewer only.
- **Two orange tokens, two jobs.** `--accent` (`#f97316`) is 2.6:1 on the page background. Use
  it for a fill only. `--accent-text` (`#96410a`) is for text. `--accent-dim` (`#c2500f`) is
  for a border or a focus ring on a light background.
- **`--border` is a hairline, `--border-control` is a control edge, `--fill` is a hover wash.**
  `--border` (`#e8e2d8`) is 1.3:1 and draws rules between blocks. The search field is one
  `--border-control` (`#948b7c`, 3.4:1) line under the words, because an empty text box has no
  label inside it to identify it and WCAG 1.4.11 wants the boundary; the size switch, the
  Shuffle button and Show all carry the same edge. The filter tabs have no box: a button with a
  text label is identified by the label, and 1.4.11 asks nothing more. The active tab's
  underline is `--accent-dim`, because it carries state, and under `forced-colors` the active
  tab is also text-underlined, because forced colors paint every border the same. A hover state
  must never make a control fainter than its resting state.
- **The viewer is the one dark surface.** `--black` behind, `--on-dark` text, `--on-dark-muted`
  (8:1) for secondary text. On the dark the focus ring is plain `--accent` (5.6:1 there). Its
  buttons are a faint white wash with a `1px solid transparent` border, so forced-colors mode
  still draws an edge.
- **Do not delete `.nojekyll`.** Jekyll ignores an underscore-prefixed path, and that would
  erase `images/_derived/` on deploy.
- Every image needs real alt text. Images-only is a visual decision, not an accessibility one.
- **Any form field stays at 16px below 768px**, or iOS zooms the page on focus. The rule at the
  foot of `style.css` names `.search__input` on purpose. A `:where()` selector carries zero
  specificity and would lose to the class in silence.
- **The `Content-Security-Policy` meta tag in `index.html` is a contract.** It is
  `default-src 'none'` plus named exceptions, and `data:` appears on `img-src` only. Any inline
  script, inline style, or external host breaks the page in the console. That is the point. If
  a change needs one, change the policy in the same commit and say why. `worker-src 'self'` is
  there for `sw.js` and nothing else. `form-action 'none'` means no form, including
  `<form method="dialog">` — the shortcut sheet closes with a plain button and `dialog.close()`.

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
wall of justified rows — `<ul class="grid">`, flex-wrap — and the tabs filter it rather than
carving it up. There is no `<section>` and no per-series heading in the All view: a heading
would cut 80 designs into 21 labelled blocks. A filtered view gets **one** heading,
`#serieshead` — the series name and its count, the way an Are.na channel or a Behance project
opens — because there it names a set the reader chose, not a slice of the wall. The series is
also in every tile's `alt`, in the tile's hover caption, and in the viewer's details.

There used to be a `LAYOUTS` config mapping a folder to `masonry`, `carousel`, `feature` or
`uniform`, swapped at filter time via `data-layout`. It is gone — config, CSS, `applyLayout()`,
the per-layout `SIZES` table and the `layout` field in the manifest. Do not reintroduce it. The
shapes only ever rendered in the All view and only ever contrasted with *each other*; a single
wall leaves them nothing to contrast with, so they became 90 lines of CSS drawing a distinction
the page no longer makes.

`app.js` deals the wall in a new random order on every load, the way Pinterest does, with
`spread()`. Each pick is drawn from the designs whose series differs from the one just placed,
so two tiles from one series touch only when nothing else is left. The order is never written
anywhere, so a shared design link opens the right design, but its neighbours differ per visit.
A series tab is **not** shuffled: `refresh()` lays it out from `series.items`, so it shows
`01`, `02`, `03` in order, and re-appends the tiles (a DOM move, not CSS `order`) only when the
filter changes. The filmstrip uses `series.items` as well.

**Only layout knows the first screen.** How many tiles fit in a row depends on their ratios,
the width and the tile size, so no DOM-order guess is right. Every tile is built
`loading="lazy"`, and `prioritiseFold()` then asks layout which tiles are on the first screen
and promotes exactly those to `eager` + `fetchpriority="high"`. It runs in the same task as the
build, before the lazy loader starts a request, and again after a shuffle.

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
viewer: a focus trap, `Escape`, arrow, `J`/`K`, `Home` and `End` navigation, zoom, swipe, a
slideshow, and prefetch on intent gated by `navigator.connection`.

**The viewer is Flickr's and Apple Photos' lightbox.** A tap opens `#viewer`: a fixed,
full-screen dark grid of four rows — a top bar (counter, **Slideshow**, the one orange action
**Copy link**, close), the stage, a details strip (the member as the `h2` the dialog is labelled
by, the design, and a **See all <series>** button that closes the viewer onto the wall filtered
to that series), and a filmstrip of the series. The stage takes whatever the other rows leave.

`fitImage()` sizes the image in JS from the manifest's `w`/`h` and the stage's box, not with
`max-width`/`max-height`: the `src` swaps on every step, and CSS would size the new image from
the old file until it decodes. It must run **after** the filmstrip is filled, because the strip
takes a row and the stage is what remains — run it first and the image overflows. The LQIP is
the image's background, so the right shape is filled with the blurred preview at once.

**Zoom.** A tap that moves less than `TAP` px zooms in, centred on the point tapped (Unsplash's
click-to-zoom): the image grows to the full file's width or twice the fitted size, whichever is
bigger, and the stage scrolls. The stage is flex with an auto-margined image, not grid
centring, because centring would push an oversized image's top and left out of reach. The click
that follows the zooming tap is swallowed, or it would zoom straight back out. `Z` toggles it
and `Escape` leaves the zoom before it leaves the viewer.

**Gestures.** Unzoomed, the image is `touch-action: none` and every gesture is ours: sideways
past `SWIPE_X` steps, down past `SWIPE_Y` closes. Zoomed, `touch-action: auto` hands the drag to
the stage's native scroll and the pointer handlers stand aside.

**The filmstrip** holds one prebuilt thumbnail per design (`item.thumb`, built once at boot);
`fillStrip()` moves the series' thumbnails in and marks the current one `aria-current`. It
centres that one by setting `scrollLeft` from `offsetLeft` — `.strip` is positioned for that —
not with `scrollIntoView`, which would also scroll the locked page. A thumbnail outside the
current filter or search widens the wall to All first, so prev/next walks the list that design
is in. A pick keeps focus on the thumbnail.

**Slideshow.** `SLIDE_MS` (4s), wrapping. `render()` reschedules, so a manual step restarts the
clock. It stops on close, on zoom, and when the tab is hidden. While it plays, the `sr-only`
status line goes `aria-live="off"`, or a screen reader would be talked over every four seconds.
It is not offered at all under `prefers-reduced-motion`: a page that turns itself is motion,
whatever the transition. Space toggles it, unless focus is on a button, where Space is that
button's click.

The page behind is `inert` while the viewer is open, and Tab is trapped as well. Focus goes to
the close button on open and home to the design's wall tile on close. An `sr-only`
`role="status"` line announces name and position in one breath on every step. The image
cross-fades with a `transition`, not a keyframe — swapping `src` does not restart an animation.

**Every action answers.** Copy link raises `#toast`, a pill at the bottom centre and a live
region that sits outside both `main` and the viewer, so it still speaks while either is inert.
Over the dark viewer it turns white and rises clear of the filmstrip. The async clipboard falls
back to a `.sr-only` textarea and `execCommand('copy')` — placed by a class, because the CSP
refuses inline styles in markup.

**Tile size, shuffle, shortcuts.** The S / M / L switch (or `1` `2` `3`) sets
`html[data-size]`, which sets `--row`, and resets every tile's `sizes` so the browser can pick a
different file. A size other than M is written to `?size=` — the query, not the hash, because
the hash is the filter and the open design — and a copied design link leaves it out, so a
shared design opens the same for everyone. **Shuffle** calls `spread()` again to deal a new
wall without a reload. It is never written anywhere, and it leaves a series tab in its
numbered order. `?` opens `#keys`, a native `<dialog>` with `showModal()`,
which brings the top layer, the focus trap, `Escape` and focus restore with it; the document
key handler stands aside while it is open. The `?` button is hidden on a coarse pointer with no
hover — a phone has no keyboard to press.

**The masthead is editorial and scrolls away.** The name in big type, the tagline, and a stats
line (`80 designs · 21 series · all made in Canva`) built from the manifest, with the tools to
the right. No logo mark. `.topbar` is `display: contents` at every width, so only `.filters`
pins: a sticky child can only stick inside its parent's box.

**The tabs wrap; they do not scroll.** A single scrolling row put 18 series into 2237px of
track, which is three of nineteen on a 375px screen — a filter you cannot see is a filter
that does not exist. `.filters__list` is `flex-wrap` clamped to two rows, and at 1440px that
holds every tab with no scrolling at all. Narrower, a `.filters__more` disclosure opens the
rest and picking a tab snaps it shut, because the bar is sticky and an open one covers the wall
it just filtered. While it is shut, `pinActiveChip()` moves a clipped active tab to just after
All, so the one filter that is on never hides in a row the reader cannot see. It is a DOM move,
not CSS `order`, so Tab order matches what is drawn. (The code still calls them chips.)

Three things about that bar are load-bearing. The clamp is built from `--chip-h`, `--chip-gap`
and `--list-pad` rather than written as one guessed length: guess it and you clip the padding,
`scrollHeight` then exceeds `clientHeight` on a bar that actually fits, and `measureFilters()`
shows a toggle that would do nothing. `measureFilters()` answers "does it overflow?" by
unclamping for one frame and comparing, so the CSS is what answers, and it early-returns on an
unchanged `clientWidth` because its `ResizeObserver` watches the element it resizes. And
`syncChipInertness()` marks every clipped tab `inert`: clipped is not gone, and without it Tab
scrolls a focus ring into a box the design says is two rows tall (WCAG 2.2, 2.4.11). `.tile`'s
`scroll-margin-top` (`6.5rem`) is measured against the *collapsed* bar, which is all that pins.

The search field lives in the masthead tools. On a phone it has a zero flex-basis so it gives
way to the size switch and Shuffle (icon only below 480px, its word kept as visually hidden
text) and all three share one row. The tab and the search box **compose**. A design has to satisfy both, and every
search token has to match. A hidden tile leaves the flow, so the survivors close up into a wall
with no gaps. Search is **not** in the URL on purpose, because a live field would rewrite the address
on every keystroke. `/` moves focus to it. `Escape` clears it.

**The URL.** `#savior` is a series. `#savior/01-savior` is one design, open in the viewer.
`?size=s` or `?size=l` is the tile size. The
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

**`sw.js`** is McMaster-Carr's repeat-visit trick with no dependency. An image URL carries
`?v=<sha1>`, so its bytes never change under one URL: cache first, forever — nearly all the
bytes. Everything else (the page, `app.js`, `style.css`, `designs.json`) can change under the
same URL on any deploy: network first, cache only when offline, so a deploy is live on the next
load. It stores only complete same-origin `200`s, never touches another origin, and trims to 400
entries oldest-first. `app.js` registers it after `load` and only over http(s). Bump `CACHE` to
throw every cached response away.

**`scripts/serve.js`** serves the folder for local preview. It binds to `127.0.0.1`, refuses a
path that climbs out of the root, sends `no-store` and `X-Content-Type-Options: nosniff`, and
serves no directory listing. It is a development tool. Nothing deploys it.

## Deploy

`.github/workflows/pages.yml` runs on a push to `main`. It runs `npm run manifest`, then copies
the browser-requested files only (`sw.js` among them) into `_site/` and publishes that folder. It never uploads the
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
