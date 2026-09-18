import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import express from "express"

import { sendMessage, notifyStatus, lastNotifyError } from "./notify.js"

/**
 * 부스 체험 예약 대기열.
 *
 * 활동 넷이 각자의 줄을 가진다. 예약하면 그 줄 맨 뒤에 서고, 운영자가 "체험 완료"를
 * 누르면 맨 앞이 빠지면서 뒤가 한 칸씩 당겨진다. 앞에 다섯 팀 이하로 남는 순간
 * 한 번만 "부스로 오세요" 안내가 나간다.
 *
 * **줄은 하루 단위다**(2026-09-16). 한국 시각 00시가 지나면 대기번호가 1번부터 다시
 * 시작하고 마감도 풀린다. 날짜가 바뀌는 순간에 무엇을 "지우는" 작업은 없다 — 모든
 * 조회가 "오늘" 기록만 보도록 되어 있어서, 날이 바뀌면 저절로 새 줄이 된다. 타이머에
 * 기대지 않으므로 자정에 서버가 꺼져 있었어도 틀리지 않고, 지난 기록은 파일에 그대로
 * 남아 이름 검색으로 찾을 수 있다.
 *
 * **마감은 운영자가 손으로만 한다**(2026-09-18). 정원이 차서 저절로 닫히는 일은 없다.
 * 마감을 풀면 그 체험존의 줄이 **처음부터 다시 시작한다** — 대기 0팀, 다음 예약이 1번.
 * 날이 바뀌는 것과 같은 방식이다: 해제할 때마다 그날 그 체험존의 "줄 순번"이 하나
 * 올라가고, 모든 조회가 지금 순번의 기록만 본다.
 *
 * 저장은 JSON 파일 하나. 결제 쪽 코드와는 완전히 분리되어 있다.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
/**
 * 기본은 `server/data/`. 배포 플랫폼은 대개 파일 시스템이 휘발성이라 다시 뜨면
 * 줄이 통째로 사라지므로, 붙여 둔 디스크 경로를 `BOOTH_DATA_DIR` 로 넘길 수 있게
 * 열어 둔다(예: Railway 볼륨을 `/data` 에 마운트하고 `BOOTH_DATA_DIR=/data`).
 */
const DATA_DIR = process.env.BOOTH_DATA_DIR || path.join(HERE, "data")
const DATA_FILE = path.join(DATA_DIR, "booth.json")

/** 앞에 몇 팀 남았을 때 부르러 갈지. */
const CALL_AHEAD = 5

/**
 * 접수 문자와 호출 문자 사이의 간격.
 *
 * 줄이 짧을 때 예약하면 두 통이 연달아 나가는데, 같은 초에 통신사로 들어가면
 * 도착 순서가 보장되지 않는다. 접수가 먼저 자리를 잡도록 이만큼 띄운다.
 */
const CALL_DELAY_MS = 6000

/** 마감한 체험존에 들어온 사람에게 보여 줄 말. */
export const CLOSED_MESSAGE = "오늘은 마감되었어요. 내일 다시 만나요."

export const ACTIVITIES = {
  register: { label: "감각등록", title: "보지 않고 물건 맞추기" },
  seek: { label: "감각추구", title: "말랑이 만들기" },
  sensitive: { label: "감각예민", title: "클레이로 아큐 테리 만들기" },
  avoid: { label: "감각회피", title: "나만의 무드등 만들기" },
}

/**
 * 운영 화면 비밀번호.
 *
 * `3618` 은 **개발 편의용 기본값일 뿐 배포 자격증명이 아니다.** 이 값은 문서와
 * 코드에 적혀 있어 저장소를 본 사람은 누구나 안다. 그래서 배포에서는 기본값으로
 * 넘어가지 않고 **아예 잠근다** — 환경변수를 넣지 않으면 운영 화면이 열리지
 * 않는다. 공개 저장소를 그대로 배포했을 때 명단이 통째로 새는 길을 막는 것이
 * 목적이다. 뒤에 예약자 전원의 이름과 전화번호가 있다.
 */
const PROD = process.env.NODE_ENV === "production" || process.argv.includes("--prod")
const DEV_PASSWORD = "3618"
const ADMIN_PASSWORD = String(process.env.BOOTH_ADMIN_PASSWORD ?? "") || (PROD ? "" : DEV_PASSWORD)

if (PROD && !ADMIN_PASSWORD) {
  console.warn(
    "[booth] BOOTH_ADMIN_PASSWORD 가 없다 — 운영 화면을 잠근 채로 뜬다. 환경변수를 넣고 다시 띄울 것."
  )
}

/**
 * 지금 배포된 화면 빌드의 이름(vite.config.js 가 dist/build.json 으로 내놓는다).
 *
 * 배포 전에 열어 둔 탭은 옛 화면 코드를 그대로 돌린다. 휴대폰 사파리는 탭을 며칠씩
 * 살려 두므로 흔한 일이고, 옛 코드는 새 서버와 어긋난다(2026-09-18: 옛 운영 화면의
 * 마감 버튼이 새 서버 앞에서 계속 막혀 "새로고침해야 된다"로 보였다). 응답마다 이
 * 이름을 붙여 보내면 화면이 자기 이름과 비교해 스스로 한 번 새로 불러온다.
 * 개발에서는 비워 둔다 — dist 가 지금 코드와 다를 수 있다.
 */
