import { useRef, useState } from "react"

import { adminClose, adminList, adminReopen, adminZones, zoneQuestion } from "../lib/booth.js"
import { holdReload } from "../lib/build.js"
import { signalZonesChanged, useLive } from "../lib/live.js"
import { savePassword } from "../lib/adminSession.js"
import "../components/booth.css"

/** 다섯 번을 이 시간 안에 눌러야 한 묶음으로 친다. */
const WINDOW_MS = 2500
const TAPS = 5

/**
 * 푸터. 로고 옆에 이름 · 학생회 · 주소를 위에서 아래로 쌓는다.
 *
 * 로고를 연달아 다섯 번 누르면 운영자 입구가 열린다. 어디에도 링크하지 않는
 * 이유는 방문자에게 보일 문이 아니기 때문이고, 비밀번호를 화면 코드가 아니라
 * 서버에서 확인하는 이유는 번들을 뜯어도 명단이 나오면 안 되기 때문이다.
 */
export default function Footer() {
  const [asking, setAsking] = useState(false)
  const taps = useRef([])

  const onLogo = () => {
    const now = Date.now()
    taps.current = [...taps.current, now].filter((t) => now - t < WINDOW_MS)
    if (taps.current.length >= TAPS) {
      taps.current = []
      setAsking(true)
    }
  }

  return (
    <footer className="footer">
      <div className="wrap footer__brand">
        <img
          src="/brand/logo.png"
          alt=""
          width="34"
          height="34"
          loading="lazy"
          onClick={onLogo}
          draggable="false"
        />
        <div>
          <strong>프리지아</strong>
          <span>신구대학교 작업치료학과 초대 학생회</span>
          <address className="footer__address">
            주소: 경기도 성남시 중원구 광명로 377 신구대학교 동관 7층
          </address>
        </div>
      </div>

      {asking ? <AdminGate onClose={() => setAsking(false)} /> : null}
    </footer>
  )
}

/**
 * 비밀번호 창. 서버에 물어보고 맞으면 둘 중 하나로 간다.
 *   확인  예약자 목록(운영 화면)
 *   마감  체험존별 마감 · 마감해제 버튼
 *
 * 마감은 비밀번호를 넣고 눌러도 되고, 먼저 누르고 비밀번호를 넣어도 된다.
 */
function AdminGate({ onClose }) {
  const [value, setValue] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  /** 마감을 먼저 눌렀다 — 비밀번호가 맞으면 목록 대신 마감 버튼 판을 연다. */
  const [wantClose, setWantClose] = useState(false)
  const [panel, setPanel] = useState(null)
  const inputRef = useRef(null)

  /** 비밀번호를 확인하고, 맞으면 목록 응답을 돌려준다. */
  const check = async () => {
    setBusy(true)
    setError("")
    try {
      const data = await adminList(value)
      savePassword(value)
      return data
    } catch (e) {
      setError(e.message)
      setValue("")
      inputRef.current?.focus()
      return null
    } finally {
      setBusy(false)
    }
  }

  const openZones = async () => {
    const data = await check()
    if (data) setPanel({ password: value, activities: data.activities ?? {}, zones: data.zones ?? {} })
  }

  const openList = async () => {
    const data = await check()
    if (!data) return
    onClose()
    window.location.hash = "#/booth"
  }

  const submit = (event) => {
    event.preventDefault()
    if (busy) return
    if (wantClose) openZones()
    else openList()
  }

  const onCloseButton = () => {
    if (busy) return
    setWantClose(true)
    if (value) openZones()
    else {
      setError("")
      inputRef.current?.focus()
    }
  }

  if (panel) return <ZonePanel {...panel} onClose={onClose} />

  return (
    <div className="lock" role="dialog" aria-modal="true" aria-label="운영자 확인">
      <form className="lock__box" onSubmit={submit}>
        <label className="field">
          <span>비밀번호</span>
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            type="password"
            inputMode="numeric"
            autoFocus
            autoComplete="off"
          />
        </label>
        {wantClose && !error ? (
          <p className="lock__hint">비밀번호를 넣고 확인을 누르면 체험존별 마감 버튼이 나옵니다.</p>
        ) : null}
        {error ? <p className="book__error" role="alert">{error}</p> : null}
        <div className="lock__acts lock__acts--three">
          <button className="admin__ghost" type="button" onClick={onClose}>
            닫기
          </button>
          <button
            className={wantClose ? "lock__close is-on" : "lock__close"}
            type="button"
            aria-pressed={wantClose}
            disabled={busy}
            onClick={onCloseButton}
          >
            마감
          </button>
          <button className="book__submit" type="submit" disabled={busy}>
            확인
          </button>
        </div>
      </form>
    </div>
  )
}

/**
 * 체험존 넷의 마감 버튼 판.
 *
 * 마감한 체험존의 버튼은 "마감해제"로 바뀐다. 해제하면 그 체험존의 줄이 처음부터
 * 다시 시작하므로(대기 0, 다음 예약 1번), 누르기 전에 한 번 더 묻고 남은 대기 팀
 * 수를 알려 준다. 다른 기기에서 누른 마감도 보이도록 열려 있는 동안 따라간다.
 *
 * 버튼은 **서버의 답으로 곧바로** 바뀐다. 목록을 다시 묻는 요청이 마감보다 먼저
 * 출발해 늦게 도착하면 방금 바뀐 버튼을 옛 모양으로 되돌렸는데(한 번 눌러서는 안
 * 되는 것처럼 보였다), 누를 때마다 세대를 올려 그런 늦은 답은 버린다.
 */
