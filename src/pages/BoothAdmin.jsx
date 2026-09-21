import { useCallback, useEffect, useRef, useState } from "react"

import {
  adminCancel,
  adminClose,
  adminComplete,
  adminList,
  adminReopen,
  adminTest,
  formatPhone,
  zoneConfirmText,
} from "../lib/booth.js"
import { readPassword, savePassword } from "../lib/adminSession.js"
import { holdReload } from "../lib/build.js"
import { signalZonesChanged, useLive } from "../lib/live.js"
import "../components/booth.css"

/** 줄에서 빠진 이유 한 마디. 방문자가 자기 화면에서 취소하면 "사용자 취소", 이 화면의 취소 버튼은 "관리자 취소". */
const endLabel = (r) =>
  r.status === "done" ? "완료" : r.status === "cancelled" ? (r.cancelledBy === "user" ? "사용자 취소" : "관리자 취소") : ""

/** " · 완료 3 · 사용자 취소 1 · 관리자 취소 2" — 0 인 것은 뺀다. */
const endCounts = (list) => {
  const n = (pred) => list.filter(pred).length
  const parts = [
    ["완료", n((r) => r.status === "done")],
    ["사용자 취소", n((r) => r.status === "cancelled" && r.cancelledBy === "user")],
    ["관리자 취소", n((r) => r.status === "cancelled" && r.cancelledBy !== "user")],
  ].filter(([, k]) => k > 0)
  return parts.map(([label, k]) => ` · ${label} ${k}`).join("")
}

const timeOf = (iso) => {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? "" : d.toTimeString().slice(0, 5)
}

/**
 * 운영 화면. 푸터 로고를 다섯 번 누르고 비밀번호를 넣으면 열린다.
 *
 * 비밀번호는 서버가 확인한다 — 화면 코드에는 정답이 없고, 목록을 부르는 요청마다
 * 함께 보낸다. 그래서 번들을 뜯어봐도 예약자 명단은 나오지 않는다.
 */
