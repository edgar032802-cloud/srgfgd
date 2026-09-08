/**
 * Wackpuball asset pipeline.
 *
 * The uploaded characters are Tripo photogrammetry scans: one mesh, ~1.9M
 * triangles, no skin/bones/morph targets. Draco alone only shrinks the
 * download -- the GPU still pays for every triangle, and decoding a million
 * verts stalls a phone for seconds. So we decimate to two LODs, shrink the
 * textures, and Draco the result. Appearance is preserved: same UVs, same
 * material graph, same texture content at a sane resolution.
 *
 * Texture work is done with sharp directly rather than gltf-transform's
 * textureCompress(), whose colourspace call libvips rejects on this machine.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, KHRDracoMeshCompression } from '@gltf-transform/extensions';
import { weld, simplify, dedup, prune } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import draco3d from 'draco3dgltf';
import os from 'node:os';
import { execFileSync } from 'node:child_process';

const SRC_DIR = 'C:/Users/USER/Documents/카카오톡 받은 파일';
const OUT_DIR = path.resolve('public/models');

/** The two uploaded characters. `id` is the runtime key. */
const CHARACTERS = [
  { id: 'terry', src: '테리 3.glb', label: '테리' },
  { id: 'aqu', src: '아큐 1.glb', label: '아큐' },
];

/** hi = desktop, lo = mobile. Triangle budgets chosen for 60fps with a
 *  vertex-shader deformation pass plus a shard mesh of the same density. */
const LODS = [
  { suffix: 'hi', tris: 90_000, color: 1024, normal: 1024 },
  { suffix: 'lo', tris: 32_000, color: 512, normal: 512 },
];

const mb = (n) => (n / 1048576).toFixed(2) + ' MB';

async function main() {
  await MeshoptSimplifier.ready;
  await fs.mkdir(OUT_DIR, { recursive: true });

  const io = new NodeIO()
    .registerExtensions(ALL_EXTENSIONS)
    .registerDependencies({
      'draco3d.decoder': await draco3d.createDecoderModule(),
      'draco3d.encoder': await draco3d.createEncoderModule(),
    });

  const manifest = [];

  for (const char of CHARACTERS) {
    const srcPath = path.join(SRC_DIR, char.src);
    const srcStat = await fs.stat(srcPath);
    console.log(`\n=== ${char.id} (${char.src}, ${mb(srcStat.size)}) ===`);

    const entry = { id: char.id, label: char.label, source: char.src, lods: {} };

    for (const lod of LODS) {
      // Re-read per LOD: simplify is destructive and each LOD should come from
      // the full-resolution source, not from the previous LOD.
      const doc = await io.read(srcPath);
      const before = countTris(doc);
      const ratio = Math.min(1, lod.tris / before);

      await doc.transform(
        dedup(),
        weld(),
        simplify({ simplifier: MeshoptSimplifier, ratio, error: 0.008, lockBorder: false }),
        prune({ keepAttributes: false }),
      );

      await shrinkTextures(doc, lod);

      doc.createExtension(KHRDracoMeshCompression)
        .setRequired(true)
        .setEncoderOptions({
          method: KHRDracoMeshCompression.EncoderMethod.EDGEBREAKER,
          quantizationBits: { POSITION: 14, NORMAL: 10, TEX_COORD: 12 },
        });

      const after = countTris(doc);
      const outName = `${char.id}-${lod.suffix}.glb`;
      const bytes = await io.writeBinary(doc);
      await fs.writeFile(path.join(OUT_DIR, outName), bytes);

      entry.lods[lod.suffix] = {
        file: `models/${outName}`,
        triangles: after,
        bytes: bytes.byteLength,
      };
      entry.bounds = meshBounds(doc);

      console.log(
        `  ${lod.suffix}: ${before.toLocaleString()} -> ${after.toLocaleString()} tris | ${mb(bytes.byteLength)}`,
      );
    }
    manifest.push(entry);
  }

  await fs.writeFile(
    path.join(OUT_DIR, 'manifest.json'),
    JSON.stringify({ generated: 'tools/build-assets.mjs', characters: manifest }, null, 2),
  );
  console.log('\nwrote public/models/manifest.json');
}

/**
 * Resize every texture and re-encode to WebP.
 *
 * The actual encoding happens in tools/texworker.mjs, a separate process:
 * draco3d/meshoptimizer WASM init in *this* process breaks libvips'
 * colourspace handling, so sharp cannot run here at all.
 *
 * Normal maps get a higher quality floor -- banding in a normal map reads as
 * visible faceting under the studio key light.
 */
async function shrinkTextures(doc, lod) {
  const textures = doc.getRoot().listTextures().filter((t) => t.getImage());
  if (!textures.length) return;

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'wpb-tex-'));
  const jobs = [];

  textures.forEach((tex, i) => {
    const isNormal = doc.getRoot().listMaterials().some((m) => m.getNormalTexture() === tex);
    jobs.push({
      in: path.join(dir, `t${i}.bin`),
      out: path.join(dir, `t${i}.webp`),
      size: isNormal ? lod.normal : lod.color,
      quality: isNormal ? 95 : 86,
      _isNormal: isNormal,
      _name: tex.getName() || `texture${i}`,
    });
  });

  await Promise.all(jobs.map((j, i) => fs.writeFile(j.in, Buffer.from(textures[i].getImage()))));
  const jobFile = path.join(dir, 'jobs.json');
  await fs.writeFile(jobFile, JSON.stringify(jobs));

  execFileSync(process.execPath, [path.resolve('tools/texworker.mjs'), jobFile], {
    stdio: ['ignore', 'pipe', 'inherit'],
  });

  for (const [i, tex] of textures.entries()) {
    const encoded = await fs.readFile(jobs[i].out);
    console.log(
      `    tex ${jobs[i]._isNormal ? 'normal' : 'color '} ${String(jobs[i]._name).slice(0, 22).padEnd(22)} ` +
      `${mb(tex.getImage().byteLength)} -> ${mb(encoded.byteLength)}`,
    );
    tex.setImage(new Uint8Array(encoded)).setMimeType('image/webp');
    const uri = tex.getURI();
    if (uri) tex.setURI(uri.replace(/.w+$/, '.webp'));
  }

  await fs.rm(dir, { recursive: true, force: true });
}

function countTris(doc) {
  let n = 0;
  for (const mesh of doc.getRoot().listMeshes())
    for (const prim of mesh.listPrimitives()) {
      const idx = prim.getIndices();
      n += idx ? idx.getCount() / 3 : (prim.getAttribute('POSITION')?.getCount() ?? 0) / 3;
    }
  return Math.round(n);
}

function meshBounds(doc) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const mesh of doc.getRoot().listMeshes())
    for (const prim of mesh.listPrimitives()) {
      const pos = prim.getAttribute('POSITION');
      if (!pos) continue;
      const mn = pos.getMin([0, 0, 0]);
      const mx = pos.getMax([0, 0, 0]);
      for (let i = 0; i < 3; i++) { min[i] = Math.min(min[i], mn[i]); max[i] = Math.max(max[i], mx[i]); }
    }
  return { min, max };
}

main().catch((err) => { console.error(err); process.exit(1); });
