/**
 * 검토에서 찾은 문제들이 실제로 고쳐졌는지 — 문자 경로까지 그대로 태워 확인한다.
 *
 * 가짜 Solapi 서버를 이 프로세스 안에 띄우고 SOLAPI_BASE_URL 로 서버를 그쪽에 붙인다.
 * 가짜 서버는 받은 문자를 도착 시각과 함께 적고, 문자 종류별로 지연·실패를 흉내 낸다.
 * 진짜 문자는 한 통도 나가지 않는다.
 */
import http from "node:http"
import { spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

// 저장소 루트 — 이 파일이 tests/ 안에 있으므로 한 칸 위다.
const ROOT = fileURLToPath(new URL("..", import.meta.url))
const PW = "3618"
const KST = 9 * 3_600_000
const DAY_MS = 86_400_000
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const bytes = (t) => [...t].reduce((n, c) => n + (c.charCodeAt(0) > 127 ? 2 : 1), 0)

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

/* ---------------------------------------------------------- 가짜 Solapi */
const inbox = []
const mock = {
  bookedDelay: 0,
  callupDelay: 0,
  failCallups: 0, // 이 횟수만큼 호출 문자를 실패시킨다
  failAll: false,
}
const kindOf = (text) => (/접수되었습니다/.test(text) ? "booked" : /남았습니다|입장해주세요/.test(text) ? "callup" : "other")
const mockServer = http.createServer((req, res) => {
  let body = ""
  req.on("data", (d) => (body += d))
  req.on("end", async () => {
    const receivedAt = Date.now()
    let msg = {}
    try {
      msg = JSON.parse(body).message ?? {}
    } catch {}
    const kind = kindOf(msg.text ?? "")
    await sleep(kind === "booked" ? mock.bookedDelay : kind === "callup" ? mock.callupDelay : 0)
    let failed = mock.failAll
    if (kind === "callup" && mock.failCallups > 0) {
      mock.failCallups--
      failed = true
    }
    const entry = { to: msg.to, type: msg.type, text: msg.text, kind, receivedAt, answeredAt: Date.now(), failed }
    inbox.push(entry)
    res.setHeader("Content-Type", "application/json")
    if (failed) {
      res.statusCode = 400
      res.end(JSON.stringify({ errorCode: "Fake", errorMessage: "가짜 실패" }))
    } else {
      res.end(JSON.stringify({ statusCode: "2000", statusMessage: "정상 접수", messageId: "M" + receivedAt }))
    }
  })
})
await new Promise((r) => mockServer.listen(8990, "127.0.0.1", r))
const MOCK = "http://127.0.0.1:8990"
const reset = () => {
  inbox.length = 0
  Object.assign(mock, { bookedDelay: 0, callupDelay: 0, failCallups: 0, failAll: false })
}
const to = (n) => `010${String(30000000 + n).slice(-8)}`
const got = (n) => inbox.filter((m) => m.to === to(n))

/* ------------------------------------------------------------ 서버 띄우기 */
const servers = []
async function start(port, extra = {}, dataDir) {
  dataDir ??= fs.mkdtempSync(path.join(os.tmpdir(), `booth2-${port}-`))
  const env = {
    ...process.env,
    API_PORT: String(port),
    BOOTH_DATA_DIR: dataDir,
    BOOTH_ADMIN_PASSWORD: PW,
    BOOTH_RATE_PER_MIN: "100000",
    SOLAPI_BASE_URL: MOCK,
    SOLAPI_API_KEY: "K".repeat(16),
    SOLAPI_API_SECRET: "S".repeat(32),
    SMS_SENDER: "01000000000",
    ...extra,
  }
  const child = spawn(process.execPath, ["server/index.js"], { cwd: ROOT, env, stdio: "ignore" })
  servers.push(child)
  for (let i = 0; i < 60; i++) {
    await sleep(100)
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/booth/queue`)).ok) break
    } catch {}
  }
  const base = `http://127.0.0.1:${port}/api/booth`
  const post = async (p, b) => {
    const r = await fetch(base + p, { method: "POST", headers: { "Content-Type": "application/json", "X-Client-Build": "test" }, body: JSON.stringify(b) })
    return { s: r.status, d: await r.json().catch(() => ({})) }
  }
  const get = async (p) => (await fetch(base + p)).json()
  return {
    post,
    get,
    dataDir,
    book: (activity, n, name = `손님${n}`) => post("/reservations", { activity, name, phone: to(n), dept: "작업치료학과" }),
    admin: () => post("/admin/list", { password: PW }).then((x) => x.d),
    stop: async () => {
      child.kill()
      await sleep(400)
    },
  }
}

try {
  /* ============================================================ K */
  console.log("\n━━ K. 예약 6초 안에 체험 완료가 눌려도 호출은 접수 6초 뒤에")
  reset()
  let S = await start(8981)
  await S.book("register", 1) // A: 앞 0
  await sleep(7000) // A 호출 끝
  ok("A 는 접수 → 호출", got(1).map((m) => m.kind).join() === "booked,callup")
  const bRes = await S.book("register", 2) // B: 앞 1
  const listK = await S.admin()
  const aId = listK.reservations.find((r) => r.phone === to(1)).id
  await S.post("/admin/complete", { password: PW, id: aId }) // 곧바로 A 완료 → B 는 앞 0
  await sleep(300)
  ok("완료 직후에는 B 에게 호출이 아직 안 나감", got(2).map((m) => m.kind).join() === "booked", got(2).map((m) => m.kind).join())
  await sleep(6500)
  const b = got(2)
  ok("6초 뒤 B 에게 호출이 나감", b.map((m) => m.kind).join() === "booked,callup", b.map((m) => m.kind).join())
  if (b.length === 2) {
    const gap = b[1].receivedAt - b[0].answeredAt
    ok("B 의 접수→호출 간격 5.8초 이상", gap >= 5800, `${gap}ms`)
  }
  ok("B 의 호출 문구는 '지금 입장해주세요'", /지금 입장해주세요/.test(b[1]?.text ?? ""), b[1]?.text)
  ok("B 예약 응답이 정상", bRes.s === 200)

  console.log("\n━━ K2. 접수 문자가 느리게 가도 호출이 앞질러 나가지 않는다")
  reset()
  mock.bookedDelay = 1500
  mock.callupDelay = 200
  // seek: 앞에 한 팀(이미 호출된)을 세워 두고, 새 예약 직후 그 팀을 완료
  await S.book("seek", 10)
  await sleep(8000)
  const pBook = S.book("seek", 11) // 응답을 기다리지 않는다 — 접수 발송이 1.5초 걸리는 중
  await sleep(100)
  const l2 = await S.admin()
  await S.post("/admin/complete", { password: PW, id: l2.reservations.find((r) => r.phone === to(10)).id })
  await pBook
  await sleep(9000)
  const c = got(11)
  ok("느린 접수여도 순서는 접수 → 호출", c.map((m) => m.kind).join() === "booked,callup", c.map((m) => m.kind).join())
  if (c.length === 2) ok("호출이 접수 응답 뒤 5.8초 이상", c[1].receivedAt - c[0].answeredAt >= 5800, `${c[1].receivedAt - c[0].answeredAt}ms`)
  const rec = (await S.admin()).reservations.find((r) => r.phone === to(11))
  ok("기록 순서도 접수 → 호출", rec.notices.map((n) => n.kind).join() === "booked,callup", rec.notices.map((n) => n.kind).join())

  /* ============================================================ N */
  console.log("\n━━ N. 여러 통을 보내는 도중 취소·완료가 끼어들 때")
  reset()
  mock.callupDelay = 500
  const ids = []
  for (let i = 0; i < 6; i++) ids.push((await S.book("sensitive", 100 + i)).d.reservation.id)
  // 6초 뒤 첫 타이머가 6명을 한꺼번에 부른다 (한 통 0.5초 → 3초)
  await sleep(6000 + 700)
  let t0 = Date.now()
  await S.post("/admin/cancel", { password: PW, id: ids[5] }) // 6번 취소
  const cancelMs = Date.now() - t0
  ok("호출 발송 중에도 '취소' 버튼이 바로 응답(0.3초 안)", cancelMs < 300, `${cancelMs}ms`)
  t0 = Date.now()
  await S.post("/admin/complete", { password: PW, id: ids[0] }) // 1번 완료
  const completeMs = Date.now() - t0
  ok("호출 발송 중에도 '체험 완료' 버튼이 바로 응답(0.3초 안)", completeMs < 300, `${completeMs}ms`)
  await sleep(5000)
  ok("도중에 취소된 6번에게는 호출이 가지 않음", !got(105).some((m) => m.kind === "callup"), got(105).map((m) => m.kind).join())
  const r6 = (await S.admin()).reservations.find((r) => r.id === ids[5])
  ok("취소된 6번에 호출 표시가 남지 않음", r6.calledAt === null, String(r6.calledAt))
  const t5 = got(104).find((m) => m.kind === "callup")?.text ?? ""
  // 5번은 처음 앞 4팀. 발송 도중 1번이 완료됐으므로 보내는 순간에는 앞 3팀이어야 한다.
  ok("5번 호출 문구의 남은 팀 수가 보낸 순간 기준(1번 완료 반영 → 3팀)", t5.includes("3팀 남았습니다"), t5)
  const everyone = (await S.admin()).reservations
  const dupN = everyone.filter((r) => inbox.filter((m) => m.to === r.phone && m.kind === "callup").length > 1)
  ok("누구도 호출을 두 번 받지 않음", dupN.length === 0, dupN.map((r) => r.teamNo).join())
  await S.stop()

  /* ============================================================ M */
  console.log("\n━━ M. 호출 문자가 실패하면 '호출함'으로 남기지 않고 다시 보낸다")
  reset()
  mock.failCallups = 1 // 첫 호출만 실패
  S = await start(8982)
  await S.book("avoid", 200)
  await sleep(6800)
  let m1 = (await S.admin()).reservations[0]
  ok("첫 호출 실패 → calledAt 비움", m1.calledAt === null, String(m1.calledAt))
  ok("운영 화면 상태 'failed'", m1.callup === "failed", m1.callup)
  ok("실패 횟수 1", m1.callupFailures === 1)
  ok("실패 직후 곧바로 재시도하지 않음(시도 1번)", got(200).filter((m) => m.kind === "callup").length === 1)
  for (let i = 0; i < 30 && (await S.admin()).reservations[0].callup !== "sent"; i++) await sleep(1000)
  m1 = (await S.admin()).reservations[0]
  const tries200 = got(200).filter((m) => m.kind === "callup")
  if (tries200.length >= 2) ok("재시도는 실패 뒤 8초 이상 지나서", tries200[1].receivedAt - tries200[0].answeredAt >= 7800, )
  ok("정기 점검이 다시 보내 성공", m1.callup === "sent" && Boolean(m1.calledAt), `${m1.callup} ${m1.calledAt}`)
  ok("실제로 호출 두 번 시도(실패 1 + 성공 1)", got(200).filter((m) => m.kind === "callup").length === 2)
  ok("성공한 호출은 한 번뿐", got(200).filter((m) => m.kind === "callup" && !m.failed).length === 1)

  console.log("\n━━ M2. 계속 실패하면 3번에서 멈춘다(설정 오류로 무한히 두드리지 않음)")
  reset()
  mock.failCallups = 99
  await S.book("seek", 300)
  for (let i = 0; i < 60 && got(300).filter((m) => m.kind === "callup").length < 3; i++) await sleep(1000)
  await sleep(22000) // 세 번째 실패 뒤 두 번의 점검이 더 지나도 네 번째가 없는지
  const tries = got(300).filter((m) => m.kind === "callup").length
  ok("시도는 최대 3번", tries === 3, `${tries}번`)
  const m3 = (await S.admin()).reservations.find((r) => r.phone === to(300))
  ok("운영 화면에 '호출 실패'로 남음", m3.callup === "failed" && m3.callupFailures === 3, `${m3.callup} ${m3.callupFailures}`)
  await S.stop()

  /* ============================================================ O */
  console.log("\n━━ O. 예약 6초 안에 서버가 다시 떠도 호출이 사라지지 않는다")
  reset()
  S = await start(8983)
  const dir = S.dataDir
  await S.book("register", 400)
  await sleep(1000)
  await S.stop() // 타이머가 돌기 전에 죽인다
  ok("죽기 전엔 접수만", got(400).map((m) => m.kind).join() === "booked")
  S = await start(8984, {}, dir)
  await sleep(9000)
  ok("다시 뜬 뒤 호출이 나감", got(400).map((m) => m.kind).join() === "booked,callup", got(400).map((m) => m.kind).join())
  await S.stop()

  /* ============================================================ L */
  console.log("\n━━ L. 자정 직전 예약의 호출 타이머가 자정을 넘기면 보내지 않는다")
  reset()
  const now = Date.now()
  const nextMid = Math.ceil((now + KST + 1) / DAY_MS) * DAY_MS - KST
  S = await start(8985, { BOOTH_CLOCK_OFFSET_MS: String(nextMid - 3000 - now) }) // 23:59:57
  await S.book("register", 500) // 앞 0 — 6초 뒤면 자정 넘음
  await S.book("register", 501) // 앞 1
  await sleep(9000)
  ok("자정 넘어 만료된 예약에는 호출 없음(앞 0)", !got(500).some((m) => m.kind === "callup"), got(500).map((m) => m.kind).join())
  ok("자정 넘어 만료된 예약에는 호출 없음(앞 1)", !got(501).some((m) => m.kind === "callup"))
  const q = await S.get("/queue")
  ok("서버는 이미 다음 날", q.today !== new Date(nextMid - 3000 + KST).toISOString().slice(0, 10))
  await sleep(11000) // 정기 점검도 보내지 않는가
  ok("정기 점검도 만료 예약을 부르지 않음", !got(500).some((m) => m.kind === "callup"))
  await S.stop()

  /* ============================================================ P */
  console.log("\n━━ P. 긴 이름·큰 번호에서도 모든 문자가 SMS(90바이트 이하)")
  reset()
  S = await start(8986)
  const longNames = [
    "작업치료학과 3학년 김민지 외 2명", // 19자
    "가나다라마바사아자차카타파하가나다라마바", // 20자 한글
    "Kim Min-ji and friends from OT", // 영문 긴 이름 (20자 제한 넘음 → 거절돼야 함)
    "황보라라라",
  ]
  for (const [i, name] of longNames.entries()) {
    const r = await S.book("seek", 600 + i, name)
    if (name.length > 20) ok(`20자 넘는 이름은 거절: ${name.length}자`, r.s === 400)
    else ok(`예약 성공: ${name.length}자`, r.s === 200, `${r.s} ${r.d.error ?? ""}`)
  }
  await sleep(7500)
  const sent = inbox.filter((m) => m.kind !== "other")
  const over = sent.filter((m) => bytes(m.text) > 90 || m.type !== "SMS")
  ok("나간 문자 전부 SMS · 90바이트 이하", over.length === 0, over.map((m) => `${m.type} ${bytes(m.text)} ${m.text}`).join(" | "))
  console.log("     가장 긴 문자:", Math.max(...sent.map((m) => bytes(m.text))), "바이트")
  // 대기번호 네 자리까지 — 문구 함수만 따로 재 본다
  const probe = (name, no) => {
    const long = `[작업치료학과 프리지아] ${name}님, ${no}번으로 접수되었습니다. 5팀 남으면 연락드립니다.`
    return bytes(long)
  }
  ok("참고: 20자 이름 + 4자리 번호면 긴 머리말로는 넘친다(그래서 줄이는 장치가 필요)", probe("가".repeat(20), 1234) > 90)
  await S.stop()
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
  mockServer.close()
}

console.log(`\n══════════════ 통과 ${pass} · 실패 ${fail}`)
if (fail) {
  console.log("실패 목록:")
  for (const f of failures) console.log("  - " + f)
  process.exitCode = 1
}
