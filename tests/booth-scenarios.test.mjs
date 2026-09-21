/**
 * 체험 예약 — 문자가 "언제, 누구에게, 어떤 글자로" 나가는지 장면별로 직접 확인.
 *
 * 가짜 Solapi 서버를 띄우고 SOLAPI_BASE_URL 로 서버를 그쪽에 붙인다. 서버가 Solapi 에
 * 보내는 요청을 그대로 받아 적으므로, 실제로 나갔다면 휴대폰에 찍혔을 글자와 같다
 * (통신사가 앞에 붙이는 [Web발신] 만 빼고). **진짜 문자는 한 통도 나가지 않는다.**
 *
 * 장면
 *   1. 앞에 5팀 이상일 때 예약하면
 *   2. 앞에 6팀 → 한 팀 체험 완료 → 5팀
 *   3. 앞에 6팀 → 한 팀 취소 → 한 팀 체험 완료 → 4팀 (관리자 취소 / 사용자 취소 / 순서 바꿔서 / 동시에)
 */
import http from "node:http"
import { spawn } from "node:child_process"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = fileURLToPath(new URL("..", import.meta.url))
const PW = "3618"
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const bytes = (t) => [...t].reduce((n, c) => n + (c.charCodeAt(0) > 127 ? 2 : 1), 0)
const VERBOSE = !process.argv.includes("--quiet")

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
const mockServer = http.createServer((req, res) => {
  let body = ""
  req.on("data", (d) => (body += d))
  req.on("end", () => {
    let msg = {}
    try {
      msg = JSON.parse(body).message ?? {}
    } catch {}
    inbox.push({ to: msg.to, type: msg.type, subject: msg.subject, text: msg.text ?? "", at: Date.now() })
    res.setHeader("Content-Type", "application/json")
    res.end(JSON.stringify({ statusCode: "2000", statusMessage: "정상 접수", messageId: "M" + Date.now() }))
  })
})
await new Promise((r) => mockServer.listen(8991, "127.0.0.1", r))

/* ------------------------------------------------------------ 서버 */
const children = []
async function start(port) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), `booth-scn-${port}-`))
  const child = spawn(process.execPath, ["server/index.js"], {
    cwd: ROOT,
    env: {
      ...process.env,
      API_PORT: String(port),
      API_HOST: "127.0.0.1",
      BOOTH_DATA_DIR: dataDir,
      BOOTH_ADMIN_PASSWORD: PW,
      BOOTH_RATE_PER_MIN: "100000",
      SOLAPI_BASE_URL: "http://127.0.0.1:8991",
      SOLAPI_API_KEY: "K".repeat(16),
      SOLAPI_API_SECRET: "S".repeat(32),
      SMS_SENDER: "01000000000",
    },
    stdio: "ignore",
  })
  children.push(child)
  const base = `http://127.0.0.1:${port}/api/booth`
  for (let i = 0; i < 60; i++) {
    await sleep(100)
    try {
      if ((await fetch(base + "/queue")).ok) break
    } catch {}
  }
  const post = async (p, b) => {
    const r = await fetch(base + p, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Client-Build": "test" },
      body: JSON.stringify(b),
    })
    return { s: r.status, d: await r.json().catch(() => ({})) }
  }
  const get = async (p) => {
    const r = await fetch(base + p)
    return { s: r.status, d: await r.json().catch(() => ({})) }
  }
  return {
    post,
    get,
    stop: async () => {
      child.kill()
      await sleep(300)
    },
  }
}

/* ------------------------------------------------------------ 도구 */
const NAMES = ["김하나", "이두리", "박세나", "최네오", "정다섯", "강여섯", "조일곱", "윤여덟", "장아홉", "임열", "한열하나", "오열둘"]
let serial = 0
const phoneOf = (n) => `010${String(40000000 + n).slice(-8)}`

