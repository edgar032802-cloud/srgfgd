import { useRef, useState } from "react"

import { adminList } from "../lib/booth.js"
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

/** 비밀번호를 서버에 물어보고, 맞으면 운영 화면으로 넘긴다. */
function AdminGate({ onClose }) {
  const [value, setValue] = useState("")
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)

  const submit = async (event) => {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      await adminList(value)
      savePassword(value)
      onClose()
      window.location.hash = "#/booth"
    } catch (e) {
      setError(e.message)
      setValue("")
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="lock" role="dialog" aria-modal="true" aria-label="운영자 확인">
      <form className="lock__box" onSubmit={submit}>
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
        <div className="lock__acts">
          <button className="admin__ghost" type="button" onClick={onClose}>
            닫기
          </button>
          <button className="book__submit" type="submit" disabled={busy}>
            확인
          </button>
        </div>
      </form>
    </div>
  )
}
