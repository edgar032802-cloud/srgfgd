import { CLIENT_BUILD, checkBuild } from "./build.js"

/** 읽기 요청이 이보다 오래 걸리면 버린다. 매달린 요청 하나가 화면을 붙잡지 않게. */
const READ_TIMEOUT_MS = 10000

async function json(response) {
  checkBuild(response.headers.get("X-Build"))
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const err = new Error(data.message ?? data.error ?? `HTTP ${response.status}`)
    err.code = data.error
    err.data = data
    throw err
  }
  return data
}

/**
 * `timeout` 은 **읽기에만** 준다. 예약·마감 같은 쓰기는 서버가 문자를 보내느라 몇 초
 * 걸릴 수 있고, 중간에 끊으면 서버에서는 됐는데 화면은 실패로 안다.
 */
function request(path, init = {}, timeout = 0) {
  const ctrl = timeout ? new AbortController() : null
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeout) : 0
  // 이 화면의 빌드 이름을 싣는다. 서버는 이것이 없는 옛 화면의 마감·해제를 "새로고침해
  // 주세요"로 거절한다 — 옛 화면의 해제 버튼은 되묻지 않고 줄을 비워 버린다.
  const headers = { ...(init.headers ?? {}), "X-Client-Build": CLIENT_BUILD }
  return fetch(path, { cache: "no-store", ...init, headers, signal: ctrl?.signal })
    .catch((e) => {
      // 브라우저마다 영어("Load failed", "signal is aborted")로 떨어진다. 화면에 뜨는 말로 바꾼다.
      const err = new Error(
        e?.name === "AbortError" ? "응답이 늦습니다. 잠시 후 다시 시도해 주세요." : "연결이 끊겼습니다. 잠시 후 다시 시도해 주세요."
      )
      err.code = e?.name === "AbortError" ? "TIMEOUT" : "NETWORK"
      throw err
    })
    .then(json)
    .finally(() => clearTimeout(timer))
}

const post = (path, body, timeout) =>
  request(
    path,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
    timeout
  )

/** 활동별 대기 팀 수. id 를 주면 내 순서까지 함께 온다. */
export function fetchQueue(id) {
  const q = id ? `?id=${encodeURIComponent(id)}` : ""
  return request(`/api/booth/queue${q}`, {}, READ_TIMEOUT_MS)
}

export function book({ activity, name, phone, dept }) {
  return post("/api/booth/reservations", { activity, name, phone, dept })
}

/** 내 예약 취소. 예약할 때 이 기기에만 건네받은 취소 열쇠가 있어야 한다. */
export function cancelBooking(id, key) {
  return post("/api/booth/reservations/cancel", { id, key })
}

export const adminList = (password) => post("/api/booth/admin/list", { password }, READ_TIMEOUT_MS)
/** 체험존 넷의 상태만. 마감 버튼 판은 명단이 필요 없다 — 이름·번호를 매번 받아 오지 않는다. */
export const adminZones = (password) => post("/api/booth/admin/zones", { password }, READ_TIMEOUT_MS)
export const adminComplete = (password, id) => post("/api/booth/admin/complete", { password, id })
export const adminCancel = (password, id) => post("/api/booth/admin/cancel", { password, id })
export const adminTest = (password, phone) => post("/api/booth/admin/test", { password, phone })
/** 이 체험존 마감 — 새 예약을 받지 않는다. 이미 선 줄은 그대로 진행된다. */
export const adminClose = (password, activity) => post("/api/booth/admin/close", { password, activity })
/**
 * 마감 해제 — 그 체험존의 줄을 처음부터 다시 시작한다(다음 예약이 1번).
 * `reset: true` 는 "대기 팀이 빠진다고 확인받았다"는 뜻이다. 서버는 이것 없이 대기 팀을
 * 비우지 않는다 — 되묻지 않던 옛 화면이 줄을 통째로 날리는 것을 막는다.
 */
export const adminReopen = (password, activity) => post("/api/booth/admin/reopen", { password, activity, reset: true })

/**
 * 마감·해제 전에 한 번 더 묻는 문장. 푸터 입구와 운영 화면이 같은 말을 쓴다.
 * 해제는 줄을 비우므로, 남아 있는 대기 팀이 있으면 몇 팀이 빠지는지 적는다.
 */
