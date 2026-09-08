# 프리지아 — 아큐 & 테리

신구대학교 작업치료학과 초대 학생회의 캐릭터 IP 소개 사이트.
스크롤로 넘기는 영상, 직접 돌려보는 3D 캐릭터, 달리기 게임, 그리고 **부스 체험 예약**이 들어 있다.

## 띄우기

```bash
npm install
npm run dev          # 개발: Vite(5173) + API(8787)
```

```bash
npm run build        # 화면을 dist/ 로 굽고
npm start            # 서버 하나가 dist/ + API 를 같은 주소로 내보낸다
```

Node 22 이상.

## 환경변수

`.env` 를 만들어 채운다(변수 목록은 [docs/ENV.md](docs/ENV.md)). **`.env` 는 git 에 올라가지 않는다.**
키가 하나도 없어도 화면·3D·게임·예약은 전부 동작한다 — 안내 문자와 결제만 멈춘다.

| 이름 | 없으면 |
|---|---|
| `SOLAPI_API_KEY` `SOLAPI_API_SECRET` `SMS_SENDER` | 예약은 되지만 안내 문자가 안 나간다 |
| `BOOTH_ADMIN_PASSWORD` | 개발은 `3618`, **배포는 운영 화면이 잠긴다** |
| `BOOTH_DATA_DIR` | 예약 기록이 `server/data/` 에 쌓인다 |
| `TOSS_SECRET_KEY` `VITE_TOSS_CLIENT_KEY` | 결제 라우트만 안내 문구를 띄운다 |

## 문서

| 파일 | 내용 |
|---|---|
| [docs/HANDOFF.md](docs/HANDOFF.md) | **먼저 읽을 것.** 구조·자산·손으로 맞춘 수치 전부 |
| [docs/RESERVATION.md](docs/RESERVATION.md) | 부스 체험 예약 운영 안내 (행사 당일 절차) |
| [docs/DEPLOY.md](docs/DEPLOY.md) | 인터넷에 올리는 방법 |
| [docs/BRIEF.md](docs/BRIEF.md) | 디자인·카피 규칙의 전문 |

## 만든 것

Vite · React 19 · three.js(@react-three/fiber) · Express · Canvas 2D
