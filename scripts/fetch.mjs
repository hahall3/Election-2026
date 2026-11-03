// Pulls all Kentucky races, US Senate, US House, and Governor for ELECTION_DAY from civicAPI.
import { writeFile, mkdir } from 'node:fs/promises';

const BASE = process.env.CIVIC_BASE || 'https://civicapi.org/api/v2/';
const DAY = process.env.ELECTION_DAY || '2026-11-03';

const KEYWORDS = [
  'president', 'u.s. senate', 'us senate', 'senate', 'governor', 'u.s. house', 'us house', 'congress',
  'attorney general', 'secretary of state', 'treasurer', 'auditor', 'commissioner', 'judge',
  'fiscal court', 'sheriff', 'clerk', 'jailer', 'coroner', 'assessor', 'surveyor'
];
const TYPES = ['federal', 'governor', 'state house', 'state senate', 'county', 'local', 'municipal'];

const H = { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' };

// Helper fetch function with automatic retry logic for 502/500 rate-limit errors
const get = async (p, retries = 3) => {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      const r = await fetch(BASE + p, { headers: H });
      if (r.ok) return await r.json();

      // Retry on transient server error codes (502 Bad Gateway, 500, 429 Rate Limit)
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

const q = new URLSearchParams({ startDate: DAY, endDate: DAY, country: 'US', province: 'KY', limit: '50000' });
const raw = await get('race/search?' + q);
const all = Array.isArray(raw) ? raw : list(Object.values(raw || {}).find(Array.isArray));

// Filter to capture all federal marquee races (US Senate, US House, Governor) + all KY county elections
const picked = all
  .filter((r) => String(r.election_date ?? '').slice(0, 10) === DAY)
  .filter(
    (r) =>
      any(low(r.election_name), KEYWORDS) ||
      any(low(r.type ?? r.election_type), TYPES) ||
      Boolean(r.district || r.municipality || r.region_results)
  );

console.log(`search: ${all.length} total found, ${picked.length} selected for processing`);

const mc = (c) => ({
  n: c?.name,
  p: c?.party,
  w: Boolean(c?.winner || c?.is_winner),
  col: c?.color,
  v: num(c?.votes),
  pc: num(c?.percent)
});

const one = async (m) => {
  // Ensure 'd' safely defaults to an empty object if 'get' returns null/undefined
  const d = (await get('race/' + m.id)) || {};

  const regions = list(d.region_results).map((r) => {
    const g = Array.isArray(r?.region) ? r.region[0] : r?.region || {};
    const candsList = list(r?.candidates).map(mc);
    const regReporting = num(g?.percent_reporting) || 0;
    const regTotalVotes = candsList.reduce((acc, c) => acc + (c.v || 0), 0);

    // Estimate expected votes based on registered voters or turnout reporting ratio
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

// Batch concurrency workers with gaps to prevent HTTP 502 rate-limiting
await Promise.all(
  Array.from({ length: 3 }, async () => {
    while (i < picked.length) {
      const m = picked[i++];
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
  console.error('No races fetched; leaving data/races.json untouched');
  process.exit(1);
}

races.sort((a, b) => a.id - b.id);

await mkdir('data', { recursive: true });
await writeFile(
  'data/races.json',
  JSON.stringify({ updated: new Date().toISOString(), day: DAY, state: 'KY', failed, races }, null, 2)
);

console.log(`Successfully wrote ${races.length} races to data/races.json`);
