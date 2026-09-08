import { motion } from "motion/react"

import Character3D from "../components/Character3D.jsx"

/** 아큐 미리보기. 배지 하나로 충분해서 무대 위 리본은 두지 않는다. */
export default function AquPage() {
  return (
    <div className="product">
      <motion.div
        className="product__visual"
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
      >
        <Character3D id="aqu" />
      </motion.div>

      <motion.div
        className="product__info"
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.12 }}
      >
        <span className="badge badge--soon">COMING SOON</span>

        <h1>아큐</h1>
        <p className="product__tagline">프리지아를 안고 있는 비버. 두 번째 사전판매를 준비하고 있습니다.</p>

        <div className="product__box">
          <h2>공개 예정</h2>
          <p className="soon-copy">구성과 가격은 준비되는 대로 공개합니다.</p>

          <button className="cta" disabled>
            판매 준비중
          </button>

          <p className="note">테리 사전판매를 먼저 확인해보세요.</p>
          <a className="link ghost-link" href="#/terry">
            테리 판매 페이지로 →
          </a>
        </div>
      </motion.div>
    </div>
  )
}
