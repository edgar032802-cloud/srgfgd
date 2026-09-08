import { useEffect, useState } from "react"
import { MotionConfig } from "motion/react"

import ScrollScrubHero from "./components/ScrollScrubHero.jsx"
import Activities from "./sections/Activities.jsx"
import ModelSection from "./sections/ModelSection.jsx"
import TerryRun from "./sections/TerryRun.jsx"
import Footer from "./sections/Footer.jsx"
import TerryPage from "./pages/TerryPage.jsx"
import AquPage from "./pages/AquPage.jsx"
import BoothAdmin from "./pages/BoothAdmin.jsx"
import { PaymentFail, PaymentSuccess } from "./pages/PaymentResult.jsx"
import {
  SenseAvoid,
  SenseRegister,
  SenseSeek,
  SenseSensitive,
} from "./pages/ActivityPages.jsx"
import "./App.css"

/** 페이지 라우트는 `#/...` 꼴. `#activities` 같은 맨 해시는 홈 안의 앵커다. */
const isPageHash = (hash) => hash.startsWith("#/")
/** `#/terry` → "terry", `#/`·`#activities`·"" → ""(홈). */
const routeOf = (hash) => (isPageHash(hash) ? hash.slice(2).split("?")[0] : "")
const prefersReducedMotion = () =>
  typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches

/**
 * 아래로 내려가면 상단 바가 물러나고, 위로 올리면 돌아온다.
 *
 * 브랜드 마크는 배경 없이 본문 위에 떠 있어야 하는데(알약 배경은 사용자가 두 번
 * 물렸다), 그러면 3D 무대·말랑이 칩·게임 HUD 가 그 밑을 지날 때마다 글자가 겹쳐
 * 읽힌다. 읽는 동안 치우고 필요할 때 돌려주는 편이 배경을 까는 것보다 조용하다.
 */
function useTopBarHidden() {
  const [hidden, setHidden] = useState(false)

  useEffect(() => {
    let last = window.scrollY
    let ticking = false
    const read = () => {
      ticking = false
      const y = window.scrollY
      // 8px 미만의 흔들림으로는 상태를 바꾸지 않는다.
      if (Math.abs(y - last) < 8) return
      setHidden(y > last && y > 160)
      last = y
    }
    const onScroll = () => {
      if (ticking) return
      ticking = true
      requestAnimationFrame(read)
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    return () => window.removeEventListener('scroll', onScroll)
  }, [])

  return hidden
}

function useRoute() {
  // `#aqu`(앵커)와 `#/aqu`(페이지)가 같은 이름을 쓰므로 슬래시 유무로만 가른다.
  const read = () => routeOf(window.location.hash)
  const [route, setRoute] = useState(read)

  useEffect(() => {
    const onChange = () => {
      setRoute(read())
      // 앵커 점프(`#making`)까지 맨 위로 되돌리면 내비가 동작하지 않는다.
      // 페이지 전환일 때만 스크롤을 초기화한다.
      if (isPageHash(window.location.hash) || window.location.hash === "") window.scrollTo(0, 0)
    }
    window.addEventListener("hashchange", onChange)
    return () => window.removeEventListener("hashchange", onChange)
  }, [])

  return route
}

/**
 * 상단 정중앙 고정 브랜드 마크 — 회색 엠블럼 실루엣 + 프리지아 한 세트.
 * 배경 알약 없이 multiply 로 곱해지므로 크림·갈색·이미지 위에서 그대로 읽힌다.
 */
function BrandMark({ hidden = false }) {
  const toTop = (event) => {
    // 상품 페이지에서는 해시를 바꿔 홈으로 돌아가고(라우터가 맨 위로 보낸다),
    // 홈에서는 해시를 건드리지 않고 부드럽게 맨 위로만 올린다.
    // `#/` 자체는 홈이다 — 상품 페이지에서 돌아온 직후에도 마크가 동작해야 한다.
    if (routeOf(window.location.hash) !== "") return
    event.preventDefault()
    if (window.location.hash) history.replaceState(null, "", window.location.pathname + window.location.search)
    window.scrollTo({ top: 0, behavior: prefersReducedMotion() ? "auto" : "smooth" })
  }

  return (
    <a
      className={`brandmark ${hidden ? "is-away" : ""}`}
      href="#/"
      onClick={toTop}
      aria-label="프리지아 — 맨 위로"
    >
      <img src="/brand/logo-mark.png" alt="" width="30" height="29" />
      <span>프리지아</span>
    </a>
  )
}

function Home() {
  const hidden = useTopBarHidden()

  return (
    <>
      <BrandMark hidden={hidden} />
      <main>
{/* 스크롤이 프레임을 넘긴다 — 재생 버튼도, 부제도 없다. 제목 한 줄뿐. */}
        <ScrollScrubHero>
          <h1 className="hero__title">아큐 &amp; 테리</h1>
        </ScrollScrubHero>

        {/* 체험 차림표 → 돌려보기 → 달리기. 읽는 페이지 없이 고르고 만지는 것만 남긴다. */}
        <Activities />

        <ModelSection id="aqu" title="아큐 직접 돌려보기" tone="brown" />
        <ModelSection id="terry" title="테리 직접 돌려보기" tone="reel" />

        <TerryRun />
      </main>
      <Footer />
    </>
  )
}

function Shell({ children }) {
  return (
    <>
      <BrandMark />
      <main className="shell">
        <a className="shell__back" href="#/">
          ← 홈으로
        </a>
        {children}
      </main>
    </>
  )
}

export default function App() {
  const route = useRoute()

  let page = <Home />
  if (route === "sense/register") page = <Shell><SenseRegister /></Shell>
  else if (route === "sense/seek") page = <Shell><SenseSeek /></Shell>
  else if (route === "sense/sensitive") page = <Shell><SenseSensitive /></Shell>
  else if (route === "sense/avoid") page = <Shell><SenseAvoid /></Shell>
  // 운영자 화면. 어디에서도 링크하지 않는다 — 푸터 로고를 다섯 번 누르면 열린다.
  else if (route === "booth") page = <Shell><BoothAdmin /></Shell>
  else if (route === "terry") page = <Shell><TerryPage /></Shell>
  else if (route === "aqu") page = <Shell><AquPage /></Shell>
  else if (route === "pay/success") page = <Shell><PaymentSuccess /></Shell>
  else if (route === "pay/fail") page = <Shell><PaymentFail /></Shell>

  // 모션은 whileInView 페이드/라이즈뿐이라, OS의 "동작 줄이기"면 통째로 끈다.
  return <MotionConfig reducedMotion="user">{page}</MotionConfig>
}
