/* ============================================================================
 * Feed Sorter (개인용) — constants.js
 * ----------------------------------------------------------------------------
 * ★ 사이트 구조가 바뀌면 "이 파일만" 고치면 되도록 모든 API 경로와 셀렉터를
 *   여기에 모아두었습니다. 자세한 수정 지침은 README.md의
 *   "사이트 구조가 바뀌었을 때" 절을 보세요.
 *
 * 이 파일은 MAIN(페이지) 컨텍스트와 ISOLATED(콘텐츠 스크립트) 컨텍스트에
 * 각각 로드됩니다. 두 세계는 window를 공유하지 않으므로 같은 파일이 각자의
 * window에 독립적인 사본을 만듭니다. (단일 소스, 중복 정의 없음)
 * ========================================================================== */
(function () {
  'use strict';
  if (window.__FS_CONST__) return;

  const C = {
    NAME: 'Feed Sorter',
    VERSION: '1.1.0',

    /* MAIN → ISOLATED 로 수집 데이터를 넘길 때 쓰는 CustomEvent 이름 */
    EVENT_ITEMS: '__FEED_SORTER_ITEMS__',
    EVENT_NAV: '__FEED_SORTER_NAV__',

    /* 조회수 구간별 테두리 색 기준 */
    TIERS: { GOLD: 1000000, GREEN: 100000 },

    /* 재정렬/재스캔 디바운스(ms) */
    DEBOUNCE_MS: 180,
    /* SPA URL 변경 폴링 주기(ms) */
    URL_POLL_MS: 600,
    /* 스크롤이 멈춘 뒤 이만큼 지나야 재정렬합니다. 스크롤 도중 DOM 을 옮기면
       보고 있던 위치가 튕기므로, 손을 뗀 다음에만 정리합니다. */
    SCROLL_IDLE_MS: 250,
    /* 카드에 바로 보여줄 해시태그 칩 수 (나머지는 +N 으로 접어둠) */
    MAX_TAG_CHIPS: 3,
    /* 업로드 시각 툴팁이 커서에서 떨어진 거리(px) */
    TIP_OFFSET: { x: 14, y: 18 },
    /* JSON 재귀 탐색 상한 (무한 루프·성능 사고 방지) */
    WALK_MAX_DEPTH: 20,   /* Instagram GraphQL 은 꽤 깊게 중첩됩니다 */
    WALK_MAX_NODES: 40000,

    TIKTOK: {
      HOST_RE: '(^|\\.)tiktok\\.com$',
      /* 응답을 들여다볼 요청 URL 조각. 하나라도 포함되면 파싱을 시도합니다. */
      API_PATTERNS: [
        '/api/search/',           // 검색(general/full, item, video ...)
        '/api/post/item_list',    // 프로필 게시물
        '/api/recommend/item_list',
        '/api/challenge/item_list',
        '/api/music/item_list',
        '/api/related/item_list',
        '/api/explore/item_list'
      ],
      /* 최초 로드 시 페이지에 박혀 오는 JSON 스크립트 태그 id */
      INITIAL_STATE_IDS: ['SIGI_STATE', '__UNIVERSAL_DATA_FOR_REHYDRATION__'],
      /* 카드 ↔ 영상 id 매핑에 쓰는 링크 패턴 (a[href] 에서 추출) */
      ITEM_LINK_RE: '/@([\\w.\\-]+)/video/(\\d+)',
      /* 해시태그 칩 클릭 시 열 검색 페이지 */
      TAG_URL: 'https://www.tiktok.com/tag/',
      /* 그리드 컨테이너 후보 (빠른 경로). 실패하면 자동 탐지로 넘어갑니다. */
      GRID_SELECTORS: [
        '[data-e2e="search_top-item-list"]',
        '[data-e2e="user-post-item-list"]',
        '[data-e2e="challenge-item-list"]',
        '[data-e2e="music-item-list"]',
        '[data-e2e="explore-item-list"]'
      ]
    },

    INSTAGRAM: {
      HOST_RE: '(^|\\.)instagram\\.com$',
      API_PATTERNS: [
        '/api/v1/feed/',
        '/api/v1/clips/',
        '/api/v1/users/',
        '/api/v1/tags/',
        '/api/graphql',
        '/graphql/query'
      ],
      INITIAL_STATE_IDS: [],
      ITEM_LINK_RE: '/(?:reel|reels|p|tv)/([A-Za-z0-9_\\-]{5,})',
      TAG_URL: 'https://www.instagram.com/explore/tags/',
      GRID_SELECTORS: [
        'main article',
        'main [style*="flex-direction: column"]'
      ]
    }
  };

  C.TIKTOK.HOST_REGEX = new RegExp(C.TIKTOK.HOST_RE);
  C.INSTAGRAM.HOST_REGEX = new RegExp(C.INSTAGRAM.HOST_RE);

  /* 현재 문서가 어느 플랫폼인지 */
  C.platform = function () {
    try {
      const h = location.hostname;
      if (C.TIKTOK.HOST_REGEX.test(h)) return 'tiktok';
      if (C.INSTAGRAM.HOST_REGEX.test(h)) return 'instagram';
    } catch (e) { /* noop */ }
    return null;
  };

  C.site = function () {
    const p = C.platform();
    return p === 'tiktok' ? C.TIKTOK : p === 'instagram' ? C.INSTAGRAM : null;
  };

  /* --------------------------- 공용 포맷 헬퍼 --------------------------- */
  C.fmtNum = function (n) {
    n = Number(n);
    if (!isFinite(n) || n < 0) return '-';
    if (n >= 1e9) return trim1(n / 1e9) + 'B';
    if (n >= 1e6) return trim1(n / 1e6) + 'M';
    if (n >= 1e3) return trim1(n / 1e3) + 'K';
    return String(Math.round(n));
  };
  function trim1(v) {
    const s = v.toFixed(1);
    return s.endsWith('.0') ? s.slice(0, -2) : s;
  }

  /* 유닉스 초 → "3mo ago" */
  C.fmtAge = function (sec) {
    sec = Number(sec);
    if (!isFinite(sec) || sec <= 0) return '';
    const d = Math.floor(Date.now() / 1000) - (sec > 1e11 ? Math.floor(sec / 1000) : sec);
    if (d < 0) return 'now';
    if (d < 60) return d + 's ago';
    if (d < 3600) return Math.floor(d / 60) + 'm ago';
    if (d < 86400) return Math.floor(d / 3600) + 'h ago';
    if (d < 2592000) return Math.floor(d / 86400) + 'd ago';
    if (d < 31536000) return Math.floor(d / 2592000) + 'mo ago';
    return Math.floor(d / 31536000) + 'y ago';
  };

  /* 사용자(브라우저/OS)의 시간대 이름. 예: "Asia/Seoul". 못 읽으면 '' */
  C.userTimeZone = function () {
    try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { return ''; }
  };

  /* 유닉스 초(또는 ms) → 사용자 시간대의 정확한 업로드 시각.
     { date:'2026-09-15', weekday:'월', time:'14:32:05', tz:'Asia/Seoul', offset:'GMT+9', age:'3mo ago' }
     플랫폼은 UTC 타임스탬프를 주므로, 여기서 브라우저 시간대로 바꿔 보여줍니다.
     한국에서 보면 서울 시각, 미국에서 보면 그 지역 시각이 됩니다. */
  C.fmtExact = function (sec) {
    sec = Number(sec);
    if (!isFinite(sec) || sec <= 0) return null;
    const ms = sec > 1e11 ? sec : sec * 1000;
    const dt = new Date(ms);
    if (isNaN(dt.getTime())) return null;
    const tz = C.userTimeZone();
    let parts;
    try {
      parts = new Intl.DateTimeFormat('ko-KR', {
        timeZone: tz || undefined,
        year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
        timeZoneName: 'short'
      }).formatToParts(dt);
    } catch (e) { return null; }
    const g = {};
    parts.forEach(function (p) { if (p.type !== 'literal') g[p.type] = p.value; });
    /* ko-KR 은 분·초를 "6분" 처럼 한 자리로 주므로 직접 두 자리로 맞춥니다 */
    const z = function (v) { return String(v == null ? '' : v).padStart(2, '0'); };
    return {
      date: g.year + '-' + z(g.month) + '-' + z(g.day),
      weekday: g.weekday || '',
      time: z(g.hour) + ':' + z(g.minute) + ':' + z(g.second),
      tz: tz,
      offset: g.timeZoneName || '',
      age: C.fmtAge(sec)
    };
  };

  /* 유닉스 초 → "2026-09-15" (CSV용) */
  C.fmtDate = function (sec) {
    sec = Number(sec);
    if (!isFinite(sec) || sec <= 0) return '';
    const ms = sec > 1e11 ? sec : sec * 1000;
    const dt = new Date(ms);
    if (isNaN(dt.getTime())) return '';
    return dt.getFullYear() + '-' +
      String(dt.getMonth() + 1).padStart(2, '0') + '-' +
      String(dt.getDate()).padStart(2, '0');
  };

  C.warn = function () {
    try {
      const a = Array.prototype.slice.call(arguments);
      console.warn.apply(console, ['[Feed Sorter]'].concat(a));
    } catch (e) { /* noop */ }
  };

  window.__FS_CONST__ = C;
})();
