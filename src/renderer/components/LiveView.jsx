import { useState, useEffect, useRef } from 'react';
import ErrorBoundary from './ErrorBoundary';
import LiveGraph from './LiveGraph';
import { getElectronAPI } from '../utils/electronAPI';

function LiveView({
    status,
    onSaveLog,
    selectedJob,
    recoveryData,
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

    useEffect(() => {
        if (selectedJob?.QuoteNum) {
            setJobInput(selectedJob.QuoteNum);
        }
    }, [selectedJob]);

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
        if (getElectronAPI().startSafetyLog) {
            getElectronAPI().startSafetyLog(logInterval);
        }
    };

    const stopLogging = async () => {
        setIsLogging(false);
        if (getElectronAPI().stopSafetyLog) {
            getElectronAPI().stopSafetyLog();
        }

        const jobNumber = selectedJob?.QuoteNum || jobInput || 'test_data';

        if (selectedJob?.QuoteNum) {
            const metadata = {
                customer: selectedJob.Customer,
                leadCompany: selectedJob.LeadCompany,
                poDate: selectedJob.PODate,
                poNumber: selectedJob.PONumber
            };
            onSaveLog(loggedData, selectedJob.QuoteNum, metadata);

            if (loggedData.length > 0) {
                await getElectronAPI().saveCSV(loggedData, selectedJob.QuoteNum);
            }

            setLoggedData([]);
        } else {
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

        if (loggedData.length > 0) {
            await getElectronAPI().saveCSV(loggedData, upperJob);
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
        await getElectronAPI().toggleKeepAwake(newState);
    };

    const handleZero = (tag) => {
        if (!tag) return;
        getElectronAPI().tare(tag);
    };

    const handleWakeSensors = async () => {
        if (getElectronAPI().wakeSensors) {
            await getElectronAPI().wakeSensors();
        }
    };

    const clearAllTares = () => {
        selectedTags.slice(0, cellCount).forEach(tag => {
            if (tag) getElectronAPI().clearTare(tag);
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
                    Wake All Sensors
                </button>
                <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '8px' }}>
                    Sends a broadcast signal to wake nearby sleeping transmitters
                </p>
            </div>
        );
    }

    const totalLbs = selectedTags.slice(0, cellCount).reduce((acc, tag) => {
        if (tag && devices[tag]) {
            return acc + devices[tag].value;
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
                                Wake All Sensors
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

export default LiveView;
