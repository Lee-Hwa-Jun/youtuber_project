# youtuber_project

유튜브 영상 제작에 쓰는 도구들을 모아두는 저장소입니다.
각 도구는 **자기 폴더 안에서 독립적으로** 개발하고, 폴더마다 사용법 `README.md` 를 둡니다.

## 📦 도구 목록

| 폴더 | 도구 | 설명 | 실행 방법 |
|---|---|---|---|
| [`ranking-shorts-source-manager/`](./ranking-shorts-source-manager/) | 🎬 랭킹 쇼츠 · 영상 소스 수집 매니저 | 랭킹 쇼츠용 클립을 여러 플랫폼에서 찾고, 후보를 기록하고, 1~5위를 배치하는 도구 | `index.html` 더블클릭 (설치·서버 불필요) |
| [`feed-sorter/`](./feed-sorter/) | 🔢 Feed Sorter (개인용) | TikTok·Instagram 피드를 조회수·좋아요·댓글·날짜순으로 재정렬하고 썸네일에 스탯을 표시하는 크롬 확장 | `chrome://extensions` → 개발자 모드 → 압축해제된 확장 프로그램 로드 |
| [`competitor-tracker/`](./competitor-tracker/) | 📈 경쟁 채널 트래커 | 경쟁 쇼츠 채널의 조회수 스냅샷을 쌓아 급상승 영상·제목 패턴·업로드 시간대를 분석. **내 채널** 탭에서 스튜디오 CSV 를 병합해 AI 분석용 CSV 내보내기 | `tracker.html` 더블클릭 (YouTube API 키 필요) |
| [`sleep-source-generator/`](./sleep-source-generator/) | 🌌 소스 생성기 | 수면 주파수 영상용 무한 루프 영상(webm)과 주파수 음원(wav)을 따로 생성 | `source-gen.html` 더블클릭 (Chrome/Edge) |
| [`video-downloader/`](./video-downloader/) | ⬇️ 영상 다운로더 | 유튜브·인스타그램·틱톡 링크를 자동 인식해 원본 화질 다운로드 스크립트(.bat/.sh)를 만드는 yt-dlp 리모컨 | `downloader.html` 더블클릭 (yt-dlp 설치 한 번 필요) |

## 📖 사용 가이드

- **[GUIDE.md](./GUIDE.md)** — 세 도구를 한 문서로 정리한 **초보자용 통합 가이드**. 추천 작업 흐름(트래커 → Feed Sorter → 소스 매니저)과 각 도구의 화면별 설명·FAQ가 들어 있습니다. 순수 마크다운이라 **노션에 그대로 붙여넣을 수 있습니다.**
- 각 폴더의 `README.md` — 해당 도구의 상세 설명과 **유지보수 지침**(사이트 구조가 바뀌었을 때 고칠 상수 위치).
