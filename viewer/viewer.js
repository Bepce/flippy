/*!
 * flippy — a page-turning catalogue viewer. Plain JavaScript, no dependencies. MIT licence.
 *
 * Loads catalogues/<slug>/catalogue.json (built by tools/build.py) and shows the
 * pre-rendered pages as a book with page-turn animation and clickable links.
 * The links are the link annotations inside the catalogue PDF.
 */
(function () {
  'use strict';

  // Interface text. Add a language by copying the "en" block; choose it with data-lang.
  var TEXT = {
    en: {
      prev: 'Previous', next: 'Next', pages: 'All pages', links: 'Show links', zoom: 'Zoom',
      pdf: 'Download PDF', full: 'Full screen', close: 'Close', product: 'Product', newTab: 'Open in new tab',
      hint: 'Tap a product to open it', page: 'Page', of: 'of',
      swipe: 'Swipe to turn the page', click: 'Click the page edge or use ← →', sound: 'Sound',
      linkColor: 'Link colour', colors: { grey: 'Grey', red: 'Red', blue: 'Blue', white: 'White' },
      openProduct: 'Open product', goTo: 'Go to page', error: 'The catalogue could not be loaded.'
    },
    bg: {
      prev: 'Предишна', next: 'Следваща', pages: 'Всички страници', links: 'Покажи връзките', zoom: 'Увеличи',
      pdf: 'Изтегли PDF', full: 'Цял екран', close: 'Затвори', product: 'Продукт', newTab: 'Отвори в нов прозорец',
      hint: 'Натиснете върху продукт, за да го отворите', page: 'Страница', of: 'от',
      swipe: 'Плъзнете, за да прелистите', click: 'Натиснете ръба на страницата или ← →', sound: 'Звук',
      linkColor: 'Цвят на връзките', colors: { grey: 'Сив', red: 'Червен', blue: 'Син', white: 'Бял' },
      openProduct: 'Отвори продукта', goTo: 'Към страница', error: 'Каталогът не може да бъде зареден.'
    }
  };

  var ICON = {
    prev: '<path d="M15 18l-6-6 6-6"/>',
    next: '<path d="M9 6l6 6-6 6"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/>',
    links: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
    zoom: '<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3M11 8v6M8 11h6"/>',
    pdf: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
    full: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    ext: '<path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5"/>',
    sound: '<path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
    mute: '<path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M17 9l5 6M22 9l-5 6"/>',
    palette: '<circle cx="12" cy="12" r="9"/><circle cx="8.5" cy="10" r="1.3"/><circle cx="12" cy="7.5" r="1.3"/><circle cx="15.5" cy="10" r="1.3"/><path d="M12 21a2.5 2.5 0 0 1 0-5h1.5a2.5 2.5 0 0 0 2.5-2.5"/>',
    hand: '<path d="M9 11V5.5a1.5 1.5 0 0 1 3 0V11m0-1.5a1.5 1.5 0 0 1 3 0V11m0-.5a1.5 1.5 0 0 1 3 0V15a6 6 0 0 1-6 6h-1a6 6 0 0 1-4.6-2.2L4 15.5a1.6 1.6 0 0 1 2.4-2.1L9 16"/>'
  };

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }
  function svg(name) { return '<svg viewBox="0 0 24 24" aria-hidden="true">' + ICON[name] + '</svg>'; }
  // ?v=… on viewer.js is passed on to the catalogue data, so an update is never hidden by the browser cache
  var VERSION = (function () {
    var src = (document.currentScript && document.currentScript.src) || '';
    var m = /[?&]v=([^&#]+)/.exec(src);
    return m ? m[1] : '';
  })();
  var SCRIPT_DIR = (function () {
    var src = (document.currentScript && document.currentScript.src) || '';
    return src ? src.replace(/[?#].*$/, '').replace(/[^/]*$/, '') : 'viewer/';
  })();
  function bust(u) { return VERSION ? u + (u.indexOf('?') < 0 ? '?' : '&') + 'v=' + VERSION : u; }
  function pad3(n) { return ('00' + n).slice(-3); }
  // per-visitor preferences; storage can be blocked (private mode), so never let it throw
  function store(k, v) {
    try { if (v === undefined) return window.localStorage.getItem(k); window.localStorage.setItem(k, v); } catch (e) { return null; }
  }

  function Flipbook(root, opts) {
    this.root = root;
    this.opts = opts;
    this.t = TEXT[opts.lang] || TEXT.en;
    this.page = 1;
    this.single = false;
    this.busy = false;
    this.queued = null;
    this.flashed = false;
    this.sound = new FlipSound(store('flippy-sound') !== '0', SCRIPT_DIR + 'sounds/');
    this.learned = store('flippy-flipped') === '1' && !opts.hint;
  }

  Flipbook.prototype.init = function () {
    var self = this;
    // relative to the page unless data-base is set (an empty base must stay relative, not become "/")
    // data-src: the catalogue folder (relative to the page or absolute)
    this.base = this.opts.src.replace(/\/?$/, '/');
    return this.load()
      .then(function (data) {
        self.data = data;
        self.N = data.pageCount;
        self.aspect = data.aspect;
        self.root.style.setProperty('--fb-aspect', String(data.aspect));
        if (data.title && self.opts.setTitle) document.title = data.title + (self.opts.titleSuffix || '');
        self.build();
        self.root.flippy = self;                       // the viewer instance, for scripting
        var m = /p=(\d+)/.exec(location.hash);
        self.page = self.clamp(m ? +m[1] : 1);
        self.layout(true);
        window.addEventListener('resize', function () { self.layout(); });
        window.addEventListener('hashchange', function () {
          var h = /p=(\d+)/.exec(location.hash);
          if (h && !self.isVisible(+h[1])) self.go(+h[1]);
        });
      })
      .catch(function (e) {
        self.root.innerHTML = '<p class="fb-error">' + self.t.error + '</p>';
        console.error('[flipbook]', e);
      });
  };

  // catalogue.json over http(s); catalogue.js when opened from disk, where browsers block fetch()
  Flipbook.prototype.load = function () {
    var self = this, slug = this.base.replace(/\/$/, '').split('/').pop();
    function viaScript() {
      return new Promise(function (resolve, reject) {
        var s = document.createElement('script');
        s.src = bust(self.base + 'catalogue.js');
        s.onload = function () { var d = window.FLIPPY_DATA && window.FLIPPY_DATA[slug]; d ? resolve(d) : reject(new Error('no data')); };
        s.onerror = reject;
        document.head.appendChild(s);
      });
    }
    if (location.protocol === 'file:') return viaScript();
    return fetch(bust(this.base + 'catalogue.json'))
      .then(function (r) { if (!r.ok) throw new Error(r.status); return r.json(); })
      .catch(viaScript);
  };

  /* ---------- DOM ---------- */

  Flipbook.prototype.build = function () {
    var t = this.t, self = this;
    this.root.innerHTML = '';

    this.stage = el('div', 'fb-stage');
    this.book = el('div', 'fb-book');
    this.slotL = el('div', 'fb-slot left');
    this.slotR = el('div', 'fb-slot right');
    this.book.append(this.slotL, this.slotR);
    // folded corners: bottom-right turns forward, bottom-left (left page) turns back
    var peel = '<span class="fb-peel"><span class="u"></span><span class="f"></span></span>';
    this.cornerNext = el('button', 'fb-corner next', peel);
    this.cornerPrev = el('button', 'fb-corner prev', peel);
    this.cornerNext.setAttribute('aria-label', t.next); this.cornerPrev.setAttribute('aria-label', t.prev);
    this.cornerNext.addEventListener('click', function (e) { e.stopPropagation(); if (!self.dragged) self.next(); });
    this.cornerPrev.addEventListener('click', function (e) { e.stopPropagation(); if (!self.dragged) self.prev(); });
    this.book.append(el('div', 'fb-spine'), this.cornerNext, this.cornerPrev);
    this.edgePrev = el('button', 'fb-edge prev'); this.edgePrev.setAttribute('aria-label', t.prev);
    this.edgeNext = el('button', 'fb-edge next'); this.edgeNext.setAttribute('aria-label', t.next);
    this.edgePrev.onclick = function () { self.prev(); };
    this.edgeNext.onclick = function () { self.next(); };
    this.stage.append(this.book, this.edgePrev, this.edgeNext);

    var bar = el('div', 'fb-bar');
    var title = el('div', 'fb-title'); title.textContent = this.data.title || '';
    this.btnPrev = this.button('prev', t.prev, function () { self.prev(); });
    this.btnNext = this.button('next', t.next, function () { self.next(); });
    var pageno = el('label', 'fb-pageno');
    this.pageInput = el('input'); this.pageInput.type = 'number'; this.pageInput.min = 1; this.pageInput.max = this.N;
    this.pageInput.setAttribute('aria-label', t.page);
    this.pageInput.addEventListener('change', function () { self.go(+self.pageInput.value || 1); self.pageInput.blur(); });
    var total = el('span'); total.textContent = '/ ' + this.N;
    pageno.append(this.pageInput, total);
    this.btnLinks = this.button('links', t.links, function () {
      var on = !self.root.classList.contains('show-links');
      self.root.classList.toggle('show-links', on);
      self.btnLinks.setAttribute('aria-pressed', String(on));
    });
    this.btnLinks.setAttribute('aria-pressed', 'false');
    this.menu = el('div', 'fb-menu'); this.menu.setAttribute('role', 'menu');
    var mh = el('h3'); mh.textContent = t.linkColor; this.menu.append(mh);
    ['grey', 'red', 'blue', 'white'].forEach(function (c) {
      var it = el('button', null, '<span class="dot ' + c + '"></span>');
      it.setAttribute('role', 'menuitemradio'); it.dataset.c = c;
      it.append(document.createTextNode(t.colors[c]));
      it.onclick = function () { self.setLinkColor(c, true); self.menu.classList.remove('open'); };
      self.menu.append(it);
    });
    var btnColor = this.button('palette', t.linkColor, function (e) { e.stopPropagation(); self.menu.classList.toggle('open'); });
    document.addEventListener('click', function (e) { if (!self.menu.contains(e.target)) self.menu.classList.remove('open'); });
    var btnGrid = this.button('grid', t.pages, function () { self.openGrid(); });
    this.btnSound = this.button(this.sound.on ? 'sound' : 'mute', t.sound, function () { self.toggleSound(); });
    var btnZoom = this.button('zoom', t.zoom, function () { self.openZoom(); });
    btnZoom.classList.add('fb-hide-sm');     // phones pinch-zoom instead
    var pdf = el('a', 'fb-btn fb-hide-sm', svg('pdf'));
    if (this.opts.noPdf) pdf.hidden = true;
    pdf.href = this.base + this.data.pdf; pdf.download = ''; pdf.title = t.pdf; pdf.setAttribute('aria-label', t.pdf);
    var btnFull = this.button('full', t.full, function () { self.toggleFullscreen(); });
    btnFull.classList.add('fb-hide-sm');
    if (!document.fullscreenEnabled) btnFull.hidden = true;
    bar.append(title, this.btnPrev, pageno, this.btnNext, el('span', 'fb-sep'), btnGrid, this.btnLinks, btnColor, btnZoom, this.btnSound, pdf, btnFull);

    this.grid = this.overlay(t.pages);
    this.zoom = this.overlay(t.zoom);
    this.modal = el('div', 'fb-modal');
    this.modal.innerHTML = '<div class="fb-modal-box" role="dialog" aria-modal="true"><div class="fb-overlay-head"><h2></h2>' +
      '<a class="fb-btn" target="_blank" rel="noopener">' + svg('ext') + '</a>' +
      '<button class="fb-btn">' + svg('close') + '</button></div><iframe title="' + t.product + '"></iframe></div>';
    this.modal.querySelector('h2').textContent = t.product;
    var ext = this.modal.querySelector('a'); ext.title = t.newTab; ext.setAttribute('aria-label', t.newTab);
    var mclose = this.modal.querySelector('button'); mclose.setAttribute('aria-label', t.close);
    mclose.onclick = function () { self.closeModal(); };
    this.modal.addEventListener('click', function (e) { if (e.target === self.modal) self.closeModal(); });

    this.toastEl = el('div', 'fb-toast');
    this.root.append(this.stage, bar, this.menu, this.grid.wrap, this.zoom.wrap, this.modal, this.toastEl);
    this.setLinkColor(store('flippy-links') || this.opts.linkColor || 'grey');

    this.bindGestures();
    this.bindKeys();
    this.sound.fetchAll();                 // download the sounds now; decoding waits for the first tap
    var unlock = function () { self.sound.unlock(); };
    this.root.addEventListener('pointerdown', unlock, true);
    document.addEventListener('keydown', unlock, true);
    if (!this.learned) setTimeout(function () { if (!self.learned) self.showHint(); }, 900);
  };

  Flipbook.prototype.button = function (icon, label, fn) {
    var b = el('button', 'fb-btn', svg(icon));
    b.title = label; b.setAttribute('aria-label', label); b.onclick = fn;
    return b;
  };

  Flipbook.prototype.overlay = function (label) {
    var self = this;
    var wrap = el('div', 'fb-overlay');
    var head = el('div', 'fb-overlay-head');
    var h = el('h2'); h.textContent = label;
    var close = this.button('close', this.t.close, function () { wrap.classList.remove('open'); });
    head.append(h, close);
    var body = el('div', 'fb-overlay-body');
    wrap.append(head, body);
    return { wrap: wrap, body: body, title: h, close: function () { wrap.classList.remove('open'); } };
  };

  /* one page: image + its link hotspots */
  Flipbook.prototype.pageEl = function (n, opts) {
    var self = this;
    var p = el('div', 'fb-page');
    if (!n) return p;
    var shim = el('div', 'fb-loading');
    var img = new Image();
    img.alt = this.t.page + ' ' + n;
    img.decoding = 'async';
    img.draggable = false;
    img.onload = function () { shim.remove(); };
    img.src = this.base + (opts && opts.thumb ? 'thumbs/' : 'pages/') + pad3(n) + '.webp';
    if (img.complete) shim.remove();
    p.append(shim, img);
    if (!(opts && opts.noLinks)) {
      var layer = el('div', 'flippy-links');
      (this.data.pages[n - 1].links || []).forEach(function (l) {
        // product links are real <a href> links (new tab, middle-click, long-press all work);
        // contents links are buttons that turn the book
        var b;
        if (l.page) {
          b = el('button', 'fb-hot ' + (l.kind || ''));
          b.setAttribute('aria-label', self.t.goTo + ' ' + l.page);
        } else {
          b = el('a', 'fb-hot ' + (l.kind || ''));
          b.href = self.productUrl(l.url);
          b.target = '_blank';
          b.rel = 'noopener';
          b.setAttribute('aria-label', self.t.openProduct);
        }
        b.style.left = l.x * 100 + '%'; b.style.top = l.y * 100 + '%';
        b.style.width = l.w * 100 + '%'; b.style.height = l.h * 100 + '%';
        b.addEventListener('click', function (e) {
          e.stopPropagation();
          if (self.dragged) { e.preventDefault(); return; }
          self.follow(l, n, e);
        });
        layer.append(b);
      });
      p.append(layer);
    }
    return p;
  };

  Flipbook.prototype.fill = function (slot, n) {
    slot.innerHTML = '';
    slot.classList.toggle('empty', !n);
    if (n) slot.append(this.pageEl(n));
  };

  /* ---------- page logic ---------- */

  Flipbook.prototype.clamp = function (n) { return Math.max(1, Math.min(this.N, n | 0)); };

  // spread containing page n: cover alone on the right, then 2-3, 4-5, ...
  Flipbook.prototype.spread = function (n) {
    if (n <= 1) return [null, 1];
    var l = n % 2 === 0 ? n : n - 1;
    return [l, l + 1 <= this.N ? l + 1 : null];
  };
  Flipbook.prototype.visible = function () {
    return this.single ? [this.page] : this.spread(this.page).filter(Boolean);
  };
  Flipbook.prototype.isVisible = function (n) { return this.visible().indexOf(n) >= 0; };

  Flipbook.prototype.next = function () {
    var v = this.visible();
    this.go(v[v.length - 1] + 1);
  };
  Flipbook.prototype.prev = function () {
    this.go(this.visible()[0] - 1);
  };

  Flipbook.prototype.go = function (target) {
    target = this.clamp(target);
    if (this.isVisible(target)) return;
    if (this.busy) { this.queued = target; return; }
    var forward = target > this.visible()[0];
    // one leaf for a normal turn; a quick riffle of up to 6 leaves for a jump
    var dist = this.single ? Math.abs(target - this.page) : Math.abs(this.spreadIdx(target) - this.spreadIdx(this.page));
    var count = Math.max(1, Math.min(dist, 5));
    this.hideHint(true);
    var self = this;
    this.busy = true;
    this.ready(target, count).then(function () {
      self.sound.flip(count, self.single ? (count > 1 ? 0.8 : 0.9) : (count > 1 ? 0.95 : 1.1), 0.21);
      if (self.single) self.flipSingle(target, forward, count);
      else self.flipSpread(target, forward, count);
    });
  };

  // Load the images a turn will show (target pages full size, riffle pages as thumbnails),
  // waiting at most 450 ms so a slow connection never blocks turning.
  Flipbook.prototype.ready = function (target, count) {
    var self = this, urls = [], seen = {};
    function add(n, thumb) {
      if (!n || n < 1 || n > self.N) return;
      var u = self.base + (thumb ? 'thumbs/' : 'pages/') + pad3(n) + '.webp';
      if (!seen[u]) { seen[u] = 1; urls.push(u); }
    }
    (this.single ? [target] : this.spread(target)).forEach(function (n) { add(n, false); });
    for (var k = 1; k < count; k++) {
      var m = Math.round(this.page + (target - this.page) * k / count);
      add(m - 1, true); add(m, true); add(m + 1, true);
    }
    var loads = urls.map(function (u) {
      return new Promise(function (res) {
        var i = new Image(); i.onload = i.onerror = function () { (i.decode ? i.decode().catch(function () {}) : Promise.resolve()).then(res); }; i.src = u;
      });
    });
    return Promise.race([Promise.all(loads), new Promise(function (res) { setTimeout(res, 450); })]);
  };

  Flipbook.prototype.spreadIdx = function (n) { return n <= 1 ? 0 : Math.floor(n / 2); };
  Flipbook.prototype.spreadAt = function (i) { return this.spread(i <= 0 ? 1 : i * 2); };

  /* ---------- page curl ----------
   * A turning page is drawn as paper folding along a moving line, not as a rigid card.
   * The page's free bottom corner travels from its own edge across the spine (rising a
   * little on the way, held by the spine like a real sheet). The fold is the line halfway
   * between where the corner started and where it is now:
   *   - the part of the page before the fold stays flat (the "front"),
   *   - the part beyond the fold is mirrored over the fold line and shows the back of the
   *     sheet, i.e. the page that will face us after the turn (the "flap"),
   *   - the page underneath shows through where the sheet has lifted, with a shadow.
   * Everything is drawn with clip-path polygons and one 2D matrix per frame.
   */

  function v(x, y) { return { x: x, y: y }; }
  function clipHalf(poly, M, n, keepPositive) {      // Sutherland-Hodgman against one line
    var out = [];
    function side(p) { var d = (p.x - M.x) * n.x + (p.y - M.y) * n.y; return keepPositive ? d : -d; }
    for (var i = 0; i < poly.length; i++) {
      var P = poly[i], Q = poly[(i + 1) % poly.length], sp = side(P), sq = side(Q);
      if (sp >= 0) out.push(P);
      if ((sp >= 0) !== (sq >= 0)) { var t = sp / (sp - sq); out.push(v(P.x + (Q.x - P.x) * t, P.y + (Q.y - P.y) * t)); }
    }
    return out;
  }
  function polyCss(pts) {
    if (pts.length < 3) return 'polygon(0 0, 0 0, 0 0)';
    return 'polygon(' + pts.map(function (p) { return p.x.toFixed(1) + 'px ' + p.y.toFixed(1) + 'px'; }).join(',') + ')';
  }

  // one sheet: front page number, back page number (or 'paper'), turning to the left (dir 1)
  // or to the right (dir -1); thumbnails for pages that only flash past in a riffle
  Flipbook.prototype.curl = function (front, back, dir, smallF, smallB) {
    var c = el('div', 'fb-curl');
    var partF = el('div', 'fb-curl-part'), partU = el('div', 'fb-curl-part'), partB = el('div', 'fb-curl-part');
    var fpage = this.pageEl(front, { noLinks: true, thumb: smallF });
    var bpage = back === 'paper' ? el('div', 'fb-page fb-paper') : this.pageEl(back, { noLinks: true, thumb: smallB });
    if (!back) bpage.style.visibility = 'hidden';
    var shadeU = el('div', 'fb-curl-shade under'), shadeB = el('div', 'fb-curl-shade flap');
    // each side of the sheet carries its own half of the spine shadow at full strength, on its
    // spine edge: it only shows once that edge reaches the middle, so the shadow never fades
    // or jumps as the page lands (only in a two-page spread)
    var spineF = null, spineB = null;
    if (!this.single) {
      spineF = el('div', 'fb-spine-half ' + (dir > 0 ? 'r' : 'l'));
      spineB = el('div', 'fb-spine-half ' + (dir > 0 ? 'l' : 'r'));
      spineB.style.width = '9%'; spineB.style[dir > 0 ? 'right' : 'left'] = '0';
      bpage.append(spineB);
    }
    partF.append(fpage); if (spineF) partF.append(spineF);
    partU.append(shadeU); partB.append(bpage, shadeB);
    c.append(partU, partF, partB);
    return { el: c, dir: dir, f: partF, u: partU, b: partB, fpage: fpage, bpage: bpage, shadeU: shadeU, shadeB: shadeB,
             spineF: spineF, spineB: spineB };
  };

  Flipbook.prototype.drawCurl = function (C, t) {
    var Wb = this.book.clientWidth, H = this.book.clientHeight;
    var W = this.single ? Wb : Wb / 2, sX = this.single ? 0 : Wb / 2, d = C.dir;
    if (!C.placed) {                                   // page images sit at their page rectangles
      var fx = d > 0 ? sX : sX - W, bx = d > 0 ? sX - W : sX;
      [[C.fpage, fx], [C.bpage, 0]].forEach(function (a) {
        a[0].style.inset = 'auto'; a[0].style.left = a[1] + 'px'; a[0].style.top = '0';
        a[0].style.width = W + 'px'; a[0].style.height = H + 'px';
      });
      C.bx = bx; C.placed = true;
      if (C.spineF) {                                  // same size and place as that half of .fb-spine
        var half = 0.045 * Wb;
        C.spineF.style.width = half + 'px';
        C.spineF.style.left = (d > 0 ? sX : sX - half) + 'px';
      }
    }
    var P0 = v(sX + d * W, H), E = v(sX - d * W, H);
    var X = v(P0.x + (E.x - P0.x) * t, H - H * 0.24 * Math.sin(Math.PI * t));
    // the sheet is held at the spine: its bottom corner can't get further than W from the
    // bottom of the spine, nor further than the page diagonal from the top of the spine
    var B = v(sX, H), A = v(sX, 0), D = Math.hypot(W, H), dB = Math.hypot(X.x - B.x, X.y - B.y), dA;
    if (dB > W) X = v(B.x + (X.x - B.x) * W / dB, B.y + (X.y - B.y) * W / dB);
    dA = Math.hypot(X.x - A.x, X.y - A.y);
    if (dA > D) X = v(A.x + (X.x - A.x) * D / dA, A.y + (X.y - A.y) * D / dA);

    var page = [v(sX, 0), v(sX + d * W, 0), v(sX + d * W, H), v(sX, H)];
    var len = Math.hypot(P0.x - X.x, P0.y - X.y);
    if (len < 0.5) {                                   // not lifted yet
      C.f.style.clipPath = polyCss(page); C.u.style.clipPath = C.b.style.clipPath = polyCss([]);
      return;
    }
    var n = v((P0.x - X.x) / len, (P0.y - X.y) / len), M = v((P0.x + X.x) / 2, (P0.y + X.y) / 2);
    var front = clipHalf(page, M, n, false), lifted = clipHalf(page, M, n, true);
    var md = 2 * (M.x * n.x + M.y * n.y);
    function reflect(p) { var k = 2 * (p.x * n.x + p.y * n.y) - md; return v(p.x - k * n.x, p.y - k * n.y); }
    C.f.style.clipPath = polyCss(front);
    C.u.style.clipPath = polyCss(lifted);
    // the flap reaches 1.5 px past the fold: where its anti-aliased edge met the page's, the
    // white page underneath used to show through as a thin bright line
    var overlap = clipHalf(page, v(M.x - n.x * 1.5, M.y - n.y * 1.5), n, true);
    C.b.style.clipPath = polyCss(overlap.map(reflect));
    // back of the sheet: mirror over the spine, then over the fold (= a rotation), so at the
    // end of the turn it lands exactly on its page
    var a = -(1 - 2 * n.x * n.x), bb = 2 * n.x * n.y, cc = -2 * n.x * n.y, dd = 1 - 2 * n.y * n.y;
    var e = 2 * sX * (1 - 2 * n.x * n.x) + md * n.x, f = 2 * sX * (-2 * n.x * n.y) + md * n.y;
    C.bpage.style.transformOrigin = '0 0';
    C.bpage.style.transform = 'matrix(' + [a, bb, cc, dd, e, f].map(function (q) { return q.toFixed(5); }).join(',') +
      ') translate(' + C.bx.toFixed(1) + 'px, 0)';
    // shading bands along the fold: shadow on the page underneath, a highlight on the flap
    var ang = Math.atan2(n.y, n.x) * 180 / Math.PI, k = Math.sin(Math.PI * t);
    C.shadeU.style.width = (W * 0.35) + 'px'; C.shadeB.style.width = W + 'px';
    C.shadeU.style.height = C.shadeB.style.height = (4 * H) + 'px';
    C.shadeU.style.transform = 'translate(' + M.x + 'px,' + M.y + 'px) rotate(' + ang + 'deg) translate(0,' + (-2 * H) + 'px)';
    C.shadeB.style.transform = 'translate(' + M.x + 'px,' + M.y + 'px) rotate(' + (ang + 180) + 'deg) translate(0,' + (-2 * H) + 'px)';
    // crease highlight and cast shadow: ease in as the corner lifts, ease out over the last
    // part of the turn so nothing vanishes at once when the page lands
    var inF = Math.min(1, t / 0.08), outF = Math.min(1, (1 - t) / 0.3);
    outF = outF * outF * (3 - 2 * outF);
    C.shadeU.style.opacity = C.shadeB.style.opacity = (inF * outF * (0.55 + 0.45 * k)).toFixed(3);
  };

  Flipbook.prototype.flipSpread = function (target, forward, count) {
    var self = this;
    var a = this.spreadIdx(this.page), z = this.spreadIdx(target);
    var nxt = this.spread(target), steps = [], curls = [];
    for (var k = 0; k <= count; k++) steps.push(this.spreadAt(Math.round(a + (z - a) * k / count)));
    for (k = 0; k < count; k++) {
      // each sheet turns spread k into spread k+1: the page on its front, the newly revealed facing page on its back
      var sf = k > 0, sb = k < count - 1;
      curls.push(forward ? this.curl(steps[k][1], steps[k + 1][0], 1, sf, sb) : this.curl(steps[k][0], steps[k + 1][1], -1, sf, sb));
    }
    if (forward) this.fill(this.slotR, nxt[1]); else this.fill(this.slotL, nxt[0]);
    this.runCurls(curls, count > 1 ? 950 : 1150, { swapZ: true, settle: function () {
      if (forward) self.fill(self.slotL, nxt[0]); else self.fill(self.slotR, nxt[1]);
    } }, null);
    this.setPage(target);
  };

  Flipbook.prototype.flipSingle = function (target, forward, count) {
    var self = this, pages = [], k, curls = [];
    for (k = 0; k <= count; k++) pages.push(Math.round(this.page + (target - this.page) * k / count));
    if (forward) {
      // the current (and in-between) pages peel away to the left, the target is underneath
      for (k = 0; k < count; k++) curls.push(this.curl(pages[k], 'paper', 1, k > 0));
      this.fill(this.slotR, target);
      this.runCurls(curls, count > 1 ? 850 : 1000, {}, null);
    } else {
      // the same movement played backwards: pages fold back in from the left onto the current one
      for (k = 1; k <= count; k++) curls.push(this.curl(pages[k], 'paper', 1, k < count));
      this.runCurls(curls, count > 1 ? 850 : 1000, { reverse: true, laterOnTop: true, settle: function () { self.fill(self.slotR, target); } }, null);
    }
    this.setPage(target);
  };

  // Animate one or more sheets, staggered. swapZ: a sheet moves to the top of the landing
  // stack half-way through its turn, so the last one to land ends up on top.
  // Landing: shortly before the end the finished spread is put in place underneath
  // (settle) and the last sheet fades out onto it. By then (last 8% of the turn) the sheet lies almost exactly
  // on its final page, so the fade reads as the page settling, and no edge of the moving
  // sheet (or its shading) can flash as a line in the fold when it is removed.
  Flipbook.prototype.runCurls = function (curls, ms, o, done) {
    var self = this, n = curls.length, gap = n > 1 ? 210 : 0;
    if (this.reducedMotion()) { ms = 1; gap = 0; }
    this.busy = true;
    this.book.classList.add('flipping');
    curls.forEach(function (C, k) {
      C.el.style.zIndex = o.laterOnTop ? 10 + k : 10 + (n - k);
      self.book.append(C.el);
      self.drawCurl(C, o.reverse ? 1 : 0);
    });
    var t0 = performance.now(), total = (n - 1) * gap + ms, settled = false;
    function ease(x) { return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }   // ease-in-out
    function frame(now) {
      var el_ = now - t0;
      curls.forEach(function (C, k) {
        var p = Math.max(0, Math.min(1, (el_ - k * gap) / ms)), t = ease(p);
        if (o.reverse) t = 1 - t;
        if (o.swapZ && p >= 0.5 && !C.swapped) { C.el.style.zIndex = 100 + k; C.swapped = true; }
        if (k === n - 1) {
          if (p >= 0.9 && !settled) {
            settled = true;
            if (o.settle) o.settle();
            curls.forEach(function (D, j) { if (j < n - 1) D.el.remove(); });   // sheets landed underneath
          }
          // fade only once the sheet is within ~1 px of its final place, so the two never
          // show as a double (ghosted) image
          var f = Math.max(0, Math.min(1, (p - 0.92) / 0.08));
          C.el.style.opacity = (1 - f * f * (3 - 2 * f)).toFixed(3);
        }
        self.drawCurl(C, t);
      });
      if (el_ < total) requestAnimationFrame(frame); else end();
    }
    function end() {
      if (!settled && o.settle) o.settle();
      if (done) done();
      curls.forEach(function (C) { C.el.remove(); });
      self.book.classList.remove('flipping');
      self.busy = false;
      self.afterTurn();
      if (self.queued != null) { var q = self.queued; self.queued = null; self.go(q); }
    }
    requestAnimationFrame(frame);
  };

  Flipbook.prototype.reducedMotion = function () {
    return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  };

  Flipbook.prototype.setPage = function (n) {
    this.page = n;
    this.updateUi();
    if (history.replaceState) history.replaceState(null, '', '#p=' + this.visible()[0]);
    this.preload();
  };

  Flipbook.prototype.updateUi = function () {
    var v = this.visible();
    this.pageInput.value = v[0];
    var atStart = v[0] <= 1, atEnd = v[v.length - 1] >= this.N;
    this.btnPrev.disabled = this.edgePrev.disabled = atStart;
    this.btnNext.disabled = this.edgeNext.disabled = atEnd;
    this.cornerNext.hidden = atEnd;
    // back corner sits on the left page; on phones (one page) the bottom-left of that page
    this.cornerPrev.hidden = atStart;
    // what the lifted corners reveal: the page that will be on that side after turning
    var nextPage, prevPage;
    if (this.single) { nextPage = v[0] + 1; prevPage = v[0] - 1; }
    else {
      var nx = this.spread(v[v.length - 1] + 1), pv = this.spread(v[0] - 1);
      nextPage = nx[1] || nx[0]; prevPage = pv[0] || pv[1];
    }
    // the flap casts a soft shadow onto the page underneath, along the fold
    var shade = function (dir) { return 'linear-gradient(to ' + dir + ', transparent 45%, rgba(0,0,0,.28) 50%), '; };
    this.cornerNext.querySelector('.u').style.backgroundImage = nextPage && nextPage <= this.N
      ? shade('top left') + 'url("' + this.base + 'pages/' + pad3(nextPage) + '.webp")' : '';
    this.cornerPrev.querySelector('.u').style.backgroundImage = prevPage && prevPage >= 1
      ? shade('top right') + 'url("' + this.base + 'pages/' + pad3(prevPage) + '.webp")' : '';
    if (!this.single) {
      var s = this.spread(this.page);
      this.book.classList.toggle('is-cover', !s[0]);
      this.book.classList.toggle('is-back', !s[1]);
    }
  };

  Flipbook.prototype.afterTurn = function () {
    if (this.flashed) return;
    var layers = this.book.querySelectorAll('.fb-slot .fb-links');
    var has = Array.prototype.some.call(layers, function (l) { return l.querySelector('.fb-hot'); });
    if (!has) return;
    this.flashed = true;
    Array.prototype.forEach.call(layers, function (l) { l.classList.add('flash'); });
    this.toast(this.t.hint, 4000);
  };

  Flipbook.prototype.preload = function () {
    var v = this.visible(), self = this;
    for (var d = 1; d <= 3; d++) {
      [v[0] - d, v[v.length - 1] + d].forEach(function (n) {
        if (n >= 1 && n <= self.N) { var i = new Image(); i.src = self.base + 'pages/' + pad3(n) + '.webp'; }
      });
    }
  };

  /* ---------- sound ---------- */

  // Real page-flip recordings (viewer/sounds, CC0 "10 Book Page Flips" by StarNinjas),
  // played through Web Audio so several can overlap during a riffle. A random one of the
  // ten plays each time, slightly varied, so turning pages never sounds repetitive.
  // Browsers only allow audio after the visitor taps or presses a key; that gesture unlocks it.
  function FlipSound(on, dir) {
    this.on = on;
    this.dir = dir;
    this.ctx = null;
    this.buffers = [];
    this.raw = null;
    this.last = -1;
  }
  FlipSound.prototype.fetchAll = function () {
    if (this.raw) return;
    var self = this, list = [];
    for (var i = 1; i <= 10; i++) list.push(bust(this.dir + 'flip-' + i + '.mp3'));
    this.raw = Promise.all(list.map(function (u) {
      return fetch(u).then(function (r) { return r.ok ? r.arrayBuffer() : null; }).catch(function () { return null; });
    }));
    return this.raw;
  };
  FlipSound.prototype.unlock = function () {
    if (!this.on) return;
    var AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    var self = this;
    if (!this.ctx) {
      try { this.ctx = new AC(); } catch (e) { return; }
      this.fetchAll();
      this.raw.then(function (arr) {
        arr.forEach(function (ab) {
          if (!ab) return;
          // callback form as well, for older Safari
          var p = self.ctx.decodeAudioData(ab, function (buf) { self.buffers.push(buf); }, function () {});
          if (p && p.catch) p.catch(function () {});
        });
      });
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  };
  FlipSound.prototype.one = function (when, gain, rate, maxLen) {
    var c = this.ctx, n = this.buffers.length;
    var k = Math.floor(Math.random() * n);
    if (n > 1 && k === this.last) k = (k + 1) % n;
    this.last = k;
    var src = c.createBufferSource();
    src.buffer = this.buffers[k];
    src.playbackRate.value = rate;
    var g = c.createGain();
    var t = c.currentTime + when;
    g.gain.setValueAtTime(gain, t);
    if (maxLen) {                     // riffle: shorten each flip so they don't smear together
      g.gain.setValueAtTime(gain, t + maxLen * 0.7);
      g.gain.linearRampToValueAtTime(0, t + maxLen);
    }
    src.connect(g); g.connect(c.destination);
    src.start(t);
  };
  FlipSound.prototype.flip = function (count, turn, gap) {
    if (!this.on || !this.ctx || !this.buffers.length) return;
    if (this.ctx.state !== 'running') this.ctx.resume();
    gap = gap || 0.2;
    try {
      if (count <= 1) this.one(0.04, 0.9, 0.95 + Math.random() * 0.1);
      else for (var k = 0; k < count; k++) this.one(0.04 + k * gap, 0.55 + Math.random() * 0.15, 1.05 + Math.random() * 0.15, 0.4);
    } catch (e) { /* sound is optional */ }
  };

  // grey / red / blue / white; default from data-link-color or ?links=, the visitor's choice is remembered
  Flipbook.prototype.setLinkColor = function (c, save) {
    if (['grey', 'red', 'blue', 'white'].indexOf(c) < 0) c = 'grey';
    this.root.dataset.links = c;
    this.menu.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-checked', String(b.dataset.c === c)); });
    if (save) {
      store('flippy-links', c);
      // show the new colour on the page for a moment
      var self = this;
      this.root.classList.add('show-links');
      clearTimeout(this._colorPeek);
      this._colorPeek = setTimeout(function () { if (self.btnLinks.getAttribute('aria-pressed') !== 'true') self.root.classList.remove('show-links'); }, 1500);
    }
  };

  Flipbook.prototype.toggleSound = function () {
    this.sound.on = !this.sound.on;
    store('flippy-sound', this.sound.on ? '1' : '0');
    this.btnSound.innerHTML = svg(this.sound.on ? 'sound' : 'mute');
    if (this.sound.on) { this.sound.unlock(); this.sound.flip(1); }
  };

  /* ---------- swipe / click hint ---------- */

  Flipbook.prototype.showHint = function () {
    if (this.hintEl || this.page >= this.N) return;
    var touch = window.matchMedia && window.matchMedia('(hover: none)').matches;
    var h = el('div', 'fb-hint' + (touch ? ' touch' : ''));
    h.innerHTML = '<div class="fb-hint-hand">' + svg('hand') + '</div><div class="fb-hint-text"></div>';
    h.querySelector('.fb-hint-text').textContent = touch ? this.t.swipe : this.t.click;
    this.stage.append(h);
    this.hintEl = h;
    this.book.classList.add('fb-peek');
  };

  Flipbook.prototype.hideHint = function (learned) {
    if (learned && !this.learned) { this.learned = true; store('flippy-flipped', '1'); }
    this.book.classList.remove('fb-peek');
    if (!this.hintEl) return;
    var h = this.hintEl; this.hintEl = null;
    h.classList.add('out');
    setTimeout(function () { h.remove(); }, 300);
  };

  /* ---------- layout ---------- */

  Flipbook.prototype.layout = function (force) {
    var sw = this.stage.clientWidth, sh = this.stage.clientHeight;
    var single = sw < 720 || sw / sh < this.aspect * 1.3;
    var changed = single !== this.single;
    this.single = single;
    this.book.classList.toggle('single', single);
    var ratio = single ? this.aspect : this.aspect * 2;
    var pad = sw < 500 ? 10 : 28;
    var w = Math.min(sw - pad * 2, (sh - pad * 2) * ratio);
    this.book.style.width = Math.floor(w) + 'px';
    this.book.style.height = Math.floor(w / ratio) + 'px';
    var pageW = single ? w : w / 2;
    this.book.style.setProperty('--fb-pw', Math.floor(pageW) + 'px');
    this.book.style.setProperty('--fb-ph', Math.floor(w / ratio) + 'px');
    // peel on hover: 12% of the page width (48-104 px), 25% smaller than before; same tap area
    var peelPx = Math.round(Math.max(48, Math.min(104, pageW * 0.12)));
    this.book.style.setProperty('--fb-corner', peelPx + 'px');
    this.book.style.setProperty('--fb-corner-hit', peelPx + 'px');
    if (single) this.book.classList.remove('is-cover', 'is-back');
    if (changed || force) {
      if (single) { this.fill(this.slotR, this.page); this.slotL.innerHTML = ''; }
      else { var s = this.spread(this.page); this.fill(this.slotL, s[0]); this.fill(this.slotR, s[1]); }
      this.updateUi();
      this.preload();
      var self = this;
      setTimeout(function () { self.afterTurn(); }, 600);
    }
  };

  /* ---------- links ---------- */

  // optional hook to adjust link URLs at runtime, e.g. switch a shop's language path:
  //   window.flippyLinkFilter = function (url, link) { return url.replace('/en/', '/de/'); };
  Flipbook.prototype.productUrl = function (url) {
    return typeof window.flippyLinkFilter === 'function' ? window.flippyLinkFilter(url) : url;
  };

  Flipbook.prototype.follow = function (link, fromPage, evt) {
    if (link.page) {
      this.grid.close(); this.zoom.close();
      this.go(link.page);
      return;
    }
    var url = this.productUrl(link.url);
    var u = new URL(url, location.href);
    try {
      window.dispatchEvent(new CustomEvent('flippy:link', { detail: { url: url, page: fromPage, kind: link.kind, catalogue: this.data.title, src: this.base } }));
      if (typeof window.gtag === 'function') window.gtag('event', 'catalogue_link', { link_url: url, page_number: fromPage, link_kind: link.kind });
    } catch (e) { /* analytics must never break navigation */ }

    // Same site -> show the product in a popup: the shop's own cookies apply, so the cart works.
    // Another site (e.g. this demo on GitHub) -> new tab, because a cross-site frame loses the cart.
    var sameSite = u.hostname.replace(/^www\./, '') === location.hostname.replace(/^www\./, '');
    // Modifier-clicks keep the browser's own behaviour (open in background tab etc.).
    if ((sameSite || this.opts.popup) && !(evt && (evt.ctrlKey || evt.metaKey || evt.shiftKey || evt.button === 1))) {
      if (evt) evt.preventDefault();
      this.openModal(url);
    }
    // otherwise the <a target="_blank"> opens the product in a new tab
  };

  Flipbook.prototype.openModal = function (url) {
    this.modal.querySelector('iframe').src = url;
    this.modal.querySelector('a').href = url;
    this.modal.classList.add('open');
  };
  Flipbook.prototype.closeModal = function () {
    this.modal.classList.remove('open');
    this.modal.querySelector('iframe').src = 'about:blank';
  };

  /* ---------- overlays ---------- */

  Flipbook.prototype.openGrid = function () {
    var self = this, g = this.grid;
    if (!g.built) {
      var wrap = el('div', 'fb-grid');
      for (var n = 1; n <= this.N; n++) (function (n) {
        var b = el('button', 'fb-thumb');
        var img = new Image(); img.loading = 'lazy'; img.alt = ''; img.src = self.base + 'thumbs/' + pad3(n) + '.webp';
        b.append(img, document.createTextNode(String(n)));
        b.dataset.n = n;
        b.onclick = function () { g.close(); self.go(n); };
        wrap.append(b);
      })(n);
      g.body.append(wrap);
      g.built = true;
    }
    var v = this.visible();
    g.body.querySelectorAll('.fb-thumb').forEach(function (b) { b.classList.toggle('current', v.indexOf(+b.dataset.n) >= 0); });
    g.wrap.classList.add('open');
    var cur = g.body.querySelector('.fb-thumb.current');
    if (cur) cur.scrollIntoView({ block: 'center' });
  };

  Flipbook.prototype.openZoom = function () {
    var self = this, z = this.zoom;
    z.body.innerHTML = '';
    var list = el('div', 'fb-zoom-pages');
    this.visible().forEach(function (n) {
      var holder = el('div', 'fb-zoom-page');
      holder.append(self.pageEl(n));
      list.append(holder);
    });
    z.body.append(list);
    z.title.textContent = this.t.page + ' ' + this.visible().join('–');
    z.wrap.classList.add('open');
    z.body.scrollTop = 0;
  };

  Flipbook.prototype.toggleFullscreen = function () {
    if (document.fullscreenElement) document.exitFullscreen();
    else if (this.root.requestFullscreen) this.root.requestFullscreen();
  };

  Flipbook.prototype.toast = function (msg, ms) {
    var t = this.toastEl;
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(this._toast);
    this._toast = setTimeout(function () { t.classList.remove('show'); }, ms || 2500);
  };

  /* ---------- input ---------- */

  Flipbook.prototype.bindGestures = function () {
    var self = this, sx = 0, sy = 0, down = false, moved = false;
    this.stage.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      down = true; moved = false; sx = e.clientX; sy = e.clientY;
    });
    this.stage.addEventListener('pointermove', function (e) {
      if (down && Math.hypot(e.clientX - sx, e.clientY - sy) > 10) moved = true;
    });
    function up(e) {
      if (!down) return;
      down = false;
      var dx = e.clientX - sx, dy = e.clientY - sy;
      self.dragged = moved;
      setTimeout(function () { self.dragged = false; }, 0);
      if (Math.abs(dx) > 45 && Math.abs(dx) > Math.abs(dy) * 1.2) {
        if (dx < 0) self.next(); else self.prev();
      }
    }
    this.stage.addEventListener('pointerup', up);
    this.stage.addEventListener('pointercancel', function () { down = false; });
  };

  Flipbook.prototype.bindKeys = function () {
    var self = this;
    document.addEventListener('keydown', function (e) {
      if (e.target && e.target.tagName === 'INPUT') return;
      if (e.key === 'Escape') { self.closeModal(); self.grid.close(); self.zoom.close(); return; }
      if (self.modal.classList.contains('open')) return;
      if (e.key === 'ArrowRight' || e.key === 'PageDown') { self.next(); e.preventDefault(); }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { self.prev(); e.preventDefault(); }
      else if (e.key === 'Home') self.go(1);
      else if (e.key === 'End') self.go(self.N);
    });
  };

  /* ---------- boot ---------- */

  // Every element with class "flippy" and a data-src becomes a viewer. Options
  // (data attributes; the page URL can override the ones marked *):
  //   data-src          catalogue folder, containing catalogue.json            (?c= a folder name under catalogues/)
  //   data-lang         interface language: en, bg, ...                        (*?lang=)
  //   data-link-color   link highlight: grey, red, blue, white                 (*?links=)
  //   data-popup        "true": open links in an in-page popup (same site only, see README)  (*?popup=1)
  //   data-pdf          "false": hide the PDF download button
  //   data-set-title    "false": don't set document.title from the catalogue
  //   data-title-suffix text added after the catalogue title in document.title
  function boot() {
    var q = new URLSearchParams(location.search);
    document.querySelectorAll('.flippy').forEach(function (root) {
      var src = root.dataset.src || (q.get('c') ? 'catalogues/' + q.get('c') + '/' : '');
      if (!src) return;
      var lang = q.get('lang') || root.dataset.lang || (document.documentElement.lang || 'en').slice(0, 2);
      root.classList.add('fb');
      new Flipbook(root, {
        src: src,
        lang: TEXT[lang] ? lang : 'en',
        popup: q.get('popup') === '1' || root.dataset.popup === 'true',
        noPdf: root.dataset.pdf === 'false',
        hint: q.get('hint') === '1',
        linkColor: q.get('links') || root.dataset.linkColor,
        setTitle: root.dataset.setTitle !== 'false',
        titleSuffix: root.dataset.titleSuffix || ''
      }).init();
    });
  }

  window.Flippy = Flipbook;
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