const BUILD_ID = (() => {
  if (!PROD) return ""
  try {
    return String(JSON.parse(fs.readFileSync(path.join(HERE, "..", "dist", "build.json"), "utf8")).id ?? "")
  } catch {
    return ""
  }
})()

/* -------------------------------------------------------------------- 시계 */

/**
 * 이 파일의 모든 "지금"은 여기서 나온다. `new Date()` 를 따로 부르지 않는다.
 *
 * `BOOTH_CLOCK_OFFSET_MS` 는 **검증용**이다. 자정을 넘기는 동작을 실제로 밤까지
 * 기다리지 않고 확인하려고 서버의 시계를 앞뒤로 민다. 운영에서는 비워 둔다.
 */
const CLOCK_OFFSET = Math.trunc(Number(process.env.BOOTH_CLOCK_OFFSET_MS) || 0)
if (CLOCK_OFFSET) {
  console.warn(`[booth] 시계를 ${CLOCK_OFFSET}ms 밀어서 돈다 — 검증용이다. 운영에서는 비워 둘 것.`)
}
const nowMs = () => Date.now() + CLOCK_OFFSET
const isoAt = (ms) => new Date(ms).toISOString()

/**
 * 한국 날짜(YYYY-MM-DD).
 *
 * **서버 시간대를 믿지 않는다.** Railway 같은 곳의 서버는 UTC 로 돈다. 서버 로컬
 * 날짜를 쓰면 날이 바뀌는 시각이 한국 오전 9시가 되어, 한창 줄을 받는 아침에 대기가
 * 통째로 초기화된다. 한국은 1988년 이후 서머타임이 없으므로 +9시간 고정 계산이
 * 정확하고, 시간대 데이터(ICU)가 빠진 런타임에서도 똑같이 동작한다.
 */
const KST_OFFSET_MS = 9 * 60 * 60 * 1000
const kstDate = (ms) => new Date(ms + KST_OFFSET_MS).toISOString().slice(0, 10)
const today = () => kstDate(nowMs())

/** 예전 기록에는 day 가 없다. 접수 시각에서 한국 날짜를 계산한다. */
const dayOf = (r) => {
  if (typeof r.day === "string" && r.day) return r.day
  const t = Date.parse(r.createdAt)
  return Number.isFinite(t) ? kstDate(t) : ""
}

/* ------------------------------------------------------------------ 저장소 */

/**
 * closed  { [날짜]: { [체험존]: 마감 시각 } }
 * resets  { [날짜]: { [체험존]: [해제(=초기화) 시각, …] } } — 개수가 곧 지금 줄 순번
 */
let state = { reservations: [], closed: {}, resets: {} }

const objectOr = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {})

/**
 * 파일이 없으면 빈 줄로 시작한다. **파일이 깨져 있으면 절대 덮어쓰지 않는다** —
 * 그대로 빈 상태로 시작했다가 다음 저장에서 덮으면 그날 명단이 사라진다. 깨진
 * 파일은 옆에 따로 옮겨 두고 크게 알린다.
 */
function load() {
  let raw
  try {
    raw = fs.readFileSync(DATA_FILE, "utf8")
  } catch (e) {
    if (e.code !== "ENOENT") console.error("[booth] 예약 파일을 읽지 못했다", e.message)
    return
  }
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed?.reservations)) throw new Error("reservations 배열이 없다")
    state = {
      reservations: parsed.reservations,
      closed: objectOr(parsed.closed),
      resets: objectOr(parsed.resets),
    }
  } catch (e) {
    const aside = `${DATA_FILE}.broken-${Date.now()}`
    try {
      fs.copyFileSync(DATA_FILE, aside)
    } catch {
      // 옮기지도 못하면 원본을 건드리지 않은 채로 둔다 — 아래 save 가 덮지 않도록.
    }
    console.error(`[booth] 예약 파일이 깨져 있다(${e.message}). 원본을 ${aside} 로 옮겨 두고 빈 줄로 시작한다.`)
  }
}

/** 임시 파일에 쓰고 바꿔치기한다. 저장 중에 죽어도 반쪽 파일이 남지 않는다. */
function save() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true })
    const tmp = DATA_FILE + ".tmp"
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2))
    fs.renameSync(tmp, DATA_FILE)
  } catch (e) {
    console.error("[booth] 저장 실패", e.message)
  }
}

load()

/* -------------------------------------------------------------------- 도구 */

/** 같은 밀리초에 두 건이 들어와도 순서가 흔들리지 않게 대기번호로 한 번 더 가른다. */
const byQueue = (a, b) => String(a.createdAt).localeCompare(String(b.createdAt)) || (a.teamNo || 0) - (b.teamNo || 0)

/** 그날 그 체험존의 초기화 기록. */
const resetsOn = (activity, day) => {
  const list = state.resets?.[day]?.[activity]
  return Array.isArray(list) ? list : []
}
/** 지금 줄의 순번. 마감 해제 때마다 하나씩 오른다. 한 번도 안 풀었으면 0. */
const roundOn = (activity, day) => resetsOn(activity, day).length
/** 예약이 선 줄의 순번. 이 기능 전의 기록에는 없으므로 0 — 그날 첫 줄이다. */
const roundOfRes = (r) => Math.max(0, Math.floor(Number(r.round) || 0))
const inCurrentRound = (r) => roundOfRes(r) === roundOn(r.activity, dayOf(r))

