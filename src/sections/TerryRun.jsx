import { useCallback, useEffect, useRef, useState } from "react"
import "./terry-run.css"

/**
 * 세계의 **가로**만 고정이다. 캔버스는 이 폭에 맞춰 그려지므로 W 가 곧 배율 —
 * W 를 줄이면 같은 폭에 더 적은 단위가 들어와 캐릭터가 그만큼 크게 보인다.
 * 800 → 560 → 420 으로 두 번 당겼다(사용자가 "박스가 작다"를 두 번 물렸다).
 * 그때마다 속도·간격·장애물을 같은 비율로 줄여 **한 화면을 가로지르는 시간**과
 * **장애물의 화면상 크기**를 그대로 뒀다. 커지는 것은 테리뿐이다.
 *
 * 세로는 고정하지 않는다. 지면선을 상자의 **아래에서** 재므로(GROUND_BAND),
 * 남는 위쪽은 그대로 하늘이 된다 — 덕분에 프레임 비율을 화면마다 다르게 줄 수
 * 있다(모바일은 세로로 길게, 데스크톱은 납작하게). 물리는 가로에만 걸려 있어
 * 하늘이 얼마나 보이든 PC 와 모바일의 게임은 완전히 같다.
 */
const W = 420
/** 지면선 아래 띠. 점만 뿌려지는 여백이자 HUD 자리다. */
const GROUND_BAND = 22

const GRAVITY = 2400
const JUMP_V = 760
const START_SPEED = 178
const MAX_SPEED = 378

const TERRY_W = 62
const TERRY_H = 62
const TERRY_X = 42

/**
 * 충돌 상자는 그림보다 좁다. 테리를 키우면 몸이 차지하는 폭이 늘어 같은 점프로
 * 넘을 수 있는 여유가 줄어드는데(계측: 190ms → 155ms), 꼬리와 귀를 판정에서
 * 빼면 그만큼 되돌아온다(177ms). 스치는 털은 부딪힌 것으로 치지 않는다.
 */
const HIT_W = 40
const HIT_INSET = (TERRY_W - HIT_W) / 2

/**
 * 스프라이트마다 투명 여백이 다르다. 이미지 상자를 그대로 지면에 맞추면
 * 달리기 포즈는 아래쪽 14% 가 빈 픽셀이라 캐릭터가 공중에 뜬 것처럼 보인다.
 * 실제 그림이 들어 있는 영역(알파 바운딩 박스)을 재서 그 밑변을 지면에 맞춘다.
 * 값은 원본 PNG 를 픽셀 단위로 측정한 비율이다.
 */
const SPRITE_BOX = {
  // terry-run.png 560x622 — x[54,559] y[32,534]
  run: { left: 0.0964, right: 0.0, top: 0.0514, bottom: 0.1399 },
  // terry-jump.png 603x684 — 그림에 딱 맞게 잘라 두어 여백이 없다.
  jump: { left: 0, right: 0, top: 0, bottom: 0 },
}

/** How long the landing squash lasts, in seconds. */
const LAND_T = 0.14

const TAU = Math.PI * 2

/**
 * Everything drawn is a flat, single colour — clay lumps, ground speckle,
 * dust. Three lump kinds, three greys in the #a89c8d ~ #8d8378 range.
 */
const CLAY_LUMP = "#a89c8d" // 덩이 — small, low
const CLAY_PAIR = "#9b9083" // 쌍덩이 — a base with a smaller lump on top
const CLAY_POST = "#8d8378" // 기둥 — tall, narrow
const SPECK = "#14110f"
const DUST = "#a89c8d"

/**
 * Ground speckle: one repeating tile per layer, generated once per load.
 * y 는 지면선에서 **아래로** 얼마나 떨어졌는지다(지면선 자체가 상자마다 움직인다).
 */
const TILE = 252
function makeDots(count, yMin, yMax, rMin, rMax) {
  const dots = []
  for (let i = 0; i < count; i++) {
    dots.push({
      x: Math.random() * TILE,
      y: yMin + Math.random() * (yMax - yMin),
      r: rMin + Math.random() * (rMax - rMin),
    })
  }
  return dots
}
const DOTS_FAR = makeDots(16, 4, 10, 0.55, 0.78)
const DOTS_NEAR = makeDots(11, 2, 7, 0.78, 1)

