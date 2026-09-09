# 프리지아 사이트 — 인수인계

이 문서 하나와 같은 폴더의 파일들만 있으면 **지금 보고 있는 화면이 그대로 다시 뜬다.**
새 채팅에서는 이 문서를 통째로 붙여 넣고, 프로젝트 폴더(또는 백업 zip)를 함께 주면 된다.

---

## 1. 지금 바로 띄우는 법

```bash
npm install
npm run dev
```

`npm run dev` 는 Vite 개발 서버(5173)와 결제 API 서버(`server/index.js`, 8787)를 함께 띄운다.
결제를 쓰지 않으면 `npm run dev:web` 만으로도 홈은 전부 동작한다.

빌드는 `npx vite build`, 린트는 `npx oxlint src`.

배포는 프로세스 하나다 — `npm run build` 로 화면을 구운 뒤 `npm start` 를 띄우면 서버가 `dist/` 와 API 를 같은 주소로 내보낸다(개발에서만 Vite 가 따로 돈다). 인터넷에 올리는 방법은 **`docs/DEPLOY.md`**.

- Node 22 이상. 이 컴퓨터는 24.19.0 에서 확인했다.
- `.env` 에 `VITE_TOSS_CLIENT_KEY`, `TOSS_SECRET_KEY` 가 필요하지만 **홈 화면과 3D·게임은 키 없이 전부 동작한다.** 체험 예약도 키 없이 동작하고, 안내 문자만 나가지 않는다(`docs/RESERVATION.md`). 키가 없으면 `#/terry` 결제 버튼만 안내 문구를 띄운다.

## 2. 화면 구성 (홈 `#/`)

히어로 → 체험 바로가기 → 아큐 직접 돌려보기 → 테리 직접 돌려보기 → 테리와 함께 달리기 → 푸터.

| 섹션 | id | 파일 |
|---|---|---|
| 히어로 (영상 스크롤 스크럽) | `top` | `src/components/ScrollScrubHero.jsx` |
| 체험 바로가기 (카드 5칸 + 인스타그램) | `activities` | `src/sections/Activities.jsx` |
| 아큐 돌려보기 | `aqu` | `src/sections/ModelSection.jsx` |
| 테리 돌려보기 | `terry` | 〃 |
| 테리와 함께 달리기 | `game` | `src/sections/TerryRun.jsx` |
| 체험 예약 (활동 페이지 안) | — | `src/components/Reservation.jsx`, `server/booth.js` |
| 운영 화면 (로고 5번 + 3618) | `#/booth` | `src/pages/BoothAdmin.jsx`, `src/sections/Footer.jsx` |
| 푸터 | — | `src/sections/Footer.jsx` |

해시 라우트: `#/sense/register` `#/sense/seek` `#/sense/sensitive` `#/sense/avoid` (활동 페이지),
`#/terry` `#/aqu` (결제·준비중), `#/pay/success` `#/pay/fail`.
`#activities` 처럼 슬래시가 없는 해시는 홈 안의 앵커다.

## 3. 자산 — 이게 없으면 화면이 달라진다

| 경로 | 내용 | 만든 방법 |
|---|---|---|
| `public/frames/f_001~131.jpg` | 히어로 프레임 **넓은 화면용** 1440×810, 6.3MB | `아큐 테리 수정본.mp4` 에서 `ffmpeg -vf scale=1440:810:flags=lanczos -q:v 4` |
| `public/frames/m/f_001~131.jpg` | 히어로 프레임 **좁은 화면용** 720×405, 2.7MB | 같은 mp4 에서 `scale=720:405` |
| `public/models/terry.glb` `aqu.glb` | 돌려보기 기본 모델 (부위 zone id 포함) | Tripo 스캔 + Draco |
| `public/char/terry-sit.png` `terry-run.png` `terry-jump.png` `aqu-stand.png` | 스프라이트·삽화 (투명) | 카카오톡 원본에서 흰 배경 키잉 |
| `public/brand/logo-mark.png` `logo.png` `emblem.jpg` | 브랜드 마크·엠블럼 | 〃 |
| `public/art/terry-freesia.jpg` `terry-punk.jpg` | 캐릭터 변형 | 〃 |
| `public/fonts/Pretendard-Regular.woff2` `-Bold.woff2` | 서체 | — |
| `public/draco/` | Draco 디코더 | three 배포본 |
| `public/favicon.png` `apple-touch-icon.png` | 파비콘 | 엠블럼 축소 |