export default function BoothAdmin() {
  const [password, setPassword] = useState(readPassword)
  const [data, setData] = useState(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState("")
  /** 마감·해제를 보내는 중인 체험존. 줄의 완료·취소와 따로 센다. */
  const [zoneBusy, setZoneBusy] = useState("")
  /** 체험존마다 방금 누른 결과 한 줄. 화면 맨 위가 아니라 그 버튼 바로 밑에 띄운다. */
  const [zoneNotes, setZoneNotes] = useState({})
  const [query, setQuery] = useState("")
  /** 같은 순간 두 번 눌려도 한 번만 보낸다. 상태는 다음 그림에서야 바뀐다. */
  const zoneBusyRef = useRef(false)
  /**
   * 목록 요청 순번. 누르기 전에 출발한 목록 응답이 늦게 도착해 방금 바뀐 버튼과 줄을
   * 옛 모양으로 되돌리던 경합을 막는다 — 이미 반영한 것보다 나중에 출발한 응답만 받고,
   * 무언가를 누르면 그때까지 출발한 요청을 모두 낡은 것으로 친다.
   */
  const seqRef = useRef(0)
  const appliedRef = useRef(0)
  const settle = () => {
    appliedRef.current = seqRef.current
  }

  const load = useCallback(async () => {
    if (!password) return
    const seq = ++seqRef.current
    try {
      const next = await adminList(password)
      if (seq <= appliedRef.current) return true
      appliedRef.current = seq
      setData(next)
      setError("")
      return true
    } catch (e) {
      if (seq !== seqRef.current || seq <= appliedRef.current) return false
      setError(e.message)
      if (e.code === "BAD_PASSWORD") {
        setPassword("")
        savePassword("")
      }
      return false
    }
  }, [password])

  // 처음 한 번, 서버가 "바뀌었다"고 알릴 때, 화면이 다시 보일 때, 그리고 주기적으로.
  // 이 화면은 한 번에 명단 전체를 받으므로, 줄이 몰릴 때는 알림을 1초씩 묶는다.
  // (내가 누른 것은 서버의 답으로 곧바로 반영하니 이 간격과 상관없다.)
  useLive(load, { fastMs: 5000, slowMs: 15000, minGapMs: 1000 })
  // 이 화면에서 비밀번호를 막 넣은 경우 — 다음 주기를 기다리지 않고 곧바로 부른다.
  useEffect(() => {
    load()
  }, [load])

  if (!password) return <Gate onPass={(pw) => { savePassword(pw); setPassword(pw) }} />

  /**
   * 체험 완료·관리자 취소. 실패 이유(예: 방문자가 방금 스스로 취소했다)는 그 체험존 밑에
   * 남긴다 — 화면 맨 위에 띄우면 곧이어 도는 목록 새로고침이 몇 밀리초 만에 지워 버렸다.
   */
  const act = async (fn, id, activity) => {
    setBusy(id)
    settle()
    holdReload(15000)
    try {
      await fn(password, id)
      setZoneNotes((n) => (n[activity]?.error ? { ...n, [activity]: null } : n))
      // 그 줄을 곧바로 목록에서 뺀다. 명단을 다시 받아 오는 몇 초 동안 버튼이 다시 살아 있으면
      // 운영자가 한 번 더 누르고 "이미 끝난 예약"을 보게 된다.
      const status = fn === adminComplete ? "done" : "cancelled"
      const cancelledBy = status === "cancelled" ? "admin" : null
      setData((d) =>
        d
          ? {
              ...d,
              reservations: d.reservations.map((r) =>
                r.id === id ? { ...r, status, cancelledBy, doneAt: new Date().toISOString() } : r
              ),
            }
          : d
      )
      signalZonesChanged()
    } catch (e) {
      setZoneNotes((n) => ({ ...n, [activity]: { text: e.message, error: true } }))
    } finally {
      settle()
      setBusy("")
    }
    // 성공이든 실패든 실제 상태로 맞춘다 — 다른 기기가 먼저 끝낸 줄(409)도 곧바로 사라진다.
    load()
  }

  /**
   * 마감·해제. 마감은 새 예약을 모두 막고, 해제는 그 체험존의 줄을 처음부터 다시
   * 시작하므로(대기 0, 다음 예약 1번) 둘 다 한 번 더 묻는다.
   *
   * 버튼은 **서버의 답으로 곧바로** 바꾼다. 예전에는 답을 버리고 목록 전체를 다시
   * 받아 온 뒤에야 바뀌어서, 느린 연결에서는 눌러도 그대로인 것처럼 보였다.
   */
  const toggleZone = async (id, label, closing) => {
    if (zoneBusyRef.current) return
    const waitingNow = data?.zones?.[id]?.waiting ?? 0
    if (!window.confirm(zoneConfirmText(label, closing, waitingNow))) return
    zoneBusyRef.current = true
    setZoneBusy(id)
    setZoneNotes((n) => ({ ...n, [id]: null }))
    settle()
    holdReload(15000)
    try {
      const res = await (closing ? adminClose : adminReopen)(password, id)
      settle()
      setData((d) => (d && res.zones ? { ...d, zones: res.zones } : d))
      signalZonesChanged()
      const text = closing
        ? "마감했습니다. 새 예약을 받지 않습니다."
        : res.reset === false
          ? "이미 예약을 받는 중이라 초기화하지 않았습니다."
          : `마감을 해제했습니다. ${res.dropped ? `대기 ${res.dropped}팀을 빼고 ` : ""}1번부터 다시 받습니다.`
      setZoneNotes((n) => ({ ...n, [id]: { text, closed: Boolean(res.zones?.[id]?.closed) } }))
    } catch (e) {
      setZoneNotes((n) => ({ ...n, [id]: { text: e.message, error: true } }))
    } finally {
      settle()
      zoneBusyRef.current = false
      setZoneBusy("")
    }
    load()
  }

  const activities = data?.activities ?? {}
  const rows = data?.reservations ?? []
  const zones = data?.zones ?? {}
  const today = data?.today ?? ""
  // 줄과 버튼은 **오늘의 지금 줄** 것만. 지난날 기록과 초기화 전 줄은 이름 검색에서 찾는다.
  const todayRows = rows.filter((r) => r.current)

  return (
    <div className="admin">
      <header className="admin__head">
        <h1>체험 예약 현황</h1>
        <button className="admin__ghost" type="button" onClick={() => load()}>
          새로고침
        </button>
      </header>

      {error ? <p className="book__error" role="alert">{error}</p> : null}

      {today ? (
        <p className="admin__today">{today} · 00시에 초기화</p>
      ) : null}

      <ul className="admin__counts">
        {Object.entries(activities).map(([id, a]) => {
          const z = zones[id] ?? {}
          return (
            <li key={id} className={z.closed ? "is-closed" : undefined}>
              <span>{a.label}</span>
              <strong>대기 {z.waiting ?? 0}팀</strong>
              <em>
                완료 {z.done ?? 0}
                {z.closed ? " · 마감" : ""}
              </em>
            </li>
          )
        })}
      </ul>

      <NotifyLine notify={data?.notify} password={password} />

      <Search query={query} onQuery={setQuery} rows={rows} activities={activities} today={today} />

      {Object.entries(activities).map(([id, a]) => {
        const z = zones[id] ?? {}
        const waiting = todayRows
          .filter((r) => r.activity === id && r.status === "waiting")
          .sort((x, y) => (x.ahead ?? 0) - (y.ahead ?? 0))
        // 끝난 팀은 방금 끝난 것부터 — 방문자가 막 취소한 팀이 맨 위에 보이게.
        const closed = todayRows
          .filter((r) => r.activity === id && r.status !== "waiting")
          .sort((x, y) => String(y.doneAt ?? "").localeCompare(String(x.doneAt ?? "")))
        return (
          <section className="admin__group" key={id}>
            <h2>
              {a.label} <span>{a.title}</span>
            </h2>

            <ZoneBar
              zone={z}
              busy={zoneBusy === id}
              locked={Boolean(zoneBusy)}
              note={zoneNotes[id]}
              onClose={() => toggleZone(id, a.label, true)}
              onReopen={() => toggleZone(id, a.label, false)}
            />

            {waiting.length === 0 ? (
              <p className="admin__empty">대기 중인 팀이 없습니다.</p>
            ) : (
              <ol className="admin__list">
                {waiting.map((r) => (
                  <li className="admin__row" key={r.id}>
                    <span className="admin__no">{r.teamNo}</span>
                    <div className="admin__who">
                      <strong>{r.name}</strong>
                      <span>
                        {formatPhone(r.phone)} · {r.dept} · {timeOf(r.createdAt)} 접수
                        <CallupNote state={r.callup} />
                      </span>
                    </div>
                    <div className="admin__acts">
                      <button
                        className="admin__done"
                        type="button"
                        disabled={busy === r.id}
                        onClick={() => act(adminComplete, r.id, id)}
                      >
                        체험 완료
                      </button>
                      <button
                        className="admin__ghost"
                        type="button"
                        disabled={busy === r.id}
                        onClick={() => act(adminCancel, r.id, id)}
                      >
                        취소
                      </button>
                    </div>
                  </li>
                ))}
              </ol>
            )}

            {closed.length ? (
              <>
                {/* 가장 최근에 끝난 팀 한 줄은 늘 보인다 — 취소를 누르면 곧바로 "관리자 취소",
                    방문자가 취소하면 곧바로 "사용자 취소"가 여기에 뜬다. */}
                <p className="admin__last">
                  최근 {closed[0].teamNo}번 {closed[0].name} ·{" "}
                  <span className={closed[0].cancelledBy === "user" ? "end end--user" : "end"}>{endLabel(closed[0])}</span>{" "}
                  {timeOf(closed[0].doneAt)}
                </p>
              <details className="admin__closed">
                <summary>
                  끝난 팀 {closed.length}
                  {endCounts(closed)}
                </summary>
                <ul>
                  {closed.map((r) => (
                    <li key={r.id}>
                      {r.teamNo}번 {r.name} · <span className={r.cancelledBy === "user" ? "end end--user" : "end"}>{endLabel(r)}</span> {timeOf(r.doneAt)}
                    </li>
                  ))}
                </ul>
              </details>
              </>
            ) : null}
          </section>
        )
      })}
    </div>
  )
}

/**
 * 호출 문자 상태 한 마디. "호출함"은 실제로 나갔을 때만 쓴다 — 실패했는데
 * 호출함으로 보이면 운영자는 불렀다고 믿고 기다린다.
 */
function CallupNote({ state }) {
  if (state === "sent") return <> · 호출함</>
  if (state === "skipped") return <> · 호출할 차례(문자 미연결)</>
  if (state === "failed") return <b className="callup-fail"> · 호출 문자 실패 — 직접 불러 주세요</b>
  return null
}

/**
 * 체험존 하나의 상태와 마감 버튼. 마감은 언제든 누를 수 있고(정원으로 저절로
 * 닫히는 일은 없다), 마감된 체험존은 버튼이 "마감해제"로 바뀐다. 해제하면 그
 * 체험존의 줄이 처음부터 다시 시작한다.
 */
function ZoneBar({ zone, busy, locked, note, onClose, onReopen }) {
  const done = zone.done ?? 0
  const since = zone.resetAt ? ` · ${timeOf(zone.resetAt)} 초기화` : ""
  // 결과 한 줄은 그 결과가 아직 맞을 때만. 다른 기기가 상태를 바꿨으면 감춘다.
  const line = note && (note.error || note.closed === Boolean(zone.closed)) ? (
    <p className={note.error ? "zone__note zone__note--error" : "zone__note"} role={note.error ? "alert" : "status"}>
      {note.text}
    </p>
  ) : null

  if (zone.closed) {
    return (
      <>
        <div className="zone zone--closed">
          <span>
            <b>마감됨</b>
            {zone.closedAt ? ` · ${timeOf(zone.closedAt)}` : ""}
          </span>
          <button className="zone__open" type="button" disabled={locked} onClick={onReopen}>
            {busy ? "처리 중" : "마감해제"}
          </button>
        </div>
        {line}
      </>
    )
  }

  return (
    <>
      <div className="zone">
        <span>
          <b>예약 받는 중</b> · 완료 {done}팀{since}
        </span>
        <button className="zone__close" type="button" disabled={locked} onClick={onClose}>
          {busy ? "처리 중" : "마감"}
        </button>
      </div>
      {line}
    </>
  )
}

/**
 * 키 하나의 상태를 글자 수와 지문으로 보여 준다.
 *
 * 길이만으로는 부족하다 — 32자인데 다른 값일 수도 있다. 앞 여섯 자리 해시를
 * 함께 띄우면 올바른 값의 지문과 눈으로 대조할 수 있고, 원문은 새지 않는다.
 */
function Shape({ len, want, fp }) {
  const ok = len === want
  return (
    <b className={ok ? "shape shape--ok" : "shape shape--bad"}>
      {len}자{ok ? "" : ` (${want}자여야 함)`} · {fp || "—"}
    </b>
  )
}

/**
 * 한 사람이 무엇을 잡아 뒀는지.
 *
 * 부스에서 "제가 예약했는데요"라고 오는 사람을 이름으로 찾는 자리다. 활동이 넷이라
 * 한 사람이 여러 줄에 서 있을 수 있어서, **그 사람 이름으로 걸린 예약을 전부 모아**
 * 활동별 상태를 한눈에 보여 준다. 번호 뒷자리로도 찾을 수 있다 — 동명이인이 있으면
 * 이름만으로는 가릴 수 없기 때문이다.
 */
function Search({ query, onQuery, rows, activities, today }) {
  const q = query.trim()
  const digits = q.replace(/\D/g, "")
  const hits = q
    ? rows.filter((r) => r.name.includes(q) || (digits.length >= 2 && r.phone.includes(digits)))
    : []

  // 같은 사람의 여러 예약을 한 덩어리로 묶는다. 이름이 같아도 번호가 다르면 남이다.
  const people = new Map()
  for (const r of hits) {
    const key = `${r.name}/${r.phone}`
    if (!people.has(key)) people.set(key, { name: r.name, phone: r.phone, dept: r.dept, list: [] })
    people.get(key).list.push(r)
  }

  return (
    <section className="find">
      <label className="find__box">
        <span aria-hidden="true">🔎</span>
        <input
          value={query}
          onChange={(e) => onQuery(e.target.value)}
          placeholder="이름 또는 전화번호 뒷자리로 찾기"
          autoComplete="off"
        />
        {query ? (
          <button className="find__clear" type="button" onClick={() => onQuery("")}>
            지우기
          </button>
        ) : null}
      </label>

      {q && people.size === 0 ? <p className="find__none">「{q}」로 찾은 예약이 없습니다.</p> : null}

      {[...people.values()].map((p) => (
        <div className="find__person" key={p.name + p.phone}>
          <p className="find__who">
            <strong>{p.name}</strong>
            <span>
              {formatPhone(p.phone)} · {p.dept}
            </span>
          </p>
          <ul className="find__list">
            {p.list.map((r) => (
              <li key={r.id}>
                {/* 지난날 기록도 찾히므로 날짜를 붙인다. 번호는 날마다 1번부터라 날짜 없이는 헷갈린다. */}
                <span className="find__day">{r.day === today ? "오늘" : (r.day || "").slice(5).replace("-", "/")}</span>
                <span className="find__act">{activities[r.activity]?.label ?? r.activity}</span>
                <span className="find__no">{r.teamNo}번</span>
                <StateTag row={r} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}

/** 대기 · 진행 중 · 완료 · 취소. "진행 중"은 그 줄의 맨 앞에 서 있다는 뜻이다. */
function StateTag({ row }) {
  if (row.status === "done") return <span className="tag tag--done">완료</span>
  if (row.status === "cancelled") return <span className="tag tag--off">{endLabel(row)}</span>
  // 날이 바뀔 때까지 차례가 오지 않은 예약. 오늘 줄에는 없다.
  if (row.status === "expired") return <span className="tag tag--off">만료</span>
  // 마감 해제로 줄이 새로 시작될 때 대기 중이던 예약.
  if (row.status === "reset") return <span className="tag tag--off">초기화</span>
  if (typeof row.ahead !== "number") return <span className="tag">대기</span>
  if (row.callup === "failed") return <span className="tag tag--fail">호출 실패 · 앞 {row.ahead}팀</span>
  if (row.ahead === 0) return <span className="tag tag--now">진행 중</span>
  if (row.calledAt) return <span className="tag tag--call">호출함 · 앞 {row.ahead}팀</span>
  return <span className="tag">대기 · 앞 {row.ahead}팀</span>
}

/** 발송이 실제로 연결돼 있는지 한 줄로. 안 되어 있으면 무엇이 없는지 말한다. */
function NotifyLine({ notify, password }) {
  const [phone, setPhone] = useState("")
  const [result, setResult] = useState(null)

  const send = async (event) => {
    event.preventDefault()
    try {
      const data = await adminTest(password, phone)
      setResult(data.result)
    } catch (e) {
      setResult({ status: "failed", reason: e.message })
    }
  }

  if (!notify?.ready) {
    return (
      <p className="admin__notify admin__notify--off">
        문자 발송이 <strong>연결되지 않았습니다</strong>. 예약은 되지만 문자는 나가지 않으니 순서를 보고 직접 불러 주세요.
      </p>
    )
  }

  return (
    <form className="admin__notify" onSubmit={send}>
      {/* 키는 들어와 있는데 발송이 실패하는 경우가 가장 찾기 어렵다.
          마지막 실패 이유를 그대로 띄워 현장에서 원인을 알 수 있게 한다. */}
      {notify.lastError ? (
        <span className="admin__why">
          마지막 발송 실패 — {notify.lastError.http ? `HTTP ${notify.lastError.http} · ` : ""}
          {notify.lastError.reason}
          {notify.lastError.http === 401 ? " (키가 틀렸거나 앞뒤에 공백이 붙었습니다)" : ""}
        </span>
      ) : null}
      <span>
        {notify.channel} 발송 연결됨
        {notify.shape ? (
          <>
            {" · 키 "}
            <Shape len={notify.shape.keyLen} want={16} fp={notify.shape.keyFp} />
            {" / 시크릿 "}
            <Shape len={notify.shape.secretLen} want={32} fp={notify.shape.secretFp} />
            {` · 발신 ${notify.shape.sender}`}
          </>
        ) : null}
      </span>
      <input
        value={phone}
        onChange={(e) => setPhone(formatPhone(e.target.value))}
        placeholder="010-0000-0000"
        inputMode="numeric"
      />
      <button className="admin__ghost" type="submit">
        테스트 발송
      </button>
      {result ? (
        <em>{result.status === "sent" ? "보냈습니다" : `실패: ${result.reason ?? ""}`}</em>
      ) : null}
    </form>
  )
}

function Gate({ onPass }) {
  const [value, setValue] = useState("")
  const [error, setError] = useState("")

  const submit = async (event) => {
    event.preventDefault()
    try {
      await adminList(value)
      onPass(value)
    } catch (e) {
      setError(e.message)
      setValue("")
    }
  }

  return (
    <form className="gate" onSubmit={submit}>
      <label className="field">
        <span>비밀번호</span>
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          type="password"
          inputMode="numeric"
          autoFocus
          autoComplete="off"
        />
      </label>
      {error ? <p className="book__error" role="alert">{error}</p> : null}
      <button className="book__submit" type="submit">
        확인
      </button>
    </form>
  )
}