/** 그날 그 체험존의 **지금 줄**. 초기화 전의 줄은 여기에 들어오지 않는다. */
const zoneOn = (activity, day) => {
  const round = roundOn(activity, day)
  return state.reservations.filter((r) => r.activity === activity && dayOf(r) === day && roundOfRes(r) === round)
}
const waitingOn = (activity, day) => zoneOn(activity, day).filter((r) => r.status === "waiting").sort(byQueue)
const doneOn = (activity, day) => zoneOn(activity, day).filter((r) => r.status === "done").length
/** 운영자가 마감을 눌렀는가. 방문자가 예약할 수 없는 유일한 경우다. */
const closedOn = (activity, day) => Boolean(state.closed?.[day]?.[activity])

/**
 * 지금 줄의 다음 대기번호.
 *
 * 건수 + 1 이 아니라 **가장 큰 번호 + 1** 이다. 예전 방식으로 매긴 번호가 섞여
 * 있어도 같은 줄에서 같은 번호가 두 번 나오지 않는다. 취소된 번호도 다시 쓰지 않는다.
 * 초기화하면 지금 줄이 비므로 다시 1번이다.
 */
const nextTeamNo = (activity, day) => zoneOn(activity, day).reduce((m, r) => Math.max(m, Number(r.teamNo) || 0), 0) + 1

/**
 * 대기로 남아 있어도 지금 줄이 아니면 대기가 아니다.
 *   expired  날이 바뀌었다. 어제 줄에 새 날의 순서를 매기지 않는다.
 *   reset    마감 해제로 줄이 새로 시작됐다. (해제할 때 파일에도 적지만, 여기서 한 번 더 막는다.)
 */
const statusOf = (r) => {
  if (r.status !== "waiting") return r.status
  if (dayOf(r) !== today()) return "expired"
  if (!inCurrentRound(r)) return "reset"
  return "waiting"
}

const aheadOf = (r, wait = waitingOn) => {
  if (statusOf(r) !== "waiting") return null
  const i = wait(r.activity, dayOf(r)).findIndex((x) => x.id === r.id)
  return i < 0 ? null : i
}

/**
 * 한 번의 응답 안에서 같은 줄을 여러 번 계산하지 않게 기억해 둔다. 운영 목록은 예약마다
 * 그 줄을 다시 훑어서 예약이 쌓일수록 제곱으로 느려졌다(1,200건에 800KB·14ms, 2,400건에 36ms).
 */
const memoWaiting = () => {
  const seen = new Map()
  return (activity, day) => {
    const key = `${activity}|${day}`
    if (!seen.has(key)) seen.set(key, waitingOn(activity, day))
    return seen.get(key)
  }
}

const counts = (day = today()) =>
  Object.fromEntries(Object.keys(ACTIVITIES).map((id) => [id, waitingOn(id, day).length]))

/** 방문자 화면이 쓰는 것 — 대기 수와 "오늘 더 받는지"만. */
const publicZones = (day = today()) =>
  Object.fromEntries(
    Object.keys(ACTIVITIES).map((id) => [id, { waiting: waitingOn(id, day).length, shut: closedOn(id, day) }])
  )

/** 운영 화면이 쓰는 것. 숫자는 모두 지금 줄 기준이다. */
const adminZones = (day = today()) =>
  Object.fromEntries(
    Object.keys(ACTIVITIES).map((id) => {
      const closed = closedOn(id, day)
      const resets = resetsOn(id, day)
      return [
        id,
        {
          waiting: waitingOn(id, day).length,
          done: doneOn(id, day),
          closed,
          closedAt: closed ? state.closed[day][id] : null,
          round: resets.length,
          resetAt: resets.at(-1) ?? null,
          // 2026-09-18 이전 화면 코드는 이 값이 참일 때만 마감 버튼을 풀어 준다.
          // 그 코드를 아직 돌리는 탭(배포 전에 열어 둔 것)에서도 마감이 눌리도록 남겨 둔다.
          canClose: !closed,
        },
      ]
    })
  )

/** 번호는 저장하되 밖으로는 뒤 네 자리만 보낸다. */
const maskPhone = (phone) => (String(phone).length > 4 ? "***" + String(phone).slice(-4) : String(phone))

const publicView = (r, wait = waitingOn) => ({
  id: r.id,
  activity: r.activity,
  day: dayOf(r),
  teamNo: r.teamNo,
  status: statusOf(r),
  ahead: aheadOf(r, wait),
  waiting: wait(r.activity, dayOf(r)).length,
  name: r.name,
  phoneMasked: maskPhone(r.phone),
  calledAt: r.calledAt ?? null,
})

/**
 * 운영자가 알아야 할 문자 상태 하나로 줄인다. 화면이 notices 배열을 해석하게 두면
 * 화면마다 해석이 달라진다.
 *   sent     호출 문자가 나갔다
 *   skipped  호출 대상이었지만 문자 발송이 연결돼 있지 않다
 *   failed   호출 문자가 실패했다 — 직접 불러야 한다
 *   pending  아직 호출할 때가 아니다
 */
function callupState(r) {
  const last = [...(r.notices ?? [])].reverse().find((n) => n.kind === "callup")
  if (last?.status === "failed" && (!r.calledAt || !r.callupFailures)) return "failed" // 예전 기록 포함
  if (!r.calledAt && (r.callupFailures ?? 0) > 0) return "failed"
  if (r.calledAt && last?.status === "skipped") return "skipped"
  if (r.calledAt) return "sent" // 보내는 중이면 곧 기록이 붙는다
  return "pending"
}

