// Election 2026 Initiative — results fetch worker.
// Reads data/manifest.json (written once by discover.mjs) and fetches per-race
// detail for the races this worker owns: (id % TOTAL_WORKERS === WORKER_ID).
// No nationwide search happens here, so workers can no longer time out on it.
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const BASE = process.env.CIVIC_BASE || 'https://civicapi.org/api/v2/';
const DAY = process.env.ELECTION_DAY || '2026-11-03';
const MANIFEST = process.env.MANIFEST || 'data/manifest.json';
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 30000);
const CONCURRENCY = Number(process.env.FETCH_CONCURRENCY || 3);

const WORKER_ID = Number(process.env.WORKER_ID || 0);
const TOTAL_WORKERS = Math.max(1, Number(process.env.TOTAL_WORKERS || 1));

const H = { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' };
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

const get = async (p, retries = 3) => {
  let lastErr;
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const r = await fetch(BASE + p, { headers: H, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      if (r.ok) return await r.json();
      lastErr = new Error(`${r.status} ${p}`);
      if (r.status !== 429 && r.status < 500) throw lastErr;
    } catch (e) {
      lastErr = e;
      if (/^4\d\d /.test(e.message) && !e.message.startsWith('429')) throw e;
    }
    if (attempt < retries - 1) await sleep(1000 * (attempt + 1));
  }
  throw lastErr;
};

const list = (x) => (x == null ? [] : Array.isArray(x) ? x : typeof x === 'object' ? Object.values(x) : []);
const num = (v) => {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return v;
  const n = Number(String(v).replace(/[,%\s]/g, ''));
  return Number.isNaN(n) ? null : n;
};

const writeShard = async (payload) => {
  await mkdir('data', { recursive: true });
  const filePath = `data/races-${WORKER_ID}.json`;
  await writeFile(filePath, JSON.stringify(payload, null, 2) + '\n');
  return filePath;
};

// ---------------------------------------------------------------------------
// 1. Load manifest
// ---------------------------------------------------------------------------
let manifest;
try {
  manifest = JSON.parse(await readFile(MANIFEST, 'utf8'));
} catch (e) {
  console.error(`::error::Worker ${WORKER_ID} could not read ${MANIFEST}: ${e.message}`);
  const filePath = await writeShard({
    updated: new Date().toISOString(), day: DAY, worker: WORKER_ID, failed: -1, error: e.message, races: []
  });
  console.log(`Worker ${WORKER_ID} wrote empty shard to ${filePath}`);
  process.exit(0);
}

const picked = list(manifest.races);
const owner = (r) => {
  const n = Number(r.id);
  if (Number.isFinite(n)) return Math.abs(Math.trunc(n)) % TOTAL_WORKERS;
  let h = 0;
  for (const ch of String(r.id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % TOTAL_WORKERS;
};
const workerPicked = picked.filter((r) => owner(r) === WORKER_ID);

console.log(`Worker ${WORKER_ID + 1}/${TOTAL_WORKERS}: Processing ${workerPicked.length} of ${picked.length} manifest races (source=${manifest.source}).`);

// ---------------------------------------------------------------------------
// 2. Per-race detail
// ---------------------------------------------------------------------------
const mc = (c) => ({
  n: c?.name,
  p: c?.party,
  w: Boolean(c?.winner || c?.is_winner),
  col: c?.color,
  v: num(c?.votes),
  pc: num(c?.percent)
});

const entries = (x) =>
  x == null ? [] : Array.isArray(x) ? x.map((v, k) => [String(k), v]) : typeof x === 'object' ? Object.entries(x) : [];

const humanize = (slug) => {
  if (!slug || /^\d+$/.test(slug)) return null;
  return String(slug)
    .replace(/^[a-z]{2}[-_:]/i, '')
    .replace(/[-_]+/g, ' ')
    .replace(/\s+county$/i, '')
    .trim()
    .replace(/\b\w/g, (ch) => ch.toUpperCase());
};

const cleanRegionName = (n) => String(n).replace(/\s+County$/i, '').trim();

let shapeLogged = false;

const one = async (m) => {
  const d = (await get('race/' + m.id)) || {};
  const now = new Date().toISOString();

  if (!shapeLogged && entries(d.region_results).length) {
    shapeLogged = true;
    const [k0, v0] = entries(d.region_results)[0](https://citation-placeholder);
    console.log(`region_results shape (race ${m.id}): key="${k0}" fields=${Object.keys(v0 || {}).join(',')}`);
  }

  const regions = entries(d.region_results).map(([slug, r]) => {
    const nested = Array.isArray(r?.region) ? r.region.at(0) : r?.region && typeof r.region === 'object' ? r.region : null;
    const g = { ...(r || {}), ...(nested || {}) };
    const rawName =
      g.name ?? g.region_name ?? g.county ?? g.county_name ?? (typeof r?.region === 'string' ? r.region : null) ?? humanize(slug);
    const candsList = list(r?.candidates).map(mc);
    const regReporting = num(g?.percent_reporting) || 0;
    const regTotalVotes = candsList.reduce((acc, c) => acc + (c.v || 0), 0);

    const regVoters = num(g?.registered_voters);
    let expectedVotes = regVoters ? Math.round(regVoters * 0.65) : null;
    if (!expectedVotes && regReporting > 0) {
      expectedVotes = Math.round(regTotalVotes / (regReporting / 100));
    }

    return {
      name: rawName ? cleanRegionName(rawName) : 'Unknown',
      slug,
      type: g?.type || 'County',
      rep: regReporting,
      votes: regTotalVotes,
      expectedVotes: expectedVotes || regTotalVotes,
      c: candsList,
      lastUpdated: now
    };
  });

  let cands = list(d.candidates).map(mc);
  if (!cands.length) {
    const t = {};
    regions.forEach((g) =>
      g.c.forEach((c) => {
        (t[c.n] ??= { ...c, v: 0 }).v += c.v || 0;
      })
    );
    cands = Object.values(t);
  }

  const totalVotes = cands.reduce((acc, c) => acc + (c.v || 0), 0);
  if (totalVotes > 0) {
    cands = cands.map((c) => (c.pc == null ? { ...c, pc: Math.round(((c.v || 0) / totalVotes) * 1000) / 10 } : c));
  }

  const reportingPct = num(d.percent_reporting ?? m.percent_reporting) || 0;
  const isCalled = Boolean(d.is_called || cands.some((c) => c.w));

  return {
    id: Number(m.id),
    name: m.election_name ?? d.election_name,
    category: m.category,
    type: m.category,
    state: m.state,
    isKentucky: Boolean(m.isKentucky),
    district: m.district ?? null,
    muni: m.muni ?? null,
    pr: reportingPct,
    reg: num(d.registered_voters),
    isCalled,
    cands,
    regions,
    history: [
      {
        timestamp: now,
        reporting: reportingPct,
        candidates: cands.map((c) => ({ n: c.n, v: c.v, pc: c.pc }))
      }
    ]
  };
};

const races = [];
let failed = 0;
let i = 0;

await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (i < workerPicked.length) {
      const m = workerPicked[i++];
      try {
        races.push(await one(m));
      } catch (e) {
        failed++;
        console.warn(`::warning::skip ${m.id} (${m.election_name}): ${e.message}`);
      }
      await sleep(50);
    }
  })
);

races.sort((a, b) => a.id - b.id);

const filePath = await writeShard({
  updated: new Date().toISOString(),
  day: DAY,
  worker: WORKER_ID,
  failed,
  selectedIds: picked.map((r) => Number(r.id)),
  races
});

console.log(`Worker ${WORKER_ID + 1} wrote ${races.length} races (${failed} failed) to ${filePath}`);
