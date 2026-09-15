/* ============================================================================
 * Feed Sorter (개인용) — background.js  [MV3 service worker]
 * ----------------------------------------------------------------------------
 * 하는 일은 하나뿐입니다: content script 가 요청한 영상 파일 저장을
 * chrome.downloads 로 처리합니다. (콘텐츠 스크립트는 downloads 권한을 못 씀)
 *
 * 주의: 여기서 새 요청을 "만들어" 수집하지 않습니다. 저장 대상 URL 은
 *       사용자가 이미 보고 있는 영상의 미디어 주소이며, 버튼을 눌렀을 때만
 *       동작합니다.
 * ========================================================================== */
'use strict';

chrome.runtime.onMessage.addListener(function (msg, sender, reply) {
  if (!msg || msg.type !== 'FS_DOWNLOAD') return;

  const url = String(msg.url || '');
  if (!/^https?:\/\//i.test(url)) {
    reply({ ok: false, error: '저장할 수 있는 영상 주소가 없습니다' });
    return true;
  }

  let filename = String(msg.filename || 'video.mp4').replace(/[\\/:*?"<>|]+/g, '_');
  if (!/\.\w{2,4}$/.test(filename)) filename += '.mp4';

  try {
    chrome.downloads.download(
      { url: url, filename: 'FeedSorter/' + filename, saveAs: false },
      function (downloadId) {
        if (chrome.runtime.lastError || downloadId === undefined) {
          const em = (chrome.runtime.lastError && chrome.runtime.lastError.message) || '브라우저가 요청을 거부했습니다';
          console.warn('[Feed Sorter] 다운로드 실패:', em, url);
          reply({ ok: false, error: em });
          return;
        }
        watch(downloadId, url);
        reply({ ok: true, id: downloadId });
      }
    );
  } catch (e) {
    reply({ ok: false, error: (e && e.message) || '알 수 없는 오류' });
  }
  return true;   // 비동기 응답
});

/**
 * CDN 이 Referer 를 요구하면 확장에서 시작한 다운로드가 403 으로 끊길 수 있습니다.
 * 그때는 콘솔에 원인과 대안을 남깁니다. (자동 재시도는 하지 않습니다)
 */
function watch(id, url) {
  function onChanged(delta) {
    if (!delta || delta.id !== id) return;
    if (delta.state && delta.state.current === 'interrupted') {
      console.warn(
        '[Feed Sorter] 다운로드가 중단되었습니다 (' + (delta.error && delta.error.current) + ').\n' +
        '  플랫폼 CDN 이 Referer/쿠키를 요구하는 주소일 수 있습니다.\n' +
        '  대안: 아래 주소를 새 탭에 붙여넣고 오른쪽 클릭 → "다른 이름으로 비디오 저장"\n  ' + url
      );
      chrome.downloads.onChanged.removeListener(onChanged);
    } else if (delta.state && delta.state.current === 'complete') {
      chrome.downloads.onChanged.removeListener(onChanged);
    }
  }
  try { chrome.downloads.onChanged.addListener(onChanged); } catch (e) { /* noop */ }
}
