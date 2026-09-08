import { useCallback, useEffect, useRef, useState } from "react"

import {
  book,
  fetchQueue,
  forgetBooking,
  formatPhone,
  readBookings,
  rememberBooking,
} from "../lib/booth.js"
import "./booth.css"

/** 대기 줄은 옆에서 계속 움직인다. 15초마다 조용히 다시 물어본다. */
const POLL_MS = 15000

/**
 * 체험 예약 한 벌 — 지금 몇 팀이 기다리는지, 이름·번호·학과, 그리고 내 순서.
 *
 * 예약한 사람의 id 는 이 기기의 localStorage 에만 남는다. 다시 들어오면 폼 대신
 * 자기 순서가 보이고, 운영자가 완료를 누를 때마다 숫자가 줄어든다.
 */
export default function Reservation({ activity, title }) {
  const [waiting, setWaiting] = useState(null)
  const [mine, setMine] = useState(null)
  const [form, setForm] = useState({ name: "", phone: "", dept: "" })
  const [sending, setSending] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState(null)
  const [offline, setOffline] = useState(false)
  const idRef = useRef(readBookings()[activity] ?? null)

  const refresh = useCallback(async () => {
    try {
      const data = await fetchQueue(idRef.current ?? undefined)
      setWaiting(data.counts?.[activity] ?? 0)
      setOffline(false)
      // 완료·취소된 예약은 더 들고 있지 않는다 — 다음 사람이 새로 예약해야 한다.
      if (data.mine && data.mine.status === "waiting") setMine(data.mine)
      else if (idRef.current) {
        idRef.current = null
        forgetBooking(activity)
        setMine(null)
      }
    } catch {
      setOffline(true)
    }
  }, [activity])

  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, POLL_MS)
    const onFocus = () => refresh()
    window.addEventListener("focus", onFocus)
    return () => {
      clearInterval(timer)
      window.removeEventListener("focus", onFocus)
    }
  }, [refresh])

  const set = (key) => (event) => {
    const value = key === "phone" ? formatPhone(event.target.value) : event.target.value
    setForm((f) => ({ ...f, [key]: value }))
  }

  const submit = async (event) => {
    event.preventDefault()
    if (sending) return
    setError("")
    setSending(true)
    try {
      const data = await book({ activity, ...form })
      idRef.current = data.reservation.id
      rememberBooking(activity, data.reservation.id)
      setMine(data.reservation)
      setWaiting(data.reservation.waiting)
      setNotice(data.notice)
      setForm({ name: "", phone: "", dept: "" })
    } catch (e) {
      // 이미 예약한 사람에게는 화내지 말고 자기 순서를 보여 준다.
      if (e.code === "ALREADY_BOOKED" && e.data?.reservation) {
        idRef.current = e.data.reservation.id
        rememberBooking(activity, e.data.reservation.id)
        setMine(e.data.reservation)
      }
      setError(e.message)
    } finally {
      setSending(false)
    }
  }

  return (
    <section className="book" aria-labelledby={`book-${activity}`}>
      <div className="book__head">
        <h2 id={`book-${activity}`}>체험 예약</h2>
        <p className="book__count">
          {offline ? (
            <span className="book__off">대기 현황을 불러오지 못했습니다</span>
          ) : waiting === null ? (
            <span className="book__off">불러오는 중</span>
          ) : (
            <>
              지금 대기 <strong>{waiting}</strong>팀
            </>
          )}
        </p>
      </div>

      {mine ? (
        <Standing mine={mine} notice={notice} title={title} />
      ) : (
        <form className="book__form" onSubmit={submit}>
          <label className="field">
            <span>이름</span>
            <input
              value={form.name}
              onChange={set("name")}
              autoComplete="name"
              maxLength={20}
              placeholder="홍길동"
              required
            />
          </label>

          <label className="field">
            <span>전화번호</span>
            <input
              value={form.phone}
              onChange={set("phone")}
              type="tel"
              inputMode="numeric"
              autoComplete="tel"
              placeholder="010-1234-5678"
              required
            />
          </label>

          <label className="field">
            <span>학과</span>
            <input
              value={form.dept}
              onChange={set("dept")}
              maxLength={30}
              placeholder="작업치료학과"
              required
            />
          </label>

          {error ? (
            <p className="book__error" role="alert">
              {error}
            </p>
          ) : null}

          <button className="book__submit" type="submit" disabled={sending}>
            {sending ? "예약하는 중" : "예약하기"}
          </button>
          <p className="book__fine">순서가 가까워지면 적어 주신 번호로 안내를 보내 드립니다.</p>
        </form>
      )}
    </section>
  )
}

/**
 * 예약을 마친 사람에게 보이는 화면 — 숫자 하나가 주인공이다.
 *
 * 차례가 됐을 때는 숫자가 아니라 문장이 주인공이 된다. 예전에는 같은 자리에
 * "지금 순서입니다"를 숫자 크기(40px)로 넣어 카드 밖으로 밀려났다. 지금은
 * 노란 면에 얹은 한 줄로 바꾸고, 어디로 가야 하는지를 그 아래에 붙인다.
 */
function Standing({ mine, notice, title }) {
  const ahead = mine.ahead ?? 0
  return (
    <div className="standing">
      <p className="standing__team">
        대기번호 <strong>{mine.teamNo}</strong>번
      </p>

      {ahead === 0 ? (
        <>
          <p className="standing__call">지금 입장해주세요</p>
          <p className="standing__where">{title} 부스로 와주세요</p>
        </>
      ) : (
        <p className="standing__ahead">
          <span>앞에</span>
          <strong>{ahead}</strong>
          <span>팀</span>
        </p>
      )}
      {notice && notice.status !== "sent" ? (
        <p className="standing__note">
          {notice.status === "skipped"
            ? "안내 문자 발송이 아직 연결되지 않았습니다. 이 화면에서 순서를 확인해 주세요."
            : "안내 문자를 보내지 못했습니다. 이 화면에서 순서를 확인해 주세요."}
        </p>
      ) : null}
      <p className="standing__fine">이 화면은 15초마다 저절로 새로고침됩니다.</p>
    </div>
  )
}
