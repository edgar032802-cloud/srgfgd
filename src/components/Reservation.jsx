import { useCallback, useEffect, useRef, useState } from "react"

import {
  BOOKING_KEY,
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

/** 서버가 문구를 주지 못한 경우(구버전 서버 등)에만 쓰는 같은 문장. */
const CLOSED_FALLBACK = "오늘은 마감되었어요. 내일 다시 만나요."

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
  /** 서버에서 한 번이라도 답을 받았는가. 받기 전에는 폼도 마감 안내도 띄우지 않는다. */
  const [loaded, setLoaded] = useState(false)
  /** 오늘 이 체험존이 더 받지 않는가(마감했거나 정원이 찼다). */
  const [shut, setShut] = useState(false)
  const [closedMessage, setClosedMessage] = useState(CLOSED_FALLBACK)
  const idRef = useRef(readBookings()[activity] ?? null)
  /**
   * 요청 순번. 새로고침 요청이 나간 뒤 예약이 먼저 끝나면, 늦게 도착한 옛 응답이
   * "당신 예약은 없다"며 방금 만든 예약을 지운다(검토에서 재현됨 — 마지막 자리를
   * 잡은 사람이 "오늘은 마감되었어요"를 봤다). 상태를 바꾸는 일이 생길 때마다 순번을
   * 올려, 그보다 먼저 출발한 응답은 버린다.
   */
  const seqRef = useRef(0)

  const refresh = useCallback(async () => {
    // 다른 탭에서 방금 예약했을 수 있다. 들고 있는 게 없으면 저장소를 다시 본다.
    if (!idRef.current) idRef.current = readBookings()[activity] ?? null
    const seq = ++seqRef.current
    const asked = idRef.current
    try {
      const data = await fetchQueue(asked ?? undefined)
      if (seq !== seqRef.current || idRef.current !== asked) return // 낡은 응답

      setWaiting(data.counts?.[activity] ?? 0)
      setShut(Boolean(data.zones?.[activity]?.shut))
      if (data.closedMessage) setClosedMessage(data.closedMessage)
      setOffline(false)
      setLoaded(true)
      // 대기 중인 예약만 들고 있는다. 완료·취소된 것, 그리고 **자정이 지나 만료된 것**은
      // 버린다 — 어제 줄의 순서를 오늘 화면에 띄우면 "지금 입장해주세요"가 잘못 뜬다.
      if (data.mine && data.mine.status === "waiting") setMine(data.mine)
      else if (asked) {
        idRef.current = null
        // 그 사이 다른 탭이 새 예약을 저장했으면 그것까지 지우지 않는다.
        if (readBookings()[activity] === asked) forgetBooking(activity)
        setMine(null)
        setNotice(null)
      }
    } catch {
      if (seq === seqRef.current) setOffline(true)
    }
  }, [activity])

  useEffect(() => {
    refresh()
    const timer = setInterval(refresh, POLL_MS)
    const onFocus = () => refresh()
    // 같은 기기의 다른 탭이 예약하거나 지우면 곧바로 따라간다.
    const onStorage = (e) => {
      if (e.key !== null && e.key !== BOOKING_KEY) return
      const stored = readBookings()[activity] ?? null
      if (stored && stored !== idRef.current) idRef.current = stored
      refresh()
    }
    window.addEventListener("focus", onFocus)
    window.addEventListener("storage", onStorage)
    return () => {
      clearInterval(timer)
      window.removeEventListener("focus", onFocus)
      window.removeEventListener("storage", onStorage)
    }
  }, [refresh, activity])

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
      seqRef.current++ // 예약 전에 나간 새로고침 응답은 이제 낡았다
      idRef.current = data.reservation.id
      rememberBooking(activity, data.reservation.id)
      setMine(data.reservation)
      setWaiting(data.reservation.waiting)
      setNotice(data.notice)
      setForm({ name: "", phone: "", dept: "" })
    } catch (e) {
      if (e.code === "ALREADY_BOOKED" && e.data?.reservation) {
        // 이미 예약한 사람에게는 화내지 말고 자기 순서를 보여 준다.
        seqRef.current++
        idRef.current = e.data.reservation.id
        rememberBooking(activity, e.data.reservation.id)
        setMine(e.data.reservation)
        setError("")
      } else if (e.code === "CLOSED") {
        // 폼을 채우는 사이에 마감됐거나 정원이 찼다. 오류가 아니라 안내로 바꿔 보여 준다.
        seqRef.current++
        setShut(true)
        if (e.message) setClosedMessage(e.message)
        setError("")
      } else {
        setError(e.message)
      }
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

      {/* 순서: 내 예약이 있으면 그것 → 서버 답을 아직 못 받았으면 기다림 →
          오늘 마감이면 안내 → 아니면 폼.
          정원이 차서 막혔어도 이미 줄에 선 사람은 자기 순서를 계속 봐야 한다.
          답을 받기 전에 폼부터 띄우면, 마감된 체험존에서도 폼이 보이고 느린
          와이파이에서는 사람들이 거기에 이름을 치기 시작한다. */}
      {mine ? (
        <Standing mine={mine} notice={notice} title={title} />
      ) : !loaded ? (
        <div className="closed closed--wait" role="status">
          <p className="closed__sub">
            {offline ? "예약 현황을 불러오지 못했어요. 잠시 후 저절로 다시 시도합니다." : "예약 현황을 불러오는 중이에요."}
          </p>
        </div>
      ) : shut ? (
        <div className="closed" role="status">
          {/* 문장 단위로 줄을 나눈다. 한 줄로 두면 좁은 화면에서
              "내일 다시 / 만나요."처럼 말 가운데가 끊긴다. */}
          {closedMessage.split(/(?<=[.!?])\s+/).map((line) => (
            <p className="closed__title" key={line}>
              {line}
            </p>
          ))}
        </div>
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
  // 순서를 모를 때(null)는 0 으로 치지 않는다. 0 으로 치면 "지금 입장해주세요"가
  // 뜨는데, 그건 차례가 온 사람에게만 해야 하는 말이다.
  const ahead = typeof mine.ahead === "number" ? mine.ahead : null
  return (
    <div className="standing">
      <p className="standing__team">
        대기번호 <strong>{mine.teamNo}</strong>번
      </p>

      {ahead === null ? (
        <p className="standing__where">순서를 확인하는 중입니다</p>
      ) : ahead === 0 ? (
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
