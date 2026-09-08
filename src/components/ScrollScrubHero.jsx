import { useEffect, useRef, useState } from "react"

const FRAME_COUNT = 131
const WINDOW = 12 // frames kept decoded either side of the current one

// 영상 131 장을 처음부터 끝까지 전부 건다(사용자 지시).
//
// 앞 여섯 장은 캐릭터가 흰 화면에서 날아드는 모션 블러, 뒤 열여섯 장은 다시 날아
// 나가는 블러와 공백이다. 그래서 한동안 그려진 구간(f_007~f_115)만 썼는데, 사용자가
// 세 번에 걸쳐 전체를 요구했다. 들어오고 나가는 연출까지가 이 영상이라는 뜻이다.
const FIRST = 0 // f_001 — 영상의 첫 장
const LAST = 130 // f_131 — 영상의 마지막 장
const SPAN = LAST - FIRST

const frameSrc = (i) => `/frames/f_${String(i + 1).padStart(3, "0")}.jpg`
const clamp01 = (v) => Math.min(1, Math.max(0, v))

/** Average the four corners of a frame — the footage sits on a flat colour. */
function sampleCorner(img) {
  try {
    const c = document.createElement("canvas")
    c.width = 8
    c.height = 8
    const g = c.getContext("2d", { willReadFrequently: true })
    g.drawImage(img, 0, 0, 8, 8)
    const d = g.getImageData(0, 0, 8, 8).data
    const at = (x, y) => {
      const i = (y * 8 + x) * 4
      return [d[i], d[i + 1], d[i + 2]]
    }
    const pts = [at(0, 0), at(7, 0), at(0, 7), at(7, 7)]
    const avg = pts.reduce((a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]], [0, 0, 0]).map((v) => Math.round(v / 4))
    return `rgb(${avg[0]}, ${avg[1]}, ${avg[2]})`
  } catch {
    // 샘플링이 막히면(캔버스 오염 등) 프레임의 평면색 --reel 로. paper 로 두면
    // 프레임 모서리색과 달라져 그림이 뜰 때 번쩍인다.
    return getComputedStyle(document.documentElement).getPropertyValue("--reel").trim() || "#faf6c9"
  }
}

function fadeOut(p, hold, end) {
  if (p <= hold) return 1
  if (p >= end) return 0
  return 1 - (p - hold) / (end - hold)
}

/**
 * Apple-style scroll scrubbing over a JPEG sequence extracted from the source
 * video. Scroll position alone picks the frame — there is no playback phase.
 *
 * Holding all 131 frames decoded costs ~260MB of heap and stutters the page, so
 * only a window around the current frame stays in memory; the rest are dropped
 * and re-created from the HTTP cache when scrolled back to.
 */
