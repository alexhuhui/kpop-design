# K-pop design gallery

A static image gallery. Plain HTML, CSS and vanilla JavaScript. No framework, no runtime
dependency, no CDN link, no web font. One Node script builds the manifest. GitHub Pages
hosts the result.

```
index.html          the whole page
style.css           all styling
app.js              fetches designs.json, builds the grid and the viewer
designs.json        generated. Do not edit it by hand
images/<series>/    your designs. The folder name is the series
images/_derived/    generated. Resized JPEGs. Do not edit them
scripts/            the build script, the local server, and two helper libraries
```

The folder on your disk can carry any name. The address of the published site comes from the
**repository** name, not from the folder name. Read [Get a clean address](#get-a-clean-address)
below.

---

## Add a design

1. Export the design from Canva as **PNG at 2×**.
2. Compress it at [squoosh.app](https://squoosh.app).
3. Put it in the correct `images/<series>/` folder.
4. Run the build.
5. Commit and push.

```bash
npm run manifest
```

That is the whole task. **A folder is a series**, so a new folder becomes a new filter button
on its own. You never edit the HTML or the JavaScript.

An uncompressed 2× Canva PNG is **3 MB to 5 MB**. After squoosh it must be near **300 KB**.
Compress the file before you commit it. Git keeps every version of a binary file forever, so a
4 MB PNG stays 4 MB in the history even after you replace it.

### Naming

The build sorts files naturally, so a number prefix controls the order on the page:

```
images/bed-of-thorns/01-yeonjun-vol-1.png
images/bed-of-thorns/02-soobin-vol-2.png
```

The build derives the alt text from the filename and the series label. `01-soobin.png` in
`chikai/` becomes *"Soobin — CHIKAI"*. `02-yeonjun-ghost-girl.png` in `city-pop-singles/`
becomes *"Yeonjun, Ghost Girl — City Pop Singles"*. Keep filenames in lowercase kebab-case and
this stays correct on its own.

### The wall

Every series is jumbled into one masonry grid — two columns on a phone, up to six on a wide
screen — rather than sitting in its own labelled block. Designs from different series are
interleaved round-robin, so the page reads as a continuous run.

There is no per-series shape to configure. The chips filter the wall; they never split it. Pick
a series from the chips and you get the same grid with everything else hidden, in that series'
own numbered order.

The series name still travels with each design: it is in the alt text, in the hover caption on
a desktop, and in the viewer's bottom bar on a phone.

### The filter chips

The chips wrap into rows rather than scrolling sideways, and the bar clamps to two rows. On a
desktop that is every chip at once. On a narrower screen a **Show all** button opens the rest,
and picking a chip closes it again. Chips below the clamp are not reachable by keyboard until
the bar is opened, which is what makes the button a real disclosure rather than decoration.

A folder holding one member's designs should be named for the **group**, not the member —
`images/enhypen/` with files `01-sunghoon.png`, `07-jungwon.png`. A folder named `sunghoon`
gives you the alt text "Sunghoon — Sunghoon", and it spends a filter chip on a person instead of
on a body of work.

---

## Search and links

A search box sits in the header, on the same line as the site title. It matches the alt text,
the series label and the filename. It **narrows** the current filter instead of replacing it,
so CHIKAI plus `yeonjun` gives the Yeonjun designs in CHIKAI. `/` moves focus to it. `Escape`
clears it.

There are two kinds of link, and a reload keeps both:

```
#chikai             the CHIKAI series
#chikai/01-soobin   that one design, open in the viewer
```

The arrow keys move through the viewer and keep the address bar correct, so the link is always
the design on screen. The id of a design is `<folder>/<filename without extension>`. A rename
of the file changes the link, so rename the file before you share the link, not after.

The search box is not in the URL on purpose. A live field would rewrite the address on every
keystroke.

---

## Run it on your machine

`app.js` fetches `designs.json`, and a browser blocks `fetch` on a `file://` URL. If you open
`index.html` with a double click, the page shows a "needs a local server" message. Everything
else works from disk.

```bash
npm run serve
```

Open the address that it prints. The server is `scripts/serve.js`, about 90 lines of Node
builtins. It binds to `127.0.0.1` only, so it never puts the folder on your local network, and
it does not download a package to run.

---

## Edit the build script

Everything you want to change by hand sits in one block at the top of
[`scripts/build-manifest.js`](scripts/build-manifest.js):

| Constant | Controls |
| --- | --- |
| `LABEL_OVERRIDES` | The casing that the title-caser gets wrong — `chikai` becomes `CHIKAI`. Without an entry, a folder named `bed-of-thorns` becomes *Bed of Thorns*. |
| `CATEGORY_ORDER` | The order of the filter buttons. The build appends anything unlisted alphabetically. |
| `MEMBERS` | The names that the alt-text builder must split off the front of a filename. Longest first. |
| `WORD_OVERRIDES` | The words the title-caser must not touch — `txt` becomes `TXT`. |
| `ALT_OVERRIDES` | The full alt text for one `'<series>/<file>.png'`, when the derived text is not good enough. |

---

## How it loads fast

The gallery holds 66 print-resolution designs, so the whole design is about not sending print
resolution to a phone.

**Resized derivatives.** The build decodes each PNG and writes JPEG copies at 400, 800, 1200
and 1600 px into `images/_derived/`. The page serves those through `srcset` and `sizes`, so a
phone downloads a **30 KB** file instead of a **2.9 MB** one. The
build never modifies your originals. Quality is tuned per width. The film grain in these
designs is expensive to encode and invisible at thumbnail size.

**Placeholders ride inside the manifest.** Every image carries a 24 px blurred preview as a
data URI, plus its average color. One request for `designs.json` paints the entire grid, so no
tile is ever blank white. This is the idea behind a sprite sheet, applied to placeholders.

**No layout shift.** The intrinsic `width` and `height` come from the manifest, so every tile
reserves its exact box before a byte arrives. The wall never reflows while the images
stream in.

**Versioned URLs.** Every image URL carries a `?v=` hash of the contents of the file. Replace
an image and the URL changes, so nobody sees a stale cached copy.

**Prefetch on intent.** A hover or a focus on a tile starts the fetch of its full-size file, so
the browser usually decodes it before the click arrives. The viewer prefetches the next image
and the previous one when it opens. All of this stops when `navigator.connection` reports Data
Saver or a 2G connection.

**Incremental builds.** `.build-cache.json` keys each derivative on the source hash, so a build
after you add one design re-encodes one design.

The build reports what it did, and it warns instead of shipping something broken:

```
designs.json: 66 images in 18 categories, 133.6 KB (0 built, 66 cached)
derivatives:  221 files, 181.1 MB source -> 29.7 MB shipped (84% smaller)
```

It flags byte-identical duplicates, two designs that claim the same link, and any derivative
that the manifest promises but the disk does not hold.

---

## Accessibility

Images-only is a visual decision, not an accessibility one.

- Every image has real alt text, derived from its filename.
- The viewer traps focus, closes on `Escape`, and returns focus to the tile that opened it.
  The arrow keys move inside the current filter. `Home` and `End` jump to the ends.
- Focus rings appear on `:focus-visible` only, so a keyboard user gets an indicator and a
  mouse click stays clean.
- Under `prefers-reduced-motion: reduce` every animation and transition collapses to `0.01ms`.
  State still changes. Nothing moves.
- **Two orange tokens, two jobs.** `--accent` (`#f97316`) is 2.6:1 on the page background. It
  is never text, and it is never a focus ring on a light background. Text uses `--accent-text`
  (`#96410a`, 6.5:1). A border or a ring uses `--accent-dim` (`#c2500f`, 4.5:1). A fill uses
  `--accent`, because the page reads a fill by its area, not by its edge.
- **Control edges are darker than hairlines.** `--border` (`#e8e2d8`) draws the rule between
  blocks. `--border-control` (`#948b7c`, 3.4:1) draws the edge of the search field and the
  filter chips, which WCAG 1.4.11 requires to reach 3:1.
- The filter bar is sticky, so a tile carries `scroll-margin-top`. A focus ring never lands
  under the bar (WCAG 2.2, 2.4.11).

---

## Security

The page ships everything it loads. There is no CDN, no web font, no analytics, and no inline
script or style. A `Content-Security-Policy` meta tag in `index.html` states that:

```
default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' data:;
connect-src 'self'; base-uri 'none'; form-action 'none'
```

`default-src 'none'` denies first and then names each exception. `data:` appears on `img-src`
only, for the blurred placeholders in the manifest and for the favicon. An edit that adds a
CDN link or an inline script now fails in the browser console instead of reaching production.

`frame-ancestors` is absent on purpose. A browser ignores that directive inside a meta tag,
and GitHub Pages cannot send it as a header.

---

## Put it on GitHub Pages

### First push

This folder is not yet a Git repository. From inside it:

```bash
git init -b main
```

```bash
git add . && git commit -m "Design gallery"
```

Create an empty repository on GitHub, then:

```bash
git remote add origin https://github.com/OWNER/REPO.git
```

```bash
git push -u origin main
```

Every push after that:

```bash
git add . && git commit -m "Add new design" && git push
```

Do **not** run `npm run manifest` before a push. GitHub Actions runs it.

### Turn Pages on

**Settings → Pages → Source: GitHub Actions.** Do not select "Deploy from a branch".
`designs.json` and `images/_derived/` are generated in CI and are not in the repository, so a
branch deploy would serve a page with no manifest and no images.

The first build takes a minute or two. After that a push is live in seconds.

### Get a clean address

The repository name decides the address. The folder name on your disk decides nothing.

| Where the repository lives | Its name | The address |
| --- | --- | --- |
| Your account `alex` | `kpop-design` | `alex.github.io/kpop-design/` |
| Your account `alex` | `alex.github.io` | `alex.github.io/` |
| An organization `kpopdesign` | `kpopdesign.github.io` | `kpopdesign.github.io/` |

Only the third row gives a root address that does not carry your username. To get it:

1. Go to **Settings → Organizations → New organization** and select the **Free** plan. The
   organization name becomes the subdomain, so choose it with care. `kpopdesign` gives you
   `kpopdesign.github.io`. Organization names and usernames share one namespace across GitHub,
   so a name in use is not available.
2. Create a repository **inside that organization**, named **exactly** `kpopdesign.github.io`.
   The repository name must match the organization name. If it does not match, GitHub serves
   the site at a subpath instead.
3. Push this folder to that repository.
4. Set **Settings → Pages → Source: GitHub Actions** again. A transfer does not always carry
   the Pages setting with it.

To move a repository that already exists, use **Settings → General → Danger Zone → Transfer
ownership**, then rename it to match the organization.

**Keep the repository public.** On the free plan, GitHub Pages serves public repositories only.
A private repository needs a paid plan.

**No code change is needed to move the site.** Every URL in `index.html`, `app.js` and
`designs.json` is relative, and there is no `<base>` tag. The same files work at
`alex.github.io/kpop-design/` and at `kpopdesign.github.io/`. The `og:image` tag is relative
for the same reason, and a scraper resolves it against the page URL. The
`Content-Security-Policy` uses `'self'`, which follows the origin.

The only thing a move breaks is a link that somebody already saved. A `#series/id` deep link
still resolves against whatever host serves the page.

**A custom domain is the other route.** Put it in **Settings → Pages → Custom domain**, then
point the DNS at GitHub. That route needs no organization.

### `.nojekyll`

The `.nojekyll` file in the root stops GitHub from running Jekyll over the folder. Without it,
Jekyll ignores any file or folder whose name starts with an underscore, and that would delete
every resized image in `images/_derived/`. Do not remove this file.

### What to commit

Commit `images/`, `scripts/` and `.nojekyll`. Do **not** commit `designs.json`,
`images/_derived/` or `.build-cache.json`. CI generates the first two on every push, and
`.gitignore` already lists all three. Run `npm run manifest` on your machine only when you want
a preview before a push.

### How the deploy works

`.github/workflows/pages.yml` runs on every push to `main`. It installs Node, runs the build,
copies `index.html`, `style.css`, `app.js`, `designs.json` and `images/_derived/` into a
`_site` folder, and publishes that folder to Pages. It never uploads the source PNGs, because
the page never requests them. The deployed site is about 30 MB instead of 181 MB.

The workflow caches derivatives between runs, keyed on the source PNGs, so a push that adds one
design re-encodes one design.

### Repository size

Your source PNGs stay in the repository. They are **181 MB across 66 files**, and
`images/savior/01-savior.png` alone is **37 MB**. Git keeps every version of a binary file
forever.

This folder has no Git history yet, so now is the one cheap moment to fix that. Compress the
large files at [squoosh.app](https://squoosh.app) and replace them **before** the first commit.
After a file enters the history, removal means a rewrite of the history.
