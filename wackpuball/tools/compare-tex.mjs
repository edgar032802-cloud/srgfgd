/** 압축 전후 베이스컬러의 평균 색을 재서 색이 변했는지 본다. */
import { NodeIO } from "@gltf-transform/core"
import { ALL_EXTENSIONS } from "@gltf-transform/extensions"
import draco3d from "draco3dgltf"
import { execFileSync } from "node:child_process"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  "draco3d.decoder": await draco3d.createDecoderModule(),
  "draco3d.encoder": await draco3d.createEncoderModule(),
})

const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cmp-"))
const grab = async (file, tag) => {
  const doc = await io.read(file)
  const out = []
  for (const [i, t] of doc.getRoot().listTextures().entries()) {
    const isNormal = doc.getRoot().listMaterials().some((m) => m.getNormalTexture() === t)
    if (isNormal) continue
    const p = path.join(dir, `${tag}_${i}.bin`)
    await fs.writeFile(p, Buffer.from(t.getImage()))
    out.push({ p, name: t.getName() || "tex" + i })
  }
  return out
}

const pairs = []
for (const [name, orig] of [["terry.glb", "orig-terry"], ["aqu.glb", "orig-aqu"]]) {
  const a = await grab("C:/Users/USER/AppData/Local/Temp/claude/C--Users-USER-Desktop----/0a95dee7-ed4d-431d-9180-a874d1c58802/scratchpad/" + name, orig)
  const b = await grab("C:/Users/USER/Desktop/클로드/public/models/" + name, "new-" + name)
  pairs.push({ name, a, b })
}
await fs.writeFile(path.join(dir, "pairs.json"), JSON.stringify(pairs))
console.log(execFileSync(process.execPath, [path.resolve("tools/avgcolor.mjs"), path.join(dir, "pairs.json")], { encoding: "utf8" }))
await fs.rm(dir, { recursive: true, force: true })
