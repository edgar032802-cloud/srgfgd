/**
 * 체험 예약 — 하루 정원 · 마감 · 자정 초기화 · 호출 규칙 전수 검증.
 *
 * 실제 서버(server/index.js)를 따로따로 띄워 HTTP 로만 찌른다. 문자는 키를 비워
 * 절대 나가지 않게 하고, 예약 파일은 임시 폴더에 둬서 진짜 명단을 건드리지 않는다.
 */
import { spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

// 저장소 루트 — 이 파일이 tests/ 안에 있으므로 한 칸 위다.
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

const servers = []
async function startServer(port, extraEnv = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), `booth-${port}-`))
  const env = {
    ...process.env,
    API_PORT: String(port),
    BOOTH_DATA_DIR: dataDir,
    // 문자가 절대 나가지 않게
    SOLAPI_API_KEY: "",
    SOLAPI_API_SECRET: "",
    SMS_SENDER: "",
    BOOTH_ADMIN_PASSWORD: PW,
    ...extraEnv,
  }
  const child = spawn(process.execPath, ["server/index.js"], { cwd: ROOT, env, stdio: ["ignore", "pipe", "pipe"] })
  let log = ""
  child.stdout.on("data", (d) => (log += d))
  child.stderr.on("data", (d) => (log += d))
  servers.push(child)
  for (let i = 0; i < 50; i++) {
    await sleep(100)
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/booth/queue`)
      if (r.ok) break
    } catch {}
  }
  const base = `http://127.0.0.1:${port}/api/booth`
  const post = async (p, body) => {
    const r = await fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
    return { s: r.status, d: await r.json().catch(() => ({})) }
  }
  const get = async (p) => {
    const r = await fetch(base + p)
    return { s: r.status, d: await r.json().catch(() => ({})) }
  }
  const stop = async () => {
    child.kill()
    await sleep(300)
  }
  return { post, get, stop, dataDir, log: () => log, child }
}

const phone = (n) => `010${String(10000000 + n).slice(-8)}`
const book = (srv, activity, n, name = `손님${n}`) =>
  srv.post("/reservations", { activity, name, phone: phone(n), dept: "작업치료학과" })
const admin = (srv) => srv.post("/admin/list", { password: PW })
const notices = async (srv, id) => {
  const { d } = await admin(srv)
  return (d.reservations.find((r) => r.id === id)?.notices ?? []).map((n) => n.kind)
}

