// Pulls Kentucky races for ELECTION_DAY from civicAPI and writes data/races.json (Node 18+, no deps).
import { writeFile, mkdir } from 'node:fs/promises';
const BASE = process.env.CIVIC_BASE || 'https://civicapi.org/api/v2/';
const DAY = process.env.ELECTION_DAY || '2026-11-03';
// Same include rules as the Power BI "Results" query (a race is kept if it matches ANY rule)
const KEYWORDS = ['president','senate','governor','attorney general','secretary of state','u.s. house','congress'];
const TYPES = ['state house','state senate'];
const DISTRICTS = ['fayette','clark'];
const MUNIS = ['lexington','winchester'];
const H = { 'User-Agent': 'Mozilla/5.0', Accept: 'application/json' };
const get = async (p) => { const r = await fetch(BASE + p, { headers: H }); if (!r.ok) throw new Error(r.status + ' ' + p); return r.json(); };
const list = (x) => x == null ? [] : Array.isArray(x) ? x : typeof x === 'object' ? Object.values(x) : [];
const num = (v) => { if (v == null) return null; if (typeof v === 'number') return v; const n = Number(String(v).replace(/[,%\s]/g, '')); return Number.isNaN(n) ? null : n; };
const low = (x) => String(x ?? '').toLowerCase();
const any = (t, terms) => terms.some((k) => t.includes(k));

const q = new URLSearchParams({ startDate: DAY, endDate: DAY, country: 'US', province: 'KY', limit: '50000' });
const raw = await get('race/search?' + q);
const all = Array.isArray(raw) ? raw : list(Object.values(raw).find(Array.isArray));
const picked = all.filter((r) => String(r.election_date ?? '').slice(0, 10) === DAY).filter((r) =>
  any(low(r.election_name), KEYWORDS) || any(low(r.type ?? r.election_type), TYPES) || any(low(r.election_name), TYPES) ||
  any(low(r.district), DISTRICTS) || any(low(r.municipality), MUNIS));
console.log(`search: ${all.length} races, ${picked.length} selected`);

const mc = (c) => ({ n: c.name, p: c.party, w: !!c.winner, col: c.color, v: num(c.votes), pc: num(c.percent) });
const one = async (m) => {
  const d = await get('race/' + m.id);
  const regions = list(d.region_results).map((r) => {
    const g = Array.isArray(r.region) ? r.region[0] : r.region || {};
    return { name: g.name, type: g.type, rep: num(g.percent_reporting), c: list(r.candidates).map(mc) };
  });
  let cands = list(d.candidates).map(mc);
  if (!cands.length) { // fall back to summing counties
    const t = {}; regions.forEach((g) => g.c.forEach((c) => { (t[c.n] ??= { ...c, v: 0 }).v += c.v || 0; }));
    cands = Object.values(t);
  }
  return { id: Number(m.id), name: m.election_name, type: m.type ?? m.election_type, district: m.district, muni: m.municipality,
    pr: num(d.percent_reporting ?? m.percent_reporting), reg: num(d.registered_voters), map: String(m.has_map) === 'true', cands, regions };
};

const races = []; let failed = 0, i = 0;
await Promise.all(Array.from({ length: 8 }, async () => {
  while (i < picked.length) { const m = picked[i++]; try { races.push(await one(m)); } catch (e) { failed++; console.warn('skip', m.id, e.message); } }
}));
if (!races.length) { console.error('No races fetched; leaving data/races.json untouched'); process.exit(1); }
races.sort((a, b) => a.id - b.id);
await mkdir('data', { recursive: true });
await writeFile('data/races.json', JSON.stringify({ updated: new Date().toISOString(), day: DAY, failed, races }));
console.log(`wrote ${races.length} races (${failed} failed)`);
