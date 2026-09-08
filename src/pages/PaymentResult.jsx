import { useEffect, useRef, useState } from "react"
import { motion } from "motion/react"

import { confirmPayment } from "../lib/api.js"

/** Toss appends its query string after our hash route, so read it from there. */
function hashParams() {
  const raw = window.location.hash
  const q = raw.includes("?") ? raw.slice(raw.indexOf("?") + 1) : ""
  return new URLSearchParams(q)
}

export function PaymentSuccess() {
  // "success" here means only that Toss redirected us. Nothing is treated as
  // paid until the server confirms the approval against its own price.
  const [state, setState] = useState({ phase: "verifying" })
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true

    const params = hashParams()
    const paymentKey = params.get("paymentKey")
    const orderId = params.get("orderId")
    const amount = params.get("amount")

    if (!paymentKey || !orderId || amount === null) {
      setState({ phase: "error", message: "결제 정보가 올바르지 않습니다." })
      return
    }

    confirmPayment({ paymentKey, orderId, amount })
      .then((data) => setState({ phase: "paid", order: data.order }))
      .catch((e) => setState({ phase: "error", message: e.message, code: e.code }))
  }, [])

  if (state.phase === "verifying") {
    return (
      <ResultShell tone="wait" title="결제를 확인하는 중입니다">
        <p className="lede">
          결제창을 통과했지만 아직 완료된 것은 아닙니다.
          <br />
          서버가 승인 결과를 검증하고 있어요.
        </p>
        <div className="spinner" aria-hidden="true" />
      </ResultShell>
    )
  }

  if (state.phase === "error") {
    return (
      <ResultShell tone="fail" title="결제를 완료하지 못했습니다">
        <p className="lede">{state.message}</p>
        {state.code ? <p className="code-chip">{state.code}</p> : null}
        <a className="cta cta--sm" href="#/terry">
          다시 시도하기
        </a>
      </ResultShell>
    )
  }

  return (
    <ResultShell tone="ok" title="사전판매 결제가 완료되었습니다">
      <p className="lede">사전판매 결제가 확인되었습니다. 아래 주문 내역을 확인해 주세요.</p>
      <dl className="receipt">
        <div>
          <dt>주문번호</dt>
          <dd>{state.order.orderId}</dd>
        </div>
        <div>
          <dt>상품</dt>
          <dd>{state.order.orderName}</dd>
        </div>
        <div>
          <dt>결제금액</dt>
          <dd>{state.order.amount.toLocaleString()}원</dd>
        </div>
      </dl>
      <a className="cta cta--sm" href="#/">
        홈으로
      </a>
    </ResultShell>
  )
}

export function PaymentFail() {
  const params = hashParams()
  return (
    <ResultShell tone="fail" title="결제가 취소되었습니다">
      <p className="lede">{params.get("message") ?? "결제가 완료되지 않았습니다."}</p>
      {params.get("code") ? <p className="code-chip">{params.get("code")}</p> : null}
      <a className="cta cta--sm" href="#/terry">
        다시 시도하기
      </a>
    </ResultShell>
  )
}

function ResultShell({ tone, title, children }) {
  return (
    <motion.div
      className={`result result--${tone}`}
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      role="status"
    >
      <h1>{title}</h1>
      {children}
    </motion.div>
  )
}
