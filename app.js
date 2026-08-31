/* ===========================================================================
   Alex Designs — design gallery
   No framework, no dependencies. Fetches designs.json and builds everything.
   =========================================================================== */

(function () {
  'use strict';

  var MANIFEST_URL = 'designs.json';

  // Above-the-fold tiles load eagerly at high priority; everything else waits
  // for the viewport.
  var EAGER_COUNT = 6;

  // How many full-size files to warm after load. Lower than EAGER_COUNT: a
  // full-size file is about five times its tile, and a reader opens one design
  // first, not six.
  var PREFETCH_COUNT = 3;

  // What each layout in style.css actually renders a tile at. This is how the
  // browser picks a srcset entry before layout has happened, so a wrong figure
  // here costs exactly the bytes the derivatives exist to save.
  var SIZES = {
    masonry: '(min-width: 1440px) 25vw, (min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw',
    carousel: 'min(70vw, 300px)',
    uniform: '(min-width: 480px) 280px, 100vw',
    feature: '(min-width: 480px) 260px, 100vw',
    hero: '100vw'
  };

  // Past ten seconds a reader has given up and started something else, so a
  // request that has not answered by then is a failure worth reporting.
  var FETCH_TIMEOUT = 10000;

  var SWIPE_X = 50;   // px before a horizontal drag counts as next/prev
  var SWIPE_Y = 90;   // px before a downward drag dismisses

  var els = {
    filters: document.getElementById('filters'),
    search: document.getElementById('search'),
    sections: document.getElementById('sections'),
    status: document.getElementById('status'),
    tally: document.getElementById('tally'),
    lightbox: document.getElementById('lightbox'),
    image: document.getElementById('lightbox-img'),
    counter: document.getElementById('lightbox-counter'),
    close: document.getElementById('lightbox-close'),
    prev: document.getElementById('lightbox-prev'),
    next: document.getElementById('lightbox-next')
  };

  var state = {
    categories: [],
    all: [],          // every image, flattened, in manifest order
    visible: [],      // what is on screen right now — what the arrow keys walk
    filter: 'all',
    query: '',        // the search box. Deliberately not in the URL: a live
                      // field would rewrite the address on every keystroke.
    index: -1,        // position in state.visible, or -1 when closed
    scrollY: 0,
    opener: null      // the tile button to hand focus back to
  };

  var prefetched = Object.create(null);

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

  function buildTile(item, index) {
    var li = document.createElement('li');
    li.className = 'tile';
    li.dataset.category = item.category;

    var btn = document.createElement('button');
    btn.className = 'tile__btn';
    btn.type = 'button';
    // The accessible name comes from the image's alt, so no aria-label here —
    // one name, not two.

    var img = document.createElement('img');
    img.className = 'tile__img';
    img.alt = item.alt;
    // The width/height pair reserves the box before a single byte arrives, so
    // nothing reflows as images stream in. It is an attribute rather than an
    // inline aspect-ratio so a layout that crops can override it in CSS.
    img.width = item.w;
    img.height = item.h;
    img.style.backgroundColor = item.tone;
    if (item.lqip) img.style.backgroundImage = 'url("' + item.lqip + '")';

    img.sizes = SIZES.masonry;
    img.srcset = item.srcset.map(function (s) { return s.src + ' ' + s.w + 'w'; }).join(', ');
    img.src = item.srcset[0].src;
    img.decoding = 'async';

    if (index < EAGER_COUNT) {
      img.loading = 'eager';
      img.fetchPriority = 'high';
    } else {
      img.loading = 'lazy';
    }

    // A cached image can be complete before the listener attaches.
    if (img.complete) {
      img.classList.add('is-loaded');
    } else {
      img.addEventListener('load', function () { img.classList.add('is-loaded'); }, { once: true });
      // On failure, reveal anyway — the placeholder tone beats an invisible gap.
      img.addEventListener('error', function () { img.classList.add('is-loaded'); }, { once: true });
    }

    btn.appendChild(img);
    li.appendChild(btn);

    btn.addEventListener('click', function () { open(item); });

    // McMaster's trick: act on intent. By the time the click lands, the
    // full-size file is usually already in cache.
    var hint = function () { if (wantsFullFat()) prefetch(item.full); };
    btn.addEventListener('pointerenter', hint);
    btn.addEventListener('focus', hint);

    item.el = li;
    item.img = img;
    item.button = btn;
    return li;
  }

  // One <section> per series, each carrying its layout from the manifest. The
  // page never hard-codes a shape; moving a series from masonry to carousel is
  // a line in the build script.
  function buildSections() {
    var frag = document.createDocumentFragment();
    var n = 0;

    state.categories.forEach(function (c) {
      var section = document.createElement('section');
      section.className = 'section';
      section.dataset.category = c.slug;

      var title = document.createElement('h2');
      title.className = 'section__title';
      title.id = 'series-' + c.slug;
      title.textContent = c.label;
      section.appendChild(title);

      var list = document.createElement('ul');
      list.className = 'section__items';

      c.items.forEach(function (item) { list.appendChild(buildTile(item, n++)); });

      section.appendChild(list);
      frag.appendChild(section);

      c.section = section;
      c.list = list;
      c.titleId = title.id;
      c.shape = c.layout || 'masonry';
      c.current = null;
      applyLayout(c, c.shape);
    });

    els.sections.appendChild(frag);
  }

  // The mixed shapes are what the whole gallery looks like. Inside one series
  // there is nothing to distinguish it from, so a chip drops back to masonry:
  // columns, nothing cropped, every design at its own size.
  function applyLayout(c, layout) {
    if (c.current === layout) return;
    c.current = layout;
    c.section.dataset.layout = layout;

    // A carousel is a scroll container, so it has to be reachable and
    // scrollable from the keyboard in its own right. Nothing else is.
    // role="list" stays on in every shape. A `list-style: none` <ul> loses its
    // list semantics in VoiceOver, and role="group" on the carousel used to
    // take them away everywhere else too, which orphaned every <li> under it.
    c.list.setAttribute('role', 'list');

    if (layout === 'carousel') {
      c.list.tabIndex = 0;
      c.list.setAttribute('aria-labelledby', c.titleId);
    } else {
      c.list.removeAttribute('tabindex');
      c.list.removeAttribute('aria-labelledby');
      // A carousel that stopped being one must not keep its scroll offset.
      c.list.scrollLeft = 0;
    }

    // sizes has to follow the shape, or the browser picks a srcset entry for a
    // tile width that no longer exists.
    c.items.forEach(function (item, i) {
      var key = layout === 'feature' && i === 0 ? 'hero' : layout;
      item.img.sizes = SIZES[key] || SIZES.masonry;
    });
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
      // aria-pressed, not aria-selected: these are toggles, not tabs.
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
        refresh();
        writeHash();
      });
      frag.appendChild(b);
    });

    els.filters.appendChild(frag);
  }

  // -------------------------------------------------------------------------
  // Filtering and search
  // -------------------------------------------------------------------------

  function setFilter(slug) {
    var known = slug === 'all' || state.categories.some(function (c) { return c.slug === slug; });
    state.filter = known ? slug : 'all';
  }

  // The chip and the search box compose: a design has to satisfy both. Every
  // token has to match, so 'yeonjun ghost' narrows rather than widens.
  function refresh() {
    var tokens = state.query.toLowerCase().split(/\s+/).filter(Boolean);

    state.visible = [];

    // Every shape at once is the 'All' view. A single series gets a plain grid.
    var mixed = state.filter === 'all';

    state.categories.forEach(function (c) {
      var inFilter = mixed || state.filter === c.slug;
      var shown = 0;

      applyLayout(c, mixed ? c.shape : 'masonry');

      c.items.forEach(function (item) {
        var show = inFilter && tokens.every(function (t) {
          return item.haystack.indexOf(t) !== -1;
        });
        item.el.hidden = !show;
        if (show) {
          state.visible.push(item);
          shown++;
        }
      });

      // A section with nothing left in it takes its heading with it.
      c.section.hidden = shown === 0;
    });

    Array.prototype.forEach.call(els.filters.children, function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.slug === state.filter));
    });

    var n = state.visible.length;
    els.tally.textContent = n === 1 ? '1 design' : n + ' designs';

    if (n) {
      clearNotice();
      els.sections.hidden = false;
      return;
    }

    els.sections.hidden = true;
    if (state.query) {
      // The query reaches the page through textContent, never innerHTML.
      notice('No match for \u201c' + state.query + '\u201d',
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
    // rebuilds that list. Leaving it open would leave it counting '36 / 43'
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
  // Lightbox
  // -------------------------------------------------------------------------

  // Document order, not the order these were declared in — the trap compares
  // against where Tab would actually go next.
  function focusables() {
    return Array.prototype.filter.call(
      els.lightbox.querySelectorAll('button'),
      function (b) { return !b.hidden && !b.disabled; }
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

  function render() {
    var item = state.visible[state.index];
    if (!item) return;

    els.image.src = item.full;
    els.image.alt = item.alt;
    els.image.style.transform = '';
    els.image.style.opacity = '';

    els.counter.textContent = (state.index + 1) + ' / ' + state.visible.length;

    // One image either side is enough to make arrowing feel instant without
    // pulling the whole series down.
    var last = state.visible.length - 1;
    prefetch(state.visible[state.index + 1 > last ? 0 : state.index + 1].full);
    prefetch(state.visible[state.index - 1 < 0 ? last : state.index - 1].full);

    var solo = state.visible.length < 2;
    els.prev.hidden = solo;
    els.next.hidden = solo;

    // Arrowing through a series keeps the address bar honest, so the link is
    // always the design actually on screen.
    writeHash();
  }

  function open(item) {
    var i = state.visible.indexOf(item);
    if (i === -1) return;

    state.opener = item.button;

    // Only on the way in. A second lock reads the scroll offset off a body that
    // is already pinned, which is 0, and the close would then jump to the top.
    if (state.index === -1) lockScroll();
    state.index = i;

    els.lightbox.hidden = false;
    els.lightbox.removeAttribute('inert');
    render();
    els.close.focus();
  }

  function close() {
    if (state.index === -1) return;
    state.index = -1;

    els.lightbox.setAttribute('inert', '');
    els.lightbox.hidden = true;
    // Drop the decoded bitmap rather than holding a full-size image in memory.
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

  // --- keyboard ---

  document.addEventListener('keydown', function (e) {
    if (state.index === -1) {
      // '/' jumps to the search box, the way it does everywhere else.
      var tag = (e.target && e.target.tagName) || '';
      if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(tag)) {
        e.preventDefault();
        els.search.focus();
        els.search.select();
      }
      return;
    }

    switch (e.key) {
      case 'Escape':
        e.preventDefault();
        close();
        return;
      case 'ArrowRight':
        e.preventDefault();
        step(1);
        return;
      case 'ArrowLeft':
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

  // --- pointer: backdrop, buttons, swipe ---

  els.lightbox.addEventListener('click', function (e) {
    if (e.target.closest('[data-close]')) close();
  });

  els.prev.addEventListener('click', function () { step(-1); });
  els.next.addEventListener('click', function () { step(1); });

  (function swipe() {
    var startX = 0, startY = 0, dragging = false, id = null;

    els.image.addEventListener('pointerdown', function (e) {
      if (!e.isPrimary) return;
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
      // Follow the finger. Downward drag also fades, so the dismiss reads
      // before the finger lifts.
      els.image.style.transform = 'translate(' + dx + 'px, ' + Math.max(0, dy) + 'px)';
      if (dy > 0) els.image.style.opacity = String(Math.max(0.35, 1 - dy / 400));
    });

    function end(e) {
      if (!dragging || (e.pointerId != null && e.pointerId !== id)) return;
      dragging = false;
      try { els.image.releasePointerCapture(id); } catch (err) { /* already gone */ }

      var dx = e.clientX - startX;
      var dy = e.clientY - startY;

      els.image.style.transition = '';
      els.image.style.transform = '';
      els.image.style.opacity = '';

      if (dy > SWIPE_Y && Math.abs(dy) > Math.abs(dx)) close();
      else if (dx <= -SWIPE_X) step(1);
      else if (dx >= SWIPE_X) step(-1);
    }

    els.image.addEventListener('pointerup', end);
    els.image.addEventListener('pointercancel', end);
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
        state.all.push(item);
        return item;
      });
    });

    buildSections();
    buildFilters();
    applyHash();

    window.addEventListener('hashchange', applyHash);

    // Pull the full-size files for the first screenful so the first lightbox
    // open is instant. Idle alone is not late enough: it fires while the grid
    // images are still in flight, and these files are five times their size,
    // so they arrive as competition for the largest paint rather than after
    // it. Wait for load, then for idle on top of that.
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