export default function ScrollScrubHero({ children }) {
  const wrapRef = useRef(null)
  const canvasRef = useRef(null)
  const copyRef = useRef(null)
  const cueRef = useRef(null)
  const scrimRef = useRef(null)

  const imagesRef = useRef(new Array(FRAME_COUNT).fill(null))
  const lastPainted = useRef(-1)
  const readyRef = useRef(false)
  const bgRef = useRef(null)
  const [ready, setReady] = useState(false)

  function ensure(index) {
    const images = imagesRef.current
    if (index < FIRST || index > LAST) return null
    let img = images[index]
    if (!img) {
      img = new Image()
      img.decoding = "async"
      // addEventListener, not onload: several call sites want to know when a
      // frame arrives, and assigning onload silently replaces the last one.
      img.addEventListener(
        "load",
        () => {
          lastPainted.current = -1
          render()
        },
        { once: true }
      )
      img.src = frameSrc(index)
      images[index] = img
    }
    return img
  }

  function trim(center) {
    const images = imagesRef.current
    for (let i = 0; i < FRAME_COUNT; i++) {
      if (Math.abs(i - center) <= WINDOW) continue
      if (images[i]) {
        images[i].src = ""
        images[i] = null
      }
    }
  }

  function paint(index) {
    const canvas = canvasRef.current
    const img = imagesRef.current[index]
    if (!canvas || !img || !img.complete || img.naturalWidth === 0) return
    if (lastPainted.current === index) return
    lastPainted.current = index

    const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
    const w = canvas.clientWidth
    const h = canvas.clientHeight
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
    }

    const ctx = canvas.getContext("2d")
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

    // The footage is 16:9. On a tall window it has to be fitted rather than
    // cropped, which would otherwise leave bands of empty page above and below.
    // Painting the frame's own background colour first makes the fit seamless.
    if (!bgRef.current) bgRef.current = sampleCorner(img)
    ctx.fillStyle = bgRef.current
    ctx.fillRect(0, 0, w, h)

    // 그림과 제목을 한 덩어리로 보고 화면 정중앙에 놓는다. 그림만 가운데 두면
    // 위쪽만 무거워지고, 겹치지 않으려고 그림을 줄이면 비율이 어색해진다.
    // 제목의 실제 높이를 재서 둘을 함께 가운데 맞춘다.
    const imgAspect = img.naturalWidth / img.naturalHeight
    const dh = Math.min(h * 0.55, (w * 0.94) / imgAspect)
    const dw = dh * imgAspect
    const copyH = copyRef.current?.offsetHeight ?? Math.round(h * 0.1)
    const gap = Math.round(h * 0.045)
    const dy = Math.max(h * 0.04, (h - (dh + gap + copyH)) / 2)
    ctx.drawImage(img, (w - dw) / 2, dy, dw, dh)
    // 제목은 CSS 가 이 값을 읽어 그림 바로 아래에 붙는다.
    canvas.parentElement?.style.setProperty("--hero-copy-top", Math.round(dy + dh + gap) + "px")

    // The cover is lifted by an actual successful paint, not by a load event
    // that something else might have swallowed.
    if (!readyRef.current) {
      readyRef.current = true
      if (bgRef.current && canvas.parentElement) canvas.parentElement.style.background = bgRef.current
      setReady(true)
    }
  }

  function render() {
    const wrap = wrapRef.current
    if (!wrap) return

    const rect = wrap.getBoundingClientRect()
    const travel = rect.height - window.innerHeight
    const p = travel <= 0 ? 0 : clamp01(-rect.top / travel)
    const index = FIRST + Math.round(p * SPAN)

    for (let i = index - 3; i <= index + WINDOW; i++) ensure(i)
    trim(index)

    // No onload wiring here — ensure() already listens, and assigning it a
    // second time is what previously threw away the "first frame is ready"
    // handler and left the cover up over a blank banner.
    if (imagesRef.current[index]?.complete) paint(index)

// 스크롤을 시작하면 제목이 곧 빠지고, 남은 구간 전체가 영상 재생이 된다.
    // 제목은 CSS 로 화면 한가운데 놓여 있으므로 translate 에 -50% 를 유지한다.
    if (copyRef.current) {
      const o = fadeOut(p, 0.06, 0.26)
      copyRef.current.style.opacity = o
      copyRef.current.style.transform = `translateY(${(1 - o) * -16}px)`
    }
    if (cueRef.current) cueRef.current.style.opacity = fadeOut(p, 0.04, 0.16)
    // Flat scrim, never a gradient — the references use solid fills only.
    if (scrimRef.current) scrimRef.current.style.opacity = fadeOut(p, 0.06, 0.26) * 0.12
  }

  useEffect(() => {
    // 정리 시점에 ref 를 다시 읽지 않도록 배열을 잡아 둔다(같은 배열을 계속 쓴다).
    const images = imagesRef.current
    for (let i = FIRST; i <= FIRST + WINDOW; i++) ensure(i)

    // Failsafe: never leave the banner permanently covered, even if a frame
    // fails to decode. A missing image is better than a blank page.
    const giveUp = setTimeout(() => {
      if (!readyRef.current) {
        readyRef.current = true
        setReady(true)
      }
    }, 2500)

    let ticking = false
    const onScroll = () => {
      if (ticking) return
      ticking = true
      requestAnimationFrame(() => {
        render()
        ticking = false
      })
    }
    const onResize = () => {
      lastPainted.current = -1
      render()
    }

    window.addEventListener("scroll", onScroll, { passive: true })
    window.addEventListener("resize", onResize)
    render()

    return () => {
      clearTimeout(giveUp)
      window.removeEventListener("scroll", onScroll)
      window.removeEventListener("resize", onResize)
      images.forEach((img, i) => {
        if (img) {
          img.src = ""
          images[i] = null
        }
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  return (
    <section className="hero-scrub" id="top" ref={wrapRef} aria-label="프리지아 인트로">
      <div className="hero-scrub__sticky">
        <canvas ref={canvasRef} className="hero-scrub__canvas" aria-hidden="true" />

        {/* sits above the canvas but below the copy, so the title always shows */}
        {!ready ? <div className="hero-scrub__boot" aria-hidden="true" /> : null}

        <div ref={scrimRef} className="hero-scrub__scrim" aria-hidden="true" />

        <div ref={copyRef} className="hero-scrub__copy">
          {children}
        </div>

        {/* 영문 라벨 대신 한글 한 단어 + 세로선. 자간은 손대지 않는다. */}
        <div ref={cueRef} className="hero-scrub__cue" aria-hidden="true">
          <span>아래로</span>
          <i />
        </div>
      </div>
    </section>
  )
}