const adminView = (r, wait = waitingOn) => ({
  ...publicView(r, wait),
  phone: r.phone,
  dept: r.dept,
  createdAt: r.createdAt,
  doneAt: r.doneAt ?? null,
  notices: r.notices ?? [],
  callup: callupState(r),
  callupFailures: r.callupFailures ?? 0,
  round: roundOfRes(r),
  // 오늘의 지금 줄에 속하는가. 운영 화면의 체험존별 목록은 이것만 띄운다 —
  // 초기화 전 줄까지 섞으면 1번이 둘 보인다. 지난 줄은 이름 검색으로 찾는다.
  current: dayOf(r) === today() && inCurrentRound(r),
})

function record(r, kind, result) {
  r.notices = r.notices ?? []
  r.notices.push({ kind, at: isoAt(nowMs()), ...result })
}

/* -------------------------------------------------------- 안내 문구와 발송 */

/**
 * 문구는 **모두 90바이트 안**이어야 한다. 요금 때문만이 아니다.
 *
 * 90바이트를 넘으면 SMS 가 LMS 가 되는데, LMS 에는 **제목(subject)** 이 붙는다.
 * 휴대폰은 그 제목을 본문 위, `[Web발신]` 보다 앞줄에 굵게 띄운다. 게다가 LMS 와
 * SMS 는 통신사에서 다른 경로로 나가 **짧은 SMS 가 긴 LMS 를 추월한다.**
 * 둘 다 SMS 면 경로가 같아 순서가 뒤집히지 않는다.
 *
 * `CALL_AHEAD` 를 바꾸면 접수 문구의 숫자도 함께 따라간다 — 문구와 실제 동작이
 * 어긋나는 것이 가장 나쁘다.
 */
const SMS_LIMIT = 90
const msgBytes = (t) => [...t].reduce((n, c) => n + (c.charCodeAt(0) > 127 ? 2 : 1), 0)

/**
 * 이름을 뒤에서부터 한 글자씩 줄여 90바이트 안에 넣는다. 단체 이름처럼 긴 이름은
 * 입력에서 허용하므로(20자), 문구마다 마지막 방어선이 필요하다.
 */
function fitName(make, name) {
  let chars = [...String(name)]
  let text = make(chars.join(""))
  while (msgBytes(text) > SMS_LIMIT && chars.length > 1) {
    chars = chars.slice(0, -1)
    text = make(chars.join("") + "…")
  }
  return text
}

const bookedText = (r) => {
  const long = (n) => `[작업치료학과 프리지아] ${n}님, ${r.teamNo}번으로 접수되었습니다. ${CALL_AHEAD}팀 남으면 연락드립니다.`
  if (msgBytes(long(r.name)) <= SMS_LIMIT) return long(r.name)
  // 이름이 길면 먼저 학과를 접고, 그래도 넘치면 이름을 줄인다.
  const short = (n) => `[프리지아] ${n}님, ${r.teamNo}번으로 접수되었습니다. ${CALL_AHEAD}팀 남으면 연락드립니다.`
  return fitName(short, r.name)
}

const callUpText = (r, ahead) =>
  fitName(
    (n) =>
      ahead === 0
        ? `${n}님, 지금 입장해주세요. 부스 앞으로 와주세요.`
        : `${n}님, ${ahead}팀 남았습니다. 부스 앞에서 대기해주세요.`,
    r.name
  )

const variablesFor = (r, ahead) => ({
  "#{name}": r.name,
  "#{title}": ACTIVITIES[r.activity].title,
  "#{teamNo}": String(r.teamNo),
  "#{ahead}": String(ahead),
})

/**
 * 호출 문자를 보내도 되는 때가 됐는가.
 *
 * **접수 문자가 나간 지 CALL_DELAY_MS 가 지나야 한다.** 예약 직후 6초 안에 다른
 * 팀의 체험 완료가 눌리면, 예전에는 이 사람이 곧바로 호출 대상이 되어 호출이
 * 접수보다 먼저 도착할 수 있었다(검토에서 재현됨). 기준은 접수 문자를 **보낸
 * 뒤** 남긴 기록의 시각이다 — 접수 발송을 기다리는 동안에는 대상이 아니다.
 *
 * 접수 기록이 아예 없는데 한참 지났다면(접수 발송 중에 서버가 죽은 경우) 더
 * 기다리지 않는다. 그렇지 않으면 그 사람은 영영 불리지 않는다.
 */
const READY_SLACK_MS = 200
const ORPHAN_AFTER_MS = 60_000
function readyForCallup(r, now) {
  const booked = (r.notices ?? []).find((n) => n.kind === "booked")
  if (booked) return Date.parse(booked.at) + CALL_DELAY_MS - READY_SLACK_MS <= now
  return Date.parse(r.createdAt) + ORPHAN_AFTER_MS <= now
}

/** 호출 발송이 실패하면 몇 번까지 다시 해 볼지. 설정 문제라면 더 두드려도 소용없다. */
const MAX_CALLUP_TRIES = 3
/**
 * 실패한 뒤 다시 보내기까지 최소 간격. 이게 없으면 서버 시작 점검과 예약 타이머가
 * 몇백 ms 차이로 겹칠 때 세 번의 기회를 1초 안에 다 써 버린다.
 */
const RETRY_GAP_MS = 8000
const retryDue = (r, now) => !r.lastCallupFailAt || Date.parse(r.lastCallupFailAt) + RETRY_GAP_MS <= now