try {
  /* ================================================================ A·B */
  console.log("\n━━ A. 하루 정원 100팀 (정원 값을 줄이지 않고 실제 100 으로)")
  const S = await startServer(8961, { BOOTH_RATE_PER_MIN: "100000" })

  const first = await book(S, "register", 1)
  ok("첫 예약은 1번", first.d.reservation?.teamNo === 1, `teamNo=${first.d.reservation?.teamNo}`)

  const nos = [first.d.reservation.teamNo]
  let firstFail = null
  for (let i = 2; i <= 100; i++) {
    const r = await book(S, "register", i)
    if (r.s !== 200) firstFail ??= `${i}번째 ${r.s} ${r.d.error}`
    else nos.push(r.d.reservation.teamNo)
  }
  ok("1~100번째 예약 모두 성공", firstFail === null, firstFail ?? "")
  ok("대기번호가 1..100 으로 빠짐없이 한 번씩", nos.length === 100 && nos.every((n, i) => n === i + 1))

  const over = await book(S, "register", 101)
  ok("101번째는 막힌다 (409 CLOSED)", over.s === 409 && over.d.error === "CLOSED", `${over.s} ${over.d.error}`)
  ok("막힌 이유는 정원(full)", over.d.reason === "full", over.d.reason)
  ok("막힐 때 문구가 정확하다", over.d.message === "오늘은 마감되었어요. 내일 다시 만나요.", over.d.message)

  const q1 = await S.get("/queue")
  ok("방문자 화면에 shut=true 로 전달", q1.d.zones?.register?.shut === true)
  ok("방문자 화면 대기 수 100", q1.d.counts?.register === 100, String(q1.d.counts?.register))
  ok("다른 체험존은 영향 없음(shut=false)", q1.d.zones?.seek?.shut === false)

  const other = await book(S, "seek", 500)
  ok("다른 체험존은 그대로 예약된다(1번)", other.s === 200 && other.d.reservation.teamNo === 1)

  console.log("\n━━ A2. 취소하면 자리가 돌아온다 · 번호는 재사용하지 않는다")
  const listA = await admin(S)
  const victim = listA.d.reservations.find((r) => r.activity === "register" && r.teamNo === 50)
  const c1 = await S.post("/admin/cancel", { password: PW, id: victim.id })
  ok("50번 취소", c1.s === 200)
  const refill = await book(S, "register", 102)
  ok("취소로 빈 자리에 새 예약이 들어간다", refill.s === 200, `${refill.s} ${refill.d.error ?? ""}`)
  ok("새 번호는 101 (50을 재사용하지 않음)", refill.d.reservation?.teamNo === 101, String(refill.d.reservation?.teamNo))
  const again = await book(S, "register", 103)
  ok("다시 정원이 차서 막힌다", again.s === 409 && again.d.reason === "full")

  console.log("\n━━ B. 마감 버튼 — 체험 완료 100팀부터")
  let z = (await admin(S)).d.zones.register
  ok("완료 0 → 마감 불가(canClose=false)", z.canClose === false && z.done === 0)
  const early = await S.post("/admin/close", { password: PW, activity: "register" })
  ok("완료 0 에서 마감 요청은 서버가 거절(409 NOT_YET)", early.s === 409 && early.d.error === "NOT_YET", early.d.message)

  // 99팀 완료
  let list = (await admin(S)).d.reservations.filter((r) => r.activity === "register" && r.status === "waiting")
  list.sort((a, b) => a.ahead - b.ahead)
  for (const r of list.slice(0, 99)) await S.post("/admin/complete", { password: PW, id: r.id })
  z = (await admin(S)).d.zones.register
  ok("완료 99 → 아직 마감 불가", z.done === 99 && z.canClose === false, `done=${z.done}`)
  const at99 = await S.post("/admin/close", { password: PW, activity: "register" })
  ok("완료 99 에서 마감 요청 거절", at99.s === 409, at99.d.message)

  // 100팀째 완료
  list = (await admin(S)).d.reservations.filter((r) => r.activity === "register" && r.status === "waiting")
  await S.post("/admin/complete", { password: PW, id: list[0].id })
  z = (await admin(S)).d.zones.register
  ok("완료 100 → 마감 가능(canClose=true)", z.done === 100 && z.canClose === true, `done=${z.done}`)
  ok("정원 100 이 전부 완료되면 대기 0", z.waiting === 0, `waiting=${z.waiting}`)

  const closeR = await S.post("/admin/close", { password: PW, activity: "register" })
  ok("마감 성공", closeR.s === 200 && closeR.d.zones.register.closed === true)
  ok("마감 후 canClose=false (중복 마감 버튼 안 뜸)", closeR.d.zones.register.canClose === false)
  const twice = await S.post("/admin/close", { password: PW, activity: "register" })
  ok("마감을 두 번 눌러도 문제없음", twice.s === 200 && twice.d.zones.register.closed === true)

  const afterClose = await book(S, "register", 104)
  ok("마감 후 예약은 막힌다", afterClose.s === 409 && afterClose.d.error === "CLOSED")
  ok("마감 후 막힌 이유는 closed", afterClose.d.reason === "closed", afterClose.d.reason)
  ok("마감 후 문구 정확", afterClose.d.message === "오늘은 마감되었어요. 내일 다시 만나요.")
  const q2 = await S.get("/queue")
  ok("마감 후 방문자 화면 shut=true", q2.d.zones.register.shut === true)
  ok("마감은 다른 체험존에 번지지 않는다", q2.d.zones.seek.shut === false)

  const reopen = await S.post("/admin/reopen", { password: PW, activity: "register" })
  ok("마감 해제", reopen.s === 200 && reopen.d.zones.register.closed === false)
  const q3 = await S.get("/queue")
  ok("해제해도 정원이 찼으면 여전히 shut (완료 100 = 정원)", q3.d.zones.register.shut === true)

  const badAct = await S.post("/admin/close", { password: PW, activity: "toString" })
  ok("이상한 활동 이름으로 마감 요청 거절", badAct.s === 400)
  const badBook = await S.post("/reservations", { activity: "__proto__", name: "해커", phone: phone(9), dept: "x" })
  ok("이상한 활동 이름으로 예약 거절", badBook.s === 400)
  const noPw = await S.post("/admin/close", { password: "0000", activity: "seek" })
  ok("비밀번호 틀리면 마감 불가", noPw.s === 401)
  const doneAgain = await S.post("/admin/complete", { password: PW, id: list[0].id })
  ok("이미 완료한 팀을 다시 완료할 수 없다", doneAgain.s === 409)

  /* ================================================================ D */
  console.log("\n━━ D. 앞에 5팀 이상일 때 새 예약 — 기존 규칙과 일치하는가")
  // avoid 존을 새로 쓴다. 7팀을 먼저 세운다.
  const pre = []
  for (let i = 0; i < 7; i++) pre.push((await book(S, "avoid", 700 + i)).d.reservation)
  // 앞 7팀 중 앞 6팀(ahead 0~5)은 접수 즉시 호출 대상 → 6초 뒤 호출
  const late = await book(S, "avoid", 800) // ahead = 7
  ok("앞에 7팀일 때 새 예약: 앞 7팀으로 안내", late.d.reservation?.ahead === 7, `ahead=${late.d.reservation?.ahead}`)
  ok("대기번호 8번", late.d.reservation?.teamNo === 8)
  const late2 = await book(S, "avoid", 801) // ahead = 8
  const five = await (async () => {
    // seek 존: 5팀 세우고 6번째 → ahead 5 (경계)
    const ids = []
    for (let i = 0; i < 5; i++) ids.push((await book(S, "sensitive", 900 + i)).d.reservation.id)
    return book(S, "sensitive", 950)
  })()
  ok("앞에 정확히 5팀일 때 새 예약: ahead 5", five.d.reservation?.ahead === 5, `ahead=${five.d.reservation?.ahead}`)
  const six = await book(S, "sensitive", 951)
  ok("앞에 6팀일 때 새 예약: ahead 6", six.d.reservation?.ahead === 6)

  console.log("   … 호출 지연(6초) 대기")
  await sleep(7500)

  ok("앞 7팀: 접수 문자만, 호출 없음", JSON.stringify(await notices(S, late.d.reservation.id)) === '["booked"]', JSON.stringify(await notices(S, late.d.reservation.id)))
  ok("앞 8팀: 접수 문자만, 호출 없음", JSON.stringify(await notices(S, late2.d.reservation.id)) === '["booked"]')
  ok("앞 5팀(경계): 접수 + 호출 따로 두 통", JSON.stringify(await notices(S, five.d.reservation.id)) === '["booked","callup"]', JSON.stringify(await notices(S, five.d.reservation.id)))
  ok("앞 6팀: 접수만", JSON.stringify(await notices(S, six.d.reservation.id)) === '["booked"]')
  ok("줄 맨 앞(앞 0팀): 접수 + 호출", JSON.stringify(await notices(S, pre[0].id)) === '["booked","callup"]')
  ok("앞 6번째 팀(ahead 6)은 호출 안 됨", JSON.stringify(await notices(S, pre[6].id)) === '["booked"]', JSON.stringify(await notices(S, pre[6].id)))

  // 새 예약이 남의 호출을 다시 부르지 않았는가 (각자 호출은 최대 1)
  const allAvoid = (await admin(S)).d.reservations.filter((r) => r.activity === "avoid")
  const maxCalls = Math.max(...allAvoid.map((r) => r.notices.filter((n) => n.kind === "callup").length))
  ok("누구도 호출 문자를 두 번 받지 않았다", maxCalls <= 1, `최대 ${maxCalls}회`)

  console.log("\n━━ D2. 앞 7팀 → 완료 2번 → 앞 5팀이 되는 순간 한 번만 호출")
  const avoidWaiting = () => admin(S).then(({ d }) => d.reservations.filter((r) => r.activity === "avoid" && r.status === "waiting").sort((a, b) => a.ahead - b.ahead))
  let w = await avoidWaiting()
  await S.post("/admin/complete", { password: PW, id: w[0].id })
  let mine = (await S.get(`/queue?id=${late.d.reservation.id}`)).d.mine
  ok("완료 1번 → 앞 6팀", mine.ahead === 6, `ahead=${mine.ahead}`)
  ok("앞 6팀일 때는 아직 호출 없음", !(await notices(S, late.d.reservation.id)).includes("callup"))
  w = await avoidWaiting()
  await S.post("/admin/complete", { password: PW, id: w[0].id })
  mine = (await S.get(`/queue?id=${late.d.reservation.id}`)).d.mine
  ok("완료 2번 → 앞 5팀", mine.ahead === 5)
  await sleep(300)
  ok("앞 5팀이 되자 호출이 한 통 나감", JSON.stringify(await notices(S, late.d.reservation.id)) === '["booked","callup"]', JSON.stringify(await notices(S, late.d.reservation.id)))
  w = await avoidWaiting()
  await S.post("/admin/complete", { password: PW, id: w[0].id })
  await sleep(300)
  ok("더 당겨져도 두 번 부르지 않음", (await notices(S, late.d.reservation.id)).filter((k) => k === "callup").length === 1)

  console.log("\n━━ E. 체험 완료를 동시에 연달아 눌러도 호출이 중복되지 않는가")
  for (let i = 0; i < 12; i++) await book(S, "seek", 1000 + i)
  const seekW = (await admin(S)).d.reservations.filter((r) => r.activity === "seek" && r.status === "waiting").sort((a, b) => a.ahead - b.ahead)
  await sleep(7000) // 접수 시점 호출이 끝나기를 기다린다
  await Promise.all(seekW.slice(0, 5).map((r) => S.post("/admin/complete", { password: PW, id: r.id })))
  await sleep(500)
  const seekAll = (await admin(S)).d.reservations.filter((r) => r.activity === "seek")
  const dup = seekAll.filter((r) => r.notices.filter((n) => n.kind === "callup").length > 1)
  ok("동시 완료 5번 뒤 호출 중복 0건", dup.length === 0, dup.map((r) => r.teamNo).join(","))
  const shouldBeCalled = seekAll.filter((r) => r.status === "waiting" && r.ahead <= 5)
  ok("앞 5팀 이내 대기자는 전원 호출 기록 있음", shouldBeCalled.every((r) => r.calledAt), `${shouldBeCalled.filter((r) => !r.calledAt).length}명 누락`)

  console.log("\n━━ G. 재시작해도 정원·마감·번호가 유지되는가")
  await S.post("/admin/close", { password: PW, activity: "register" })
  const seekMaxBefore = Math.max(...(await admin(S)).d.reservations.filter((r) => r.activity === "seek").map((r) => r.teamNo))
  const dataDir = S.dataDir
  await S.stop()
  const S2 = await startServer(8965, { BOOTH_DATA_DIR: dataDir, BOOTH_RATE_PER_MIN: "100000" })
  const z2 = (await admin(S2)).d.zones.register
  ok("재시작 후 마감 유지", z2.closed === true)
  ok("재시작 후 완료 100 유지", z2.done === 100)
  const r2 = await book(S2, "register", 2000)
  ok("재시작 후에도 예약 막힘", r2.s === 409)
  const seekNext = await book(S2, "seek", 2001)
  ok(
    `재시작 후 번호가 이어진다(재시작 전 최대 ${seekMaxBefore} → ${seekMaxBefore + 1})`,
    seekNext.d.reservation?.teamNo === seekMaxBefore + 1,
    String(seekNext.d.reservation?.teamNo)
  )
  await S2.stop()

  /* ================================================================ C */
  console.log("\n━━ C. 자정 초기화 — 서버 시계를 23:59:40 로 밀고 실제로 넘긴다")
  const now = Date.now()
  const nextMidnightUtc = Math.ceil((now + KST + 1) / DAY_MS) * DAY_MS - KST
  const offset = nextMidnightUtc - 20_000 - now
  const M = await startServer(8962, { BOOTH_CLOCK_OFFSET_MS: String(offset), BOOTH_DAILY_CAPACITY: "3", BOOTH_RATE_PER_MIN: "100000" })

  const before = await M.get("/queue")
  const dayBefore = before.d.today
  console.log(`   서버가 생각하는 날짜: ${dayBefore} 23:59:40 (KST)`)

  const m1 = await book(M, "register", 1)
  const m2 = await book(M, "register", 2)
  const m3 = await book(M, "register", 3)
  ok("자정 전: 1·2·3번", [m1, m2, m3].map((x) => x.d.reservation?.teamNo).join() === "1,2,3")
  ok("자정 전: 정원 3 → 4번째 막힘", (await book(M, "register", 4)).s === 409)
  const lm = (await admin(M)).d.reservations.filter((r) => r.activity === "register")
  for (const r of lm) await M.post("/admin/complete", { password: PW, id: r.id })
  ok("자정 전: 완료 3 → 마감", (await M.post("/admin/close", { password: PW, activity: "register" })).s === 200)
  const leftover = await book(M, "seek", 10) // 자정 넘어서도 대기로 남을 예약
  ok("자정 전: 감각추구 대기 1명", leftover.d.reservation?.ahead === 0)
  ok("자정 전: 감각등록 마감 상태", (await M.get("/queue")).d.zones.register.shut === true)

  // 실제로 자정이 지나기를 기다린다
  let dayAfter = dayBefore
  for (let i = 0; i < 40 && dayAfter === dayBefore; i++) {
    await sleep(1000)
    dayAfter = (await M.get("/queue")).d.today
  }
  console.log(`   자정 통과 → 서버 날짜: ${dayAfter}`)
  ok("날짜가 하루 넘어갔다", dayAfter !== dayBefore && Date.parse(dayAfter) - Date.parse(dayBefore) === DAY_MS, `${dayBefore} → ${dayAfter}`)

  const qa = await M.get("/queue")
  ok("자정 후: 감각등록 마감 풀림(shut=false)", qa.d.zones.register.shut === false)
  ok("자정 후: 대기 수 전부 0", Object.values(qa.d.counts).every((n) => n === 0), JSON.stringify(qa.d.counts))
  const za = (await admin(M)).d.zones.register
  ok("자정 후: 완료 0, 마감 아님", za.done === 0 && za.closed === false)

  const n1 = await book(M, "register", 1) // 어제와 같은 번호로도 오늘은 새로 예약 가능
  ok("자정 후: 대기번호 1번부터 다시", n1.s === 200 && n1.d.reservation.teamNo === 1, `${n1.s} ${n1.d.reservation?.teamNo}`)
  ok("자정 후 새 예약의 날짜가 오늘", n1.d.reservation.day === dayAfter)
  const n2 = await book(M, "register", 2)
  ok("자정 후: 다음은 2번", n2.d.reservation?.teamNo === 2)

  const old = (await M.get(`/queue?id=${leftover.d.reservation.id}`)).d.mine
  ok("어제 대기로 남은 예약은 '만료'", old.status === "expired", old.status)
  ok("만료 예약의 순서는 없음(null) — '지금 입장해주세요' 오표시 방지", old.ahead === null, String(old.ahead))
  const leftSame = await book(M, "seek", 10)
  ok("어제 대기했던 번호로 오늘 새로 예약 가능(중복 아님)", leftSame.s === 200 && leftSame.d.reservation.teamNo === 1, `${leftSame.s} ${leftSame.d.error ?? ""}`)
  const doneOld = await M.post("/admin/complete", { password: PW, id: leftover.d.reservation.id })
  ok("만료 예약은 완료 처리 불가(409)", doneOld.s === 409)

  const all = (await admin(M)).d.reservations
  ok("어제 기록은 지워지지 않고 남아 있음(검색용)", all.filter((r) => r.day === dayBefore).length === 4, `${all.filter((r) => r.day === dayBefore).length}건`)
  ok("어제 완료 기록은 '완료'로 남음", all.filter((r) => r.day === dayBefore && r.status === "done").length === 3)
  await M.stop()

  /* ================================================================ F */
  console.log("\n━━ F. 한국 날짜 계산 — 서버가 UTC 로 돌아도 한국 00시에 바뀌는가")
  const kst = (iso) => new Date(Date.parse(iso) + KST).toISOString().slice(0, 10)
  ok("UTC 14:59:59 = 한국 23:59:59 → 같은 날", kst("2026-09-15T14:59:59.999Z") === "2026-09-15")
  ok("UTC 15:00:00 = 한국 00:00:00 → 다음 날", kst("2026-09-15T15:00:00.000Z") === "2026-09-16")
  ok("UTC 00:00 = 한국 09:00 → 날짜 안 바뀜(오전 9시 초기화 버그 없음)", kst("2026-09-16T00:00:00Z") === "2026-09-16")
  ok("연말 경계", kst("2026-12-31T15:00:00Z") === "2027-01-01")
  ok("윤년 2월 말", kst("2028-02-28T15:00:00Z") === "2028-02-29")
  const tzServer = await startServer(8966, { TZ: "UTC" })
  const tzDay = (await tzServer.get("/queue")).d.today
  ok("TZ=UTC 서버도 한국 날짜를 준다", tzDay === kst(new Date().toISOString()), `${tzDay} vs ${kst(new Date().toISOString())}`)
  await tzServer.stop()
  const tzServer2 = await startServer(8967, { TZ: "America/Los_Angeles" })
  ok("TZ=LA 서버도 한국 날짜를 준다", (await tzServer2.get("/queue")).d.today === kst(new Date().toISOString()))
  await tzServer2.stop()

  /* ================================================================ H */
  console.log("\n━━ H. 깨진 예약 파일을 덮어쓰지 않는가")
  const brokenDir = fs.mkdtempSync(path.join(os.tmpdir(), "booth-broken-"))
  fs.writeFileSync(path.join(brokenDir, "booth.json"), '{"reservations": [ {"id":"abc", 깨진 JSON')
  const B = await startServer(8963, { BOOTH_DATA_DIR: brokenDir })
  await book(B, "register", 1)
  await B.stop()
  const backups = fs.readdirSync(brokenDir).filter((f) => f.includes(".broken-"))
  ok("깨진 파일이 옆에 백업됨", backups.length === 1, backups.join(","))
  ok("백업에 원래 내용이 그대로", backups.length && fs.readFileSync(path.join(brokenDir, backups[0]), "utf8").includes("깨진 JSON"))

  console.log("\n━━ I. 기본 속도 제한(분당 60)이 한 반의 동시 예약을 막지 않는가")
  const R = await startServer(8964) // 기본값
  const burst = await Promise.all(Array.from({ length: 50 }, (_, i) => book(R, i % 2 ? "seek" : "register", 3000 + i)))
  ok("같은 IP 에서 50건 동시 예약 모두 성공", burst.every((x) => x.s === 200), `${burst.filter((x) => x.s !== 200).length}건 실패`)
  const reg = burst.filter((x, i) => i % 2 === 0).map((x) => x.d.reservation.teamNo).sort((a, b) => a - b)
  ok("동시 예약에도 번호 중복 없음(1..25)", reg.join() === Array.from({ length: 25 }, (_, i) => i + 1).join())
  await R.stop()
} catch (e) {
  fail++
  failures.push("예외: " + e.stack)
  console.error(e)
} finally {
  for (const s of servers) {
    try {
      s.kill()
    } catch {}
  }
}

console.log(`\n══════════════ 통과 ${pass} · 실패 ${fail}`)
if (fail) {
  console.log("실패 목록:")
  for (const f of failures) console.log("  - " + f)
  process.exitCode = 1
}
