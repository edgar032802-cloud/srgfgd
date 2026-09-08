import { Suspense, useEffect, useMemo, useRef, useState } from "react"
import { Canvas } from "@react-three/fiber"
import { ContactShadows, Html, OrbitControls, useGLTF, useProgress } from "@react-three/drei"
import { Box3, Color, NeutralToneMapping, SRGBColorSpace, TOUCH, Vector3 } from "three"

const MODELS = {
  terry: "/models/terry.glb",
  aqu: "/models/aqu.glb",
  /**
   * 테리의 「특수 색깔」 — 색을 셰이더로 칠하는 게 아니라 따로 만들어 준 모델을 띄운다.
   * 이건 돌 재질이라 원본 텍스처가 이미 밝다. 다른 둘과 달리 밝기 보정을 걸지 않는다.
   */
  "terry-special": "/models/terry-special.glb",
  "aqu-special": "/models/aqu-special.glb",
}

/**
 * Both .glb files arrive as a single mesh with one baked texture, so there are
 * no named parts to select. Ear and tail are instead segmented offline by
 * walking the triangle connectivity (scripts write COLOR_0.r as a zone id);
 * petals, which have no separable geometry, are matched by texture colour.
 *
 * Approximating the parts with ellipsoids in the shader was tried first and
 * could not follow the anatomy — a long ear spans the same heights as the head,
 * and a tail sits at the same height as the rump.
 */
export const ZONES = [
  { key: "petal", label: "꽃잎" },
  { key: "ear", label: "귀" },
  { key: "tail", label: "꼬리" },
]

const ZONE_PARAM = typeof window !== "undefined" ? new URLSearchParams(location.search).get("zones") : null
const ZONE_DEBUG = ZONE_PARAM !== null ? (ZONE_PARAM === "ruler" ? 2 : 1) : 0

/**
 * 캐릭터별 albedo 배수.
 *
 * 두 GLB 는 Tripo 스캔이라 구운 basecolor 가 원화보다 어둡다 — 테리는 원화 몸통이
 * #d8b878 인데 화면에서는 갈색으로 나왔다(픽셀로 재서 확인). three.js 는 material.color
 * 에 1을 넘는 값을 허용하고 그 값이 맵에 곱해지므로, 조명이나 노출을 올려 그림자까지
 * 들뜨게 하는 대신 이 모델의 albedo 만 들어 올린다. 값은 화면을 찍어 원화와 비교해 정했다.
 */
const ALBEDO_LIFT = { terry: 2.6, aqu: 1.7, "terry-special": 1, "aqu-special": 2.6 }

export const DEFAULT_TINTS = Object.fromEntries(ZONES.map((z) => [z.key, "#ffffff"]))

