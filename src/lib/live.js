import { useEffect, useRef } from "react"

import { checkBuild } from "./build.js"

/**
 * 대기 현황을 "바로" 따라가게 하는 것.
 *
 * 예전에는 화면이 15초마다 묻기만 했다. 운영자가 마감을 눌러도 다른 휴대폰에는 최대
 * 15초 뒤에야 보였고, 휴대폰 사파리는 탭을 옮기거나 화면을 다시 켤 때 그 주기를 더
 * 늦춘다(focus 이벤트도 믿을 수 없다). 보는 사람에게는 "새로고침을 해야 된다"였다.
 *
 * 지금은 세 겹이다.
 * 1. **서버 알림(SSE)** — 무엇이든 바뀌면 서버가 곧바로 "바뀌었다"고 알린다.
 *    탭 하나에 연결 하나를 모두가 같이 쓰고, 화면이 가려지면 끊었다가 보이면 다시 잇는다.
 *    서버가 다시 뜨는 중이라 거절당하면(브라우저는 거기서 포기한다) 조금씩 간격을 벌려
 *    직접 다시 잇는다.
 * 2. **보이는 순간 다시 묻기** — 탭 전환·화면 켜기·뒤로 가기(bfcache)·네트워크 복귀.
 * 3. **주기적으로 묻기** — 알림이 살아 있으면 느슨하게, 끊겼거나 방금 묻기가 실패했으면
 *    촘촘하게. 알림이 어떤 이유로 막혀도 틀린 상태로 남지 않고 늦어질 뿐이다.
 */

const EVENTS_URL = "/api/booth/events"
/** 같은 기기의 다른 탭에 "운영자가 무언가 눌렀다"를 알리는 열쇠. 값은 시각일 뿐이다. */
export const ZONES_KEY = "freesiaZonesRev"

const listeners = new Set()
let source = null
let live = false
let failures = 0
let retryTimer = 0
let watching = false

const emit = () => {
  for (const fn of listeners) fn()
}

function connect() {
  clearTimeout(retryTimer)
  retryTimer = 0
  if (source || !listeners.size || typeof EventSource === "undefined") return
  if (document.visibilityState === "hidden") return
  const es = new EventSource(EVENTS_URL)
  source = es
  es.addEventListener("hello", (e) => {
    live = true
    failures = 0
    try {
      checkBuild(JSON.parse(e.data).build)
    } catch {
      // 모양이 이상한 인사 — 무시하고 알림만 쓴다
    }
    emit() // (다시) 이어졌다 — 끊겨 있던 사이 바뀐 것을 따라잡는다
  })
  es.onmessage = () => emit()
  es.onerror = () => {
    live = false
    // 연결이 잠깐 끊긴 것이면 브라우저가 스스로 다시 잇는다(readyState 0).
    if (es.readyState !== 2 || source !== es) return
    // 서버가 다시 뜨는 중(502)·붐빔(503)으로 거절되면 브라우저는 더 잇지 않는다.
    // 3초 → 6 → 12 → 24 → 30초, 모두가 같은 순간에 몰리지 않게 흩어서 다시 잇는다.
    source = null
    failures++
    const base = 3000 * 2 ** Math.min(failures - 1, 4)
    retryTimer = setTimeout(connect, Math.min(30000, base * (0.5 + Math.random())))
  }
}

function disconnect() {
  clearTimeout(retryTimer)
  retryTimer = 0
  if (source) source.close()
  source = null
  live = false
}

function watch() {
  if (watching) return
  watching = true
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") disconnect()
    else connect()
  })
  window.addEventListener("pageshow", connect)
  window.addEventListener("online", () => {
    disconnect()
    connect()
  })
}

function subscribe(fn) {
  listeners.add(fn)
  watch()
  connect()
  return () => {
    listeners.delete(fn)
    if (!listeners.size) disconnect()
  }
}

/** 연결이 없는데 다시 이을 계획도 없으면 잇는다. 주기적 확인 때마다 부르는 안전망. */
function ensureConnected() {
  if (!source && !retryTimer) connect()
}

/** 운영자가 마감·해제·완료·취소를 누른 뒤 부른다. 같은 기기의 다른 탭이 곧바로 다시 묻는다. */
export function signalZonesChanged() {
  try {
    localStorage.setItem(ZONES_KEY, String(Date.now()))
  } catch {
    // 저장소를 못 쓰는 브라우저 — 알림과 주기적 확인으로 따라간다
  }
}

/**
 * `refresh` 를 알맞은 때마다 부른다: 처음 한 번, 서버 알림이 올 때, 화면이 다시 보일 때,
 * 그리고 주기적으로(알림이 살아 있으면 `slowMs` 마다, 끊겼거나 방금 실패했으면 `fastMs` 마다).
 * `refresh` 가 `false` 를 돌려주면 실패로 치고 곧 다시 묻는다.
 *
 * `minGapMs` — 알림으로 부르는 간격의 최소값. 운영 화면은 한 번 부를 때 목록 전체를
 * 받아 오므로, 줄이 몰릴 때 알림마다 받지 않게 묶는다. 방문자 화면은 0(바로).
 * 가려져 있는 동안에는 묻지 않는다 — 다시 보이는 순간 한 번 묻는다.
 */
export function useLive(refresh, { fastMs = 5000, slowMs = 20000, minGapMs = 0 } = {}) {
  const latest = useRef(refresh)
  useEffect(() => {
    latest.current = refresh
  })

  useEffect(() => {
    let alive = true
    let loopTimer = 0
    let soonTimer = 0
    let soonAt = 0
    let lastRun = 0
    let failed = false

    const run = async () => {
      soonTimer = 0
      if (!alive) return
      lastRun = Date.now()
      try {
        failed = (await latest.current()) === false
      } catch {
        failed = true
      }
    }
    /** 이미 더 이른 때로 잡혀 있으면 그대로 둔다 — 알림이 이어져도 끝없이 미뤄지지 않게. */
    const kick = (delay = 0) => {
      const at = Date.now() + delay
      if (soonTimer && soonAt <= at) return
      clearTimeout(soonTimer)
      soonAt = at
      soonTimer = setTimeout(run, delay)
    }
    const tick = () => {
      loopTimer = setTimeout(() => {
        if (document.visibilityState !== "hidden") {
          ensureConnected()
          if (!live || failed || Date.now() - lastRun >= slowMs) run()
        }
        tick()
      }, fastMs)
    }

    kick()
    tick()
    // 알림 한 번에 수백 대가 같은 순간 몰리지 않게 조금씩 흩는다.
    const off = subscribe(() => kick(Math.max(0, lastRun + minGapMs - Date.now()) + Math.random() * 250))

    const onVisible = () => {
      if (document.visibilityState !== "hidden") kick()
    }
    const onShow = () => kick()
    const onStorage = (e) => {
      if (e.key === ZONES_KEY) kick()
    }
    document.addEventListener("visibilitychange", onVisible)
    window.addEventListener("pageshow", onShow)
    window.addEventListener("focus", onShow)
    window.addEventListener("online", onShow)
    window.addEventListener("storage", onStorage)

    return () => {
      alive = false
      clearTimeout(loopTimer)
      clearTimeout(soonTimer)
      off()
      document.removeEventListener("visibilitychange", onVisible)
      window.removeEventListener("pageshow", onShow)
      window.removeEventListener("focus", onShow)
      window.removeEventListener("online", onShow)
      window.removeEventListener("storage", onStorage)
    }
  }, [fastMs, slowMs, minGapMs])
}
