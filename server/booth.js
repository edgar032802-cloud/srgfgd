import crypto from "node:crypto"
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import express from "express"

import { sendMessage, notifyStatus } from "./notify.js"

/**
 * 부스 체험 예약 대기열.
 *
 * 활동 넷이 각자의 줄을 가진다. 예약하면 그 줄 맨 뒤에 서고, 운영자가 "체험 완료"를
 * 누르면 맨 앞이 빠지면서 뒤가 한 칸씩 당겨진다. 앞에 다섯 팀 이하로 남는 순간
 * 한 번만 "부스로 오세요" 안내가 나간다.
 *
 * 저장은 JSON 파일 하나. 행사 하루짜리 줄이라 데이터베이스를 세울 이유가 없고,
 * 파일이면 행사가 끝난 뒤 지우기도 쉽다(개인정보가 들어 있으니 지워야 한다).
 * 결제 쪽 코드와는 완전히 분리되어 있다 — 이 파일은 그쪽을 건드리지 않는다.
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

/* ------------------------------------------------------------------ 저장소 */

let state = { reservations: [] }

function load() {
  try {
    const raw = fs.readFileSync(DATA_FILE, "utf8")
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed?.reservations)) state = parsed
  } catch {
    // 파일이 아직 없다 — 빈 줄로 시작한다.
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

const waitingOf = (activity) =>
  state.reservations
    .filter((r) => r.activity === activity && r.status === "waiting")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))

const aheadOf = (reservation) => {
  const q = waitingOf(reservation.activity)
  const i = q.findIndex((r) => r.id === reservation.id)
  return i < 0 ? null : i
}

const counts = () =>
  Object.fromEntries(Object.keys(ACTIVITIES).map((id) => [id, waitingOf(id).length]))

/** 번호는 저장하되 밖으로는 뒤 네 자리만 보낸다. */
const maskPhone = (phone) => (phone.length > 4 ? "***" + phone.slice(-4) : phone)

const publicView = (r) => ({
  id: r.id,
  activity: r.activity,
  teamNo: r.teamNo,
  status: r.status,
  ahead: r.status === "waiting" ? aheadOf(r) : null,
  waiting: waitingOf(r.activity).length,
  name: r.name,
  phoneMasked: maskPhone(r.phone),
  calledAt: r.calledAt ?? null,
})

const adminView = (r) => ({
  ...publicView(r),
  phone: r.phone,
  dept: r.dept,
  createdAt: r.createdAt,
  doneAt: r.doneAt ?? null,
  notices: r.notices ?? [],
})

function record(r, kind, result) {
  r.notices = r.notices ?? []
  r.notices.push({ kind, at: new Date().toISOString(), ...result })
}

/* -------------------------------------------------------- 안내 문구와 발송 */

/**
 * 문구는 **모두 90바이트 안**이어야 한다. 요금 때문만이 아니다.
 *
 * 90바이트를 넘으면 SMS 가 LMS 가 되는데, LMS 에는 **제목(subject)** 이 붙는다.
 * 휴대폰은 그 제목을 본문 위, `[Web발신]` 보다 앞줄에 굵게 띄운다 — 사용자가
 * "web발신 앞에 제목 나온다"고 한 것이 이것이다. SMS 에는 제목 칸 자체가 없다.
 * 게다가 LMS 와 SMS 는 통신사에서 다른 경로로 나가 **짧은 SMS 가 긴 LMS 를
 * 추월한다.** 접수(LMS)와 호출(SMS)을 함께 보냈더니 "지금 입장해주세요"가
 * 먼저 도착한 것이 그래서다. 둘 다 SMS 면 경로가 같아 순서가 뒤집히지 않는다.
 *
 * 그래서 접수 문구에서 "대기 현황은 예약 화면에서..." 한 문장을 덜어 냈다.
 * 되살리면 140바이트가 되어 제목 줄과 순서 뒤바뀜이 함께 돌아온다.
 *
 * `CALL_AHEAD` 를 바꾸면 접수 문구의 숫자도 함께 따라간다 — 문구와 실제 동작이
 * 어긋나는 것이 가장 나쁘다.
 */
