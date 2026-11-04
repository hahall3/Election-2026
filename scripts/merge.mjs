// Election 2026 Initiative — shard merge.
// Combines shard-artifacts/**/races-*.json into data/races.json, carries forward
// last good races for failed workers, and APPENDS to each race's history so
// time-series visuals actually grow between runs.
import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createHash } from 'node:crypto';

const SHARD_DIR = process.env.SHARD_DIR || 'shard-artifacts';
const OUT = process.env.MERGE_OUT || 'data/races.json';
const PREVIOUS_URL = process.env.PREVIOUS_URL || '';
const MAX_HISTORY = Number(process.env.MAX_HISTORY || 300);

const walk = async (dir) => {
  const out = [];
  let items = [];
  try {
    items = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const it of items) {
    const p = join(dir, it.name);
    if (it.isDirectory()) out.push(...(await walk(p)));
    else if (/^races-\d+\.json$/.test(it.name)) out.push(p);
  }
  return out;
};

const readJson = async (p) => {
  try {
    return JSON.parse(await readFile(p, 'utf8'));
  } catch {
    return null;
  }
};

// Previous published dataset: live Pages URL first (runners are ephemeral), local file second.
const loadPrevious = async () => {
  if (PREVIOUS_URL) {
    try {
      const r = await fetch(`${PREVIOUS_URL}?t=${Date.now()}`, {
        headers: { 'Cache-Control': 'no-cache' },
        signal: AbortSignal.timeout(15000)
      });
      if (r.ok) {
        const j = await r.json();
        console.log(`Loaded previous dataset from ${PREVIOUS_URL} (${(j.races || []).length} races).`);
        return j;
      }
      console.warn(`::warning::Previous dataset fetch returned ${r.status}`);
    } catch (e) {
      console.warn(`::warning::Previous dataset fetch failed: ${e.message}`);
    }
  }
  return (await readJson(OUT)) || { races: [] };
};

const sig = (race) =>
  createHash('sha1')
    .update(JSON.stringify([race.pr, race.isCalled, (race.cands || []).map((c) => [c.n, c.v, c.pc, c.w])]))
    .digest('hex');

const files = await walk(SHARD_DIR);
const shards = (await Promise.all(files.map(readJson))).filter(Boolean);
const previous = await loadPrevious();
const prevById = new Map((previous.races || []).map((r) => [Number(r.id), r]));

console.log(`Found ${files.length} shard files: ${files.join(', ') || '(none)'}`);

const okShards = shards.filter((s) => s.failed !== -1);
const failedWorkers = new Set(shards.filter((s) => s.failed === -1).map((s) => Number(s.worker)));
const selected = new Set(okShards.flatMap((s) => s.selectedIds || []).map(Number));

const merged = new Map();
for (const s of okShards) {
  for (const race of s.races || []) merged.set(Number(race.id), race);
}

// Carry forward races owned by failed workers, or races a worker skipped this run.
let carried = 0;
for (const [id, race] of prevById) {
  if (merged.has(id)) continue;
  const keep = selected.size === 0 || selected.has(id) || failedWorkers.size > 0;
  if (keep) {
    merged.set(id, { ...race, stale: true });
    carried++;
  }
}

// Append a history point only when the numbers actually changed.
let changed = 0;
const now = new Date().toISOString();
const races = [...merged.values()]
  .map((race) => {
    if (race.stale) return race;
    const prev = prevById.get(Number(race.id));
    const prevHistory = Array.isArray(prev?.history) ? prev.history : [];
    const point = (race.history || []).at(-1);
    const isNew = !prev || prev.sig !== sig(race);
    if (isNew) changed++;
    const history = isNew && point ? [...prevHistory, point] : prevHistory.length ? prevHistory : race.history || [];
    return { ...race, stale: false, sig: sig(race), history: history.slice(-MAX_HISTORY) };
  })
  .sort((a, b) => a.id - b.id);

if (!races.length && prevById.size) {
  console.error('::error::Merge produced 0 races but a previous dataset exists; refusing to publish an empty file.');
  process.exit(1);
}

await mkdir(dirname(OUT), { recursive: true });
await writeFile(
  OUT,
  JSON.stringify({ updated: now, day: shards.at(0)?.day ?? null, count: races.length, changed, carried, races }) + '\n'
);
console.log(`Merged ${races.length} races (${changed} changed, ${carried} carried forward) -> ${OUT}`);
