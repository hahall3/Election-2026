// Election 2026 Initiative — results fetch worker.
// Pulls federal marquee races (U.S. Senate, U.S. House, Governor) nationwide,
// plus ALL state, county, and local races for Kentucky.
// Each matrix worker owns the races where (id % TOTAL_WORKERS === WORKER_ID),
// so ownership is stable across runs regardless of API result ordering.
import { writeFile, mkdir } from 'node:fs/promises';

const BASE = process.env.CIVIC_BASE || 'https://civicapi.org/api/v2/';
const DAY = process.env.ELECTION_DAY || '2026-11-03';
const REQUEST_TIMEOUT_MS = Number(process.env.REQUEST_TIMEOUT_MS || 20000);
const CONCURRENCY = Number(process.env.FETCH_CONCURRENCY || 3);

// Matrix worker environment variables passed from GitHub Actions
const WORKER_ID = Number(process.env.WORKER_ID || 0);
const TOTAL_WORKERS = Math.max(1, Number(process.env.TOTAL_WORKERS || 1));

// KY state/county/local keywords and types
const KY_LOCAL_KEYWORDS = [
  'attorney general', 'secretary of state', 'treasurer', 'auditor', 'commissioner', 'judge',
  'fiscal court', 'sheriff', 'clerk', 'jailer', 'coroner', 'assessor', 'surveyor', 'mayor',
  'council', 'school board', 'board of education', 'magistrate', 'constable', 'pva',
  'state senate', 'state house', 'state representative', 'amendment'
];
const KY_TYPES = ['state', 'state house', 'state senate', 'county', 'local', 'municipal', 'judicial'];