/** 한 체험존에 k팀을 세운다. 돌려주는 것: [{ n, name, phone, id, teamNo }] */
async function line(S, activity, k) {
  const out = []
  for (let i = 0; i < k; i++) {
    const n = ++serial
    const name = NAMES[(n - 1) % NAMES.length]
    const r = await S.post("/reservations", { activity, name, phone: phoneOf(n), dept: "작업치료학과" })
    out.push({ n, name, phone: phoneOf(n), id: r.d.reservation.id, key: r.d.cancelKey, teamNo: r.d.reservation.teamNo, ahead: r.d.reservation.ahead })
  }
  return out
}
const msgsTo = (p) => inbox.filter((m) => m.to === p)
const since = (t) => inbox.filter((m) => m.at >= t)
const show = (list, who) => {
  if (!VERBOSE) return
  if (!list.length) console.log("       (문자 없음)")
  for (const m of list) {
    const person = who.find((w) => w.phone === m.to)
    console.log(`       → ${person ? `${person.teamNo}번 ${person.name}` : m.to}  [${m.type}·${bytes(m.text)}B] ${m.text}`)
  }
}
const ahead = async (S, id) => (await S.get(`/queue?id=${id}`)).d.mine?.ahead
/** 접수 문자가 나가고 6초가 지나야 호출 대상이 된다(서버 규칙). 그만큼 기다린다. */
const settleCalls = () => sleep(7000)

/** 본인 취소 — 예약할 때 받은 열쇠와 함께. */
async function userCancel(S, who) {
  return S.post("/reservations/cancel", { id: who.id, key: who.key })
}

let port = 9401 // 8991 은 가짜 Solapi 가 쓴다 — 겹치지 않는 곳에서
/** 장면마다 빈 줄에서 시작한다 — 앞 장면의 대기 팀이 섞이면 "앞 N팀"이 달라진다. */
const fresh = async () => {
  if (globalThis.__S) await globalThis.__S.stop()
  globalThis.__S = await start(port++)
  return globalThis.__S
}