function Model({ id, tints }) {
  const { scene } = useGLTF(MODELS[id], "/draco/")
  const shaderRef = useRef(null)

  const { scale, offset, bounds } = useMemo(() => {
    const box = new Box3()
    let found = false
    scene.updateWorldMatrix(true, true)
    scene.traverse((o) => {
      if (!o.isMesh || !o.geometry) return
      o.geometry.computeBoundingBox()
      box.union(o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld))
      found = true
    })
    if (!found) box.setFromObject(scene)

    const size = box.getSize(new Vector3())
    const center = box.getCenter(new Vector3())
    const s = 1 / Math.max(size.x, size.y, size.z || 1)
    return {
      scale: s,
      offset: center.clone().multiplyScalar(-s),
      bounds: { min: box.min.clone(), max: box.max.clone() },
    }
  }, [scene])

  useEffect(() => {
    scene.traverse((o) => {
      if (!o.isMesh || !o.material) return
      const mat = o.material
      // useGLTF는 씬을 캐시하므로 같은 머티리얼이 마운트마다 재사용된다. onBeforeCompile
      // 클로저가 첫 인스턴스의 ref만 쥐고 있지 않도록, 셰이더 참조 홀더를 매 마운트 다시 잇는다.
      mat.userData.holder = shaderRef
      if (mat.userData.zoneTinted) {
        shaderRef.current = mat.userData.shader ?? null
        return
      }
      mat.userData.zoneTinted = true

      // Move the baked ids off COLOR_0. Left there with vertexColors on,
      // three.js declares its own `attribute vec3 color` — clashing with ours,
      // which silently kills the shader — and multiplies the albedo by it,
      // which would black the model out. Under another name the data is ours.
      const geo = o.geometry
      if (geo.getAttribute("color") && !geo.getAttribute("zoneId")) {
        geo.setAttribute("zoneId", geo.getAttribute("color"))
        geo.deleteAttribute("color")
      }
      /**
       * Tripo 는 metallic-roughness 맵을 넣으면서 metalness 를 1.0 으로 내보낸다.
       * 금속은 확산광이 없어서 비출 환경맵이 없으면 통째로 새까맣게 렌더된다 —
       * 새로 받은 terry-special.glb 가 정확히 그 상태로 들어왔다. 이 캐릭터들은
       * 전부 유전체(클레이)이므로 0 으로 되돌린다.
       */
      mat.metalness = 0
      mat.color.setScalar(ALBEDO_LIFT[id] ?? 1)
      mat.vertexColors = false

      mat.onBeforeCompile = (shader) => {
        shader.uniforms.uPetal = { value: new Color("#ffffff") }
        shader.uniforms.uEar = { value: new Color("#ffffff") }
        shader.uniforms.uTail = { value: new Color("#ffffff") }
        shader.uniforms.uZoneDebug = { value: ZONE_DEBUG }
        shader.uniforms.uPetalOn = { value: 0 }
        shader.uniforms.uEarOn = { value: 0 }
        shader.uniforms.uTailOn = { value: 0 }

        shader.vertexShader = shader.vertexShader
          .replace(
            "#include <common>",
            "#include <common>\nvarying float vZoneId;\nattribute vec3 zoneId;"
          )
          .replace("#include <begin_vertex>", "#include <begin_vertex>\nvZoneId = zoneId.r;")

        shader.fragmentShader = shader.fragmentShader
          .replace(
            "#include <common>",
            `#include <common>
varying float vZoneId;
uniform vec3 uPetal;
uniform vec3 uEar;
uniform vec3 uTail;
uniform float uZoneDebug;
uniform float uPetalOn;
uniform float uEarOn;
uniform float uTailOn;`
          )
          .replace(
            "#include <map_fragment>",
            `#include <map_fragment>
{
  // Ear and tail come from a zone id baked into the mesh offline by walking the
  // triangle connectivity — no analytic shapes, so the boundaries follow the
  // geometry exactly. 0 = untouched, 0.5 = ear, 1.0 = tail.
  float isEar  = step(0.25, vZoneId) * step(vZoneId, 0.75);
  float isTail = step(0.75, vZoneId);

  // Petals have no geometry of their own, so they are picked out by colour:
  // the blossoms are the only yellow on either character (measured on the baked
  // textures in linear space — fur g/r 0.27-0.61, petals 0.73-0.75; the blue
  // test rejects bright near-white highlights, which also have a high g/r).
  vec3 lin = max(diffuseColor.rgb, vec3(0.0));
  float isPetal = step(lin.r * 0.75, lin.g)
                * step(lin.b, lin.r * 0.35)
                * step(0.10, max(max(lin.r, lin.g), lin.b));

  // Replace, don't tint. Multiplying a colour over tan fur muddies it; instead
  // the picked colour becomes the albedo, carrying the original's light and
  // shade across so the form still reads.
  float lum = dot(lin, vec3(0.2126, 0.7152, 0.0722));
  float shade = clamp(lum / 0.28, 0.45, 1.7);

  vec3 chosen = diffuseColor.rgb;
  float on = 0.0;
  if (isTail > 0.5 && uTailOn > 0.5) { chosen = uTail; on = 1.0; }
  if (isEar > 0.5 && uEarOn > 0.5) { chosen = uEar; on = 1.0; }
  if (isPetal > 0.5 && uPetalOn > 0.5) { chosen = uPetal; on = 1.0; }

  if (uZoneDebug > 0.5) {
    vec3 flat3 = vec3(1.0);
    if (isTail > 0.5) flat3 = vec3(0.62, 0.55, 0.78);
    if (isEar > 0.5) flat3 = vec3(0.55, 0.62, 0.42);
    if (isPetal > 0.5) flat3 = vec3(0.35, 0.60, 0.78);
    diffuseColor.rgb = flat3;
  } else if (on > 0.5) {
    diffuseColor.rgb = chosen * shade;
  }
}`
          )

        mat.userData.shader = shader
        mat.userData.holder.current = shader
      }
      mat.needsUpdate = true
    })
  }, [scene, bounds, id])

  useEffect(() => {
    const s = shaderRef.current
    if (!s) return
    const active = (hex) => (hex && hex.toLowerCase() !== "#ffffff" ? 1 : 0)
    s.uniforms.uPetal.value.set(tints.petal)
    s.uniforms.uEar.value.set(tints.ear)
    s.uniforms.uTail.value.set(tints.tail)
    s.uniforms.uPetalOn.value = active(tints.petal)
    s.uniforms.uEarOn.value = active(tints.ear)
    s.uniforms.uTailOn.value = active(tints.tail)
  }, [tints])

  return (
    <group scale={scale} position={[offset.x, offset.y, offset.z]}>
      <primitive object={scene} />
    </group>
  )
}

