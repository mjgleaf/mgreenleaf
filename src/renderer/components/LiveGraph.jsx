import { useState, useEffect, useMemo } from 'react';
import {
    LineChart,
    Line as ReLine,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip as ReTooltip,
    Legend as ReLegend,
    ResponsiveContainer,
    Brush,
    ReferenceLine
} from 'recharts';

const colors = ['#3fb950', '#2188ff', '#f85149', '#dbab09', '#8957e5', '#f0883e', '#1f6feb', '#238636', '#fa4549', '#e3b341'];
const MAX_CHART_POINTS = 500;

function LiveGraph({ data, activeTags, companyName, jobNumber, displayUnit = 'lbs', onUnitChange, xUnit, onXUnitChange }) {
    const [viewMode, setViewMode] = useState('auto');
    const [fixedDuration, setFixedDuration] = useState(120);
    const [yZoom, setYZoom] = useState([0, 'auto']);
    const [targetLoad, setTargetLoad] = useState('');
    const [wll, setWll] = useState('');
    const [streamSettings, setStreamSettings] = useState({});

    useEffect(() => {
        setStreamSettings(prev => {
            const next = { ...prev };
            activeTags.forEach((tag, i) => {
                if (tag && !next[tag]) {
                    next[tag] = {
                        color: colors[i % colors.length],
                        dashed: false
                    };
                }
            });
            return next;
        });
    }, [activeTags]);

    const handleSettingChange = (tag, key, value) => {
        setStreamSettings(prev => ({
            ...prev,
            [tag]: { ...prev[tag], [key]: value }
        }));
    };

    const chartData = useMemo(() => {
        if (!data || data.length === 0) return [];

        const grouped = [];
        let currentBucket = null;
        const bucketSize = 250;
        const lastKnown = {}; // Track last known value per tag

        const unitFactor = displayUnit === 'tons' ? 1 / 2000 : 1;
        const timeFactor = xUnit === 'hour' ? 1 / 3600000 : 1 / 60000;

        data.forEach(point => {
            const tag = point.Tag || point.tag;
            if (!tag) return;
            const val = point.value * unitFactor;
            lastKnown[tag] = val;

            const time = Math.floor(point["Elapsed (ms)"] / bucketSize) * bucketSize;
            if (!currentBucket || currentBucket._bucketTime !== time) {
                // New bucket — carry forward all last known values
                currentBucket = { elapsed: (point["Elapsed (ms)"] * timeFactor), _bucketTime: time };
                Object.keys(lastKnown).forEach(t => {
                    currentBucket[t] = lastKnown[t];
                });
                grouped.push(currentBucket);
            }
            currentBucket[tag] = val;
        });

        // Remove internal _bucketTime key
        grouped.forEach(b => delete b._bucketTime);

        if (grouped.length <= MAX_CHART_POINTS) return grouped;
        const step = Math.ceil(grouped.length / MAX_CHART_POINTS);
        const downsampled = [];
        for (let i = 0; i < grouped.length; i += step) {
            downsampled.push(grouped[i]);
        }
        return downsampled;
    }, [data, displayUnit, xUnit]);

    return (
        <div className="live-graph-container" style={{ background: 'var(--bg-card)', padding: '20px', borderRadius: '10px', border: '1px solid var(--border)', marginTop: '20px' }}>
            <div className="graph-controls" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '15px', alignItems: 'center' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                    <h4 style={{ margin: 0, color: 'var(--yellow-accent)' }}>Live Load Visualization</h4>
                    <div style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                        {companyName || 'Unknown Company'} | {jobNumber || 'No Job #'}
                    </div>
                </div>
                <div style={{ display: 'flex', gap: '15px', alignItems: 'center', fontSize: '0.8rem' }}>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', borderRight: '1px solid var(--border)', paddingRight: '15px' }}>
                        <span style={{ color: 'var(--text-secondary)' }}>Unit:</span>
                        <select
                            value={displayUnit}
                            onChange={e => onUnitChange && onUnitChange(e.target.value)}
                            style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)', color: 'var(--yellow-accent)', padding: '2px 5px', fontWeight: 'bold' }}
                        >
                            <option value="lbs">lbs</option>
                            <option value="tons">tons</option>
                        </select>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', borderRight: '1px solid var(--border)', paddingRight: '15px' }}>
                        <select
                            value={xUnit}
                            onChange={e => onXUnitChange && onXUnitChange(e.target.value)}
                            style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)', color: 'var(--yellow-accent)', padding: '2px 5px', fontWeight: 'bold' }}
                        >
                            <option value="min">Minutes</option>
                            <option value="hour">Hours</option>
                        </select>
                    </div>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', borderRight: '1px solid var(--border)', paddingRight: '15px' }}>
                        <select
                            value={viewMode}
                            onChange={e => setViewMode(e.target.value)}
                            style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)', color: 'white', padding: '2px 5px' }}
                        >
                            <option value="auto">Auto-Scale</option>
                            <option value="fixed">Fixed-Scope</option>
                        </select>
                        {viewMode === 'fixed' && (
                            <>
                                <span>Duration ({xUnit}):</span>
                                <input type="number" value={fixedDuration} onChange={e => setFixedDuration(parseInt(e.target.value) || 1)} style={{ width: '50px', background: 'var(--bg-dark)', border: '1px solid var(--border)', color: 'white', padding: '2px 5px' }} />
                            </>
                        )}
                    </div>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center', borderRight: '1px solid var(--border)', paddingRight: '15px', marginRight: '5px' }}>
                        <span>Target:</span>
                        <input type="number" value={targetLoad} onChange={e => setTargetLoad(e.target.value)} placeholder={displayUnit} style={{ width: '70px', background: 'var(--bg-dark)', border: '1px solid var(--border)', color: 'var(--yellow-accent)', padding: '2px 5px' }} />
                        <span>WLL:</span>
                        <input type="number" value={wll} onChange={e => setWll(e.target.value)} placeholder={displayUnit} style={{ width: '70px', background: 'var(--bg-dark)', border: '1px solid var(--border)', color: '#ff4444', padding: '2px 5px' }} />
                    </div>
                    <span>Y-Axis Min:</span>
                    <input type="number" value={yZoom[0]} onChange={e => setYZoom([parseFloat(e.target.value) || 0, yZoom[1]])} style={{ width: '60px', background: 'var(--bg-dark)', border: '1px solid var(--border)', color: 'white', padding: '2px 5px' }} />
                    <span>Max:</span>
                    <input type="text" value={yZoom[1]} onChange={e => setYZoom([yZoom[0], e.target.value === 'auto' ? 'auto' : (parseFloat(e.target.value) || 'auto')])} style={{ width: '60px', background: 'var(--bg-dark)', border: '1px solid var(--border)', color: 'white', padding: '2px 5px' }} />
                </div>
            </div>

            <div style={{ width: '100%' }}>
                <ResponsiveContainer width="100%" height={400} minWidth={0}>
                    <LineChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.1)" />
                        <XAxis
                            dataKey="elapsed"
                            type="number"
                            domain={viewMode === 'fixed' ? [0, fixedDuration] : ['auto', 'auto']}
                            stroke="var(--text-secondary)"
                            label={{ value: `Time (${xUnit})`, position: 'insideBottom', offset: -5, fill: 'var(--text-secondary)' }}
                            tickFormatter={(v) => v.toFixed(2)}
                        />
                        <YAxis
                            domain={viewMode === 'fixed' ? [0, Math.max(parseFloat(targetLoad) || 0, parseFloat(wll) || 0) * 1.1 || 'auto'] : yZoom}
                            stroke="var(--text-secondary)"
                            label={{ value: `Load (${displayUnit})`, angle: -90, position: 'insideLeft', fill: 'var(--text-secondary)' }}
                        />
                        <ReTooltip
                            contentStyle={{ background: 'var(--bg-card)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                            itemStyle={{ fontSize: '0.8rem' }}
                            formatter={(value) => [typeof value === 'number' ? value.toFixed(displayUnit === 'tons' ? 3 : 2) : value, `Load (${displayUnit})`]}
                            labelFormatter={(label) => `Time: ${label.toFixed(2)} ${xUnit}`}
                        />
                        <ReLegend />

                        {!isNaN(parseFloat(targetLoad)) && (
                            <ReferenceLine
                                y={parseFloat(targetLoad)}
                                stroke="var(--yellow-accent)"
                                strokeDasharray="5 5"
                                label={{ value: 'Target', position: 'right', fill: 'var(--yellow-accent)', fontSize: 10 }}
                            />
                        )}
                        {!isNaN(parseFloat(wll)) && (
                            <ReferenceLine
                                y={parseFloat(wll)}
                                stroke="#ff4444"
                                strokeDasharray="3 3"
                                label={{ value: 'WLL', position: 'right', fill: '#ff4444', fontSize: 10 }}
                            />
                        )}

                        {activeTags.map((tag, i) => {
                            if (!tag) return null;
                            const defaultDash = ['0', '8 3', '3 3'][i % 3]; // solid, dashed, dotted
                            const defaultWidth = [2.5, 2, 1.5][i % 3];
                            return (
                            <ReLine
                                key={tag}
                                type="monotone"
                                dataKey={tag}
                                name={`Cell ${tag}`}
                                stroke={streamSettings[tag]?.color || colors[i % colors.length]}
                                strokeDasharray={streamSettings[tag]?.dashed ? "5 5" : defaultDash}
                                strokeWidth={defaultWidth}
                                dot={false}
                                animationDuration={300}
                                isAnimationActive={false}
                            />
                            );
                        })}
                        {viewMode === 'auto' && chartData.length > 2 && <Brush dataKey="elapsed" height={30} stroke="var(--accent-hover)" fill="var(--bg-dark)" tickFormatter={(v) => v.toFixed(2)} />}
                    </LineChart>
                </ResponsiveContainer>
            </div>

            <div className="stream-customizer" style={{ display: 'flex', flexWrap: 'wrap', gap: '20px', marginTop: '15px', borderTop: '1px solid var(--border)', paddingTop: '15px' }}>
                {activeTags.map((tag, i) => tag && (
                    <div key={tag} style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.8rem' }}>
                        <span style={{ fontWeight: 'bold' }}>Cell {tag}:</span>
                        <input
                            type="color"
                            value={streamSettings[tag]?.color || colors[i % colors.length]}
                            onChange={e => handleSettingChange(tag, 'color', e.target.value)}
                            style={{ width: '25px', height: '25px', border: 'none', background: 'none', cursor: 'pointer' }}
                        />
                        <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                            <input
                                type="checkbox"
                                checked={streamSettings[tag]?.dashed || false}
                                onChange={e => handleSettingChange(tag, 'dashed', e.target.checked)}
                            />
                            Dashed
                        </label>
                    </div>
                ))}
            </div>
        </div>
    );
}

export default LiveGraph;
