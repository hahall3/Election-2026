import React, { useState, useEffect, useMemo } from 'react';
import RaceCard from './components/RaceCard';
import KentuckyHeatmap from './components/KentuckyHeatmap';

export default function App() {
  const [allRaces, setAllRaces] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // Interactive Filter States
  const [activeTab, setActiveTab] = useState('ALL_KY'); // 'ALL_KY', 'FEDERAL', 'LOCAL_KY'
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCounty, setSelectedCounty] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const RACES_PER_PAGE = 20;

  useEffect(() => {
    fetch('/data/races.json')
      .then((res) => res.json())
      .then((data) => {
        setAllRaces(data.races || []);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to load election data:', err);
        setLoading(false);
      });
  }, []);

  // 1. Featured Top Race: KY-06 House Race
  const ky6Race = useMemo(() => {
    return allRaces.find(
      (r) =>
        (r.isKentucky || String(r.state).toUpperCase() === 'KY') &&
        (String(r.district) === '6' || String(r.name).includes('District 6') || String(r.name).includes('6th')) &&
        (r.category === 'U.S. House' || String(r.name).toLowerCase().includes('house'))
    );
  }, [allRaces]);

  // 2. Filter Races based on User Selections
  const filteredRaces = useMemo(() => {
    return allRaces.filter((r) => {
      const isKY = r.isKentucky || String(r.state).toUpperCase() === 'KY' || String(r.name).toLowerCase().includes('kentucky');
      
      // Category Tab Filter
      if (activeTab === 'ALL_KY' && !isKY) return false;
      if (activeTab === 'FEDERAL' && !['U.S. Senate', 'U.S. House', 'Governor'].includes(r.category)) return false;
      if (activeTab === 'LOCAL_KY' && (!isKY || ['U.S. Senate', 'U.S. House', 'Governor'].includes(r.category))) return false;

      // County Filter from Heatmap
      if (selectedCounty) {
        const hasCounty = (r.regions || []).some((reg) => 
          String(reg.name).toLowerCase().includes(selectedCounty.toLowerCase())
        );
        if (!hasCounty && !String(r.muni || '').toLowerCase().includes(selectedCounty.toLowerCase())) {
          return false;
        }
      }

      // Search Query Filter
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        const matchName = String(r.name || '').toLowerCase().includes(query);
        const matchCategory = String(r.category || '').toLowerCase().includes(query);
        const matchCandidate = (r.cands || []).some((c) => String(c.n || '').toLowerCase().includes(query));
        if (!matchName && !matchCategory && !matchCandidate) return false;
      }

      return true;
    });
  }, [allRaces, activeTab, selectedCounty, searchQuery]);

  // Reset pagination when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [activeTab, searchQuery, selectedCounty]);

  // Paginated Slicing
  const paginatedRaces = useMemo(() => {
    const start = (currentPage - 1) * RACES_PER_PAGE;
    return filteredRaces.slice(start, start + RACES_PER_PAGE);
  }, [filteredRaces, currentPage]);

  const totalPages = Math.ceil(filteredRaces.length / RACES_PER_PAGE);

  if (loading) {
    return <div style={{ textAlign: 'center', padding: '40px' }}>Loading 2026 Kentucky & Federal Election Data...</div>;
  }

  return (
    <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '20px', fontFamily: 'system-ui, sans-serif' }}>
      
      {/* Header */}
      <header style={{ marginBottom: '24px' }}>
        <h1 style={{ margin: 0, fontSize: '2rem' }}>2026 Election Night Live Dashboard</h1>
        <p style={{ color: '#666', marginTop: '4px' }}>
          Showing {filteredRaces.length} total matched races
        </p>
      </header>

      {/* FEATURED RACE: KY-06 */}
      {ky6Race && (
        <section style={{ marginBottom: '28px' }}>
          <div style={{ border: '2px solid #0056b3', borderRadius: '8px', padding: '20px', backgroundColor: '#f0f7ff' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <span style={{ fontSize: '0.8rem', fontWeight: 'bold', textTransform: 'uppercase', color: '#0056b3' }}>
                  ★ Featured Key Race
                </span>
                <h2 style={{ margin: '4px 0 0 0', fontSize: '1.4rem' }}>Kentucky 6th Congressional District (KY-06)</h2>
              </div>
              <span style={{ backgroundColor: ky6Race.isCalled ? '#28a745' : '#ffc107', color: ky6Race.isCalled ? '#fff' : '#000', padding: '6px 12px', borderRadius: '20px', fontWeight: 'bold' }}>
                {ky6Race.isCalled ? 'Race Called' : `${ky6Race.pr || 0}% Reporting`}
              </span>
            </div>

            <div style={{ marginTop: '16px' }}>
              {(ky6Race.cands || []).map((c, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '6px 0', borderBottom: '1px solid #d0e1f9' }}>
                  <span style={{ fontWeight: c.w ? 'bold' : 'normal' }}>
                    {c.n} <span style={{ color: '#555' }}>({c.p || 'IND'})</span> {c.w && '✓ Winner'}
                  </span>
                  <span style={{ fontWeight: c.w ? 'bold' : 'normal' }}>
                    {c.v != null ? c.v.toLocaleString() : 0} votes ({c.pc != null ? c.pc.toFixed(1) : '0.0'}%)
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* KENTUCKY COUNTY HEATMAP */}
      <section style={{ marginBottom: '32px' }}>
        <KentuckyHeatmap 
          races={allRaces} 
          selectedCounty={selectedCounty} 
          onSelectCounty={(county) => setSelectedCounty(selectedCounty === county ? '' : county)} 
        />
      </section>

      {/* INTERACTIVE CONTROLS AND TAB FILTERS */}
      <section style={{ marginBottom: '24px', backgroundColor: '#fff', padding: '16px', borderRadius: '8px', border: '1px solid #e0e0e0' }}>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center' }}>
          
          {/* Category Tabs */}
          <div style={{ display: 'flex', gap: '8px' }}>
            <button
              onClick={() => setActiveTab('ALL_KY')}
              style={{ padding: '8px 16px', borderRadius: '4px', border: 'none', cursor: 'pointer', fontWeight: 'bold', backgroundColor: activeTab === 'ALL_KY' ? '#0056b3' : '#e9ecef', color: activeTab === 'ALL_KY' ? '#fff' : '#333' }}
            >
              All Kentucky Races (Federal + Local)
            </button>
            <button
              onClick={() => setActiveTab('FEDERAL')}
              style={{ padding: '8px 16px', borderRadius: '4px', border: 'none', cursor: 'pointer', fontWeight: 'bold', backgroundColor: activeTab === 'FEDERAL' ? '#0056b3' : '#e9ecef', color: activeTab === 'FEDERAL' ? '#fff' : '#333' }}
            >
              U.S. Senate & House
            </button>
            <button
              onClick={() => setActiveTab('LOCAL_KY')}
              style={{ padding: '8px 16px', borderRadius: '4px', border: 'none', cursor: 'pointer', fontWeight: 'bold', backgroundColor: activeTab === 'LOCAL_KY' ? '#0056b3' : '#e9ecef', color: activeTab === 'LOCAL_KY' ? '#fff' : '#333' }}
            >
              KY County & Local Only
            </button>
          </div>

          {/* Search Input & County Reset */}
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
            {selectedCounty && (
              <span style={{ backgroundColor: '#28a745', color: '#fff', padding: '6px 12px', borderRadius: '4px', fontSize: '0.9rem' }}>
                County: {selectedCounty} <button onClick={() => setSelectedCounty('')} style={{ background: 'none', border: 'none', color: '#fff', cursor: 'pointer', fontWeight: 'bold' }}>✕</button>
              </span>
            )}
            <input
              type="text"
              placeholder="Search candidate, race or county..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ padding: '8px 12px', borderRadius: '4px', border: '1px solid #ccc', minWidth: '240px' }}
            />
          </div>
        </div>
      </section>

      {/* RACE RESULTS GRID */}
      <section style={{ marginBottom: '32px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '16px' }}>
          {paginatedRaces.length > 0 ? (
            paginatedRaces.map((r) => <RaceCard key={r.id} race={r} />)
          ) : (
            <div style={{ gridColumn: '1 / -1', padding: '30px', textAlign: 'center', color: '#666' }}>
              No races match your selected filters. Try clearing search or selected county.
            </div>
          )}
        </div>
      </section>

      {/* PAGINATION CONTROLS */}
      {totalPages > 1 && (
        <div style={{ display: 'flex', justifyContent: 'center', gap: '8px', alignItems: 'center', marginTop: '24px' }}>
          <button
            disabled={currentPage === 1}
            onClick={() => setCurrentPage((p) => p - 1)}
            style={{ padding: '8px 16px', borderRadius: '4px', border: '1px solid #ccc', cursor: currentPage === 1 ? 'not-allowed' : 'pointer' }}
          >
            Previous
          </button>
          <span>
            Page {currentPage} of {totalPages}
          </span>
          <button
            disabled={currentPage === totalPages}
            onClick={() => setCurrentPage((p) => p + 1)}
            style={{ padding: '8px 16px', borderRadius: '4px', border: '1px solid #ccc', cursor: currentPage === totalPages ? 'not-allowed' : 'pointer' }}
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}
