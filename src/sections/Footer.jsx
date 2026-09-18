import { useEffect, useRef, useState } from "react"

import { adminClose, adminList, adminReopen, zoneConfirmText } from "../lib/booth.js"
import { savePassword } from "../lib/adminSession.js"
import "../components/booth.css"

/** 다섯 번을 이 시간 안에 눌러야 한 묶음으로 친다. */
const WINDOW_MS = 2500
const TAPS = 5

/** 마감 버튼 판이 열려 있는 동안 체험존 상태를 다시 묻는 간격. */
const ZONE_POLL_MS = 10000

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
 * 수를 알려 준다. 다른 기기에서 누른 마감도 보이도록 열려 있는 동안 다시 묻는다.
 */
function ZonePanel({ password, activities, zones: initial, onClose }) {
  const [zones, setZones] = useState(initial)
  const [busy, setBusy] = useState("")
  const [error, setError] = useState("")
  const [note, setNote] = useState("")

  useEffect(() => {
    let alive = true
    const timer = setInterval(async () => {
      try {
        const data = await adminList(password)
        if (alive) setZones(data.zones ?? {})
      } catch {
        // 잠깐 끊긴 것 — 다음 차례에 다시 묻는다.
      }
    }, ZONE_POLL_MS)
    return () => {
      alive = false
      clearInterval(timer)
    }
  }, [password])

  const toggle = async (id, label) => {
    if (busy) return
    const zone = zones[id] ?? {}
    const closing = !zone.closed
    if (!window.confirm(zoneConfirmText(label, closing, zone.waiting ?? 0))) return
    setBusy(id)
    setError("")
    setNote("")
    try {
      const data = await (closing ? adminClose : adminReopen)(password, id)
      setZones(data.zones ?? {})
      if (closing) setNote(`${label} 예약을 마감했습니다.`)
      else if (data.reset === false) setNote(`${label}은(는) 이미 예약을 받는 중입니다.`)
      else setNote(`${label} 마감을 해제했습니다. 대기번호가 1번부터 다시 시작합니다.`)
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy("")
    }
  }

  return (
    <div className="lock" role="dialog" aria-modal="true" aria-label="체험존 마감">
      <div className="lock__box lock__box--zones">
        <p className="lock__title">체험존 마감</p>
        <ul className="lockzones">
          {Object.entries(activities).map(([id, a]) => {
            const z = zones[id] ?? {}
            return (
              <li key={id} className={z.closed ? "lockzone is-closed" : "lockzone"}>
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
                  onClick={() => toggle(id, a.label)}
                >
                  {busy === id ? "처리 중" : z.closed ? "마감해제" : "마감"}
                </button>
              </li>
            )
          })}
        </ul>
        {note ? (
          <p className="lock__note" role="status">
            {note}
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