`terry-jump.png` 는 원본 사진 왼쪽 아래에 다른 캐릭터의 귀가 딸려 들어와 있어 흰색으로 덮고 다시 키잉했다(603×684, 여백 0). 다시 만들려면:

```bash
ffmpeg -i KakaoTalk_20260823_220057010_02.jpg -vf "drawbox=x=0:y=616:w=196:h=93:color=white:t=fill,format=rgba,colorkey=0xFFFFFF:0.18:0.06,crop=603:684:20:8" public/char/terry-jump.png
```

## 4. 새 GLB 를 넣을 때

카카오톡으로 오는 원본은 **Tripo 스캔이라 50~70MB** 다. 그대로 쓰면 안 된다.

1. 압축 스크립트는 `wackpuball/tools/build-assets.mjs` 구조를 따른다. 의존성(@gltf-transform, meshoptimizer, draco3dgltf, sharp)은 **`wackpuball/node_modules` 에만** 있다. ESM 은 스크립트 파일 위치 기준으로 패키지를 찾으므로 스크립트를 그 폴더에 두거나 정션을 걸어야 한다.
2. 텍스처 처리는 **반드시 자식 프로세스**(`tools/texworker.mjs`)에서. 같은 프로세스에서 draco3d/meshoptimizer WASM 을 초기화하면 libvips colourspace 가 깨져 sharp 인코딩이 전부 실패한다.
3. 설정: 45만 삼각형 / 2048 WebP / Draco EDGEBREAKER. 실적은 54MB → 2.5MB, 52.8MB → 1.6MB.
4. **Tripo 는 `metalness = 1` 로 내보낸다.** 금속은 확산광이 없어 환경맵이 없으면 모델이 통째로 새까맣게 렌더된다. `Character3D.jsx` 가 `mat.metalness = 0` 으로 되돌린다 — 이 줄을 지우면 안 된다.
5. `public/models/` 에 넣고 `Character3D.jsx` 의 `MODELS` 와 `ALBEDO_LIFT` 에 등록한다.

## 5. 손으로 맞춘 수치 — 바꾸면 화면이 달라진다

### 3D 모델 밝기 (`src/components/Character3D.jsx`)
```js
const ALBEDO_LIFT = { terry: 2.6, aqu: 1.7 }
```
스캔이 구운 basecolor 가 원화보다 어둡다(원화 몸통 `#d8b878`, 보정 전 화면 `#886848`). 조명을 올려 그림자까지 들뜨게 하는 대신 albedo 만 들어 올린다. 톤매핑은 `NeutralToneMapping` / 노출 1.15 — ACES 는 크림색 파스텔을 탁한 황갈색으로 눌러 버린다.