try {
  let S = await fresh()

  /* ============================================================ 1 */
  console.log("\n━━ 장면 1. 앞에 5팀 이상일 때 예약하면")
  const z1 = await line(S, "register", 7) // 1~7번
  await settleCalls()
  let t = Date.now()
  const x1 = (await line(S, "register", 1))[0] // 8번 — 앞 7팀
  await settleCalls()
  if (VERBOSE) console.log(`   8번 ${x1.name} 예약 (앞 ${x1.ahead}팀) 뒤 나간 문자:`)
  show(since(t), [...z1, x1])
  const m1 = msgsTo(x1.phone)
  ok("앞 7팀: 접수 문자 한 통만", m1.length === 1)
  ok("접수 문자 글자", m1[0]?.text === `[작업치료학과 프리지아] ${x1.name}님, 8번으로 접수되었습니다. 5팀 남으면 연락드립니다.`, m1[0]?.text)
  ok("접수 문자는 SMS(90바이트 이하, 제목 없음)", m1[0]?.type === "SMS" && bytes(m1[0].text) <= 90 && !m1[0].subject)

  // 경계: 앞 5팀 / 앞 6팀으로 예약
  const z1b = await line(S, "seek", 5)
  await settleCalls()
  t = Date.now()
  const at5 = (await line(S, "seek", 1))[0] // 앞 5팀
  const at6 = (await line(S, "seek", 1))[0] // 앞 6팀
  await settleCalls()
  if (VERBOSE) console.log(`   (경계) 앞 5팀으로 예약한 ${at5.name}, 앞 6팀으로 예약한 ${at6.name} 에게 나간 문자:`)
  show(since(t), [...z1b, at5, at6])
  ok("앞 정확히 5팀으로 예약: 접수 + 6초 뒤 호출(5팀 남았습니다)", msgsTo(at5.phone).map((m) => m.text).join(" | ") ===
    `[작업치료학과 프리지아] ${at5.name}님, 6번으로 접수되었습니다. 5팀 남으면 연락드립니다. | ${at5.name}님, 5팀 남았습니다. 부스 앞에서 대기해주세요.`,
    msgsTo(at5.phone).map((m) => m.text).join(" | "))
  ok("앞 6팀으로 예약: 접수 한 통만", msgsTo(at6.phone).length === 1)

  /* ============================================================ 2 */
  console.log("\n━━ 장면 2. 앞에 6팀 → 한 팀 체험 완료 → 5팀")
  S = await fresh()
  const z2 = await line(S, "sensitive", 6)
  const x2 = (await line(S, "sensitive", 1))[0] // 7번 — 앞 6팀
  await settleCalls()
  ok("시작: 앞 6팀", (await ahead(S, x2.id)) === 6)
  ok("앞 6팀일 때는 접수 문자만", msgsTo(x2.phone).length === 1)
  t = Date.now()
  await S.post("/admin/complete", { password: PW, id: z2[0].id })
  await sleep(800)
  if (VERBOSE) console.log(`   1번 체험 완료 → 7번 ${x2.name} 앞 ${await ahead(S, x2.id)}팀. 그 순간 나간 문자:`)
  show(since(t), [...z2, x2])
  ok("완료 뒤 앞 5팀", (await ahead(S, x2.id)) === 5)
  const c2 = msgsTo(x2.phone).slice(1)
  ok("그 순간 호출 문자 한 통", c2.length === 1)
  ok("호출 문자 글자", c2[0]?.text === `${x2.name}님, 5팀 남았습니다. 부스 앞에서 대기해주세요.`, c2[0]?.text)
  ok("다른 사람에게는 새 문자 없음(앞 팀들은 이미 받았다)", since(t).every((m) => m.to === x2.phone))

  /* ============================================================ 3 */
  const scene3 = async (label, activity, first, second, cancelKind) => {
    S = await fresh()
    console.log(`\n━━ 장면 3${label}. 앞에 6팀 → ${first === "cancel" ? "한 팀 취소" : "한 팀 체험 완료"} → ${second === "cancel" ? "한 팀 취소" : "한 팀 체험 완료"} → 4팀 (${cancelKind === "user" ? "사용자 취소" : "관리자 취소"})`)
    const z = await line(S, activity, 6)
    const x = (await line(S, activity, 1))[0]
    await settleCalls()
    ok(`${label} 시작: 앞 6팀, 접수 문자만`, (await ahead(S, x.id)) === 6 && msgsTo(x.phone).length === 1)
    const doIt = async (what, target) => {
      if (what === "complete") return S.post("/admin/complete", { password: PW, id: target.id })
      if (cancelKind === "user") return userCancel(S, target)
      return S.post("/admin/cancel", { password: PW, id: target.id })
    }
    // 취소는 줄 가운데(3번째) 팀, 완료는 맨 앞 팀
    const targets = { cancel: z[2], complete: z[0] }
    let t1 = Date.now()
    const r1 = await doIt(first, targets[first])
    ok(`${label} 첫 동작 성공`, r1.s === 200, `${r1.s} ${r1.d.error ?? ""}`)
    await sleep(800)
    const a1 = await ahead(S, x.id)
    if (VERBOSE) console.log(`   ${first === "cancel" ? `${targets.cancel.teamNo}번 취소` : `${targets.complete.teamNo}번 체험 완료`} → ${x.teamNo}번 ${x.name} 앞 ${a1}팀. 나간 문자:`)
    show(since(t1), [...z, x])
    ok(`${label} 첫 동작 뒤 앞 5팀`, a1 === 5)
    ok(`${label} 5팀이 되는 순간 호출 한 통: "${x.name}님, 5팀 남았습니다…"`, since(t1).filter((m) => m.to === x.phone).map((m) => m.text).join() === `${x.name}님, 5팀 남았습니다. 부스 앞에서 대기해주세요.`,
      since(t1).map((m) => m.text).join(" | "))
    const t2 = Date.now()
    const r2 = await doIt(second, targets[second])
    ok(`${label} 둘째 동작 성공`, r2.s === 200, `${r2.s} ${r2.d.error ?? ""}`)
    await sleep(800)
    const a2 = await ahead(S, x.id)
    if (VERBOSE) console.log(`   ${second === "cancel" ? `${targets.cancel.teamNo}번 취소` : `${targets.complete.teamNo}번 체험 완료`} → ${x.teamNo}번 ${x.name} 앞 ${a2}팀. 나간 문자:`)
    show(since(t2), [...z, x])
    ok(`${label} 둘째 동작 뒤 앞 4팀`, a2 === 4)
    ok(`${label} 4팀이 될 때는 새 문자 없음(호출은 한 사람에게 한 번)`, since(t2).length === 0, since(t2).map((m) => m.text).join(" | "))
    ok(`${label} 이 사람이 받은 문자는 모두 두 통(접수·호출)`, msgsTo(x.phone).length === 2)
    return x
  }

  await scene3("-가", "avoid", "cancel", "complete", "admin")
  await scene3("-나", "register", "cancel", "complete", "user")
  await scene3("-다", "seek", "complete", "cancel", "user")

  console.log("\n━━ 장면 3-라. 앞에 6팀에서 취소와 완료가 거의 같은 순간(0.05초 차)에 눌리면")
  S = await fresh()
  const zr = await line(S, "sensitive", 6)
  const xr = (await line(S, "sensitive", 1))[0]
  await settleCalls()
  const tr = Date.now()
  await Promise.all([
    S.post("/admin/cancel", { password: PW, id: zr[2].id }),
    sleep(50).then(() => S.post("/admin/complete", { password: PW, id: zr[0].id })),
  ])
  await sleep(1000)
  if (VERBOSE) console.log(`   → ${xr.teamNo}번 ${xr.name} 앞 ${await ahead(S, xr.id)}팀. 나간 문자:`)
  show(since(tr), [...zr, xr])
  const cr = since(tr).filter((m) => m.to === xr.phone)
  ok("거의 동시여도 호출은 한 통", cr.length === 1, String(cr.length))
  ok("남은 팀 수는 보내는 순간의 값(5 또는 4)", /^.+님, [45]팀 남았습니다\. 부스 앞에서 대기해주세요\.$/.test(cr[0]?.text ?? ""), cr[0]?.text)

  console.log("\n━━ 모든 문자 점검")
  ok("나간 문자 전부 SMS", inbox.every((m) => m.type === "SMS"), [...new Set(inbox.map((m) => m.type))].join())
  ok("전부 90바이트 이하", inbox.every((m) => bytes(m.text) <= 90), String(Math.max(...inbox.map((m) => bytes(m.text)))))
  const perPerson = new Map()
  for (const m of inbox) perPerson.set(m.to, [...(perPerson.get(m.to) ?? []), m.text])
  const doubleCall = [...perPerson.values()].filter((list) => list.filter((x) => /남았습니다|입장해주세요/.test(x)).length > 1)
  ok("누구도 호출 문자를 두 번 받지 않았다", doubleCall.length === 0, String(doubleCall.length))
  const badOrder = [...perPerson.values()].filter((list) => list.length > 1 && !/접수되었습니다/.test(list[0]))
  ok("모두 접수 문자를 먼저 받았다", badOrder.length === 0)
  console.log(`   총 ${inbox.length}통 (${perPerson.size}명)`)
  await globalThis.__S?.stop()
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
  mockServer.close()
}

console.log(`\n══════════════ 통과 ${pass} · 실패 ${fail}`)
if (fail) {
  console.log("실패 목록:")
  for (const f of failures) console.log("  - " + f)
  process.exitCode = 1
}
