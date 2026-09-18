async function json(response) {
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const err = new Error(data.message ?? data.error ?? `HTTP ${response.status}`)
    err.code = data.error
    err.data = data
    throw err
  }
  return data
}

const post = (path, body) =>
  fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }).then(json)

/** 활동별 대기 팀 수. id 를 주면 내 순서까지 함께 온다. */
export function fetchQueue(id) {
  const q = id ? `?id=${encodeURIComponent(id)}` : ""
  return fetch(`/api/booth/queue${q}`).then(json)
}

export function book({ activity, name, phone, dept }) {
  return post("/api/booth/reservations", { activity, name, phone, dept })
}

export const adminList = (password) => post("/api/booth/admin/list", { password })
export const adminComplete = (password, id) => post("/api/booth/admin/complete", { password, id })
export const adminCancel = (password, id) => post("/api/booth/admin/cancel", { password, id })
export const adminTest = (password, phone) => post("/api/booth/admin/test", { password, phone })
/** 이 체험존 마감 — 새 예약을 받지 않는다. 이미 선 줄은 그대로 진행된다. */
export const adminClose = (password, activity) => post("/api/booth/admin/close", { password, activity })
/** 마감 해제 — 그 체험존의 줄을 처음부터 다시 시작한다(다음 예약이 1번). */
export const adminReopen = (password, activity) => post("/api/booth/admin/reopen", { password, activity })

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