### 달리기 게임 (`src/sections/TerryRun.jsx`)
- **세계는 가로 420 단위 하나뿐이다.** 캔버스를 **폭에 맞춰** 그리므로(`k = rect.width / W`) `W` 가 곧 배율이다 — 줄일수록 캐릭터가 커진다. 800 → 560 → 420 으로 두 번 당겼고(사용자가 "박스가 작다"를 두 번 물렸다), 그때마다 속도·간격·장애물 치수를 같은 비율로 줄여 **한 화면을 가로지르는 시간**과 **장애물의 화면상 크기**를 유지했다. 커지는 것은 테리뿐이다. 예전처럼 높이에 맞춘 뒤 보이는 폭에 비례해 속도만 늘리면(`sc`), 크기는 그대로라 모바일에서 같은 점프로 넘는 장애물 폭이 PC 의 두 배가 된다 — 그래서 폭 기준을 지킨다.
- **세로는 고정하지 않는다.** 지면선을 상자의 아래에서 잰다(`ground = rect.height / k - GROUND_BAND`, 띠 22 단위). 남는 위쪽은 그대로 하늘이라, 프레임 비율을 화면마다 다르게 줘도 물리가 흔들리지 않는다 — 데스크톱 `420/224`(폭 1000px 상한 → 1000×533), 모바일 `420/260`(375px 화면에서 375×232, 좌우 여백 없음). HUD 높이는 그 띠의 비율이라 각각 9.8% / 8.5%.
- **난이도는 계측해서 맞췄다.** 장애물마다 "점프를 눌러도 되는 시각의 폭"을 재면 원본 800 이 275ms, 직전 560 이 190ms, 지금 420 이 177ms 다. 테리를 키우면 몸이 차지하는 폭이 늘어 이 여유가 줄어드는데(155ms), 충돌 상자를 `HIT_W 40`(그림은 62)으로 좁혀 되돌렸다. W 를 다시 만지면 이 수치를 재 볼 것.
- 스프라이트의 투명 여백을 재서 그려진 부분의 밑변을 지면선에 맞춘다(`SPRITE_BOX`).
- **최고 기록은 이 기기의 localStorage(`terryRunBest`)에만 남는다.** 서버로 보내지 않는다. 프레임 아래 기록 칸이 이번 기록과 최고 기록을 나란히 보여 주고, 갈아치우면 노란 칸에 테두리와 `신기록` 배지가 붙는다. 저장소를 못 쓰는 브라우저(비공개 모드 등)에서는 안내 문구가 "저장되지 않습니다"로 바뀐다 — 저장된다고 적어 놓고 실제로 안 되면 거짓말이 되므로.

### 히어로 (`src/components/ScrollScrubHero.jsx`)
- **프레임을 두 벌 쓴다**(2026-09-09). 넓은 화면 1440×810, 좁은 화면 `frames/m/` 720×405. 고르는 기준은 화면 폭이 아니라 **실제로 그려지는 폭**(장치 픽셀)이고, 720 이하면 작은 쪽이다(`pickSet`). 한 벌만 쓰던 때는 휴대폰에서도 1440 을 디코드해 528px 폭으로 그렸다 — 쓸 픽셀의 일곱 배다. 스크롤 한 번에 프레임이 115장 바뀌므로(실측) 그대로 렉이 됐다. 살려 두는 창도 12 → 8 로 줄여 이미지 메모리가 75MB → 14MB 가 됐다. **한 번 고른 세트는 바꾸지 않는다** — 도중에 갈아타면 131장을 다시 받는다.
- `FIRST = 0`, `LAST = 130` — 영상 131장 전부. **앞 여섯 장은 캐릭터가 흰 화면에서 날아드는 모션 블러라 스크롤 0 지점에는 그림이 없고 제목만 보인다.** 그려진 구간만 쓰려면 `6 / 114` 로 되돌린다.
- 높이 200svh(세로 화면 170svh). 그림과 제목을 한 덩어리로 화면 정중앙에 놓고, 그림의 아래끝을 CSS 변수 `--hero-copy-top` 으로 넘겨 제목이 거기 붙는다.

