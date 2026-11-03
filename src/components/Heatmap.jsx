import React from 'react';

// Safely computes heatmap color without throwing NaN/undefined errors
const getReportingColor = (reportingPct) => {
  const pct = Number(reportingPct ?? 0);
  if (pct === 0) return '#e0e0e0'; // Gray (Unreported / 0%)
  if (pct < 25) return '#ffeb3b';  // Yellow (< 25%)
  if (pct < 75) return '#ff9800';  // Orange (25% - 75%)
  return '#4caf50';                // Green (> 75%)
};

export default function Heatmap({ races }) {
  // Aggregate reporting percentages by county / state region safely
  const regionStats = (races || []).reduce((acc, race) => {
    const regions = race.regions || [];
    regions.forEach((reg) => {
      const regionName = reg.name || 'Unknown';
      const reporting = Number(reg.rep ?? reg.percent_reporting ?? race.pr ?? 0);
      if (!acc[regionName]) {
        acc[regionName] = { totalReporting: 0, count: 0 };
      }
      acc[regionName].totalReporting += reporting;
      acc[regionName].count += 1;
    });
    return acc;
  }, {});

  const regionsList = Object.keys(regionStats).map((name) => {
    const stat = regionStats[name];
    const avgReporting = stat.count > 0 ? stat.totalReporting / stat.count : 0;
    return { name, reporting: avgReporting };
  });

  return (
    <div className="heatmap-container" style={{ padding: '16px', backgroundColor: '#fff', borderRadius: '8px', border: '1px solid #ddd' }}>
      <div style={{ display: 'flex', gap: '12px', flexWrap: 'wrap' }}>
        {regionsList.length > 0 ? (
          regionsList.slice(0, 30).map((r, i) => (
            <div
              key={i}
              style={{
                padding: '8px 12px',
                borderRadius: '4px',
                backgroundColor: getReportingColor(r.reporting),
                color: r.reporting > 50 ? '#fff' : '#000',
                fontSize: '0.85rem',
                fontWeight: '600'
              }}
            >
              {r.name}: {r.reporting.toFixed(0)}%
            </div>
          ))
        ) : (
          <p style={{ color: '#666', margin: 0 }}>Map regions pending incoming votes...</p>
        )}
      </div>
    </div>
  );
}
