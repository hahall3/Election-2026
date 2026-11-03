// Pulls all Kentucky races, US Senate, US Governor, and US House races for ELECTION_DAY from civicAPI.
import { writeFile, mkdir } from 'node:fs/promises';

const BASE = process.env.CIVIC_BASE || 'https://civicapi.org/api/v2/';
const DAY = process.env.ELECTION_DAY || '2026-11-03';

// Explicitly include US Senate, US House, and Governor alongside state/local terms
const MARQUEE_RACES = ['u.s. senate', 'us senate', 'senate', 'governor', 'u.s. house', 'us house', 'congress'];
const KEYWORDS = [
  ...MARQUEE_RACES,
  'president', 'attorney general', 'secretary of state', 'treasurer', 'auditor', 
  'commissioner', 'judge', 'fiscal court', 'sheriff', 'clerk', 'jailer', 'coroner'
];
const TYPES = ['federal', 'governor', 'state house', 'state senate', 'county', 'local', 'municipal'];

const H = { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' };

const get = async (p) => {
  const r = await fetch(BASE + p, { headers: H });
  if (!r.ok) throw new Error(r.status + ' ' + p);
  return r.json();
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
const all = Array.isArray(raw) ? raw : list(Object.values(raw).find(Array.isArray));

// Filter to capture all federal marquee races (US Senate, US House, Governor) + all KY county elections
const picked = all
  .filter((r) => String(r.election_date ?? '').slice(0, 10) === DAY)
  .filter(
    (r) =>
      any(low(r.election_name), KEYWORDS) ||
      any(low(r.type ?? r.election_type), TYPES) ||
      Boolean(r.district || r.municipality || r.region_results)
  );

console.log(`search: ${all.length} total found, ${picked.length} KY & Federal marquee races selected`);

const mc = (c) => ({ n: c.name, p: c.party, w: !!c.winner, col: c.color, v: num(c.votes), pc: num(c.percent) });

const one = async (m) => {
  const d = await get('race/' + m.id);

  // Parse county regions if available
  const regions = list(d.region_results).map((r) => {
    const g = Array.isArray(r.region) ? r.region[0] : r.region || {};
    return {
      name: g.name || 'Unknown',
      type: g.type || 'County',
      rep: num(g.percent_reporting),
      c: list(r.candidates).map(mc)
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

  // Tag marquee federal/statewide races explicitly for UI filtering
  const lowerName = low(m.election_name);
  let raceCategory = m.type ?? m.election_type ?? 'State/Local';
  if (lowerName.includes('senate')) raceCategory = 'U.S. Senate';
  else if (lowerName.includes('governor')) raceCategory = 'Governor';
  else if (lowerName.includes('house') || lowerName.includes('congress')) raceCategory = 'U.S. House';

  const historySnapshot = {
    timestamp: new Date().toISOString(),
    reporting: num(d.percent_reporting ?? m.percent_reporting),
    candidates: cands.map((c) => ({ n: c.n, v: c.v, pc: c.pc }))
  };

  return {
    id: Number(m.id),
    name: m.election_name,
    category: raceCategory,
    type: raceCategory,
    district: m.district,
    muni: m.municipality,
    pr: num(d.percent_reporting ?? m.percent_reporting),
    reg: num(d.registered_voters),
    map: String(m.has_map) === 'true',
    cands,
    regions,
    history: [historySnapshot]
  };
};

const races = [];
let failed = 0, i = 0;

await Promise.all(
  Array.from({ length: 8 }, async () => {
    while (i < picked.length) {
      const m = picked[i++];
      try {
        races.push(await one(m));
      } catch (e) {
        failed++;
        console.warn('skip', m.id, e.message);
      }
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

console.log(`Successfully wrote ${races.length} races (including US Senate, US House, Governor) to data/races.json`);