const SMS_LIMIT = 90
const msgBytes = (t) => [...t].reduce((n, c) => n + (c.charCodeAt(0) > 127 ? 2 : 1), 0)

const bookedText = (r) => {
  const full = `[작업치료학과 프리지아] ${r.name}님, ${r.teamNo}번으로 접수되었습니다. ${CALL_AHEAD}팀 남으면 연락드립니다.`
  if (msgBytes(full) <= SMS_LIMIT) return full
  // 이름이 유난히 길면(단체 이름 등) 학과를 접는다. 제목 줄이 붙는 LMS 로
  // 넘어가는 것보다 이쪽이 낫다.
  return `[프리지아] ${r.name}님, ${r.teamNo}번으로 접수되었습니다. ${CALL_AHEAD}팀 남으면 연락드립니다.`
}

const callUpText = (r, ahead) =>
  ahead === 0
    ? `${r.name}님, 지금 입장해주세요. 부스 앞으로 와주세요.`
    : `${r.name}님, ${ahead}팀 남았습니다. 부스 앞에서 대기해주세요.`

const variablesFor = (r, ahead) => ({
  "#{name}": r.name,
  "#{title}": ACTIVITIES[r.activity].title,
  "#{teamNo}": String(r.teamNo),
  "#{ahead}": String(ahead),
})

/**
 * 줄이 줄어든 뒤 부를 사람을 부른다. 앞이 다섯 팀 이하로 남았고 아직 부르지
 * 않은 사람 전부 — 완료가 몰아서 눌리면 순서를 건너뛸 수 있어서, 정확히 5 가
 * 아니라 5 이하를 본다. `calledAt` 이 있으면 두 번 부르지 않는다.
 */
async function callUpDue(activity) {
  const due = waitingOf(activity)
    .map((r, ahead) => ({ r, ahead }))
    .filter(({ r, ahead }) => ahead <= CALL_AHEAD && !r.calledAt)

  for (const { r, ahead } of due) {
    r.calledAt = new Date().toISOString()
    const result = await sendMessage({
      to: r.phone,
      text: callUpText(r, ahead),
      kind: "callup",
      variables: variablesFor(r, ahead),
    })
    record(r, "callup", result)
  }
  if (due.length) save()
  return due.length
}

/* ------------------------------------------------------------------ 유효성 */

// 부르려고 받는 이름이라 "홍길동 외 2명" 같은 것도 그대로 통과시킨다.
// 막는 것은 빈칸과 기호 도배뿐이다.
const NAME_RE = /^[가-힣a-zA-Z0-9][가-힣a-zA-Z0-9\s.()·-]{0,19}$/
const PHONE_RE = /^01[016789]\d{7,8}$/

