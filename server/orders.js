import crypto from "node:crypto"

/**
 * In-memory order store. Fine for the test environment; swap for a real
 * database before going live — the guarantees below are what matter:
 *
 *  - an order records the amount the SERVER decided, never the client's
 *  - an order can only move pending -> paid once (no double confirm)
 */
const orders = new Map()

export function createOrder({ product, amount }) {
  // Toss requires orderId to be 6-64 chars, alphanumeric + -_
  const orderId = `terry_${Date.now()}_${crypto.randomBytes(6).toString("hex")}`
  const order = {
    orderId,
    productId: product.id,
    orderName: product.name,
    amount, // server-computed, authoritative
    status: "pending",
    createdAt: new Date().toISOString(),
    paymentKey: null,
    approvedAt: null,
  }
  orders.set(orderId, order)
  return order
}

export function getOrder(orderId) {
  return orders.get(orderId) ?? null
}

export function markPaid(orderId, { paymentKey, approvedAt }) {
  const order = orders.get(orderId)
  if (!order) return null
  order.status = "paid"
  order.paymentKey = paymentKey
  order.approvedAt = approvedAt
  return order
}

export function markFailed(orderId, reason) {
  const order = orders.get(orderId)
  if (!order) return null
  order.status = "failed"
  order.failureReason = reason
  return order
}