function ZonePanel({ password, activities, zones: initial, onClose }) {
  const [zones, setZones] = useState(initial)
  const [busy, setBusy] = useState("")
  const [error, setError] = useState("")
  /**
   * 방금 누른 결과 한 줄. 어느 체험존이 어떤 상태가 됐을 때의 말인지 함께 적어 두고,
   * 그 뒤 다른 기기가 상태를 바꾸면 감춘다 — 버튼은 "마감"인데 밑에 "마감했습니다"가
   * 남아 있으면 운영자는 둘 중 무엇을 믿어야 할지 모른다.
   */
  const [note, setNote] = useState(null)
  /**
   * 한 번 더 묻는 중인 체험존 { id, closing }. 브라우저 확인 창 대신 그 줄 안에서 묻는다
   * (확인 창은 몇 번 이어지면 브라우저가 막아 버려, 새로고침 전까지 버튼이 먹지 않았다).
   * 할 일(마감/해제)은 **물을 때 정해 둔다** — 묻는 사이 다른 기기가 상태를 바꿔도
   * 손가락 밑의 버튼이 반대 동작으로 뒤집히지 않게.
   */
  const [asking, setAsking] = useState(null)
  /** 같은 순간 두 번 눌려도 한 번만 보낸다. 상태(busy)는 다음 그림에서야 바뀐다. */
  const busyRef = useRef(false)
  const genRef = useRef(0)

  const reload = async () => {
    const gen = genRef.current
    try {
      const data = await adminZones(password)
      if (gen === genRef.current && !busyRef.current) setZones(data.zones ?? {})
      return true
    } catch {
      return false // 잠깐 끊긴 것 — 곧 다시 묻는다(useLive)
    }
  }
  useLive(reload, { fastMs: 5000, slowMs: 15000 })

  const ask = (id) => {
    if (busyRef.current) return
    setError("")
    setNote(null)
    setAsking({ id, closing: !zones[id]?.closed })
  }

  const run = async (id, label, closing) => {
    if (busyRef.current) return
    setAsking(null)
    busyRef.current = true
    genRef.current++
    holdReload(15000) // 요청이 오가는 동안 화면이 새로 불러와지면 됐는지 모른다
    setBusy(id)
    setError("")
    setNote(null)
    let failed = false
    try {
      const data = await (closing ? adminClose : adminReopen)(password, id)
      genRef.current++
      setZones(data.zones ?? {})
      signalZonesChanged()
      const closedNow = Boolean(data.zones?.[id]?.closed)
      const text = closing
        ? `${label} 예약을 마감했습니다.`
        : data.reset === false
          ? `${label}은(는) 이미 예약을 받는 중입니다.`
          : `${label} 마감을 해제했습니다. 대기번호가 1번부터 다시 시작합니다.`
      setNote({ id, closed: closedNow, text })
    } catch (e) {
      failed = true
      setError(e.message)
    } finally {
      busyRef.current = false
      setBusy("")
    }
    // 실패했으면 서버에서는 됐는지 모른다 — 다시 물어 버튼을 실제 상태로 맞춘다.
    if (failed) reload()
  }

  return (
    <div className="lock" role="dialog" aria-modal="true" aria-label="체험존 마감">
      <div className="lock__box lock__box--zones">
        <p className="lock__title">체험존 마감</p>
        <ul className="lockzones">
          {Object.entries(activities).map(([id, a]) => {
            const z = zones[id] ?? {}
            const here = asking?.id === id ? asking : null
            return (
              <li
                key={id}
                className={["lockzone", z.closed ? "is-closed" : "", here ? "is-asking" : ""].filter(Boolean).join(" ")}
              >
                {here ? (
                  <>
                    <p className="lockzone__ask" role="status">
                      <strong>{a.label}</strong> {zoneQuestion(here.closing, z.waiting ?? 0)}
                    </p>
                    <div className="lockzone__acts">
                      <button className="ask__no" type="button" onClick={() => setAsking(null)}>
                        아니요
                      </button>
                      <button
                        className={here.closing ? "lockzone__btn" : "lockzone__btn lockzone__btn--open"}
                        type="button"
                        onClick={() => run(id, a.label, here.closing)}
                      >
                        {here.closing ? "마감" : "마감해제"}
                      </button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="lockzone__info">
                      <strong>{a.label}</strong>
                      <span>
                        {z.closed ? "마감됨" : "예약 받는 중"} · 대기 {z.waiting ?? 0}팀
                      </span>
                    </div>
                    <button
                      className={z.closed ? "lockzone__btn lockzone__btn--open" : "lockzone__btn"}
                      type="button"
                      disabled={Boolean(busy)}
                      onClick={() => ask(id)}
                    >
                      {busy === id ? "처리 중" : z.closed ? "마감해제" : "마감"}
                    </button>
                  </>
                )}
              </li>
            )
          })}
        </ul>
        {note && Boolean(zones[note.id]?.closed) === note.closed ? (
          <p className="lock__note" role="status">
            {note.text}
          </p>
        ) : null}
        {error ? <p className="book__error" role="alert">{error}</p> : null}
        <div className="lock__acts">
          <button className="admin__ghost" type="button" onClick={onClose}>
            닫기
          </button>
          <button
            className="book__submit"
            type="button"
            onClick={() => {
              onClose()
              window.location.hash = "#/booth"
            }}
          >
            예약 목록 보기
          </button>
        </div>
      </div>
    </div>
  )
}
