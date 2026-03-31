import { useState, useEffect } from 'react';
import ConversionCalculator from './ConversionCalculator';
import { getElectronAPI } from '../utils/electronAPI';

function WelcomeView({ onJobSelected, onOpenSettings, onCompanySelected }) {
    const [jobs, setJobs] = useState([]);
    const [loading, setLoading] = useState(false);
    const [authMessage, setAuthMessage] = useState('');
    const [searchTerm, setSearchTerm] = useState('');
    const [error, setError] = useState('');
    const [cacheInfo, setCacheInfo] = useState(null);
    const [hiddenJobIds, setHiddenJobIds] = useState([]);

    useEffect(() => {
        const loadHidden = async () => {
            const saved = await getElectronAPI().loadSettings();
            if (saved?.hiddenJobIds) setHiddenJobIds(saved.hiddenJobIds);
        };
        loadHidden();
    }, []);

    const handleRemoveJob = async (jobId) => {
        const newHidden = [...hiddenJobIds, jobId];
        setHiddenJobIds(newHidden);
        const saved = await getElectronAPI().loadSettings();
        await getElectronAPI().saveSettings({ ...saved, hiddenJobIds: newHidden });
    };

    useEffect(() => {
        if (getElectronAPI().onAuthMessage) {
            getElectronAPI().onAuthMessage((msg) => setAuthMessage(msg));
        }
        loadCacheInfo();
    }, []);

    const loadCacheInfo = async () => {
        const cache = await getElectronAPI().getJobsCache();
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
            const fullList = await getElectronAPI().fetchJobs();
            setJobs(fullList || []);
            if (!fullList || fullList.length === 0) {
                setError('No awarded "Service" projects found (PO Received status).');
            }
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
            const cache = await getElectronAPI().getJobsCache();
            if (cache?.jobs && cache.jobs.length > 0) {
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
                        {cacheInfo.isFromCache ? 'OFFLINE MODE - ' : 'OK '}
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
                                                &#10005;
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

export default WelcomeView;
