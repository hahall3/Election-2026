import React, { useState, useEffect, useMemo } from 'react';
import RaceCard from './components/RaceCard';
import KentuckyHeatmap from './components/KentuckyHeatmap';

// Complete Alphabetical List of Kentucky's 120 Counties
const KY_COUNTIES = [
  'Adair', 'Allen', 'Anderson', 'Ballard', 'Barren', 'Bath', 'Bell', 'Boone', 'Bourbon', 'Boyd',
  'Boyle', 'Bracken', 'Breathitt', 'Breckinridge', 'Bullitt', 'Butler', 'Caldwell', 'Calloway', 'Campbell', 'Carlisle',
  'Carroll', 'Carter', 'Casey', 'Christian', 'Clark', 'Clay', 'Clinton', 'Crittenden', 'Cumberland', 'Daviess',
  'Edmonson', 'Elliott', 'Estill', 'Fayette', 'Fleming', 'Floyd', 'Franklin', 'Fulton', 'Gallatin', 'Garrard',
  'Grant', 'Graves', 'Grayson', 'Green', 'Greenup', 'Hancock', 'Hardin', 'Harlan', 'Harrison', 'Hart',
  'Henderson', 'Henry', 'Hickman', 'Hopkins', 'Jackson', 'Jefferson', 'Jessamine', 'Johnson', 'Kenton', 'Knott',
  'Knox', 'Larue', 'Laurel', 'Lawrence', 'Lee', 'Leslie', 'Letcher', 'Lewis', 'Lincoln', 'Livingston',
  'Logan', 'Lyon', 'McCracken', 'McCreary', 'McLean', 'Madison', 'Magoffin', 'Marion', 'Marshall', 'Martin',
  'Mason', 'Meade', 'Menifee', 'Mercer', 'Metcalfe', 'Monroe', 'Montgomery', 'Morgan', 'Muhlenberg', 'Nelson',
  'Nicholas', 'Ohio', 'Oldham', 'Owen', 'Owsley', 'Pendleton', 'Perry', 'Pike', 'Powell', 'Pulaski',
  'Robertson', 'Rockcastle', 'Rowan', 'Russell', 'Scott', 'Shelby', 'Simpson', 'Spencer', 'Taylor', 'Todd',
  'Trigg', 'Trimble', 'Union', 'Warren', 'Washington', 'Wayne', 'Webster', 'Whitley', 'Wolfe', 'Woodford'
];