/**
 * A rounded silhouette. Top corners take the full radius; the bottom corners
 * are flatter so the lump reads as pressed onto the ground, not floating.
 */
function lumpPath(ctx, x, y, w, h, rt, rb) {
  ctx.beginPath()
  ctx.moveTo(x + rt, y)
  ctx.lineTo(x + w - rt, y)
  ctx.arcTo(x + w, y, x + w, y + rt, rt)
  ctx.lineTo(x + w, y + h - rb)
  ctx.arcTo(x + w, y + h, x + w - rb, y + h, rb)
  ctx.lineTo(x + rb, y + h)
  ctx.arcTo(x, y + h, x, y + h - rb, rb)
  ctx.lineTo(x, y + rt)
  ctx.arcTo(x, y, x + rt, y, rt)
  ctx.closePath()
}

/**
 * Obstacles are clay lumps: one or two rounded parts in a single colour.
 * `parts` are rectangles relative to the lump's bottom-left corner (x right,
 * y up from the ground). Collision tests the same rectangles that are drawn,
 * so the hit box never disagrees with the silhouette.
 */
function makeObstacle(x, speed) {
  // taller lumps become more likely as it speeds up
  const tallP = Math.min(0.5, speed / MAX_SPEED)
  const roll = Math.random()

  // 치수는 세계를 560 에서 420 으로 당기며 0.75 배로 함께 줄였다 —
  // 그래야 장애물의 화면상 크기가 직전과 같고, 넘는 난이도도 거의 그대로다.
  if (roll < tallP) {
    const w = 13.5 + Math.random() * 4.5
    const h = 33 + Math.random() * 10.5
    return { x, w, h, color: CLAY_POST, parts: [{ x: 0, y: 0, w, h, r: 4 }] }
  }

  if (roll < tallP + (1 - tallP) * 0.55) {
    const w = 21 + Math.random() * 6
    const h = 16.5 + Math.random() * 4.5
    return { x, w, h, color: CLAY_LUMP, parts: [{ x: 0, y: 0, w, h, r: 4.5 }] }
  }

  const bw = 25.5 + Math.random() * 6
  const bh = 16.5 + Math.random() * 4.5
  const tw = 12 + Math.random() * 3
  const th = 12 + Math.random() * 4.5
  const overlap = 3 // the top lump sinks into the base so the two merge
  const tx = Math.random() < 0.5 ? 1.5 : bw - tw - 1.5
  return {
    x,
    w: bw,
    h: bh + th - overlap,
    color: CLAY_PAIR,
    parts: [
      { x: 0, y: 0, w: bw, h: bh, r: 4.5 },
      { x: tx, y: bh - overlap, w: tw, h: th, r: 4 },
    ],
  }
}

function drawObstacle(ctx, o, ground) {
  // 그림자는 그리지 않는다 — 캐릭터도 지면에 그대로 얹혀 있고, 평평한 단색이
  // 이 화면의 규칙이다.
  ctx.fillStyle = o.color
  for (const p of o.parts) {
    lumpPath(ctx, o.x + p.x, ground - p.y - p.h, p.w, p.h, p.r, p.y > 0 ? p.r : 2)
    ctx.fill()
  }
}

/** Faint single-colour speckle that flows with the ground, two depths. */
function drawDots(ctx, dots, offset, viewW, alpha, ground) {
  ctx.globalAlpha = alpha
  ctx.fillStyle = SPECK
  const start = -(offset % TILE)
  for (let tx = start; tx < viewW; tx += TILE) {
    for (const d of dots) {
      const x = tx + d.x
      if (x < -2 || x > viewW + 2) continue
      ctx.beginPath()
      ctx.arc(x, ground + d.y, d.r, 0, TAU)
      ctx.fill()
    }
  }
  ctx.globalAlpha = 1
}

