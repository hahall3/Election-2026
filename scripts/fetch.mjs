// Pulls federal marquee races (US Senate, US House, Governor, President) nationwide,
// plus ALL state, county, and local races for Kentucky.
import { writeFile, mkdir } from 'node:fs/promises';

const BASE = process.env.CIVIC_BASE || 'https://civicapi.org/api/v2/';
const DAY = process.env.ELECTION_DAY || '2026-11-03';

// Matrix worker environment variables passed from GitHub Actions
const WORKER_ID = Number(process.env.WORKER_ID || 0);
const TOTAL_WORKERS = Number(process.env.TOTAL_WORKERS || 1);

// National Marquee keywords and race categories
const NATIONAL_MARQUEE_KEYWORDS = [
  'president', 'u.s. senate', 'us senate', 'senate', 'governor', 'u.s. house', 'us house', 'congress'
];
const NATIONAL_TYPES = ['federal', 'governor'];

// KY specific local keywords
const KY_LOCAL_KEYWORDS = [
  'attorney general', 'secretary of state', 'treasurer', 'auditor', 'commissioner', 'judge',
  'fiscal court', 'sheriff', 'clerk', 'jailer', 'coroner', 'assessor', 'surveyor'
];
const KY_TYPES = ['state house', 'state senate', 'county', 'local', 'municipal'];

const H = { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' };

// Helper fetch function with automatic retry logic for transient API error codes
const get = async (p, retries = 3) => {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const r = await fetch(BASE + p, { headers: H });
      if (r.ok) return await r.json();

      if (r.status === 502 || r.status === 500 || r.status === 429) {
        await new Promise((res) => setTimeout(res, 500 * (attempt + 1)));
        continue;
      }
      throw new Error(r.status + ' ' + p);
    } catch (e) {
      if (attempt === retries - 1) throw e;
      await new Promise((res) => setTimeout(res, 500 * (attempt + 1)));
    }
  }
};

const list = (x) => (x == null ? [] : Array.isArray(x) ? x : typeof x === 'object' ? Object.values(x) : []);
const num = (v) => {
  if (v == null) return null;
  if (typeof v === 'number') return v;
  const n = Number(String(v).replace(/[,%\s]/g, ''));
  return Number.isNaN(n) ? null : n;
};
const low = (x) => String(x ?? '').toLowerCase();
const any = (t, terms) => terms.some((k) => t.includes(k));

// Perform search request across the US without restricting state at search level
const q = new URLSearchParams({ startDate: DAY, endDate: DAY, country: 'US', limit: '50000' });
const raw = await get('race/search?' + q);
const all = Array.isArray(raw) ? raw : list(Object.values(raw || {}).find(Array.isArray));

// Filtering Rules:
// 1. Must be on ELECTION_DAY
// 2. EITHER it's a National Marquee Race (US Senate, US House, Governor, President)
// 3. OR it belongs to Kentucky (state / county / local elections in KY)
const picked = all
  .filter((r) => String(r.election_date ?? '').slice(0, 10) === DAY)
  .filter((r) => {
    const name = low(r.election_name);
    const type = low(r.type ?? r.election_type);
    const state = String(r.province ?? r.state ?? '').toUpperCase();

    const isNationalMarquee = any(name, NATIONAL_MARQUEE_KEYWORDS) || any(type, NATIONAL_TYPES);
    const isKentucky = state === 'KY' || name.includes('kentucky') || name.includes(', ky');

    // Keep if it is a national marquee race OR any race located in KY
    if (isNationalMarquee) return true;
    if (isKentucky && (any(name, KY_LOCAL_KEYWORDS) || any(type, KY_TYPES) || Boolean(r.district || r.municipality))) {
      return true;
    }

    return false;
  });

// Partition work across matrix workers
const workerPicked = picked.filter((_, index) => index % TOTAL_WORKERS === WORKER_ID);

console.log(`Worker ${WORKER_ID + 1}/${TOTAL_WORKERS}: Processing ${workerPicked.length} of ${picked.length} selected races.`);

const mc = (c) => ({
  n: c?.name,
  p: c?.party,
  w: Boolean(c?.winner || c?.is_winner),
  col: c?.color,
  v: num(c?.votes),
  pc: num(c?.percent)
});

const one = async (m) => {
  const d = (await get('race/' + m.id)) || {};

  const regions = list(d.region_results).map((r) => {
    const g = Array.isArray(r?.region) ? r.region[0] : r?.region || {};
    const candsList = list(r?.candidates).map(mc);
    const regReporting = num(g?.percent_reporting) || 0;
    const regTotalVotes = candsList.reduce((acc, c) => acc + (c.v || 0), 0);

    const regVoters = num(g?.registered_voters);
    let expectedVotes = regVoters ? Math.round(regVoters * 0.65) : null;
    if (!expectedVotes && regReporting > 0) {
      expectedVotes = Math.round(regTotalVotes / (regReporting / 100));
    }

    return {
      name: g?.name || 'Unknown',
      type: g?.type || 'County',
      rep: regReporting,
      votes: regTotalVotes,
      expectedVotes: expectedVotes || regTotalVotes,
      c: candsList,
      lastUpdated: new Date().toISOString()
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

  const lowerName = low(m.election_name);
  let raceCategory = m.type ?? m.election_type ?? 'State/Local';
  if (lowerName.includes('senate')) raceCategory = 'U.S. Senate';
  else if (lowerName.includes('governor')) raceCategory = 'Governor';
  else if (lowerName.includes('house') || lowerName.includes('congress')) raceCategory = 'U.S. House';

  const reportingPct = num(d.percent_reporting ?? m.percent_reporting) || 0;
  const isCalled = Boolean(d.is_called || cands.some((c) => c.w));

  const historySnapshot = {
    timestamp: new Date().toISOString(),
    reporting: reportingPct,
    candidates: cands.map((c) => ({ n: c.n, v: c.v, pc: c.pc }))
  };

  return {
    id: Number(m.id),
    name: m.election_name,
    category: raceCategory,
    type: raceCategory,
    state: m.province ?? m.state ?? 'KY',
    district: m.district,
    muni: m.municipality,
    pr: reportingPct,
    reg: num(d.registered_voters),
    isCalled,
    cands,
    regions,
    history: [historySnapshot]
  };
};

const races = [];
let failed = 0, i = 0;

await Promise.all(
  Array.from({ length: 3 }, async () => {
    while (i < workerPicked.length) {
      const m = workerPicked[i++];
      try {
        races.push(await one(m));
      } catch (e) {
        failed++;
        console.warn('skip', m.id, e.message);
      }
      await new Promise((res) => setTimeout(res, 50));
    }
  })
);

if (!races.length) {
  console.error(`Worker ${WORKER_ID + 1}: No races fetched.`);
  process.exit(1);
}

races.sort((a, b) => a.id - b.id);

await mkdir('data', { recursive: true });
const filePath = `data/races-${WORKER_ID}.json`;
await writeFile(
  filePath,
  JSON.stringify({ updated: new Date().toISOString(), day: DAY, worker: WORKER_ID, failed, races }, null, 2)
);

console.log(`Worker ${WORKER_ID + 1} wrote ${races.length} races to ${filePath}`);
