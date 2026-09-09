import { useState } from "react"

import Character3D, { DEFAULT_TINTS } from "../components/Character3D.jsx"

/**
 * 제목 하나 · 모델 하나 · 버튼 하나.
 *
 * 무대에 상자를 두지 않아 캐릭터가 배경 위에 그대로 선다. 조작은 무대 아래
 * 가운데에 칩으로 놓아 모델을 가리지 않으면서 손이 닿는 크기를 지킨다.
 *
 * `특수 색깔` 은 2026-09-09 에 사용자 지시로 없앴다(모델을 통째로 바꿔 끼우는
 * 방식이었다). 남은 조작은 회전 하나뿐이다.
 */
export default function ModelSection({ id, title, tone = "brown" }) {
  // OS 의 "동작 줄이기"면 자동 회전 없이 시작한다.
  const [spinning, setSpinning] = useState(
    () => !(typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches)
  )

  return (
    <section className={`model model--${tone}`} id={id}>
      <div className="wrap">
        <h2 className="model__title">{title}</h2>

        <div className="model__stage">
          <Character3D id={id} tints={DEFAULT_TINTS} spinning={spinning} />
        </div>

        <div className="model__controls">
          <div className="segmented" role="group" aria-label="모델 조작">
            <button type="button" aria-pressed={!spinning} onClick={() => setSpinning((v) => !v)}>
              {spinning ? "회전 멈춤" : "회전 시작"}
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}
