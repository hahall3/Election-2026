// Election 2026 Initiative — merge worker shards into data/races.json.
// - Reads every races-N.json found under shard-artifacts/ (flat or nested).
// - Accepts shard files shaped as [...] or { races: [...] }.
// - Carries forward the last good copy of any race missing from this run,
//   so a failed or empty worker never wipes live results off the dashboard.
// - Refuses to overwrite data/races.json when the merge yields zero races.
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const SHARD_DIR = path.join(ROOT, process.env.SHARD_DIR || 'shard-artifacts');
const OUT_FILE = path.join(ROOT, 'data', 'races.json');

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (err) {
    console.warn(`::warning::Unreadable JSON ${path.relative(ROOT, file)}: ${err.message}`);
    return null;
  }
}

function toRaceArray(payload) {
  if (Array.isArray(payload)) return payload;
  if (payload && Array.isArray(payload.races)) return payload.races;
  return [];
}

function findShardFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...findShardFiles(full));
    else if (/^races-\d+\.json$/.test(entry.name)) out.push(full);
  }
  return out.sort();
}

function raceKey(race) {
  return String(race.id ?? `${race.category}|${race.state}|${race.district ?? ''}|${race.name}`);
}

// 1. Previously published data (top-level shape is preserved on write).
const previousPayload = fs.existsSync(OUT_FILE) ? readJson(OUT_FILE) : null;
const previousRaces = toRaceArray(previousPayload);
const wrapped = previousPayload !== null && !Array.isArray(previousPayload);

// 2. Fresh shard data from this run.
const shardFiles = findShardFiles(SHARD_DIR);
const fresh = new Map();
for (const file of shardFiles) {
  const races = toRaceArray(readJson(file));
  console.log(`Shard ${path.relative(ROOT, file)}: ${races.length} races`);
  for (const race of races) {
    if (race && typeof race === 'object') fresh.set(raceKey(race), race);
  }
}

// History accumulation: fetch.mjs emits a single snapshot per run; append it
// to the previously published history, skipping unchanged snapshots.
const MAX_HISTORY = Number(process.env.MAX_HISTORY || 300);
const snapshotSig = (s) => JSON.stringify([s?.reporting, (s?.candidates || []).map((c) => [c.n, c.v])]);

function mergeHistory(prevRace, nextRace) {
  const prev = Array.isArray(prevRace?.history) ? prevRace.history : [];
  const next = Array.isArray(nextRace?.history) ? nextRace.history : [];
  const out = [...prev];
  for (const snap of next) {
    const last = out[out.length - 1];
    if (!last || snapshotSig(last) !== snapshotSig(snap)) out.push(snap);
  }
  return out.slice(-MAX_HISTORY);
}

// 3. Carry forward races the current run did not return (original order kept).
const merged = new Map();
let carried = 0;
for (const race of previousRaces) {
  const key = raceKey(race);
  const next = fresh.get(key);
  if (next) {
    merged.set(key, { ...next, history: mergeHistory(race, next) });
  } else {
    merged.set(key, race);
    carried += 1;
  }
}
for (const [key, race] of fresh) {
  if (!merged.has(key)) merged.set(key, race);
}

const races = [...merged.values()];

console.log(
  `Shard files: ${shardFiles.length} | fresh races: ${fresh.size} | carried forward: ${carried} | total: ${races.length}`
);

if (races.length === 0) {
  console.warn('::warning::Merge produced 0 races. Leaving data/races.json untouched.');
  process.exit(0);
}

const updated = new Date().toISOString();
const output = wrapped ? { ...previousPayload, updated, races } : races;

fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });
fs.writeFileSync(OUT_FILE, JSON.stringify(output, null, 2) + '\n');
console.log(`Wrote ${path.relative(ROOT, OUT_FILE)} (${races.length} races)`);
