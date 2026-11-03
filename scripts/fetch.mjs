// Election 2026 Initiative — results fetch worker.
// Reads data/manifest.json (written once by discover.mjs) and fetches per-race
// detail for the races this worker owns: (id % TOTAL_WORKERS === WORKER_ID).
//
// Load protection for civicAPI on election night:
//  - Priority order: KY federal/Governor -> U.S. Senate/Governor -> U.S. House -> KY state/local.
//  - Frozen races: races already called at 100% reporting are reused from the
//    last published dataset instead of being re-fetched.
//  - Adaptive backoff: 429/5xx responses pause the whole worker (honors Retry-After).
//  - Circuit breaker: after BREAKER_LIMIT consecutive 5xx/timeouts, stop calling the API.
//  - Time budget: stop starting new requests after FETCH_BUDGET_MS and always write
//    the shard. Unfetched races are carried forward by merge.mjs.
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const BASE = process.env.CIVIC_BASE || 'https://civicapi.org/api/v2/';
const DAY = process.env.ELECTION_DAY || '2026-11-03';
const MANIFEST = process.env.MANIFEST || 'data/manifest.json';
const PREVIOUS_URL = process.env.PREVIOUS_URL || '';
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 20000);
const CONCURRENCY = Math.max(1, Number(process.env.FETCH_CONCURRENCY || 2));
const FETCH_BUDGET_MS = Number(process.env.FETCH_BUDGET_MS || 240000);
const REQUEST_GAP_MS = Number(process.env.REQUEST_GAP_MS || 150);
const BREAKER_LIMIT = Number(process.env.BREAKER_LIMIT || 25);
const MAX_RETRIES = Number(process.env.MAX_RETRIES || 2);

const WORKER_ID = Number(process.env.WORKER_ID || 0);
const TOTAL_WORKERS = Math.max(1, Number(process.env.TOTAL_WORKERS || 1));
const START = Date.now();

