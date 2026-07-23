#!/usr/bin/env node

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const gameRoot = process.argv[2];

if (!gameRoot) {
  console.error('Usage: node tools/validate-state-history.mjs /path/to/victoria3/game');
  process.exit(2);
}

function filesIn(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    return entry.isDirectory() ? filesIn(path) : [path];
  });
}

function blockAt(text, start) {
  let depth = 0;
  for (let index = start; index < text.length; index += 1) {
    if (text[index] === '{') depth += 1;
    if (text[index] === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, index + 1);
    }
  }
  throw new Error(`Unclosed block at byte ${start}`);
}

function provinceIds(text) {
  return [...text.matchAll(/x[0-9A-F]{6}/gi)].map((match) => match[0].toUpperCase());
}

const regionRoot = join(gameRoot, 'map_data', 'state_regions');
const provinceRegions = new Map();
const knownRegions = new Set();

for (const file of filesIn(regionRoot).filter((path) => path.endsWith('.txt'))) {
  const text = readFileSync(file, 'utf8');
  for (const match of text.matchAll(/^\uFEFF?STATE_([A-Z0-9_]+)\s*=\s*\{/gm)) {
    const region = `STATE_${match[1]}`;
    const block = blockAt(text, match.index);
    const provinces = block.match(/\bprovinces\s*=\s*\{([\s\S]*?)\}/)?.[1] ?? '';
    knownRegions.add(region);
    for (const province of provinceIds(provinces)) provinceRegions.set(province, region);
  }
}

const historyRoot = join(process.cwd(), 'common', 'history', 'states');
const failures = [];

for (const file of filesIn(historyRoot).filter((path) => path.endsWith('.txt'))) {
  const text = readFileSync(file, 'utf8');
  for (const match of text.matchAll(/^\s*s:(STATE_[A-Z0-9_]+)\s*=\s*\{/gm)) {
    const state = match[1];
    const block = blockAt(text, match.index);
    if (!knownRegions.has(state)) {
      failures.push(`${file}: ${state} is not defined by the target game map`);
      continue;
    }
    for (const provinces of block.matchAll(/\bowned_provinces\s*=\s*\{([\s\S]*?)\}/g)) {
      for (const province of provinceIds(provinces[1])) {
        const actualRegion = provinceRegions.get(province);
        if (!actualRegion) failures.push(`${file}: ${state} references unknown province ${province}`);
        else if (actualRegion !== state) failures.push(`${file}: ${province} belongs to ${actualRegion}, not ${state}`);
      }
    }
  }
}

if (failures.length) {
  console.error(failures.join('\n'));
  console.error(`\n${failures.length} state-history incompatibilities found.`);
  process.exit(1);
}

console.log('State history matches target map definitions.');
