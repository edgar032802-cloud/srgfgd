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

/* 내가 넣은 예약은 이 기기에만 남긴다 — 서버는 누가 누구인지 묻지 않는다. */

const KEY = "freesiaBooking"

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
