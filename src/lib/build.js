/**
 * 이 화면 코드가 지금 배포된 것과 같은가.
 *
 * 휴대폰 사파리는 탭을 며칠씩 살려 둔다. 배포 전에 열어 둔 탭은 옛 화면 코드를
 * 그대로 돌리고, 옛 코드는 새 서버와 어긋난다 — 2026-09-18 에는 옛 운영 화면의
 * 마감 버튼이 새 서버 앞에서 계속 막혀 "새로고침을 해야 된다"로 보였다.
 *
 * 서버는 booth 응답마다 지금 배포된 빌드 이름(X-Build)을 붙이고, 화면은 처음 뜰 때와
 * 다시 보일 때 /build.json 도 직접 본다. 내 이름과 다르면 **안전한 때에** 한 번 새로
 * 불러온다. 지키는 것:
 * - **한 번만.** 새로 불러와도 여전히 다르면(무언가 옛 화면을 붙잡고 있다) 더 돌리지
 *   않는다. 새로고침이 끝없이 도는 것이 가장 나쁘다.
 * - **하던 일을 날리지 않는다.** 비밀번호 창·마감 버튼 판이 열려 있거나, 무언가를
 *   치고 있거나, 예약 칸에 적어 둔 것이 있거나, 방금 누른 요청이 아직 오가는 중이면
 *   기다린다.
 * - **한꺼번에 몰리지 않는다.** 배포 직후 열린 화면이 전부 같은 순간 새로 불러오면
 *   행사장 와이파이가 막힌다. 몇 초씩 흩는다. 사용자가 막 돌아온 순간(탭 전환·뒤로
 *   가기·화면 이동)에는 기다리지 않는다 — 어차피 화면이 바뀌는 때다.
 * - 개발 서버("dev")와, 이름을 보내지 않는 서버에서는 아무것도 하지 않는다.
 */
/* global __BUILD_ID__ */
const BUILD = typeof __BUILD_ID__ === "string" ? __BUILD_ID__ : "dev"
const KEY = "freesiaReloadedFor"

/** 요청에 실어 보내는 이 화면의 빌드 이름. 서버는 이 이름이 없는(옛) 화면의 마감·해제를 거절한다. */
export const CLIENT_BUILD = BUILD

/** 서버가 다른 빌드라고 알려 왔는데 아직 새로 불러오지 못한 것. */
let pending = ""
let timer = 0
let holdUntil = 0

const editable = (el) => Boolean(el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable))

/** 지금 새로 불러오면 누군가 하던 일이 날아가는가. */
function busy() {
  if (Date.now() < holdUntil) return true
  if (document.querySelector('[aria-modal="true"]')) return true
  if (editable(document.activeElement)) return true
  return [...document.querySelectorAll(".book__form input")].some((el) => el.value)
}

function tried(id) {
  try {
    return sessionStorage.getItem(KEY) === id
  } catch {
    return true // 기록할 곳이 없으면 몇 번 돌았는지 셀 수 없다 — 아예 하지 않는다
  }
}

function reloadNow() {
  if (!pending || tried(pending) || busy()) return
  try {
    sessionStorage.setItem(KEY, pending)
  } catch {
    return
  }
  window.location.reload()
}

function reloadSoon(now) {
  if (!pending) return
  if (now) {
    reloadNow()
    return
  }
  if (timer) return // 이미 잡아 둔 때가 있다 — 응답이 올 때마다 미루면 영영 오지 않는다
  timer = setTimeout(() => {
    timer = 0
    reloadNow()
  }, 2000 + Math.random() * 13000)
}

export function checkBuild(serverBuild) {
  const id = String(serverBuild ?? "")
  if (!id || BUILD === "dev" || id === BUILD || tried(id)) return
  pending = id
  reloadSoon(false)
}

/** 방금 누른 요청이 오가는 중 — 그동안은 새로 불러오지 않는다(요청이 끊기면 됐는지 모른다). */
export function holdReload(ms) {
  holdUntil = Math.max(holdUntil, Date.now() + ms)
}

async function probe() {
  try {
    const r = await fetch("/build.json", { cache: "no-store" })
    if (r.ok) checkBuild((await r.json()).id)
  } catch {
    // 못 봤으면 다음 기회에
  }
}

let watching = false
/**
 * 앱이 뜰 때 한 번 부른다. 첫 화면(푸터가 있는 곳)은 예약 요청을 하지 않아 X-Build 를
 * 볼 일이 없다 — 그래서 직접 본다. 운영자가 비밀번호 창을 열기 전에 옛 화면이 걷힌다.
 */
export function watchBuild() {
  if (watching || BUILD === "dev" || typeof window === "undefined") return
  watching = true
  probe()
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") return
    reloadSoon(true)
    probe()
  })
  window.addEventListener("pageshow", (e) => {
    if (!e.persisted) return
    reloadSoon(true)
    probe()
  })
  window.addEventListener("hashchange", () => reloadSoon(true))
}
