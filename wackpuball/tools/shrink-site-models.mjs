/**
 * 사이트가 쓰는 terry.glb · aqu.glb 를 휴대폰이 감당할 크기로 줄인다.
 *
 * 원본은 Tripo 스캔에 Draco 만 걸린 것이라, 지오메트리 190만 삼각형에 텍스처가
 * 4096×4096 이다. **텍스처가 진짜 문제다** — GPU 에 올라가면 압축이 풀려
 * 4096×4096×4B = 장당 67MB 를 먹는다. 두 모델 여섯 장이면 400MB 다.
 * 아이폰 사파리는 그 훨씬 아래에서 탭을 버리고 새로 고친다.
 *
 * 무대에서 캐릭터가 그려지는 크기는 350px 안팎이다. 1024 면 넉넉하고,
 * 메모리는 16 분의 1 이 된다.
 *
 * COLOR_0 은 버린다. 특수 색깔(부위별 틴트)이 2026-09-09 에 삭제되면서
 * 쓰는 곳이 사라졌다.
 *
 * 텍스처 인코딩은 반드시 자식 프로세스에서 한다 — 이 프로세스에서
 * draco3d/meshoptimizer WASM 을 올리면 libvips 가 깨져 sharp 가 전부 실패한다.
 *
 * 실행: wackpuball 폴더에서 `node tools/shrink-site-models.mjs`
 */
import { execFileSync } from "node:child_process"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { NodeIO } from "@gltf-transform/core"
import { ALL_EXTENSIONS, KHRDracoMeshCompression } from "@gltf-transform/extensions"
import { dedup, prune, simplify, weld } from "@gltf-transform/functions"
import { MeshoptSimplifier } from "meshoptimizer"
import draco3d from "draco3dgltf"

const SITE = "C:/Users/USER/Desktop/클로드/public/models/"
const OUT = "C:/Users/USER/Desktop/클로드/public/models/"

/** 무대에서 350px 로 그려지는 모델이다. 이 정도면 실루엣이 상하지 않는다. */
const TARGET_TRIS = 300_000
const TEX_COLOR = 1024
const TEX_NORMAL = 1024

const mb = (n) => (n / 1048576).toFixed(2) + "MB"

await MeshoptSimplifier.ready

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    "draco3d.decoder": await draco3d.createDecoderModule(),
    "draco3d.encoder": await draco3d.createEncoderModule(),
  })

const countTris = (doc) => {
  let n = 0
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices()
      n += (idx ? idx.getCount() : prim.getAttribute("POSITION").getCount()) / 3
    }
  }
  return Math.round(n)
}

async function shrinkTextures(doc) {
  const textures = doc.getRoot().listTextures().filter((t) => t.getImage())
  if (!textures.length) return

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "site-tex-"))
  const jobs = textures.map((tex, i) => {
    const isNormal = doc.getRoot().listMaterials().some((m) => m.getNormalTexture() === tex)
    return {
      in: path.join(dir, `t${i}.bin`),
      out: path.join(dir, `t${i}.webp`),
      size: isNormal ? TEX_NORMAL : TEX_COLOR,
      // 노멀맵은 밴딩이 스튜디오 조명 아래에서 각진 면으로 보인다. 품질을 높게.
      quality: isNormal ? 95 : 88,
      _isNormal: isNormal,
      _name: tex.getName() || `tex${i}`,
    }
  })

  await Promise.all(jobs.map((j, i) => fs.writeFile(j.in, Buffer.from(textures[i].getImage()))))
  const jobFile = path.join(dir, "jobs.json")
  await fs.writeFile(jobFile, JSON.stringify(jobs))

  execFileSync(process.execPath, [path.resolve("tools/texworker.mjs"), jobFile], {
    stdio: ["ignore", "pipe", "inherit"],
  })

  for (const [i, tex] of textures.entries()) {
    const encoded = await fs.readFile(jobs[i].out)
    console.log(
      `    ${jobs[i]._isNormal ? "normal" : "color "} ${String(jobs[i]._name).slice(0, 24).padEnd(24)} ` +
        `4096² ${mb(tex.getImage().byteLength)} → ${jobs[i].size}² ${mb(encoded.byteLength)}`
    )
    tex.setImage(new Uint8Array(encoded)).setMimeType("image/webp")
    const uri = tex.getURI()
    if (uri) tex.setURI(uri.replace(/\.\w+$/, ".webp"))
  }

  await fs.rm(dir, { recursive: true, force: true })
}

for (const name of ["terry.glb", "aqu.glb"]) {
  const src = SITE + name
  const beforeBytes = (await fs.stat(src)).size
  const doc = await io.read(src)
  const beforeTris = countTris(doc)

  console.log(`\n── ${name}  ${beforeTris.toLocaleString()} tris · ${mb(beforeBytes)}`)

  // 특수 색깔이 사라져 쓰는 곳이 없다. 정점마다 3 개 값을 들고 다닐 이유가 없다.
  let dropped = 0
  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      if (prim.getAttribute("COLOR_0")) {
        prim.setAttribute("COLOR_0", null)
        dropped++
      }
    }
  }
  if (dropped) console.log(`    COLOR_0 제거 (${dropped} 프리미티브) — 특수 색깔 삭제로 미사용`)

  const ratio = Math.min(1, TARGET_TRIS / beforeTris)
  await doc.transform(
    dedup(),
    weld(),
    simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.008, lockBorder: false }),
    prune()
  )

  await shrinkTextures(doc)

  doc
    .createExtension(KHRDracoMeshCompression)
    .setRequired(true)
    .setEncoderOptions({
      method: KHRDracoMeshCompression.EncoderMethod.EDGEBREAKER,
      quantizationBits: { POSITION: 14, NORMAL: 10, TEX_COORD: 12 },
    })

  const bytes = await io.writeBinary(doc)
  await fs.writeFile(OUT + name, bytes)

  const afterTris = countTris(doc)
  console.log(
    `   → ${afterTris.toLocaleString()} tris · ${mb(bytes.byteLength)} ` +
      `(${Math.round((1 - bytes.byteLength / beforeBytes) * 100)}% 감소)`
  )
}
