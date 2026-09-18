/**
 * 체험 예약 — "바로 반영" 검증.
 *
 * 마감·마감해제를 눌렀는데 다른 화면에는 새로고침해야 보이던 문제(2026-09-19)의 서버 쪽.
 *   - 바뀜 알림(SSE)이 실제로 즉시 흘러가는가 (마감·해제·예약·완료·취소·자정)
 *   - 대기 현황이 어디에도 캐시되지 않는가 (Cache-Control: no-store)
 *   - 응답마다 배포된 빌드 이름이 붙는가 (옛 화면 코드를 돌리는 탭이 스스로 새로 불러오도록)
 *   - 옛 화면 코드가 새 서버 앞에서도 마감을 누를 수 있는가 (canClose)
 *   - 프록시보다 오래 연결을 열어 두는가 (keep-alive 65초)
 *
 * 실제 서버를 따로 띄워 HTTP 로만 찌른다. 문자는 키를 비워 나가지 않고, 예약 파일은 임시 폴더.
 * **먼저 `npm run build`** — 배포 모드 서버가 dist/build.json 을 읽는다.
 */
import { spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = fileURLToPath(new URL("..", import.meta.url))
const PW = "3618"
const DAY_MS = 86_400_000
const KST = 9 * 3_600_000

let pass = 0
let fail = 0
const failures = []
const ok = (label, cond, detail = "") => {
  if (cond) pass++
  else {
    fail++
    failures.push(`${label}${detail ? " — " + detail : ""}`)
  }
  console.log(`${cond ? "  ✓" : "  ✗"} ${label}${detail ? "   " + detail : ""}`)
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const children = []
async function startServer(port, { prod = true, env = {} } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), `booth-live-${port}-`))
  const child = spawn(process.execPath, ["server/index.js", ...(prod ? ["--prod"] : [])], {
    cwd: ROOT,
    env: {
      ...process.env,
      API_PORT: String(port),
      API_HOST: "127.0.0.1",
      BOOTH_DATA_DIR: dataDir,
      SOLAPI_API_KEY: "",
      SOLAPI_API_SECRET: "",
      SMS_SENDER: "",
      BOOTH_ADMIN_PASSWORD: PW,
      BOOTH_RATE_PER_MIN: "100000",
      ...env,
    },
    stdio: ["ignore", "pipe", "pipe"],
  })
  let log = ""
  child.stdout.on("data", (d) => (log += d))
  child.stderr.on("data", (d) => (log += d))
  children.push(child)
  const base = `http://127.0.0.1:${port}/api/booth`
  for (let i = 0; i < 60; i++) {
    await sleep(100)
    try {
      if ((await fetch(base + "/queue")).ok) break
    } catch {}
  }
  const post = async (p, body, headers = { "X-Client-Build": "test" }) => {
    const r = await fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body) })
    return { s: r.status, h: r.headers, d: await r.json().catch(() => ({})) }
  }
  const get = async (p) => {
    const r = await fetch(base + p)
    return { s: r.status, h: r.headers, d: await r.json().catch(() => ({})) }
  }
  const stop = async () => {
    child.kill()
    await sleep(300)
  }
  return { base, post, get, stop, log: () => log }
}

/** SSE 를 열어 들어오는 이벤트를 시각과 함께 모은다. */
async function openStream(base) {
  const ctrl = new AbortController()
  const res = await fetch(base + "/events", { signal: ctrl.signal })
  const events = []
  const raw = []
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ""
  ;(async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        const text = dec.decode(value, { stream: true })
        raw.push(text)
        buf += text
        let i
        while ((i = buf.indexOf("\n\n")) >= 0) {
          const block = buf.slice(0, i)
          buf = buf.slice(i + 2)
          const ev = { at: Date.now(), event: "message", data: "", comment: false }
          for (const line of block.split("\n")) {
            if (line.startsWith(":")) ev.comment = true
            else if (line.startsWith("event:")) ev.event = line.slice(6).trim()
            else if (line.startsWith("data:")) ev.data += line.slice(5).trim()
            else if (line.startsWith("retry:")) ev.event = "retry"
          }
          events.push(ev)
        }
      }
    } catch {
      // 닫힘
    }
  })()
  return { res, events, raw, close: () => ctrl.abort() }
}

const messages = (st) => st.events.filter((e) => e.event === "message" && !e.comment)
async function waitFor(fn, ms = 2000) {
  const t0 = Date.now()
  while (Date.now() - t0 < ms) {
    if (fn()) return Date.now() - t0
    await sleep(20)
  }
  return -1
}

const phone = (n) => `010${String(10000000 + n).slice(-8)}`
const book = (srv, activity, n) => srv.post("/reservations", { activity, name: `손님${n}`, phone: phone(n), dept: "작업치료학과" })