export function zoneConfirmText(label, closing, waiting = 0) {
  if (closing) {
    return (
      `[${label}] 예약을 마감할까요?\n\n` +
      `예약 화면에 "오늘은 마감되었어요. 내일 다시 만나요."가 뜨고 새 예약을 받지 않습니다. ` +
      `이미 대기 중인 팀은 그대로 순서대로 진행됩니다.`
    )
  }
  return (
    `[${label}] 마감을 해제할까요?\n\n` +
    `대기번호가 0으로 초기화되고, 다음 예약부터 1번으로 다시 받습니다.` +
    (waiting > 0 ? `\n\n지금 대기 중인 ${waiting}팀은 줄에서 빠지고 호출 문자도 가지 않습니다.` : "")
  )
}

/* 내가 넣은 예약은 이 기기에만 남긴다 — 서버는 누가 누구인지 묻지 않는다. */

/** 다른 탭이 예약했을 때 storage 이벤트로 알아차리려고 밖에서도 쓴다. */
export const BOOKING_KEY = "freesiaBooking"
const KEY = BOOKING_KEY

export function readBookings() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? "{}")
    return raw && typeof raw === "object" ? raw : {}
  } catch {
    return {}
  }
}

export function rememberBooking(activity, id) {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...readBookings(), [activity]: id }))
  } catch {
    // 저장소를 못 쓰는 브라우저 — 이번 화면에서만 순서를 보여 준다.
  }
}

const CANCEL_KEYS = "freesiaCancelKeys"

/**
 * 본인 취소 열쇠를 예약 id 별로 기억한다. 서버는 예약한 그 응답에서만 한 번 건넨다 —
 * 같은 번호로 다른 기기에서 들어와 자기 순서를 보는 것은 되지만, 그 기기에서는 취소
 * 버튼이 나오지 않는다(남의 번호로 들어와 취소하는 길을 막는다).
 */
export function rememberCancelKey(id, key) {
  if (!id || !key) return
  try {
    const all = JSON.parse(localStorage.getItem(CANCEL_KEYS) ?? "{}") ?? {}
    const kept = Object.fromEntries(Object.entries(all).slice(-20))
    localStorage.setItem(CANCEL_KEYS, JSON.stringify({ ...kept, [id]: key }))
  } catch {
    // 저장소를 못 쓰는 브라우저 — 이번 화면에서만 취소할 수 있다
  }
}

export function readCancelKey(id) {
  try {
    const all = JSON.parse(localStorage.getItem(CANCEL_KEYS) ?? "{}") ?? {}
    return typeof all[id] === "string" ? all[id] : ""
  } catch {
    return ""
  }
}

const NOTICE_KEY = "freesiaNotices"

/**
 * 예약할 때 받은 안내 문자 결과를 예약 id 별로 기억한다. 화면이 새로 불러와지면(직접
 * 새로고침하거나, 새 배포로 스스로 새로 불러오거나) 이 경고가 사라져, 문자가 안 갔는데도
 * 기다리는 사람이 생긴다.
 */
export function rememberNotice(id, notice) {
  try {
    const all = JSON.parse(localStorage.getItem(NOTICE_KEY) ?? "{}") ?? {}
    // 오래된 것은 버린다 — 하루에 몇 개 안 되지만 끝없이 쌓이지 않게.
    const kept = Object.fromEntries(Object.entries(all).slice(-20))
    localStorage.setItem(NOTICE_KEY, JSON.stringify({ ...kept, [id]: { status: notice?.status ?? "" } }))
  } catch {
    // 무시
  }
}

export function readNotice(id) {
  try {
    const all = JSON.parse(localStorage.getItem(NOTICE_KEY) ?? "{}") ?? {}
    return all[id]?.status ? { status: all[id].status } : null
  } catch {
    return null
  }
}

export function forgetBooking(activity) {
  try {
    const all = readBookings()
    delete all[activity]
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch {
    // 무시
  }
}

/** 010-1234-5678 꼴로 다듬어 보여 준다. */
export function formatPhone(value) {
  const d = String(value).replace(/\D/g, "").slice(0, 11)
  if (d.length < 4) return d
  if (d.length < 8) return `${d.slice(0, 3)}-${d.slice(3)}`
  return `${d.slice(0, 3)}-${d.slice(3, d.length - 4)}-${d.slice(-4)}`
}