### 체험 예약 (`server/booth.js` · `src/components/Reservation.jsx`)
- 활동 넷이 각자 줄을 선다. 예약하면 그 줄 맨 뒤에 서고, 운영자가 **체험 완료**를 누르면 맨 앞이 빠지며 뒤가 당겨진다.
- 앞이 **5팀 이하**가 되는 순간 한 번만 호출 안내가 나간다(`CALL_AHEAD`, `calledAt` 으로 중복 방지).
- 저장은 `server/data/booth.json` 파일 하나(임시 파일 + rename). **이름·전화번호가 평문이라 행사 후 지울 것.**
- 비밀번호는 서버가 확인한다(`BOOTH_ADMIN_PASSWORD`). 화면 코드에 정답이 없어 번들에서 명단이 새지 않는다. **개발 기본값 3618 은 배포에서 통하지 않는다** — 환경변수가 없으면 운영 화면을 잠근 채 뜬다(저장소에 적힌 값으로 명단이 열리면 안 되므로).
- 운영 화면 맨 위에서 **이름·번호 뒷자리로 찾으면** 그 사람이 잡아 둔 예약이 활동별로 모여 나온다 — `진행 중`(그 줄 맨 앞) · `호출함 · 앞 N팀` · `대기 · 앞 N팀` · `완료`/`취소`. 한 사람이 네 활동에 다 줄을 설 수 있어서 필요한 화면이다.
- 카카오톡 발송은 대행사 계정이 있어야 나간다. 없으면 예약은 정상 접수되고 문자만 건너뛴다 — 운영 준비·연결 방법은 **`docs/RESERVATION.md`**.

## 6. 디자인 규칙

전문은 `docs/BRIEF.md`. 요약만:

- 밝은 배경 셋: `--paper #f5f2ee` · `--brown #efe5d8` · 히어로와 테리 섹션만 `--reel #faf6c9`(영상 프레임의 평면색이라 바꾸면 번쩍인다).
- 서체 하나 Pretendard, 굵기 400/700, 한글 자간 normal, 모노스페이스 금지(`tabular-nums`).
- 텍스트 3단 `--ink #14110f` → `--ink-2 #6b625a` → `--ink-3 #9a938b`.
- 강조색 하나 `--accent #e3a21f`. **면·선에만** 쓰고 글자색으로 쓰지 않는다.
- 그라데이션·backdrop-filter 금지.
- 모서리: 버튼·칩은 알약 `--r-btn 999px`, 면은 `--r 12px` / `--r-lg 16px`.
- 모바일 390px 완전 호환, 터치 타깃 44px, 가로 스크롤 금지. **입력칸 글자는 16px 아래로 내리지 않는다** — iOS 사파리가 그보다 작은 입력칸을 누르면 페이지를 확대해 버린다. `.wrap` 은 `env(safe-area-inset-*)` 을 더해 노치 있는 기기의 둥근 모서리를 피한다(`viewport-fit=cover` 가 index.html 에 있어야 값이 온다).
- **설명을 늘리지 않는다.** 읽는 섹션(캐릭터 소개·유래·굿즈)은 사용자 지시로 전부 삭제됐다.
- **상단에는 브랜드 마크 하나뿐이다.** 데스크톱 내비(`활동 · 돌려보기 · 놀기`)는 2026-09-04 에 사용자 지시로 없앴다. 섹션 이동은 2페이지 `체험 바로가기` 카드가 전담한다.
- 브랜드 마크는 `[로고 이미지][프리지아]` 한 세트, 배경 알약 없이 `mix-blend-mode: multiply`. 스크롤을 내리면 물러난다.

## 7. 남은 것

- 활동 페이지 셋(`감각등록` `감각추구` `감각회피`)은 제목만 있고 본문이 비어 있다. 작업치료 활동안은 학생회가 쓸 내용이라 지어내지 않았다. `src/pages/ActivityPages.jsx` 의 `Pending` 자리에 넣으면 된다.
- 결제 라우트(`#/terry` `#/aqu`)는 코드와 서버가 살아 있지만 화면 어디에서도 링크하지 않는다. 주소를 직접 쳐야 열린다.
- 안내 문자 발송은 대행사 계정(Solapi 등)을 넣기 전까지 나가지 않는다. 그동안에도 예약·대기 순서·운영 화면은 전부 동작한다.
- 말랑이는 2026-09-08 에 삭제됐다. 되살리려면 바탕화면 `프리지아-말랑이-보관.zip`(코드 + LOD 모델 + 옛 `Play.jsx`)을 풀고 `App.jsx` 에 다시 붙이면 된다.
- 학과 표기는 푸터에서 사용자가 직접 쓴 `작업치료학과` 를 따른다.