/**
 * 줄이 줄어든 뒤 부를 사람을 부른다. 앞이 다섯 팀 이하로 남았고 아직 부르지
 * 않은 사람 전부 — 완료가 몰아서 눌리면 순서를 건너뛸 수 있어서, 정확히 5 가
 * 아니라 5 이하를 본다.
 *
 * 지키는 것:
 * - **오늘 줄만.** 자정 직전에 걸어 둔 타이머가 자정 뒤에 돌아도, 이미 만료된
 *   어제 예약에 "지금 입장해주세요"를 보내지 않는다.
 * - **한 사람에게 한 번.** 보내기 전에 대상 전원에게 `calledAt` 을 먼저 찍는다.
 *   발송을 기다리는 사이에 이 함수가 또 돌아도 같은 사람을 두 번 부르지 않는다.
 * - **보내기 직전에 다시 확인.** 여러 통을 차례로 보내는 사이에 누가 취소되거나
 *   앞 팀이 빠질 수 있다. 줄에서 빠졌으면 건너뛰고, 남은 팀 수는 그 순간 값으로 쓴다.
 * - **실패하면 표시를 거둔다.** 호출이 실패했는데 "호출함"으로 남으면 운영자는
 *   불렀다고 믿는다. 표시를 지우고 실패 횟수를 세어 다음 기회에 다시 보낸다.
 */
async function callUpOnce(activity, day) {
  if (day !== today()) return 0
  const now = nowMs()
  const due = waitingOn(activity, day)
    .map((r, ahead) => ({ r, ahead }))
    .filter(
      ({ r, ahead }) =>
        ahead <= CALL_AHEAD &&
        !r.calledAt &&
        (r.callupFailures ?? 0) < MAX_CALLUP_TRIES &&
        retryDue(r, now) &&
        readyForCallup(r, now)
    )
  if (!due.length) return 0

  const claimed = isoAt(now)
  for (const { r } of due) r.calledAt = claimed
  save()

  let sent = 0
  for (const { r } of due) {
    const ahead = aheadOf(r)
    if (statusOf(r) !== "waiting" || ahead === null || ahead > CALL_AHEAD) {
      r.calledAt = null
      continue
    }
    const result = await sendMessage({
      to: r.phone,
      text: callUpText(r, ahead),
      kind: "callup",
      variables: variablesFor(r, ahead),
    })
    record(r, "callup", result)
    if (result.status === "failed") {
      r.calledAt = null
      r.callupFailures = (r.callupFailures ?? 0) + 1
      r.lastCallupFailAt = isoAt(nowMs())
    } else {
      sent++
    }
  }
  save()
  changed()
  return sent
}

/**
 * 같은 체험존의 호출은 한 줄로 세워 차례로 돈다. 겹쳐 돌면 문자 순서가 섞이고,
 * 한쪽이 확인하는 사이에 다른 쪽이 상태를 바꾼다.
 */
const callUpChains = new Map()
function callUpDue(activity, day = today()) {
  const prev = callUpChains.get(activity) ?? Promise.resolve()
  const next = prev
    .catch(() => 0)
    .then(() => callUpOnce(activity, day))
    .catch((e) => {
      console.error("[booth] 호출 처리 실패", e.message)
      return 0
    })
  callUpChains.set(activity, next)
  return next
}

/**
 * 정기 점검. 호출이 사건(예약·완료·취소)에만 기대면 빠지는 경우가 있다 —
 * 예약 6초 안에 서버가 다시 뜨면 그 사람의 타이머가 사라지고, 실패한 호출은
 * 다음 사건이 올 때까지 다시 시도되지 않는다. 몇 초마다 오늘 줄을 훑어
 * 보낼 때가 된 사람을 부른다. 위 규칙을 그대로 따르므로 중복은 생기지 않는다.
 */
const SWEEP_MS = 10_000
function sweep() {
  for (const activity of Object.keys(ACTIVITIES)) callUpDue(activity)
}
setTimeout(sweep, CALL_DELAY_MS).unref?.()
setInterval(sweep, SWEEP_MS).unref?.()

/* ------------------------------------------------------------------ 유효성 */

// 부르려고 받는 이름이라 "홍길동 외 2명" 같은 것도 그대로 통과시킨다.
// 막는 것은 빈칸과 기호 도배뿐이다.
const NAME_RE = /^[가-힣a-zA-Z0-9][가-힣a-zA-Z0-9\s.()·-]{0,19}$/
const PHONE_RE = /^01[016789]\d{7,8}$/

const activityOf = (body) => {
  const activity = String(body?.activity ?? "")
  return Object.hasOwn(ACTIVITIES, activity) ? activity : ""
}

function validate(body) {
  const activity = activityOf(body)
  if (!activity) return { error: "UNKNOWN_ACTIVITY", message: "활동을 찾을 수 없습니다." }

  const name = String(body?.name ?? "").trim()
  if (!NAME_RE.test(name)) return { error: "BAD_NAME", message: "이름을 확인해 주세요." }

  const phone = String(body?.phone ?? "").replace(/\D/g, "")
  if (!PHONE_RE.test(phone)) return { error: "BAD_PHONE", message: "휴대폰 번호를 확인해 주세요. (예: 010-1234-5678)" }

  const dept = String(body?.dept ?? "").trim()
  if (dept.length < 1 || dept.length > 30) return { error: "BAD_DEPT", message: "학과를 확인해 주세요." }

  return { value: { activity, name, phone, dept } }
}

