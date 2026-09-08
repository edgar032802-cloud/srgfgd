import { useState } from "react"

import Character3D, { DEFAULT_TINTS } from "../components/Character3D.jsx"

/**
 * 제목 하나 · 모델 하나 · 버튼 두 개.
 *
 * 무대에 상자를 두지 않아 캐릭터가 배경 위에 그대로 선다. 조작은 무대 아래 양쪽
 * 끝에 칩으로 놓아 모델을 가리지 않으면서 손이 닿는 크기를 지킨다.
 */
export default function ModelSection({ id, title, tone = "brown" }) {
  const [special, setSpecial] = useState(false)
  // 특수 색깔은 색을 칠하는 게 아니라 따로 만들어진 모델로 바꿔 끼우는 것이다.
  const modelId = special ? `${id}-special` : id
  // OS 의 "동작 줄이기"면 자동 회전 없이 시작한다.
  const [spinning, setSpinning] = useState(
    () => !(typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches)
  )

  return (
    <section className={`model model--${tone}`} id={id}>
      <div className="wrap">
        <h2 className="model__title">{title}</h2>

        <div className="model__stage">
          <Character3D key={modelId} id={modelId} tints={DEFAULT_TINTS} spinning={spinning} />
        </div>

        {/* 두 조작을 한 덩어리로 묶는다. 양 끝에 흰 상자 두 개가 떨어져 있으면
            모델과 따로 노는 조각처럼 보인다. */}
        <div className="model__controls">
          <div className="segmented" role="group" aria-label="모델 조작">
            <button
              type="button"
              aria-pressed={special}
              onClick={() => setSpecial((v) => !v)}
            >
              특수 색깔
            </button>
            <button
              type="button"
              aria-pressed={!spinning}
              onClick={() => setSpinning((v) => !v)}
            >
              {spinning ? "회전 멈춤" : "회전 시작"}
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
