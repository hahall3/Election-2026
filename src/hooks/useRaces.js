// Election 2026 Initiative — live data hook.
// Polls data/races.json, defeats the GitHub Pages CDN cache (max-age=600),
// and only swaps state when the dataset's `updated` stamp changes.
import { useCallback, useEffect, useRef, useState } from 'react';

const POLL_MS = 60_000;
const DATA_URL = `${import.meta.env.BASE_URL}data/races.json`;

export default function useRaces() {
  const [races, setRaces] = useState([]);
  const [updated, setUpdated] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const lastStamp = useRef(null);
  const inFlight = useRef(null);

  const load = useCallback(async () => {
    inFlight.current?.abort();
    const ctrl = new AbortController();
    inFlight.current = ctrl;
    try {
      const res = await fetch(`${DATA_URL}?t=${Date.now()}`, { cache: 'no-store', signal: ctrl.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${DATA_URL}`);
      const json = await res.json();
      if (json.updated !== lastStamp.current) {
        lastStamp.current = json.updated;
        setRaces(Array.isArray(json.races) ? json.races : []);
        setUpdated(json.updated ?? null);
      }
      setError(null);
    } catch (e) {
      if (e.name !== 'AbortError') setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') load();
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      inFlight.current?.abort();
    };
  }, [load]);

  return { races, updated, error, loading, refresh: load };
}