/**
 * 스크립트로 줄을 도배하는 것만 막는다.
 *
 * 학교 와이파이나 통신사 NAT 뒤에서는 **방문자 전부가 같은 IP 로 보인다**. 수업이
 * 끝나고 한 반이 한꺼번에 QR 을 찍으면 1분에 수십 건이 한 IP 에서 온다. 여기를
 * 조이면 진짜 손님이 먼저 막히므로 넉넉히 둔다(전에는 20 이라 그런 상황에서 막혔다).
 * 줄을 더 받지 않을 때는 운영자가 마감을 누른다.
 */
const RATE_PER_MIN = Math.max(1, Math.floor(Number(process.env.BOOTH_RATE_PER_MIN) || 60))
const hits = new Map()
function tooMany(ip) {
  const now = Date.now()
  const list = (hits.get(ip) ?? []).filter((t) => now - t < 60_000)
  list.push(now)
  hits.set(ip, list)
  return list.length > RATE_PER_MIN
}

const requireAdmin = (req, res, next) => {
  if (!ADMIN_PASSWORD) {
    return res.status(503).json({
      error: "NO_PASSWORD_SET",
      message: "운영 화면이 잠겨 있습니다. 배포 환경변수에 BOOTH_ADMIN_PASSWORD 를 넣어 주세요.",
    })
  }
  if (String(req.body?.password ?? "") !== ADMIN_PASSWORD) {
    return res.status(401).json({ error: "BAD_PASSWORD", message: "비밀번호가 다릅니다." })
  }
  next()
}

/* ------------------------------------------------------------------- 라우트 */

const router = express.Router()

/**
 * 대기 현황은 매 순간 바뀐다. 브라우저·통신사 프록시·앱 안 웹뷰 어디에도 담아 두지
 * 말라고 못 박는다. 운영자 응답에는 이름과 전화번호가 있어서 더더욱 남으면 안 된다.
 */
router.use((req, res, next) => {
  res.set("Cache-Control", "no-store")
  if (BUILD_ID) res.set("X-Build", BUILD_ID)
  next()
})

/* ---------------------------------------------------------- 바뀜 알림(SSE) */

/**
 * 누가 예약하거나, 운영자가 완료·취소·마감·마감해제를 누르면 열려 있는 화면
 * 전부에게 "바뀌었다"고 바로 알린다. 화면은 그 말을 듣고 자기 것을 다시 물어본다.
 *
 * 전에는 화면이 15초마다 묻기만 해서, 마감을 눌러도 다른 휴대폰에는 최대 15초 뒤에야
 * 보였다. 휴대폰 사파리는 탭을 옮기거나 화면을 켤 때 그 주기를 더 늦춰서, 보는
 * 사람에게는 "새로고침을 해야 된다"로 보였다.
 *
 * 알림에는 **번호 하나뿐**이다. 이름·번호 같은 것은 절대 싣지 않는다 — 누구나 받을
 * 수 있는 통로다. 짧은 사이에 몰리면 한 번으로 묶는다. 끊겨도 화면이 원래대로
 * 주기적으로 물어보므로 틀린 상태로 남지 않는다. 늦어질 뿐이다.
 */
const MAX_STREAMS = 3000
const HEARTBEAT_MS = 20_000
const COALESCE_MS = 120
const streams = new Set()
let rev = 0
let pendingBroadcast = null

function changed() {
  rev++
  if (pendingBroadcast) return
  pendingBroadcast = setTimeout(() => {
    pendingBroadcast = null
    const line = `data: ${JSON.stringify({ v: rev })}\n\n`
    for (const res of streams) {
      if (res.writableEnded || res.destroyed) streams.delete(res)
      else res.write(line)
    }
  }, COALESCE_MS)
  pendingBroadcast.unref?.()
}

// 아무 일이 없어도 가끔 한 줄 보낸다. 중간의 프록시가 조용한 연결을 끊지 않도록.
setInterval(() => {
  for (const res of streams) {
    if (res.writableEnded || res.destroyed) streams.delete(res)
    else res.write(": ping\n\n")
  }
}, HEARTBEAT_MS).unref?.()

/** 한국 00시에도 한 번 알린다. 날이 바뀌면 줄이 비고 마감이 풀린다. */
function scheduleMidnight() {
  const DAY_MS = 24 * 60 * 60 * 1000
  const now = nowMs()
  const next = Math.floor((now + KST_OFFSET_MS) / DAY_MS) * DAY_MS + DAY_MS - KST_OFFSET_MS
  setTimeout(() => {
    changed()
    scheduleMidnight()
  }, next - now + 1000).unref?.()
}
scheduleMidnight()

router.get("/events", (req, res) => {
  // Express 는 GET 경로로 HEAD 도 받는다. HEAD 를 스트림으로 붙잡으면 응답이 끝나지 않아
  // 그 연결로 오는 다음 요청(마감·예약)이 처리는 되는데 답이 돌아가지 않는다.
  if (req.method !== "GET") return res.status(405).set("Allow", "GET").end()
  if (streams.size >= MAX_STREAMS) {
    // 화면은 알림 없이 주기적으로 묻는 쪽으로 돌아간다.
    return res.status(503).json({ error: "BUSY", message: "잠시 후 다시 연결합니다." })
  }
  res.status(200)
  res.set({
    "Content-Type": "text/event-stream; charset=utf-8",
    Connection: "keep-alive",
    // 중간 프록시가 모아 두었다가 한꺼번에 보내지 않도록
    "X-Accel-Buffering": "no",
  })
  res.flushHeaders()
  res.write("retry: 3000\n\n")
  // 새로 이어질 때마다 화면이 한 번 다시 묻는다 — 끊겨 있던 사이 바뀐 것을 따라잡는다.
  res.write(`event: hello\ndata: ${JSON.stringify({ v: rev, build: BUILD_ID })}\n\n`)
  streams.add(res)
  const drop = () => streams.delete(res)
  req.on("close", drop)
  res.on("close", drop)
  res.on("error", drop)
})

