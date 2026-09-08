# 프리지아 (FREESIA) — 아큐 & 테리 웹사이트 제작 브리프 (v2, 비평 반영)

프로젝트 루트: `C:\Users\USER\Desktop\클로드` (Vite 8 + React 19 + three/r3f + motion, JS(JSX) 프로젝트. TS 파일도 Vite가 그대로 트랜스파일한다.)
개발: `npm run dev` (vite + `server/index.js` API를 concurrently로 함께 띄움). 빌드: `npx vite build`. 린트: `npx oxlint`.
API: `/api/products` (가격은 서버가 정한다. 클라이언트는 절대 금액을 만들지 않는다.)

## 1. 비즈니스 (사용자가 확정한 것)

- 브랜드명 **프리지아**. 출처: 신구대학교 작업치료과 엠블럼(손 위에 핀 프리지아 꽃). 캐릭터 IP 브랜드.
  - 학과 표기: 사용자가 08-22에 "작업치료학과"라고 한 번 썼고, 이후 코드·메모리는 "작업치료과"로 통일돼 있다. **"작업치료과"로 쓴다**(공식 명칭은 사용자에게 확인 예정).
- 캐릭터: **테리**(여우, 큰 귀·긴 꼬리, 머리에 프리지아 꽃. 펑크 차림은 가시목걸이+귀걸이), **아큐**(비버, 넓은 꼬리·앞니, 프리지아 꽃을 두 손으로 안고 있음).
- **최종 목표는 캐릭터 IP 쇼케이스**. 사전판매·결제는 부수적. 굿즈는 "실제로 만질 수 있는 형태"로 짧게 보여 주기만 한다.
- 페이지는 결제 퍼널이 아니라 **탐험 순서**: 체험 바로가기 → 직접 돌려보기 → 달리기. (2026-09-08 개정 — 말랑이 삭제, 체험 예약 추가)
- 굿즈: 테리 인형 1개 + 학과 랜덤 키링 1개 = **1원** 사전판매(토스페이먼츠 테스트, 서버가 금액 검증). 아큐 인형은 **COMING SOON**.
- 굿즈 섹션을 위로 올리거나 히어로 CTA를 결제로 바꾸는 것은 금지.
- **히어로는 08-24에 확정된 "영상 프레임 스크롤 스크럽"이 최종이다.** 08-29 notefolio(Milla's Orbit) 계열의 공전/포인터 반발 히어로(`OrbitHero.jsx`)와 08-29 decathlonyestalgia 스타일은 08-31 "전으로 복구" 지시로 폐기됐다. 메모리 파일의 "히어로에만 공전" 문장은 무효.
- 이름 순서 규칙: 제목·브랜드 문맥은 사용자가 정한 **`아큐 & 테리`**, 상품·판매 문맥(굿즈·라우트)은 테리 → 아큐 순서. 말랑이 원제 `테리와 아큐의 말랑말랑 스퀴시`는 사용자 원문이라 그대로.

## 2. 디자인 규칙 (반드시 지킬 것)

- **밝은 배경**. 다크·글래스모피즘 폐기. 섹션 배경값은 두 개: `--paper #f5f2ee`(기본) · `--brown #efe5d8`(연한 갈색). 카드/무대 바탕은 `--card #ffffff` 또는 `#f7f5f1`.
  - **히어로만 예외**: 영상 프레임의 평면색 `--reel #faf6c9`를 스티키 배경·부팅 커버·스크림에 쓴다(절대 paper로 바꾸지 말 것 — 프레임 모서리색과 달라지면 번쩍인다). **테리 돌려보기 섹션 배경도 `var(--reel)`** (사용자: "4번 페이지는 1번 페이지랑 완전 같은 색깔").
- **서체 하나: Pretendard** 400/700만. 한글 자간 `normal`. **모노스페이스 서체 금지** — 숫자 정렬이 필요하면 `font-variant-numeric: tabular-nums`.
- **텍스트는 검정 3단**: `--ink #14110f` → `--ink-2 #6b625a` → `--ink-3 #9a938b`. 강조색을 글자색으로 쓰지 않는다.
- **강조색 1개: 프리지아 노랑 `--accent #e3a21f`, `--accent-ink #17120f`.** 허용 용처(전부 면·선):
  ① `사전판매 진행중`/`사전판매` 배지(높이 22px, 패딩 0 8px, radius `--r`, 글자 11px 700 `--accent-ink`) ② 내비 현재 섹션 밑줄 2px ③ 텍스트 링크 hover 밑줄 2px(`text-decoration-thickness: 2px; text-underline-offset: 3px`, 글자는 ink 유지) ④ 유래 색 칩 ⑤ 5px 이하의 점(선택 칩 점 등). 그 외 금지. 한 화면에 노란 면은 2개 이하.
  - CTA(`.cta`, `.btn--solid`)는 배경 `--ink`, hover `#2a2420`, active `#000`, disabled `--fill`. **accent 배경 금지.** `:focus-visible`은 `2px solid var(--ink)` offset 3px.
- **그라데이션 절대 금지**(보라·검정 그라데이션은 사용자 명시 금지). 배경은 단색. 스크림은 단색+opacity. `backdrop-filter` 금지.
- **본문 작게**: body 13px / 1.62. 보조 11~12px. 제목 크기 점프는 작게, 위계는 굵기와 색으로.
- **모서리(2026-09-04 개정)**: 사용자가 두 번 "버튼 네모남, 둥글게"라고 했다. **버튼·칩은 알약 `--r-btn 999px`**, 무대·카드 같은 면은 `--r 12px` / `--r-lg 16px`. 참고한 motionsites.ai 도 조작은 알약, 면은 작게 굴린다. 초기 브리프의 "거의 직각" 규칙은 이 지시로 대체됐다.
- **카드 그리드 대신 헤어라인 + 여백**, 테두리 대신 반투명 회색 면 `--fill rgba(20,17,15,0.05)`, 선은 `--line rgba(20,17,15,0.13)` / `--line-soft 0.07`.
- **비대칭 편집 구조**: 좌측 라벨 레일 + 우측 본문(29CM식). **대칭 카드 그리드·번호/아이콘+제목+설명 3종 세트 금지.**
- 라틴 대문자 라벨은 딱 세 가지만 허용: 레일 `TERRY`/`AQU`(11px 700 ink-3), 배지 `COMING SOON`, 게임 HUD `HI`. letter-spacing 최대 0.5px. 섹션 소제목(eyebrow)은 전부 **한글 11px 700 ink-2**.
- 컨테이너 `--wrap 1240px`, 패딩 `--pad 24px`(≤720px: **22px** — 18px 은 글이 가장자리에 붙어 답답했다). 섹션 상하 패딩 96~112px(모바일 72~84px). 무대형 섹션(돌려보기·놀아보기)은 상 80 / 하 96으로 줄여 제목+무대가 한 화면에 들어오게.
- **배경 리듬**: 히어로 crème(reel) → 체험 바로가기 paper → 아큐 brown → 테리 reel → 달리기 brown → 푸터 paper(상단 헤어라인).
- 모든 앵커 섹션에 `[id] { scroll-margin-top: 72px; }` (고정 브랜드 마크 아래로 제목이 붙지 않게).
- 모바일 390px 완전 호환. 터치 타깃 44px 이상. 가로 스크롤 절대 금지.
- **모바일은 여백을 아끼지 않는다**(2026-09-03 "너무 답답해보여"): 섹션 상하 88/96, 제목 26px, 활동 차림표는 좌우 테두리를 지우고 가로줄만 남겨 화면 폭을 그대로 쓴다, 3D 무대 `max-height: 62svh`, 세그먼트 버튼은 화면 폭을 반씩 나눠 갖는다.
- **버튼**: 세그먼트 48px(모바일은 폭 절반씩), 흰 면 + 헤어라인, 선택 시 잉크 면, `:active` 에 눌림 반응. 면 없는 글자 버튼은 쓰지 않는다.
- 모션: motion/react `whileInView` 페이드/라이즈 정도만. `prefers-reduced-motion` 존중.

### 코드 교체 목록 (site 담당)
1. `src/index.css`: `--accent: #e3a21f; --accent-ink: #17120f;` `--reel: #faf6c9;` 추가(현재 App.css에 있음 → index.css로 이동). `:focus-visible` outline `var(--ink)`. 파일 상단 주석 갱신.
2. `src/App.css`: 전면 재작성. `color: var(--accent)` 글자 사용 전부 제거. `letter-spacing`·`text-transform: uppercase`는 한글 요소에서 전부 제거. `ui-monospace` 제거. `.game*` 규칙 제거(dino 담당의 terry-run.css로 이동됨). 파일 상단 주석의 섹션 순서 갱신.
3. `.brandmark`를 3절 사양으로 재작성.

## 3. 브랜드 마크 (사용자 원문: "프리지아 로고는 전 처럼 프리지아 사진과 글자 결합해서 해줘")

- 상단 **정중앙 고정**(position: fixed; top 18px; ≤720px: top 12px). **[로고 이미지] [프리지아]** 순서, 한 세트(MLB 글자 왼쪽에 로고 있는 것처럼). gap 8px.
- 로고 이미지: `/brand/logo-mark.png` (엠블럼을 연한 회색 실루엣으로 만든 투명 PNG 240x234). 표시 **30px**(모바일 25px). CSS 필터 불필요.
- 글자: `프리지아` Pretendard **700 16px**(모바일 15px). 색 **`--ink-3 #9a938b`**(사용자가 원한 "연한 회색"이면서 2.7:1 확보), hover `--ink-2`.
- `.brandmark { mix-blend-mode: multiply; }` — 배경 없이도 밝은 면·이미지 위에서 항상 더 어둡게 곱해져 읽힌다(그라데이션·블러 아님).
- **배경 알약·동그라미·블러 금지**(사용자가 두 번 "동그라미 없애라" — 알약 배경을 말한다). background transparent, border-radius `--r`.
- `<a class="brandmark" href="#/">`. 클릭하면 맨 위로 부드럽게 스크롤(해시 라우트에서는 `#/`로 이동 후 맨 위). 높이 44px(패딩으로 탭 타깃 확보).
- 무대형 요소(3D 무대·게임 프레임)의 **상단 72px 안에는 HUD·버튼을 두지 않는다**(HUD는 하단 정렬). 더해서 상단 바는 스크롤을 내릴 때 물러난다(5절 0항).

### 내비 — 없음 (2026-09-04 삭제)
- 우측 상단 데스크톱 내비(`활동 · 돌려보기 · 놀기`)를 사용자 지시로 없앴다. **상단에는 브랜드 마크 하나뿐이다.** 섹션 이동은 2절의 카드(`체험 바로가기`)가 전담한다 — 같은 일을 하는 장치가 화면 위아래에 둘 있을 이유가 없다. 앵커 id(`#activities` `#aqu` `#game`)는 카드가 쓰므로 그대로 둔다.

## 4. 자산 (모두 존재함 — 새로 만들지 말 것)

| 경로 | 내용 |
|---|---|
| `/brand/logo-mark.png` | 브랜드 마크용 회색 엠블럼 실루엣(투명, 240x234) |
| `/brand/logo.png` | 엠블럼 컬러(흰 배경 제거, 256px) — 푸터용 |
| `/brand/emblem.jpg` | 학과 엠블럼 원본 (878x856) — 유래 섹션 |
| `/char/terry-sit.png` | 테리 앉은 자세, 머리에 꽃 (투명) |
| `/char/terry-run.png` | 테리 달리기 포즈 (투명, 펑크) — 게임 달리기 스프라이트 |
| `/char/terry-jump.png` | 테리 점프 포즈 (투명) — 게임 점프 스프라이트 |
| `/char/aqu-stand.png` | 아큐 서 있는 포즈 (투명, 560x640, 영상 원본에서 잘라냄) |
| `/art/terry-freesia.jpg` | 꽃 얹은 테리 (흰 배경) |
| `/art/terry-punk.jpg` | 가시목걸이 테리 (흰 배경) |
| `/art/terry-dash.jpg` | 달리는 테리 (검정 배경 — **쓰지 말 것**) |
| `/frames/f_001..f_131.jpg` | 히어로 스크롤 스크럽 프레임 (960x540). 그려진 구간은 f_007~f_115 |
| `/video/making.mp4` | 원본 영상 (히어로와 같은 내용) — 쓰지 않는다 |
| `/models/terry.glb`, `/models/aqu.glb` | 돌려보기용 고해상 모델(Draco, 부위 zone id 포함). `/draco/` 디코더 있음 |
| `/favicon.png`(64), `/apple-touch-icon.png`(180) | 엠블럼 파비콘 — index.html에서 참조(`/favicon.svg`는 더 이상 쓰지 않음) |
| `/fonts/Pretendard-*.woff2` | 서체 |

## 5. 페이지 구조와 카피 (홈 `#/`) — 2026-09-03 개정

**2026-09-03 사용자 지시로 읽는 섹션을 전부 걷어냈다.** "캐릭터 설명 페이지 없애 / 프리지아 설명 없애 / 설명 너무 많아 UI 애플 마냥 심플하게." 남은 것은 만드는 과정 한 장과 만지는 것 세 개, 그리고 굿즈 한 줄이다. 섹션을 다시 늘리려면 사용자에게 먼저 확인할 것.

**2026-09-08 까지 반영.** 최종 순서: 히어로 → 체험 바로가기 → 아큐 돌려보기 → 테리 돌려보기 → 달리기 → 푸터.
삭제됨: `Characters.jsx`, `Origin.jsx`, `Goods.jsx`, `Making.jsx`(내용은 감각예민 활동 페이지로 옮겼다). 관련 CSS·내비·푸터 링크도 함께 제거됐다.
결제 라우트 `#/terry`·`#/aqu` 의 파일과 서버는 남아 있지만 화면 어디에서도 링크하지 않는다(직접 주소로만 도달). 완전히 지우려면 사용자 확인이 필요하다.

### 0. 상단 바 — 브랜드 마크뿐
- 3절 사양 그대로. **다만 스크롤을 내리면 위로 물러나고 올리면 돌아온다**(`useTopBarHidden`, 160px 아래부터). 배경 알약이 금지된 상태에서 본문·무대·HUD 와의 겹침을 없애는 유일한 방법이다.
- 내비는 없다(2026-09-04 삭제). 푸터에도 링크를 두지 않는다.

### 1. 히어로 — 스크롤 스크럽 (id `top`)
- **부제 없음.** `아큐 & 테리` h1 한 줄뿐이고 **화면 정중앙**(`top: 50%; translateY(-50%)`, 가운데 정렬)에 놓인다.
- **그림과 제목을 한 덩어리로 화면 정중앙에 놓는다.** 그림 높이 `min(h*0.55, (w*0.94)/aspect)`, 제목 높이를 실제로 재서 `(h - (그림+간격+제목))/2` 를 그림의 위끝으로 삼는다. 그림의 아래끝은 캔버스가 CSS 변수 `--hero-copy-top` 으로 알려 주고 제목이 거기에 붙는다. cover 로 채우면 캐릭터가 한가운데를 차지해 제목과 겹치고, 그림만 가운데 두면 위쪽만 무거워진다.
- **스크롤이 곧 재생이다.** 높이 200svh(세로 화면 170svh) — 100svh 를 스티키가 쓰고 남은 100svh 가 재생 구간.
- 프레임은 `아큐 테리 수정본.mp4`(1920x1080, 4.37초, 131장)에서 뽑는다. 2026-09-03 에 960x540 → 1440x810 로 다시 뽑았다(총 6.3MB).
- **범위는 FIRST=0(f_001) ~ LAST=130(f_131), 즉 전부다**(2026-09-04, 사용자가 세 번 요구). 앞 여섯 장은 캐릭터가 흰 화면에서 날아드는 모션 블러라 **스크롤 0 지점(착지 화면)에는 그림이 없고 제목만 보인다.** 뒤 열여섯 장도 날아 나가는 블러와 공백이다. 그려진 구간만 쓰려면 `ScrollScrubHero.jsx` 의 FIRST/LAST 를 6/114 로 되돌리면 된다. 이것이 영상의 처음부터 끝까지다 — 앞 여섯 장은 캐릭터가 흰 화면에서 날아드는 모션 블러, 뒤 열여섯 장은 날아 나가는 블러와 완전한 공백이라 넣으면 도착·이탈 순간에 뭉개진 얼룩이 보인다(f_006 으로 실제 시작해 보고 확인).
- 제목은 가운데 정렬(`text-align: center`). 제목·스크림은 `fadeOut(p, 0.06, 0.26)` 으로 스크롤 시작과 함께 빠지고, 그 뒤로는 영상만 남는다. 큐(`아래로` + 1px 세로선)는 `fadeOut(p, 0.04, 0.16)`.

### 2. 감각 활동 (id `activities`) — 배경 paper
- h2 `체험 바로가기`(2026-09-04, 옛 `감각 활동`) + **모서리를 굴린 흰 카드 여섯 칸**(`.tiles`, gap 14px, `--r-lg`). 2026-09-04 에 헤어라인 표에서 카드로 바꿨다 — 여기가 유일하게 "고르는" 화면이라 누를 수 있다는 게 먼저 보여야 한다. 데스크톱 3열, ≤720px 1열. hover 는 2px 떠오르고 테두리가 진해진다(그림자 없음).
- 칸마다 위에 감각 유형(11px ink-3), 아래에 활동명(16px 700), 오른쪽에 화살표.
- 앞의 넷은 각자의 페이지(체험 예약이 거기 있다)로, 다섯째는 이 페이지 안의 앵커로 간다:
  `감각등록 · 보지 않고 물건 맞추기` → `#/sense/register`
  `감각추구 · 말랑이 만들기` → `#/sense/seek`
  `감각예민 · 클레이로 아큐 테리 만들기` → `#/sense/sensitive`
  `감각회피 · 나만의 무드등 만들기` → `#/sense/avoid`
  `지금 해보기 · 테리와 함께 달리기` → `#game` (`.tiles__two` — 3열에서 두 칸을 차지해 넷 + 하나가 격자를 정확히 채운다)
- **인스타그램 칸**은 전체 폭(`.tiles__wide`) 잉크 면이다 — 사이트 밖으로 나가는 유일한 링크라 혼자 검게 둔다. `https://www.instagram.com/shingu_occupational/`, `target="_blank" rel="noreferrer noopener"`, 인라인 SVG 글리프.

### 2-1. 활동 페이지 (`src/pages/ActivityPages.jsx`)
- 공통 껍데기: 감각 유형(11px 700 ink-2) → h1 활동명 → 본문. `Shell` 안에 들어가므로 브랜드 마크와 `← 홈으로` 가 함께 붙는다.
- **감각예민**만 내용이 있다 — 홈에 있던 클레이 섹션(태그 칩 + 대상/활동/환경 한 줄씩 + terry-sit 그림)이 이 페이지로 옮겨 왔다.
- 나머지 셋은 `활동 내용을 준비하고 있습니다.` 한 줄뿐이다. **작업치료 활동안을 지어내지 말 것** — 학생회가 쓸 내용이다.
- **넷 모두 맨 아래에 체험 예약(`<Reservation activity=… />`)이 붙는다**(2026-09-08). 활동마다 줄이 따로 선다. 자세한 것은 `docs/RESERVATION.md`.

### 3. 돌려보기 (id `aqu`, `terry`) — `ModelSection`
- 제목은 `아큐 직접 돌려보기` · `테리 직접 돌려보기`. `tone="brown"`(아큐) · `tone="reel"`(테리, 히어로와 같은 크림).
- **제목 외 문장 금지.** 허용되는 텍스트는 짧은 라벨뿐: `꽃잎` `귀` `꼬리`, 스와치 aria-label, `회전 멈춤`/`회전 시작`, `색 초기화`.
- **UI(2026-09-03 재설계 — "ui가 구려")**: 무대에 상자·테두리·바탕을 두지 않는다. 캐릭터가 섹션 배경 위에 그대로 선다(`max-width: 560px; aspect-ratio: 1/1`, 세로 화면 `max-height: 56svh`). 카메라는 `position: [0, 0.02, 1.62]` 로 당겨 캐릭터를 크게 잡는다.
- **`특수 색깔` 은 색을 칠하는 게 아니라 모델을 바꿔 끼운다**(2026-09-04). `id` 뒤에 `-special` 을 붙인 모델을 띄운다. `terry-special.glb`(돌 재질, 54MB → 2.5MB)와 `aqu-special.glb`(옻칠 검정, 52.8MB → 1.6MB, albedo 보정 2.6 — 그대로 두면 형태가 안 읽힐 만큼 어둡다) 둘 다 45만 삼각형 / 2048 WebP. 셰이더 틴트 경로(`SPECIAL_TINT`)는 제거했다.
  - Tripo 는 `metalness = 1` 로 내보낸다. 금속은 확산광이 없어 환경맵 없이는 **통째로 새까맣게** 렌더된다 — `Character3D` 에서 `mat.metalness = 0` 으로 되돌린다.
  - 돌 모델은 원본 텍스처가 이미 밝아 albedo 보정을 걸지 않는다(`ALBEDO_LIFT["terry-special"] = 1`).
- **컨트롤은 세그먼트 하나다(2026-09-03 3차).** 흰 칩 두 개를 무대 양 끝에 떨어뜨려 두니 모델과 따로 노는 조각처럼 보였다. 헤어라인 하나로 둘을 묶어 무대 아래 가운데에 놓는다(`.segmented`, 44px, 선택 시 잉크 면). 부위 선택(꽃잎·귀·꼬리)과 스와치 8개를 없애고, `특수 색깔` 토글 하나만 남겼다 — 켜면 셰이더가 아는 세 자리(꽃잎·귀·꼬리)에 프리지아 노랑 `#e3a21f` 이 한꺼번에 들어간다. `회전 멈춤` 은 무대 아래 오른쪽 끝으로 옮기고 46px 칩으로 키웠다. 두 칩은 `.model__controls`(max-width 560px) 양 끝에 놓인다.

### 4. 달리기 (id `game`) — 배경 brown

> **말랑이는 2026-09-08 에 사용자 지시로 삭제됐다.** `src/squishy/**`, `public/models/squishy/**`,
> `src/sections/Play.jsx`, App.css 의 `.play*`·`.squishy*` 규칙, 활동 카드의 `#squishy` 칸이 모두 빠졌다.
> 코드와 모델은 바탕화면 `프리지아-말랑이-보관.zip` 에 그대로 들어 있다. 7절의 이식 요구사항은 이제
> 효력이 없다(기록으로만 남긴다).

- 섹션 제목은 h2 `테리와 함께 달리기` 하나. **리드 문장도, 작은 라벨도 없음.**
  - **세계는 화면과 무관하게 가로 420 단위 하나다(2026-09-04).** 세로는 고정하지 않는다 — 지면선을 상자의 **아래에서** 재므로(`GROUND_BAND` 22 단위) 남는 위쪽이 그대로 하늘이 되고, 프레임 비율을 화면마다 다르게 줄 수 있다. 물리는 가로에만 걸려 있어 하늘이 얼마나 보이든 PC 와 모바일은 완전히 같은 게임이다. 예전에는 높이에 맞춰 그린 뒤 보이는 폭에 비례해 속도·간격만 늘렸는데(`sc`), 크기는 그대로라 모바일에서 같은 점프로 넘을 수 있는 장애물 폭이 PC 의 두 배가 됐다 — 같은 게임이 아니었다. 이제 **폭에 맞춰** 그리고 `sc` 를 없앴다. 프레임 비율은 데스크톱 `420/224`(폭은 1000px 에서 멈춘다), 모바일 `420/260` 이고, 모바일에서는 좌우 여백을 없애(`margin-inline: calc(var(--pad) * -1)`) 폭을 최대한 쓴다. 프레임이 얇아지므로 모바일 덮개는 힌트를 숨기고 버튼을 38px 로 줄인다.
  - 스프라이트의 투명 여백을 재서 **그려진 부분의 밑변을 지면선에 맞춘다**(`SPRITE_BOX`). 달리기 PNG 는 아래 14% 가 빈 픽셀이라 그대로 두면 캐릭터가 떠 보인다.
  - 점프 스프라이트는 2026-09-04 에 다시 만들었다. 원본 `KakaoTalk_20260823_220057010_02.jpg` 왼쪽 아래에 다른 캐릭터의 귀가 딸려 들어와 있어 흰색으로 덮고 다시 키잉했다(603x684, 여백 0).
  - **그림자는 그리지 않는다**(캐릭터·장애물 모두). HUD 는 지면선 아래 띠에 둔다.
  - 키보드는 게임이 화면에 보일 때만 받는다(안 그러면 스페이스가 페이지 스크롤을 막는다).

### 5. 푸터 — paper + 상단 헤어라인
- 좌: `/brand/logo.png` 34px + `프리지아`(14px 700) / `신구대학교 작업치료학과 초대 학생회`(12px ink-2).
- 주소(`<address>`)는 학생회 줄 **바로 밑에 붙인 한 줄**이다(2026-09-04): `margin-top: 1px`, `white-space: nowrap`, 12px `--ink-3`, ≤720px 은 `clamp(9.5px, 2.8vw, 12px)` 로 폭에 맞춰 눌러 담는다 — 두 줄로 접히면 이름·학생회·주소 세 줄의 덩어리가 흐트러진다.
- **그 외에는 아무것도 두지 않는다** — 링크도, 테스트 결제 안내도 없다.
- **로고 이미지는 숨은 문이다**(2026-09-08). 2.5초 안에 다섯 번 누르면 비밀번호 창이 뜨고, 맞으면 `#/booth` 운영 화면으로 간다. 겉으로는 아무 표시도 하지 않는다 — 방문자에게 보일 문이 아니다. 정답은 서버에만 있다(`BOOTH_ADMIN_PASSWORD`, 기본 3618).
- 학과 표기는 여기서 사용자가 직접 쓴 `작업치료학과` 를 따른다.

### 라우트 (해시)
- `#/terry`(결제) · `#/aqu`(COMING SOON) · `#/pay/success` · `#/pay/fail`. 결제 로직·`src/lib/api.js`·`server/**` 수정 금지.
- `#making` 같은 맨 해시는 홈 안의 앵커, `#/...` 만 페이지 라우트다.

## 6. 파일 소유권 (병렬 작업 — 남의 파일을 건드리지 말 것)

| 담당 | 소유 파일 |
|---|---|
| **site** | `src/App.jsx`, `src/App.css`, `src/index.css`, `index.html`, `src/sections/{Characters,Origin,Making,Play,Goods,Footer}.jsx`(신규), `src/sections/ModelSection.jsx`, `src/components/ScrollScrubHero.jsx`(높이·페이드 수치), `src/pages/*.jsx`(스타일 클래스·카피만). **삭제**: `src/components/Characters.jsx`, `src/components/OrbitHero.jsx`, `src/pages/Landing.jsx`, `src/pages/ViewerPage.jsx`, `src/SignupForm.jsx`, `src/sections/ClayIntro.jsx`, `src/sections/Universe.jsx`, `src/sections/PlayBand.jsx`, `src/sections/CharacterProfiles.jsx`, `src/sections/Goods.jsx`(새로 씀), `src/sections/Making.jsx`(새로 씀), `src/assets/react.svg`, `src/assets/vite.svg`, `src/assets/hero.png`, `public/favicon.svg`, `public/icons.svg`. |
| **dino** | `src/sections/TerryRun.jsx`, `src/sections/terry-run.css`(신규). App.css의 `.game*` 규칙은 site가 제거. |
| **booth** | `server/booth.js`, `server/notify.js`, `src/lib/booth.js`, `src/lib/adminSession.js`, `src/components/Reservation.jsx`, `src/components/booth.css`, `src/pages/BoothAdmin.jsx`. 결제(`server/catalog.js`·`orders.js`, `/api/orders`, `/api/payments/*`)는 건드리지 않는다 — `server/index.js` 에서 라우터를 붙이는 두 줄만 공유한다. |
| ~~squishy~~ | 2026-09-08 삭제. |

### 컴포넌트 계약
- ~~`src/squishy/SquishyStage.tsx`~~ (삭제됨, 기록)  — `export default function SquishyStage({ className }: { className?: string })`. 부모 상자(position: relative, 높이 지정)를 가득 채우는 `div.squishy-stage`(width/height 100%). 내부 Canvas + HUD(캐릭터 칩 `테리`/`아큐`, 말랑말랑 횟수, `모양 복원`, 소리 on/off, `전체 화면`). 자체 CSS(`squishy.css`) import. **자기 `<section>`·제목을 만들지 않는다.** CSS는 `.squishy-stage` 하위 또는 `sq-`/`squishy-` 접두 셀렉터만, `:root`·`body`·전역 `canvas` 셀렉터와 사이트 토큰 재정의 금지. HUD는 무대 하단 정렬(상단 72px 비움).
- `src/sections/TerryRun.jsx` — `export default function TerryRun()` 이 `<section className="game" id="game">` + `<div className="wrap">` + h2 `테리와 함께 달리기` + 게임 프레임을 렌더. 자체 CSS `terry-run.css` import.
- `App.jsx` 가 `<TerryRun />` 을 홈 맨 아래에 직접 놓는다(옛 `Play.jsx` 는 삭제).
- `src/components/Reservation.jsx` — `export default function Reservation({ activity, title })`. 활동 페이지 맨 아래에 들어가는 카드 하나. 자기 `<section className="book">` 을 만들고 `booth.css` 를 import 한다.

## 7. 말랑이 이식 요구사항 (squishy) — **폐기 (2026-09-08 삭제됨, 기록용)**

기준은 **2026-09-01 11:47 이후의 `wackpuball/src` 상태**(config.ts material 블록, squishyMaterial.ts 접힘 방지 프로파일·함몰 그늘 포함). 게임 로직(`game/*`, `three/*`, `audio/*`, `utils/*`, `SquishyCharacter.tsx`, `SquishyScene.tsx`)은 그대로 복사하고 `TUNING` 수치는 바꾸지 않는다. `SquishyControls.ts`는 복사하되 `useSquishyControls(..., { wheel: boolean })` 옵션으로 wheel 리스너 등록을 감싼다(press/drag 판정 로직 불변). `Stage.tsx`의 조명 수치·RoomEnvironment PMREM은 그대로, palette 의존 배경만 제거(캔버스 alpha, CSS 단색 `#f7f5f1`).
- 매니페스트 `public/models/squishy/manifest.json`, 경로 `models/squishy/...`.
- HUD를 사이트 토큰으로 다시 쓴다: 칩 높이 44px, 라운드 `--r`, 12~13px 700, 선택 시 `--ink` 배경. 그라데이션·blur·알약 없음. `h1.wordmark`·설정(⚙) 패널 제거(소리 토글은 칩으로). 클래스 접두 규칙 6절 참고.
- 가시성: IntersectionObserver(rootMargin 200px)로 마운트, 화면 밖 `frameloop="never"`.
- WebGL 미지원 폴백, 로딩 진행률, 한국어 UI, StrictMode 대응 유지.

## 8. 달리기 게임 요구사항 (dino)

- 로직·조작·스프라이트 유지. 장애물은 클레이 덩어리 느낌의 둥근 단색 실루엣 2~3종(`#a89c8d`~`#8d8378`, 라운드 4~6px); 지면 위 옅은 단색 점 패럴랙스; 착지 먼지 2~3개(단색 원). 그라데이션 금지.
- 달리기 포즈는 스프라이트 그대로(달리기 애니메이션 금지 — 사용자가 뺐다), 점프 모션 유지. 충돌 판정은 실루엣과 일치.
- HUD(점수·HI) Pretendard 12px 700 ink-2 `tabular-nums`(모노 금지). 오버레이 배경 `rgba(247,245,241,0.86)`, 버튼 높이 44px, 힌트 11px.
- 프레임 aspect 데스크톱 420/224 · 모바일 420/260. 충돌 상자는 `HIT_W 40`(그림 62 보다 좁다 — 꼬리·귀는 스치는 것으로 친다). 스페이스/↑/Enter/탭 점프, 스페이스 스크롤 방지 유지. best는 localStorage `terryRunBest`.
- `prefers-reduced-motion`이면 패럴랙스 점 생략.

## 9. 검증

- 각 담당: `npx vite build --outDir <scratch>/dist-<담당>` 통과(남의 파일 때문에 실패하면 보고만), `npx oxlint` 자기 파일 경고 0.
- 통합(브라우저, 1440px·390px): 가로 스크롤 없음, 콘솔 에러 0, 브랜드 마크가 brown/reel/paper 위에서 읽힘, 모든 앵커 점프 시 제목이 마크 아래 72px, 3D 무대와 컨트롤 비율, `?zones=1`로 아큐·테리 꽃잎/귀/꼬리 영역이 새지 않는지와 아큐 꼬리 색이 실제로 바뀌는지, 게임 점프·게임오버·다시하기, 활동 페이지의 체험 예약(대기 수 · 예약 · 내 순서)과 푸터 로고 5번 → 3618 → 운영 화면의 체험 완료, `#/terry` 가격 1원, `#/aqu` COMING SOON.
