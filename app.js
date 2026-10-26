/* ===========================================================================
   Alex Designs — design gallery
   No framework, no dependencies. Fetches designs.json and builds everything.
   =========================================================================== */

(function () {
  'use strict';

  var MANIFEST_URL = 'designs.json';

  // How many full-size files to warm after load. A full-size file is about
  // five times its tile, and a reader opens one design first, not six.
  var PREFETCH_COUNT = 3;

  // The row height of the justified wall, in CSS px, per tile size, as
  // [phone, from 640px]. These are the --row values in style.css. A tile is
  // its row height times its aspect ratio, then stretched to fill the line —
  // STRETCH is the most a row is allowed to grow before it wraps — so this is
  // how the browser picks a srcset entry before layout has happened. If you
  // change a height in style.css, change it here in the same edit, or every
  // phone downloads a desktop-sized file.
  var ROW = { s: [110, 160], m: [160, 240], l: [240, 360] };
  var STRETCH = 1.4;
  var SIZES = ['s', 'm', 'l'];

  // Past ten seconds a reader has given up and started something else, so a
  // request that has not answered by then is a failure worth reporting.
  var FETCH_TIMEOUT = 10000;

  var SWIPE_X = 50;   // px before a horizontal drag counts as next/prev
  var SWIPE_Y = 100;  // px before a downward drag counts as close
  var TAP = 8;        // px a press may wander and still be a tap
  var TOAST_MS = 2000;
  var SLIDE_MS = 4000;

  var els = {
    stats: document.getElementById('stats'),
    sizes: document.getElementById('sizes'),
    shuffle: document.getElementById('shuffle'),
    keysOpen: document.getElementById('keys-open'),
    keys: document.getElementById('keys'),
    keysClose: document.getElementById('keys-close'),
    filters: document.getElementById('filters'),
    filtersMore: document.getElementById('filters-more'),
    filtersMoreText: document.getElementById('filters-more-text'),
    search: document.getElementById('search'),
    head: document.getElementById('serieshead'),
    headTitle: document.getElementById('serieshead-title'),
    headCount: document.getElementById('serieshead-count'),
    grid: document.getElementById('grid'),
    status: document.getElementById('status'),
    tally: document.getElementById('tally'),
    toast: document.getElementById('toast'),
    viewer: document.getElementById('viewer'),
    stage: document.getElementById('viewer-stage'),
    image: document.getElementById('viewer-img'),
    counter: document.getElementById('viewer-counter'),
    who: document.getElementById('viewer-who'),
    what: document.getElementById('viewer-what'),
    series: document.getElementById('viewer-series'),
    strip: document.getElementById('viewer-strip'),
    play: document.getElementById('viewer-play'),
    playText: document.getElementById('viewer-play-text'),
    copy: document.getElementById('viewer-copy'),
    said: document.getElementById('viewer-status'),
    close: document.getElementById('viewer-close'),
    prev: document.getElementById('viewer-prev'),
    next: document.getElementById('viewer-next'),
    // Everything behind the viewer. Made inert while it is open, so neither
    // Tab nor a screen reader's virtual cursor can wander back into the wall.
    page: [document.querySelector('.skip-link'), document.querySelector('.topbar'),
           document.getElementById('gallery'), document.querySelector('.footer')]
  };

  var state = {
    categories: [],
    all: [],          // every image, flattened, in wall order
    visible: [],      // what is on screen right now — what the arrow keys walk
    filter: 'all',
    order: null,      // which list the grid's DOM order is in: 'all' or a slug
    query: '',        // the search box. Deliberately not in the URL: a live
                      // field would rewrite the address on every keystroke.
    size: 'm',        // tile size, from ?size=
    index: -1,        // position in state.visible, or -1 when closed
    zoomed: false,
    playing: false,
    scrollY: 0,
    opener: null      // the tile button to hand focus back to
  };

  var prefetched = Object.create(null);
  var reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)');

  // -------------------------------------------------------------------------
  // Copy link
  // -------------------------------------------------------------------------

  var toastTimer = 0;

  // Every action answers. The toast is a live region outside main and outside
  // the viewer, so it still speaks while either one is inert.
  function toast(text) {
    clearTimeout(toastTimer);
    els.toast.textContent = text;
    els.toast.classList.add('is-shown');
    toastTimer = setTimeout(function () {
      els.toast.classList.remove('is-shown');
    }, TOAST_MS);
  }

  // The design, not the reader's tile size: a shared link should open the
  // same way for everyone.
  function linkTo(item) {
    return location.origin + location.pathname + '#' + item.id;
  }

  // The async clipboard needs a secure context and a permission some browsers
  // refuse. The textarea fallback covers both; it is placed by a class, not an
  // inline style, because the CSP refuses inline styles in markup.
  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).catch(function () { return legacyCopy(text); });
    }
    return legacyCopy(text);
  }

  function legacyCopy(text) {
    return new Promise(function (resolve, reject) {
      var area = document.createElement('textarea');
      area.className = 'sr-only';
      area.value = text;
      area.setAttribute('readonly', '');
      document.body.appendChild(area);
      area.select();
      var ok = false;
      try { ok = document.execCommand('copy'); } catch (e) { /* reported below */ }
      area.remove();
      if (ok) resolve(); else reject(new Error('copy refused'));
    });
  }

  function copyLink(item) {
    copyText(linkTo(item)).then(
      function () { toast('Link copied'); },
      // Name the fix, not the failure. While the viewer is open the address
      // bar already holds this exact link.
      function () { toast('Could not copy. The link is in the address bar.'); }
    );
  }

  // -------------------------------------------------------------------------
  // Notices
  // -------------------------------------------------------------------------

  function notice(title, body) {
    els.status.hidden = false;
    els.status.innerHTML = '';
    if (title) {
      var h = document.createElement('p');
      h.className = 'notice__title';
      h.textContent = title;
      els.status.appendChild(h);
    }
    var p = document.createElement('p');
    p.className = 'notice__body';
    // `body` may carry a <code> run; it is authored here, never user input.
    p.innerHTML = body;
    els.status.appendChild(p);
  }

  function clearNotice() {
    els.status.hidden = true;
    els.status.innerHTML = '';
  }

  // -------------------------------------------------------------------------
  // Prefetch
  // -------------------------------------------------------------------------

  // Honour a metered or slow connection. Nothing here is essential, so a phone
  // on 2G or with Data Saver on should not spend bytes guessing.
  function wantsFullFat() {
    var c = navigator.connection;
    if (!c) return true;
    if (c.saveData) return false;
    return !/2g/.test(c.effectiveType || '');
  }

  function prefetch(url) {
    if (!url || prefetched[url]) return;
    prefetched[url] = true;
    var img = new Image();
    img.decoding = 'async';
    // A guess about what the reader opens next may never outrank a pixel that
    // is already on screen.
    img.fetchPriority = 'low';
    img.src = url;
  }

  // -------------------------------------------------------------------------
  // Build
  // -------------------------------------------------------------------------

  // A tile's rendered width is its row height times its aspect ratio, give or
  // take the stretch that fills the line. min() with 100vw, because a wide
  // banner on a phone shrinks to the screen rather than overflowing it.
  function sizesFor(item) {
    var r = item.w / item.h;
    var row = ROW[state.size];
    return '(min-width: 640px) ' + Math.ceil(row[1] * r * STRETCH) + 'px, ' +
      'min(' + Math.ceil(row[0] * r * STRETCH) + 'px, 100vw)';
  }

  function buildTile(item) {
    var li = document.createElement('li');
    li.className = 'tile';
    li.dataset.category = item.category;
    // The aspect ratio drives the justified row: a tile's flex-basis and its
    // share of the leftover width are both proportional to it, so every tile
    // in a line grows to the same height. Set through the CSSOM, which the
    // CSP allows; a style attribute in markup it would refuse.
    li.style.setProperty('--r', (item.w / item.h).toFixed(4));

    // The card is the rounded, clipped box, and it is what presses.
    var card = document.createElement('div');
    card.className = 'tile__card';

    var btn = document.createElement('button');
    btn.className = 'tile__btn';
    btn.type = 'button';
    // The accessible name comes from the image's alt, so no aria-label here —
    // one name, not two.

    var img = document.createElement('img');
    img.className = 'tile__img';
    img.alt = item.alt;
    // The width/height pair reserves the box before a single byte arrives, so
    // nothing reflows as images stream in.
    img.width = item.w;
    img.height = item.h;
    img.style.backgroundColor = item.tone;
    if (item.lqip) img.style.backgroundImage = 'url("' + item.lqip + '")';

    img.sizes = sizesFor(item);
    img.srcset = item.srcset.map(function (s) { return s.src + ' ' + s.w + 'w'; }).join(', ');
    img.src = item.srcset[0].src;
    img.decoding = 'async';
    // Lazy for all of them. prioritiseFold() promotes the tiles that turn out
    // to be on the first screen once layout can say which those are.
    img.loading = 'lazy';

    // A cached image can be complete before the listener attaches.
    if (img.complete) {
      img.classList.add('is-loaded');
    } else {
      img.addEventListener('load', function () { img.classList.add('is-loaded'); }, { once: true });
      // On failure, reveal anyway — the placeholder tone beats an invisible gap.
      img.addEventListener('error', function () { img.classList.add('is-loaded'); }, { once: true });
    }

    btn.appendChild(img);

    // Unsplash's hover: a soft gradient with the name and the series, and
    // nothing to click on top of it. aria-hidden because the button's
    // accessible name is already the image's alt, which says all of this —
    // announcing it twice is worse than not announcing it. CSS hides it under
    // (hover: none), so a phone never shows it.
    if (item.member || item.title) {
      var cap = document.createElement('span');
      cap.className = 'tile__cap';
      cap.setAttribute('aria-hidden', 'true');
      if (item.member) {
        var who = document.createElement('span');
        who.className = 'tile__who';
        who.textContent = item.member;
        cap.appendChild(who);
      }
      if (item.title) {
        var what = document.createElement('span');
        what.className = 'tile__what';
        what.textContent = item.title;
        cap.appendChild(what);
      }
      if (item.categoryLabel) {
        var where = document.createElement('span');
        where.className = 'tile__where';
        where.textContent = item.categoryLabel;
        cap.appendChild(where);
      }
      btn.appendChild(cap);
    }

    card.appendChild(btn);
    li.appendChild(card);

    btn.addEventListener('click', function () { open(item); });

    // McMaster's trick: act on intent. By the time the click lands, the
    // full-size file is usually already in cache.
    var hint = function () { if (wantsFullFat()) prefetch(item.full); };
    btn.addEventListener('pointerenter', hint);
    btn.addEventListener('focus', hint);

    return { li: li, img: img, button: btn };
  }

  // One thumbnail in the viewer's filmstrip. The smallest derivative, which the
  // wall has usually fetched already.
  function buildThumb(item) {
    var li = document.createElement('li');
    li.className = 'strip__item';

    var btn = document.createElement('button');
    btn.className = 'strip__btn';
    btn.type = 'button';

    var img = document.createElement('img');
    img.className = 'strip__img';
    img.alt = item.alt;
    img.width = item.w;
    img.height = item.h;
    img.style.backgroundColor = item.tone;
    img.src = item.srcset[0].src;
    img.decoding = 'async';
    img.loading = 'lazy';

    btn.appendChild(img);
    li.appendChild(btn);
    btn.addEventListener('click', function () { show(item); });

    item.thumbBtn = btn;
    return li;
  }

  // Round-robin across the series: one from each in turn, then round again.
  // Pinterest's wall: a new random order on every load. Each pick is drawn from
  // the designs whose series differs from the one just placed, so two tiles
  // from one series only touch when nothing else is left. The order is never
  // written anywhere. A series tab is not shuffled: refresh() lays it out in
  // its own 01, 02, 03 order.
  function spread(items) {
    var pool = items.slice();
    var out = [];
    var last = null;
    while (pool.length) {
      var other = pool.filter(function (it) { return it.category !== last; });
      var from = other.length ? other : pool;
      var pick = from[Math.floor(Math.random() * from.length)];
      pool.splice(pool.indexOf(pick), 1);
      out.push(pick);
      last = pick.category;
    }
    return out;
  }

  function buildGrid() {
    var frag = document.createDocumentFragment();
    state.all.forEach(function (item) {
      var t = buildTile(item);
      item.el = t.li;
      item.img = t.img;
      item.button = t.button;
      // Built once at boot; fillStrip() only moves it into the filmstrip.
      item.thumb = buildThumb(item);
      frag.appendChild(t.li);
    });
    els.grid.appendChild(frag);
  }

  // The first screen is whatever layout puts there, so ask layout rather than
  // guess. Synchronous, right after the grid is in place, so the priority is
  // set before the lazy loader starts any of these requests.
  function prioritiseFold() {
    var fold = window.innerHeight;
    state.visible.forEach(function (item) {
      var r = item.img.getBoundingClientRect();
      if (r.top < fold && r.bottom > 0) {
        item.img.loading = 'eager';
        item.img.fetchPriority = 'high';
      }
    });
  }

  function buildStats() {
    var n = state.all.length;
    var c = state.categories.length;
    els.stats.textContent = n + (n === 1 ? ' design' : ' designs') + ' · ' +
      c + ' series · all made in Canva';
  }

  function buildFilters() {
    var frag = document.createDocumentFragment();

    var defs = [{ slug: 'all', label: 'All', count: state.all.length }];
    state.categories.forEach(function (c) {
      defs.push({ slug: c.slug, label: c.label, count: c.images.length });
    });

    defs.forEach(function (def) {
      var b = document.createElement('button');
      b.className = 'filter';
      b.type = 'button';
      b.dataset.slug = def.slug;
      // aria-pressed, not aria-selected: these filter one list in place, they
      // do not swap tab panels.
      b.setAttribute('aria-pressed', 'false');
      b.appendChild(document.createTextNode(def.label));

      var count = document.createElement('span');
      count.className = 'filter__count';
      count.textContent = def.count;
      // The number is decoration; the label already names the filter.
      count.setAttribute('aria-hidden', 'true');
      b.appendChild(count);

      b.addEventListener('click', function () {
        setFilter(def.slug);
        // Snap shut on a pick. An expanded bar is sticky and tall; leaving it
        // open would cover the very wall the pick just filtered.
        collapseFilters();
        refresh();
        writeHash();
      });
      chips.push(b);
      frag.appendChild(b);
    });

    els.filters.appendChild(frag);

    els.filtersMore.addEventListener('click', function () {
      setFiltersCollapsed(els.filters.dataset.collapsed !== 'true');
    });

    // The clamp is a CSS length and the tabs are text, so only layout knows
    // whether they overflow. Measure after the first paint, and again whenever
    // the bar is resized — a rotation or a window drag changes the answer.
    measureFilters();
    if (window.ResizeObserver) {
      new ResizeObserver(measureFilters).observe(els.filters);
    } else {
      window.addEventListener('resize', measureFilters);
    }
  }

  // Collapsed, a tab below the clamp is clipped by overflow: hidden. Clipped
  // is not the same as gone: without this the tab keeps its place in the tab
  // order, and Tab scrolls it into a box the design says is two rows tall —
  // a focus ring on something the reader cannot see (WCAG 2.2, 2.4.11).
  // `inert` is the honest description: those tabs are unavailable until the
  // disclosure that owns them is opened.
  function syncChipInertness() {
    pinActiveChip();
    var collapsed = els.filters.dataset.collapsed === 'true';
    var limit = els.filters.clientHeight;
    Array.prototype.forEach.call(els.filters.children, function (b) {
      var clipped = collapsed && b.offsetTop + b.offsetHeight > limit + 1;
      if (clipped) b.setAttribute('inert', '');
      else b.removeAttribute('inert');
    });
  }

  // Collapsed, a pick from row three would vanish the moment the bar snapped
  // shut, and the reader would lose sight of the one filter that is on. So a
  // clipped active tab moves to just after All for as long as the bar stays
  // shut, and goes home when it opens. A DOM move, not CSS `order`, so Tab
  // walks the tabs in the order they are drawn (WCAG 2.4.3).
  var chips = [];
  var pinned = null;
  var lastPinKey = '';

  function pinActiveChip() {
    var collapsed = els.filters.dataset.collapsed === 'true';
    // refresh() runs on every keystroke in the search field. Only a new
    // filter, a toggle or a new width can change the answer.
    var key = state.filter + '|' + collapsed + '|' + els.filters.clientWidth;
    if (key === lastPinKey) return;
    lastPinKey = key;

    // Moving a node drops focus from it, and the tab just clicked has it.
    var focused = document.activeElement;

    if (pinned) {
      els.filters.insertBefore(pinned, chips[chips.indexOf(pinned) + 1] || null);
      pinned = null;
    }

    if (collapsed && state.filter !== 'all') {
      var active = chips.filter(function (b) { return b.dataset.slug === state.filter; })[0];
      if (active && active.offsetTop + active.offsetHeight > els.filters.clientHeight + 1) {
        els.filters.insertBefore(active, chips[0].nextSibling);
        pinned = active;
      }
    }

    if (focused && focused !== document.activeElement) focused.focus();
  }

  function setFiltersCollapsed(collapsed) {
    els.filters.dataset.collapsed = String(collapsed);
    els.filtersMore.setAttribute('aria-expanded', String(!collapsed));
    els.filtersMoreText.textContent = collapsed ? 'Show all' : 'Show less';
    syncChipInertness();
  }

  function collapseFilters() {
    if (!els.filtersMore.hidden) setFiltersCollapsed(true);
  }

  // Does the row actually overflow two rows? Ask by unclamping for one frame
  // and comparing. Cheaper than reimplementing flex wrapping in JS, and it
  // cannot disagree with the CSS, because it is the CSS that answers.
  var lastFilterWidth = -1;

  function measureFilters() {
    // The observer watches the same element this function resizes, so it would
    // re-enter itself forever. Only a width change can alter where the tabs
    // wrap, so a width that has not moved needs no remeasure.
    var width = els.filters.clientWidth;
    if (width === lastFilterWidth) return;
    lastFilterWidth = width;

    var wasCollapsed = els.filters.dataset.collapsed === 'true';
    els.filters.dataset.collapsed = 'false';
    var full = els.filters.scrollHeight;
    els.filters.dataset.collapsed = 'true';
    var clamped = els.filters.clientHeight;
    var overflows = full > clamped + 1;

    els.filtersMore.hidden = !overflows;
    // Everything fits: no clamp, no control, nothing inert. A wide desktop gets
    // the whole bar with no affordance for a state it can never be in.
    setFiltersCollapsed(overflows ? wasCollapsed : false);
  }

  // -------------------------------------------------------------------------
  // Tile size and shuffle
  // -------------------------------------------------------------------------

  function readSize() {
    var m = /[?&]size=([sml])\b/.exec(location.search);
    return m ? m[1] : 'm';
  }

  // The size rides in the query string, not the hash: the hash is the filter
  // and the open design, and a size is neither. Medium is the default, so it
  // writes nothing.
  function setSize(size, write) {
    if (SIZES.indexOf(size) === -1) size = 'm';
    state.size = size;
    document.documentElement.dataset.size = size;
    Array.prototype.forEach.call(els.sizes.children, function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.size === size));
    });
    // A new row height is a new rendered width, so the srcset may want a
    // different file. Setting `sizes` lets the browser choose again.
    state.all.forEach(function (item) { if (item.img) item.img.sizes = sizesFor(item); });
    if (!write) return;
    var search = size === 'm' ? '' : '?size=' + size;
    try {
      history.replaceState(null, '', location.pathname + search + location.hash);
    } catch (e) { /* the size still applies; it just is not in the URL */ }
  }

  els.sizes.addEventListener('click', function (e) {
    var b = e.target.closest('.size');
    if (b) setSize(b.dataset.size, true);
  });

  // Deal the wall again without a reload. refresh() puts the tiles in the new
  // order; a series tab keeps its numbered order either way.
  function shuffle() {
    state.all = spread(state.all);
    state.order = null;
    refresh();
    prioritiseFold();
    toast('Shuffled');
  }

  els.shuffle.addEventListener('click', shuffle);

  // -------------------------------------------------------------------------
  // Keyboard shortcuts sheet
  // -------------------------------------------------------------------------

  // showModal() gives the native dialog the top layer, a focus trap, Escape
  // and focus restore for free, so none of that is reimplemented here.
  function openKeys() {
    if (els.keys.open || typeof els.keys.showModal !== 'function') return;
    els.keys.showModal();
  }

  els.keysOpen.addEventListener('click', openKeys);
  els.keysClose.addEventListener('click', function () { els.keys.close(); });
  // A click on the backdrop lands on the dialog element itself.
  els.keys.addEventListener('click', function (e) {
    if (e.target === els.keys) els.keys.close();
  });

  // -------------------------------------------------------------------------
  // Filtering and search
  // -------------------------------------------------------------------------

  function setFilter(slug) {
    var known = slug === 'all' || state.categories.some(function (c) { return c.slug === slug; });
    state.filter = known ? slug : 'all';
  }

  function seriesOf(item) {
    for (var i = 0; i < state.categories.length; i++) {
      if (state.categories[i].slug === item.category) return state.categories[i];
    }
    return null;
  }

  function seriesBySlug(slug) {
    for (var i = 0; i < state.categories.length; i++) {
      if (state.categories[i].slug === slug) return state.categories[i];
    }
    return null;
  }

  // The tab and the search box compose: a design has to satisfy both. Every
  // token has to match, so 'yeonjun ghost' narrows rather than widens.
  //
  // One pass over one list. A hidden tile leaves the flow, so the surviving
  // tiles close up into rows with no gaps.
  //
  // The All view walks the shuffled wall; a series tab walks its own items, in
  // file order. The tiles are re-appended in that order — a DOM move, not CSS
  // `order`, so Tab order matches what is drawn — and only when the list
  // changes. Moving a node blurs it, so a focused tile gets its focus back.
  function refresh() {
    var tokens = state.query.toLowerCase().split(/\s+/).filter(Boolean);
    var all = state.filter === 'all';
    var list = all ? state.all : seriesBySlug(state.filter).items;

    if (state.order !== state.filter) {
      var focused = els.grid.contains(document.activeElement) ? document.activeElement : null;
      var frag = document.createDocumentFragment();
      list.forEach(function (item) { frag.appendChild(item.el); });
      // The other series' tiles keep their places after these, hidden.
      els.grid.insertBefore(frag, els.grid.firstChild);
      state.order = state.filter;
      if (focused) focused.focus({ preventScroll: true });
    }

    state.all.forEach(function (item) {
      item.el.hidden = !((all || item.category === state.filter) &&
        tokens.every(function (t) { return item.haystack.indexOf(t) !== -1; }));
    });
    state.visible = list.filter(function (item) { return !item.el.hidden; });

    Array.prototype.forEach.call(els.filters.children, function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.slug === state.filter));
    });
    // A deep link sets the filter without ever touching the toggle.
    syncChipInertness();

    var n = state.visible.length;
    els.tally.textContent = n === 1 ? '1 design' : n + ' designs';

    // The series head names a picked series, the way an Are.na channel or a
    // Behance project opens. The All view has none, so the wall stays whole.
    var series = all ? null : seriesBySlug(state.filter);
    els.head.hidden = !series || !n;
    if (series) {
      els.headTitle.textContent = series.label;
      els.headCount.textContent = n === 1 ? '1 design' : n + ' designs';
    }

    if (n) {
      clearNotice();
      els.grid.hidden = false;
      return;
    }

    els.grid.hidden = true;
    if (state.query) {
      // The query reaches the page through textContent, never innerHTML.
      notice('No match for “' + state.query + '”',
        'Try a member name or a series, or clear the search.');
    } else {
      notice('Nothing in this series yet',
        'Drop a PNG into <code>images/' + state.filter + '/</code> and run <code>npm run manifest</code>.');
    }
  }

  els.search.addEventListener('input', function () {
    state.query = els.search.value.trim();
    refresh();
  });

  // Escape clears the field first. Stopping it here keeps it from reading as a
  // stray Escape somewhere further up.
  els.search.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape' || !els.search.value) return;
    e.stopPropagation();
    els.search.value = '';
    state.query = '';
    refresh();
  });

  // -------------------------------------------------------------------------
  // The URL
  // -------------------------------------------------------------------------
  //
  //   #chikai             a series
  //   #chikai/01-soobin   one design, open in the viewer
  //   ?size=l             the tile size (medium writes nothing)
  //
  // An id is '<series>/<file stem>', so its own first half names the filter to
  // apply. A shared link lands on a coherent set, not on a lone image.

  function readHash() {
    var raw = (location.hash || '').slice(1);
    try { raw = decodeURIComponent(raw); } catch (e) { /* keep the raw form */ }
    var cut = raw.indexOf('/');
    return cut === -1 ? { filter: raw, id: null } : { filter: raw.slice(0, cut), id: raw };
  }

  // replaceState, not a hash assignment: linkable and refresh-proof without
  // stuffing the back button with every filter tap. It fires no hashchange
  // either, so this never re-enters applyHash.
  function writeHash() {
    var shown = state.index !== -1 ? state.visible[state.index] : null;
    var frag = shown ? '#' + shown.id : (state.filter === 'all' ? '' : '#' + state.filter);
    try {
      history.replaceState(null, '', frag || location.pathname + location.search);
    } catch (e) {
      location.hash = frag.slice(1);
    }
  }

  function applyHash() {
    var h = readHash();

    // Set the filter before closing, not after: close() writes the address bar,
    // and it has to write the series being navigated to, not the one being left.
    setFilter(h.filter || 'all');

    // The viewer holds a position in state.visible, and the refresh below
    // rebuilds that list. Leaving it open would leave it counting '36 of 43'
    // against a list of five, and the arrow keys walking a series it is not in.
    close();

    state.query = '';
    els.search.value = '';
    refresh();

    if (!h.id) return;
    for (var i = 0; i < state.visible.length; i++) {
      if (state.visible[i].id === h.id) {
        open(state.visible[i]);
        return;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Viewer
  // -------------------------------------------------------------------------

  // Document order, not the order these were declared in — the trap compares
  // against where Tab would actually go next. A button inside a hidden strip
  // item is not hidden itself, so ask layout whether it draws.
  function focusables() {
    return Array.prototype.filter.call(
      els.viewer.querySelectorAll('button'),
      function (b) { return !b.disabled && b.tabIndex >= 0 && b.getClientRects().length; }
    );
  }

  function lockScroll() {
    state.scrollY = window.scrollY || window.pageYOffset || 0;
    document.body.style.top = '-' + state.scrollY + 'px';
    document.body.classList.add('is-locked');
  }

  function unlockScroll() {
    document.body.classList.remove('is-locked');
    document.body.style.top = '';
    // Instant, not smooth — this is a restore, not a navigation.
    window.scrollTo(0, state.scrollY);
  }

  // The image is sized here rather than by max-width/max-height, because its
  // src is swapped on every step: CSS would size it from the old file until
  // the new one decodes. From the manifest's numbers it is the right shape at
  // once, and the blurred placeholder fills that shape straight away.
  //
  // Zoomed, it is shown at the full file's own width (or twice the fitted
  // size, whichever is bigger) and the stage scrolls — Unsplash's click-to-zoom.
  function fitImage() {
    var item = state.visible[state.index];
    if (!item) return;
    var W = els.stage.clientWidth;
    var H = els.stage.clientHeight;
    var fit = Math.min(W / item.w, H / item.h);
    var width = item.w * fit;
    if (state.zoomed) {
      var full = item.srcset[item.srcset.length - 1].w;
      width = Math.max(width * 2, full);
    }
    els.image.style.width = Math.round(width) + 'px';
    els.image.style.height = Math.round(width * item.h / item.w) + 'px';
  }

  // fx, fy: the point that was clicked, as a fraction of the image. The zoom
  // centres on it, so the detail the reader pointed at is the detail they get.
  function setZoom(on, fx, fy) {
    if (state.index === -1 || on === state.zoomed) return;
    state.zoomed = on;
    els.viewer.classList.toggle('is-zoomed', on);
    if (on) setPlaying(false);
    fitImage();
    if (on) {
      var x = fx == null ? 0.5 : fx;
      var y = fy == null ? 0.5 : fy;
      els.stage.scrollLeft = x * els.image.offsetWidth - els.stage.clientWidth / 2;
      els.stage.scrollTop = y * els.image.offsetHeight - els.stage.clientHeight / 2;
    } else {
      els.stage.scrollLeft = 0;
      els.stage.scrollTop = 0;
    }
  }

  // The rest of this series, in its own numbered order, as a filmstrip. The
  // design on screen is marked rather than removed, so the strip is a map of
  // where the reader is.
  function fillStrip(item) {
    var series = seriesOf(item);
    var mine = series ? series.items : [];
    var frag = document.createDocumentFragment();
    mine.forEach(function (it) {
      if (it === item) it.thumbBtn.setAttribute('aria-current', 'true');
      else it.thumbBtn.removeAttribute('aria-current');
      frag.appendChild(it.thumb);
    });
    // Drop the previous series' thumbnails before adding this one's.
    els.strip.textContent = '';
    els.strip.appendChild(frag);
    els.strip.hidden = mine.length < 2;

    // Bring the current thumbnail to the middle of the strip, by hand:
    // scrollIntoView would also try to scroll the page under the viewer.
    var li = item.thumb;
    els.strip.scrollLeft = li.offsetLeft - els.strip.clientWidth / 2 + li.offsetWidth / 2;
  }

  function render() {
    var item = state.visible[state.index];
    if (!item) return;

    if (state.zoomed) {
      state.zoomed = false;
      els.viewer.classList.remove('is-zoomed');
      els.stage.scrollLeft = els.stage.scrollTop = 0;
    }

    // Fade the outgoing frame out, and let the load event fade the new one in.
    // A cached image is already complete by the next line, so that case never
    // blinks; a failed one still restores, or the viewer would sit blank.
    els.image.style.opacity = '0';
    els.image.onload = els.image.onerror = function () { els.image.style.opacity = ''; };
    els.image.width = item.w;
    els.image.height = item.h;
    els.image.style.backgroundColor = item.tone;
    els.image.style.backgroundImage = item.lqip ? 'url("' + item.lqip + '")' : '';
    els.image.src = item.full;
    els.image.alt = item.alt;
    els.image.style.transform = '';
    if (els.image.complete) els.image.style.opacity = '';

    // The tile caption never renders on a touch device, so this bar is where
    // a phone is told what it is looking at. An ALT_OVERRIDES design has no
    // member/title split, so its whole sentence is the heading.
    els.who.textContent = item.member || item.title || item.alt;
    els.what.textContent = item.member ? (item.title || '') : '';
    els.what.hidden = !els.what.textContent;

    var series = seriesOf(item);
    els.series.textContent = 'See all ' + item.categoryLabel +
      (series ? ' (' + series.items.length + ')' : '');

    var n = state.visible.length;
    els.counter.textContent = (state.index + 1) + ' of ' + n;
    els.said.textContent = item.alt + ', ' + (state.index + 1) + ' of ' + n;

    fillStrip(item);

    // One image either side is enough to make arrowing feel instant without
    // pulling the whole series down.
    var last = n - 1;
    prefetch(state.visible[state.index + 1 > last ? 0 : state.index + 1].full);
    prefetch(state.visible[state.index - 1 < 0 ? last : state.index - 1].full);

    var solo = n < 2;
    els.prev.hidden = solo;
    els.next.hidden = solo;
    els.play.hidden = solo || !!(reduceMotion && reduceMotion.matches);
    if (solo) setPlaying(false);

    // Last, once the details and the filmstrip have taken their rows: the
    // stage is whatever they leave, and the image is fitted to that.
    fitImage();

    // Arrowing keeps the address bar honest, so the link is always the design
    // actually on screen.
    writeHash();

    schedule();
  }

  function setPageInert(on) {
    els.page.forEach(function (el) {
      if (!el) return;
      if (on) el.setAttribute('inert', '');
      else el.removeAttribute('inert');
    });
  }

  function open(item) {
    var i = state.visible.indexOf(item);
    if (i === -1) return;

    // Focus goes home to the design's tile on the wall, wherever in the
    // viewer the reader travelled to before leaving.
    state.opener = item.button;

    // Only on the way in. A second lock reads the scroll offset off a body that
    // is already pinned, which is 0, and the close would then jump to the top.
    if (state.index === -1) {
      lockScroll();
      setPageInert(true);
    }
    state.index = i;

    els.viewer.hidden = false;
    els.viewer.removeAttribute('inert');
    render();
    els.close.focus({ preventScroll: true });
  }

  // A filmstrip pick. Focus stays on the thumbnail, so arrowing along the
  // strip with Tab keeps its place. A design outside the current filter or
  // search widens the wall back to All rather than refusing the tap, so
  // prev/next then walks the list the design is actually in.
  function show(item) {
    if (state.visible.indexOf(item) === -1) {
      setFilter('all');
      state.query = '';
      els.search.value = '';
      refresh();
    }
    state.opener = item.button;
    state.index = state.visible.indexOf(item);
    render();
  }

  function close() {
    if (state.index === -1) return;
    setPlaying(false);
    state.index = -1;
    state.zoomed = false;
    els.viewer.classList.remove('is-zoomed');

    els.viewer.setAttribute('inert', '');
    els.viewer.hidden = true;
    setPageInert(false);
    // Drop the decoded bitmap rather than holding a full-size image in memory.
    els.image.onload = els.image.onerror = null;
    els.image.removeAttribute('src');
    els.image.alt = '';

    unlockScroll();
    writeHash();

    if (state.opener) {
      // preventScroll matters: a plain focus() scrolls the tile into view and
      // lands somewhere other than where the reader left off.
      state.opener.focus({ preventScroll: true });
      state.opener = null;
    }
  }

  function step(delta) {
    if (state.index === -1 || state.visible.length < 2) return;
    var n = state.visible.length;
    state.index = (state.index + delta + n) % n;
    render();
  }

  // --- slideshow ---
  // Flickr's and Google Photos': one design every four seconds, round and
  // round. render() reschedules, so a manual step restarts the clock rather
  // than having the show jump a beat later. While it plays, the status line
  // stops speaking, or a screen reader would be talked over every four
  // seconds; the counter still moves for anyone looking.

  var slideTimer = 0;

  function schedule() {
    clearTimeout(slideTimer);
    if (state.playing) slideTimer = setTimeout(function () { step(1); }, SLIDE_MS);
  }

  function setPlaying(on) {
    if (on && (state.index === -1 || state.visible.length < 2)) on = false;
    state.playing = on;
    els.play.setAttribute('aria-pressed', String(on));
    els.play.setAttribute('aria-label', on ? 'Pause slideshow' : 'Play slideshow');
    els.playText.textContent = on ? 'Pause' : 'Slideshow';
    els.said.setAttribute('aria-live', on ? 'off' : 'polite');
    if (on && state.zoomed) setZoom(false);
    schedule();
  }

  // A hidden tab should not page through a show nobody is watching.
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) setPlaying(false);
  });

  // --- keyboard ---

  function typing(e) {
    var tag = (e.target && e.target.tagName) || '';
    return /^(INPUT|TEXTAREA|SELECT)$/.test(tag);
  }

  document.addEventListener('keydown', function (e) {
    // The shortcut sheet is a native modal and handles its own keys.
    if (els.keys.open) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    if (e.key === '?' && !typing(e)) {
      e.preventDefault();
      openKeys();
      return;
    }

    if (state.index === -1) {
      if (typing(e)) return;
      // '/' jumps to the search box, the way it does everywhere else.
      if (e.key === '/') {
        e.preventDefault();
        els.search.focus();
        els.search.select();
      } else if (e.key === '1' || e.key === '2' || e.key === '3') {
        setSize(SIZES[+e.key - 1], true);
      }
      return;
    }

    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        // Out of the zoom first, then out of the viewer.
        if (state.zoomed) setZoom(false);
        else close();
        return;
      case 'ArrowRight':
      case 'j':
      case 'J':
        e.preventDefault();
        step(1);
        return;
      case 'ArrowLeft':
      case 'k':
      case 'K':
        e.preventDefault();
        step(-1);
        return;
      case 'Home':
        e.preventDefault();
        state.index = 0;
        render();
        return;
      case 'End':
        e.preventDefault();
        state.index = state.visible.length - 1;
        render();
        return;
      case 'z':
      case 'Z':
        e.preventDefault();
        setZoom(!state.zoomed);
        return;
      case ' ':
        // On a button, Space is that button's click. Elsewhere it is play.
        if (e.target && e.target.tagName === 'BUTTON') return;
        e.preventDefault();
        if (!els.play.hidden) setPlaying(!state.playing);
        return;
      case 'Tab':
        break;
      default:
        return;
    }

    // Trap Tab. `inert` already hides the page behind, but a focus that has
    // escaped some other way still gets pulled back here.
    var items = focusables();
    if (!items.length) {
      e.preventDefault();
      return;
    }
    var at = items.indexOf(document.activeElement);
    var last = items.length - 1;

    if (e.shiftKey && at <= 0) {
      e.preventDefault();
      items[last].focus();
    } else if (!e.shiftKey && (at === last || at === -1)) {
      e.preventDefault();
      items[0].focus();
    }
  });

  // --- buttons ---

  els.close.addEventListener('click', close);
  els.prev.addEventListener('click', function () { step(-1); });
  els.next.addEventListener('click', function () { step(1); });
  els.play.addEventListener('click', function () { setPlaying(!state.playing); });
  els.copy.addEventListener('click', function () {
    var item = state.visible[state.index];
    if (item) copyLink(item);
  });

  // Out of the viewer and onto the wall, filtered to this design's series.
  els.series.addEventListener('click', function () {
    var item = state.visible[state.index];
    if (!item) return;
    setFilter(item.category);
    close();
    collapseFilters();
    refresh();
    writeHash();
    window.scrollTo(0, 0);
    // The tab that is now on is where the reader's attention should land.
    var chip = chips.filter(function (b) { return b.dataset.slug === item.category; })[0];
    if (chip) chip.focus({ preventScroll: true });
  });

  window.addEventListener('resize', function () {
    if (state.index !== -1) fitImage();
  });

  // --- tap, swipe and zoom ---
  // One set of pointer handlers. A press that barely moves is a tap, and a
  // tap zooms. A sideways drag steps; a downward one closes, the way a photo
  // app dismisses. Zoomed, the stage scrolls natively and the drag is left to
  // it. touch-action: none on the unzoomed image hands every gesture here.

  (function gestures() {
    var startX = 0, startY = 0, dragging = false, id = null;
    // The click that follows the tap which zoomed in must not zoom back out.
    var swallow = false;

    els.image.addEventListener('pointerdown', function (e) {
      if (!e.isPrimary || state.zoomed) return;
      dragging = true;
      id = e.pointerId;
      startX = e.clientX;
      startY = e.clientY;
      els.image.setPointerCapture(id);
      els.image.style.transition = 'none';
    });

    els.image.addEventListener('pointermove', function (e) {
      if (!dragging || e.pointerId !== id) return;
      var dx = e.clientX - startX;
      var dy = e.clientY - startY;
      els.image.style.transform = Math.abs(dx) >= Math.abs(dy)
        ? 'translateX(' + dx + 'px)'
        : 'translateY(' + Math.max(dy, 0) + 'px)';
    });

    function end(e) {
      if (!dragging || (e.pointerId != null && e.pointerId !== id)) return;
      dragging = false;
      try { els.image.releasePointerCapture(id); } catch (err) { /* already gone */ }

      var cancel = e.type === 'pointercancel';
      var dx = cancel ? 0 : e.clientX - startX;
      var dy = cancel ? 0 : e.clientY - startY;

      els.image.style.transition = '';
      els.image.style.transform = '';

      if (Math.abs(dx) < TAP && Math.abs(dy) < TAP) {
        if (cancel) return;
        var r = els.image.getBoundingClientRect();
        swallow = true;
        setZoom(true, (e.clientX - r.left) / r.width, (e.clientY - r.top) / r.height);
      } else if (Math.abs(dx) >= Math.abs(dy)) {
        if (dx <= -SWIPE_X) step(1);
        else if (dx >= SWIPE_X) step(-1);
      } else if (dy >= SWIPE_Y) {
        close();
      }
    }

    els.image.addEventListener('pointerup', end);
    els.image.addEventListener('pointercancel', end);

    // Zoomed, a click anywhere on the image zooms back out.
    els.image.addEventListener('click', function () {
      if (swallow) { swallow = false; return; }
      if (state.zoomed) setZoom(false);
    });
  })();

  // -------------------------------------------------------------------------
  // Boot
  // -------------------------------------------------------------------------

  function hydrate(manifest) {
    if (!manifest || !Array.isArray(manifest.categories) || !manifest.categories.length) {
      notice('No designs yet',
        'Add a folder under <code>images/</code>, drop some PNGs in it, then run <code>npm run manifest</code>.');
      return;
    }

    state.categories = manifest.categories.filter(function (c) {
      return c && Array.isArray(c.images) && c.images.length;
    });

    if (!state.categories.length) {
      notice('No designs yet',
        'Every category in <code>designs.json</code> is empty. Add PNGs, then run <code>npm run manifest</code>.');
      return;
    }

    state.categories.forEach(function (c) {
      c.items = c.images.map(function (img, i) {
        var item = Object.assign({}, img, { category: c.slug, categoryLabel: c.label });
        // Manifests built before ids existed still have to deep-link.
        if (!item.id) item.id = c.slug + '/' + i;
        // One lowercase string per design is all the search needs: the alt text
        // already carries the member, the descriptor and the series.
        item.haystack = (item.alt + ' ' + c.label + ' ' + item.id).toLowerCase();
        return item;
      });
    });

    // The wall order, not the manifest order: a new deal on every load.
    state.all = spread([].concat.apply([], state.categories.map(function (c) { return c.items; })));

    // Before the grid, so every tile is built with the right `sizes`.
    setSize(readSize(), false);
    buildStats();
    buildGrid();
    buildFilters();
    applyHash();
    prioritiseFold();

    window.addEventListener('hashchange', applyHash);

    // Pull the full-size files for the first screenful so the first open is
    // instant. Idle alone is not late enough: it fires while the grid images
    // are still in flight, and these files are five times their size, so they
    // arrive as competition for the largest paint rather than after it. Wait
    // for load, then for idle on top of that.
    var idle = window.requestIdleCallback || function (fn) { return setTimeout(fn, 900); };
    var warm = function () {
      idle(function () {
        if (!wantsFullFat()) return;
        state.visible.slice(0, PREFETCH_COUNT).forEach(function (item) { prefetch(item.full); });
      });
    };
    if (document.readyState === 'complete') warm();
    else window.addEventListener('load', warm, { once: true });
  }

  // The offline cache (sw.js). Registered after load, so its install never
  // competes with the first paint. It is a repeat-visit speed-up: a browser
  // without it, or one that refuses it, gets exactly the page it got before.
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* optional */ });
    }, { once: true });
  }

  // Options kept at their defaults so this request matches the <link rel=preload>
  // in the head exactly. A mismatched mode makes the browser throw the
  // preloaded response away and fetch it a second time.
  // An abort is the only way a fetch ever stops on its own. Without it a
  // stalled connection leaves 'Loading designs…' on screen forever.
  var stop = window.AbortController ? new AbortController() : null;
  var timer = setTimeout(function () { if (stop) stop.abort(); }, FETCH_TIMEOUT);

  fetch(MANIFEST_URL, stop ? { signal: stop.signal } : undefined)
    .then(function (res) {
      clearTimeout(timer);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.json();
    })
    .then(hydrate)
    .catch(function (err) {
      clearTimeout(timer);

      if (err && err.name === 'AbortError') {
        notice('This is taking too long',
          'The gallery could not reach <code>designs.json</code> in ten seconds. Check the connection and reload.');
        return;
      }

      // The overwhelmingly likely cause is opening index.html straight off
      // disk, where fetch cannot read a sibling file. Say so plainly.
      var offline = location.protocol === 'file:';
      notice(
        offline ? 'This page needs a local server' : 'Could not load designs.json',
        offline
          ? 'Browsers block <code>fetch</code> on <code>file://</code> URLs. Run <code>npm run serve</code> in this folder and open the address it prints.'
          : 'The gallery reads <code>designs.json</code>. Run <code>npm run manifest</code> to generate it, then reload. (' + err.message + ')'
      );
    });
})();