/** 대기 팀 수와 오늘 받는지. 예약 id 를 함께 주면 그 예약의 현재 순서까지 돌려준다. */
router.get("/queue", (req, res) => {
  const day = today()
  const id = req.query.id ? String(req.query.id) : ""
  const mine = id ? state.reservations.find((r) => r.id === id) : null
  res.json({
    today: day,
    callAhead: CALL_AHEAD,
    closedMessage: CLOSED_MESSAGE,
    counts: counts(day),
    zones: publicZones(day),
    mine: mine ? publicView(mine) : null,
  })
})

router.post("/reservations", async (req, res) => {
  if (tooMany(req.ip)) {
    return res.status(429).json({ error: "TOO_MANY", message: "잠시 후 다시 시도해 주세요." })
  }

  const { value, error, message } = validate(req.body)
  if (error) return res.status(400).json({ error, message })

  // 이 요청의 "오늘"은 여기서 한 번만 정한다. 검사하는 사이에 자정이 지나도
  // 검사한 날과 기록하는 날이 어긋나지 않는다.
  const t = nowMs()
  const day = kstDate(t)

  // 이미 줄에 서 있는 사람에게는 마감 안내보다 자기 순서를 먼저 보여 준다.
  const already = waitingOn(value.activity, day).find((r) => r.phone === value.phone)
  if (already) {
    return res.status(409).json({
      error: "ALREADY_BOOKED",
      message: "이미 이 체험을 예약하셨습니다.",
      reservation: publicView(already),
    })
  }

  // 마감 검사와 기록 사이에 await 가 없다. 노드는 한 번에 한 요청만 이 구간을
  // 지나므로, 마감이 눌린 뒤에 들어온 예약이 끼어들 틈이 없다.
  if (closedOn(value.activity, day)) {
    return res.status(409).json({ error: "CLOSED", message: CLOSED_MESSAGE, reason: "closed" })
  }

  const reservation = {
    id: crypto.randomBytes(6).toString("hex"),
    ...value,
    day,
    round: roundOn(value.activity, day),
    teamNo: nextTeamNo(value.activity, day),
    status: "waiting",
    createdAt: isoAt(t),
    calledAt: null,
    notices: [],
  }
  state.reservations.push(reservation)

  const ahead = aheadOf(reservation)
  save()
  changed()

  // 1) 접수 확인. 이 문자는 "받았습니다"만 말한다.
  const result = await sendMessage({
    to: reservation.phone,
    text: bookedText(reservation),
    kind: "booked",
    variables: variablesFor(reservation, ahead ?? 0),
  })
  record(reservation, "booked", result)
  save()

  res.json({ reservation: publicView(reservation), notice: { status: result.status, channel: result.channel } })

  // 2) 줄이 짧아서 이미 부를 때가 됐으면 **따로 한 통 더.** 붙여 보내면
  //    "접수됐습니다"인지 "지금 오세요"인지 읽는 사람이 구분하지 못한다.
  //    곧바로 쏘면 두 통이 같은 초에 통신사로 들어가 순서가 뒤집힌다 —
  //    응답을 먼저 돌려주고, 접수 문자가 자리를 잡을 만큼 띄운 뒤에 보낸다.
  if (ahead !== null && ahead <= CALL_AHEAD) {
    setTimeout(() => {
      callUpDue(reservation.activity, day).catch((e) => console.error("[booth] 호출 발송 실패", e.message))
    }, CALL_DELAY_MS)
  }
})

router.post("/admin/list", requireAdmin, (req, res) => {
  const day = today()
  // 검색은 지난날 기록까지 찾아야 하므로 전부 보낸다. 날짜별 묶음은 화면이 나눈다.
  const rows = [...state.reservations].sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
  const wait = memoWaiting()
  res.json({
    today: day,
    closedMessage: CLOSED_MESSAGE,
    counts: counts(day),
    zones: adminZones(day),
    activities: ACTIVITIES,
    notify: { ...notifyStatus(), lastError: lastNotifyError() },
    reservations: rows.map((r) => adminView(r, wait)),
  })
})

/** 체험존 넷의 상태만. 마감 버튼 판이 쓴다 — 명단(이름·번호)을 매번 실어 보내지 않는다. */
router.post("/admin/zones", requireAdmin, (req, res) => {
  const day = today()
  res.json({ today: day, activities: ACTIVITIES, zones: adminZones(day) })
})

/**
 * 마감·해제는 **이 화면 이름(X-Client-Build)을 싣는 화면에서만** 받는다.
 *
 * 2026-09-18 이전 화면은 해제를 되묻지 않았다. 그때는 해제가 "마감 취소"일 뿐이었지만
 * 지금은 줄을 비운다. 그 화면이 아직 열려 있는 휴대폰에서 해제를 누르면 기다리던 팀이
 * 아무 경고 없이 사라진다. 옛 화면에는 "새로고침해 주세요"를 돌려준다 — 새 화면은
 * 이 이름을 항상 싣는다.
 */
const RELOAD = { error: "RELOAD", message: "화면이 예전 것입니다. 새로고침한 뒤 다시 눌러 주세요." }
const fromCurrentScreen = (req) => Boolean(req.get("X-Client-Build"))