try {
  const buildId = JSON.parse(fs.readFileSync(path.join(ROOT, "dist", "build.json"), "utf8")).id
  console.log(`\n   dist 빌드 이름: ${buildId}`)

  console.log("\n━━ A. 캐시 금지 · 빌드 이름 · keep-alive")
  const S = await startServer(8971)
  const q = await S.get("/queue")
  ok("GET /queue 에 Cache-Control: no-store", q.h.get("cache-control") === "no-store", q.h.get("cache-control"))
  ok("GET /queue 에 X-Build = dist 빌드 이름", q.h.get("x-build") === buildId, q.h.get("x-build"))
  const list = await S.post("/admin/list", { password: PW })
  ok("운영 목록(이름·번호 포함)도 no-store", list.h.get("cache-control") === "no-store")
  ok("운영 목록에도 X-Build", list.h.get("x-build") === buildId)
  ok("틀린 비밀번호 응답도 no-store", (await S.post("/admin/list", { password: "0" })).h.get("cache-control") === "no-store")
  ok("연결 유지 65초(프록시보다 길게)", /timeout=65/.test(q.h.get("keep-alive") ?? ""), q.h.get("keep-alive"))

  console.log("\n━━ B. 옛 화면 코드와의 호환 (canClose)")
  ok("열려 있는 체험존 canClose=true", list.d.zones.register.canClose === true)
  const c0 = await S.post("/admin/close", { password: PW, activity: "register" })
  ok("마감된 체험존 canClose=false", c0.d.zones.register.canClose === false)
  const r0 = await S.post("/admin/reopen", { password: PW, activity: "register" })
  ok("해제 후 다시 canClose=true", r0.d.zones.register.canClose === true)

  console.log("\n━━ C. 바뀜 알림(SSE)")
  const st = await openStream(S.base)
  ok("SSE 응답 200", st.res.status === 200, String(st.res.status))
  ok("Content-Type text/event-stream", (st.res.headers.get("content-type") ?? "").startsWith("text/event-stream"))
  ok("SSE 도 no-store", st.res.headers.get("cache-control") === "no-store")
  const helloMs = await waitFor(() => st.events.some((e) => e.event === "hello"), 1500)
  ok("연결 즉시 hello 가 온다(버퍼링 없음)", helloMs >= 0, `${helloMs}ms`)
  const hello = st.events.find((e) => e.event === "hello")
  ok("hello 에 빌드 이름", hello && JSON.parse(hello.data).build === buildId)
  ok("재연결 간격(retry) 알려 줌", st.raw.join("").includes("retry: 3000"))

  const probe = async (label, action) => {
    const before = messages(st).length
    const t0 = Date.now()
    await action()
    const ms = await waitFor(() => messages(st).length > before, 1500)
    ok(`${label} → 알림 도착`, ms >= 0, ms >= 0 ? `${Date.now() - t0}ms` : "안 옴")
    return messages(st).at(-1)
  }
  const m1 = await probe("마감", () => S.post("/admin/close", { password: PW, activity: "seek" }))
  ok("알림 내용은 번호뿐(개인정보 없음)", m1 && Object.keys(JSON.parse(m1.data)).join() === "v", m1?.data)
  await probe("마감해제", () => S.post("/admin/reopen", { password: PW, activity: "seek" }))
  const b1 = await book(S, "seek", 1)
  ok("예약 성공", b1.s === 200)
  const bBefore = messages(st).length
  await book(S, "seek", 2)
  ok("예약 → 알림 도착", (await waitFor(() => messages(st).length > bBefore, 1500)) >= 0)
  await probe("체험 완료", () => S.post("/admin/complete", { password: PW, id: b1.d.reservation.id }))
  const w = (await S.post("/admin/list", { password: PW })).d.reservations.find((r) => r.status === "waiting")
  await probe("취소", () => S.post("/admin/cancel", { password: PW, id: w.id }))

  const noop = messages(st).length
  await S.post("/admin/close", { password: PW, activity: "avoid" })
  await sleep(300)
  const afterFirst = messages(st).length
  await S.post("/admin/close", { password: PW, activity: "avoid" }) // 이미 마감 — 바뀐 것 없음
  await S.post("/admin/reopen", { password: PW, activity: "sensitive" }) // 마감 안 됨 — 바뀐 것 없음
  await sleep(400)
  ok("바뀐 것이 없으면 알리지 않는다(중복 마감·열린 체험존 해제)", messages(st).length === afterFirst, `${noop}→${afterFirst}→${messages(st).length}`)

  const burstBefore = messages(st).length
  await Promise.all(Array.from({ length: 20 }, (_, i) => book(S, "register", 100 + i)))
  await sleep(500)
  const burst = messages(st).length - burstBefore
  ok("20건이 한꺼번에 와도 알림은 묶여서 몇 번만", burst >= 1 && burst <= 5, `${burst}번`)

  const st2 = await openStream(S.base)
  await waitFor(() => st2.events.some((e) => e.event === "hello"), 1500)
  const two = [messages(st).length, messages(st2).length]
  await S.post("/admin/close", { password: PW, activity: "register" })
  ok("열린 화면 모두에게 간다(둘째 연결)", (await waitFor(() => messages(st2).length > two[1], 1500)) >= 0)
  ok("열린 화면 모두에게 간다(첫째 연결)", messages(st).length > two[0])

  st2.close()
  await sleep(200)
  const afterDrop = messages(st).length
  await S.post("/admin/reopen", { password: PW, activity: "register", reset: true })
  ok("한쪽이 끊겨도 나머지는 계속 받는다", (await waitFor(() => messages(st).length > afterDrop, 1500)) >= 0)

  console.log("   … 조용할 때 연결 유지 신호(20초) 대기")
  const pingBefore = st.events.filter((e) => e.comment).length
  const pingMs = await waitFor(() => st.events.filter((e) => e.comment).length > pingBefore, 23_000)
  ok("아무 일이 없어도 20초 안쪽마다 신호", pingMs >= 0, `${pingMs}ms`)
  st.close()

  console.log("\n━━ C2. HEAD · 가벼운 체험존 목록 · 옛 화면 거절에는 알림 없음")
  const head = await Promise.race([
    fetch(S.base + "/events", { method: "HEAD" }).then((r) => r.status),
    sleep(2000).then(() => "시간 초과"),
  ])
  ok("HEAD /events 는 붙잡지 않고 바로 405", head === 405, String(head))
  ok("HEAD 뒤에도 정상 응답", (await S.get("/queue")).s === 200)
  const zs = await S.post("/admin/zones", { password: PW })
  ok("/admin/zones: 체험존 넷", zs.s === 200 && Object.keys(zs.d.zones ?? {}).length === 4)
  ok("/admin/zones: 명단(이름·번호)은 싣지 않는다", !("reservations" in zs.d) && !JSON.stringify(zs.d).includes("010"))
  ok("/admin/zones: 비밀번호 틀리면 401", (await S.post("/admin/zones", { password: "0" })).s === 401)
  ok("/admin/zones 도 no-store", zs.h.get("cache-control") === "no-store")
  const st3 = await openStream(S.base)
  await waitFor(() => st3.events.some((e) => e.event === "hello"), 1500)
  const oldTab = await S.post("/admin/close", { password: PW, activity: "sensitive" }, {}) // 옛 화면 — 거절
  ok("옛 화면(빌드 이름 없음)의 마감은 409 RELOAD", oldTab.s === 409 && oldTab.d.error === "RELOAD")
  await sleep(400)
  ok("거절된 요청은 알림을 보내지 않는다", messages(st3).length === 0, `${messages(st3).length}번`)
  const nowTab = await S.post("/admin/close", { password: PW, activity: "sensitive" })
  ok("지금 화면의 마감은 그대로 된다", nowTab.s === 200 && nowTab.d.zones.sensitive.closed === true)
  ok("…그리고 알림이 간다", (await waitFor(() => messages(st3).length > 0, 1500)) >= 0)
  st3.close()

  // 여러 번 열고 닫아도 서버가 멀쩡한가
  const many = await Promise.all(Array.from({ length: 30 }, () => openStream(S.base)))
  await sleep(300)
  many.forEach((m) => m.close())
  await sleep(300)
  ok("연결 30개를 열고 닫은 뒤에도 정상 응답", (await S.get("/queue")).s === 200)
  await S.stop()

  console.log("\n━━ D. 개발 모드에서는 빌드 이름을 보내지 않는다 (dist 가 옛것일 수 있다)")
  const D = await startServer(8972, { prod: false })
  const dq = await D.get("/queue")
  ok("개발 서버: X-Build 없음", dq.h.get("x-build") === null, String(dq.h.get("x-build")))
  ok("개발 서버도 no-store", dq.h.get("cache-control") === "no-store")
  const dst = await openStream(D.base)
  await waitFor(() => dst.events.some((e) => e.event === "hello"), 1500)
  const dh = dst.events.find((e) => e.event === "hello")
  ok("개발 서버 hello 의 build 는 빈 값", dh && JSON.parse(dh.data).build === "")
  dst.close()
  await D.stop()

  console.log("\n━━ E. 한국 00시에도 알린다 (서버 시계를 23:59:57 로 밀고 실제로 넘긴다)")
  const now = Date.now()
  const nextMidnightUtc = Math.ceil((now + KST + 1) / DAY_MS) * DAY_MS - KST
  const M = await startServer(8973, { env: { BOOTH_CLOCK_OFFSET_MS: String(nextMidnightUtc - 3_000 - now) } })
  const mst = await openStream(M.base)
  await waitFor(() => mst.events.some((e) => e.event === "hello"), 1500)
  const dayBefore = (await M.get("/queue")).d.today
  const midMs = await waitFor(() => messages(mst).length > 0, 7_000)
  const dayAfter = (await M.get("/queue")).d.today
  ok("자정을 넘기자 알림이 온다", midMs >= 0, `${midMs}ms · ${dayBefore} → ${dayAfter}`)
  ok("그때 서버 날짜가 바뀌어 있다", dayAfter !== dayBefore)
  mst.close()
  await M.stop()
} catch (e) {
  fail++
  failures.push("예외: " + e.stack)
  console.error(e)
} finally {
  for (const c of children) {
    try {
      c.kill()
    } catch {}
  }
}

console.log(`\n══════════════ 통과 ${pass} · 실패 ${fail}`)
if (fail) {
  console.log("실패 목록:")
  for (const f of failures) console.log("  - " + f)
  process.exitCode = 1
}
