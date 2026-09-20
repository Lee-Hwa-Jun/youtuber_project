/* ============================================================================
 * Feed Sorter (개인용) — content.js  [ISOLATED(콘텐츠 스크립트) 컨텍스트]
 * ----------------------------------------------------------------------------
 * 역할
 *   1) inject.js 가 보낸 영상 메타데이터를 레지스트리에 모읍니다.
 *   2) 화면의 카드(썸네일) DOM 과 영상 id 를 매핑합니다.
 *   3) 정렬 / 최소 조회수 흐리게 처리 / 스탯 오버레이 / 다운로드 버튼을 적용합니다.
 *   4) 무한 스크롤(MutationObserver)·SPA 이동(URL 변경)에 계속 반응합니다.
 *
 * 방어 원칙: 모든 DOM 조작은 try-catch. 실패해도 페이지 기능을 막지 않습니다.
 * ========================================================================== */
(function () {
  'use strict';

  const C = window.__FS_CONST__;
  if (!C) { console.warn('[Feed Sorter] constants.js 가 먼저 로드되지 않았습니다.'); return; }
  if (window.__FS_CONTENT__) return;
  window.__FS_CONTENT__ = true;

  const PLATFORM = C.platform();
  const SITE = C.site();
  if (!PLATFORM || !SITE) return;

  const LINK_RE = new RegExp(SITE.ITEM_LINK_RE);
  const HOST_KEY = PLATFORM === 'tiktok' ? 'tiktok.com' : 'instagram.com';

  const DEFAULTS = {
    minViews: 0,
    showBadge: true,
    showTier: true,
    showDate: false,
    showExactTime: true,  // 커서를 올리면 정확한 업로드 시각(내 시간대) 툴팁
    showDownload: true,
    showTags: true,
    byDomain: {}          // { 'tiktok.com': 'views', 'instagram.com': 'original' }
  };

  const S = {
    items: new Map(),     // key(영상id/shortcode) -> item
    cells: new Map(),     // key -> HTMLElement (현재 화면의 카드)
    meta: new WeakMap(),  // HTMLElement -> { key, order }
    order: 0,             // 원래 순서 보존용 카운터
    settings: Object.assign({}, DEFAULTS),
    reordering: false,
    lastUrl: location.href,
    lastWarn: 0,
    lastScrollT: 0        // 마지막 스크롤 시각 — 이 직후에는 재정렬을 미룹니다
  };

  const keyOfItem = (it) => PLATFORM === 'tiktok' ? String(it.id) : String(it.code || it.id);

  /* ============ 0. 페이지 컨텍스트에 inject.js 를 꽂는다 ============
   * 상수는 src/constants.js 한 곳에만 두고 data 속성으로 건네줍니다.
   * (manifest 의 content_scripts 두 항목이 같은 js 파일을 공유하면 크롬이
   *  두 번째 항목을 조용히 건너뛰므로, world:MAIN 등록 대신 이 방식을 씁니다) */
  function injectPageScript() {
    try {
      if (!chrome || !chrome.runtime || !chrome.runtime.getURL) {
        C.warn('확장 컨텍스트가 없어 페이지 스크립트를 주입하지 못했습니다.');
        return;
      }
      const s = document.createElement('script');
      s.src = chrome.runtime.getURL('src/inject.js');
      s.dataset.fsConfig = JSON.stringify({
        platform: PLATFORM,
        eventItems: C.EVENT_ITEMS,
        eventNav: C.EVENT_NAV,
        apiPatterns: SITE.API_PATTERNS,
        initialStateIds: SITE.INITIAL_STATE_IDS,
        walkMaxDepth: C.WALK_MAX_DEPTH,
        walkMaxNodes: C.WALK_MAX_NODES
      });
      s.onload = function () { try { s.remove(); } catch (e) { /* noop */ } };
      s.onerror = function () { C.warn('페이지 스크립트 로드 실패 — manifest 의 web_accessible_resources 를 확인하세요.'); };
      (document.head || document.documentElement).appendChild(s);
    } catch (e) {
      C.warn('페이지 스크립트 주입 실패:', e && e.message);
    }
  }
  injectPageScript();

  /* ====================== 1. 데이터 수신 (inject.js) ====================== */
  window.addEventListener(C.EVENT_ITEMS, function (ev) {
    try {
      const payload = JSON.parse(ev.detail);
      if (!payload || !Array.isArray(payload.items)) return;
      let added = 0;
      payload.items.forEach(function (it) {
        const k = keyOfItem(it);
        if (!k) return;
        const prev = S.items.get(k);
        /* 뒤늦게 온 응답이 더 풍부할 수 있으니 값이 있는 필드만 덮어씁니다 */
        if (prev) {
          Object.keys(it).forEach(function (f) {
            if (it[f] !== null && it[f] !== undefined && it[f] !== '') prev[f] = it[f];
          });
        } else {
          S.items.set(k, it);
          added++;
        }
      });
      if (added) schedule();
      else schedule();   // 값 갱신만 있어도 뱃지를 다시 그립니다
    } catch (e) {
      C.warn('수신 데이터 처리 실패:', e && e.message);
    }
  });

  /* ====================== 2. 카드(셀) 탐지 및 매핑 ====================== */

  function keyFromHref(href) {
    if (!href) return null;
    try {
      const m = LINK_RE.exec(href);
      if (!m) return null;
      /* TikTok: [full, handle, id] / Instagram: [full, shortcode] */
      return PLATFORM === 'tiktok' ? m[2] : m[1];
    } catch (e) { return null; }
  }

  /** 검색 범위를 좁히는 힌트. 셀렉터가 안 맞으면 document 전체를 봅니다. */
  function scopeRoot() {
    try {
      const sels = SITE.GRID_SELECTORS || [];
      for (let i = 0; i < sels.length; i++) {
        const el = document.querySelector(sels[i]);
        if (el && el.querySelector('a[href]')) return el;
      }
    } catch (e) { /* noop */ }
    return document.body || document.documentElement;
  }

  /** 요소 안에 서로 다른 영상 링크가 몇 개 있는지 (스캔 1회 동안 캐시) */
  function countKeys(el, cache) {
    if (cache.has(el)) return cache.get(el);
    let n = 0;
    try {
      const seen = new Set();
      const as = el.querySelectorAll('a[href]');
      for (let i = 0; i < as.length; i++) {
        const k = keyFromHref(as[i].getAttribute('href'));
        if (k && !seen.has(k)) { seen.add(k); n++; }
        if (n > 1) break;      // 2 이상인지만 알면 충분
      }
    } catch (e) { /* noop */ }
    cache.set(el, n);
    return n;
  }

  /**
   * 각 영상 링크에 대해 "그 영상 하나만 담고 있는 가장 바깥 요소"를 셀로 봅니다.
   * 부모가 두 개 이상의 영상을 담기 시작하면 거기서 멈춥니다.
   * → 한 줄에 3개씩 놓는 레이아웃(Instagram)에서도 개별 카드를 정확히 찾습니다.
   */
  function cellFor(anchor, cache) {
    let cell = anchor, depth = 0;
    while (cell.parentElement && depth < 8) {
      const p = cell.parentElement;
      const tag = p.tagName;
      if (tag === 'BODY' || tag === 'HTML' || tag === 'MAIN') break;
      if (countKeys(p, cache) > 1) break;
      cell = p; depth++;
    }
    return cell;
  }

  /** 화면의 카드들을 모두 찾아 레지스트리에 등록 */
  function collectCells() {
    const root = scopeRoot();
    const cache = new Map();
    const found = [];       // [{key, cell}]
    const usedKeys = new Set();
    let anchors = [];
    try {
      anchors = Array.prototype.slice.call(root.querySelectorAll('a[href]'));
    } catch (e) { return found; }

    for (let i = 0; i < anchors.length; i++) {
      const a = anchors[i];
      const key = keyFromHref(a.getAttribute('href'));
      if (!key || usedKeys.has(key)) continue;
      let cell;
      try { cell = cellFor(a, cache); } catch (e) { continue; }
      if (!cell || cell === document.body) continue;
      usedKeys.add(key);
      found.push({ key: key, cell: cell });

      const meta = S.meta.get(cell);
      if (!meta || meta.key !== key) {
        S.meta.set(cell, { key: key, order: S.order++ });
      }
      S.cells.set(key, cell);
    }
    /* 화면에서 사라진 카드는 정리 */
    S.cells.forEach(function (el, k) {
      if (!usedKeys.has(k) || !el.isConnected) S.cells.delete(k);
    });
    return found;
  }

  /* ====================== 3. 오버레이(뱃지/테두리/다운로드) ====================== */

  /**
   * 오버레이를 붙일 기준 요소.
   * 카드 전체를 기준으로 하면 썸네일 아래 캡션/작성자 영역까지 덮어버리므로,
   * 썸네일을 감싸는 영상 링크(<a>)를 기준으로 삼습니다. 못 찾으면 카드 전체.
   */
  function hostFor(cell) {
    try {
      const as = cell.querySelectorAll('a[href]');
      for (let i = 0; i < as.length; i++) {
        const a = as[i];
        if (!keyFromHref(a.getAttribute('href'))) continue;
        /* 링크가 실제로 눈에 보이는 박스여야 오버레이를 얹을 수 있습니다.
           display:inline 인 링크는 박스가 없어 테두리가 그려지지 않으므로,
           안쪽 첫 요소 → 그것도 안 되면 카드 전체로 물러납니다. */
        if (isBox(a)) return a;
        /* 인라인 링크면 그 안에서 박스를 찾습니다 (최대 3단계) */
        let level = [a];
        for (let d = 0; d < 3 && level.length; d++) {
          const next = [];
          for (let j = 0; j < level.length; j++) {
            const kids = level[j].children;
            for (let k = 0; k < kids.length; k++) {
              if (isBox(kids[k])) return kids[k];
              next.push(kids[k]);
            }
          }
          level = next;
        }
        return cell;   /* 마땅한 박스가 없으면 카드 전체 기준 */
      }
    } catch (e) { /* noop */ }
    return cell;
  }

  /**
   * 오버레이를 담을 수 있는 요소인지.
   *  - <img> 같은 대체 요소는 자식을 넣을 수 없어 제외합니다.
   *  - display:inline 은 테두리(box-shadow)가 그려지지 않으므로 제외합니다.
   *    (인라인 링크라도 offsetHeight 는 블록 자식 크기를 보고하므로 믿으면 안 됩니다)
   */
  const NOT_CONTAINER = /^(IMG|VIDEO|CANVAS|SVG|INPUT|BR|HR|PICTURE|SOURCE)$/;
  function isBox(el) {
    try {
      if (!el || el.nodeType !== 1 || NOT_CONTAINER.test(el.tagName)) return false;
      const d = getComputedStyle(el).display;
      if (d === 'inline' || d === 'contents' || d === 'none') return false;
      return el.offsetHeight > 20 && el.offsetWidth > 20;
    } catch (e) { return false; }
  }

  function ensureBadge(cell, item) {
    const st = S.settings;
    let badge = cell.querySelector(':scope > .fs-badge');

    if (!st.showBadge) { if (badge) badge.remove(); return; }

    const parts = [];
    if (item.views !== null && item.views !== undefined) parts.push('👁 ' + C.fmtNum(item.views));
    if (item.likes !== null && item.likes !== undefined) parts.push('❤ ' + C.fmtNum(item.likes));
    if (item.comments !== null && item.comments !== undefined) parts.push('💬 ' + C.fmtNum(item.comments));
    if (st.showDate && item.createTime) {
      const age = C.fmtAge(item.createTime);
      if (age) parts.push('🕑 ' + age);
    }
    const text = parts.join(' · ');
    if (!text) { if (badge) badge.remove(); return; }

    if (!badge) {
      badge = document.createElement('div');
      badge.className = 'fs-badge';
      cell.appendChild(badge);
    }
    if (badge.textContent !== text) badge.textContent = text;
  }

  function ensureDownload(cell, item) {
    let btn = cell.querySelector(':scope > .fs-dl');
    if (!S.settings.showDownload || !item.mediaUrl) { if (btn) btn.remove(); return; }
    if (btn) return;

    btn = document.createElement('button');
    btn.className = 'fs-dl';
    btn.type = 'button';
    btn.title = '이 영상 파일 저장';
    btn.textContent = '⬇';
    btn.addEventListener('click', function (ev) {
      ev.preventDefault(); ev.stopPropagation();
      download(item, btn);
    }, true);
    cell.appendChild(btn);
  }

  /* ── 해시태그 칩: 좌상단, 클릭하면 새 탭에서 그 태그 검색 ── */
  function tagUrl(tag) {
    const base = PLATFORM === 'tiktok' ? C.TIKTOK.TAG_URL : C.INSTAGRAM.TAG_URL;
    return base + encodeURIComponent(tag) + (PLATFORM === 'instagram' ? '/' : '');
  }
  function tagChip(tag) {
    const el = document.createElement('span');
    el.className = 'fs-tag';
    el.textContent = '#' + tag;
    el.title = '#' + tag + ' 검색 (새 탭)';
    /* 캡처 단계에서 잡아 바깥 카드 링크가 열리지 않게 막습니다 */
    el.addEventListener('click', function (ev) {
      ev.preventDefault(); ev.stopPropagation();
      window.open(tagUrl(tag), '_blank', 'noopener');
    }, true);
    return el;
  }
  function ensureTags(host, item) {
    let box = host.querySelector(':scope > .fs-tags');
    const tags = Array.isArray(item.tags) ? item.tags : [];
    if (!S.settings.showTags || !tags.length) { if (box) box.remove(); return; }
    const sig = tags.join('|');
    /* 변화 없으면 다시 그리지 않음. 사용자가 +N 으로 펼쳐 둔 상태('#all')도 유지 */
    if (box && (box.dataset.sig === sig || box.dataset.sig === sig + '#all')) return;
    if (!box) { box = document.createElement('div'); box.className = 'fs-tags'; host.appendChild(box); }
    box.dataset.sig = sig;
    box.innerHTML = '';
    const max = C.MAX_TAG_CHIPS;
    tags.slice(0, max).forEach(function (t) { box.appendChild(tagChip(t)); });
    if (tags.length > max) {
      const more = document.createElement('span');
      more.className = 'fs-tag fs-tag-more';
      more.textContent = '+' + (tags.length - max);
      more.title = '나머지 해시태그 ' + (tags.length - max) + '개 보기';
      more.addEventListener('click', function (ev) {
        ev.preventDefault(); ev.stopPropagation();
        box.innerHTML = '';
        tags.forEach(function (t) { box.appendChild(tagChip(t)); });
        box.dataset.sig = sig + '#all';
      }, true);
      box.appendChild(more);
    }
  }

  /* ── 업로드 시각 툴팁: 카드에 커서를 올리면 정확한 게시 시각을 내 시간대로 ──
     플랫폼이 보여주는 "3개월 전" 같은 상대 표기 대신, 응답에 들어 있는 UTC
     타임스탬프를 브라우저 시간대(예: Asia/Seoul)로 바꿔 초 단위까지 보여줍니다.
     툴팁은 문서에 하나만 두고, 카드마다 mouseenter/leave 핸들러를 한 번씩만 붙입니다. */
  let tipEl = null;
  function tipNode() {
    if (tipEl && tipEl.isConnected) return tipEl;
    tipEl = document.createElement('div');
    tipEl.className = 'fs-tip';
    tipEl.setAttribute('role', 'tooltip');
    (document.body || document.documentElement).appendChild(tipEl);
    return tipEl;
  }
  function hideTip() { if (tipEl) tipEl.classList.remove('fs-tip-on'); }
  function placeTip(x, y) {
    const el = tipNode();
    const off = C.TIP_OFFSET, vw = window.innerWidth, vh = window.innerHeight;
    const w = el.offsetWidth || 220, h = el.offsetHeight || 44;
    let left = x + off.x, top = y + off.y;
    if (left + w > vw - 8) left = Math.max(8, x - off.x - w);   /* 오른쪽 벽이면 커서 왼쪽으로 */
    if (top + h > vh - 8) top = Math.max(8, y - off.y - h);     /* 아래 벽이면 커서 위로 */
    el.style.left = left + 'px'; el.style.top = top + 'px';
  }
  function showTip(cell, x, y) {
    if (!S.settings.showExactTime) return hideTip();
    const meta = S.meta.get(cell);
    const item = meta && S.items.get(meta.key);
    const t = item && C.fmtExact(item.createTime);
    if (!t) return hideTip();
    const el = tipNode();
    el.innerHTML = '';
    const l1 = document.createElement('div'); l1.className = 'fs-tip-main';
    l1.textContent = '🕑 ' + t.date + ' (' + t.weekday + ') ' + t.time;
    const l2 = document.createElement('div'); l2.className = 'fs-tip-sub';
    l2.textContent = (t.tz || '내 시간대') + (t.offset ? ' · ' + t.offset : '') + (t.age ? ' · ' + t.age : '');
    el.appendChild(l1); el.appendChild(l2);
    el.classList.add('fs-tip-on');
    placeTip(x, y);
  }
  function ensureHover(cell) {
    if (cell.dataset.fsHover) return;
    cell.dataset.fsHover = '1';
    cell.addEventListener('mouseenter', function (ev) { showTip(cell, ev.clientX, ev.clientY); });
    cell.addEventListener('mousemove', function (ev) {
      if (tipEl && tipEl.classList.contains('fs-tip-on')) placeTip(ev.clientX, ev.clientY);
    });
    cell.addEventListener('mouseleave', hideTip);
  }

  /* 테두리는 썸네일(host)에 그립니다. 카드 전체에 그리면 아래 캡션 위를 덮습니다. */
  function applyTier(host, item) {
    host.classList.remove('fs-gold', 'fs-green');
    if (!S.settings.showTier) return;
    const v = Number(item.views);
    if (!isFinite(v)) return;
    if (v >= C.TIERS.GOLD) host.classList.add('fs-gold');
    else if (v >= C.TIERS.GREEN) host.classList.add('fs-green');
  }

  function decorate(cell, item) {
    try {
      cell.classList.add('fs-cell');
      const host = hostFor(cell);
      host.classList.add('fs-host');
      ensureBadge(host, item);
      ensureDownload(host, item);
      ensureTags(host, item);
      ensureHover(cell);
      applyTier(host, item);
      const min = Number(S.settings.minViews) || 0;
      const v = Number(item.views);
      const below = min > 0 && isFinite(v) && v < min;
      cell.classList.toggle('fs-dim', below);
    } catch (e) { /* 개별 카드 실패는 무시 */ }
  }

  /* ====================== 4. 정렬 ====================== */

  const COMPARATORS = {
    views:    (a, b) => n(b.views) - n(a.views),
    likes:    (a, b) => n(b.likes) - n(a.likes),
    comments: (a, b) => n(b.comments) - n(a.comments),
    newest:   (a, b) => n(b.createTime) - n(a.createTime),
    oldest:   (a, b) => p(a.createTime) - p(b.createTime)
  };
  const n = (v) => { const x = Number(v); return isFinite(x) ? x : -1; };            // 없으면 뒤로
  const p = (v) => { const x = Number(v); return isFinite(x) && x > 0 ? x : Infinity; }; // 없으면 뒤로

  function currentSort() {
    const by = S.settings.byDomain || {};
    return by[HOST_KEY] || 'original';
  }

  /** 행(row) 구조를 유지한 채 셀 순서만 바꿉니다 (한 줄 3칸 레이아웃도 지원) */
  function reorder(found) {
    const sortKey = currentSort();
    if (!found.length) return;

    /* 행별로 셀을 묶습니다 (DOM 순서 유지) */
    const rows = [];
    const rowMap = new Map();
    found.forEach(function (f) {
      const row = f.cell.parentElement;
      if (!row) return;
      let bucket = rowMap.get(row);
      if (!bucket) { bucket = []; rowMap.set(row, bucket); rows.push(row); }
      bucket.push(f.cell);
    });

    /* 정렬 대상 셀 전체를 하나로 모아 정렬 */
    let all = [];
    rows.forEach(function (r) { all = all.concat(rowMap.get(r)); });

    const cmp = COMPARATORS[sortKey];
    const sorted = all.slice();
    if (cmp) {
      sorted.sort(function (ca, cb) {
        const ma = S.meta.get(ca), mb = S.meta.get(cb);
        const ia = ma && S.items.get(ma.key), ib = mb && S.items.get(mb.key);
        /* 데이터가 아직 없는 카드는 항상 뒤로 (원래 순서 유지) */
        if (!ia && !ib) return (ma ? ma.order : 0) - (mb ? mb.order : 0);
        if (!ia) return 1;
        if (!ib) return -1;
        const r = cmp(ia, ib);
        if (r !== 0) return r;
        return (ma ? ma.order : 0) - (mb ? mb.order : 0);
      });
    } else {
      sorted.sort(function (ca, cb) {
        const ma = S.meta.get(ca), mb = S.meta.get(cb);
        return (ma ? ma.order : 0) - (mb ? mb.order : 0);
      });
    }

    /* 행 용량을 유지하면서 순서대로 다시 배치 */
    S.reordering = true;
    try {
      let idx = 0;
      rows.forEach(function (row) {
        const cap = rowMap.get(row).length;
        const want = sorted.slice(idx, idx + cap);
        idx += cap;
        /* 뒤에서부터 insertBefore → 이미 맞는 순서면 DOM 변경이 없습니다 */
        let ref = null;
        for (let i = want.length - 1; i >= 0; i--) {
          const node = want[i];
          if (node.parentNode !== row || node.nextSibling !== ref) {
            row.insertBefore(node, ref);
          }
          ref = node;
        }
      });
    } catch (e) {
      C.warn('재정렬 실패(원본 순서 유지):', e && e.message);
    } finally {
      S.reordering = false;
    }
  }

  /* ====================== 5. 메인 루프 ====================== */

  let timer = null;
  function schedule() {
    if (timer) return;
    timer = setTimeout(function () { timer = null; run(); }, C.DEBOUNCE_MS);
  }

  /**
   * 재정렬 전후로 "보고 있던 카드"의 화면 위치를 그대로 유지합니다.
   * 새 카드가 화면 위쪽에 끼어들면 그만큼 스크롤을 보정해 시야가 튕기지 않게 합니다.
   * 앵커는 이미 데이터가 붙어 정렬 자리가 안정된(fs-cell) 카드 중 화면 안 맨 위 것.
   */
  function pickAnchor(found) {
    let best = null, bestTop = Infinity;
    const vh = window.innerHeight || 800;
    for (let i = 0; i < found.length; i++) {
      const el = found[i].cell;
      if (!el.classList.contains('fs-cell')) continue;
      const r = el.getBoundingClientRect();
      if (r.bottom <= 0 || r.top >= vh) continue;
      if (r.top < bestTop) { bestTop = r.top; best = el; }
    }
    return best ? { el: best, top: bestTop } : null;
  }
  /** 이 요소를 실제로 스크롤하는 컨테이너 (없으면 window) */
  function scrollerOf(el) {
    let n = el.parentElement;
    while (n && n !== document.body && n !== document.documentElement) {
      try {
        const oy = getComputedStyle(n).overflowY;
        if ((oy === 'auto' || oy === 'scroll') && n.scrollHeight > n.clientHeight + 1) return n;
      } catch (e) { break; }
      n = n.parentElement;
    }
    return window;
  }
  function anchoredReorder(found) {
    const a = pickAnchor(found);
    reorder(found);
    if (!a || !a.el.isConnected) return;
    try {
      const delta = a.el.getBoundingClientRect().top - a.top;
      if (Math.abs(delta) < 1) return;
      const sc = scrollerOf(a.el);
      if (sc === window) window.scrollBy(0, delta);
      else sc.scrollTop += delta;
    } catch (e) { /* 보정 실패는 무시 */ }
  }

  function run() {
    try {
      const found = collectCells();
      let matched = 0;
      found.forEach(function (f) {
        const item = S.items.get(f.key);
        if (item) { matched++; decorate(f.cell, item); }
      });

      /* 스크롤 중에는 뱃지만 붙이고 재정렬은 손을 뗀 뒤로 미룹니다 */
      const sinceScroll = Date.now() - S.lastScrollT;
      if (sinceScroll >= C.SCROLL_IDLE_MS) {
        anchoredReorder(found);
      } else {
        setTimeout(schedule, C.SCROLL_IDLE_MS - sinceScroll + 10);
      }
      diagnose(found.length, matched);
    } catch (e) {
      C.warn('처리 중 예외(페이지는 정상):', e && e.message);
    } finally {
      /* 위에서 우리가 만든 DOM 변경(뱃지·이동)이 관찰자를 다시 깨우지 않게 버립니다.
         S.reordering 플래그만으로는 막을 수 없습니다 — 관찰자 콜백은 이 함수가
         끝난 뒤 마이크로태스크로 오므로 그때는 이미 플래그가 내려가 있습니다. */
      try { mo.takeRecords(); } catch (e) { /* noop */ }
    }
  }

  /** 카드는 보이는데 데이터가 하나도 안 붙으면 구조 변경을 의심하고 경고 */
  function diagnose(cards, matched) {
    if (cards >= 6 && matched === 0 && Date.now() - S.lastWarn > 20000) {
      S.lastWarn = Date.now();
      C.warn(
        '카드 ' + cards + '개를 찾았지만 영상 데이터와 하나도 매칭되지 않았습니다.\n' +
        '  · 스크롤을 조금 내려 새 응답이 오면 자동으로 채워질 수 있습니다.\n' +
        '  · 계속 이 경고가 보이면 링크 형식이 바뀐 것입니다.\n' +
        '    → src/constants.js 의 ' + PLATFORM.toUpperCase() + '.ITEM_LINK_RE 를 확인하세요.'
      );
    }
  }

  /* ====================== 6. 관찰자들 ====================== */

  const mo = new MutationObserver(function (muts) {
    if (S.reordering) return;
    for (let i = 0; i < muts.length; i++) {
      const m = muts[i];
      if (!m.addedNodes || !m.addedNodes.length) continue;
      /* 우리가 그리는 툴팁의 변화는 무시 — 호버마다 재스캔이 돌면 낭비이고,
         펼쳐 둔 해시태그(+N)가 다시 접히는 부작용이 납니다 */
      if (tipEl && (m.target === tipEl || tipEl.contains(m.target) || (m.addedNodes.length === 1 && m.addedNodes[0] === tipEl))) continue;
      schedule(); return;
    }
  });

  function startObserving() {
    try {
      if (document.body) mo.observe(document.body, { childList: true, subtree: true });
    } catch (e) { C.warn('MutationObserver 등록 실패:', e && e.message); }
    /* scroll 은 버블링하지 않으므로 capture 로 잡아야 스크롤 컨테이너까지 보입니다 */
    try {
      document.addEventListener('scroll', function () { S.lastScrollT = Date.now(); }, { capture: true, passive: true });
    } catch (e) { /* noop */ }
  }

  function resetForNavigation() {
    hideTip();
    S.cells.clear();
    S.order = 0;
    /* 수집한 데이터(S.items)는 세션 내내 유지합니다 — CSV 내보내기용 */
    schedule();
  }

  function checkUrl() {
    if (location.href !== S.lastUrl) {
      S.lastUrl = location.href;
      resetForNavigation();
    }
  }
  window.addEventListener(C.EVENT_NAV, checkUrl);
  window.addEventListener('popstate', checkUrl);
  setInterval(checkUrl, C.URL_POLL_MS);

  /* ====================== 7. 다운로드 ====================== */

  function download(item, btn) {
    const name = (item.platform + '_' + (item.author || 'unknown') + '_' + (item.code || item.id))
      .replace(/[^A-Za-z0-9._@-]+/g, '_').slice(0, 80) + '.mp4';
    if (btn) { btn.disabled = true; btn.textContent = '…'; }
    const done = function (ok, msg) {
      if (btn) { btn.disabled = false; btn.textContent = ok ? '✓' : '⬇'; }
      if (btn && ok) setTimeout(function () { try { btn.textContent = '⬇'; } catch (e) {} }, 2000);
      toast(ok ? '다운로드를 시작했습니다' : ('다운로드 실패: ' + (msg || '알 수 없는 오류')), !ok);
    };
    try {
      if (!chrome || !chrome.runtime || !chrome.runtime.sendMessage) { done(false, '확장 컨텍스트 없음'); return; }
      chrome.runtime.sendMessage(
        { type: 'FS_DOWNLOAD', url: item.mediaUrl, filename: name, pageUrl: item.url },
        function (res) {
          if (chrome.runtime.lastError) { done(false, chrome.runtime.lastError.message); return; }
          if (res && res.ok) done(true);
          else done(false, (res && res.error) || '');
        }
      );
    } catch (e) {
      done(false, e && e.message);
    }
  }

  let toastEl = null, toastTimer = null;
  function toast(msg, isErr) {
    try {
      if (!toastEl) {
        toastEl = document.createElement('div');
        toastEl.className = 'fs-toast';
        (document.body || document.documentElement).appendChild(toastEl);
      }
      toastEl.textContent = msg;
      toastEl.classList.toggle('fs-toast-err', !!isErr);
      toastEl.classList.add('fs-toast-on');
      clearTimeout(toastTimer);
      toastTimer = setTimeout(function () { toastEl.classList.remove('fs-toast-on'); }, 2600);
    } catch (e) { /* noop */ }
  }

  /* ====================== 8. 설정 & 팝업 통신 ====================== */

  function applySettings(next) {
    S.settings = Object.assign({}, DEFAULTS, next || {});
    /* 설정이 바뀌면 기존 장식을 걷어내고 다시 그립니다 */
    try {
      document.querySelectorAll('.fs-cell, .fs-host').forEach(function (el) {
        el.classList.remove('fs-gold', 'fs-green', 'fs-dim');
      });
      if (!S.settings.showBadge) document.querySelectorAll('.fs-badge').forEach(function (el) { el.remove(); });
      if (!S.settings.showDownload) document.querySelectorAll('.fs-dl').forEach(function (el) { el.remove(); });
      if (!S.settings.showTags) document.querySelectorAll('.fs-tags').forEach(function (el) { el.remove(); });
      if (!S.settings.showExactTime) hideTip();
    } catch (e) { /* noop */ }
    schedule();
  }

  function loadSettings() {
    try {
      if (!chrome || !chrome.storage || !chrome.storage.local) return;
      chrome.storage.local.get(null, function (data) {
        if (chrome.runtime.lastError) return;
        applySettings(data);
      });
      chrome.storage.onChanged.addListener(function (changes, area) {
        if (area !== 'local') return;
        const next = Object.assign({}, S.settings);
        Object.keys(changes).forEach(function (k) { next[k] = changes[k].newValue; });
        applySettings(next);
      });
    } catch (e) {
      C.warn('설정을 읽지 못했습니다:', e && e.message);
    }
  }

  function snapshot() {
    const arr = [];
    S.items.forEach(function (it, k) {
      arr.push({
        url: it.url, platform: it.platform, author: it.author,
        views: it.views, likes: it.likes, comments: it.comments,
        createTime: it.createTime, date: C.fmtDate(it.createTime),
        caption: it.caption, tags: it.tags || [], onScreen: S.cells.has(k)
      });
    });
    return arr;
  }

  try {
    if (chrome && chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener(function (msg, sender, reply) {
        try {
          if (!msg || !msg.type) return;
          if (msg.type === 'FS_STATE') {
            reply({
              ok: true, platform: PLATFORM, host: HOST_KEY,
              collected: S.items.size, onScreen: S.cells.size,
              sort: currentSort(), url: location.href
            });
            return true;
          }
          if (msg.type === 'FS_ITEMS') { reply({ ok: true, items: snapshot() }); return true; }
          if (msg.type === 'FS_RESCAN') { resetForNavigation(); reply({ ok: true }); return true; }
        } catch (e) {
          try { reply({ ok: false, error: e && e.message }); } catch (e2) { /* noop */ }
        }
      });
    }
  } catch (e) { /* noop */ }

  /* ====================== 9. 시작 ====================== */

  function boot() {
    loadSettings();
    startObserving();
    schedule();
    /* 확장이 이 페이지에서 살아있다는 표시 (문제 진단용).
       콘솔에서 document.documentElement.dataset.feedSorter 로 확인할 수 있습니다. */
    try { document.documentElement.dataset.feedSorter = 'on'; } catch (e) { /* noop */ }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }

  /* 테스트용 훅 (ISOLATED 월드 전용이라 페이지에서는 보이지 않습니다) */
  window.__FS_TEST__ = {
    S: S, run: run, applySettings: applySettings, snapshot: snapshot,
    collectCells: collectCells, keyFromHref: keyFromHref
  };
})();