function validate(body) {
  const activity = String(body?.activity ?? "")
  if (!ACTIVITIES[activity]) return { error: "UNKNOWN_ACTIVITY", message: "활동을 찾을 수 없습니다." }

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
 * 학교 와이파이나 통신사 NAT 뒤에서는 **방문자 전부가 같은 IP 로 보인다**.
 * 여기를 조이면 진짜 손님이 먼저 막히므로 한도를 넉넉히 둔다. 같은 번호로 같은
 * 활동을 두 번 잡는 것은 아래 중복 검사가 따로 막고, 장난 예약은 운영 화면에서
 * 취소하면 된다.
 */
const hits = new Map()
function tooMany(ip) {
  const now = Date.now()
  const list = (hits.get(ip) ?? []).filter((t) => now - t < 60_000)
  list.push(now)
  hits.set(ip, list)
  return list.length > 20
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

/** 대기 팀 수. 예약 id 를 함께 주면 그 예약의 현재 순서까지 돌려준다. */
router.get("/queue", (req, res) => {
  const id = req.query.id ? String(req.query.id) : ""
  const mine = id ? state.reservations.find((r) => r.id === id) : null
  res.json({ counts: counts(), callAhead: CALL_AHEAD, mine: mine ? publicView(mine) : null })
})

router.post("/reservations", async (req, res) => {
  if (tooMany(req.ip)) {
    return res.status(429).json({ error: "TOO_MANY", message: "잠시 후 다시 시도해 주세요." })
  }

  const { value, error, message } = validate(req.body)
  if (error) return res.status(400).json({ error, message })

  const already = waitingOf(value.activity).find((r) => r.phone === value.phone)
  if (already) {
    return res.status(409).json({
      error: "ALREADY_BOOKED",
      message: "이미 이 체험을 예약하셨습니다.",
      reservation: publicView(already),
    })
  }

  const reservation = {
    id: crypto.randomBytes(5).toString("hex"),
    ...value,
    // 그날 그 활동의 몇 번째 팀인지. 완료된 팀도 세므로 번호가 되돌아오지 않는다.
    teamNo: state.reservations.filter((r) => r.activity === value.activity).length + 1,
    status: "waiting",
    createdAt: new Date().toISOString(),
    calledAt: null,
    notices: [],
  }
  state.reservations.push(reservation)

  const ahead = aheadOf(reservation)
  save()

  // 1) 접수 확인. 이 문자는 "받았습니다"만 말한다.
  const result = await sendMessage({
    to: reservation.phone,
    text: bookedText(reservation),
    kind: "booked",
    variables: variablesFor(reservation, ahead),
  })
  record(reservation, "booked", result)
  save()

  res.json({ reservation: publicView(reservation), notice: { status: result.status, channel: result.channel } })

  // 2) 줄이 짧아서 이미 부를 때가 됐으면 **따로 한 통 더.** 붙여 보내면
  //    "접수됐습니다"인지 "지금 오세요"인지 읽는 사람이 구분하지 못한다.
  //    다만 곧바로 쏘면 두 통이 같은 초에 통신사로 들어가 순서가 뒤집힌다 —
  //    실제로 "지금 입장해주세요"가 먼저 도착했다. 응답을 먼저 돌려주고,
  //    접수 문자가 자리를 잡을 만큼 띄운 뒤에 보낸다.
  if (ahead <= CALL_AHEAD) {
    setTimeout(() => {
      callUpDue(reservation.activity).catch((e) => console.error("[booth] 호출 발송 실패", e.message))
    }, CALL_DELAY_MS)
  }
})

router.post("/admin/list", requireAdmin, (req, res) => {
  const rows = [...state.reservations].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  res.json({
    counts: counts(),
    activities: ACTIVITIES,
    notify: notifyStatus(),
    reservations: rows.map(adminView),
  })
})

router.post("/admin/complete", requireAdmin, async (req, res) => {
  const r = state.reservations.find((x) => x.id === String(req.body?.id ?? ""))
  if (!r) return res.status(404).json({ error: "UNKNOWN_RESERVATION" })
  if (r.status !== "waiting") return res.status(409).json({ error: "ALREADY_CLOSED" })

  r.status = "done"
  r.doneAt = new Date().toISOString()
  save()

  const called = await callUpDue(r.activity)
  res.json({ ok: true, counts: counts(), called })
})

/** 안 온 팀을 빼는 자리. 이게 없으면 노쇼 하나가 줄을 영원히 막는다. */
router.post("/admin/cancel", requireAdmin, async (req, res) => {
  const r = state.reservations.find((x) => x.id === String(req.body?.id ?? ""))
  if (!r) return res.status(404).json({ error: "UNKNOWN_RESERVATION" })
  if (r.status !== "waiting") return res.status(409).json({ error: "ALREADY_CLOSED" })

  r.status = "cancelled"
  r.doneAt = new Date().toISOString()
  save()

  const called = await callUpDue(r.activity)
  res.json({ ok: true, counts: counts(), called })
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
