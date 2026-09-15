/* ============================================================================
 * Feed Sorter (개인용) — inject.js  [MAIN(페이지) 컨텍스트에서 실행]
 * ----------------------------------------------------------------------------
 * 역할: 페이지가 "스스로 만들어내는" fetch / XMLHttpRequest 응답을 읽어
 *       영상 메타데이터(조회수·좋아요·댓글·게시일 등)를 추출하고,
 *       CustomEvent 로 content.js(ISOLATED)에 넘깁니다.
 *
 * 이 파일은 content.js 가 <script> 태그로 페이지에 꽂아 넣습니다.
 * 상수(API 경로 등)는 src/constants.js 한 곳에만 두고, 주입할 때
 * data-fs-config 속성으로 건네받습니다. (세계가 달라 window 를 공유할 수 없음)
 *
 * 원칙
 *  - 요청을 새로 만들지 않습니다. 오직 사용자의 브라우징으로 자연히 발생한
 *    응답만 "읽기"만 합니다. (자동 스크롤·대량 수집 없음)
 *  - 어떤 경우에도 원래 fetch/XHR 의 동작과 반환값을 바꾸지 않습니다.
 *    모든 후킹 코드는 try-catch 로 감싸 실패해도 페이지가 깨지지 않습니다.
 * ========================================================================== */