const H = { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' };
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

// Fetch with timeout and retry on transient errors (network, 429, 5xx)
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
    if (attempt < retries - 1) await sleep(500 * (attempt + 1));
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
const low = (x) => String(x ?? '').toLowerCase();
const any = (t, terms) => terms.some((k) => t.includes(k));

const isKentuckyRace = (r) => {
  const state = String(r.province ?? r.state ?? '').trim().toUpperCase();
  const name = low(r.election_name);
  return state === 'KY' || state === 'KENTUCKY' || name.includes('kentucky') || name.includes(', ky');
};

// Strict category classification. Bare "senate"/"house"/"governor" matching
// previously pulled every State Senate, State House, and Lieutenant Governor
// race in the country and mislabeled them as federal races.
const classify = (r) => {
  const name = low(r.election_name);
  const type = low(r.type ?? r.election_type);
  const text = `${name} ${type}`;

  const isStateLeg = /\bstate (senate|house|representative|assembly)\b|\blegislative\b|\bgeneral assembly\b/.test(text);
  const isLtGov = /\b(lieutenant|lt\.?) governor\b/.test(text);
  const federal = /\b(u\.?\s?s\.?|united states|federal)\b/.test(text);

  if (!isStateLeg) {
    if (/\b(u\.?\s?s\.?|united states) senat(e|or)\b/.test(text) || (federal && /\bsenate\b/.test(text))) {
      return 'U.S. Senate';
    }
    if (
      /\b(u\.?\s?s\.?|united states) (house|representative)\b|\bcongress(ional)?\b|\brepresentative in congress\b/.test(text) ||
      (federal && /\bhouse\b/.test(text))
    ) {
      return 'U.S. House';
    }
  }
  if (!isLtGov && /\bgovernor\b/.test(text)) return 'Governor';
  return 'State/Local';
};

const writeShard = async (payload) => {
  await mkdir('data', { recursive: true });
  const filePath = `data/races-${WORKER_ID}.json`;
  await writeFile(filePath, JSON.stringify(payload, null, 2) + '\n');
  return filePath;
};

// ---------------------------------------------------------------------------
// 1. Race discovery
// ---------------------------------------------------------------------------
let all = [];
try {
  const q = new URLSearchParams({ startDate: DAY, endDate: DAY, country: 'US', limit: '50000' });
  const raw = await get('race/search?' + q);
  all = Array.isArray(raw) ? raw : list(Object.values(raw || {}).find(Array.isArray));
} catch (e) {
  // Safe shard writing: still emit a valid (empty) shard, but fail the step
  // visibly. merge.mjs carries forward last good results for this worker.
  console.error(`::error::Worker ${WORKER_ID} race search failed: ${e.message}`);
  const filePath = await writeShard({
    updated: new Date().toISOString(), day: DAY, worker: WORKER_ID, failed: -1, error: e.message, races: []
  });
  console.log(`Worker ${WORKER_ID} wrote empty shard to ${filePath}`);
  process.exit(1);
}

// Filtering rules:
// 1. Must be on ELECTION_DAY
// 2. EITHER a federal marquee race (U.S. Senate, U.S. House, Governor) anywhere
// 3. OR any Kentucky state / county / local race
const seen = new Set();
const picked = all
  .filter((r) => r && r.id != null && String(r.election_date ?? '').slice(0, 10) === DAY)
  .filter((r) => {
    const key = String(r.id);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  })
  .filter((r) => {
    const category = classify(r);
    if (category !== 'State/Local') return true;
    if (!isKentuckyRace(r)) return false;
    const name = low(r.election_name);
    const type = low(r.type ?? r.election_type);
    return any(name, KY_LOCAL_KEYWORDS) || any(type, KY_TYPES) || Boolean(r.district || r.municipality);
  })
  .sort((a, b) => Number(a.id) - Number(b.id));

// Stable partition by race id (not array index)
const owner = (r) => {
  const n = Number(r.id);
  if (Number.isFinite(n)) return Math.abs(Math.trunc(n)) % TOTAL_WORKERS;
  let h = 0;
  for (const ch of String(r.id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return h % TOTAL_WORKERS;
};
const workerPicked = picked.filter((r) => owner(r) === WORKER_ID);

console.log(`Worker ${WORKER_ID + 1}/${TOTAL_WORKERS}: Processing ${workerPicked.length} of ${picked.length} selected races (${all.length} returned by search).`);

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

// region_results arrives keyed by region slug ({ "jefferson": {...} }) with the
// region attributes (name, type, percent_reporting) flat on each entry. The old
// parser read r.region (absent), so every county was written as "Unknown".
// Object.entries keeps the slug so it can serve as a last-resort name.
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
    const [k0, v0] = entries(d.region_results)[0];
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

  // Fill missing candidate percentages from vote totals
  const totalVotes = cands.reduce((acc, c) => acc + (c.v || 0), 0);
  if (totalVotes > 0) {
    cands = cands.map((c) => (c.pc == null ? { ...c, pc: Math.round(((c.v || 0) / totalVotes) * 1000) / 10 } : c));
  }

  const raceCategory = classify(m);
  const reportingPct = num(d.percent_reporting ?? m.percent_reporting) || 0;
  const isCalled = Boolean(d.is_called || cands.some((c) => c.w));
  const isKY = isKentuckyRace(m);

  return {
    id: Number(m.id),
    name: m.election_name,
    category: raceCategory,
    type: raceCategory,
    state: isKY ? 'KY' : (m.province ?? m.state ?? 'US'),
    isKentucky: isKY,
    district: m.district ?? null,
    muni: m.municipality ?? null,
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

// Safe shard writing: always write a valid shard, even with zero races.
// selectedIds is the full (all-worker) selection for this run; merge.mjs uses
// it to prune stale races that no longer pass the selection rules.
const filePath = await writeShard({
  updated: new Date().toISOString(),
  day: DAY,
  worker: WORKER_ID,
  failed,
  selectedIds: picked.map((r) => Number(r.id)),
  races
});

console.log(`Worker ${WORKER_ID + 1} wrote ${races.length} races (${failed} failed) to ${filePath}`);
