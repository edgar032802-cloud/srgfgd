import { useEffect, useState } from "react"
import { motion } from "motion/react"
import { loadTossPayments, ANONYMOUS } from "@tosspayments/tosspayments-sdk"

import Character3D from "../components/Character3D.jsx"
import { createOrder, fetchProducts } from "../lib/api.js"

const CLIENT_KEY = import.meta.env.VITE_TOSS_CLIENT_KEY

export default function TerryPage() {
  const [product, setProduct] = useState(null)
  const [shippingFee, setShippingFee] = useState(0)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    fetchProducts()
      .then((data) => {
        setProduct(data.products.find((p) => p.id === "terry") ?? null)
        setShippingFee(data.shippingFee)
      })
      .catch((e) => setError(`상품 정보를 불러오지 못했습니다: ${e.message}`))
  }, [])

  async function onBuy() {
    setError(null)

    if (!CLIENT_KEY) {
      setError("VITE_TOSS_CLIENT_KEY 가 설정되지 않았습니다. .env 를 확인해주세요.")
      return
    }

    setBusy(true)
    try {
      // The server decides the amount. We never compute or send one.
      const order = await createOrder("terry")

      const toss = await loadTossPayments(CLIENT_KEY)
      const payment = toss.payment({ customerKey: ANONYMOUS })

      await payment.requestPayment({
        method: "CARD",
        amount: { currency: "KRW", value: order.amount },
        orderId: order.orderId,
        orderName: order.orderName,
        successUrl: `${window.location.origin}/#/pay/success`,
        failUrl: `${window.location.origin}/#/pay/fail`,
        card: { flowMode: "DEFAULT", useEscrow: false, useCardPoint: false },
      })
    } catch (e) {
      // User closing the Toss window also lands here; keep it quiet-ish.
      if (e?.code !== "USER_CANCEL") setError(e.message ?? "결제를 시작하지 못했습니다.")
      setBusy(false)
    }
  }

  return (
    <div className="product">
      <motion.div
        className="product__visual"
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
      >
        <Character3D id="terry" />
      </motion.div>

      <motion.div
        className="product__info"
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.12 }}
      >
        <span className="badge badge--live">사전판매 진행중</span>

        <h1>테리</h1>
        <p className="product__tagline">
          머리에 프리지아를 얹은 여우. 첫 번째 사전판매 주인공입니다.
        </p>

        <div className="product__box">
          <h2>구성</h2>
          <ul className="contents">
            {(product?.contents ?? ["테리 인형 1개", "학과 랜덤 키링 1개"]).map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>

          <div className="price-row">
            <span>상품 금액</span>
            <strong>{product ? `${product.price.toLocaleString()}원` : "—"}</strong>
          </div>
          {shippingFee > 0 ? (
            <div className="price-row">
              <span>배송비</span>
              <strong>{shippingFee.toLocaleString()}원</strong>
            </div>
          ) : null}
          <div className="price-row price-row--total">
            <span>결제 금액</span>
            <strong>{product ? `${(product.price + shippingFee).toLocaleString()}원` : "—"}</strong>
          </div>

          <button type="button" className="cta" onClick={onBuy} disabled={busy || !product}>
            {busy ? "결제창을 여는 중…" : "사전판매 결제하기"}
          </button>

          <p className="note">
            토스페이먼츠 <strong>테스트 결제</strong>입니다. 실제 금액이 이체되지 않습니다.
          </p>

          {error ? (
            <p className="error" role="alert">
              {error}
            </p>
          ) : null}
        </div>
      </motion.div>
    </div>
  )
}
