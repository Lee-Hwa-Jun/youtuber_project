# ⬇️ 영상 다운로더 (yt-dlp 리모컨)

유튜브 · 인스타그램 · 틱톡 링크를 붙이면 **플랫폼을 자동으로 인식**하고, **원본 화질로 저장하는 스크립트**를 만들어 주는 단일 HTML 파일입니다.
설치·서버·빌드 없이 `downloader.html` 더블클릭으로 열립니다.

> **꼭 알아두세요.** HTML 파일 하나가 스스로 영상을 내려받을 수는 없습니다. 브라우저는 보안(CORS) 때문에 유튜브·인스타·틱톡 서버에 직접 요청할 수 없고, 유튜브 고화질은 영상과 소리가 따로 저장되어 합치는 프로그램이 필요합니다.
> 그래서 실제 다운로드는 오픈소스 표준 도구 **yt-dlp** 가 하고, 이 페이지는 링크를 인식해 옵션을 골라 **더블클릭 한 번으로 실행되는 스크립트(.bat / .sh)** 를 만들어 주는 "리모컨" 역할을 합니다. 처음 한 번만 yt-dlp 를 설치하면 됩니다.

---

## 무엇을 할 수 있나요

| 기능 | 설명 |
|---|---|
| 플랫폼 자동 인식 | 유튜브(watch / youtu.be / Shorts / live / embed), 인스타그램(Reel / 게시물), 틱톡(영상 / vm·vt 단축링크 / 사진) 링크를 알아보고 배지로 표시 |
| 링크 정리 | 추적 파라미터 제거, 표준 주소로 통일, 중복 제거. 재생목록·채널·프로필 링크는 이유를 알려주며 거부 |
| 원본 화질 | 최고 화질(원본) / 4K 까지 / 1080p 까지 / 720p 까지 / 오디오만(mp3) |
| 로그인 쿠키 | 내 브라우저(Chrome·Edge·Firefox·Brave·Safari)의 로그인 상태를 yt-dlp 가 그대로 사용 (인스타그램에 필수) |
| 추가 옵션 | 자막(한/영) 넣기, 썸네일 넣기, 제목·설명 메타데이터 넣기, 저장 폴더, 파일명 규칙 |
| 실행 | Windows 는 `.bat` 더블클릭, Mac 은 `.sh` 실행. 또는 명령 복사 → 터미널 붙여넣기 |
| 최근 목록 | 받은 링크를 최대 200개 기록, CSV 내보내기, 다시 링크 칸에 넣기 |
| 설치 안내 | OS 를 고르면 yt-dlp · ffmpeg 설치 명령을 복사 버튼과 함께 표시 |

이 파일은 서버에 아무것도 보내지 않습니다. 링크 목록과 옵션은 내 브라우저(localStorage)에만 저장됩니다.

---

## 처음 한 번 · yt-dlp 설치 (5분)

페이지 1번 칸에 같은 내용이 복사 버튼과 함께 나옵니다.

**Windows**

1. `Win + X` → **터미널** (또는 시작 메뉴에서 PowerShell)
2. 아래 명령을 하나씩 붙여넣고 Enter

```
winget install yt-dlp.yt-dlp
winget install Gyan.FFmpeg
yt-dlp --version
```

**Mac**

1. `⌘ + Space` → **터미널**
2. Homebrew 가 없으면 먼저 설치한 뒤

```
brew install yt-dlp ffmpeg
yt-dlp --version
```

마지막 명령에서 버전 번호가 나오면 성공입니다. **터미널을 닫고 새로 열어야** 방금 설치한 명령이 인식됩니다.
ffmpeg 는 유튜브 고화질의 분리된 영상·오디오를 하나의 mp4 로 합치는 데 필요합니다. 없으면 파일이 두 개로 따로 남습니다.

---

## 사용법 (4단계)

**1. OS 고르기** — 우측 상단에서 Windows / Mac. 설치 안내와 스크립트 종류가 바뀝니다.

**2. 링크 붙이기** — 여러 개면 줄바꿈으로 나눠 붙입니다. 붙이는 즉시 아래에 플랫폼 배지·정리된 주소·영상 ID 가 나오고, 문제가 있는 링크는 빨간 배지로 이유를 보여줍니다.

| 링크 형태 | 인식 결과 |
|---|---|
| `youtube.com/watch?v=…`, `youtu.be/…`, `m.youtube.com/…` | ▶️ YouTube |
| `youtube.com/shorts/…` | ▶️ YouTube Shorts |
| `instagram.com/reel/…`, `instagram.com/p/…` | 📸 Instagram Reel / 게시물 |
| `tiktok.com/@계정/video/…` | 🎵 TikTok |
| `vm.tiktok.com/…`, `vt.tiktok.com/…`, `tiktok.com/t/…` | 🎵 TikTok 단축링크 |
| `tiktok.com/@계정/photo/…` | 🎵 TikTok 사진 (영상이 아니라는 경고) |
| 재생목록 · 채널 · 프로필 링크 | ✕ 거부 + 이유 표시 |

