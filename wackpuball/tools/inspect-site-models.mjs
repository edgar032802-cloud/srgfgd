/**
 * 사이트가 쓰는 두 모델이 무엇으로 무거운지 본다 — 지오메트리인지 텍스처인지.
 * 어디를 줄여야 하는지 알고 손대려고 만든 스크립트다.
 *
 * wackpuball/node_modules 에만 의존성이 있으므로 반드시 이 폴더에서 돈다.
 */
import { NodeIO } from "@gltf-transform/core"
import { ALL_EXTENSIONS } from "@gltf-transform/extensions"
import draco3d from "draco3dgltf"

const SITE = "C:/Users/USER/Desktop/클로드/public/models/"

const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({
    "draco3d.decoder": await draco3d.createDecoderModule(),
    "draco3d.encoder": await draco3d.createEncoderModule(),
  })

for (const name of ["terry.glb", "aqu.glb"]) {
  const doc = await io.read(SITE + name)
  const root = doc.getRoot()

  let tris = 0
  let verts = 0
  const attrs = new Set()
  for (const mesh of root.listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices()
      const pos = prim.getAttribute("POSITION")
      tris += (idx ? idx.getCount() : pos.getCount()) / 3
      verts += pos.getCount()
      for (const s of prim.listSemantics()) attrs.add(s)
    }
  }

  const texes = root.listTextures().map((t) => {
    const img = t.getImage()
    const size = t.getSize()
    return `${t.getName() || "?"} ${size ? size.join("×") : "?"} ${Math.round((img?.byteLength ?? 0) / 1024)}KB ${t.getMimeType()}`
  })
  const texBytes = root.listTextures().reduce((a, t) => a + (t.getImage()?.byteLength ?? 0), 0)

  console.log(`\n── ${name}`)
  console.log(`   삼각형   ${Math.round(tris).toLocaleString()}   정점 ${verts.toLocaleString()}`)
  console.log(`   속성     ${[...attrs].join(", ")}`)
  console.log(`   텍스처   ${root.listTextures().length}장 · ${Math.round(texBytes / 1024)}KB`)
  for (const t of texes) console.log(`     - ${t}`)
}
