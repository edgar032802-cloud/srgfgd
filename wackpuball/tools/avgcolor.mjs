/** sharp 는 WASM 이 없는 깨끗한 프로세스에서만 돈다(texworker 와 같은 이유). */
import fs from "node:fs/promises"
import sharp from "sharp"

const pairs = JSON.parse(await fs.readFile(process.argv[2], "utf8"))
const avg = async (p) => {
  const { channels } = await sharp(await fs.readFile(p)).stats()
  return channels.slice(0, 3).map((c) => Math.round(c.mean))
}
for (const { name, a, b } of pairs) {
  console.log(`\n── ${name}`)
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const [x, y] = [await avg(a[i].p), await avg(b[i].p)]
    const d = Math.max(...x.map((v, k) => Math.abs(v - y[k])))
    console.log(
      `   ${a[i].name.slice(0, 22).padEnd(22)} 원본 rgb(${x.join(",")})  →  압축 rgb(${y.join(",")})   최대차 ${d}` +
        (d <= 3 ? "  ✓ 육안 구분 불가" : d <= 8 ? "  · 미세" : "  ⚠ 확인 필요")
    )
  }
}