export default function App() {
  const [allRaces, setAllRaces] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // Interactive Filter States
  const [activeTab, setActiveTab] = useState('ALL_KY'); // 'ALL_KY', 'SENATE', 'HOUSE', 'LOCAL_KY'
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

  // 1. Featured Top Race: Kentucky 6th Congressional District (KY-06)
  const ky6Race = useMemo(() => {
    return allRaces.find((r) => {
      const name = String(r.name || '').toLowerCase();
      const state = String(r.state || '').toUpperCase();
      const dist = String(r.district || '');

      const isKY = r.isKentucky || state === 'KY' || name.includes('kentucky');
      const isDistrict6 = dist === '6' || name.includes('district 6') || name.includes('6th');
      const isHouse = r.category === 'U.S. House' || name.includes('house') || name.includes('congress');

      return isKY && isDistrict6 && isHouse;
    });
  }, [allRaces]);

  // 2. Filter Races based on User Selections
  const filteredRaces = useMemo(() => {
    return allRaces.filter((r) => {
      const isKY = r.isKentucky || String(r.state).toUpperCase() === 'KY' || String(r.name).toLowerCase().includes('kentucky');
      const cat = String(r.category || '');
      const name = String(r.name || '').toLowerCase();

      // Category Tab Filter
      if (activeTab === 'ALL_KY' && !isKY) return false;
      if (activeTab === 'SENATE' && !cat.includes('Senate') && !name.includes('senate')) return false;
      if (activeTab === 'HOUSE' && !cat.includes('House') && !name.includes('house') && !name.includes('congress')) return false;
      if (activeTab === 'LOCAL_KY' && (!isKY || cat.includes('Senate') || cat.includes('House') || cat === 'Governor')) return false;

      // County Filter from Dropdown or Heatmap
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

      {/* FEATURED TOP CARD: KY-06 */}
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

      {/* CATEGORY TABS & CONTROLS BAR */}
      <section style={{ marginBottom: '24px', backgroundColor: '#fff', padding: '16px', borderRadius: '8px', border: '1px solid #e0e0e0' }}>
        <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center' }}>
          
          {/* Tabs */}
          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
            <button
              onClick={() => setActiveTab('ALL_KY')}
              style={{ padding: '8px 16px', borderRadius: '4px', border: 'none', cursor: 'pointer', fontWeight: 'bold', backgroundColor: activeTab === 'ALL_KY' ? '#0056b3' : '#e9ecef', color: activeTab === 'ALL_KY' ? '#fff' : '#333' }}
            >
              All Kentucky Races
            </button>
            <button
              onClick={() => setActiveTab('SENATE')}
              style={{ padding: '8px 16px', borderRadius: '4px', border: 'none', cursor: 'pointer', fontWeight: 'bold', backgroundColor: activeTab === 'SENATE' ? '#0056b3' : '#e9ecef', color: activeTab === 'SENATE' ? '#fff' : '#333' }}
            >
              U.S. Senate
            </button>
            <button
              onClick={() => setActiveTab('HOUSE')}
              style={{ padding: '8px 16px', borderRadius: '4px', border: 'none', cursor: 'pointer', fontWeight: 'bold', backgroundColor: activeTab === 'HOUSE' ? '#0056b3' : '#e9ecef', color: activeTab === 'HOUSE' ? '#fff' : '#333' }}
            >
              U.S. House
            </button>
            <button
              onClick={() => setActiveTab('LOCAL_KY')}
              style={{ padding: '8px 16px', borderRadius: '4px', border: 'none', cursor: 'pointer', fontWeight: 'bold', backgroundColor: activeTab === 'LOCAL_KY' ? '#0056b3' : '#e9ecef', color: activeTab === 'LOCAL_KY' ? '#fff' : '#333' }}
            >
              KY Local Only
            </button>
          </div>

          {/* County Dropdown Selector + Text Search */}
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
            
            {/* Explicit County Dropdown Selector */}
            <select
              value={selectedCounty}
              onChange={(e) => setSelectedCounty(e.target.value)}
              style={{ padding: '8px 12px', borderRadius: '4px', border: '1px solid #ccc', backgroundColor: '#fff', fontSize: '0.9rem', cursor: 'pointer' }}
            >
              <option value="">All Counties (KY)</option>
              {KY_COUNTIES.map((county) => (
                <option key={county} value={county}>
                  {county} County
                </option>
              ))}
            </select>

            {/* Clear County Indicator if Selected */}
            {selectedCounty && (
              <button
                onClick={() => setSelectedCounty('')}
                style={{ padding: '8px 10px', borderRadius: '4px', border: 'none', backgroundColor: '#dc3545', color: '#fff', cursor: 'pointer', fontSize: '0.85rem', fontWeight: 'bold' }}
                title="Clear county filter"
              >
                Clear County ✕
              </button>
            )}

            {/* Keyword Search Input */}
            <input
              type="text"
              placeholder="Search candidate or race..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{ padding: '8px 12px', borderRadius: '4px', border: '1px solid #ccc', minWidth: '220px' }}
            />
          </div>
        </div>
      </section>

      {/* SECTION HEADER (CLEAN TITLES) */}
      <section style={{ marginBottom: '16px' }}>
        <h2 style={{ fontSize: '1.5rem', margin: '0 0 16px 0' }}>
          {activeTab === 'SENATE' ? 'U.S. Senate' : activeTab === 'HOUSE' ? 'U.S. House' : activeTab === 'LOCAL_KY' ? 'Kentucky Local Elections' : 'All Kentucky Elections'}
          {selectedCounty ? ` — ${selectedCounty} County` : ''}
        </h2>
      </section>

      {/* RACE RESULTS GRID */}
      <section style={{ marginBottom: '32px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: '16px' }}>
          {paginatedRaces.length > 0 ? (
            paginatedRaces.map((r) => <RaceCard key={r.id} race={r} />)
          ) : (
            <div style={{ gridColumn: '1 / -1', padding: '30px', textAlign: 'center', color: '#666' }}>
              No races match your selected county or search query.
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
