/**
 * 체험 예약 — 수동 마감 · 마감해제(줄 초기화) · 자정 초기화 · 호출 규칙 전수 검증.
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
  console.log("\n━━ A. 정원 없음 — 100팀이 넘어도 저절로 닫히지 않는다")
  const S = await startServer(8961, { BOOTH_RATE_PER_MIN: "100000" })

  const first = await book(S, "register", 1)
  ok("첫 예약은 1번", first.d.reservation?.teamNo === 1, `teamNo=${first.d.reservation?.teamNo}`)

  const nos = [first.d.reservation.teamNo]
  let firstFail = null
  for (let i = 2; i <= 150; i++) {
    const r = await book(S, "register", i)
    if (r.s !== 200) firstFail ??= `${i}번째 ${r.s} ${r.d.error}`
    else nos.push(r.d.reservation.teamNo)
  }
  ok("1~150번째 예약 모두 성공 (100에서 막히지 않음)", firstFail === null, firstFail ?? "")
  ok("대기번호가 1..150 으로 빠짐없이 한 번씩", nos.length === 150 && nos.every((n, i) => n === i + 1))

  const q1 = await S.get("/queue")
  ok("150팀이어도 방문자 화면 shut=false", q1.d.zones?.register?.shut === false)
  ok("방문자 화면 대기 수 150", q1.d.counts?.register === 150, String(q1.d.counts?.register))
  ok("응답에 정원 값이 더는 없다", !("capacity" in q1.d))
  const zA = (await admin(S)).d.zones.register
  ok("운영 화면에도 정원·자동 마감 표시 없음", !("capacity" in zA) && !("full" in zA) && !("canClose" in zA), Object.keys(zA).join(","))

  console.log("\n━━ A2. 취소해도 번호는 재사용하지 않는다")
  const victim = (await admin(S)).d.reservations.find((r) => r.activity === "register" && r.teamNo === 50)
  ok("50번 취소", (await S.post("/admin/cancel", { password: PW, id: victim.id })).s === 200)
  const refill = await book(S, "register", 151)
  ok("새 번호는 151 (50을 재사용하지 않음)", refill.d.reservation?.teamNo === 151, String(refill.d.reservation?.teamNo))

  console.log("\n━━ B. 마감 — 완료 수와 상관없이 언제든")
  let z = (await admin(S)).d.zones.register
  ok("완료 0 인 상태", z.done === 0 && z.closed === false)
  const closeR = await S.post("/admin/close", { password: PW, activity: "register" })
  ok("완료 0 에서도 마감 성공", closeR.s === 200 && closeR.d.zones.register.closed === true, `${closeR.s} ${closeR.d.message ?? ""}`)
  const twice = await S.post("/admin/close", { password: PW, activity: "register" })
  ok("마감을 두 번 눌러도 문제없음", twice.s === 200 && twice.d.zones.register.closed === true)
  ok("마감 시각이 남는다", typeof twice.d.zones.register.closedAt === "string")

  const afterClose = await book(S, "register", 152)
  ok("마감 후 예약은 막힌다 (409 CLOSED)", afterClose.s === 409 && afterClose.d.error === "CLOSED")
  ok("막힌 이유는 closed", afterClose.d.reason === "closed", afterClose.d.reason)
  ok("막힐 때 문구가 정확하다", afterClose.d.message === "오늘은 마감되었어요. 내일 다시 만나요.", afterClose.d.message)
  const q2 = await S.get("/queue")
  ok("마감 후 방문자 화면 shut=true", q2.d.zones.register.shut === true)
  ok("마감 후 문구도 함께 내려간다", q2.d.closedMessage === "오늘은 마감되었어요. 내일 다시 만나요.")
  ok("마감은 다른 체험존에 번지지 않는다", q2.d.zones.seek.shut === false && q2.d.zones.sensitive.shut === false && q2.d.zones.avoid.shut === false)
  ok("다른 체험존은 그대로 예약된다(1번)", (await book(S, "seek", 500)).d.reservation?.teamNo === 1)
  ok("마감해도 이미 선 줄은 그대로(대기 150)", q2.d.counts.register === 150, String(q2.d.counts.register))

  const alreadyIn = await book(S, "register", 10) // 줄에 서 있는 사람이 다시 누르면
  ok("마감 뒤에도 줄에 선 사람은 자기 순서를 받는다(ALREADY_BOOKED)", alreadyIn.s === 409 && alreadyIn.d.error === "ALREADY_BOOKED")

  console.log("   … 접수 뒤 호출 대기 시간(6초)")
  await sleep(7000)
  const regWaiting = () =>
    admin(S).then(({ d }) => d.reservations.filter((r) => r.activity === "register" && r.status === "waiting").sort((a, b) => a.ahead - b.ahead))
  let rw = await regWaiting()
  for (const r of rw.slice(0, 3)) await S.post("/admin/complete", { password: PW, id: r.id })
  await sleep(500)
  rw = await regWaiting()
  ok("마감 중에도 체험 완료가 된다(대기 147)", rw.length === 147, String(rw.length))
  ok("마감 중에도 앞 5팀이 된 팀에게 호출이 간다", rw[5].calledAt && (await notices(S, rw[5].id)).includes("callup"), `${rw[5].teamNo}번`)
  const farOld = rw[10] // 앞 10팀 — 아직 호출되지 않은 팀
  ok("앞 10팀은 아직 호출 없음", JSON.stringify(await notices(S, farOld.id)) === '["booked"]')

  console.log("\n━━ B2. 마감해제 — 그 체험존의 줄이 처음부터 다시")
  const reopen = await S.post("/admin/reopen", { password: PW, activity: "register" })
  ok("마감 해제 성공", reopen.s === 200 && reopen.d.zones.register.closed === false)
  ok("해제가 초기화로 처리됨(reset=true)", reopen.d.reset === true)
  ok("남아 있던 대기 147팀이 줄에서 빠짐", reopen.d.dropped === 147, String(reopen.d.dropped))
  ok("해제 직후 대기 0", reopen.d.zones.register.waiting === 0)
  ok("해제 직후 완료 수도 0 (새 줄 기준)", reopen.d.zones.register.done === 0)
  ok("줄 순번 1", reopen.d.zones.register.round === 1)
  const q3 = await S.get("/queue")
  ok("해제 후 방문자 화면 shut=false", q3.d.zones.register.shut === false)
  ok("해제 후 방문자 화면 대기 0", q3.d.counts.register === 0)

  const fresh1 = await book(S, "register", 9001)
  ok("해제 후 첫 예약은 1번", fresh1.s === 200 && fresh1.d.reservation.teamNo === 1, `${fresh1.s} ${fresh1.d.reservation?.teamNo}`)
  ok("해제 후 첫 예약은 앞 0팀", fresh1.d.reservation.ahead === 0)
  ok("해제 후 첫 예약은 대기 1팀으로 보인다", fresh1.d.reservation.waiting === 1)

  const oldMine = (await S.get(`/queue?id=${farOld.id}`)).d.mine
  ok("빠진 예약의 상태는 'reset'", oldMine.status === "reset", oldMine.status)
  ok("빠진 예약의 순서는 없음(null)", oldMine.ahead === null)
  const rebook = await book(S, "register", Number(farOld.phone.slice(-8)) - 10000000)
  ok("빠진 사람도 다시 예약할 수 있다(중복 아님) → 2번", rebook.s === 200 && rebook.d.reservation.teamNo === 2, `${rebook.s} ${rebook.d.error ?? rebook.d.reservation?.teamNo}`)
  ok("빠진 예약은 체험 완료 불가(409)", (await S.post("/admin/complete", { password: PW, id: farOld.id })).s === 409)
  ok("빠진 예약은 취소도 불가(409)", (await S.post("/admin/cancel", { password: PW, id: farOld.id })).s === 409)

  const listB2 = (await admin(S)).d.reservations.filter((r) => r.activity === "register")
  ok("기록은 지워지지 않는다(151 + 새 2)", listB2.length === 153, String(listB2.length))
  ok("빠진 147팀은 상태 'reset'", listB2.filter((r) => r.status === "reset").length === 147)
  ok("완료 3·취소 1 은 그대로", listB2.filter((r) => r.status === "done").length === 3 && listB2.filter((r) => r.status === "cancelled").length === 1)
  ok("지금 줄(current)은 새 2팀뿐", listB2.filter((r) => r.current).map((r) => r.teamNo).sort().join() === "1,2")
  const onDisk = JSON.parse(fs.readFileSync(path.join(S.dataDir, "booth.json"), "utf8"))
  ok("파일에도 'reset' 으로 적힌다", onDisk.reservations.filter((r) => r.status === "reset").length === 147)
  const dayB = (await S.get("/queue")).d.today
  ok("파일에 초기화 시각이 남는다", onDisk.resets?.[dayB]?.register?.length === 1)

  const again = await S.post("/admin/reopen", { password: PW, activity: "register" })
  ok("해제를 두 번 눌러도 두 번째는 아무것도 안 함(reset=false)", again.s === 200 && again.d.reset === false && again.d.dropped === 0)
  ok("두 번째 해제 뒤에도 새 줄 2팀 그대로", again.d.zones.register.waiting === 2, String(again.d.zones.register.waiting))
  ok("두 번째 해제 뒤 다음 번호는 3", (await book(S, "register", 9003)).d.reservation?.teamNo === 3)

  const neverClosed = await S.post("/admin/reopen", { password: PW, activity: "seek" })
  ok("마감 안 된 체험존에 해제 요청 → 아무것도 안 함", neverClosed.d.reset === false && neverClosed.d.zones.seek.waiting === 1)

  console.log("   … 빠진 팀에게 호출이 가지 않는지 정기 점검(10초)까지 기다린다")
  await sleep(11000)
  ok("빠진 팀(앞 10팀이던)은 호출 문자 없음", JSON.stringify(await notices(S, farOld.id)) === '["booked"]', JSON.stringify(await notices(S, farOld.id)))
  const resetAt = Date.parse(reopen.d.zones.register.resetAt)
  const resetCalled = (await admin(S)).d.reservations.filter(
    (r) => r.status === "reset" && r.notices.some((n) => n.kind === "callup" && Date.parse(n.at) > resetAt)
  )
  ok("빠진 팀 누구에게도 새 호출이 가지 않았다", resetCalled.length === 0, `${resetCalled.length}건`)
  ok("새 줄 1번은 접수 + 호출", JSON.stringify(await notices(S, fresh1.d.reservation.id)) === '["booked","callup"]', JSON.stringify(await notices(S, fresh1.d.reservation.id)))

  console.log("\n━━ B3. 마감 → 해제를 한 번 더")
  await S.post("/admin/close", { password: PW, activity: "register" })
  ok("다시 마감되면 예약 막힘", (await book(S, "register", 9100)).s === 409)
  const reopen2 = await S.post("/admin/reopen", { password: PW, activity: "register" })
  ok("두 번째 초기화 — 새 줄 3팀이 빠짐", reopen2.d.reset === true && reopen2.d.dropped === 3, String(reopen2.d.dropped))
  ok("줄 순번 2", reopen2.d.zones.register.round === 2)
  ok("다시 1번부터", (await book(S, "register", 9101)).d.reservation?.teamNo === 1)

  const badAct = await S.post("/admin/close", { password: PW, activity: "toString" })
  ok("이상한 활동 이름으로 마감 요청 거절", badAct.s === 400)
  ok("이상한 활동 이름으로 해제 요청 거절", (await S.post("/admin/reopen", { password: PW, activity: "__proto__" })).s === 400)
  const badBook = await S.post("/reservations", { activity: "__proto__", name: "해커", phone: phone(9), dept: "x" })
  ok("이상한 활동 이름으로 예약 거절", badBook.s === 400)
  ok("비밀번호 틀리면 마감 불가", (await S.post("/admin/close", { password: "0000", activity: "seek" })).s === 401)
  ok("비밀번호 틀리면 해제 불가", (await S.post("/admin/reopen", { password: "0000", activity: "register" })).s === 401)
  ok("비밀번호 틀린 요청은 아무것도 바꾸지 않았다", (await S.get("/queue")).d.zones.seek.shut === false)

  const doneOne = (await admin(S)).d.reservations.find((r) => r.activity === "register" && r.status === "done")
  ok("이미 완료한 팀을 다시 완료할 수 없다", (await S.post("/admin/complete", { password: PW, id: doneOne.id })).s === 409)

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

  console.log("\n━━ G. 재시작해도 마감·초기화·번호가 유지되는가")
  await S.post("/admin/close", { password: PW, activity: "register" })
  const beforeRestart = (await admin(S)).d
  const seekMaxBefore = Math.max(...beforeRestart.reservations.filter((r) => r.activity === "seek").map((r) => r.teamNo))
  const resetCountBefore = beforeRestart.reservations.filter((r) => r.status === "reset").length
  const dataDir = S.dataDir
  await S.stop()
  const S2 = await startServer(8965, { BOOTH_DATA_DIR: dataDir, BOOTH_RATE_PER_MIN: "100000" })
  const after2 = (await admin(S2)).d
  const z2 = after2.zones.register
  ok("재시작 후 마감 유지", z2.closed === true)
  ok("재시작 후 줄 순번 유지(2)", z2.round === 2, String(z2.round))
  ok("재시작 후 지금 줄 대기 1팀 유지", z2.waiting === 1, String(z2.waiting))
  ok("재시작 후 'reset' 기록 유지", after2.reservations.filter((r) => r.status === "reset").length === resetCountBefore)
  ok("재시작 후에도 예약 막힘", (await book(S2, "register", 2000)).s === 409)
  const seekNext = await book(S2, "seek", 2001)
  ok(
    `재시작 후 번호가 이어진다(재시작 전 최대 ${seekMaxBefore} → ${seekMaxBefore + 1})`,
    seekNext.d.reservation?.teamNo === seekMaxBefore + 1,
    String(seekNext.d.reservation?.teamNo)
  )
  const reopen3 = await S2.post("/admin/reopen", { password: PW, activity: "register" })
  ok("재시작 후 해제도 초기화로 동작(대기 1팀 빠짐, 순번 3)", reopen3.d.reset === true && reopen3.d.dropped === 1 && reopen3.d.zones.register.round === 3)
  ok("재시작 후 해제 → 다시 1번", (await book(S2, "register", 2002)).d.reservation?.teamNo === 1)
  await S2.stop()

  /* ================================================================ C */
  console.log("\n━━ C. 자정 초기화 — 서버 시계를 23:59:40 로 밀고 실제로 넘긴다")
  const now = Date.now()
  const nextMidnightUtc = Math.ceil((now + KST + 1) / DAY_MS) * DAY_MS - KST
  const offset = nextMidnightUtc - 20_000 - now
  const M = await startServer(8962, { BOOTH_CLOCK_OFFSET_MS: String(offset), BOOTH_RATE_PER_MIN: "100000" })

  const before = await M.get("/queue")
  const dayBefore = before.d.today
  console.log(`   서버가 생각하는 날짜: ${dayBefore} 23:59:40 (KST)`)

  const m1 = await book(M, "register", 1)
  const m2 = await book(M, "register", 2)
  const m3 = await book(M, "register", 3)
  ok("자정 전: 1·2·3번", [m1, m2, m3].map((x) => x.d.reservation?.teamNo).join() === "1,2,3")
  const lm = (await admin(M)).d.reservations.filter((r) => r.activity === "register")
  for (const r of lm) await M.post("/admin/complete", { password: PW, id: r.id })
  ok("자정 전: 감각등록 마감", (await M.post("/admin/close", { password: PW, activity: "register" })).s === 200)
  // 감각추구는 자정 전에 마감 → 해제(초기화)를 한 번 해 둔다. 순번 1 인 줄에 남은 예약이 자정을 넘긴다.
  await book(M, "seek", 20)
  await M.post("/admin/close", { password: PW, activity: "seek" })
  const seekReset = await M.post("/admin/reopen", { password: PW, activity: "seek" })
  ok("자정 전: 감각추구 초기화(순번 1)", seekReset.d.reset === true && seekReset.d.zones.seek.round === 1)
  const leftover = await book(M, "seek", 10) // 자정 넘어서도 대기로 남을 예약
  ok("자정 전: 초기화 뒤 감각추구 1번 · 앞 0팀", leftover.d.reservation?.teamNo === 1 && leftover.d.reservation?.ahead === 0)
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
  const zAll = (await admin(M)).d.zones
  ok("자정 후: 완료 0, 마감 아님", zAll.register.done === 0 && zAll.register.closed === false)
  ok("자정 후: 줄 순번도 0 으로(어제 초기화는 어제 것)", zAll.seek.round === 0 && zAll.register.round === 0)

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
  ok("어제 기록은 지워지지 않고 남아 있음(검색용)", all.filter((r) => r.day === dayBefore).length === 5, `${all.filter((r) => r.day === dayBefore).length}건`)
  ok("어제 완료 기록은 '완료'로 남음", all.filter((r) => r.day === dayBefore && r.status === "done").length === 3)
  ok("어제 초기화로 빠진 기록은 '초기화'로 남음", all.filter((r) => r.day === dayBefore && r.status === "reset").length === 1)
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