/** Two or three short puffs kicked out sideways from the feet on landing. */
function spawnDust(s, ground) {
  const n = Math.random() < 0.5 ? 2 : 3
  const fx = TERRY_X + TERRY_W / 2
  for (let i = 0; i < n; i++) {
    const dir = i % 2 === 0 ? -1 : 1
    s.dust.push({
      x: fx + dir * (4 + Math.random() * 8),
      y: ground - 2 - Math.random() * 2,
      vx: dir * (26 + Math.random() * 40),
      vy: -(18 + Math.random() * 30),
      r: 2.4 + Math.random() * 1.6,
      life: 0,
      ttl: 0.26 + Math.random() * 0.12,
    })
  }
}

function stepDust(s, dt, groundSpeed) {
  for (const d of s.dust) {
    d.life += dt
    d.x += (d.vx - groundSpeed * 0.5) * dt
    d.y += d.vy * dt
    d.vy *= 1 - 3 * dt // slows as it rises
  }
  s.dust = s.dust.filter((d) => d.life < d.ttl)
}

function drawDust(ctx, s) {
  ctx.fillStyle = DUST
  for (const d of s.dust) {
    const k = d.life / d.ttl
    ctx.globalAlpha = 0.34 * (1 - k)
    ctx.beginPath()
    ctx.arc(d.x, d.y, d.r * (1 + 0.8 * k), 0, TAU)
    ctx.fill()
  }
  ctx.globalAlpha = 1
}

/**
 * The run pose is drawn as-is — the sprite already reads as running, and
 * animating on top of it looked wrong. Only the jump moves: stretch tall and
 * tip back on the way up, flatten and tip nose-down on the way down, then a
 * brief squash on landing.
 */
function drawTerry(ctx, s, sprites, ground) {
  const cx = TERRY_X + TERRY_W / 2
  const feet = ground - s.y // where the character's feet are right now

  let box = SPRITE_BOX.run
  let img = sprites.run
  let rot = 0
  let sx = 1
  let sy = 1
  let slide = 0

  if (!s.grounded) {
    img = sprites.jump
    box = SPRITE_BOX.jump
    const rise = Math.max(-1, Math.min(1, s.vy / JUMP_V)) // +1 up, -1 down
    rot = -0.3 * rise
    sy = 1 + 0.14 * rise
    sx = 1 - 0.11 * rise
    slide = rise * 3
  } else if (s.landT < LAND_T) {
    const k = Math.sin((s.landT / LAND_T) * Math.PI) // 0 → 1 → 0
    sy = 1 - 0.09 * k
    sx = 1 + 0.07 * k
  }

  ctx.save()
  ctx.translate(cx + slide, feet)
  ctx.rotate(rot)
  ctx.scale(sx, sy)

  if (sprites.ready && img?.naturalWidth) {
    // 그려진 부분의 높이가 TERRY_H 가 되도록 이미지를 키운 뒤, 그 밑변을
    // 발 높이에, 좌우 중심을 cx 에 맞춘다. 여백만큼 뜨거나 치우치지 않는다.
    const dh = TERRY_H / (1 - box.top - box.bottom)
    const dw = dh * (img.naturalWidth / img.naturalHeight)
    const midX = box.left + (1 - box.left - box.right) / 2
    ctx.drawImage(img, -midX * dw, -(1 - box.bottom) * dh, dw, dh)
  } else {
    ctx.fillStyle = "#d8c18a"
    ctx.fillRect(-TERRY_W / 2, -TERRY_H, TERRY_W, TERRY_H)
  }
  ctx.restore()
}

/** Keys pressed inside a field or on another control belong to that control. */
function isInteractiveTarget(t) {
  if (!t || !t.tagName) return false
  const tag = t.tagName
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    tag === "BUTTON" ||
    tag === "A" ||
    t.isContentEditable === true
  )
}

/**
 * 최고 기록은 **이 기기의 브라우저에만** 남는다(localStorage). 서버로 보내지
 * 않으므로 다른 사람 것과 섞이지 않고, 방문자 기록을 우리가 들고 있지도 않다.
 *
 * localStorage 는 던질 수 있다 — 사파리 비공개 모드, 사이트 데이터 차단 등.
 * 그때도 게임은 그대로 돌아가야 하므로 실패를 삼키되, **성공 여부는 돌려준다.**
 * 화면에 "이 기기에 저장됩니다"라고 적어 두고 실제로는 안 되고 있으면 거짓말이
 * 되기 때문이다.
 */
