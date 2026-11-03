import React, { useMemo } from 'react';

// Key Kentucky Counties for Heatmap Grid Representation
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

export default function KentuckyHeatmap({ races, selectedCounty, onSelectCounty }) {
  // Aggregate vote leaders by county across all county region data
  const countyData = useMemo(() => {
    const map = {};

    (races || []).forEach((race) => {
      (race.regions || []).forEach((reg) => {
        const name = reg.name?.replace(/ County$/i, '').trim();
        if (!name) return;

        if (!map[name]) {
          map[name] = { rep: 0, gopVotes: 0, demVotes: 0, totalVotes: 0 };
        }

        map[name].rep = Math.max(map[name].rep, reg.rep || 0);

        (reg.c || []).forEach((cand) => {
          const party = String(cand.p || '').toLowerCase();
          const votes = Number(cand.v || 0);
          map[name].totalVotes += votes;

          if (party.includes('rep') || party.includes('gop')) {
            map[name].gopVotes += votes;
          } else if (party.includes('dem')) {
            map[name].demVotes += votes;
          }
        });
      });
    });

    return map;
  }, [races]);

  const getCountyColor = (countyName) => {
    const data = countyData[countyName];
    if (!data || data.rep === 0 || data.totalVotes === 0) {
      return '#e0e6ed'; // 0% Reporting / Grey
    }
    if (data.gopVotes > data.demVotes) return '#dc3545'; // GOP Leader Red
    if (data.demVotes > data.gopVotes) return '#0d6efd'; // DEM Leader Blue
    return '#ffc107'; // Tied / Yellow
  };

  return (
    <div style={{ backgroundColor: '#fff', border: '1px solid #e0e0e0', borderRadius: '8px', padding: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
        <div>
          <h3 style={{ margin: 0, fontSize: '1.2rem' }}>Kentucky County Heatmap</h3>
          <span style={{ fontSize: '0.85rem', color: '#666' }}>Click any county tile to filter race cards below</span>
        </div>

        {/* Legend */}
        <div style={{ display: 'flex', gap: '16px', fontSize: '0.85rem', fontWeight: 'bold' }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '12px', height: '12px', backgroundColor: '#dc3545', borderRadius: '2px' }}></span> GOP Leader
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '12px', height: '12px', backgroundColor: '#0d6efd', borderRadius: '2px' }}></span> DEM Leader
          </span>
          <span style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span style={{ width: '12px', height: '12px', backgroundColor: '#e0e6ed', borderRadius: '2px' }}></span> 0% Reporting
          </span>
        </div>
      </div>

      {/* Grid Layout of Counties */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(85px, 1fr))', gap: '8px', maxHeight: '280px', overflowY: 'auto', paddingRight: '4px' }}>
        {KY_COUNTIES.map((county) => {
          const isSelected = selectedCounty.toLowerCase() === county.toLowerCase();
          const color = getCountyColor(county);

          return (
            <button
              key={county}
              onClick={() => onSelectCounty(county)}
              style={{
                backgroundColor: color,
                color: color === '#e0e6ed' ? '#333' : '#fff',
                border: isSelected ? '3px solid #000' : 'none',
                borderRadius: '4px',
                padding: '8px 4px',
                fontSize: '0.75rem',
                fontWeight: 'bold',
                cursor: 'pointer',
                textAlign: 'center',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                overflow: 'hidden'
              }}
              title={`${county} County (${countyData[county]?.rep || 0}% Reporting)`}
            >
              {county.toUpperCase().slice(0, 3)}
            </button>
          );
        })}
      </div>
    </div>
  );
}
