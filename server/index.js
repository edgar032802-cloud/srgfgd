import path from "node:path"
import { fileURLToPath } from "node:url"

import "dotenv/config"
import express from "express"

import { PRODUCTS, SHIPPING_FEE, getPurchasableProduct, totalFor } from "./catalog.js"
import { createOrder, getOrder, markFailed, markPaid } from "./orders.js"
import boothRouter from "./booth.js"

const app = express()
app.use(express.json())

// 부스 체험 예약 대기열. 결제와는 완전히 별개의 파일에 있다 — 여기서는 붙이기만 한다.
app.use("/api/booth", boothRouter)

/**
 * 개발에서는 Vite(5173)가 화면을, 이 서버(8787)가 API 를 맡고 Vite 가 `/api` 를
 * 이쪽으로 넘겨 준다. **배포에서는 프로세스가 하나뿐이라** 이 서버가 빌드된
 * 화면까지 함께 내보낸다 — 그래야 주소가 하나로 끝나고, 브라우저가 부르는
 * 상대 경로 `/api/...` 가 같은 출처로 떨어져 CORS 를 만들지 않는다.
 */
// `--prod` 도 본다. 윈도우 cmd 와 리눅스 셸에서 환경변수를 앞에 붙이는 문법이
// 달라, 어디서 실행하든 같게 동작하려면 인자가 가장 확실하다.
const PROD = process.env.NODE_ENV === "production" || process.argv.includes("--prod")

/**
 * 포트. 개발에서는 `PORT` 를 쓰지 않는다 — 그 이름은 너무 많은 도구가 건드리고,
 * 어떤 것이 Vite 의 5173 을 넣어 두는 바람에 두 서버가 같은 포트를 두고 싸운
 * 적이 있다. 반대로 배포 플랫폼은 `PORT` 로만 포트를 알려 주므로, 그때는 받는다.
 */
const PORT = Number(process.env.API_PORT ?? (PROD ? (process.env.PORT ?? 8787) : 8787))
const TOSS_SECRET_KEY = process.env.TOSS_SECRET_KEY ?? ""
const TOSS_CONFIRM_URL = "https://api.tosspayments.com/v1/payments/confirm"

/** Toss authenticates with HTTP Basic: base64("<secretKey>:") — note the colon. */
function tossAuthHeader() {
  return "Basic " + Buffer.from(`${TOSS_SECRET_KEY}:`).toString("base64")
}

/* ------------------------------------------------------------------ *
 * Catalog — the browser reads prices from here, it never sends them.
 * ------------------------------------------------------------------ */

app.get("/api/products", (_req, res) => {
  res.json({
    products: Object.values(PRODUCTS).map((p) => ({
      id: p.id,
      name: p.name,
      price: p.price,
      status: p.status,
      contents: p.contents,
    })),
    shippingFee: SHIPPING_FEE,
  })
})

/* ------------------------------------------------------------------ *
 * Step 1 — create an order. The amount is decided HERE.
 * ------------------------------------------------------------------ */

app.post("/api/orders", (req, res) => {
  const productId = String(req.body?.productId ?? "")

  // Deliberately ignore req.body.amount if a client sends one.
  if ("amount" in (req.body ?? {})) {
    console.warn(`[security] client sent an amount for ${productId}; ignoring it`)
  }

  const { product, error } = getPurchasableProduct(productId)
  if (error) return res.status(400).json({ error })

  const amount = totalFor(product)
  const order = createOrder({ product, amount })

  res.json({
    orderId: order.orderId,
    orderName: order.orderName,
    amount: order.amount, // server-issued; the SDK call must use exactly this
  })
})

/* ------------------------------------------------------------------ *
 * Step 2 — confirm. Reaching successUrl proves nothing on its own;
 * a payment counts as complete only once Toss approves it here.
 * ------------------------------------------------------------------ */

