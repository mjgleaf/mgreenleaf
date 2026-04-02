import { useRef } from 'react';

/**
 * CustomerReport — Renders a branded one-page test report for the Customer Center.
 * This component is rendered off-screen, then captured as a PDF via printToPDF.
 */
function CustomerReport({ sessionName, loggedData, peakValues, activeTags, cellCount, duration, onClose, onSavePDF }) {
    const reportRef = useRef(null);

    if (!loggedData || loggedData.length === 0) return null;

    const firstTimestamp = loggedData[0].timestamp;
    const lastTimestamp = loggedData[loggedData.length - 1].timestamp;
    const durationMs = lastTimestamp - firstTimestamp;
    const durationMin = (durationMs / 60000).toFixed(1);
    const totalSamples = loggedData.length;

    // Compute per-cell stats
    const cellStats = {};
    activeTags.forEach(tag => {
        if (!tag) return;
        const tagData = loggedData.filter(d => d.Tag === tag);
        if (tagData.length === 0) return;
        const values = tagData.map(d => d.value);
        const avg = values.reduce((a, b) => a + b, 0) / values.length;
        const min = Math.min(...values);
        const max = Math.max(...values);
        const peak = peakValues[tag] || max;
        cellStats[tag] = { avg, min, max, peak, samples: tagData.length };
    });

    // Total load stats
    const totalLoads = [];
    const timeGroups = new Map();
    loggedData.forEach(d => {
        const elapsed = d['Elapsed (ms)'];
        if (!timeGroups.has(elapsed)) timeGroups.set(elapsed, {});
        timeGroups.get(elapsed)[d.Tag] = d.value;
    });
    timeGroups.forEach(group => {
        const total = Object.values(group).reduce((a, b) => a + b, 0);
        totalLoads.push(total);
    });
    const avgTotal = totalLoads.length > 0 ? totalLoads.reduce((a, b) => a + b, 0) / totalLoads.length : 0;
    const maxTotal = totalLoads.length > 0 ? Math.max(...totalLoads) : 0;

    const now = new Date();

    return (
        <div className="modal-overlay" style={{ zIndex: 9999 }}>
            <div style={{
                background: 'var(--bg-card)',
                borderRadius: 'var(--radius-lg)',
                maxWidth: 800,
                width: '95%',
                maxHeight: '90vh',
                overflowY: 'auto',
                padding: 30,
                position: 'relative'
            }}>
                <button onClick={onClose} className="action-btn secondary small"
                    style={{ position: 'absolute', top: 15, right: 15 }}>Close</button>

                <div ref={reportRef} style={{
                    background: 'white',
                    color: '#1a1a1a',
                    padding: '40px',
                    fontFamily: 'Arial, Helvetica, sans-serif',
                    fontSize: '12px',
                    lineHeight: 1.5,
                    borderRadius: 8
                }}>
                    {/* Header */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '3px solid #1d4280', paddingBottom: 15, marginBottom: 20 }}>
                        <div>
                            <h1 style={{ margin: 0, color: '#1d4280', fontSize: '22px', fontWeight: 800 }}>OSCAR</h1>
                            <div style={{ fontSize: '10px', color: '#666', marginTop: 2 }}>Operational Service & Certification Analysis Reporter</div>
                            <div style={{ fontSize: '11px', color: '#333', marginTop: 8, fontWeight: 600 }}>Hydro-Wates</div>
                            <div style={{ fontSize: '10px', color: '#666' }}>8100 Lockheed Ave. Houston, TX 77061</div>
                            <div style={{ fontSize: '10px', color: '#666' }}>(713) 643-9990 | mgreenleaf@hydrowates.com</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                            <div style={{ fontSize: '16px', fontWeight: 700, color: '#1d4280' }}>Load Test Report</div>
                            <div style={{ fontSize: '10px', color: '#666', marginTop: 4 }}>
                                Date: {now.toLocaleDateString()}<br />
                                Time: {now.toLocaleTimeString()}<br />
                                Report ID: RPT-{now.getFullYear()}-{String(now.getMonth() + 1).padStart(2, '0')}{String(now.getDate()).padStart(2, '0')}-{String(now.getHours()).padStart(2, '0')}{String(now.getMinutes()).padStart(2, '0')}
                            </div>
                        </div>
                    </div>

                    {/* Session Info */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px', marginBottom: 20 }}>
                        <div style={{ background: '#f8f9fa', padding: '10px 14px', borderRadius: 6, border: '1px solid #e9ecef' }}>
                            <div style={{ fontSize: '9px', color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Session Name</div>
                            <div style={{ fontSize: '13px', fontWeight: 700, color: '#333' }}>{sessionName || 'Unnamed Session'}</div>
                        </div>
                        <div style={{ background: '#f8f9fa', padding: '10px 14px', borderRadius: 6, border: '1px solid #e9ecef' }}>
                            <div style={{ fontSize: '9px', color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Duration</div>
                            <div style={{ fontSize: '13px', fontWeight: 700, color: '#333' }}>{durationMin} minutes</div>
                        </div>
                        <div style={{ background: '#f8f9fa', padding: '10px 14px', borderRadius: 6, border: '1px solid #e9ecef' }}>
                            <div style={{ fontSize: '9px', color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Total Samples</div>
                            <div style={{ fontSize: '13px', fontWeight: 700, color: '#333' }}>{totalSamples.toLocaleString()}</div>
                        </div>
                    </div>

                    {/* Load Cell Summary Table */}
                    <h3 style={{ fontSize: '13px', color: '#1d4280', margin: '20px 0 10px', borderBottom: '1px solid #dee2e6', paddingBottom: 6 }}>Load Cell Summary</h3>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                        <thead>
                            <tr style={{ background: '#1d4280', color: 'white' }}>
                                <th style={{ padding: '8px 10px', textAlign: 'left' }}>Cell Tag</th>
                                <th style={{ padding: '8px 10px', textAlign: 'right' }}>Average (lbs)</th>
                                <th style={{ padding: '8px 10px', textAlign: 'right' }}>Min (lbs)</th>
                                <th style={{ padding: '8px 10px', textAlign: 'right' }}>Max (lbs)</th>
                                <th style={{ padding: '8px 10px', textAlign: 'right' }}>Peak (lbs)</th>
                                <th style={{ padding: '8px 10px', textAlign: 'right' }}>Samples</th>
                            </tr>
                        </thead>
                        <tbody>
                            {Object.entries(cellStats).map(([tag, stats], idx) => (
                                <tr key={tag} style={{ background: idx % 2 === 0 ? '#f8f9fa' : 'white' }}>
                                    <td style={{ padding: '6px 10px', fontWeight: 600 }}>Cell {tag}</td>
                                    <td style={{ padding: '6px 10px', textAlign: 'right' }}>{stats.avg.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</td>
                                    <td style={{ padding: '6px 10px', textAlign: 'right' }}>{stats.min.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</td>
                                    <td style={{ padding: '6px 10px', textAlign: 'right' }}>{stats.max.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</td>
                                    <td style={{ padding: '6px 10px', textAlign: 'right', fontWeight: 700, color: '#c0392b' }}>{Math.abs(stats.peak).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</td>
                                    <td style={{ padding: '6px 10px', textAlign: 'right' }}>{stats.samples}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>

                    {/* Total Summary */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: 20 }}>
                        <div style={{ background: '#e8f4fd', padding: '14px', borderRadius: 6, border: '1px solid #bee5eb' }}>
                            <div style={{ fontSize: '9px', color: '#1d4280', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Average Total Load</div>
                            <div style={{ fontSize: '18px', fontWeight: 800, color: '#1d4280' }}>
                                {avgTotal.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} lbs
                            </div>
                            <div style={{ fontSize: '10px', color: '#666' }}>
                                {(avgTotal / 2000).toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })} short tons |{' '}
                                {(avgTotal * 0.00045359237).toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })} metric tons
                            </div>
                        </div>
                        <div style={{ background: '#fef3cd', padding: '14px', borderRadius: 6, border: '1px solid #ffc107' }}>
                            <div style={{ fontSize: '9px', color: '#856404', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Peak Total Load</div>
                            <div style={{ fontSize: '18px', fontWeight: 800, color: '#856404' }}>
                                {maxTotal.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} lbs
                            </div>
                            <div style={{ fontSize: '10px', color: '#666' }}>
                                {(maxTotal / 2000).toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })} short tons |{' '}
                                {(maxTotal * 0.00045359237).toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })} metric tons
                            </div>
                        </div>
                    </div>

                    {/* Footer */}
                    <div style={{ marginTop: 30, paddingTop: 15, borderTop: '1px solid #dee2e6', fontSize: '9px', color: '#999', display: 'flex', justifyContent: 'space-between' }}>
                        <div>Generated by OSCAR v1.0 | Hydro-Wates | www.hydrowates.com</div>
                        <div>This report is for reference only. Refer to the official certificate for certified results.</div>
                    </div>
                </div>

                <div style={{ display: 'flex', gap: 12, marginTop: 20, justifyContent: 'center' }}>
                    <button onClick={onSavePDF} className="action-btn large">Save as PDF</button>
                    <button onClick={onClose} className="action-btn secondary large">Cancel</button>
                </div>
            </div>
        </div>
    );
}

export default CustomerReport;