const BEST_KEY = "terryRunBest"

function readBest() {
  try {
    const n = Number(localStorage.getItem(BEST_KEY) || 0)
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0
  } catch {
    return 0
  }
}

function writeBest(value) {
  try {
    localStorage.setItem(BEST_KEY, String(value))
    return true
  } catch {
    return false
  }
}

/** 저장소를 쓸 수 있는 브라우저인지 미리 한 번 본다(안내 문구를 고르기 위해). */
function storageWorks() {
  try {
    localStorage.setItem("__t", "1")
    localStorage.removeItem("__t")
    return true
  } catch {
    return false
  }
}

export default function TerryRun() {
  const wrapRef = useRef(null)
  const canvasRef = useRef(null)
  const stateRef = useRef(null)
  const [status, setStatus] = useState("ready") // ready | running | over
  const [score, setScore] = useState(0)
  const [best, setBest] = useState(readBest)
  /** 방금 끝난 판이 기록을 갈아치웠는가. 게임을 다시 시작하면 내린다. */
  const [isRecord, setIsRecord] = useState(false)
  const [canSave] = useState(storageWorks)
  // 루프 안에서 지금 최고 기록을 읽어야 하는데, 상태를 그대로 쓰면 예전 값이
  // 잡힌다(클로저). 참조로 따로 들고 다닌다.
  const bestRef = useRef(best)
  useEffect(() => {
    bestRef.current = best
  }, [best])
  // 게임이 화면에 보일 때만 키보드를 받는다. 안 그러면 페이지 어디서든
  // 스페이스가 스크롤 대신 보이지 않는 게임을 시작시킨다.
  const inViewRef = useRef(false)

  const sprites = useRef({ jump: null, run: null, ready: false })
  const reduceMotion = useRef(false)

  useEffect(() => {
    let left = 2
    const done = () => {
      left -= 1
      if (left === 0) sprites.current.ready = true
    }
    const jump = new Image()
    const run = new Image()
    jump.onload = done
    run.onload = done
    jump.onerror = done
    run.onerror = done
    run.src = "/char/terry-run.png"
    jump.src = "/char/terry-jump.png"
    sprites.current.jump = jump
    sprites.current.run = run
  }, [])

  // prefers-reduced-motion: the ground speckle is skipped
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)")
    if (!mq) return undefined
    const sync = () => {
      reduceMotion.current = mq.matches
    }
    sync()
    mq.addEventListener?.("change", sync)
    return () => mq.removeEventListener?.("change", sync)
  }, [])

  // 세계의 폭은 화면과 무관하게 언제나 W 다(그리기는 폭에 맞춘다).
  const viewWRef = useRef(W)

  const reset = useCallback(() => {
    stateRef.current = {
      y: 0, // height above ground
      vy: 0,
      grounded: true,
      landT: LAND_T, // time since the last landing; starts "long ago"
      speed: START_SPEED,
      obstacles: [makeObstacle(viewWRef.current + 63, START_SPEED)],
      dust: [],
      distance: 0,
      t: 0,
    }
    setScore(0)
    setIsRecord(false)
  }, [])

  const jump = useCallback(() => {
    if (status === "ready" || status === "over") {
      reset()
      setStatus("running")
      return
    }
    const s = stateRef.current
    if (s?.grounded) {
      s.vy = JUMP_V
      s.grounded = false
    }
  }, [status, reset])

  // show the character on the start screen too, not just once play begins
  useEffect(() => {
    if (!stateRef.current) reset()
  }, [reset])

  // input: keyboard for desktop, pointer for touch
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return undefined
    const io = new IntersectionObserver(([entry]) => {
      inViewRef.current = entry.isIntersecting
    }, {
      // 화면에 닿기 조금 전에 켜 둔다. 스크롤해 내려왔을 때 첫 프레임이
      // 비어 있으면 그것대로 눈에 띈다.
      rootMargin: "200px 0px"
    })
    io.observe(el)
    return () => io.disconnect()
  }, [])

  useEffect(() => {
    const onKey = (e) => {
      if (e.code !== "Space" && e.code !== "ArrowUp" && e.code !== "Enter") return
      if (!inViewRef.current) return // 게임이 안 보이면 페이지 스크롤에 양보한다
      if (isInteractiveTarget(e.target)) return
      e.preventDefault() // space must not scroll the page
      jump()
    }
    const el = wrapRef.current
    const onPointer = (e) => {
      if (e.button !== 0) return
      // 오버레이 버튼은 자기 onClick으로 시작한다. 여기서도 받으면
      // pointerdown으로 시작하고 click으로 한 번 더 점프한다.
      if (e.target.closest?.(".game__btn")) return
      e.preventDefault()
      jump()
    }
    window.addEventListener("keydown", onKey)
    el?.addEventListener("pointerdown", onPointer)
    return () => {
      window.removeEventListener("keydown", onKey)
      el?.removeEventListener("pointerdown", onPointer)
    }
  }, [jump])

  // fit the canvas to its box at device resolution
  useEffect(() => {
    const canvas = canvasRef.current
    const fit = () => {
      const rect = canvas.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      canvas.width = Math.round(rect.width * dpr)
      canvas.height = Math.round(rect.height * dpr)
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext("2d")
    let raf = 0
    let last = performance.now()
    let alive = true

    const loop = (now) => {
      if (!alive) return

      /**
       * 화면 밖이면 아무것도 하지 않는다.
       *
       * 예전에는 페이지가 열려 있는 내내 이 루프가 60fps 로 돌았다 — 사용자가
       * 맨 위 히어로를 보고 있는 동안에도 캔버스를 계속 다시 그렸다는 뜻이다.
       * 휴대폰에서는 그대로 발열과 끊김이 된다. 시간(last)만 따라 옮겨 두면
       * 다시 보일 때 dt 가 튀지 않는다.
       */
      if (!inViewRef.current) {
        last = now
        raf = requestAnimationFrame(loop)
        return
      }

      const dt = Math.min((now - last) / 1000, 0.05)
      last = now

      const rect = canvas.getBoundingClientRect()
      /**
       * 화면이 달라도 세계는 하나다.
       *
       * 예전에는 높이에 맞춰 그린 뒤 보이는 폭에 비례해 속도와 간격만 늘렸다(sc).
       * 그러면 캐릭터와 장애물 크기는 그대로인데 속도만 반으로 줄어서, 모바일에서는
       * 같은 점프로 넘을 수 있는 장애물의 폭이 PC 의 두 배가 됐다 — 같은 게임이
       * 아니었다. 이제 **폭에 맞춰** 그린다. W 단위 세계가 어느 화면에서나
       * 통째로 보이고, 중력·점프·속도·간격·크기가 전부 같은 단위에 놓인다.
       */
      const k = rect.width / W // design units -> css px, fitted by width
      const viewW = W // 세계의 폭은 언제나 W 단위다
      // 세로는 상자가 정한다. 지면선을 아래에서 재므로 남는 위쪽이 그대로 하늘이 된다 —
      // 프레임을 세로로 길게 줘도 물리는 그대로다.
      const viewH = rect.height / Math.max(k, 0.0001)
      const ground = viewH - GROUND_BAND
      const dpr = canvas.width / Math.max(rect.width, 1)
      viewWRef.current = viewW

      ctx.setTransform(dpr * k, 0, 0, dpr * k, 0, 0)
      ctx.clearRect(0, 0, viewW, viewH)

      const s = stateRef.current
      const running = status === "running" && s

      if (running) {
        s.t += dt
        s.speed = Math.min(MAX_SPEED, START_SPEED + s.t * 11.6)
        s.distance += s.speed * dt

        s.vy -= GRAVITY * dt
        s.y += s.vy * dt
        if (s.y <= 0) {
          s.y = 0
          s.vy = 0
          if (!s.grounded) {
            s.grounded = true
            s.landT = 0
            spawnDust(s, ground)
          }
        }

        for (const o of s.obstacles) o.x -= s.speed * dt
        s.obstacles = s.obstacles.filter((o) => o.x + o.w > -11)

        const lastO = s.obstacles[s.obstacles.length - 1]
        const gap = 137 + Math.random() * 116 * (1 - s.speed / MAX_SPEED) + 63
        if (!lastO || lastO.x < viewW - gap) s.obstacles.push(makeObstacle(viewW + 21, s.speed))

        // collision — a forgiving box around Terry, against each drawn part
        const tx = TERRY_X + HIT_INSET
        const ty = ground - TERRY_H - s.y + 10
        const tw = HIT_W
        const th = TERRY_H - 14
        let hit = false
        for (const o of s.obstacles) {
          for (const p of o.parts) {
            const ox = o.x + p.x
            const oy = ground - p.y - p.h
            if (tx < ox + p.w && tx + tw > ox && ty < oy + p.h && ty + th > oy) {
              hit = true
              break
            }
          }
          if (hit) break
        }
        if (hit) {
          const m = Math.floor(s.distance / 6.3)
          setStatus("over")
          setIsRecord(m > bestRef.current && m > 0)
          setBest((b) => {
            const next = Math.max(b, m)
            if (next !== b) writeBest(next)
            return next
          })
        }
        setScore(Math.floor(s.distance / 6.3))
      }

      if (s) {
        if (s.grounded) s.landT += dt
        // dust keeps settling in every state so a puff never freezes mid-air
        if (s.dust.length) stepDust(s, dt, running ? s.speed : 0)
      }

      // ---- draw ----
      if (s && !reduceMotion.current) {
        drawDots(ctx, DOTS_FAR, s.distance * 0.45, viewW, 0.06, ground)
        drawDots(ctx, DOTS_NEAR, s.distance, viewW, 0.1, ground)
      }

      ctx.strokeStyle = "#c9c1b6"
      ctx.lineWidth = 1
      ctx.beginPath()
      ctx.moveTo(0, ground + 1)
      ctx.lineTo(viewW, ground + 1)
      ctx.stroke()

      if (s) {
        for (const o of s.obstacles) drawObstacle(ctx, o, ground)
        drawTerry(ctx, s, sprites.current, ground)
        if (s.dust.length) drawDust(ctx, s)
      }

      raf = requestAnimationFrame(loop)
    }

    raf = requestAnimationFrame(loop)
    return () => {
      alive = false
      cancelAnimationFrame(raf)
    }
  }, [status])

  return (
    <section className="game" id="game">
      <div className="wrap">
        <h2 className="game__title">테리와 함께 달리기</h2>

        <div className="game__frame" ref={wrapRef}>
          <canvas ref={canvasRef} className="game__canvas" aria-label="테리 달리기 게임" />

          {/* 달리는 동안에는 지금 거리만. 최고 기록은 아래 칸이 맡는다. */}
          <div className="game__hud">
            <span>{String(score).padStart(5, "0")}</span>
          </div>

          {status !== "running" ? (
            <div className="game__overlay">
              <p>
                {status === "over" ? `${score}m` : "테리와 달려보세요"}
                {status === "over" && isRecord ? <em className="game__new">신기록</em> : null}
              </p>
              <button className="game__btn" type="button" onClick={jump}>
                {status === "over" ? "다시 하기" : "시작하기"}
              </button>
              <span className="game__hint">스페이스바 · 화면 탭</span>
            </div>
          ) : null}
        </div>

        {/* 기록 칸. 프레임 안 HUD 는 달리는 중에만 보이고 글씨도 작아서,
            최고 기록은 프레임 밖에 자기 자리를 갖는다. */}
        <div className="record">
          <div className="record__cell">
            <span className="record__label">이번 기록</span>
            <strong className="record__value">
              {score}
              <em>m</em>
            </strong>
          </div>
          <div className={`record__cell record__cell--best ${isRecord ? "is-new" : ""}`}>
            <span className="record__label">최고 기록{isRecord ? " · 방금 경신" : ""}</span>
            <strong className="record__value">
              {best}
              <em>m</em>
            </strong>
          </div>
        </div>
        <p className="record__note">
          {canSave
            ? "최고 기록은 이 기기에만 저장됩니다. 다시 와도 남아 있어요."
            : "이 브라우저에서는 기록이 저장되지 않습니다(비공개 모드 등). 이번 판에서만 보입니다."}
        </p>
      </div>
    </section>
  )
}