(function () {
  'use strict';

  if (window.__FS_INJECTED__) return;
  window.__FS_INJECTED__ = true;

  function warn() {
    try {
      console.warn.apply(console, ['[Feed Sorter]'].concat(Array.prototype.slice.call(arguments)));
    } catch (e) { /* noop */ }
  }

  /* content.js 가 넘겨준 설정 (src/constants.js 가 원본) */
  let cfg = {};
  try {
    const self = document.currentScript;
    cfg = JSON.parse((self && self.dataset && self.dataset.fsConfig) || '{}');
  } catch (e) {
    warn('설정을 읽지 못했습니다. 기본값으로 동작합니다:', e && e.message);
  }

  const PLATFORM = cfg.platform || '';
  if (PLATFORM !== 'tiktok' && PLATFORM !== 'instagram') return;

  const API_PATTERNS = Array.isArray(cfg.apiPatterns) ? cfg.apiPatterns : null;
  const INITIAL_STATE_IDS = Array.isArray(cfg.initialStateIds) ? cfg.initialStateIds : [];
  const EVENT_ITEMS = cfg.eventItems || '__FEED_SORTER_ITEMS__';
  const EVENT_NAV = cfg.eventNav || '__FEED_SORTER_NAV__';
  const WALK_MAX_DEPTH = cfg.walkMaxDepth || 14;
  const WALK_MAX_NODES = cfg.walkMaxNodes || 40000;

  /* 디버그 모드: 콘솔에서 localStorage.setItem('fs_debug','1') 후 새로고침하면
     가로챈 응답마다 몇 건을 뽑았는지 찍고, 못 읽은 응답 원본을
     window.__FS_LAST_UNPARSED__ 에 남깁니다. */
  let DEBUG = false;
  try { DEBUG = localStorage.getItem('fs_debug') === '1'; } catch (e) { /* noop */ }
  function debug() {
    if (!DEBUG) return;
    try {
      console.log.apply(console, ['[Feed Sorter·debug]'].concat(Array.prototype.slice.call(arguments)));
    } catch (e) { /* noop */ }
  }

  /* 같은 응답을 두 번 처리하지 않도록 */
  const seen = new Set();
  /* 파싱 실패 경고를 엔드포인트당 한 번만 내보내기 위한 기록 */
  const warned = new Set();

  /* ======================== 1. 응답 → 아이템 추출 ======================== */

  /* 설정이 안 넘어온 비상시에는 일반적인 API 경로만 넓게 봅니다 */
  const FALLBACK_API = /\/api\/|\/graphql/;
  function isInteresting(url) {
    if (!url) return false;
    const u = String(url);
    if (!API_PATTERNS) return FALLBACK_API.test(u);
    for (let i = 0; i < API_PATTERNS.length; i++) {
      if (u.indexOf(API_PATTERNS[i]) > -1) return true;
    }
    return false;
  }

  /**
   * JSON 트리를 안전하게 순회 (깊이/노드 수 상한 있음).
   * ★ 반드시 너비 우선(FIFO)이어야 합니다. 스택(LIFO)으로 돌면 같은 배열 안의
   *   항목이 역순으로 나와 "원래 순서" 정렬이 피드와 반대로 뒤집힙니다.
   */
  function walk(root, visit) {
    let nodes = 0;
    const queue = [[root, 0]];
    const LIMIT = WALK_MAX_NODES;
    let head = 0;
    while (head < queue.length) {
      const entry = queue[head++];
      const node = entry[0], depth = entry[1];
      if (node === null || typeof node !== 'object') continue;
      if (++nodes > LIMIT || depth > WALK_MAX_DEPTH) continue;
      if (Array.isArray(node)) {
        for (let i = 0; i < node.length && queue.length < LIMIT; i++) queue.push([node[i], depth + 1]);
        continue;
      }
      try { visit(node); } catch (e) { /* 개별 노드 실패는 무시 */ }
      for (const k in node) {
        if (queue.length >= LIMIT) break;
        if (!Object.prototype.hasOwnProperty.call(node, k)) continue;
        const v = node[k];
        if (v && typeof v === 'object') queue.push([v, depth + 1]);
      }
    }
  }

  function num(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = Number(v);
    return isFinite(n) ? n : null;
  }
  function pick() {
    for (let i = 0; i < arguments.length; i++) {
      const n = num(arguments[i]);
      if (n !== null) return n;
    }
    return null;
  }

  /* ------------------------------ TikTok ------------------------------ */
  /* aweme 객체 모양:
     { id, desc, createTime, author:{uniqueId,nickname},
       stats:{playCount,diggCount,commentCount,shareCount},
       statsV2:{playCount:"...", ...},            // 문자열(더 정확)
       video:{ playAddr, downloadAddr, cover, duration } }               */
  function tiktokItem(o) {
    if (!o || typeof o !== 'object') return null;
    const stats = o.statsV2 || o.stats;
    if (!stats || typeof stats !== 'object') return null;
    const id = o.id || o.awemeId || o.aweme_id;
    if (!id || !/^\d{6,}$/.test(String(id))) return null;

    const author = o.author || {};
    const handle = author.uniqueId || author.unique_id || author.nickname || '';
    const v = o.video || {};
    const s2 = o.statsV2 || {}, s1 = o.stats || {};

    const views = pick(s2.playCount, s1.playCount, s2.play_count, s1.play_count);
    if (views === null) return null;   // 조회수가 없으면 우리 용도로는 무의미

    return {
      id: String(id),
      platform: 'tiktok',
      author: handle,
      url: handle ? 'https://www.tiktok.com/@' + handle + '/video/' + id
                  : 'https://www.tiktok.com/video/' + id,
      views: views,
      likes: pick(s2.diggCount, s1.diggCount),
      comments: pick(s2.commentCount, s1.commentCount),
      shares: pick(s2.shareCount, s1.shareCount),
      createTime: pick(o.createTime, o.create_time, o.createTimeISO && Date.parse(o.createTimeISO) / 1000),
      mediaUrl: v.downloadAddr || v.playAddr || v.download_addr || v.play_addr || '',
      caption: String(o.desc || '').slice(0, 300),
      duration: pick(v.duration)
    };
  }

  /* ---------------------------- Instagram ---------------------------- */
  /* media 객체 모양(api/v1, GraphQL node 공통):
     { pk, id, code, media_type, play_count | ig_play_count | view_count,
       like_count, comment_count, taken_at, user:{username},
       video_versions:[{url}] }                                          */
  function instagramItem(o) {
    if (!o || typeof o !== 'object') return null;
    const code = o.code || o.shortcode;
    if (!code || typeof code !== 'string' || !/^[A-Za-z0-9_-]{5,}$/.test(code)) return null;

    /* 미디어 노드인지 판별.
       검색 결과처럼 통계가 비어 오는 응답도 있으므로, 통계가 하나도 없어도
       미디어가 확실하면 받아들입니다. (카드 매핑·게시일 표시에는 쓸 수 있고,
       통계 정렬에서는 자동으로 뒤로 밀립니다) */
    const isMedia =
      o.media_type !== undefined || o.image_versions2 !== undefined ||
      o.video_versions !== undefined || o.thumbnail_url !== undefined ||
      o.is_video !== undefined || o.caption !== undefined ||
      o.like_count !== undefined || o.comment_count !== undefined ||
      o.play_count !== undefined || o.ig_play_count !== undefined ||
      o.view_count !== undefined || o.video_view_count !== undefined ||
      o.taken_at !== undefined || o.taken_at_timestamp !== undefined ||
      o.edge_media_preview_like !== undefined || o.edge_liked_by !== undefined ||
      o.edge_media_to_comment !== undefined ||
      (o.pk !== undefined && (o.user !== undefined || o.owner !== undefined));
    if (!isMedia) return null;

    const user = o.user || o.owner || {};
    const views = pick(
      o.play_count, o.ig_play_count, o.view_count,
      o.video_play_count, o.video_view_count
    );
    const likes = pick(
      o.like_count,
      o.edge_media_preview_like && o.edge_media_preview_like.count,
      o.edge_liked_by && o.edge_liked_by.count
    );
    const comments = pick(
      o.comment_count,
      o.edge_media_to_comment && o.edge_media_to_comment.count,
      o.edge_media_to_parent_comment && o.edge_media_to_parent_comment.count
    );

    let media = '';
    try {
      if (Array.isArray(o.video_versions) && o.video_versions.length) media = o.video_versions[0].url || '';
      else if (o.video_url) media = o.video_url;
    } catch (e) { /* noop */ }

    return {
      id: String(o.pk || o.id || code),
      code: code,
      platform: 'instagram',
      author: user.username || '',
      url: 'https://www.instagram.com/' + ((o.media_type === 2 || o.is_video || media) ? 'reel' : 'p') + '/' + code + '/',
      views: views,
      likes: likes,
      comments: comments,
      shares: null,
      createTime: pick(o.taken_at, o.taken_at_timestamp, o.device_timestamp && null),
      mediaUrl: media,
      caption: String((o.caption && (o.caption.text || o.caption)) || '').slice(0, 300),
      duration: pick(o.video_duration)
    };
  }

  const extractOne = PLATFORM === 'tiktok' ? tiktokItem : instagramItem;

  /**
   * "영상 같아 보이는 노드"인가? — extractOne 보다 훨씬 느슨한 기준입니다.
   * 이것이 하나도 없으면 애초에 영상과 무관한 응답이므로 경고하지 않습니다.
   * (Instagram 의 /api/graphql 은 뱃지 수·검색창·프로필 등 온갖 질의를 함께
   *  실어 나르므로, 그때마다 "구조가 바뀌었다"고 경고하면 전부 오탐입니다)
   */
  function looksLikeMedia(o) {
    try {
      if (PLATFORM === 'tiktok') {
        if (o.stats && typeof o.stats === 'object') return true;
        if (o.statsV2 && typeof o.statsV2 === 'object') return true;
        return !!(o.author && typeof o.author === 'object' && o.id && /^\d{6,}$/.test(String(o.id)));
      }
      const code = o.code || o.shortcode;
      if (typeof code === 'string' && /^[A-Za-z0-9_-]{5,}$/.test(code)) return true;
      return o.pk !== undefined && (o.user !== undefined || o.owner !== undefined);
    } catch (e) { return false; }
  }

  /**
   * 임의의 JSON 객체에서 우리가 아는 모양의 아이템을 모두 긁어냅니다.
   * 못 뽑은 경우를 진단할 수 있도록 "영상처럼 보이지만 실패한 노드"의
   * 개수와 샘플도 함께 돌려줍니다.
   */
  function extractItems(data) {
    const out = [];
    const ids = new Set();
    let candidates = 0, sample = null;
    walk(data, function (node) {
      const it = extractOne(node);
      if (it) {
        const key = it.code || it.id;
        if (!ids.has(key)) { ids.add(key); out.push(it); }
        return;
      }
      if (looksLikeMedia(node)) {
        candidates++;
        if (!sample) sample = node;
      }
    });
    return { items: out, candidates: candidates, sample: sample };
  }

  /* ======================== 2. content.js 로 전달 ======================== */
  function emit(items, source) {
    if (!items || !items.length) return;
    try {
      window.dispatchEvent(new CustomEvent(EVENT_ITEMS, {
        detail: JSON.stringify({ platform: PLATFORM, source: source, items: items })
      }));
    } catch (e) {
      warn('데이터 전달 실패:', e && e.message);
    }
  }

  function handleText(url, text, source) {
    if (!text || typeof text !== 'string') return;
    let data;
    try {
      /* 일부 응답은 XSSI 방어 프리픽스가 붙어 있습니다 */
      const cleaned = text.replace(/^\)\]\}',?\s*/, '').trim();
      if (!cleaned || (cleaned[0] !== '{' && cleaned[0] !== '[')) return;
      data = JSON.parse(cleaned);
    } catch (e) {
      return;  // JSON 이 아니면 조용히 무시 (스트리밍 응답 등)
    }
    handleData(url, data, source);
  }

  function handleData(url, data, source) {
    const key = String(url).split('?')[0];
    let res;
    try {
      res = extractItems(data);
    } catch (e) {
      warn('파싱 중 예외:', key, e && e.message);
      return;
    }

    if (res.items.length) {
      debug(key, '→', res.items.length + '건 추출');
      emit(res.items, source);
      return;
    }

    /* 영상처럼 생긴 노드가 아예 없으면, 이 응답은 원래 영상과 무관합니다.
       (검색창 추천·알림 개수·프로필 정보 등) 경고하지 않습니다. */
    if (!res.candidates) {
      debug(key, '→ 영상 데이터 없는 응답 (정상)');
      return;
    }

    /* 여기까지 왔다면 진짜로 구조가 바뀐 것입니다. 고칠 수 있게 키까지 보여줍니다. */
    if (warned.has(key)) return;
    warned.add(key);
    let keys = [];
    try { keys = Object.keys(res.sample || {}).slice(0, 40); } catch (e) { /* noop */ }
    try { window.__FS_LAST_UNPARSED__ = res.sample; } catch (e) { /* noop */ }
    warn(
      '영상처럼 보이는 항목 ' + res.candidates + '개를 찾았지만 필드를 읽지 못했습니다.\n' +
      '  엔드포인트: ' + key + '\n' +
      '  샘플 항목의 키: ' + (keys.length ? keys.join(', ') : '(없음)') + '\n' +
      '  → src/inject.js 의 ' + (PLATFORM === 'tiktok' ? 'tiktokItem()' : 'instagramItem()') +
      ' 이 읽는 필드명과 위 키를 비교해 고치세요.\n' +
      '  → 콘솔에 window.__FS_LAST_UNPARSED__ 를 입력하면 항목 원본을 볼 수 있습니다.',
      res.sample
    );
  }

  /* ========================= 3. fetch 후킹 ========================= */
  try {
    const origFetch = window.fetch;
    if (typeof origFetch === 'function') {
      window.fetch = function (input, init) {
        const p = origFetch.apply(this, arguments);
        try {
          let url = '';
          if (typeof input === 'string') url = input;
          else if (input && typeof input === 'object' && input.url) url = input.url;
          if (isInteresting(url) && p && typeof p.then === 'function') {
            p.then(function (res) {
              try {
                if (!res || typeof res.clone !== 'function') return;
                const tag = url + '#' + (res.headers && res.headers.get ? (res.headers.get('content-length') || '') : '');
                if (seen.has(tag)) return;
                seen.add(tag);
                if (seen.size > 500) seen.clear();
                res.clone().text().then(function (t) { handleText(url, t, 'fetch'); },
                                        function () { /* body 읽기 실패 무시 */ });
              } catch (e) { /* noop */ }
            }, function () { /* 원래 요청 실패는 우리 소관 아님 */ });
          }
        } catch (e) { /* 후킹 실패해도 원본 반환 */ }
        return p;
      };
    }
  } catch (e) {
    warn('fetch 후킹 실패(페이지는 정상 동작):', e && e.message);
  }

  /* ========================= 4. XHR 후킹 ========================= */
  try {
    const XP = XMLHttpRequest.prototype;
    const origOpen = XP.open, origSend = XP.send;
    XP.open = function (method, url) {
      try { this.__fsUrl = url; } catch (e) { /* noop */ }
      return origOpen.apply(this, arguments);
    };
    XP.send = function () {
      try {
        const xhr = this;
        if (isInteresting(xhr.__fsUrl)) {
          xhr.addEventListener('load', function () {
            try {
              const rt = xhr.responseType;
              if (rt === 'json') handleData(xhr.__fsUrl, xhr.response, 'xhr');
              else if (rt === '' || rt === 'text') handleText(xhr.__fsUrl, xhr.responseText, 'xhr');
            } catch (e) { /* noop */ }
          });
        }
      } catch (e) { /* noop */ }
      return origSend.apply(this, arguments);
    };
  } catch (e) {
    warn('XHR 후킹 실패(페이지는 정상 동작):', e && e.message);
  }

  /* ================== 5. 최초 로드 시 박혀 있는 JSON ================== */
  function readInitialState() {
    try {
      const ids = INITIAL_STATE_IDS;
      for (let i = 0; i < ids.length; i++) {
        const el = document.getElementById(ids[i]);
        if (el && el.textContent) handleText('initial:' + ids[i], el.textContent, 'initial');
      }
      /* TikTok 구버전: window.SIGI_STATE 전역 */
      if (window.SIGI_STATE && typeof window.SIGI_STATE === 'object') {
        handleData('initial:window.SIGI_STATE', window.SIGI_STATE, 'initial');
      }
    } catch (e) {
      warn('초기 상태 JSON 파싱 실패:', e && e.message);
    }
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', readInitialState, { once: true });
    /* 스크립트 태그가 늦게 붙는 경우 대비해 한 번 더 */
    setTimeout(readInitialState, 1500);
  } else {
    readInitialState();
    setTimeout(readInitialState, 1500);
  }

  /* ============ 6. SPA 페이지 이동 알림 (pushState 는 MAIN 에서만 후킹 가능) ============ */
  try {
    ['pushState', 'replaceState'].forEach(function (m) {
      const orig = history[m];
      if (typeof orig !== 'function') return;
      history[m] = function () {
        const r = orig.apply(this, arguments);
        try { window.dispatchEvent(new CustomEvent(EVENT_NAV, { detail: location.href })); } catch (e) { /* noop */ }
        return r;
      };
    });
  } catch (e) { /* noop */ }
})();
