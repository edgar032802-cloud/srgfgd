async function json(response) {
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const err = new Error(data.message ?? data.error ?? `HTTP ${response.status}`)
    err.code = data.error
    throw err
  }
  return data
}

export function fetchProducts() {
  return fetch("/api/products").then(json)
}

/**
 * Ask the server to open an order. We send only which product — the amount
 * comes back from the server and is the only one we're allowed to pay.
 */
export function createOrder(productId) {
  return fetch("/api/orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ productId }),
  }).then(json)
}

export function confirmPayment({ paymentKey, orderId, amount }) {
  return fetch("/api/payments/confirm", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ paymentKey, orderId, amount }),
  }).then(json)
}
