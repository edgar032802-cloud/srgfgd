/**
 * Texture resize/encode worker.
 *
 * Runs as its own process on purpose: initialising the draco3d / meshoptimizer
 * WASM modules in the same process corrupts libvips' colourspace handling on
 * this machine, and every sharp encode then fails with
 * "colourspace: parameter space not set". A clean process has no such problem.
 *
 * Usage: node tools/texworker.mjs <jobs.json>
 * Job: { in, out, size, quality, chromaSubsampling? }
 */
import fs from 'node:fs/promises';
import sharp from 'sharp';

const jobs = JSON.parse(await fs.readFile(process.argv[2], 'utf8'));
const results = [];

for (const job of jobs) {
  const src = await fs.readFile(job.in);
  const out = await sharp(src)
    .resize(job.size, job.size, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: job.quality, effort: 5 })
    .toBuffer();
  await fs.writeFile(job.out, out);
  results.push({ out: job.out, before: src.length, after: out.length });
}

process.stdout.write(JSON.stringify(results));