app.post("/api/payments/confirm", async (req, res) => {
  const { paymentKey, orderId, amount } = req.body ?? {}

  if (!paymentKey || !orderId || amount === undefined) {
    return res.status(400).json({ error: "MISSING_PARAMETERS" })
  }
  if (!TOSS_SECRET_KEY) {
    return res.status(500).json({ error: "SERVER_NOT_CONFIGURED", message: "TOSS_SECRET_KEY 가 설정되지 않았습니다." })
  }

  const order = getOrder(String(orderId))
  if (!order) return res.status(404).json({ error: "UNKNOWN_ORDER" })

  // Replay / double-submit guard.
  if (order.status === "paid") {
    return res.json({ ok: true, alreadyConfirmed: true, order: publicOrder(order) })
  }
  if (order.status === "failed") {
    return res.status(409).json({ error: "ORDER_ALREADY_FAILED" })
  }

  // The amount echoed back through the browser must match what we stored,
  // and what we stored must still match the catalog price. Either mismatch
  // means the redirect was tampered with — refuse before calling Toss.
  const clientAmount = Number(amount)
  const { product, error: productError } = getPurchasableProduct(order.productId)
  if (productError) {
    markFailed(order.orderId, productError)
    return res.status(409).json({ error: productError })
  }
  const expected = totalFor(product)

  if (clientAmount !== order.amount || order.amount !== expected) {
    markFailed(order.orderId, "AMOUNT_MISMATCH")
    console.error(
      `[security] amount mismatch on ${order.orderId}: client=${clientAmount} stored=${order.amount} catalog=${expected}`
    )
    return res.status(400).json({
      error: "AMOUNT_MISMATCH",
      message: "결제 금액이 서버의 상품 금액과 일치하지 않습니다.",
    })
  }

  // Send the SERVER's amount to Toss, not the client's.
  let tossResponse
  try {
    const response = await fetch(TOSS_CONFIRM_URL, {
      method: "POST",
      headers: {
        Authorization: tossAuthHeader(),
        "Content-Type": "application/json",
        "Idempotency-Key": order.orderId,
      },
      body: JSON.stringify({ paymentKey, orderId: order.orderId, amount: order.amount }),
    })
    tossResponse = await response.json()

    if (!response.ok) {
      markFailed(order.orderId, tossResponse?.code ?? "TOSS_ERROR")
      return res.status(response.status).json({
        error: tossResponse?.code ?? "TOSS_ERROR",
        message: tossResponse?.message ?? "결제 승인에 실패했습니다.",
      })
    }
  } catch (e) {
    markFailed(order.orderId, "TOSS_UNREACHABLE")
    return res.status(502).json({ error: "TOSS_UNREACHABLE", message: e.message })
  }

  // Belt and braces: trust Toss's own record of what was charged.
  if (Number(tossResponse.totalAmount) !== order.amount) {
    markFailed(order.orderId, "APPROVED_AMOUNT_MISMATCH")
    console.error(
      `[security] Toss approved ${tossResponse.totalAmount} but order was ${order.amount} (${order.orderId})`
    )
    return res.status(409).json({ error: "APPROVED_AMOUNT_MISMATCH" })
  }

  const paid = markPaid(order.orderId, {
    paymentKey,
    approvedAt: tossResponse.approvedAt ?? new Date().toISOString(),
  })

  res.json({ ok: true, order: publicOrder(paid), method: tossResponse.method ?? null })
})

/** Order status lookup — used by the success page, never as proof by itself. */
app.get("/api/orders/:orderId", (req, res) => {
  const order = getOrder(req.params.orderId)
  if (!order) return res.status(404).json({ error: "UNKNOWN_ORDER" })
  res.json({ order: publicOrder(order) })
})

function publicOrder(order) {
  return {
    orderId: order.orderId,
    orderName: order.orderName,
    amount: order.amount,
    status: order.status,
    approvedAt: order.approvedAt,
  }
}

/* ------------------------------------------------------------------ *
 * 배포일 때만: 빌드된 화면을 이 서버가 함께 내보낸다.
 * ------------------------------------------------------------------ */

if (PROD) {
  const dist = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist")
  app.use(express.static(dist))
  // 라우팅이 해시(`#/booth`)라 경로는 언제나 하나지만, 새로고침·직접 입력·
  // 잘못된 주소까지 전부 화면으로 돌려보낸다. `/api` 로 시작하는 것만 비켜 간다.
  app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")))
}

if (!PROD && PORT === 5173) {
  console.error("[server] API_PORT must not be 5173 — that is the Vite dev server.")
  process.exit(1)
}

// 개발 기본은 이 컴퓨터에서만. 같은 와이파이의 휴대폰이 붙어야 하면 API_HOST=0.0.0.0.
// 배포에서는 밖에서 들어와야 하므로 처음부터 0.0.0.0 이다.
const HOST = process.env.API_HOST ?? (PROD ? "0.0.0.0" : "127.0.0.1")

const server = app.listen(PORT, HOST, () => {
  console.log(`[server] listening on http://${HOST === "0.0.0.0" ? "0.0.0.0" : "localhost"}:${PORT}`)
  console.log(`[server] mode ${PROD ? "production (화면 + API)" : "development (API 만)"}`)
  console.log(`[server] TOSS_SECRET_KEY ${TOSS_SECRET_KEY ? "loaded" : "MISSING — /api/payments/confirm will refuse"}`)
})

// Fail loudly. Silently losing the port is what made the site flaky.
server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error(`[server] port ${PORT} is already in use. Stop the other process or set API_PORT.`)
  } else {
    console.error("[server]", err)
  }
  process.exit(1)
})
