/**
 * Server-side source of truth for what anything costs.
 *
 * Nothing in here is ever taken from the client. The browser may ask "how much
 * is terry?" but it may never *tell* us. Every amount used for a payment is
 * read from this table on the server.
 */

export const PRODUCTS = {
  terry: {
    id: "terry",
    name: "테리 인형 + 학과 랜덤 키링",
    // 사전판매가. 원 단위 정수.
    price: 1,
    status: "on_sale",
    contents: ["테리 인형 1개", "학과 랜덤 키링 1개"],
  },
  aqu: {
    id: "aqu",
    name: "아큐 인형",
    price: null,
    status: "coming_soon",
    contents: [],
  },
}

/**
 * 배송비: 이 프로젝트에는 배송비 설정이 존재하지 않는다.
 * 별도 지시가 없는 한 상품가 외의 금액을 임의로 만들지 않는다.
 * 배송비를 도입하려면 여기에 명시적으로 추가하고, totalFor()도 함께 고쳐야 한다.
 */
export const SHIPPING_FEE = 0

export function getPurchasableProduct(productId) {
  const product = PRODUCTS[productId]
  if (!product) return { error: "UNKNOWN_PRODUCT" }
  if (product.status !== "on_sale") return { error: "NOT_ON_SALE" }
  if (!Number.isInteger(product.price) || product.price < 1) {
    return { error: "INVALID_PRICE" }
  }
  return { product }
}

/** 서버가 계산하는 최종 결제금액. 클라이언트 입력은 관여하지 않는다. */
export function totalFor(product) {
  return product.price + SHIPPING_FEE
}