/** 줄에서 빼는 두 동작(완료·취소)의 공통 부분. 오늘 대기 중인 예약만 받는다. */
function closeOne(req, res, status) {
  const r = state.reservations.find((x) => x.id === String(req.body?.id ?? ""))
  if (!r) return res.status(404).json({ error: "UNKNOWN_RESERVATION", message: "예약을 찾을 수 없습니다." })
  if (statusOf(r) !== "waiting") {
    return res.status(409).json({ error: "ALREADY_CLOSED", message: "이미 끝났거나 지난날의 예약입니다." })
  }

  r.status = status
  r.doneAt = isoAt(nowMs())
  save()
  changed()

  // 응답을 먼저 돌려준다. 호출 문자는 체험존마다 한 줄로 서서 차례로 나가므로,
  // 기다리면 여러 통을 보내는 중일 때 운영자의 버튼이 몇 초씩 멈춘다.
  // 상태는 위에서 이미 바뀌었으니, 뒤에서 도는 호출도 새 줄 기준으로 계산한다.
  callUpDue(r.activity, dayOf(r))
  res.json({ ok: true, counts: counts(), zones: adminZones() })
}

router.post("/admin/complete", requireAdmin, (req, res) => closeOne(req, res, "done"))

/** 안 온 팀을 빼는 자리. 이게 없으면 노쇼 하나가 줄을 영원히 막는다. 자리는 다른 팀에게 돌아간다. */
router.post("/admin/cancel", requireAdmin, (req, res) => closeOne(req, res, "cancelled"))

/**
 * 이 체험존 마감 — 새 예약을 받지 않는다.
 *
 * 이미 줄에 선 팀은 그대로다. 순서를 계속 보고, 호출 문자도 그대로 받고, 운영자는
 * 체험 완료를 계속 누른다. 막는 것은 새로 들어오는 예약뿐이다.
 * 자정이 지나면 날짜가 바뀌어 마감도 저절로 풀린다.
 */
router.post("/admin/close", requireAdmin, (req, res) => {
  const activity = activityOf(req.body)
  if (!activity) return res.status(400).json({ error: "UNKNOWN_ACTIVITY", message: "활동을 찾을 수 없습니다." })
  if (!fromCurrentScreen(req)) return res.status(409).json(RELOAD)

  const day = today()
  if (!closedOn(activity, day)) {
    state.closed[day] = { ...(state.closed[day] ?? {}), [activity]: isoAt(nowMs()) }
    save()
    changed()
  }
  res.json({ ok: true, zones: adminZones(day) })
})

/**
 * 마감 해제 — 이 체험존의 줄을 **처음부터 다시 시작한다.**
 *
 * 대기 0팀, 다음 예약이 1번. 아직 대기로 남아 있던 팀은 줄에서 빠진다(상태 `reset`).
 * 번호를 1번부터 다시 주면서 옛 대기를 남겨 두면 같은 번호가 둘이 되기 때문이다.
 * 기록은 지우지 않는다 — 이름 검색으로 "초기화"라고 찾힌다.
 *
 * **마감된 체험존에만** 한다. 해제 버튼이 두 번 눌리거나 오래된 화면에서 요청이
 * 늦게 오면, 그 사이 새로 선 줄을 또 지워 버린다. 그래서 마감 상태가 아니면 아무것도
 * 하지 않는다 — 한 번의 마감에 초기화는 한 번뿐이다.
 */
router.post("/admin/reopen", requireAdmin, (req, res) => {
  const activity = activityOf(req.body)
  if (!activity) return res.status(400).json({ error: "UNKNOWN_ACTIVITY", message: "활동을 찾을 수 없습니다." })

  if (!fromCurrentScreen(req)) return res.status(409).json(RELOAD)

  const day = today()
  if (!closedOn(activity, day)) return res.json({ ok: true, reset: false, dropped: 0, zones: adminZones(day) })

  const left = waitingOn(activity, day)
  // 줄을 비우는 것은 "대기 N팀이 빠집니다"를 확인받은 요청만. 화면이 확인 창을 띄운 뒤 싣는다.
  if (left.length && req.body?.reset !== true) {
    return res.status(409).json({
      error: "CONFIRM_RESET",
      message: `대기 중인 ${left.length}팀이 줄에서 빠집니다. 새로고침한 뒤 다시 눌러 확인해 주세요.`,
      waiting: left.length,
    })
  }
  const at = isoAt(nowMs())
  for (const r of left) {
    r.status = "reset"
    r.doneAt = at
  }
  const rest = { ...state.closed[day] }
  delete rest[activity]
  state.closed[day] = rest
  state.resets[day] = { ...(state.resets[day] ?? {}), [activity]: [...resetsOn(activity, day), at] }
  save()
  changed()
  res.json({ ok: true, reset: true, dropped: left.length, zones: adminZones(day) })
})

/** 행사 전에 문자가 실제로 나가는지 확인하는 자리. */
router.post("/admin/test", requireAdmin, async (req, res) => {
  const phone = String(req.body?.phone ?? "").replace(/\D/g, "")
  if (!PHONE_RE.test(phone)) return res.status(400).json({ error: "BAD_PHONE", message: "번호를 확인해 주세요." })
  const result = await sendMessage({
    to: phone,
    text: "[프리지아] 발송 테스트입니다. 이 문자가 보이면 예약 안내도 나갑니다.",
    kind: "booked",
    variables: {},
  })
  res.json({ result })
})

export default router