**3. 옵션** — 화질, 로그인 쿠키 브라우저, 저장 폴더, 파일명 규칙, 추가 옵션.

- 인스타그램 링크가 있는데 쿠키 브라우저가 "사용 안 함"이면 경고가 뜹니다. 인스타에 로그인해 둔 브라우저를 고르세요.
- 저장 폴더를 비우면 스크립트가 있는 폴더에 저장됩니다.
- 파일명 규칙 기본값은 `제목 [영상ID].확장자` 입니다. `%(uploader)s` 채널, `%(upload_date)s` 게시일도 쓸 수 있습니다.

**4. 실행**

- **Windows**: `⬇ 다운로드 스크립트 받기 (.bat)` → 받은 파일을 **더블클릭**. "Windows 의 PC 보호" 창이 뜨면 **추가 정보 → 실행**. 검은 창이 뜨고 진행률이 표시되다가 "Done." 이 나오면 끝입니다.
- **Mac**: `.sh` 를 받은 뒤 터미널에 `sh ` (sh 와 공백) 를 입력하고 파일을 터미널 창에 **드래그** → Enter. 또는 `📋 명령 복사` → 터미널에 붙여넣기.

스크립트는 기본으로 실행 전에 `yt-dlp -U` 로 자동 업데이트합니다. 사이트가 바뀌어 다운로드가 깨지는 일을 줄여 줍니다.

---

## 만들어지는 명령 예시

```
yt-dlp -f "bv*+ba/b" -S res,ext:mp4:m4a --merge-output-format mp4 --no-playlist --embed-metadata -o "%(title).100s [%(id)s].%(ext)s" --windows-filenames "https://www.youtube.com/watch?v=…" https://www.tiktok.com/@…/video/…
```

| 옵션 | 뜻 |
|---|---|
| `-f "bv*+ba/b"` | 최고 화질 영상 + 최고 음질 오디오, 없으면 합쳐진 단일 파일 |
| `-S res,ext:mp4:m4a` | 해상도 우선, 같은 해상도면 mp4/m4a 선호 |
| `--merge-output-format mp4` | 합친 결과를 mp4 로 |
| `--no-playlist` | 재생목록 링크가 섞여도 영상 하나만 (수백 개를 실수로 받는 일 방지) |
| `--cookies-from-browser chrome` | Chrome 의 로그인 쿠키 사용 |
| `-o "…"` | 파일명 규칙 |
| `--windows-filenames` | Windows 에서 쓸 수 없는 문자 자동 치환 (Windows 만) |

---

## 문제가 생기면

| 증상 | 원인 · 해결 |
|---|---|
| `yt-dlp 은(는) 내부 또는 외부 명령… 이 아닙니다` / `command not found` | 설치가 안 됐거나 터미널을 다시 열지 않음. 설치 후 터미널(또는 .bat)을 새로 열기 |
| `ffmpeg not found` / 영상과 소리가 따로 저장됨 | ffmpeg 미설치. 설치 명령 실행 |
| `Sign in to confirm you're not a bot` / `login required` / 403 | 옵션에서 로그인 쿠키 브라우저 선택. 그 브라우저에 해당 사이트가 로그인되어 있어야 함 |
| `Unsupported URL` / `Unable to extract` | 사이트가 바뀜. `yt-dlp -U` 로 업데이트 |
| Windows 파일명이 이상함 / 저장 안 됨 | 경로가 너무 길면 저장 폴더를 `C:\clips` 같은 짧은 경로로 |
| 틱톡 워터마크 | yt-dlp 는 기본으로 워터마크 없는 원본을 고름. `yt-dlp -U` 후 재시도 |
| 재생목록 전체를 받고 싶음 | 이 도구는 `--no-playlist` 를 넣음. 터미널에서 직접 `yt-dlp "재생목록URL"` |

---

## 저작권 안내

남의 영상은 **리서치·검토용**으로만 받으세요. 실제 영상에 쓰려면 원작자의 허락이 필요합니다.
허락 요청과 상태 관리는 [소스 수집 매니저](../ranking-shorts-source-manager/)의 라이선스 상태(DM 보냄 → 허락받음)로 하세요.

---

## 파일 구성

```
video-downloader/
├── downloader.html   # 프로그램 전체 (HTML + CSS + JS, 외부 라이브러리 없음)
└── README.md
```

브라우저 저장소 키: `vdl_v1` (OS, 옵션, 링크 칸 내용, 최근 목록 최대 200개).
