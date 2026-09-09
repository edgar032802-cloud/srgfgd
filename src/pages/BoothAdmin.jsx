import { useCallback, useEffect, useState } from "react"

import { adminCancel, adminComplete, adminList, adminTest, formatPhone } from "../lib/booth.js"
import { readPassword, savePassword } from "../lib/adminSession.js"
import "../components/booth.css"

const POLL_MS = 10000

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
  const [query, setQuery] = useState("")

  const load = useCallback(
    async (pw) => {
      const key = pw ?? password
      if (!key) return
      try {
        setData(await adminList(key))
        setError("")
      } catch (e) {
        setError(e.message)
        if (e.code === "BAD_PASSWORD") {
          setPassword("")
          savePassword("")
        }
      }
    },
    [password]
  )

  useEffect(() => {
    if (!password) return undefined
    load()
    const timer = setInterval(load, POLL_MS)
    return () => clearInterval(timer)
  }, [password, load])

  if (!password) return <Gate onPass={(pw) => { savePassword(pw); setPassword(pw) }} />

  const act = async (fn, id) => {
    setBusy(id)
    try {
      await fn(password, id)
      await load()
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy("")
    }
  }

  const activities = data?.activities ?? {}
  const rows = data?.reservations ?? []

  return (
    <div className="admin">
      <header className="admin__head">
        <h1>체험 예약 현황</h1>
        <button className="admin__ghost" type="button" onClick={() => load()}>
          새로고침
        </button>
      </header>

      {error ? <p className="book__error" role="alert">{error}</p> : null}

      <ul className="admin__counts">
        {Object.entries(activities).map(([id, a]) => (
          <li key={id}>
            <span>{a.label}</span>
            <strong>{data.counts?.[id] ?? 0}팀</strong>
          </li>
        ))}
      </ul>

      <NotifyLine notify={data?.notify} password={password} />

      <Search query={query} onQuery={setQuery} rows={rows} activities={activities} />

      {Object.entries(activities).map(([id, a]) => {
        const waiting = rows.filter((r) => r.activity === id && r.status === "waiting").sort((x, y) => x.ahead - y.ahead)
        const closed = rows.filter((r) => r.activity === id && r.status !== "waiting")
        return (
          <section className="admin__group" key={id}>
            <h2>
              {a.label} <span>{a.title}</span>
            </h2>

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
                        {r.calledAt ? " · 호출함" : ""}
                      </span>
                    </div>
                    <div className="admin__acts">
                      <button
                        className="admin__done"
                        type="button"
                        disabled={busy === r.id}
                        onClick={() => act(adminComplete, r.id)}
                      >
                        체험 완료
                      </button>
                      <button
                        className="admin__ghost"
                        type="button"
                        disabled={busy === r.id}
                        onClick={() => act(adminCancel, r.id)}
                      >
                        취소
                      </button>
                    </div>
                  </li>
                ))}
              </ol>
            )}

            {closed.length ? (
              <details className="admin__closed">
                <summary>끝난 팀 {closed.length}</summary>
                <ul>
                  {closed.map((r) => (
                    <li key={r.id}>
                      {r.teamNo}번 {r.name} · {r.status === "done" ? "완료" : "취소"} {timeOf(r.doneAt)}
                    </li>
                  ))}
                </ul>
              </details>
            ) : null}
          </section>
        )
      })}
    </div>
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
function Search({ query, onQuery, rows, activities }) {
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
  if (row.status === "cancelled") return <span className="tag tag--off">취소</span>
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
        안내 발송이 <strong>연결되지 않았습니다</strong>. 키가 서버에 없습니다. 예약은 정상 접수되지만 문자는
        나가지 않으니, 이 화면의 순서를 보고 직접 불러 주세요. (연결 방법은 docs/RESERVATION.md)
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
