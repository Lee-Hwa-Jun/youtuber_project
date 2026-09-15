/* ============================================================================
 * Feed Sorter (개인용) — popup.js
 * 설정 UI. 설정은 chrome.storage.local 에 저장되고, content.js 가
 * storage.onChanged 로 즉시 반영합니다.
 * ========================================================================== */
'use strict';

const DEFAULTS = {
  minViews: 0,
  showBadge: true,
  showTier: true,
  showDate: false,
  showDownload: true,
  byDomain: {}
};

const $ = (s) => document.querySelector(s);
let TAB_ID = null;
let HOST = null;
let settings = Object.assign({}, DEFAULTS);
let pollTimer = null;

/* ------------------------------ 초기화 ------------------------------ */
document.addEventListener('DOMContentLoaded', init);

function init() {
  chrome.storage.local.get(null, function (data) {
    settings = Object.assign({}, DEFAULTS, data || {});
    bind();
    connect();
  });
}

function connect() {
  chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
    const tab = tabs && tabs[0];
    if (!tab || tab.id === undefined) { unsupported(); return; }
    TAB_ID = tab.id;
    askState(function (st) {
      if (!st) { unsupported(); return; }
      HOST = st.host;
      $('#site').textContent = st.platform === 'tiktok' ? 'TikTok' : 'Instagram';
      $('#unsupported').hidden = true;
      $('#panel').hidden = false;
      render(st);
      pollTimer = setInterval(function () { askState(function (s) { if (s) render(s); }); }, 1000);
    });
  });
}

function unsupported() {
  $('#site').textContent = '미지원 페이지';
  $('#unsupported').hidden = false;
  $('#panel').hidden = true;
}

function askState(cb) {
  if (TAB_ID === null) { cb(null); return; }
  try {
    chrome.tabs.sendMessage(TAB_ID, { type: 'FS_STATE' }, function (res) {
      if (chrome.runtime.lastError || !res || !res.ok) { cb(null); return; }
      cb(res);
    });
  } catch (e) { cb(null); }
}

/* ------------------------------ 렌더 ------------------------------ */
function render(st) {
  $('#cCollected').textContent = st.collected;
  $('#cScreen').textContent = st.onScreen;
  const sort = (settings.byDomain && settings.byDomain[HOST]) || 'original';
  document.querySelectorAll('.sort').forEach(function (b) {
    b.classList.toggle('on', b.dataset.sort === sort);
  });
  $('#sortHint').textContent =
    sort === 'original'
      ? '원래(사이트 기본) 순서로 보고 있습니다.'
      : '이 사이트(' + HOST + ')의 기본 정렬로 저장됩니다.';
}

function syncInputs() {
  $('#minViews').value = settings.minViews ? String(settings.minViews) : '';
  $('#showBadge').checked = !!settings.showBadge;
  $('#showTier').checked = !!settings.showTier;
  $('#showDate').checked = !!settings.showDate;
  $('#showDownload').checked = !!settings.showDownload;
}

/* ------------------------------ 이벤트 ------------------------------ */
function bind() {
  syncInputs();

  document.querySelectorAll('.sort').forEach(function (btn) {
    btn.addEventListener('click', function () {
      if (!HOST) return;
      const by = Object.assign({}, settings.byDomain);
      by[HOST] = btn.dataset.sort;
      save({ byDomain: by });
      document.querySelectorAll('.sort').forEach(function (b) { b.classList.toggle('on', b === btn); });
    });
  });

  $('#minApply').addEventListener('click', applyMin);
  $('#minViews').addEventListener('keydown', function (e) { if (e.key === 'Enter') applyMin(); });

  [['showBadge', 'showBadge'], ['showTier', 'showTier'],
   ['showDate', 'showDate'], ['showDownload', 'showDownload']].forEach(function (p) {
    $('#' + p[0]).addEventListener('change', function (e) {
      const patch = {}; patch[p[1]] = e.target.checked; save(patch);
    });
  });

  $('#rescan').addEventListener('click', function () {
    if (TAB_ID === null) return;
    chrome.tabs.sendMessage(TAB_ID, { type: 'FS_RESCAN' }, function () { void chrome.runtime.lastError; });
  });

  $('#csv').addEventListener('click', exportCsv);
}

function applyMin() {
  const v = Math.max(0, Number($('#minViews').value) || 0);
  save({ minViews: v });
}

function save(patch) {
  settings = Object.assign({}, settings, patch);
  chrome.storage.local.set(patch, function () { void chrome.runtime.lastError; });
}

/* ------------------------------ CSV ------------------------------ */
function exportCsv() {
  if (TAB_ID === null) return;
  const btn = $('#csv');
  btn.disabled = true; btn.textContent = '수집 중…';
  chrome.tabs.sendMessage(TAB_ID, { type: 'FS_ITEMS' }, function (res) {
    btn.disabled = false; btn.textContent = '⬇ 현재 수집 데이터 CSV 내보내기';
    if (chrome.runtime.lastError || !res || !res.ok) { alert('페이지에서 데이터를 가져오지 못했습니다.'); return; }
    const items = res.items || [];
    if (!items.length) { alert('아직 수집된 데이터가 없습니다.\n피드를 조금 둘러본 뒤 다시 시도하세요.'); return; }

    const head = ['영상URL', '플랫폼', '작성자', '조회수', '좋아요', '댓글수', '게시일'];
    const q = (s) => '"' + String(s === null || s === undefined ? '' : s).replace(/"/g, '""') + '"';
    const lines = [head.map(q).join(',')];
    items.forEach(function (it) {
      lines.push([it.url, it.platform, it.author, it.views, it.likes, it.comments, it.date].map(q).join(','));
    });

    const bom = String.fromCharCode(0xFEFF);
    const blob = new Blob([bom + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'feed-sorter-' + (HOST || 'export').replace(/\W+/g, '-') + '-' + stamp() + '.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 1000);
  });
}

function stamp() {
  const d = new Date();
  return d.getFullYear() +
    String(d.getMonth() + 1).padStart(2, '0') +
    String(d.getDate()).padStart(2, '0') + '-' +
    String(d.getHours()).padStart(2, '0') +
    String(d.getMinutes()).padStart(2, '0');
}

window.addEventListener('unload', function () { if (pollTimer) clearInterval(pollTimer); });