const H = { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' };
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const elapsed = () => Date.now() - START;
const overBudget = () => elapsed() > FETCH_BUDGET_MS;

// ---------------------------------------------------------------------------
// Shared throttle state (all concurrent lanes in this worker obey it)
// ---------------------------------------------------------------------------
let pauseUntil = 0;
let consecutiveBad = 0;
let breakerOpen = false;
const statusCounts = {};

const bump = (key) => {
  statusCounts[key] = (statusCounts[key] || 0) + 1;
};

const backoff = (retryAfterHeader) => {
  consecutiveBad++;
  const retryAfter = Number(retryAfterHeader);
  const base = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 500 * 2 ** Math.min(consecutiveBad - 1, 6);
  const wait = Math.min(30000, base) + Math.floor(Math.random() * 500);
  pauseUntil = Math.max(pauseUntil, Date.now() + wait);
  if (consecutiveBad >= BREAKER_LIMIT && !breakerOpen) {
    breakerOpen = true;
    console.warn(`::warning::Worker ${WORKER_ID} circuit breaker open after ${consecutiveBad} consecutive API failures; remaining races deferred.`);
  }
};

const gate = async () => {
  const wait = pauseUntil - Date.now();
  if (wait > 0) await sleep(wait);
};

const get = async (p) => {
  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (breakerOpen || overBudget()) break;
    await gate();
    try {
      const r = await fetch(BASE + p, { headers: H, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
      bump(String(r.status));
      if (r.ok) {
        consecutiveBad = 0;
        return await r.json();
      }
      lastErr = new Error(`${r.status} ${p}`);
      if (r.status === 429 || r.status >= 500) {
        backoff(r.headers.get('retry-after'));
        continue;
      }
      throw lastErr;
    } catch (e) {
      if (/^4\d\d /.test(e.message) && !e.message.startsWith('429')) throw e;
      if (e.name === 'TimeoutError' || e.name === 'AbortError' || e.name === 'TypeError') {
        bump(e.name);
        backoff(null);
      }
      lastErr = e;
    }
  }
  throw lastErr || new Error(breakerOpen ? 'circuit breaker open' : 'fetch budget exhausted');
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
// 1. Load manifest + previous published dataset
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

const previousById = new Map();
if (PREVIOUS_URL) {
  try {
    const r = await fetch(`${PREVIOUS_URL}?t=${Date.now()}`, { headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(15000) });
    if (r.ok) {
      const j = await r.json();
      list(j.races).forEach((x) => previousById.set(Number(x.id), x));
      console.log(`Loaded ${previousById.size} races from previous dataset.`);
    } else {
      console.log(`Previous dataset not available (${r.status}); fetching everything.`);
    }
  } catch (e) {
    console.log(`Previous dataset not available (${e.message}); fetching everything.`);
  }
}

const picked = list(manifest.races);
const owner = (r) => {
  const n = Number(r.id);
  if (Number.isFinite(n)) return Math.abs(Math.trunc(n)) % TOTAL_WORKERS;
  let h = 0;
  for (const ch of String(r.id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % TOTAL_WORKERS;
};

const isFrozen = (prev) => Boolean(prev && prev.isCalled && Number(prev.pr) >= 100 && !prev.stale);

const tier = (r) => {
  if (r.isKentucky && r.category !== 'State/Local') return 0;
  if (r.category === 'U.S. Senate' || r.category === 'Governor') return 1;
  if (r.category === 'U.S. House') return 2;
  return 3;
};

// Rotate the start point of the lowest tier every 5 minutes so that when the
// budget runs out, a different slice of KY local races gets refreshed each run.
const rotation = Math.floor(Date.now() / 300000);
const mine = picked.filter((r) => owner(r) === WORKER_ID);
const frozen = mine.filter((r) => isFrozen(previousById.get(Number(r.id))));
const frozenIds = new Set(frozen.map((r) => Number(r.id)));
const tiers = [0, 1, 2, 3].map((t) =>
  mine
    .filter((r) => !frozenIds.has(Number(r.id)) && tier(r) === t)
    .sort((a, b) => {
      const ac = previousById.get(Number(a.id))?.isCalled ? 1 : 0;
      const bc = previousById.get(Number(b.id))?.isCalled ? 1 : 0;
      return ac - bc || a.id - b.id;
    })
);
const lastTier = tiers.at(3);
const offset = lastTier.length ? rotation % lastTier.length : 0;
const queue = [...tiers.at(0), ...tiers.at(1), ...tiers.at(2), ...lastTier.slice(offset), ...lastTier.slice(0, offset)];

console.log(
  `Worker ${WORKER_ID + 1}/${TOTAL_WORKERS}: ${mine.length} of ${picked.length} manifest races ` +
    `(source=${manifest.source}); ${frozen.length} frozen, ${queue.length} to fetch ` +
    `[tiers ${tiers.map((t) => t.length).join('/')}], budget ${FETCH_BUDGET_MS} ms, concurrency ${CONCURRENCY}.`
);

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
    const firstRegion = entries(d.region_results).at(0);
    const k0 = firstRegion.at(0);
    const v0 = firstRegion.at(1);
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
      fips: g?.fips ?? null,
      fill: g?.fill ?? null,
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

// Frozen races are emitted unchanged so merge.mjs sees an identical signature.
const races = frozen.map((r) => ({ ...previousById.get(Number(r.id)), stale: false }));
let failed = 0;
let fetched = 0;
let i = 0;

await Promise.all(
  Array.from({ length: CONCURRENCY }, async () => {
    while (i < queue.length && !breakerOpen && !overBudget()) {
      const m = queue[i++];
      try {
        races.push(await one(m));
        fetched++;
      } catch (e) {
        failed++;
        if (failed <= 20) console.warn(`::warning::skip ${m.id} (${m.election_name}): ${e.message}`);
      }
      await sleep(REQUEST_GAP_MS);
    }
  })
);

const deferred = queue.length - Math.min(i, queue.length);
races.sort((a, b) => a.id - b.id);

const filePath = await writeShard({
  updated: new Date().toISOString(),
  day: DAY,
  worker: WORKER_ID,
  failed,
  deferred,
  frozen: frozen.length,
  statusCounts,
  selectedIds: picked.map((r) => Number(r.id)),
  races
});

console.log(
  `Worker ${WORKER_ID + 1} wrote ${races.length} races to ${filePath}: ${fetched} fetched, ${frozen.length} frozen, ` +
    `${failed} failed, ${deferred} deferred in ${Math.round(elapsed() / 1000)} s. HTTP: ${JSON.stringify(statusCounts)}`
);
if (failed > 20) console.warn(`::warning::${failed - 20} additional skip warnings suppressed.`);
