#!/usr/bin/env node
// Programmatic visual analysis: palette/material statistics for screenshots vs the reference image.
import { readFile, writeFile } from 'node:fs/promises';
import { readdir } from 'node:fs/promises';
import { join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const OUT_DIR = join(ROOT, '.mw-local', 'acceptance');
const REFERENCE = process.argv[2] ?? join(ROOT, '工作台视觉参考图.png');

function analyze(png) {
  const { width, height, data } = png;
  let dark = 0;
  let green = 0;
  let warmWhite = 0;
  let total = 0;
  const buckets = new Map();
  const stepX = Math.max(1, Math.floor(width / 240));
  const stepY = Math.max(1, Math.floor(height / 240));
  for (let y = 0; y < height; y += stepY) {
    for (let x = 0; x < width; x += stepX) {
      const i = (y * width + x) * 4;
      const r = data[i], g = data[i + 1], b = data[i + 2];
      total++;
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      if (max < 34) dark++;
      else if (g > r * 1.18 && g > b * 1.15 && g > 60 && g < 235) green++;
      else if (min > 170 && max > 205) warmWhite++;
      const key = `${r >> 5}-${g >> 5}-${b >> 5}`;
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
  }
  const top = [...buckets.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6)
    .map(([key, count]) => ({ bucket: key, share: Number((count / total).toFixed(3)) }));
  return {
    sampled: total,
    darkShare: Number((dark / total).toFixed(3)),
    greenAccentShare: Number((green / total).toFixed(4)),
    brightNeutralShare: Number((warmWhite / total).toFixed(4)),
    topBuckets: top,
  };
}

const files = process.argv.slice(3);
const list = files.length ? files : (await readdir(OUT_DIR)).filter((f) => f.endsWith('.png')).map((f) => join(OUT_DIR, f));
const report = {};
for (const file of [REFERENCE, ...list]) {
  try {
    const buffer = await readFile(file);
    const png = PNG.sync.read(buffer);
    report[basename(file)] = analyze(png);
    console.log(`analyzed ${basename(file)} (${png.width}x${png.height})`);
  } catch (error) {
    console.error(`skip ${basename(file)}: ${error.message}`);
  }
}
await writeFile(join(OUT_DIR, 'visual-stats.json'), JSON.stringify(report, null, 2));
console.log('written', join(OUT_DIR, 'visual-stats.json'));
