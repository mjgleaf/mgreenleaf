import { useState, useMemo, useEffect, useRef } from 'react';
import Papa from 'papaparse';
import {
    Chart as ChartJS,
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend,
    Filler,
} from 'chart.js';
import { Line } from 'react-chartjs-2';
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
import logo from './logo.png';

ChartJS.register(
    CategoryScale,
    LinearScale,
    PointElement,
    LineElement,
    Title,
    Tooltip,
    Legend,
    Filler
);

// --- Error Boundary to catch rendering crashes ---
import React from 'react';
class ErrorBoundary extends React.Component {
    constructor(props) {
        super(props);
        this.state = { hasError: false, error: null };
    }
    static getDerivedStateFromError(error) {
        return { hasError: true, error };
    }
    componentDidCatch(error, info) {
        console.error('OSCAR Render Crash:', error, info?.componentStack);
    }
    render() {
        if (this.state.hasError) {
            return (
                <div style={{ padding: '30px', background: 'rgba(255,50,50,0.1)', border: '1px solid #f85149', borderRadius: '10px', margin: '20px' }}>
                    <h3 style={{ color: '#f85149' }}>⚠️ Component Crashed</h3>
                    <p style={{ color: '#ccc' }}>{this.state.error?.message || 'Unknown error'}</p>
                    <button
                        onClick={() => this.setState({ hasError: false, error: null })}
                        style={{ marginTop: '10px', padding: '8px 16px', background: 'var(--accent)', border: 'none', borderRadius: '6px', color: '#fff', cursor: 'pointer' }}
                    >
                        Try Again
                    </button>
                </div>
            );
        }
        return this.props.children;
    }
}

const processChartData = (data, serialLabels = [], displayUnit = 'lbs', displayTimeUnit = 'min', inputTimeUnit = null, xUnit = 'min') => {
    if (!data || data.length === 0) return null;

    try {
        const headers = Object.keys(data[0]);

        const parseNum = (v) => {
            if (typeof v === 'number') return v;
            if (!v) return 0;
            return parseFloat(v.toString().replace(/,/g, '')) || 0;
        };

        const timeToSec = (v) => {
            if (!v) return 0;
            const s = v.toString().trim();
            const m = s.match(/(\d{1,2}):(\d{2})(:(\d{2}))?/);
            if (m) {
                return parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + (m[4] ? parseInt(m[4], 10) : 0);
            }
            return parseNum(v);
        };

        let weightKeys = headers.filter(h => /pounds|lbs|weight|load|force/i.test(h));
        if (weightKeys.length > 1) {
            const hasTotal = weightKeys.some(h => /total/i.test(h));
            const hasIndividual = weightKeys.some(h => /hook|cell|channel|tag|pounds|lbs/i.test(h) && !/total/i.test(h));
            if (hasTotal && hasIndividual) {
                weightKeys = weightKeys.filter(h => !/total/i.test(h));
            }
        }
        if (weightKeys.length === 0) weightKeys.push(headers[1] || headers[0]);

        const timeKey = headers.find(h => /elapsed|second/i.test(h)) ||
            headers.find(h => /time|stamp/i.test(h)) ||
            headers[0];

        const isMs = /ms|millisecond/i.test(timeKey);
        const isMin = !isMs && /min/i.test(timeKey);
        const isHrs = !isMs && !isMin && /hour/i.test(timeKey);

        const times = data.map(d => {
            const val = timeToSec(d[timeKey]);
            // If explicit input unit is provided, use it; otherwise fall back to header detection
            const unit = inputTimeUnit || (isMs ? 'ms' : (isMin ? 'min' : (isHrs ? 'hrs' : 'sec')));

            if (unit === 'ms') return val / 1000;
            if (unit === 'min') return val * 60;
            if (unit === 'hrs') return val * 3600;
            return val; // assumed seconds
        });

        // Unit Conversion: Tonnes to LBS
        const getValInLbs = (row, key) => {
            const raw = parseNum(row[key]);
            const header = key.toLowerCase();
            if (header.includes('tonne') || header.includes('mt')) return raw * 2204.6;
            if (header.includes('ton')) return raw * 2000;
            return raw;
        };

        // 1. Sort data chronologically to prevent X-axis jitter
        const sortedData = [...data].sort((a, b) => timeToSec(a[timeKey]) - timeToSec(b[timeKey]));

        // 2. Filter out single-point zero drops (glitches)
        const filteredData = sortedData.filter((d, i, arr) => {
            const currentWeight = weightKeys.reduce((sum, key) => sum + getValInLbs(d, key), 0);
            if (currentWeight === 0 && i > 0 && i < arr.length - 1) {
                const prevWeight = weightKeys.reduce((sum, key) => sum + getValInLbs(arr[i - 1], key), 0);
                const nextWeight = weightKeys.reduce((sum, key) => sum + getValInLbs(arr[i + 1], key), 0);
                // If it drops to 0 but was > 500 lbs before and after, it's a glitch
                if (prevWeight > 500 && nextWeight > 500) return false;
            }
            return true;
        });

        const filteredTimes = filteredData.map(d => timeToSec(d[timeKey]));
        const totalLoads = filteredData.map(d => weightKeys.reduce((sum, key) => sum + getValInLbs(d, key), 0));

        const maxWeight = totalLoads.length > 0 ? Math.max(...totalLoads) : 0;
        const maxIndex = totalLoads.indexOf(maxWeight);
        const maxRow = filteredData[maxIndex === -1 ? 0 : maxIndex];

        let peakTime = '';
        if (maxRow) {
            const allValues = Object.entries(maxRow);
            const timeVal = allValues.find(([k, v]) => v && typeof v === 'string' && /(\d{1,2}[:.]\d{2})/.test(v));
            if (timeVal) {
                const match = timeVal[1].match(/(\d{1,2}[:.]\d{2})/);
                peakTime = match[1].replace('.', ':');
            } else if (maxRow.timestamp) {
                peakTime = new Date(maxRow.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
            } else {
                const tHeader = headers.find(h => /time|clock|hour|recorded/i.test(h));
                if (tHeader && maxRow[tHeader]) {
                    const val = maxRow[tHeader].toString().trim();
                    peakTime = val.match(/(\d{1,2}[:.]?\d{2})/)?.[1] || val.slice(0, 5);
                    if (peakTime.length === 4 && !peakTime.includes(':')) {
                        peakTime = peakTime.slice(0, 2) + ':' + peakTime.slice(2);
                    }
                }
            }
        }

        // 4. Duration calculation
        const minVal = filteredTimes.length > 0 ? Math.min(...filteredTimes) : 0;
        const maxVal = filteredTimes.length > 0 ? Math.max(...filteredTimes) : 0;
        let totalTimeSec = maxVal - minVal;

        // Convert based on requested display unit
        let totalTimeVal = totalTimeSec / 60; // default to min
        if (displayTimeUnit === 'hrs') {
            totalTimeVal = totalTimeSec / 3600;
        }

        const unitFactor = displayUnit === 'tons' ? 1 / 2000 : 1;
        const timeFactor = xUnit === 'hour' ? 1 / 60 : 1;

        return {
            maxWeight: maxWeight * unitFactor,
            totalTime: totalTimeVal || 0,
            peakTime: peakTime || '',
            timeKey,
            weightKey: weightKeys[0],
            chartData: {
                labels: filteredTimes.map(seconds => {
                    const val = displayTimeUnit === 'hrs' ? seconds / 3600 : seconds / 60;
                    return val.toFixed(2);
                }),
                datasets: weightKeys.map((key, i) => {
                    const palette = ['#1a3a6c', '#3fb950', '#2188ff', '#f85149', '#dbab09', '#8957e5'];
                    const customLabel = serialLabels[i] ? serialLabels[i].trim() : `Hook ${i + 1}`;
                    return {
                        label: customLabel,
                        data: filteredData.map(d => getValInLbs(d, key) * unitFactor),
                        borderColor: palette[i % palette.length],
                        backgroundColor: i === 0 ? 'rgba(26, 58, 108, 0.1)' : 'transparent',
                        fill: i === 0 && weightKeys.length === 1,
                        tension: 0.2,
                        pointRadius: 0
                    };
                })
            }
        };
    } catch (err) {
        console.error("OSCAR Data Logic Error:", err);
        return null;
    }
};

// --- Settings Modal Wrapper ---
function SettingsModal({ isOpen, onClose }) {
    if (!isOpen) return null;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="job-prompt-card" style={{ maxWidth: '800px', width: '90%', maxHeight: '90vh', overflowY: 'auto', position: 'relative' }} onClick={e => e.stopPropagation()}>
                <button
                    className="action-btn secondary small"
                    style={{ position: 'absolute', top: '20px', right: '20px' }}
                    onClick={onClose}
                >
                    ✕ Close
                </button>
                <SettingsView onSettingsSaved={onClose} />
            </div>
        </div>
    );
}

// --- Settings View ---
function SettingsView({ onSettingsSaved }) {
    const [settings, setSettings] = useState({
        clientId: '',
        tenantId: '',
        sharepointSite: '',
        leadListName: '',
        openaiKey: '',
        t24GroupId: 0,
        chrUsername: '',
        chrPassword: '',
        geotabServer: '',
        geotabDatabase: '',
        geotabUsername: '',
        geotabPassword: '',
        hiddenJobIds: []
    });
    const [message, setMessage] = useState('');

    useEffect(() => {
        const load = async () => {
            const saved = await window.electronAPI.loadSettings();
            if (saved) setSettings(prev => ({ ...prev, ...saved }));
        };
        load();
    }, []);

    const handleSave = async () => {
        const result = await window.electronAPI.saveSettings(settings);
        if (result.success) {
            setMessage('Settings saved successfully!');
            if (onSettingsSaved) onSettingsSaved();
        }
    };

    return (
        <div className="view-container">
            <div className="form-section">
                <h3>System Settings</h3>
                <p className="helper-text">Configure SharePoint and AI credentials below.</p>

                <div className="form-grid mt-4">
                    <div className="form-group">
                        <label>Microsoft Client ID</label>
                        <input
                            type="text"
                            value={settings.clientId}
                            onChange={(e) => setSettings({ ...settings, clientId: e.target.value })}
                            placeholder="Enter Azure App Client ID"
                        />
                    </div>
                    <div className="form-group">
                        <label>Microsoft Tenant ID</label>
                        <input
                            type="text"
                            value={settings.tenantId}
                            onChange={(e) => setSettings({ ...settings, tenantId: e.target.value })}
                            placeholder="Enter Azure Tenant ID"
                        />
                    </div>
                    <div className="form-group">
                        <label>SharePoint Site URL</label>
                        <input
                            type="text"
                            value={settings.sharepointSite}
                            onChange={(e) => setSettings({ ...settings, sharepointSite: e.target.value })}
                            placeholder="e.g. https://company.sharepoint.com/sites/Production"
                        />
                    </div>
                    <div className="form-group">
                        <label>Lead List Name</label>
                        <input
                            type="text"
                            value={settings.leadListName}
                            onChange={(e) => setSettings({ ...settings, leadListName: e.target.value })}
                            placeholder="Lead List"
                        />
                    </div>
                    <div className="form-group span-2">
                        <label>OpenAI API Key (for Standard Finder)</label>
                        <input
                            type="password"
                            value={settings.openaiKey}
                            onChange={(e) => setSettings({ ...settings, openaiKey: e.target.value })}
                            placeholder="sk-..."
                        />
                    </div>
                </div>

                <div className="form-section mt-4">
                    <h3>T24 Telemetry Settings</h3>
                    <p className="helper-text">Configure T24 load cell communication settings.</p>
                    <div className="form-grid mt-4">
                        <div className="form-group">
                            <label>T24 Group ID</label>
                            <select
                                value={settings.t24GroupId || 0}
                                onChange={(e) => setSettings({ ...settings, t24GroupId: parseInt(e.target.value) })}
                            >
                                {[...Array(16)].map((_, i) => (
                                    <option key={i} value={i}>Group {i}</option>
                                ))}
                            </select>
                            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '8px' }}>
                                Set this to match your T24 handheld's Group ID. Check your handheld's settings if unsure.
                            </p>
                        </div>
                    </div>
                </div>

                <div className="form-section mt-4">
                    <h3>Job Management</h3>
                    <p className="helper-text">Restore previously removed jobs to the list.</p>
                    <div style={{ marginTop: '16px' }}>
                        {settings.hiddenJobIds && settings.hiddenJobIds.length > 0 ? (
                            <>
                                <p style={{ fontSize: '0.9rem', marginBottom: '12px' }}>
                                    You have <strong>{settings.hiddenJobIds.length}</strong> hidden job(s).
                                </p>
                                <button
                                    onClick={() => {
                                        if (confirm('Are you sure you want to restore all hidden jobs?')) {
                                            setSettings({ ...settings, hiddenJobIds: [] });
                                            setMessage('Click Save to apply changes.');
                                        }
                                    }}
                                    className="action-btn secondary"
                                >
                                    Restore All Hidden Jobs
                                </button>
                            </>
                        ) : (
                            <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>No jobs are currently hidden.</p>
                        )}
                    </div>
                </div>


                <div className="form-actions mt-4">
                    <button onClick={handleSave} className="action-btn">Save Configuration</button>
                    <button
                        onClick={async () => {
                            if (confirm('Are you sure you want to sign out? This will clear your SharePoint login cache.')) {
                                await window.electronAPI.logout();
                                alert('Signed out successfully.');
                            }
                        }}
                        className="action-btn secondary ml-4"
                    >
                        Sign Out (Clear MS Cache)
                    </button>
                    {message && <span className="ml-4 info-text">{message}</span>}
                </div>
            </div>
        </div>
    );
}

