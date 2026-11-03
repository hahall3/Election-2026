// Election 2026 Initiative — race discovery (runs ONCE per workflow run).
// Performs the heavy nationwide race/search a single time, applies the
// selection rules, and writes data/manifest.json for the matrix workers.
// If civicAPI search times out, falls back to the race list from the last
// published data/races.json so per-race refreshes keep flowing.
import { writeFile, mkdir } from 'node:fs/promises';

const BASE = process.env.CIVIC_BASE || 'https://civicapi.org/api/v2/';
const DAY = process.env.ELECTION_DAY || '2026-11-03';
const SEARCH_TIMEOUT_MS = Number(process.env.SEARCH_TIMEOUT_MS || 120000);
const SEARCH_RETRIES = Number(process.env.SEARCH_RETRIES || 3);
const SEARCH_LIMIT = process.env.SEARCH_LIMIT || '50000';
const PREVIOUS_URL = process.env.PREVIOUS_URL || '';

const KY_LOCAL_KEYWORDS = [
  'attorney general', 'secretary of state', 'treasurer', 'auditor', 'commissioner', 'judge',
  'fiscal court', 'sheriff', 'clerk', 'jailer', 'coroner', 'assessor', 'surveyor', 'mayor',
  'council', 'school board', 'board of education', 'magistrate', 'constable', 'pva',
  'state senate', 'state house', 'state representative', 'amendment'
];
const KY_TYPES = ['state', 'state house', 'state senate', 'county', 'local', 'municipal', 'judicial'];

const H = { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' };
const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
const list = (x) => (x == null ? [] : Array.isArray(x) ? x : typeof x === 'object' ? Object.values(x) : []);
const low = (x) => String(x ?? '').toLowerCase();
const any = (t, terms) => terms.some((k) => t.includes(k));

const isKentuckyRace = (r) => {
  const state = String(r.province ?? r.state ?? '').trim().toUpperCase();
  const name = low(r.election_name);
  return state === 'KY' || state === 'KENTUCKY' || name.includes('kentucky') || name.includes(', ky');
};

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

const search = async () => {
  const q = new URLSearchParams({ startDate: DAY, endDate: DAY, country: 'US', limit: SEARCH_LIMIT });
  let lastErr;
  for (let attempt = 0; attempt < SEARCH_RETRIES; attempt++) {
    const t0 = Date.now();
    try {
      const r = await fetch(BASE + 'race/search?' + q, { headers: H, signal: AbortSignal.timeout(SEARCH_TIMEOUT_MS) });
      if (!r.ok) throw new Error(`${r.status} race/search`);
      const raw = await r.json();
      console.log(`race/search OK in ${Date.now() - t0} ms (attempt ${attempt + 1})`);
      return Array.isArray(raw) ? raw : list(Object.values(raw || {}).find(Array.isArray));
    } catch (e) {
      lastErr = e;
      console.warn(`::warning::race/search attempt ${attempt + 1}/${SEARCH_RETRIES} failed after ${Date.now() - t0} ms: ${e.message}`);
      if (/^4\d\d /.test(e.message) && !e.message.startsWith('429')) break;
    }
    if (attempt < SEARCH_RETRIES - 1) await sleep(3000 * (attempt + 1));
  }
  throw lastErr;
};

const select = (all) => {
  const seen = new Set();
  return all
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
    .map((r) => {
      const isKentucky = isKentuckyRace(r);
      return {
        id: Number(r.id),
        election_name: r.election_name,
        category: classify(r),
        isKentucky,
        state: isKentucky ? 'KY' : (r.province ?? r.state ?? 'US'),
        district: r.district ?? null,
        muni: r.municipality ?? null,
        percent_reporting: r.percent_reporting ?? null
      };
    })
    .sort((a, b) => a.id - b.id);
};

const fromPrevious = async () => {
  if (!PREVIOUS_URL) return [];
  try {
    const r = await fetch(`${PREVIOUS_URL}?t=${Date.now()}`, { headers: { 'Cache-Control': 'no-cache' }, signal: AbortSignal.timeout(20000) });
    if (!r.ok) throw new Error(`${r.status}`);
    const j = await r.json();
    return list(j.races)
      .filter((x) => x && x.id != null)
      .map((x) => ({
        id: Number(x.id),
        election_name: x.name,
        category: x.category,
        isKentucky: Boolean(x.isKentucky),
        state: x.state ?? 'US',
        district: x.district ?? null,
        muni: x.muni ?? null,
        percent_reporting: x.pr ?? null
      }))
      .sort((a, b) => a.id - b.id);
  } catch (e) {
    console.warn(`::warning::Previous dataset fallback failed: ${e.message}`);
    return [];
  }
};

let races = [];
let source = 'search';
try {
  const all = await search();
  races = select(all);
  console.log(`Selected ${races.length} races of ${all.length} returned by search.`);
} catch (e) {
  console.warn(`::warning::race/search unavailable (${e.message}); falling back to last published race list.`);
  source = 'previous';
  races = await fromPrevious();
  console.log(`Fallback manifest has ${races.length} races.`);
}

await mkdir('data', { recursive: true });
await writeFile('data/manifest.json', JSON.stringify({ updated: new Date().toISOString(), day: DAY, source, races }, null, 2) + '\n');
console.log(`Wrote data/manifest.json (${races.length} races, source=${source}).`);

if (!races.length) {
  console.error('::error::No races discovered and no previous dataset available.');
  process.exit(1);
}
