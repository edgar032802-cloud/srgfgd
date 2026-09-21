import { useCallback, useEffect, useRef, useState } from "react"

import {
  BOOKING_KEY,
  book,
  cancelBooking,
  fetchQueue,
  forgetBooking,
  formatPhone,
  readBookings,
  readCancelKey,
  readNotice,
  rememberBooking,
  rememberCancelKey,
  rememberNotice,
} from "../lib/booth.js"
import { holdReload } from "../lib/build.js"
import { useLive } from "../lib/live.js"
import "./booth.css"

/** 서버가 문구를 주지 못한 경우(구버전 서버 등)에만 쓰는 같은 문장. */
const CLOSED_FALLBACK = "오늘은 마감되었어요. 내일 다시 만나요."

/**
 * "대기 줄이 새로 시작되었어요" 안내를 이 탭이 기억한다. 줄이 초기화된 걸 알아챈 뒤
 * 화면이 새로 불러와지면(새 배포 등) 예약 기록은 이미 지워져 있어 안내가 사라진다.
 */
const restartKey = (activity) => `freesiaRestarted:${activity}`
/** 초기화를 알아챈 날(서버 기준 한국 날짜). 날이 바뀌면 이 안내는 의미가 없다. */
const readRestarted = (activity) => {
  try {
    return sessionStorage.getItem(restartKey(activity)) ?? ""
  } catch {
    return ""
  }
}
const writeRestarted = (activity, day) => {
  try {
    if (day) sessionStorage.setItem(restartKey(activity), day)
    else sessionStorage.removeItem(restartKey(activity))
  } catch {
    // 이번 화면에서만 보여 준다
  }
}


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
  /** 이 체험존이 새 예약을 받지 않는가(운영자가 마감했다). */
  const [shut, setShut] = useState(false)
  /** 들고 있던 예약이 줄 초기화(마감 해제)로 빠졌다 — 한 줄로 알린다. */
  const [restarted, setRestarted] = useState(() => Boolean(readRestarted(activity)))
  /** 내 예약을 취소했다 — 한 줄로 알린다. 다른 예약을 붙잡는 순간 치운다. */
  const [cancelled, setCancelled] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const [cancelError, setCancelError] = useState("")
  const [closedMessage, setClosedMessage] = useState(CLOSED_FALLBACK)
  const idRef = useRef(readBookings()[activity] ?? null)
  /** 지금 화면에 붙잡고 있는 예약의 id. 다른 예약으로 바뀌었는지 가리는 데 쓴다. */
  const mineIdRef = useRef(null)
  /** 취소를 눌렀는데 답이 끊긴 예약. 다음 조회에서 실제로 취소돼 있으면 "취소했어요"를 띄운다. */
  const cancelTriedRef = useRef(null)
  /** 저장소를 못 쓰는 브라우저를 위해 취소 열쇠를 이 화면에도 들고 있는다. */
  const [keys, setKeys] = useState({})
  /**
   * 요청 순번. 새로고침 요청이 나간 뒤 예약이 먼저 끝나면, 늦게 도착한 옛 응답이
   * "당신 예약은 없다"며 방금 만든 예약을 지운다(검토에서 재현됨 — 마지막 자리를
   * 잡은 사람이 "오늘은 마감되었어요"를 봤다).
   *
   * 그래서 응답은 **이미 반영한 것보다 나중에 출발한 것만** 받는다(`appliedRef`).
   * 예약처럼 화면이 직접 상태를 바꾸면 그때까지 출발한 요청을 모두 낡은 것으로 친다.
   * 예전에는 "더 새 요청이 출발했으면 버린다"였는데, 느린 와이파이에서는 응답이 오기
   * 전에 다음 요청이 계속 출발해 **어떤 응답도 반영되지 못했다** — 마감을 눌러도 화면이
   * 그대로인 채 새로고침만이 답이 됐다.
   */
  const seqRef = useRef(0)
  const appliedRef = useRef(0)
  /** 화면이 직접 상태를 바꿨다 — 지금까지 출발한 요청의 답은 모두 낡았다. */
  const settle = () => {
    appliedRef.current = seqRef.current
  }

  /**
   * 이 예약을 붙잡는다. **다른** 예약으로 바뀌면 지난 예약의 취소 안내·취소 오류를
   * 치운다 — 그대로 두면 새 예약 밑에 "연결이 끊겼습니다"가 뜨거나, 나중에 그 예약이
   * 끝났을 때 "예약을 취소했어요"가 잘못 뜬다(검토에서 재현됨).
   */
  const hold = useCallback((r) => {
    if (mineIdRef.current !== r.id) {
      setCancelError("")
      setCancelled(false)
    }
    mineIdRef.current = r.id
    setMine(r)
  }, [])

  /** 붙잡고 있던 예약을 화면에서 내려놓는다. */
  const drop = useCallback(() => {
    mineIdRef.current = null
    setMine(null)
    setNotice(null)
    setCancelError("")
  }, [])

  const refresh = useCallback(async () => {
    // 다른 탭에서 방금 예약했을 수 있다. 들고 있는 게 없으면 저장소를 다시 본다.
    if (!idRef.current) idRef.current = readBookings()[activity] ?? null
    const seq = ++seqRef.current
    const asked = idRef.current
    try {
      const data = await fetchQueue(asked ?? undefined)
      if (seq <= appliedRef.current || idRef.current !== asked) return true // 낡은 응답
      appliedRef.current = seq

      setWaiting(data.counts?.[activity] ?? 0)
      setShut(Boolean(data.zones?.[activity]?.shut))
      // 어제 알아챈 초기화 안내는 오늘 띄우지 않는다.
      const restartedOn = readRestarted(activity)
      if (restartedOn && data.today && restartedOn !== data.today) {
        writeRestarted(activity, "")
        setRestarted(false)
      }
      if (data.closedMessage) setClosedMessage(data.closedMessage)
      setOffline(false)
      setLoaded(true)
      // 대기 중인 예약만 들고 있는다. 완료·취소된 것, **자정이 지나 만료된 것**, 그리고
      // **마감 해제로 줄이 새로 시작되며 빠진 것**은 버린다 — 옛 줄의 순서를 띄우면
      // "지금 입장해주세요"가 잘못 뜨거나, 새 줄의 같은 번호와 겹친다.
      if (data.mine && data.mine.status === "waiting") {
        hold(data.mine)
        // 새로 불러온 화면이면 예약할 때 받은 문자 결과를 되살린다("문자를 보내지 못했습니다").
        setNotice((n) => n ?? readNotice(data.mine.id))
      } else if (asked) {
        if (data.mine?.status === "reset") {
          setRestarted(true)
          writeRestarted(activity, data.today || "1")
        }
        // 취소를 눌렀는데 답이 끊겼던 예약이 실제로 취소돼 있다 — 됐다고 알려 준다.
        if (cancelTriedRef.current === asked) {
          if (data.mine?.status === "cancelled") setCancelled(true)
          cancelTriedRef.current = null
        }
        idRef.current = null
        // 그 사이 다른 탭이 새 예약을 저장했으면 그것까지 지우지 않는다.
        if (readBookings()[activity] === asked) forgetBooking(activity)
        drop()
      }
    } catch {
      // 가장 최근에 출발한 요청이 실패했고, 그보다 새 답도 없을 때만 "못 불러왔다".
      if (seq === seqRef.current && seq > appliedRef.current) setOffline(true)
      return false // 곧 다시 묻는다(useLive)
    }
    return true
  }, [activity, hold, drop])

  // 처음 한 번, 서버가 "바뀌었다"고 알릴 때, 화면이 다시 보일 때, 그리고 주기적으로.
  useLive(refresh, { fastMs: 5000, slowMs: 20000 })

  useEffect(() => {
    // 같은 기기의 다른 탭이 예약하거나 지우면 곧바로 따라간다.
    const onStorage = (e) => {
      if (e.key !== null && e.key !== BOOKING_KEY) return
      const stored = readBookings()[activity] ?? null
      if (stored && stored !== idRef.current) idRef.current = stored
      refresh()
    }
    window.addEventListener("storage", onStorage)
    return () => window.removeEventListener("storage", onStorage)
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
    // 예약이 오가는 동안 화면이 새로 불러와지면 됐는지 모른다. 문자 발송을 기다리느라 몇 초 걸린다.
    holdReload(20000)
    try {
      const data = await book({ activity, ...form })
      settle() // 예약 전에 나간 새로고침 응답은 이제 낡았다
      const id = data.reservation.id
      setRestarted(false)
      writeRestarted(activity, "")
      rememberNotice(id, data.notice)
      // 본인 취소 열쇠 — 서버는 이 응답에서만 한 번 건넨다.
      setKeys((k) => ({ ...k, [id]: data.cancelKey }))
      rememberCancelKey(id, data.cancelKey)
      idRef.current = id
      rememberBooking(activity, id)
      hold(data.reservation)
      setWaiting(data.reservation.waiting)
      setNotice(data.notice)
      setForm({ name: "", phone: "", dept: "" })
      // 접수 문자를 보내는 몇 초 사이에 줄이 초기화됐을 수 있다. 곧바로 다시 물어
      // 빠진 예약을 붙잡고 있지 않게 한다.
      if (data.reservation.status !== "waiting") refresh()
    } catch (e) {
      if (e.code === "ALREADY_BOOKED" && e.data?.reservation) {
        // 이미 예약한 사람에게는 화내지 말고 자기 순서를 보여 준다. (취소 열쇠는 오지 않는다 —
        // 예약한 그 기기가 아니면 취소 버튼이 나오지 않는다.)
        settle()
        idRef.current = e.data.reservation.id
        rememberBooking(activity, e.data.reservation.id)
        hold(e.data.reservation)
        setError("")
      } else if (e.code === "CLOSED") {
        // 폼을 채우는 사이에 마감됐다. 오류가 아니라 안내로 바꿔 보여 준다.
        settle()
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

  /** 이 기기에서 들고 있던 예약을 내려놓는다. 다른 탭이 새로 잡은 예약은 건드리지 않는다. */
  const letGo = (id) => {
    settle() // 취소 전에 나간 새로고침 응답은 이제 낡았다
    if (idRef.current === id) idRef.current = null
    if (readBookings()[activity] === id) forgetBooking(activity)
    if (cancelTriedRef.current === id) cancelTriedRef.current = null
    drop()
  }

  const keyOf = (id) => keys[id] || readCancelKey(id)

  /**
   * 내 예약 취소. 운영 화면에는 곧바로 "사용자 취소"로 보이고, 뒤에 선 팀들이 한 칸씩
   * 당겨진다. 한 번 더 묻는다 — 되돌릴 수 없고, 다시 예약하면 맨 뒤에 선다.
   */
  const cancelMine = async () => {
    if (!mine || cancelling) return
    const id = mine.id
    const key = keyOf(id)
    if (!key) return
    if (!window.confirm("예약을 취소할까요?\n대기 순서가 사라지고 되돌릴 수 없어요.")) return
    setCancelling(true)
    setCancelError("")
    holdReload(15000)
    cancelTriedRef.current = id
    try {
      await cancelBooking(id, key)
      letGo(id)
      setCancelled(true)
    } catch (e) {
      if (e.code === "NOT_WAITING") {
        // 이미 줄에 없다. 먼저 누른 취소가 이미 됐다면 됐다고 알리고, 체험을 마쳤거나
        // 운영자가 먼저 정리했다면 조용히 폼으로 돌아간다.
        letGo(id)
        if (e.data?.reservation?.status === "cancelled") setCancelled(true)
      } else if (e.code === "UNKNOWN_RESERVATION") {
        // 열쇠가 맞지 않는다(저장소가 지워졌거나 다른 기기). 예약은 그대로 두고 부스로 안내한다.
        cancelTriedRef.current = null
        setCancelError("이 기기에서는 취소할 수 없어요. 부스에 말씀해 주세요.")
      } else {
        // 연결이 끊겼다 — 서버에서는 됐을 수도 있다. 다음 조회가 실제 상태로 맞춘다.
        setCancelError(e.message)
      }
    } finally {
      setCancelling(false)
    }
    refresh()
  }

  return (
    <section className="book" aria-labelledby={`book-${activity}`}>
      <div className="book__head">
        <h2 id={`book-${activity}`}>체험 예약</h2>
        {/* 예약한 사람은 아래에 "앞에 N팀"이 크게 뜬다. 전체 대기 수를 함께 두면 둘을 헷갈린다.
            다만 연결이 끊겼다는 말은 예약한 사람에게도 보여야 한다 — 그 숫자가 낡았다는 뜻이다. */}
        {mine && !offline ? null : (
          <p className="book__count">
            {offline ? (
              <span className="book__off">연결이 끊겨 최신 순서가 아닐 수 있어요</span>
            ) : waiting === null ? (
              <span className="book__off">불러오는 중</span>
            ) : (
              <>
                지금 대기 <strong>{waiting}</strong>팀
              </>
            )}
          </p>
        )}
      </div>

      {/* 방금 한 일 한 줄. 마감 안내가 떠 있어도 보이도록 갈래 밖에 둔다. */}
      {!mine && cancelled ? (
        <p className="book__note" role="status">
          예약을 취소했어요.
        </p>
      ) : !mine && restarted ? (
        <p className="book__restart" role="status">
          대기 줄이 새로 시작되었어요. 다시 예약해 주세요.
        </p>
      ) : null}

      {/* 순서: 내 예약이 있으면 그것 → 서버 답을 아직 못 받았으면 기다림 →
          마감이면 안내 → 아니면 폼.
          마감됐어도 이미 줄에 선 사람은 자기 순서를 계속 봐야 한다.
          답을 받기 전에 폼부터 띄우면, 마감된 체험존에서도 폼이 보이고 느린
          와이파이에서는 사람들이 거기에 이름을 치기 시작한다. */}
      {mine ? (
        <Standing
          mine={mine}
          notice={notice}
          title={title}
          canCancel={Boolean(keyOf(mine.id))}
          cancelling={cancelling}
          cancelError={cancelError}
          onCancel={cancelMine}
        />
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
          <p className="book__fine">앞에 5팀이 남으면 문자로 알려 드려요.</p>
        </form>
      )}
    </section>
  )
}

/**
 * 예약을 마친 사람에게 보이는 화면 — "앞에 N팀" 하나가 주인공이다.
 *
 * N 은 **지금 대기 중인 팀만** 센다. 체험을 마친 팀, 취소한 팀(본인·운영자), 줄 초기화로
 * 빠진 팀은 세지 않는다(서버가 대기 중인 줄에서의 자리로 계산한다). 누가 완료·취소할
 * 때마다 서버 알림으로 곧바로 바뀐다.
 *
 * 차례가 되면 숫자 대신 "지금 입장해주세요"가 주인공이 된다.
 * 취소 버튼은 예약한 그 기기에만 나온다(취소 열쇠가 그 기기에만 있다).
 */
function Standing({ mine, notice, title, canCancel, cancelling, cancelError, onCancel }) {
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
      {cancelError ? (
        <p className="book__error" role="alert">
          {cancelError}
        </p>
      ) : null}
      {canCancel ? (
        <button className="standing__cancel" type="button" disabled={cancelling} onClick={onCancel}>
          {cancelling ? "취소하는 중" : "예약 취소"}
        </button>
      ) : null}
    </div>
  )
}