// --- Company Information View ---
function CompanyInfoView({ company, onBack, onSelectForLive, onImportCsv }) {
    if (!company) return null;

    // Helper to format field labels from camelCase/PascalCase
    const formatLabel = (key) => {
        const result = key.replace(/([A-Z])/g, " $1");
        return result.charAt(0).toUpperCase() + result.slice(1);
    };

    // Fields we want to highlight if available
    const primaryFields = ['LeadName', 'LeadEmail', 'LeadPhone', 'ProjType', 'QuoteNum', 'PODate'];

    // List of SharePoint system fields or internal metadata to hide
    const hiddenFields = [
        'id', '__metadata', 'ContentType', 'ComplianceAssetId',
        'FileSystemObjectType', 'ServerRedirectedEmbedUrl', 'ChildCount',
        'FolderChildCount', 'ItemChildCount', '_Address', '_ColorTag',
        'Attachments', '_UIVersionString'
    ];

    // Other fields to show in details - filter out user-hidden, system patterns, and empty data
    const detailFields = Object.keys(company).filter(k =>
        !primaryFields.includes(k) &&
        !hiddenFields.includes(k) &&
        !k.toLowerCase().includes('lookupid') &&
        !k.toLowerCase().includes('odata') &&
        company[k] !== null &&
        company[k] !== undefined &&
        typeof company[k] !== 'object' &&
        company[k] !== ''
    );

    return (
        <div className="company-info-container" style={{ padding: '20px' }}>
            <div className="view-header" style={{ marginBottom: '30px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                    <button onClick={onBack} className="action-btn secondary small">← Back to Jobs</button>
                    <h2 style={{ margin: 0 }}>{company?.LeadCompany || company?.Customer || 'Company Details'}</h2>
                </div>
                <div style={{ display: 'flex', gap: '10px' }}>
                    <button onClick={() => onImportCsv(company)} className="action-btn secondary">
                        Import CSV for This Job
                    </button>
                    <button onClick={() => onSelectForLive(company)} className="action-btn">
                        Use This Job for Live Test
                    </button>
                </div>
            </div>

            <div className="info-grid mt-4">
                <div className="info-card">
                    <h4>Primary Contact & Info</h4>
                    <div className="detail-row">
                        <span className="detail-label">Contact Name:</span>
                        <span className="detail-value">{company.LeadName || 'N/A'}</span>
                    </div>
                    <div className="detail-row">
                        <span className="detail-label">Email:</span>
                        <span className="detail-value">{company.LeadEmail || 'N/A'}</span>
                    </div>
                    <div className="detail-row">
                        <span className="detail-label">Phone:</span>
                        <span className="detail-value">{company.LeadPhone || 'N/A'}</span>
                    </div>
                    <div className="detail-row">
                        <span className="detail-label">Project Type:</span>
                        <span className="detail-value"><span className="badge service">{company.ProjType || 'Service'}</span></span>
                    </div>
                </div>

                <div className="info-card">
                    <h4>Project Reference</h4>
                    <div className="detail-row">
                        <span className="detail-label">Quote Number:</span>
                        <span className="detail-value"><strong>{company.QuoteNum || 'N/A'}</strong></span>
                    </div>
                    <div className="detail-row">
                        <span className="detail-label">PO Date:</span>
                        <span className="detail-value">{company.PODate ? new Date(company.PODate).toLocaleDateString() : 'N/A'}</span>
                    </div>
                </div>

                {detailFields.length > 0 && (
                    <div className="info-card span-2" style={{ gridColumn: 'span 2' }}>
                        <h4>Additional SharePoint Data</h4>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                            {detailFields.map(field => {
                                let val = "N/A";
                                try {
                                    val = String(company[field]);
                                } catch (e) {
                                    val = "[Complex Data]";
                                }
                                return (
                                    <div key={field} className="detail-row" style={{ display: 'flex', gap: '10px' }}>
                                        <span className="detail-label" style={{ width: '160px', fontWeight: 'bold', color: 'var(--text-secondary)' }}>{formatLabel(field)}:</span>
                                        <span className="detail-value">{val}</span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

function LiveGraph({ data, activeTags, companyName, jobNumber, displayUnit = 'lbs', onUnitChange, xUnit, onXUnitChange }) {
    const [viewMode, setViewMode] = useState('auto'); // 'auto' or 'fixed'
    const [fixedDuration, setFixedDuration] = useState(120); // minutes (2 hours default)
    const [yZoom, setYZoom] = useState([0, 'auto']);
    const [targetLoad, setTargetLoad] = useState('');
    const [wll, setWll] = useState('');
    const [streamSettings, setStreamSettings] = useState({}); // tag -> { color, dashed }

    const colors = ['#3fb950', '#2188ff', '#f85149', '#dbab09', '#8957e5', '#f0883e', '#1f6feb', '#238636', '#fa4549', '#e3b341'];

    // Initialize/Update settings for new tags
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

    // Prepare data for recharts: group by timestamp
    const chartData = useMemo(() => {
        if (!data || data.length === 0) return [];

        // Because data arrives sequentially per tag, we need to group by approximate time 
        // Or just map the raw log points if they have all tags. 
        // The current state `loggedData` appends a new object for EVERY packet.
        // For Recharts we want: [{ elapsed: 0, tag1: value, tag2: value }, ...]

        const grouped = [];
        let currentBucket = null;
        const bucketSize = 250; // ms grouping

        const unitFactor = displayUnit === 'tons' ? 1 / 2000 : 1;
        const timeFactor = xUnit === 'hour' ? 1 / 3600000 : 1 / 60000; // elapsed is in ms, converting to min or hr

        data.forEach(point => {
            const time = Math.floor(point["Elapsed (ms)"] / bucketSize) * bucketSize;
            if (!currentBucket || currentBucket.elapsed !== time) {
                currentBucket = { elapsed: (point["Elapsed (ms)"] * timeFactor) };
                grouped.push(currentBucket);
            }
            currentBucket[point.Tag] = point.value * unitFactor;
        });

        return grouped;
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

            <div style={{ height: '400px', width: '100%' }}>
                <ResponsiveContainer width="100%" height="100%">
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

                        {activeTags.map((tag, i) => tag && (
                            <ReLine
                                key={tag}
                                type="monotone"
                                dataKey={tag}
                                name={`Cell ${tag}`}
                                stroke={streamSettings[tag]?.color || colors[i % colors.length]}
                                strokeDasharray={streamSettings[tag]?.dashed ? "5 5" : "0"}
                                dot={false}
                                animationDuration={300}
                                isAnimationActive={false} // Disable for real-time performance
                            />
                        ))}
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

function ConversionCalculator() {
    const [inputValue, setInputValue] = useState('');
    const [fromUnit, setFromUnit] = useState('lbs');
    const [toUnit, setToUnit] = useState('kg');
    const [result, setResult] = useState(null);

    const units = {
        lbs: { label: 'Pounds (lbs)', type: 'weight' },
        kg: { label: 'Kilograms (kg)', type: 'weight' },
        tons: { label: 'Short Tons (US)', type: 'weight' },
        mtons: { label: 'Metric Tons (t)', type: 'weight' },
        ft: { label: 'Feet (ft)', type: 'length' },
        m: { label: 'Meters (m)', type: 'length' }
    };

    const convert = (val, from, to) => {
        if (!val || isNaN(val)) return null;
        let baseValue; // kg for weight, meters for length

        // Convert to base
        switch (from) {
            case 'lbs': baseValue = val * 0.45359237; break;
            case 'kg': baseValue = val; break;
            case 'tons': baseValue = val * 907.18474; break;
            case 'mtons': baseValue = val * 1000; break;
            case 'ft': baseValue = val * 0.3048; break;
            case 'm': baseValue = val; break;
            default: return null;
        }

        // Convert from base
        switch (to) {
            case 'lbs': return baseValue / 0.45359237;
            case 'kg': return baseValue;
            case 'tons': return baseValue / 907.18474;
            case 'mtons': return baseValue / 1000;
            case 'ft': return baseValue / 0.3048;
            case 'm': return baseValue;
            default: return null;
        }
    };

    useEffect(() => {
        const res = convert(parseFloat(inputValue), fromUnit, toUnit);
        setResult(res);
    }, [inputValue, fromUnit, toUnit]);

    const handleSwap = () => {
        const temp = fromUnit;
        setFromUnit(toUnit);
        setToUnit(temp);
    };

    return (
        <div className="conversion-card">
            <h3>Quick Conversion Calculator</h3>
            <div className="conversion-grid">
                <div className="conversion-input-group">
                    <label>From</label>
                    <select
                        className="unit-select"
                        value={fromUnit}
                        onChange={(e) => setFromUnit(e.target.value)}
                    >
                        {Object.entries(units).map(([key, unit]) => (
                            <option key={key} value={key}>{unit.label}</option>
                        ))}
                    </select>
                    <input
                        type="number"
                        className="conversion-field"
                        placeholder="Enter value..."
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                    />
                </div>

                <button className="swap-btn" onClick={handleSwap} title="Swap Units">
                    ⇄
                </button>

                <div className="conversion-input-group">
                    <label>To</label>
                    <select
                        className="unit-select"
                        value={toUnit}
                        onChange={(e) => setToUnit(e.target.value)}
                    >
                        {Object.entries(units)
                            .filter(([key, unit]) => unit.type === units[fromUnit].type)
                            .map(([key, unit]) => (
                                <option key={key} value={key}>{unit.label}</option>
                            ))}
                    </select>
                    <div className="conversion-field" style={{ background: 'rgba(255,255,255,0.05)', color: result !== null ? 'var(--yellow-accent)' : 'var(--text-secondary)' }}>
                        {result !== null ? result.toLocaleString(undefined, { maximumFractionDigits: 3 }) : '---'}
                    </div>
                </div>
            </div>
            {result !== null && (
                <div className="conversion-result">
                    <div className="result-label">Result</div>
                    <div className="result-value">
                        {inputValue} {fromUnit} = {result.toLocaleString(undefined, { maximumFractionDigits: 3 })} {toUnit}
                    </div>
                </div>
            )}
        </div>
    );
}


function WelcomeView({ onJobSelected, onOpenSettings, onCompanySelected }) {
    const [jobs, setJobs] = useState([]);
    const [loading, setLoading] = useState(false);
    const [authMessage, setAuthMessage] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [error, setError] = useState('');
    const [cacheInfo, setCacheInfo] = useState(null); // { timestamp, isFromCache }
    const [hiddenJobIds, setHiddenJobIds] = useState([]);

    useEffect(() => {
        const loadHidden = async () => {
            const saved = await window.electronAPI.loadSettings();
            if (saved?.hiddenJobIds) setHiddenJobIds(saved.hiddenJobIds);
        };
        loadHidden();
    }, []);

    const handleRemoveJob = async (jobId) => {
        const newHidden = [...hiddenJobIds, jobId];
        setHiddenJobIds(newHidden);
        const saved = await window.electronAPI.loadSettings();
        await window.electronAPI.saveSettings({ ...saved, hiddenJobIds: newHidden });
    };

    useEffect(() => {
        if (window.electronAPI.onAuthMessage) {
            window.electronAPI.onAuthMessage((msg) => setAuthMessage(msg));
        }
        // Auto-load cache info on mount
        loadCacheInfo();
    }, []);

    const loadCacheInfo = async () => {
        const cache = await window.electronAPI.getJobsCache();
        if (cache?.timestamp) {
            setCacheInfo({ timestamp: cache.timestamp, isFromCache: false });
        }
    };

    const loadJobs = async () => {
        setLoading(true);
        setAuthMessage('');
        setError('');
        setCacheInfo(prev => prev ? { ...prev, isFromCache: false } : null);
        try {
            const fullList = await window.electronAPI.fetchJobs();
            // The backend already filters for "Service"/"Rental" and "PO Received" status
            setJobs(fullList);
            if (fullList.length === 0) {
                setError('No awarded "Service" projects found (PO Received status).');
            }
            // Refresh cache info after successful fetch
            loadCacheInfo();
        } catch (err) {
            console.error(err);
            setError(err.message || 'Failed to fetch jobs from SharePoint.');
        } finally {
            setLoading(false);
        }
    };

    const loadFromCache = async () => {
        setLoading(true);
        setError('');
        setAuthMessage('');
        try {
            const cache = await window.electronAPI.getJobsCache();
            if (cache?.jobs && cache.jobs.length > 0) {
                // The backend already filters for "Service"/"Rental" and "PO Received" status
                setJobs(cache.jobs);
                setCacheInfo({ timestamp: cache.timestamp, isFromCache: true });
            } else {
                setError('No cached data available. Please connect to the internet and refresh first.');
            }
        } catch (err) {
            console.error(err);
            setError('Failed to load cached data.');
        } finally {
            setLoading(false);
        }
    };

    const filteredJobs = jobs.filter(job =>
        !hiddenJobIds.includes(job.id) && (
            job.QuoteNum?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            job.Customer?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            job.LeadCompany?.toLowerCase().includes(searchTerm.toLowerCase()) ||
            job.ProjType?.toLowerCase().includes(searchTerm.toLowerCase())
        )
    );

    return (
        <div className="welcome-container">
            <div className="welcome-header">
                <h1>Welcome to OSCAR</h1>
                <p>Select a job from the SharePoint Lead List to get started.</p>
            </div>

            <div className="job-selection-card">
                <div className="card-controls">
                    <input
                        type="text"
                        placeholder="Search Quote # or Company..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        className="search-input"
                    />
                    <button onClick={loadJobs} className="action-btn" disabled={loading}>
                        {loading ? 'Loading...' : 'Refresh Job List'}
                    </button>
                    <button onClick={loadFromCache} className="action-btn secondary" disabled={loading}>
                        Use Cached Data
                    </button>
                </div>

                {cacheInfo && (
                    <div className={`cache-status ${cacheInfo.isFromCache ? 'offline' : ''}`} style={{
                        padding: '8px 16px',
                        marginBottom: '16px',
                        borderRadius: '6px',
                        fontSize: '0.85rem',
                        background: cacheInfo.isFromCache ? 'rgba(255, 193, 7, 0.15)' : 'rgba(40, 167, 69, 0.15)',
                        color: cacheInfo.isFromCache ? '#ffc107' : '#28a745',
                        border: `1px solid ${cacheInfo.isFromCache ? '#ffc107' : '#28a745'}`
                    }}>
                        {cacheInfo.isFromCache ? '📴 OFFLINE MODE - ' : '✓ '}
                        Last cached: {new Date(cacheInfo.timestamp).toLocaleString()}
                        {cacheInfo.isFromCache && ' (using stored data)'}
                    </div>
                )}

                {authMessage && (
                    <div className="auth-prompt">
                        <div className="pulse-dot" style={{ display: 'inline-block', marginRight: '10px' }}></div>
                        <strong>Microsoft Authentication Required:</strong>
                        <p style={{ marginTop: '10px' }}>{authMessage}</p>
                        <p style={{ fontSize: '0.85rem', fontStyle: 'italic', marginTop: '10px' }}>
                            Tip: Your browser should have opened automatically. If not, click the link in the message above.
                        </p>
                    </div>
                )}

                {error && (
                    <div className="error-prompt" style={{
                        background: 'rgba(248, 81, 73, 0.1)',
                        border: '1px solid #f85149',
                        padding: '16px',
                        borderRadius: '8px',
                        marginBottom: '24px',
                        color: '#f85149'
                    }}>
                        <p><strong>Error Fetching Jobs:</strong></p>
                        <p>{error}</p>
                        <div style={{ marginTop: '10px', fontSize: '0.8rem' }}>
                            Tip: Check your SharePoint URL and List Name in Settings. Ensure you have authenticated.
                        </div>
                    </div>
                )}

                <div className="jobs-list">
                    {loading ? (
                        <div className="loading-spinner">Connecting to SharePoint...</div>
                    ) : filteredJobs.length > 0 ? (
                        <table>
                            <thead>
                                <tr>
                                    <th>Quote #</th>
                                    <th>Company</th>
                                    <th>PO Date</th>
                                    <th>Type</th>
                                    <th>Action</th>
                                </tr>
                            </thead>
                            <tbody>
                                {filteredJobs.map(job => (
                                    <tr key={job.id}>
                                        <td><strong>{job.QuoteNum || 'N/A'}</strong></td>
                                        <td>
                                            <span
                                                className="clickable-company"
                                                onClick={() => onCompanySelected(job)}
                                                title="View detailed company information"
                                            >
                                                {job.LeadCompany || 'N/A'}
                                            </span>
                                        </td>
                                        <td>{job.PODate ? new Date(job.PODate).toLocaleDateString() : 'N/A'}</td>
                                        <td><span className="badge service">{job.ProjType || 'Service'}</span></td>
                                        <td>
                                            <button onClick={() => onJobSelected(job)} className="action-btn small">
                                                Select Job
                                            </button>
                                            <button
                                                onClick={() => {
                                                    if (confirm(`Hide job ${job.QuoteNum}?`)) {
                                                        handleRemoveJob(job.id);
                                                    }
                                                }}
                                                className="job-remove-btn ml-4"
                                                title="Remove from view"
                                            >
                                                ✕
                                            </button>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    ) : (
                        <div className="empty-list">
                            <p>No jobs found. Please ensure SharePoint settings are correct.</p>
                            <button onClick={onOpenSettings} className="action-btn secondary">Configure Settings</button>
                        </div>
                    )}
                </div>
            </div>
            <ConversionCalculator />
        </div>
    );
}



function LiveView({
    status,
    onSaveLog,
    selectedJob,
    recoveryData,
    // Lifted State
    devices,
    selectedTags,
    setSelectedTags,
    cellCount,
    setCellCount,
    isLogging,
    setIsLogging,
    loggedData,
    setLoggedData,
    logInterval,
    setLogInterval,
    keepAwake,
    setKeepAwake,
    previewData,
    setPreviewData,
    displayUnit,
    onUnitChange,
    xUnit,
    onXUnitChange
}) {
    const [showJobPrompt, setShowJobPrompt] = useState(false);
    const [jobInput, setJobInput] = useState('');
    const [error, setError] = useState('');

    // Pre-fill job input if a SharePoint job was selected
    useEffect(() => {
        if (selectedJob?.QuoteNum) {
            setJobInput(selectedJob.QuoteNum);
        }
    }, [selectedJob]);

    // Resume from recovery (Run once per recovery session)
    const recoveryAppliedRef = useRef(false);
    useEffect(() => {
        if (recoveryData && recoveryData.length > 0 && !recoveryAppliedRef.current) {
            setLoggedData(recoveryData);
            setIsLogging(true);
            const recoveryTags = Array.from(new Set(recoveryData.map(d => d.Tag)));
            if (recoveryTags.length > 0) {
                const nextTags = [...selectedTags];
                recoveryTags.slice(0, 10).forEach((tag, i) => {
                    nextTags[i] = tag;
                });
                setSelectedTags(nextTags);
                setCellCount(Math.max(cellCount, recoveryTags.length));
            }
            recoveryAppliedRef.current = true;
        }
    }, [recoveryData]);

    const tags = Object.keys(devices);


    const startLogging = () => {
        setLoggedData([]);
        setIsLogging(true);
        setError('');
        if (window.electronAPI.startSafetyLog) {
            window.electronAPI.startSafetyLog(logInterval);
        }
    };

    const stopLogging = async () => {
        setIsLogging(false);
        if (window.electronAPI.stopSafetyLog) {
            window.electronAPI.stopSafetyLog();
        }

        // Prepare data for save
        const jobNumber = selectedJob?.QuoteNum || jobInput || 'test_data';

        // If a SharePoint job was selected, auto-save without prompting
        if (selectedJob?.QuoteNum) {
            const metadata = {
                customer: selectedJob.Customer,
                leadCompany: selectedJob.LeadCompany,
                poDate: selectedJob.PODate,
                poNumber: selectedJob.PONumber
            };
            onSaveLog(loggedData, selectedJob.QuoteNum, metadata);

            // AUTOMATIC CSV EXPORT for SharePoint Jobs
            if (loggedData.length > 0) {
                await window.electronAPI.saveCSV(loggedData, selectedJob.QuoteNum);
            }

            setLoggedData([]);
        } else {
            // No job selected, show manual prompt
            setShowJobPrompt(true);
        }
    };

    const handleSave = async () => {
        const regex = /^HWI-\d{2}-\d{3}$/i;
        if (!regex.test(jobInput)) {
            setError('Invalid Format. Use HWI-XX-XXX (e.g., HWI-24-001)');
            return;
        }

        const upperJob = jobInput.toUpperCase();
        onSaveLog(loggedData, upperJob);

        // AUTOMATIC CSV EXPORT for Manual Jobs
        if (loggedData.length > 0) {
            await window.electronAPI.saveCSV(loggedData, upperJob);
        }

        setShowJobPrompt(false);
        setJobInput('');
        setError('');
        setLoggedData([]);
    };

    const cancelSave = () => {
        setShowJobPrompt(false);
        setJobInput('');
        setError('');
        setLoggedData([]);
    };

    const handleTagChange = (index, value) => {
        const newTags = [...selectedTags];
        newTags[index] = value === 'none' ? null : value;
        setSelectedTags(newTags);
    };

    const toggleKeepAwake = async () => {
        const newState = !keepAwake;
        setKeepAwake(newState);
        await window.electronAPI.toggleKeepAwake(newState);
    };

    const handleZero = (tag) => {
        if (!tag) return;
        window.electronAPI.tare(tag);
    };

    const handleWakeSensors = async () => {
        if (window.electronAPI.wakeSensors) {
            await window.electronAPI.wakeSensors();
        }
    };

    const clearAllTares = () => {
        selectedTags.slice(0, cellCount).forEach(tag => {
            if (tag) window.electronAPI.clearTare(tag);
        });
    };

    if (status === 'disconnected') {
        return (
            <div className="placeholder-card center-content">
                <h2>Waiting for Dongle...</h2>
                <p>Plug in your T24 USB dongle to begin live streaming.</p>
            </div>
        );
    }

    if (tags.length === 0) {
        return (
            <div className="placeholder-card center-content">
                <h2>Scanning for Devices...</h2>
                <p>Dongle connected. Waiting for transmitter broadcast signals...</p>
                <button onClick={handleWakeSensors} className="action-btn mt-4" style={{ fontSize: '1.1rem', padding: '14px 28px' }}>
                    📶 Wake All Sensors
                </button>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '8px' }}>
                    Sends a broadcast signal to wake nearby sleeping transmitters
                </p>
            </div>
        );
    }

    // Calculate total load for display
    const totalLbs = selectedTags.slice(0, cellCount).reduce((acc, tag) => {
        if (tag && devices[tag]) {
            return acc + devices[tag].value; // already tared
        }
        return acc;
    }, 0);

    const shortTons = totalLbs / 2000;
    const metricTons = totalLbs * 0.00045359237;

    return (
        <div className="live-view-container">
            <div className="live-header">
                <div className="live-badge">LIVE MULTI-LINK</div>
                <div className="serial-box">
                    <span className="label">NUMBER OF CELLS</span>
                    <select
                        className="cell-count-dropdown"
                        value={cellCount}
                        onChange={(e) => setCellCount(parseInt(e.target.value))}
                        disabled={isLogging}
                    >
                        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => (
                            <option key={n} value={n}>{n} Cell{n > 1 ? 's' : ''}</option>
                        ))}
                    </select>
                </div>
                <div className="serial-box">
                    <span className="label">SIGNAL STATUS</span>
                    <span className="value">CONNECTED ({selectedTags.slice(0, cellCount).filter(t => t).length} Cells)</span>
                </div>
                <div className="serial-box">
                    <span className="label">SAMPLE RATE</span>
                    <select
                        className="cell-count-dropdown"
                        value={logInterval}
                        onChange={(e) => setLogInterval(parseInt(e.target.value))}
                        disabled={isLogging}
                    >
                        <option value={0}>Continuous (Real-time)</option>
                        <option value={1000}>1 Second</option>
                        <option value={10000}>10 Seconds</option>
                        <option value={30000}>30 Seconds</option>
                        <option value={60000}>1 Minute</option>
                        <option value={600000}>10 Minutes</option>
                    </select>
                </div>
            </div>

            <div className="main-stats">
                <div className="primary-stat">
                    <div className="stat-unit">TOTAL LOAD (Lbs)</div>
                    <div className="stat-big-value">{totalLbs.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</div>
                </div>

                <div className="logging-controls mt-2">
                    {!isLogging ? (
                        <div className="control-row">
                            <button onClick={startLogging} className="action-btn large record-btn">
                                <span className="dot"></span> Start Logging Multi-Data
                            </button>
                            <button onClick={clearAllTares} className="action-btn secondary ml-4">
                                Clear All Zeros
                            </button>
                            <button onClick={handleWakeSensors} className="action-btn secondary ml-4" title="Sends an aggressive broadcast to wake all nearby sensors">
                                📶 Wake All Sensors
                            </button>
                            <div className="keep-awake-container ml-auto">
                                <label className="awake-label">
                                    <input
                                        type="checkbox"
                                        checked={keepAwake}
                                        onChange={toggleKeepAwake}
                                    />
                                    KEEP TRANSMITTERS AWAKE
                                </label>
                            </div>
                        </div>
                    ) : (
                        <div className="logging-active-group">
                            <button onClick={stopLogging} className="action-btn large stop-btn">
                                <span className="square"></span> Stop & Save Project
                            </button>
                            <div className="logging-status">
                                <span className="pulse-dot"></span>
                                Recording: {loggedData.length} samples collected
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <div className="load-cells-grid">
                {selectedTags.slice(0, cellCount).map((selectedTag, index) => {
                    const packet = selectedTag ? devices[selectedTag] : null;
                    return (
                        <div key={index} className={`load-cell-slot ${selectedTag ? 'active' : ''}`}>
                            <div className="slot-header">
                                <span className="slot-number">CELL {index + 1}</span>
                                <select
                                    className="slot-dropdown"
                                    value={selectedTag || 'none'}
                                    onChange={(e) => handleTagChange(index, e.target.value)}
                                    disabled={isLogging}
                                >
                                    <option value="none">-- Unassigned --</option>
                                    {tags.map(tag => (
                                        <option key={tag} value={tag}>Tag: {tag}</option>
                                    ))}
                                </select>
                            </div>
                            <div className="slot-body">
                                <div className="slot-value">
                                    {(packet ? packet.value : 0).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                                </div>
                                <div className="slot-unit">Lbs</div>
                                {selectedTag && (
                                    <button
                                        className="zero-btn"
                                        onClick={() => handleZero(selectedTag)}
                                        disabled={isLogging}
                                    >
                                        Zero
                                    </button>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            {showJobPrompt && (
                <div className="modal-overlay">
                    <div className="job-prompt-card">
                        <h3>Save to Projects</h3>
                        <p>Complete the recording by assigning a Job Number.</p>
                        <div className="form-group mt-4">
                            <label>Job Number (Format: HWI-XX-XXX)</label>
                            <input
                                type="text"
                                value={jobInput}
                                onChange={(e) => { setJobInput(e.target.value); setError(''); }}
                                placeholder="HWI-24-001"
                                className={`large-input ${error ? 'error-border' : ''}`}
                                autoFocus
                            />
                            {error && <div className="error-text">{error}</div>}
                        </div>
                        <div className="form-actions mt-4">
                            <button onClick={handleSave} className="action-btn">Save Project</button>
                            <button onClick={cancelSave} className="action-btn secondary ml-4">Discard</button>
                        </div>
                    </div>
                </div>
            )}

            <div className="secondary-stats-grid mt-4">
                <div className="stat-card accent">
                    <h3>Total Short Tons (US)</h3>
                    <div className="stat-value">{shortTons.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })}</div>
                </div>
                <div className="stat-card accent">
                    <h3>Total Metric Tons</h3>
                    <div className="stat-value">{metricTons.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })}</div>
                </div>
            </div>

            {/* Live Visualization Graph */}
            <ErrorBoundary>
                <LiveGraph
                    data={isLogging ? loggedData : previewData}
                    activeTags={selectedTags.slice(0, cellCount)}
                    companyName={selectedJob?.LeadCompany || selectedJob?.Customer}
                    jobNumber={jobInput || selectedJob?.QuoteNum}
                    displayUnit={displayUnit}
                    onUnitChange={onUnitChange}
                    xUnit={xUnit}
                    onXUnitChange={onXUnitChange}
                />
            </ErrorBoundary>
        </div>
    );
}


function ImportView({ onDataImported, contextJob }) {
    const [pendingData, setPendingData] = useState(null);
    const [jobInput, setJobInput] = useState('');
    const [isPrompting, setIsPrompting] = useState(false);
    const [error, setError] = useState('');

    const handleImport = async () => {
        try {
            const content = await window.electronAPI.openFile();
            if (!content) return;

            const parsed = Papa.parse(content, {
                header: true,
                dynamicTyping: true,
                skipEmptyLines: true
            });

            if (parsed.data && parsed.data.length > 0) {
                if (contextJob) {
                    onDataImported(parsed.data, contextJob.QuoteNum, {
                        customer: contextJob.Customer,
                        leadCompany: contextJob.LeadCompany,
                        poDate: contextJob.PODate,
                        poNumber: contextJob.PONumber
                    });
                } else {
                    setPendingData(parsed.data);
                    setIsPrompting(true);
                    setError('');
                }
            }
        } catch (error) {
            console.error("Import failed:", error);
        }
    };

    const confirmImport = () => {
        if (pendingData) {
            const regex = /^HWI-\d{2}-\d{3}$/i;
            if (!regex.test(jobInput)) {
                setError('Invalid Format. Use HWI-XX-XXX (e.g., HWI-24-001)');
                return;
            }
            onDataImported(pendingData, jobInput.toUpperCase());
            setIsPrompting(false);
            setPendingData(null);
            setJobInput('');
            setError('');
        }
    };

    return (
        <div className="view-container">
            <div className="controls center-content">
                {!isPrompting ? (
                    <>
                        <button onClick={handleImport} className="action-btn large">
                            Select Data File (CSV/Excel)
                        </button>
                        <p className="helper-text">Select a CSV or Excel file containing test data (Time, Weight, etc.)</p>
                    </>
                ) : (
                    <div className="job-prompt-card">
                        <h3>Assign Job Number</h3>
                        <p>Please enter a job or project reference number for this data set.</p>
                        <div className="form-group mt-4">
                            <label>Job Number (Format: HWI-XX-XXX)</label>
                            <input
                                type="text"
                                value={jobInput}
                                onChange={(e) => { setJobInput(e.target.value); setError(''); }}
                                className={`large-input ${error ? 'error-border' : ''}`}
                                autoFocus
                            />
                            {error && <div className="error-text">{error}</div>}
                        </div>
                        <div className="form-actions mt-4">
                            <button onClick={confirmImport} className="action-btn">
                                Confirm & Import Data
                            </button>
                            <button onClick={() => { setIsPrompting(false); setError(''); }} className="action-btn secondary ml-4">
                                Cancel
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

function ReportView({ job, displayUnit = 'lbs', displayTimeUnit = 'min', onUnitChange, onTimeUnitChange, xUnit, onXUnitChange, onAddData, onRemoveDataSet, onUpdateDataSet }) {
    if (!job || !job.dataSets || job.dataSets.length === 0) {
        return (
            <div className="placeholder-card">
                <p>No data imported or logged for this project.</p>
                <button onClick={onAddData} className="action-btn mt-4">➕ Import CSV Data</button>
            </div>
        );
    }

    const handleExportCSV = async (dataSet) => {
        const jobNumber = job.metadata?.jobNumber || 'test_data';
        const fileName = dataSet.name || 'data_set';
        const result = await window.electronAPI.saveCSV(dataSet.data, `${jobNumber}_${fileName}`);
        if (result.success) {
            console.log('CSV exported successfully:', result.filePath);
        } else if (result.error) {
            alert(`Failed to export CSV: ${result.error}`);
        }
    };

    return (
        <div className="report-container">
            <div className="controls" style={{ marginBottom: '20px', display: 'flex', gap: '15px', alignItems: 'center' }}>
                <button onClick={onAddData} className="action-btn">
                    ➕ Add More Data
                </button>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', background: 'var(--bg-card)', padding: '5px 12px', borderRadius: '6px', border: '1px solid var(--border)' }}>
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Weight:</span>
                    <select
                        value={displayUnit}
                        onChange={e => onUnitChange(e.target.value)}
                        style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)', color: 'var(--yellow-accent)', padding: '2px 8px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
                    >
                        <option value="lbs">lbs</option>
                        <option value="tons">tons</option>
                    </select>
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', background: 'var(--bg-card)', padding: '5px 12px', borderRadius: '6px', border: '1px solid var(--border)' }}>
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Time:</span>
                    <select
                        value={displayTimeUnit}
                        onChange={e => onTimeUnitChange(e.target.value)}
                        style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)', color: 'var(--yellow-accent)', padding: '2px 8px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
                    >
                        <option value="min">min</option>
                        <option value="hrs">hrs</option>
                    </select>
                </div>
                <div style={{ display: 'flex', gap: '8px', alignItems: 'center', background: 'var(--bg-card)', padding: '5px 12px', borderRadius: '6px', border: '1px solid var(--border)' }}>
                    <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Time Axis:</span>
                    <select
                        value={xUnit}
                        onChange={e => onXUnitChange(e.target.value)}
                        style={{ background: 'var(--bg-dark)', border: '1px solid var(--border)', color: 'var(--yellow-accent)', padding: '2px 8px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
                    >
                        <option value="min">Minutes</option>
                        <option value="hour">Hours</option>
                    </select>
                </div>
            </div>

            <div className="datasets-scroll-area" style={{ display: 'flex', flexDirection: 'column', gap: '40px' }}>
                {job.dataSets.map((dataSet, index) => {
                    const stats = processChartData(dataSet.data, [], displayUnit, displayTimeUnit, dataSet.inputTimeUnit, xUnit);
                    if (!stats) return <div key={index}>Error processing data set {index + 1}</div>;

                    return (
                        <div key={index} className="dataset-block" style={{ padding: '20px', background: 'var(--bg-card)', borderRadius: '12px', border: '1px solid var(--border)' }}>
                            <div className="dataset-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '15px' }}>
                                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                        <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem', fontWeight: 'bold' }}>Graph #{index + 1}:</span>
                                        <input
                                            value={dataSet.name}
                                            onChange={(e) => onUpdateDataSet(index, { name: e.target.value })}
                                            style={{ background: 'transparent', border: 'none', borderBottom: '1px solid var(--border)', color: 'var(--yellow-accent)', fontSize: '1.1rem', fontWeight: 'bold', width: '300px' }}
                                            placeholder="Graph Title..."
                                        />
                                    </div>
                                    <div style={{ display: 'flex', gap: '20px', alignItems: 'center' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                            <span style={{ color: 'var(--text-secondary)', fontSize: '0.7rem' }}>Y-Axis Label:</span>
                                            <input
                                                value={dataSet.yAxisLabel || ''}
                                                onChange={(e) => onUpdateDataSet(index, { yAxisLabel: e.target.value })}
                                                style={{ background: 'transparent', border: 'none', borderBottom: '1px solid var(--border)', color: 'var(--text-secondary)', fontSize: '0.8rem', width: '150px' }}
                                                placeholder={`Default: Weight (${displayUnit})`}
                                            />
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                                            <span style={{ color: 'var(--text-secondary)', fontSize: '0.7rem' }}>Source Time Unit:</span>
                                            <select
                                                value={dataSet.inputTimeUnit || 'sec'}
                                                onChange={(e) => onUpdateDataSet(index, { inputTimeUnit: e.target.value })}
                                                style={{ background: 'transparent', border: 'none', borderBottom: '1px solid var(--border)', color: 'var(--yellow-accent)', fontSize: '0.8rem', cursor: 'pointer' }}
                                            >
                                                <option value="sec" style={{ background: 'var(--bg-dark)' }}>Seconds</option>
                                                <option value="min" style={{ background: 'var(--bg-dark)' }}>Minutes</option>
                                                <option value="hrs" style={{ background: 'var(--bg-dark)' }}>Hours</option>
                                                <option value="ms" style={{ background: 'var(--bg-dark)' }}>Milliseconds</option>
                                            </select>
                                        </div>
                                    </div>
                                </div>
                                <div style={{ display: 'flex', gap: '10px' }}>
                                    <button onClick={() => handleExportCSV(dataSet)} className="action-btn small">
                                        📊 Export CSV
                                    </button>
                                    <button onClick={() => onRemoveDataSet(index)} className="job-remove-btn" title="Remove Data Set" style={{ position: 'static', padding: '5px 10px' }}>
                                        ✕
                                    </button>
                                </div>
                            </div>

                            <div className="stats-grid" style={{ marginBottom: '20px' }}>
                                <div className="stat-card">
                                    <h3>Maximum Weight</h3>
                                    <div className="stat-value">{stats.maxWeight.toFixed(displayUnit === 'tons' ? 3 : 2)} {displayUnit}</div>
                                </div>
                                <div className="stat-card">
                                    <h3>Total Duration</h3>
                                    <div className="stat-value">{stats.totalTime.toFixed(2)} {displayTimeUnit}</div>
                                </div>
                                <div className="stat-card">
                                    <h3>Peak Timestamp</h3>
                                    <div className="stat-value">{stats.peakTime || 'N/A'}</div>
                                </div>
                            </div>

                            <div className="chart-section">
                                <div className="chart-wrapper" style={{ height: '350px' }}>
                                    <Line
                                        data={stats.chartData}
                                        options={{
                                            responsive: true,
                                            maintainAspectRatio: false,
                                            animation: false,
                                            interaction: { mode: 'index', intersect: false },
                                            plugins: {
                                                legend: {
                                                    display: stats.chartData.datasets.length > 1,
                                                    position: 'top',
                                                    labels: { color: '#8b949e', boxWidth: 12, font: { size: 10 } }
                                                },
                                                tooltip: {
                                                    callbacks: {
                                                        label: (context) => {
                                                            let label = context.dataset.label || '';
                                                            if (label) label += ': ';
                                                            if (context.parsed.y !== null) label += context.parsed.y.toFixed(displayUnit === 'tons' ? 3 : 2) + ` ${displayUnit}`;
                                                            return label;
                                                        }
                                                    }
                                                }
                                            },
                                            scales: {
                                                x: {
                                                    title: { display: true, text: `Elapsed Time (${xUnit === 'hour' ? 'hr' : 'min'})`, color: '#8b949e' },
                                                    ticks: { maxTicksLimit: 15, color: '#8b949e' },
                                                    grid: { color: 'rgba(33, 51, 77, 0.5)' }
                                                },
                                                y: {
                                                    beginAtZero: true,
                                                    title: { display: true, text: dataSet.yAxisLabel || `Weight (${displayUnit})`, color: '#8b949e' },
                                                    ticks: { color: '#8b949e' },
                                                    grid: { color: 'rgba(33, 51, 77, 0.5)' },
                                                    suggestedMax: stats.maxWeight * 1.1
                                                }
                                            }
                                        }}
                                    />
                                </div>
                            </div>

                            <div className="data-preview mt-4">
                                <details>
                                    <summary style={{ color: 'var(--text-secondary)', cursor: 'pointer' }}>Show Raw Data ({dataSet.data.length} rows)</summary>
                                    <div className="table-wrapper" style={{ maxHeight: '300px', overflowY: 'auto', marginTop: '10px' }}>
                                        <table style={{ fontSize: '0.8rem' }}>
                                            <thead>
                                                <tr>
                                                    {Object.keys(dataSet.data[0] || {}).map(key => <th key={key}>{key}</th>)}
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {dataSet.data.slice(0, 50).map((row, i) => (
                                                    <tr key={i}>
                                                        {Object.values(row).map((val, j) => <td key={j}>{val}</td>)}
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </details>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}

// --- AI Standard Finder Wizard ---
function StandardFinder({ onComplete, onClose }) {
    const [step, setStep] = useState(1);
    const [answers, setAnswers] = useState({
        equipment: '',
        environment: '',
        wllPercentage: '125%',
        context: ''
    });
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState(null);
    const [selectedStandards, setSelectedStandards] = useState(new Set());

    const handleNext = () => setStep(step + 1);
    const handleBack = () => setStep(step - 1);

    const handleSubmit = async () => {
        setLoading(true);
        try {
            const aiResult = await window.electronAPI.determineStandard(answers);
            setResult(aiResult);
            setStep(5); // Result step
        } catch (err) {
            alert(err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="modal-overlay">
            <div className="wizard-card">
                <div className="wizard-header">
                    <h3>AI Standard Assistant</h3>
                    <button onClick={onClose} className="close-btn">&times;</button>
                </div>

                <div className="wizard-body">
                    {step === 1 && (
                        <div className="wizard-step">
                            <h4>Step 1: Equipment Details</h4>
                            <label>What equipment is being tested?</label>
                            <textarea
                                value={answers.equipment}
                                onChange={(e) => setAnswers({ ...answers, equipment: e.target.value })}
                                placeholder="e.g. Overhead bridge crane, 50-ton winch, spreader bar..."
                            />
                            <div className="wizard-actions">
                                <button className="action-btn" onClick={handleNext} disabled={!answers.equipment}>Next</button>
                            </div>
                        </div>
                    )}

                    {step === 2 && (
                        <div className="wizard-step">
                            <h4>Step 2: Environment</h4>
                            <label>Where is the job located / what industry?</label>
                            <select value={answers.environment} onChange={(e) => setAnswers({ ...answers, environment: e.target.value })}>
                                <option value="">Select Environment...</option>
                                <option value="NASA / Aerospace">NASA / Aerospace</option>
                                <option value="Military Base">Military Base</option>
                                <option value="Power Plant / Nuclear">Power Plant / Nuclear</option>
                                <option value="Offshore Oil & Gas">Offshore Oil & Gas</option>
                                <option value="Mining Site">Mining Site</option>
                                <option value="Commercial Maritime">Commercial Maritime</option>
                                <option value="General Industrial Construction">General Industrial Construction</option>
                            </select>
                            <div className="wizard-actions">
                                <button className="action-btn secondary" onClick={handleBack}>Back</button>
                                <button className="action-btn" onClick={handleNext} disabled={!answers.environment}>Next</button>
                            </div>
                        </div>
                    )}

                    {step === 3 && (
                        <div className="wizard-step">
                            <h4>Step 3: Test Requirements</h4>
                            <label>Required % of Working Load Limit (WLL)?</label>
                            <select value={answers.wllPercentage} onChange={(e) => setAnswers({ ...answers, wllPercentage: e.target.value })}>
                                <option value="100%">100%</option>
                                <option value="110%">110%</option>
                                <option value="125%">125%</option>
                                <option value="150%">150%</option>
                                <option value="Other">Other (specify in context)</option>
                            </select>
                            <div className="wizard-actions">
                                <button className="action-btn secondary" onClick={handleBack}>Back</button>
                                <button className="action-btn" onClick={handleNext}>Next</button>
                            </div>
                        </div>
                    )}

                    {step === 4 && (
                        <div className="wizard-step">
                            <h4>Step 4: Additional Context</h4>
                            <label>Any other details? (e.g. specific customer requirements)</label>
                            <textarea
                                value={answers.context}
                                onChange={(e) => setAnswers({ ...answers, context: e.target.value })}
                                placeholder="e.g. First annual inspection, post-repair test..."
                            />
                            <div className="wizard-actions">
                                <button className="action-btn secondary" onClick={handleBack}>Back</button>
                                <button className="action-btn" onClick={handleSubmit} disabled={loading}>
                                    {loading ? 'Consulting AI...' : 'Get Determination'}
                                </button>
                            </div>
                        </div>
                    )}

                    {step === 5 && (
                        <div className="wizard-step">
                            <h4>AI Determination</h4>
                            {result && result.standards && result.standards.length > 0 ? (
                                <div className="ai-results-list">
                                    <p style={{ fontSize: '0.9rem', marginBottom: '15px' }}>
                                        {result.generalExplanation || "The following standards were identified as applicable. Select the ones you want to apply to the certificate:"}
                                    </p>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '300px', overflowY: 'auto', padding: '5px' }}>
                                        {result.standards.map((std, idx) => (
                                            <label
                                                key={idx}
                                                className={`standard-selection-card ${selectedStandards.has(std.referenceId) ? 'selected' : ''}`}
                                                style={{
                                                    display: 'flex',
                                                    gap: '12px',
                                                    padding: '12px',
                                                    background: 'rgba(255,255,255,0.05)',
                                                    border: `1px solid ${selectedStandards.has(std.referenceId) ? 'var(--yellow-accent)' : 'rgba(255,255,255,0.1)'}`,
                                                    borderRadius: '6px',
                                                    cursor: 'pointer',
                                                    transition: 'all 0.2s'
                                                }}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={selectedStandards.has(std.referenceId)}
                                                    onChange={(e) => {
                                                        const next = new Set(selectedStandards);
                                                        if (e.target.checked) next.add(std.referenceId);
                                                        else next.delete(std.referenceId);
                                                        setSelectedStandards(next);
                                                    }}
                                                    style={{ marginTop: '3px' }}
                                                />
                                                <div>
                                                    <div style={{ fontWeight: 'bold', color: 'var(--yellow-accent)', fontSize: '1rem' }}>{std.referenceId}</div>
                                                    <div style={{ fontSize: '0.8rem', fontStyle: 'italic', marginTop: '4px', opacity: 0.8 }}>{std.explanation}</div>
                                                </div>
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            ) : result ? (
                                <div className="ai-result-box">
                                    <div className="concise-result" style={{ fontSize: '1.2rem', color: 'var(--yellow-accent)', marginBottom: '15px' }}>
                                        <strong>Applied Reference:</strong> {result.referenceId || result}
                                    </div>
                                    <div className="explanation-result" style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '15px', fontStyle: 'italic', fontSize: '0.9rem' }}>
                                        <strong>Explanation:</strong><br />
                                        {result.explanation || result.generalExplanation || "No additional explanation provided."}
                                    </div>
                                </div>
                            ) : null}
                            <div className="wizard-actions">
                                <button className="action-btn secondary" onClick={() => { setStep(1); setSelectedStandards(new Set()); }}>Try Again</button>
                                <button
                                    className="action-btn"
                                    onClick={() => {
                                        if (selectedStandards.size > 0) {
                                            onComplete(Array.from(selectedStandards).join(', '));
                                        } else if (result.referenceId || (typeof result === 'string')) {
                                            onComplete(result.referenceId || result);
                                        }
                                    }}
                                    disabled={selectedStandards.size === 0 && !result.referenceId && typeof result !== 'string'}
                                >
                                    Apply to Certificate
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

const CertificateView = ({ data, jobId, onUpdateMetadata, onPreviewModeChange, selectedJob, xUnit, displayUnit }) => {
    // data is actually the job object now due to activeJob refactor
    const job = data;
    const dataSets = job?.dataSets || [];
    const firstData = dataSets[0]?.data || [];

    console.log("CertificateView Render:", { jobId, jobMetadataId: job?.id, draftCount: job?.metadata?.drafts?.length });

    const [formData, setFormData] = useState({
        soldTo: '',
        facilityLocation: '',
        customerPO: '',
        buyer: '',
        projectRef: '',
        testDate: new Date().toISOString().split('T')[0],
        projectMgr: '',
        certNo: '',
        instruments: [{
            instrument: '',
            capacity: '',
            serialNo: '',
            dataLink: '',
            accuracy: '',
            targetLoad: ''
        }],
        equipmentTested: '',
        equipmentManufacturer: '',
        equipmentSerial: '',
        equipmentWll: '',
        procedureSummary: '',
        referenceStandards: '',
        numTests: 1,
        testResults: 'PASS',
        tests: Array(10).fill(null).map(() => ({
            loadType: 'Static',
            wllPercentage: '100%',
            measuredForce: null,
            localTime: null,
            testDuration: '',
            accept: 'YES',
            testResults: 'PASS',
            hookTested: 'Main Hook',
            itemDescription: ''
        })),
        photos: [],
        hasAuxHook: false,
        auxHookWll: '',
        graphPageBreaks: {}, // { dataSetIndex: boolean }
        sectionOrder: ['header', 'infoGrid', 'testTable', 'footer', 'graphs', 'photos']
    });

    const [isPreview, setIsPreview] = useState(false);
    const [showAiWizard, setShowAiWizard] = useState(false);

    // --- Drag-and-Drop Section Reordering ---
    const dragItem = useRef(null);
    const dragOverItem = useRef(null);
    const [dragOverId, setDragOverId] = useState(null);
    const [draggingId, setDraggingId] = useState(null);

    const handleDragStart = (sectionId) => {
        dragItem.current = sectionId;
        setDraggingId(sectionId);
    };

    const handleDragOver = (e, sectionId) => {
        e.preventDefault();
        dragOverItem.current = sectionId;
        setDragOverId(sectionId);
    };

    const handleDragEnd = () => {
        if (dragItem.current && dragOverItem.current && dragItem.current !== dragOverItem.current) {
            setFormData(prev => {
                const order = [...(prev.sectionOrder || ['header', 'infoGrid', 'testTable', 'footer', 'graphs', 'photos'])];
                const fromIdx = order.indexOf(dragItem.current);
                const toIdx = order.indexOf(dragOverItem.current);
                if (fromIdx !== -1 && toIdx !== -1) {
                    order.splice(fromIdx, 1);
                    order.splice(toIdx, 0, dragItem.current);
                }
                return { ...prev, sectionOrder: order };
            });
        }
        dragItem.current = null;
        dragOverItem.current = null;
        setDragOverId(null);
        setDraggingId(null);
    };

    const sectionLabel = (id) => {
        const labels = { header: 'Header', infoGrid: 'Details', testTable: 'Test Table', footer: 'Signature', graphs: 'Graphs', photos: 'Photos' };
        return labels[id] || id;
    };

    // We compute stats for each dataset individually for the preview
    const allChartStats = useMemo(() => {
        const serials = formData.instruments?.map(inst => inst.serialNo).filter(Boolean).flatMap(s => s.split(/[, \s]+/)) || [];
        return dataSets.map(ds => processChartData(ds.data, serials, displayUnit, xUnit));
    }, [dataSets, formData.instruments, displayUnit, xUnit]);

    // chartStats (legacy single) points to the first one for auto-fill logic
    const chartStats = allChartStats[0] || null;

    useEffect(() => {
        // Cleanup: ensure preview mode is turned off when unmounting
        return () => {
            if (onPreviewModeChange) onPreviewModeChange(false);
        };
    }, []);

    useEffect(() => {
        const load = async () => {
            const saved = await window.electronAPI.loadData('cert-info.json');

            setFormData(prev => {
                let current = { ...prev };

                // 1. Try Loading from job-specific metadata first
                if (job?.metadata?.certData) {
                    current = { ...current, ...job.metadata.certData };
                } else if (saved) {
                    // 2. Fall back to global scratchpad (cert-info.json)
                    current = { ...current, ...saved };
                }

                // Ensure we have at least 10 test slots even if old data had fewer
                if (current.tests && current.tests.length < 10) {
                    const extra = Array(10 - current.tests.length).fill(null).map(() => ({
                        loadType: 'Static',
                        wllPercentage: '100%',
                        measuredForce: null,
                        localTime: null,
                        testDuration: '',
                        accept: 'YES',
                        testResults: 'PASS',
                        hookTested: 'Main Hook',
                        itemDescription: ''
                    }));
                    current.tests = [...current.tests, ...extra];
                }

                // Migrate legacy single instrument to array if needed
                if (!current.instruments && (current.instrument || current.serialNo)) {
                    current.instruments = [{
                        instrument: current.instrument || '',
                        capacity: current.capacity || '',
                        serialNo: current.serialNo || '',
                        dataLink: current.dataLink || '',
                        accuracy: current.accuracy || '',
                        targetLoad: current.targetLoad || ''
                    }];
                    delete current.instrument;
                    delete current.capacity;
                    delete current.serialNo;
                    delete current.dataLink;
                    delete current.accuracy;
                    delete current.targetLoad;
                }

                // Metadata always takes priority when data changes
                if (job?.metadata) {
                    current = {
                        ...current,
                        projectRef: job.metadata.jobNumber || current.projectRef,
                        soldTo: job.metadata.leadCompany || job.metadata.customer || current.soldTo,
                        customerPO: job.metadata.poNumber || current.customerPO,
                        buyer: job.metadata.customer || current.buyer
                    };
                } else if (selectedJob) {
                    // Fallback to currently selected SharePoint job if no recorded data exists
                    current = {
                        ...current,
                        projectRef: selectedJob.QuoteNum || '',
                        soldTo: selectedJob.LeadCompany || selectedJob.Customer || '',
                        customerPO: selectedJob.PONumber || '',
                        buyer: selectedJob.Customer || selectedJob.LeadName || '',
                        facilityLocation: selectedJob.Location || selectedJob.JobLocation || selectedJob.ShippingAddress || ''
                    };
                }

                // Update peak stats from chart if data is present
                if (firstData && firstData.length > 0) {
                    const serials = current.instruments?.map(inst => inst.serialNo).filter(Boolean).flatMap(s => s.split(/[, \s]+/)) || [];
                    const stats = processChartData(firstData, serials);
                    if (stats) {
                        const updatedTests = [...current.tests];

                        // Auto-fill first record ONLY if it has never been set (null = untouched)
                        if (updatedTests[0].measuredForce === null) {
                            updatedTests[0].measuredForce = stats.maxWeight.toFixed(0);
                        }
                        if (updatedTests[0].localTime === null) {
                            updatedTests[0].localTime = stats.peakTime;
                        }
                        if (updatedTests[0].testDuration === null || updatedTests[0].testDuration === '') {
                            updatedTests[0].testDuration = stats.totalTime.toFixed(0);
                        }

                        current.tests = updatedTests;
                        if (!current.equipmentWll) {
                            current.equipmentWll = stats.maxWeight.toFixed(0) + ' lbs';
                        }
                    }
                }

                return current;
            });
        };
        load();
    }, [jobId, selectedJob, firstData.length]);

    const handleInstrumentInput = (index, name, value) => {
        const newInstruments = [...formData.instruments];
        newInstruments[index] = { ...newInstruments[index], [name]: value };
        const newFormData = { ...formData, instruments: newInstruments };
        setFormData(newFormData);
        if (onUpdateMetadata) {
            onUpdateMetadata(jobId, { certData: newFormData });
        }
        window.electronAPI.saveData(newFormData, 'cert-info.json');
    };

    const addInstrument = () => {
        const newInstruments = [...formData.instruments, {
            instrument: '', capacity: '', serialNo: '', dataLink: '', accuracy: '', targetLoad: ''
        }];
        const newFormData = { ...formData, instruments: newInstruments };
        setFormData(newFormData);
        if (onUpdateMetadata) {
            onUpdateMetadata(jobId, { certData: newFormData });
        }
    };

    const removeInstrument = (index) => {
        if (formData.instruments.length <= 1) return;
        const newInstruments = formData.instruments.filter((_, i) => i !== index);
        const newFormData = { ...formData, instruments: newInstruments };
        setFormData(newFormData);
        if (onUpdateMetadata) {
            onUpdateMetadata(jobId, { certData: newFormData });
        }
    };

    const handleInput = (e) => {
        const { name, value } = e.target;
        const newFormData = { ...formData, [name]: value };
        setFormData(newFormData);
        window.electronAPI.saveData(newFormData, 'cert-info.json');
    };

    const handleTestInput = (index, name, value) => {
        const newTests = [...formData.tests];
        newTests[index] = { ...newTests[index], [name]: value };
        const newFormData = { ...formData, tests: newTests };
        setFormData(newFormData);
        window.electronAPI.saveData(newFormData, 'cert-info.json');
    };

    const toggleGraphPageBreak = (datasetIdx) => {
        setFormData(prev => {
            const newGraphPageBreaks = {
                ...prev.graphPageBreaks,
                [datasetIdx]: !prev.graphPageBreaks[datasetIdx]
            };
            const newFormData = { ...prev, graphPageBreaks: newGraphPageBreaks };
            // Persist to job-specific metadata
            if (onUpdateMetadata) {
                onUpdateMetadata(jobId, { certData: newFormData });
            }
            window.electronAPI.saveData(newFormData, 'cert-info.json');
            return newFormData;
        });
    };

    const compressImage = (base64Str, maxWidth = 1024, maxHeight = 1024, quality = 0.7) => {
        return new Promise((resolve) => {
            const img = new Image();
            img.src = base64Str;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                if (width > height) {
                    if (width > maxWidth) {
                        height *= maxWidth / width;
                        width = maxWidth;
                    }
                } else {
                    if (height > maxHeight) {
                        width *= maxHeight / height;
                        height = maxHeight;
                    }
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);
                resolve(canvas.toDataURL('image/jpeg', quality));
            };
        });
    };

    const onPhotoChange = async (e) => {
        const files = Array.from(e.target.files);
        for (const file of files) {
            const reader = new FileReader();
            const base64 = await new Promise((resolve) => {
                reader.onload = (event) => resolve(event.target.result);
                reader.readAsDataURL(file);
            });

            // Compress immediately
            const compressed = await compressImage(base64);

            setFormData(prev => {
                const newPhotos = [...(prev.photos || []), compressed].slice(0, 4);
                const newFormData = { ...prev, photos: newPhotos };
                if (onUpdateMetadata) {
                    onUpdateMetadata(jobId, { certData: newFormData });
                }
                return newFormData;
            });
        }
    };

    const removePhoto = (index) => {
        setFormData(prev => {
            const newPhotos = (prev.photos || []).filter((_, i) => i !== index);
            const newFormData = { ...prev, photos: newPhotos };
            if (onUpdateMetadata) {
                onUpdateMetadata(jobId, { certData: newFormData });
            }
            window.electronAPI.saveData(newFormData, 'cert-info.json');
            return newFormData;
        });
    };

    const handleSaveDraft = () => {
        const draftName = prompt("Enter a name for this draft:", `Draft ${new Date().toLocaleString()}`);
        if (!draftName) return;

        const newDraft = {
            name: draftName,
            data: { ...formData }, // clone
            timestamp: Date.now()
        };

        const existingDrafts = job?.metadata?.drafts || [];
        const newDrafts = [newDraft, ...existingDrafts];

        console.log("Saving Draft:", { jobId, draftName, newDraftCount: newDrafts.length });

        if (onUpdateMetadata) {
            onUpdateMetadata(jobId, { drafts: newDrafts });
        }
        alert("Draft saved successfully!");
    };

    const handleLoadDraft = (draft) => {
        if (window.confirm(`Load draft "${draft.name}"? This will replace your current unsaved editor content.`)) {
            setFormData(draft.data);
            // Also update the active certData so the "current" state is saved
            if (onUpdateMetadata) {
                onUpdateMetadata(jobId, { certData: draft.data });
            }
        }
    };

    const handleRemoveDraft = (e, index) => {
        e.stopPropagation();
        if (window.confirm("Are you sure you want to delete this draft?")) {
            const newDrafts = job.metadata.drafts.filter((_, i) => i !== index);
            if (onUpdateMetadata) {
                onUpdateMetadata(jobId, { drafts: newDrafts });
            }
        }
    };

    const finalizePDF = async () => {
        await window.electronAPI.savePDF(`Certificate_${formData.certNo || 'Draft'}`);
    };

    const showPreview = () => {
        // Sync cert form data to job metadata when previewing (deferred from per-keystroke)
        if (onUpdateMetadata) {
            onUpdateMetadata(jobId, { certData: formData });
        }
        setIsPreview(true);
        if (onPreviewModeChange) onPreviewModeChange(true);
    };

    if (isPreview) {
        return (
            <div className="preview-mode">
                <div className="preview-actions no-print">
                    <div className="preview-tip">
                        <strong>Preview Mode:</strong> Review the details below. This is exactly how the PDF will look.
                    </div>
                    <div className="btn-group">
                        <button onClick={() => { setIsPreview(false); if (onPreviewModeChange) onPreviewModeChange(false); }} className="action-btn secondary" style={{ fontWeight: 'bold', border: '2px solid' }}>
                            ← EXIT PREVIEW (Back to Editor)
                        </button>
                        <button onClick={finalizePDF} className="action-btn" style={{ background: '#1a3a6c' }}>
                            💾 Finalize & Save PDF
                        </button>
                    </div>
                </div>
                <div className="certificate-paper" style={{ paddingLeft: '44px' }}>
                    {(() => {
                        const sections = formData.sectionOrder || ['header', 'infoGrid', 'testTable', 'footer', 'graphs', 'photos'];
                        const isMain = (id) => ['header', 'infoGrid', 'testTable', 'footer'].includes(id);

                        const renderSectionContent = (sectionId) => {
                            let content = null;
                            switch (sectionId) {
                                case 'header':
                                    content = (
                                        <>
                                            <div className="cert-header">
                                                <div className="logo-group">
                                                    <img src={logo} alt="Hydro-Wates Logo" className="cert-logo" style={{ height: '42px', objectFit: 'contain', marginBottom: '2px' }} />
                                                </div>
                                                <div className="header-info">
                                                    <strong>Providing Proof-Load Testing Services</strong><br />
                                                    to the Maritime, Petroleum, & Heavy<br />
                                                    Construction Industries - Worldwide
                                                </div>
                                                <div className="contact-info">
                                                    <strong>8100 Lockheed Avenue</strong><br />
                                                    Houston, Texas 77061<br />
                                                    Tel: (713) 643-9990
                                                </div>
                                            </div>
                                            <h1 className="cert-title">PROOF-LOAD TEST CERTIFICATE</h1>
                                        </>
                                    );
                                    break;
                                case 'infoGrid':
                                    content = (
                                        <div className="cert-grid-main">
                                            <div className="cert-box">
                                                <div className="label-top">SOLD TO:</div>
                                                <div className="content-multiline">{formData.soldTo}</div>
                                            </div>
                                            <div className="cert-box">
                                                <div className="label-top">TEST FACILITY & LOCATION:</div>
                                                <div className="content-multiline">{formData.facilityLocation}</div>
                                            </div>
                                            <div className="cert-row-5">
                                                <div className="cert-box"><div className="label-top">Customer P.O.</div><div className="content-center">{formData.customerPO}</div></div>
                                                <div className="cert-box"><div className="label-top">Buyer</div><div className="content-center">{formData.buyer}</div></div>
                                                <div className="cert-box"><div className="label-top">HWI Project Ref.</div><div className="content-center">{formData.projectRef}</div></div>
                                                <div className="cert-box"><div className="label-top">Test Date</div><div className="content-center">{formData.testDate}</div></div>
                                                <div className="cert-box"><div className="label-top">Project Mgr.</div><div className="content-center">{formData.projectMgr}</div></div>
                                                <div className="cert-box"><div className="label-top">Certificate No.</div><div className="content-center">{formData.certNo}</div></div>
                                            </div>
                                            <div className="cert-row-6" style={{ flexDirection: 'column', border: 'none', borderTop: '1.5px solid #000', marginTop: '12px' }}>
                                                <div className="cert-row-6" style={{ borderBottom: '1px solid #000', backgroundColor: '#f9f9f9' }}>
                                                    <div className="cert-box"><div className="label-top">Instrument</div></div>
                                                    <div className="cert-box"><div className="label-top">Capacity</div></div>
                                                    <div className="cert-box"><div className="label-top">Serial No.</div></div>
                                                    <div className="cert-box"><div className="label-top">Data Link</div></div>
                                                    <div className="cert-box"><div className="label-top">Accuracy</div></div>
                                                    <div className="cert-box"><div className="label-top">Target Load</div></div>
                                                </div>
                                                {formData.instruments?.map((inst, i) => (
                                                    <div key={i} className="cert-row-6" style={{ borderBottom: i < formData.instruments.length - 1 ? '1px solid #000' : 'none' }}>
                                                        <div className="cert-box"><div className="content-center">{inst.instrument}</div></div>
                                                        <div className="cert-box"><div className="content-center">{inst.capacity}</div></div>
                                                        <div className="cert-box"><div className="content-center">{inst.serialNo}</div></div>
                                                        <div className="cert-box"><div className="content-center">{inst.dataLink}</div></div>
                                                        <div className="cert-box"><div className="content-center">{inst.accuracy}</div></div>
                                                        <div className="cert-box"><div className="content-center">{inst.targetLoad}</div></div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    );
                                    break;
                                case 'testTable':
                                    content = (
                                        <table className="cert-table">
                                            <thead>
                                                <tr>
                                                    <th style={{ width: '40px' }}>Item</th>
                                                    <th>Item Description</th>
                                                    <th style={{ width: '80px' }}>Local Time</th>
                                                    <th style={{ width: '80px' }}>Test Dur.</th>
                                                    <th style={{ width: '100px' }}>Measured Force</th>
                                                    <th style={{ width: '60px' }}>Accept</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                <tr>
                                                    <td></td>
                                                    <td className="text-left" style={{ paddingBottom: '8px' }}>
                                                        <div style={{ display: 'flex', flexWrap: 'wrap', columnGap: '15px', rowGap: '2px', marginBottom: '4px', fontSize: '0.75rem' }}>
                                                            <div><strong style={{ color: '#555' }}>Manufacturer:</strong> {formData.equipmentManufacturer || 'N/A'}</div>
                                                            <div><strong style={{ color: '#555' }}>S/N:</strong> {formData.equipmentSerial || 'N/A'}</div>
                                                            <div><strong style={{ color: '#555' }}>WLL:</strong> {formData.equipmentWll || 'N/A'}</div>
                                                        </div>
                                                        <div style={{ marginBottom: '4px', fontSize: '0.75rem' }}><strong>Reference Standards:</strong> {formData.referenceStandards}</div>
                                                        {formData.hasAuxHook && (
                                                            <div style={{ marginBottom: '4px', fontSize: '0.75rem' }}><strong>Auxiliary Hook WLL:</strong> {formData.auxHookWll || 'N/A'}</div>
                                                        )}
                                                        <div style={{ marginTop: '4px', fontSize: '0.75rem' }}>
                                                            <strong>Procedure Summary:</strong><br />
                                                            <div style={{ fontSize: '0.62rem', fontStyle: 'italic', lineHeight: '1.2', marginTop: '2px' }}>
                                                                {formData.procedureSummary}
                                                            </div>
                                                        </div>
                                                    </td>
                                                    <td></td>
                                                    <td></td>
                                                    <td></td>
                                                    <td></td>
                                                </tr>
                                                {formData.tests
                                                    .slice(0, parseInt(formData.numTests))
                                                    .map((test, index) => (
                                                        <tr key={index}>
                                                            <td style={{ verticalAlign: 'top', paddingTop: '8px' }}>{index + 1}</td>
                                                            <td className="text-left" style={{ paddingTop: '8px', paddingBottom: '8px' }}>
                                                                <div className="font-bold" style={{ fontSize: '0.95rem', color: '#1a3a6c', borderBottom: '1px solid #1a3a6c', paddingBottom: '1px', marginBottom: '4px' }}>
                                                                    {test.itemDescription || formData.equipmentTested}
                                                                </div>
                                                                <div style={{ fontSize: '0.75rem', marginTop: '2px' }}>
                                                                    <strong>Hook:</strong> {test.hookTested || 'Main Hook'} | <strong>Type:</strong> {test.loadType}
                                                                </div>
                                                                <div className="font-bold" style={{ marginTop: '4px', color: '#1a3a6c', fontSize: '0.8rem' }}>
                                                                    TEST LOAD: {test.wllPercentage || '100%'} WLL
                                                                </div>
                                                            </td>
                                                            <td style={{ verticalAlign: 'middle', paddingTop: '8px' }}>{test.localTime}</td>
                                                            <td style={{ verticalAlign: 'middle', paddingTop: '8px' }}>{test.testDuration}</td>
                                                            <td className="force-val" style={{ fontSize: '1rem', verticalAlign: 'middle', paddingTop: '8px' }}>{test.measuredForce} lbs</td>
                                                            <td className="accept-val" style={{ color: test.testResults === 'PASS' ? '#006600' : '#cc0000', verticalAlign: 'middle', paddingTop: '8px' }}>{test.accept}</td>
                                                        </tr>
                                                    ))}
                                            </tbody>
                                        </table>
                                    );
                                    break;
                                case 'footer':
                                    content = (
                                        <>
                                            <div className="cert-footer-grid" style={{ marginTop: '8px' }}>
                                                <div className="cert-box">
                                                    <div className="label-top">Project Manager:</div>
                                                    <div className="content-val">{formData.projectMgr}</div>
                                                </div>
                                                <div className="cert-box">
                                                    <div className="label-top">Date:</div>
                                                    <div className="content-val">{formData.testDate}</div>
                                                </div>
                                                <div className="cert-box signature-row">
                                                    <div className="label-top">Signature:</div>
                                                    <div className="signature-font">{formData.projectMgr}</div>
                                                </div>
                                                <div className="cert-box">
                                                    <div className="label-top">Test Results:</div>
                                                    <div className="content-val font-bold">{formData.testResults}</div>
                                                </div>
                                            </div>
                                            <div style={{ marginTop: '4px', fontSize: '0.68rem', color: '#444', fontStyle: 'italic', textAlign: 'center', lineHeight: '1.2', borderTop: '0.5px solid #eee', paddingTop: '6px' }}>
                                                Scofield Group, LLC is not a Class Certified Surveyor nor OSHA Part 1919 Accredited Agency and makes no claim of equipment structural conformance as a result of load testing services performed.
                                            </div>
                                        </>
                                    );
                                    break;
                                case 'graphs':
                                    if (allChartStats.length === 0) return null;
                                    content = (
                                        <>
                                            {allChartStats.map((stats, idx) => (
                                                <div key={idx} className="cert-chart-section" style={{
                                                    pageBreakInside: 'avoid',
                                                    breakInside: 'avoid',
                                                    pageBreakBefore: formData.graphPageBreaks[idx] ? 'always' : 'auto',
                                                    breakBefore: formData.graphPageBreaks[idx] ? 'page' : 'auto',
                                                    marginTop: '20px'
                                                }}>
                                                    <div className="cert-chart-header">
                                                        {allChartStats.length > 1 ? `LOAD TEST GRAPH #${idx + 1} (${dataSets[idx]?.name || 'N/A'})` : (dataSets[idx]?.name || 'LOAD TEST GRAPH')}
                                                    </div>
                                                    <div className="cert-chart-container" style={{ height: '280px' }}>
                                                        <Line
                                                            data={stats.chartData}
                                                            options={{
                                                                responsive: true,
                                                                maintainAspectRatio: false,
                                                                animation: false,
                                                                elements: {
                                                                    line: { fill: false, borderColor: '#1a3a6c', borderWidth: 2, tension: 0.1 },
                                                                    point: { radius: 0 }
                                                                },
                                                                plugins: {
                                                                    legend: {
                                                                        display: stats.chartData.datasets.length > 1,
                                                                        position: 'top',
                                                                        labels: { boxWidth: 10, font: { size: 8, weight: 'bold' }, color: '#000' }
                                                                    },
                                                                    title: { display: false }
                                                                },
                                                                scales: {
                                                                    x: {
                                                                        display: true,
                                                                        title: { display: true, text: `Elapsed Time (${xUnit === 'hour' ? 'hr' : 'min'})`, font: { size: 9, weight: 'bold' } },
                                                                        ticks: { font: { size: 7 }, maxTicksLimit: 12 },
                                                                        grid: { color: '#eee' }
                                                                    },
                                                                    y: {
                                                                        display: true,
                                                                        beginAtZero: true,
                                                                        title: { display: true, text: dataSets[idx]?.yAxisLabel || `Weight (${displayUnit})`, font: { size: 9, weight: 'bold' } },
                                                                        ticks: { font: { size: 7 } },
                                                                        grid: { color: '#eee' }
                                                                    }
                                                                }
                                                            }}
                                                        />
                                                    </div>
                                                </div>
                                            ))}
                                        </>
                                    );
                                    break;
                                case 'photos':
                                    if (!formData.photos || formData.photos.length === 0) return null;
                                    content = (
                                        <div className="cert-photos-section">
                                            <div className="cert-photos-header">SITE PHOTOS</div>
                                            <div className="cert-photos-grid">
                                                {formData.photos.map((photo, index) => (
                                                    <div key={index} className="cert-photo-item">
                                                        <img src={photo} alt={`Site photo ${index + 1}`} />
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    );
                                    break;
                                default:
                                    return null;
                            }
                            if (!content) return null;
                            return (
                                <div
                                    key={sectionId}
                                    className={`cert-section-wrapper${draggingId === sectionId ? ' dragging' : ''}`}
                                    data-section={sectionId}
                                    draggable
                                    onDragStart={() => handleDragStart(sectionId)}
                                    onDragOver={(e) => handleDragOver(e, sectionId)}
                                    onDragEnd={handleDragEnd}
                                >
                                    <div className="cert-drag-handle no-print" title={`Drag to reorder: ${sectionLabel(sectionId)}`}>⋮⋮</div>
                                    {dragOverId === sectionId && draggingId !== sectionId && <div className="cert-drop-indicator" />}
                                    {content}
                                </div>
                            );
                        };

                        const mainSections = sections.filter(isMain);
                        const otherSections = sections.filter(id => !isMain(id));

                        return (
                            <>
                                <div className="cert-main-page">
                                    {mainSections.map(id => renderSectionContent(id))}
                                </div>
                                <div className="cert-attachments">
                                    {otherSections.map(id => renderSectionContent(id))}
                                </div>
                            </>
                        );
                    })()}
                </div>

                {/* Remaining pages: Graphs and Photos */}
                {(() => {
                    const remainingSections = (formData.sectionOrder || ['header', 'infoGrid', 'testTable', 'footer', 'graphs', 'photos'])
                        .filter(id => ['graphs', 'photos'].includes(id));
                    const hasRemaining = remainingSections.some(id => {
                        if (id === 'graphs') return allChartStats.length > 0;
                        if (id === 'photos') return formData.photos && formData.photos.length > 0;
                        return false;
                    });
                    if (!hasRemaining) return null;
                    return (
                        <div className="certificate-paper" style={{ paddingLeft: '44px', pageBreakBefore: 'always', breakBefore: 'page' }}>
                            {remainingSections.map(sectionId => {
                                let content = null;
                                switch (sectionId) {
                                    case 'graphs':
                                        if (allChartStats.length === 0) return null;
                                        content = (
                                            <>
                                                {allChartStats.map((stats, idx) => (
                                                    <div key={idx} className="cert-chart-section" style={{
                                                        pageBreakInside: 'avoid',
                                                        breakInside: 'avoid',
                                                        pageBreakBefore: formData.graphPageBreaks[idx] ? 'always' : 'auto',
                                                        breakBefore: formData.graphPageBreaks[idx] ? 'page' : 'auto',
                                                        marginTop: '20px'
                                                    }}>
                                                        <div className="cert-chart-header">
                                                            {allChartStats.length > 1 ? `LOAD TEST GRAPH #${idx + 1} (${dataSets[idx]?.name || 'N/A'})` : (dataSets[idx]?.name || 'LOAD TEST GRAPH')}
                                                        </div>
                                                        <div className="cert-chart-container" style={{ height: '280px' }}>
                                                            <Line
                                                                data={stats.chartData}
                                                                options={{
                                                                    responsive: true,
                                                                    maintainAspectRatio: false,
                                                                    animation: false,
                                                                    elements: {
                                                                        line: { fill: false, borderColor: '#1a3a6c', borderWidth: 2, tension: 0.1 },
                                                                        point: { radius: 0 }
                                                                    },
                                                                    plugins: {
                                                                        legend: {
                                                                            display: stats.chartData.datasets.length > 1,
                                                                            position: 'top',
                                                                            labels: { boxWidth: 10, font: { size: 8, weight: 'bold' }, color: '#000' }
                                                                        },
                                                                        title: { display: false }
                                                                    },
                                                                    scales: {
                                                                        x: {
                                                                            display: true,
                                                                            title: { display: true, text: 'Elapsed Time (min)', font: { size: 9, weight: 'bold' } },
                                                                            ticks: { font: { size: 7 }, maxTicksLimit: 12 },
                                                                            grid: { color: '#eee' }
                                                                        },
                                                                        y: {
                                                                            display: true,
                                                                            beginAtZero: true,
                                                                            title: { display: true, text: dataSets[idx]?.yAxisLabel || 'Weight (lbs)', font: { size: 9, weight: 'bold' } },
                                                                            ticks: { font: { size: 7 } },
                                                                            grid: { color: '#eee' }
                                                                        }
                                                                    }
                                                                }}
                                                            />
                                                        </div>
                                                    </div>
                                                ))}
                                            </>
                                        );
                                        break;
                                    case 'photos':
                                        if (!formData.photos || formData.photos.length === 0) return null;
                                        content = (
                                            <div className="cert-photos-section">
                                                <div className="cert-photos-header">SITE PHOTOS</div>
                                                <div className="cert-photos-grid">
                                                    {formData.photos.map((photo, index) => (
                                                        <div key={index} className="cert-photo-item">
                                                            <img src={photo} alt={`Site photo ${index + 1}`} />
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        );
                                        break;
                                    default:
                                        return null;
                                }
                                if (!content) return null;
                                return <div key={sectionId}>{content}</div>;
                            })}
                        </div>
                    );
                })()}
            </div>
        );
    }

    return (
        <div className="certificate-form-container">
            <div className="cert-editor-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '20px', background: 'var(--bg-card)', padding: '20px', borderRadius: '10px', border: '1px solid var(--border)' }}>
                <div>
                    <h2 style={{ margin: 0, color: 'var(--yellow-accent)' }}>Certificate Editor</h2>
                    <p style={{ margin: '5px 0 0 0', fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                        Job: <strong style={{ color: 'white' }}>{job?.metadata?.jobNumber || 'N/A'}</strong>
                        <span style={{ marginLeft: '10px', fontSize: '0.7rem', opacity: 0.6 }}>ID: {jobId}</span>
                        <span style={{ marginLeft: '10px', padding: '2px 6px', background: 'var(--accent)', borderRadius: '4px', fontSize: '0.7rem' }}>
                            {job?.metadata?.drafts?.length || 0} Drafts
                        </span>
                    </p>
                </div>
                <div style={{ display: 'flex', gap: '15px', alignItems: 'center' }}>
                    <div className="draft-management" style={{ display: 'flex', gap: '10px', alignItems: 'center', borderRight: '1px solid var(--border)', paddingRight: '15px' }}>
                        <button
                            onClick={handleSaveDraft}
                            className="action-btn secondary small"
                            title="Save current progress as a new draft checkpoint"
                            style={{ cursor: 'pointer', position: 'relative', zIndex: 10 }}
                        >
                            💾 Save as Draft
                        </button>
                        <select
                            className="draft-select"
                            onChange={(e) => {
                                const idx = e.target.value;
                                if (idx !== "") handleLoadDraft(job.metadata.drafts[idx]);
                                e.target.value = ""; // Reset
                            }}
                            style={{ background: 'var(--bg-dark)', color: 'white', border: '1px solid var(--border)', padding: '5px 10px', borderRadius: '4px', cursor: 'pointer' }}
                        >
                            <option value="">-- Load Saved Draft --</option>
                            {job?.metadata?.drafts?.map((d, i) => (
                                <option key={i} value={i}>{d.name} ({new Date(d.timestamp).toLocaleDateString()})</option>
                            ))}
                        </select>
                    </div>
                    <button onClick={showPreview} className="action-btn large">
                        👁️ Preview Certificate
                    </button>
                </div>
            </div>

            <div className="form-grid">
                <section className="form-section">
                    <h3>Customer Info</h3>
                    <div className="form-group">
                        <label>Sold To</label>
                        <textarea name="soldTo" value={formData.soldTo} onChange={handleInput} />
                    </div>
                    <div className="form-group">
                        <label>Facility & Location</label>
                        <textarea name="facilityLocation" value={formData.facilityLocation} onChange={handleInput} />
                    </div>
                    <div className="form-row">
                        <div className="form-group">
                            <label>Customer P.O.</label>
                            <input name="customerPO" value={formData.customerPO} onChange={handleInput} />
                        </div>
                        <div className="form-group">
                            <label>Buyer</label>
                            <input name="buyer" value={formData.buyer} onChange={handleInput} />
                        </div>
                    </div>
                </section>

                <section className="form-section span-2">
                    <div className="section-header-row">
                        <h3>Instruments</h3>
                        <button onClick={addInstrument} className="action-btn small">
                            + Add Instrument
                        </button>
                    </div>
                    {formData.instruments?.map((inst, index) => (
                        <div key={index} className="instrument-entry-block" style={{ borderBottom: index < formData.instruments.length - 1 ? '1px solid var(--border)' : 'none', paddingBottom: '20px', marginBottom: '20px' }}>
                            <div className="section-header-row" style={{ marginTop: '10px' }}>
                                <h4 style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>Instrument #{index + 1}</h4>
                                {formData.instruments.length > 1 && (
                                    <button onClick={() => removeInstrument(index)} className="job-remove-btn" title="Remove Instrument">✕</button>
                                )}
                            </div>
                            <div className="form-row">
                                <div className="form-group" style={{ flex: 1 }}>
                                    <label>Instrument</label>
                                    <select value={inst.instrument} onChange={(e) => handleInstrumentInput(index, 'instrument', e.target.value)}>
                                        <option value="">Select Instrument...</option>
                                        <option value="Load Cell">Load Cell</option>
                                        <option value="Flow Meter">Flow Meter</option>
                                    </select>
                                </div>
                                <div className="form-group" style={{ flex: 1 }}>
                                    <label>Capacity</label>
                                    <input value={inst.capacity} onChange={(e) => handleInstrumentInput(index, 'capacity', e.target.value)} placeholder="e.g. 50 Tons" />
                                </div>
                                <div className="form-group" style={{ flex: 1 }}>
                                    <label>Serial No.</label>
                                    <input value={inst.serialNo} onChange={(e) => handleInstrumentInput(index, 'serialNo', e.target.value)} placeholder="S/N..." />
                                </div>
                            </div>
                            <div className="form-row">
                                <div className="form-group" style={{ flex: 1 }}>
                                    <label>Data Link</label>
                                    <select value={inst.dataLink} onChange={(e) => handleInstrumentInput(index, 'dataLink', e.target.value)}>
                                        <option value="">Select Data Link...</option>
                                        <option value="Wireless T24 Digital Handheld">Wireless T24 Digital Handheld</option>
                                        <option value="Analog">Analog</option>
                                        <option value="N/A">N/A</option>
                                    </select>
                                </div>
                                <div className="form-group" style={{ flex: 1 }}>
                                    <label>Accuracy</label>
                                    <select value={inst.accuracy} onChange={(e) => handleInstrumentInput(index, 'accuracy', e.target.value)}>
                                        <option value="">Select Accuracy...</option>
                                        <option value="+/- 0.2% FS">+/- 0.2% FS</option>
                                        <option value="N/A">N/A</option>
                                    </select>
                                </div>
                                <div className="form-group" style={{ flex: 1 }}>
                                    <label>Target Test Load</label>
                                    <input value={inst.targetLoad} onChange={(e) => handleInstrumentInput(index, 'targetLoad', e.target.value)} placeholder="e.g. 50 Tons" />
                                </div>
                            </div>
                        </div>
                    ))}
                    <div className="form-row">
                        <div className="form-group" style={{ flex: 1 }}>
                            <label>HWI Project Ref.</label>
                            <input name="projectRef" value={formData.projectRef} onChange={handleInput} />
                        </div>
                        <div className="form-group" style={{ flex: 1 }}>
                            <label>Cert No.</label>
                            <input name="certNo" value={formData.certNo} onChange={handleInput} />
                        </div>
                        <div className="form-group" style={{ flex: 1 }}>
                            <label>Project Manager</label>
                            <select name="projectMgr" value={formData.projectMgr} onChange={handleInput}>
                                <option value="">Select Manager...</option>
                                <option value="Michael Greenleaf">Michael Greenleaf</option>
                                <option value="Joseph Clark">Joseph Clark</option>
                                <option value="Vanoy Harris">Vanoy Harris</option>
                                <option value="Eric Wilkerson">Eric Wilkerson</option>
                                <option value="Reid Scofield">Reid Scofield</option>
                                <option value="Michael Scofield">Michael Scofield</option>
                            </select>
                        </div>
                    </div>
                </section>

                <section className="form-section span-2">
                    <div className="section-header-row">
                        <h3>Test Details & Description</h3>
                        <button onClick={() => setShowAiWizard(true)} className="action-btn small ai-btn">
                            <span className="ai-sparkle">✨</span> Find Reference Standard
                        </button>
                    </div>
                    {showAiWizard && (
                        <StandardFinder
                            onClose={() => setShowAiWizard(false)}
                            onComplete={(result) => {
                                handleInput({ target: { name: 'referenceStandards', value: result } });
                                setShowAiWizard(false);
                            }}
                        />
                    )}
                    <div className="form-row">
                        <div className="form-group">
                            <label>Industry Reference Standards</label>
                            <div className="standards-checkbox-group">
                                {['ASME B30', 'OSHA 29 CFR 1910.179'].map(std => {
                                    const standards = formData.referenceStandards ? formData.referenceStandards.split(',').map(s => s.trim()) : [];
                                    const isChecked = standards.includes(std);
                                    return (
                                        <label key={std} className="standard-checkbox-item">
                                            <input
                                                type="checkbox"
                                                checked={isChecked}
                                                onChange={(e) => {
                                                    let newStds = [...standards];
                                                    if (e.target.checked) newStds.push(std);
                                                    else newStds = newStds.filter(s => s !== std);
                                                    handleInput({ target: { name: 'referenceStandards', value: newStds.join(', ') } });
                                                }}
                                            />
                                            {std}
                                        </label>
                                    );
                                })}
                                <input
                                    name="manualStandard"
                                    value={formData.referenceStandards ? formData.referenceStandards.split(',').map(s => s.trim()).filter(s => !['ASME B30', 'OSHA 29 CFR 1910.179'].includes(s)).join(', ') : ''}
                                    onChange={(e) => {
                                        const manualVal = e.target.value;
                                        const coreStandards = (formData.referenceStandards ? formData.referenceStandards.split(',').map(s => s.trim()) : []).filter(s => ['ASME B30', 'OSHA 29 CFR 1910.179'].includes(s));
                                        const newValue = [...coreStandards, manualVal].filter(s => s.trim() !== '').join(', ');
                                        handleInput({ target: { name: 'referenceStandards', value: newValue } });
                                    }}
                                    placeholder="Enter other standards..."
                                    style={{ marginTop: '8px' }}
                                />
                            </div>
                        </div>
                        <div className="form-group" style={{ maxWidth: '160px' }}>
                            <label>Number of Tests</label>
                            <select name="numTests" value={formData.numTests} onChange={handleInput}>
                                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => (
                                    <option key={n} value={n}>{n} Test{n > 1 ? 's' : ''}</option>
                                ))}
                            </select>
                        </div>
                        <div className="form-group" style={{ maxWidth: '160px' }}>
                            <label>Overall Result</label>
                            <select name="testResults" value={formData.testResults} onChange={handleInput}>
                                <option value="PASS">PASS</option>
                                <option value="FAIL">FAIL</option>
                                <option value="CONDITIONAL">CONDITIONAL</option>
                            </select>
                        </div>
                    </div>
                    <div className="form-row">
                        <div className="form-group">
                            <label>Manufacturer</label>
                            <input name="equipmentManufacturer" value={formData.equipmentManufacturer} onChange={handleInput} placeholder="Equipment Manufacturer..." />
                        </div>
                        <div className="form-group">
                            <label>S/N</label>
                            <input name="equipmentSerial" value={formData.equipmentSerial} onChange={handleInput} placeholder="Equipment Serial Number..." />
                        </div>
                        <div className="form-group">
                            <label>WLL</label>
                            <input name="equipmentWll" value={formData.equipmentWll} onChange={handleInput} placeholder="Working Load Limit..." />
                        </div>
                    </div>
                    <div className="form-group">
                        <label>Procedure Summary</label>
                        <textarea name="procedureSummary" value={formData.procedureSummary} onChange={handleInput} rows="3" placeholder="Describe the testing procedure..." />
                    </div>
                </section>

                <section className="form-section span-2">
                    <h3>Crane Configuration (Optional)</h3>
                    <div className="form-row" style={{ alignItems: 'center' }}>
                        <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <input
                                type="checkbox"
                                name="hasAuxHook"
                                checked={formData.hasAuxHook}
                                onChange={(e) => handleInput({ target: { name: 'hasAuxHook', value: e.target.checked } })}
                                style={{ width: '20px', height: '20px' }}
                            />
                            <label style={{ margin: 0 }}>Does the crane have an auxiliary hook?</label>
                        </div>
                        {formData.hasAuxHook && (
                            <div className="form-group" style={{ flex: 1 }}>
                                <label>Aux Hook WLL</label>
                                <input
                                    name="auxHookWll"
                                    value={formData.auxHookWll}
                                    onChange={handleInput}
                                    placeholder="e.g., 10 Tons"
                                />
                            </div>
                        )}
                    </div>
                </section>

                <section className="form-section span-2">
                    <h3>Site Photos</h3>
                    <div className="photo-upload-container">
                        <div className="photo-grid-editor">
                            {formData.photos?.map((photo, index) => (
                                <div key={index} className="photo-thumb-wrapper">
                                    <img src={photo} alt={`Site photo ${index + 1}`} className="photo-thumb" />
                                    <button className="remove-photo-btn" onClick={() => removePhoto(index)}>✕</button>
                                </div>
                            ))}
                            {(!formData.photos || formData.photos.length < 4) && (
                                <label className="add-photo-card">
                                    <input type="file" accept="image/*" multiple onChange={onPhotoChange} style={{ display: 'none' }} />
                                    <div className="add-icon">+</div>
                                    <div className="add-text">Add Photo</div>
                                </label>
                            )}
                        </div>
                        <p className="helper-text">Add up to 4 photos to include in the certificate.</p>
                    </div>
                </section>

                <section className="form-section span-2">
                    <h3>Graph Layout & Page Breaks</h3>
                    <div className="page-break-controls" style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                        {dataSets.map((ds, idx) => (
                            <div key={idx} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                <input
                                    type="checkbox"
                                    checked={formData.graphPageBreaks[idx] || false}
                                    onChange={() => toggleGraphPageBreak(idx)}
                                    style={{ width: '18px', height: '18px' }}
                                />
                                <label style={{ margin: 0, fontSize: '0.9rem' }}>
                                    Force New Page before <strong>Graph #{idx + 1}: {ds.name}</strong>
                                </label>
                            </div>
                        ))}
                        {dataSets.length === 0 && <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>No graphs available to manage.</p>}
                    </div>
                </section>
            </div>

            {formData.tests.slice(0, parseInt(formData.numTests)).map((test, index) => (
                <section className="form-section" key={index} style={{ borderLeft: '4px solid var(--accent)' }}>
                    <h3>Test Record #{index + 1} {index === 0 && <span style={{ fontSize: '0.7rem', color: 'var(--yellow-accent)', marginLeft: '10px' }}>(Auto-Filled)</span>}</h3>
                    <div className="form-row">
                        <div className="form-group">
                            <label>Load Type</label>
                            <select value={test.loadType} onChange={(e) => handleTestInput(index, 'loadType', e.target.value)}>
                                <option value="Static">Static</option>
                                <option value="Dynamic">Dynamic</option>
                            </select>
                        </div>
                        <div className="form-group">
                            <label>% of WLL</label>
                            <input
                                value={test.wllPercentage}
                                onChange={(e) => handleTestInput(index, 'wllPercentage', e.target.value)}
                                placeholder="e.g. 100%"
                            />
                        </div>
                        <div className="form-group">
                            <label>Measured Force (lbs)</label>
                            <input
                                value={test.measuredForce || ''}
                                onChange={(e) => handleTestInput(index, 'measuredForce', e.target.value)}
                                className={index === 0 ? "auto-input" : ""}
                                placeholder="Enter Load..."
                            />
                        </div>
                        <div className="form-group">
                            <label>Accept</label>
                            <select value={test.accept} onChange={(e) => handleTestInput(index, 'accept', e.target.value)}>
                                <option value="YES">YES</option>
                                <option value="NO">NO</option>
                                <option value="N/A">N/A</option>
                            </select>
                        </div>
                        <div className="form-group">
                            <label>Hook Tested</label>
                            <input
                                list={`hook-suggestions-${index}`}
                                value={test.hookTested || ''}
                                onChange={(e) => handleTestInput(index, 'hookTested', e.target.value)}
                                placeholder="Select or type hook..."
                            />
                            <datalist id={`hook-suggestions-${index}`}>
                                <option value="Main Hook" />
                                <option value="Aux Hook" />
                            </datalist>
                        </div>
                        <div className="form-group" style={{ flex: 2 }}>
                            <label>Item Description (Overrides Header)</label>
                            <input
                                value={test.itemDescription || ''}
                                onChange={(e) => handleTestInput(index, 'itemDescription', e.target.value)}
                                placeholder="e.g. 50 Ton Linkage, Spreader Bar B..."
                            />
                        </div>
                    </div>
                    <div className="form-row">
                        <div className="form-group">
                            <label>Local Time (hr:min)</label>
                            <input value={test.localTime || ''} onChange={(e) => handleTestInput(index, 'localTime', e.target.value)} placeholder="00:00" />
                        </div>
                        <div className="form-group">
                            <label>Duration (min)</label>
                            <input
                                list={`duration-suggestions-${index}`}
                                value={test.testDuration || ''}
                                onChange={(e) => handleTestInput(index, 'testDuration', e.target.value)}
                                placeholder="Select or type duration..."
                            />
                            <datalist id={`duration-suggestions-${index}`}>
                                <option value="5 minutes" />
                                <option value="10 minutes" />
                                <option value="15 minutes" />
                            </datalist>
                        </div>
                    </div>
                </section>
            ))}

            <div className="form-actions mt-4" style={{ display: 'flex', justifyContent: 'center', padding: '40px 0', borderTop: '1px solid var(--border)' }}>
                <button onClick={showPreview} className="action-btn large" style={{ width: '500px', height: '60px', fontSize: '1.2rem' }}>
                    👁️ Preview Full Certificate
                </button>
            </div>
        </div>
    );
}

function JobSelector({ jobs, activeJobId, onSelect }) {
    if (!jobs || jobs.length === 0) return null;

    return (
        <div className="job-selector-container">
            <label>Current Job Data:</label>
            <select
                value={activeJobId}
                onChange={(e) => onSelect(e.target.value)}
                className="job-dropdown"
            >
                {jobs.map(job => (
                    <option key={job.id} value={job.id}>
                        {job.metadata.jobNumber || `Unnamed Job (${new Date(job.id).toLocaleDateString()})`}
                    </option>
                ))}
            </select>
            <span className="job-count-badge">{jobs.length} loaded</span>
        </div>
    );
}

function MainMenu({ onSelectMode, onOpenSettings }) {
    return (
        <div className="app-container">
            <header className="app-header">
                <div className="app-header-left">
                    <img src={logo} alt="Hydro-Wates" className="header-logo" />
                    <div className="brand-separator"></div>
                    <div className="brand-name">OSCAR 1.0</div>
                </div>
                <div className="app-header-right">
                    <button onClick={onOpenSettings} className="action-btn secondary circle" title="Settings">⚙️</button>
                </div>
            </header>
            <div className="main-menu-content">
                <div className="menu-header">
                    <h1>Welcome to OSCAR</h1>
                    <p>Operational Service & Certification Analysis Reporter</p>
                </div>
                <div className="menu-grid">
                    <div className="menu-card" onClick={() => onSelectMode('service')}>
                        <div className="icon">🛠️</div>
                        <div className="card-content">
                            <h2>Service</h2>
                            <p>Live Load Testing, Data Logging, and Certificate Generation.</p>
                        </div>
                        <div className="badge">ACTIVE</div>
                    </div>
                </div>
            </div>
        </div>
    );
}








function ServiceView({ onGoHome, onOpenSettings }) {
    const [activeTab, setActiveTab] = useState('welcome');
    const [allJobs, setAllJobs] = useState([]);
    const [activeJobId, setActiveJobId] = useState(null);
    const [deviceStatus, setDeviceStatus] = useState('disconnected');
    const [selectedSharePointJob, setSelectedSharePointJob] = useState(null); // Job selected from SharePoint for Live Data
    const [viewingCompany, setViewingCompany] = useState(null); // Company selected for detailed view
    const [importContext, setImportContext] = useState(null); // Job selected for CSV import
    const [recoverySession, setRecoverySession] = useState(null); // Recovered data points
    const [showRecoveryPrompt, setShowRecoveryPrompt] = useState(false);
    const [isCertPreview, setIsCertPreview] = useState(false);
    const [displayUnit, setDisplayUnit] = useState('lbs');
    const [displayTimeUnit, setDisplayTimeUnit] = useState('min');
    const [xUnit, setXUnit] = useState('min');

    // --- Lifted Live Telemetry & Logging State ---
    const [devices, setDevices] = useState({}); // tag -> latest packet
    const [selectedTags, setSelectedTags] = useState(Array(10).fill(null));
    const [cellCount, setCellCount] = useState(1);
    const [isLogging, setIsLogging] = useState(false);
    const [loggedData, setLoggedData] = useState([]);
    const [logInterval, setLogInterval] = useState(0); // ms
    const [keepAwake, setKeepAwake] = useState(false);
    const [previewData, setPreviewData] = useState([]); // Rolling buffer for preview

    // Refs for IPC listener access
    const [saveStatus, setSaveStatus] = useState('synced'); // 'synced' | 'saving' | 'error'
    const devicesRef = useRef({});
    const selectedTagsRef = useRef(selectedTags);
    const cellCountRef = useRef(cellCount);
    const isLoggingRef = useRef(isLogging);
    const logIntervalRef = useRef(logInterval);
    const lastLoggedTimesRef = useRef({}); // tag -> time

    useEffect(() => { selectedTagsRef.current = selectedTags; }, [selectedTags]);
    useEffect(() => { cellCountRef.current = cellCount; }, [cellCount]);
    useEffect(() => {
        isLoggingRef.current = isLogging;
        if (!isLogging) lastLoggedTimesRef.current = {};
    }, [isLogging]);
    useEffect(() => { logIntervalRef.current = logInterval; }, [logInterval]);

    // Central Live Data Listener
    useEffect(() => {
        if (window.electronAPI.onLiveData) {
            const removeListener = window.electronAPI.onLiveData((packet) => {
                devicesRef.current = { ...devicesRef.current, [packet.tag]: packet };
                setDevices({ ...devicesRef.current });

                const activeTags = selectedTagsRef.current.slice(0, cellCountRef.current);
                if (isLoggingRef.current && activeTags.includes(packet.tag)) {
                    setLoggedData(prev => {
                        const firstTimestamp = prev.length > 0 ? prev[0].timestamp : packet.timestamp;
                        let currentTotal = 0;
                        activeTags.forEach(tag => {
                            if (!tag) return;
                            if (tag === packet.tag) currentTotal += packet.value;
                            else if (devicesRef.current[tag]) currentTotal += devicesRef.current[tag].value;
                        });

                        return [...prev, {
                            ...packet,
                            "Total Load": currentTotal,
                            "Tag": packet.tag,
                            "Elapsed (ms)": packet.timestamp - firstTimestamp
                        }];
                    });
                    lastLoggedTimesRef.current[packet.tag] = packet.timestamp;
                }

                if (!isLoggingRef.current) {
                    const currentTags = [...selectedTagsRef.current];
                    if (!currentTags.includes(packet.tag)) {
                        const emptyIndex = currentTags.findIndex(t => t === null);
                        if (emptyIndex !== -1 && emptyIndex < cellCountRef.current) {
                            currentTags[emptyIndex] = packet.tag;
                            setSelectedTags(currentTags);
                        }
                    }
                }

                const now = Date.now();
                setPreviewData(prev => {
                    const filtered = prev.filter(p => now - p.timestamp < 30000);
                    const first = filtered.length > 0 ? filtered[0].timestamp : now;
                    return [...filtered, {
                        Tag: packet.tag,
                        value: packet.value,
                        timestamp: packet.timestamp,
                        "Elapsed (ms)": packet.timestamp - first
                    }];
                });
            });
            return () => {
                if (typeof removeListener === 'function') removeListener();
            };
        }
    }, []);

    useEffect(() => {
        setIsCertPreview(false);
    }, [activeTab]);

    useEffect(() => {
        const load = async () => {
            const saved = await window.electronAPI.loadData('dashboard-data.json');
            if (saved) {
                if (Array.isArray(saved)) {
                    const migrated = [{
                        id: Date.now(),
                        data: saved,
                        metadata: { jobNumber: 'Migrated Test' }
                    }];
                    setAllJobs(migrated);
                    setActiveJobId(migrated[0].id);
                } else if (saved.jobs) {
                    setAllJobs(saved.jobs);
                    setActiveJobId(saved.lastActiveJobId || (saved.jobs.length > 0 ? saved.jobs[0].id : null));
                } else if (saved.data) {
                    const migrated = [{
                        id: Date.now(),
                        data: saved.data,
                        metadata: saved.metadata || {}
                    }];
                    setAllJobs(migrated);
                    setActiveJobId(migrated[0].id);
                }
                setActiveTab('report');
            }
        };
        load();

        const syncStatus = async () => {
            if (window.electronAPI.getDeviceStatus) {
                const status = await window.electronAPI.getDeviceStatus();
                setDeviceStatus(status);
            }
        };
        syncStatus();

        if (window.electronAPI.onDeviceStatusChanged) {
            window.electronAPI.onDeviceStatusChanged((status) => {
                setDeviceStatus(status);
            });
        }

        const checkRecovery = async () => {
            if (window.electronAPI.checkRecovery) {
                const hasRecovery = await window.electronAPI.checkRecovery();
                if (hasRecovery) {
                    setShowRecoveryPrompt(true);
                }
            }
        };
        checkRecovery();
    }, []);

    // --- CENTRAL PERSISTENCE ENGINE ---
    useEffect(() => {
        if (allJobs.length === 0) return;

        const timer = setTimeout(() => {
            setSaveStatus('saving');
            window.electronAPI.saveData({
                jobs: allJobs,
                lastActiveJobId: activeJobId
            }, 'dashboard-data.json')
                .then(res => {
                    if (res?.success) {
                        setSaveStatus('synced');
                        console.log("Dashboard data persisted. Jobs:", allJobs.length);
                    } else {
                        setSaveStatus('error');
                        console.error("Persistence failed:", res?.error);
                    }
                })
                .catch(err => {
                    setSaveStatus('error');
                    console.error("Save error:", err);
                });
        }, 500); // Debounce saves by 500ms

        return () => clearTimeout(timer);
    }, [allJobs, activeJobId]);

    // Active Polling & Keep Awake Sync (Persistent across tabs)
    useEffect(() => {
        const activeTags = selectedTags.slice(0, cellCount);
        if (deviceStatus === 'connected' && activeTags.some(t => t)) {
            window.electronAPI.startPolling(activeTags);
        } else {
            window.electronAPI.stopPolling();
        }

        if (deviceStatus === 'connected' && window.electronAPI.getKeepStatus) {
            window.electronAPI.getKeepStatus().then(isActive => {
                setKeepAwake(isActive);
            });
        }
    }, [selectedTags, cellCount, deviceStatus]);

    const handleRecover = async () => {
        if (window.electronAPI.loadRecovery) {
            const data = await window.electronAPI.loadRecovery();
            setRecoverySession(data);
            setActiveTab('live');
        }
        setShowRecoveryPrompt(false);
    };

    const handleDiscardRecovery = async () => {
        if (window.electronAPI.clearRecovery) {
            await window.electronAPI.clearRecovery();
        }
        setShowRecoveryPrompt(false);
    };

    const activeJob = useMemo(() => {
        const job = allJobs.find(j => j.id.toString() === activeJobId?.toString());
        if (!job) return null;

        // Normalize: Ensure dataSets array exists for easy mapping
        const dataSets = job.dataSets || (job.data ? [{
            data: job.data,
            name: job.metadata?.fileName || 'Imported Data',
            timestamp: job.id
        }] : []);

        return { ...job, dataSets };
    }, [allJobs, activeJobId]);

    const handleDataImported = (data, jobNumber, extraMetadata = {}) => {
        // Check if we should append to an existing job
        const existingJobIndex = allJobs.findIndex(j => j.metadata?.jobNumber === jobNumber);

        let updatedJobs;
        let finalJobId;

        if (existingJobIndex !== -1) {
            // Append to existing job
            const existingJob = allJobs[existingJobIndex];
            const dataSets = existingJob.dataSets || (existingJob.data ? [{
                data: existingJob.data,
                name: existingJob.metadata?.fileName || 'Data Set 1',
                timestamp: existingJob.id
            }] : []);

            const newDataSet = {
                data: data,
                name: extraMetadata.fileName || `Data Set ${dataSets.length + 1}`,
                timestamp: Date.now()
            };

            const updatedJob = {
                ...existingJob,
                dataSets: [...dataSets, newDataSet],
                metadata: { ...existingJob.metadata, ...extraMetadata }
            };
            // Clean up legacy single data field
            delete updatedJob.data;

            updatedJobs = [...allJobs];
            updatedJobs[existingJobIndex] = updatedJob;
            finalJobId = updatedJob.id;
        } else {
            // Create new job
            const newJob = {
                id: Date.now(),
                dataSets: [{
                    data: data,
                    name: extraMetadata.fileName || 'Data Set 1',
                    timestamp: Date.now()
                }],
                metadata: { jobNumber, ...extraMetadata }
            };
            updatedJobs = [newJob, ...allJobs];
            finalJobId = newJob.id;
        }

        setAllJobs(updatedJobs);
        setActiveJobId(finalJobId);

        if (window.electronAPI.clearRecovery) {
            window.electronAPI.clearRecovery();
        }
        setRecoverySession(null);
        setActiveTab('report');
    };

    const handleUpdateJobMetadata = (jobId, metadataUpdates) => {
        setAllJobs(prevJobs => {
            let matchFound = false;
            const updatedJobs = prevJobs.map(j => {
                if (j.id.toString() === jobId?.toString()) {
                    matchFound = true;
                    // Log the actual update for debugging
                    if (metadataUpdates.drafts) {
                        console.log(`Updating drafts for job ${jobId}. New count: ${metadataUpdates.drafts.length}`);
                    }
                    return { ...j, metadata: { ...j.metadata, ...metadataUpdates } };
                }
                return j;
            });

            if (!matchFound) {
                console.warn("handleUpdateJobMetadata: No job found matching ID:", jobId);
            }
            return updatedJobs;
        });
    };

    const handleJobChange = (id) => {
        setActiveJobId(id);
        window.electronAPI.saveData({
            jobs: allJobs,
            lastActiveJobId: id
        }, 'dashboard-data.json');
    };

    const triggerAppendData = (job) => {
        if (!job) return;
        setImportContext({
            QuoteNum: job.metadata?.jobNumber,
            Customer: job.metadata?.customer,
            LeadCompany: job.metadata?.leadCompany,
            PODate: job.metadata?.poDate,
            PONumber: job.metadata?.poNumber
        });
        setActiveTab('import');
    };

    const handleRemoveDataSet = (jobId, dataSetIndex) => {
        if (!window.confirm('Are you sure you want to remove this data set? This cannot be undone.')) return;

        const updatedJobs = allJobs.map(j => {
            if (j.id.toString() === jobId.toString()) {
                const newDataSets = j.dataSets.filter((_, idx) => idx !== dataSetIndex);
                return { ...j, dataSets: newDataSets };
            }
            return j;
        });

        setAllJobs(updatedJobs);
        window.electronAPI.saveData({
            jobs: updatedJobs,
            lastActiveJobId: activeJobId
        }, 'dashboard-data.json');
    };

    const handleUpdateDataSet = (jobId, dataSetIndex, updates) => {
        const updatedJobs = allJobs.map(j => {
            if (j.id.toString() === jobId.toString()) {
                const newDataSets = [...j.dataSets];
                newDataSets[dataSetIndex] = { ...newDataSets[dataSetIndex], ...updates };
                return { ...j, dataSets: newDataSets };
            }
            return j;
        });

        setAllJobs(updatedJobs);
        window.electronAPI.saveData({
            jobs: updatedJobs,
            lastActiveJobId: activeJobId
        }, 'dashboard-data.json');
    };

    return (
        <div className={`app-container ${isCertPreview ? 'preview-active' : ''}`}>
            {!isCertPreview && (
                <header className="app-header no-print">
                    <div className="app-header-left">
                        <img src={logo} alt="Hydro-Wates" className="header-logo" />
                        <div className="brand-separator"></div>
                        <div className="brand-name">OSCAR 1.0</div>
                    </div>
                    <div className="status-indicator">
                        <span className={`status-dot ${deviceStatus}`}></span>
                        {deviceStatus.charAt(0).toUpperCase() + deviceStatus.slice(1)}
                    </div>
                    <div className="app-header-right">
                        <div className={`save-indicator ${saveStatus}`} title={`Data persistence: ${saveStatus}`}>
                            {saveStatus === 'saving' ? '⏳' : saveStatus === 'error' ? '❌' : '☁️'}
                        </div>
                        <button onClick={onOpenSettings} className="action-btn secondary circle" title="Settings">⚙️</button>
                    </div>
                </header>
            )}
            <main className="app-content">
                {!isCertPreview && (
                    <div className="sidebar no-print">
                        <button className="nav-btn home-btn" onClick={onGoHome}>🏠 Back to Main Menu</button>
                        <button className={`nav-btn ${activeTab === 'welcome' ? 'active' : ''}`} onClick={() => { setActiveTab('welcome'); setImportContext(null); }}>Dashboard & Jobs</button>
                        <button className={`nav-btn ${activeTab === 'live' ? 'active' : ''}`} onClick={() => setActiveTab('live')}>Live Data</button>
                        <button className={`nav-btn ${activeTab === 'import' ? 'active' : ''}`} onClick={() => { setActiveTab('import'); setImportContext(null); }}>Import CSV</button>
                        <button className={`nav-btn ${activeTab === 'report' ? 'active' : ''}`} onClick={() => setActiveTab('report')}>Saved Projects / Reports</button>
                        <button className={`nav-btn ${activeTab === 'cert' ? 'active' : ''}`} onClick={() => setActiveTab('cert')}>Certificate</button>
                        <div className="flex-grow"></div>
                        <button className={`nav-btn ${activeTab === 'settings' ? 'active' : ''}`} onClick={() => setActiveTab('settings')}>Settings</button>
                    </div>
                )}
                <div className="content-area" style={isCertPreview ? { padding: 0, margin: 0, overflowY: 'auto' } : {}}>
                    {activeTab === 'welcome' && (
                        <WelcomeView
                            onJobSelected={(job) => {
                                setSelectedSharePointJob(job);
                                const existingJob = allJobs.find(j => j.metadata?.jobNumber === job.QuoteNum);
                                setActiveJobId(existingJob ? existingJob.id : null);
                                setActiveTab('cert');
                            }}
                            onOpenSettings={() => setActiveTab('settings')}
                            onCompanySelected={(company) => {
                                setViewingCompany(company);
                                setActiveTab('company-info');
                            }}
                        />
                    )}
                    {activeTab === 'company-info' && (
                        <CompanyInfoView
                            company={viewingCompany}
                            onBack={() => setActiveTab('welcome')}
                            onSelectForLive={(job) => {
                                setSelectedSharePointJob(job);
                                const existingJob = allJobs.find(j => j.metadata?.jobNumber === job.QuoteNum);
                                setActiveJobId(existingJob ? existingJob.id : null);
                                setActiveTab('cert');
                            }}
                            onImportCsv={(job) => {
                                setImportContext(job);
                                setActiveTab('import');
                            }}
                        />
                    )}
                    {!isCertPreview && (activeTab === 'report' || activeTab === 'cert') && (
                        <div className="no-print">
                            <JobSelector jobs={allJobs} activeJobId={activeJobId} onSelect={handleJobChange} />
                        </div>
                    )}
                    {activeTab === 'live' && (
                        <ErrorBoundary>
                            <LiveView
                                status={deviceStatus}
                                onSaveLog={handleDataImported}
                                selectedJob={selectedSharePointJob}
                                recoveryData={recoverySession}
                                devices={devices}
                                selectedTags={selectedTags}
                                setSelectedTags={setSelectedTags}
                                cellCount={cellCount}
                                setCellCount={setCellCount}
                                isLogging={isLogging}
                                setIsLogging={setIsLogging}
                                loggedData={loggedData}
                                setLoggedData={setLoggedData}
                                logInterval={logInterval}
                                setLogInterval={setLogInterval}
                                keepAwake={keepAwake}
                                setKeepAwake={setKeepAwake}
                                previewData={previewData}
                                setPreviewData={setPreviewData}
                                displayUnit={displayUnit}
                                onUnitChange={setDisplayUnit}
                                xUnit={xUnit}
                                onXUnitChange={setXUnit}
                            />
                        </ErrorBoundary>
                    )}
                    {activeTab === 'import' && (
                        <ImportView
                            onDataImported={handleDataImported}
                            contextJob={importContext}
                        />
                    )}
                    {activeTab === 'report' && (
                        <ReportView
                            job={activeJob}
                            displayUnit={displayUnit}
                            displayTimeUnit={displayTimeUnit}
                            onUnitChange={setDisplayUnit}
                            onTimeUnitChange={setDisplayTimeUnit}
                            xUnit={xUnit}
                            onXUnitChange={setXUnit}
                            onAddData={() => triggerAppendData(activeJob)}
                            onRemoveDataSet={(idx) => handleRemoveDataSet(activeJob.id, idx)}
                            onUpdateDataSet={(idx, updates) => handleUpdateDataSet(activeJob.id, idx, updates)}
                        />
                    )}
                    {activeTab === 'cert' && (
                        <CertificateView
                            data={activeJob}
                            jobId={activeJobId}
                            selectedJob={selectedSharePointJob}
                            onUpdateMetadata={handleUpdateJobMetadata}
                            onPreviewModeChange={(val) => setIsCertPreview(val)}
                            xUnit={xUnit}
                            displayUnit={displayUnit}
                        />
                    )}
                    {activeTab === 'settings' && <SettingsView onSettingsSaved={() => { }} />}
                </div>
            </main>

            {showRecoveryPrompt && (
                <div className="modal-overlay">
                    <div className="job-prompt-card" style={{ maxWidth: '500px' }}>
                        <div style={{ fontSize: '2rem', marginBottom: '10px' }}>🛡️</div>
                        <h3>Crash Recovery Detected</h3>
                        <p>OSCAR found an unsaved test session that was interrupted. Would you like to resume it?</p>
                        <div className="form-actions mt-4">
                            <button onClick={handleRecover} className="action-btn">Resume Test Session</button>
                            <button onClick={handleDiscardRecovery} className="action-btn secondary ml-4">Discard Data</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

function App() {
    const [appMode, setAppMode] = useState(null); // 'service' | 'project-mgmt' | 'inventory' | 'dot' | null
    const [showSettings, setShowSettings] = useState(false);

    return (
        <>
            {appMode === 'service' && <ServiceView onGoHome={() => setAppMode(null)} onOpenSettings={() => setShowSettings(true)} />}
            {!appMode && <MainMenu onSelectMode={setAppMode} onOpenSettings={() => setShowSettings(true)} />}

            <SettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} />
        </>
    );
}

export default App;