function Loader() {
  const { progress } = useProgress()
  return (
    <Html center>
      <div className="c3d__bar">
        <span style={{ width: `${Math.round(progress)}%` }} />
      </div>
    </Html>
  )
}

function useOnScreen(ref, margin = "200px") {
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: margin })
    io.observe(el)
    return () => io.disconnect()
  }, [ref, margin])
  return visible
}

export default function Character3D({ id, tints = DEFAULT_TINTS, spinning = true, className = "" }) {
  const hostRef = useRef(null)
  const visible = useOnScreen(hostRef)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    if (visible) setMounted(true)
  }, [visible])

  return (
    <div className={`c3d ${className}`} ref={hostRef}>
      {mounted ? (
        <Canvas
          style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
          resize={{ debounce: 0 }}
          camera={{ position: [0, 0.02, 1.62], fov: 40 }}
          dpr={[1, 1.5]}
          frameloop={visible ? "always" : "never"}
          gl={{
            antialias: true,
            alpha: true,
            powerPreference: "high-performance",
            outputColorSpace: SRGBColorSpace,
            /**
             * ACES 는 크림색 파스텔을 탁한 황갈색으로 눌러 버린다 — 원본 아트의 몸통이
             * #d8b878 인데 화면에서는 #886848 로 나왔다(픽셀로 재서 확인). Khronos PBR
             * Neutral 은 밝은 영역만 말아 넣고 중간톤의 색과 밝기를 거의 그대로 둔다.
             */
            toneMapping: NeutralToneMapping,
            toneMappingExposure: 2.6,
          }}
        >
          {/* Neutral 톤매핑은 ACES처럼 눌러 주지 않으므로 빛의 합을 낮춘다.
              밝은 쪽 0.95 + 1.05 ≈ 2.0 이면 하이라이트만 부드럽게 말린다. */}
          <ambientLight intensity={0.95} />
          <directionalLight position={[3, 5, 3]} intensity={1.05} />
          <directionalLight position={[-4, 2, -3]} intensity={0.4} />
          <directionalLight position={[0, -3, 2]} intensity={0.22} />

          <Suspense fallback={<Loader />}>
            <Model id={id} tints={tints} />
            <ContactShadows position={[0, -0.55, 0]} opacity={0.2} scale={2} blur={2.4} far={1} frames={1} />
          </Suspense>

          <OrbitControls
            makeDefault
            target={[0, -0.06, 0]}
            autoRotate={visible && spinning}
            autoRotateSpeed={0.7}
            enablePan={false}
            /* 줌을 끄지 않으면 OrbitControls가 휠 이벤트를 삼켜서, 모델 위에
               커서를 둔 채로는 페이지가 전혀 스크롤되지 않는다. */
            enableZoom={false}
            enableDamping
            dampingFactor={0.08}
            minPolarAngle={Math.PI * 0.12}
            maxPolarAngle={Math.PI * 0.88}
            touches={{ ONE: TOUCH.ROTATE, TWO: TOUCH.ROTATE }}
          />
        </Canvas>
      ) : null}
    </div>
  )
}
