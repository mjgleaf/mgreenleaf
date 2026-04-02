import { useState, useEffect, useRef, useCallback } from 'react';
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

    // Feature: Overload Alarm
    const [wllThreshold, setWllThreshold] = useState(0);
    const [overloadTags, setOverloadTags] = useState(new Set());
    const overloadAudioRef = useRef(null);
    const wllThresholdRef = useRef(0);

    // Feature: Peak Hold
    const [peakValues, setPeakValues] = useState({});
    const peakValuesRef = useRef({});

    // Feature: Signal Strength
    const [lastPacketTimes, setLastPacketTimes] = useState({});

    // Feature: Auto-save
    const [lastAutosave, setLastAutosave] = useState(null);
    const autosaveTimerRef = useRef(null);

    useEffect(() => { wllThresholdRef.current = wllThreshold; }, [wllThreshold]);

    // Audio context for overload alarm
    useEffect(() => {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) overloadAudioRef.current = new AudioContext();
        return () => { if (overloadAudioRef.current) overloadAudioRef.current.close(); };
    }, []);

    const playOverloadBeep = useCallback(() => {
        const ctx = overloadAudioRef.current;
        if (!ctx || ctx.state === 'suspended') { ctx?.resume(); return; }
        try {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.type = 'square';
            osc.frequency.value = 880;
            gain.gain.value = 0.3;
            osc.start();
            osc.stop(ctx.currentTime + 0.15);
        } catch (e) { }
    }, []);

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

    // Track overload + peak + signal from live data
    useEffect(() => {
        if (!devices) return;
        const now = Date.now();
        Object.entries(devices).forEach(([tag, packet]) => {
            // Signal tracking
            setLastPacketTimes(prev => ({ ...prev, [tag]: packet.timestamp || now }));

            // Overload check
            if (wllThresholdRef.current > 0 && Math.abs(packet.value) > wllThresholdRef.current) {
                setOverloadTags(prev => { const next = new Set(prev); next.add(tag); return next; });
                playOverloadBeep();
            } else {
                setOverloadTags(prev => {
                    if (prev.has(tag)) { const next = new Set(prev); next.delete(tag); return next; }
                    return prev;
                });
            }

            // Peak tracking during logging
            if (isLogging) {
                const currentPeak = peakValuesRef.current[tag] || 0;
                if (Math.abs(packet.value) > Math.abs(currentPeak)) {
                    peakValuesRef.current[tag] = packet.value;
                    setPeakValues({ ...peakValuesRef.current });
                }
            }
        });
    }, [devices, isLogging, playOverloadBeep]);

    // Signal indicator refresh
    useEffect(() => {
        const interval = setInterval(() => setLastPacketTimes(prev => ({ ...prev })), 1000);
        return () => clearInterval(interval);
    }, []);

    const tags = Object.keys(devices);

    const startLogging = () => {
        // Data validation: need at least one cell assigned
        const activeTags = selectedTags.slice(0, cellCount).filter(t => t);
        if (activeTags.length === 0) {
            setError('Please assign at least one load cell before recording.');
            return;
        }
        setLoggedData([]);
        setIsLogging(true);
        setError('');
        // Reset peak hold
        peakValuesRef.current = {};
        setPeakValues({});
        if (getElectronAPI().startSafetyLog) {
            getElectronAPI().startSafetyLog(logInterval);
        }
        // Start auto-save timer
        if (autosaveTimerRef.current) clearInterval(autosaveTimerRef.current);
        autosaveTimerRef.current = setInterval(() => {
            performAutosave();
        }, 60000);
    };

    const stopLogging = async () => {
        setIsLogging(false);
        if (getElectronAPI().stopSafetyLog) {
            getElectronAPI().stopSafetyLog();
        }
        // Stop auto-save
        if (autosaveTimerRef.current) { clearInterval(autosaveTimerRef.current); autosaveTimerRef.current = null; }

        if (loggedData.length === 0) {
            setError('No data was recorded. Nothing to save.');
            return;
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

    const performAutosave = useCallback(() => {
        const api = getElectronAPI();
        if (!api.autosaveSession) return;
        setLoggedData(current => {
            if (current.length > 0) {
                api.autosaveSession({
                    name: selectedJob?.QuoteNum || jobInput || 'service-autosave',
                    data: current,
                    meta: { peakValues: { ...peakValuesRef.current } }
                });
                setLastAutosave(new Date());
            }
            return current;
        });
    }, [selectedJob, jobInput]);

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

    // Signal status helpers
    const getSignalStatus = (tag) => {
        if (!tag || !lastPacketTimes[tag]) return 'stale';
        const elapsed = Date.now() - lastPacketTimes[tag];
        if (elapsed < 2000) return 'live';
        if (elapsed < 5000) return 'heartbeat';
        return 'stale';
    };

    const getSignalLabel = (tag) => {
        if (!tag || !lastPacketTimes[tag]) return 'No signal';
        const elapsed = Date.now() - lastPacketTimes[tag];
        if (elapsed < 2000) return 'Live';
        return `${(elapsed / 1000).toFixed(0)}s ago`;
    };

    const totalLbs = selectedTags.slice(0, cellCount).reduce((acc, tag) => {
        if (tag && devices[tag]) {
            return acc + devices[tag].value;
        }
        return acc;
    }, 0);

    const shortTons = totalLbs / 2000;
    const metricTons = totalLbs * 0.00045359237;
    const totalPeak = Object.values(peakValues).reduce((acc, v) => acc + Math.abs(v), 0);

    return (
        <div className="live-view-container">
            {/* Status banners — always show controls regardless of connection */}
            {status === 'disconnected' && (
                <div style={{
                    background: 'rgba(239, 68, 68, 0.12)', border: '1px solid rgba(239, 68, 68, 0.3)',
                    color: '#f87171', padding: '8px 16px', borderRadius: 'var(--radius-sm)',
                    fontSize: '0.82rem', fontWeight: 600, marginBottom: 12, textAlign: 'center',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8
                }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444', display: 'inline-block' }}></span>
                    Dongle Disconnected — Plug in your T24 USB dongle to stream live data
                </div>
            )}

            {status === 'connected' && tags.length === 0 && (
                <div style={{
                    background: 'rgba(251, 191, 36, 0.1)', border: '1px solid rgba(251, 191, 36, 0.25)',
                    color: '#fbbf24', padding: '8px 16px', borderRadius: 'var(--radius-sm)',
                    fontSize: '0.82rem', fontWeight: 600, marginBottom: 12, textAlign: 'center',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8
                }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#fbbf24', display: 'inline-block' }}></span>
                    Dongle connected — Waiting for transmitter signals...
                    <button onClick={handleWakeSensors} className="action-btn" style={{ fontSize: '0.78rem', padding: '4px 12px', marginLeft: 8 }}>
                        Wake All Sensors
                    </button>
                </div>
            )}

            {/* Overload banner */}
            {overloadTags.size > 0 && (
                <div className="overload-banner">
                    OVERLOAD WARNING — {[...overloadTags].map(t => `Cell ${t}`).join(', ')} exceeding WLL of {wllThreshold.toLocaleString()} lbs!
                </div>
            )}

            {error && (
                <div style={{
                    background: 'rgba(239, 68, 68, 0.12)', border: '1px solid rgba(239, 68, 68, 0.3)',
                    color: '#f87171', padding: '8px 16px', borderRadius: 'var(--radius-sm)',
                    fontSize: '0.82rem', fontWeight: 600, marginBottom: 12, textAlign: 'center'
                }}>
                    {error}
                </div>
            )}

            <div className="live-header">
                <div className="live-badge">LIVE MULTI-LINK</div>
                <div className="serial-box">
                    <span className="label">NUMBER OF CELLS</span>
                    <select className="cell-count-dropdown" value={cellCount}
                        onChange={(e) => setCellCount(parseInt(e.target.value))} disabled={isLogging}>
                        {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => (
                            <option key={n} value={n}>{n} Cell{n > 1 ? 's' : ''}</option>
                        ))}
                    </select>
                </div>
                <div className="serial-box">
                    <span className="label">SIGNAL STATUS</span>
                    <span className="value">
                        {status === 'connected' ? `CONNECTED (${selectedTags.slice(0, cellCount).filter(t => t).length} Cells)` : 'DISCONNECTED'}
                    </span>
                </div>
                <div className="serial-box">
                    <span className="label">SAMPLE RATE</span>
                    <select className="cell-count-dropdown" value={logInterval}
                        onChange={(e) => setLogInterval(parseInt(e.target.value))} disabled={isLogging}>
                        <option value={0}>Continuous (Real-time)</option>
                        <option value={1000}>1 Second</option>
                        <option value={10000}>10 Seconds</option>
                        <option value={30000}>30 Seconds</option>
                        <option value={60000}>1 Minute</option>
                        <option value={300000}>5 Minutes</option>
                        <option value={600000}>10 Minutes</option>
                    </select>
                </div>
                <div className="serial-box">
                    <span className="label">OVERLOAD ALARM (WLL)</span>
                    <div className="wll-input-group">
                        <input type="number" value={wllThreshold || ''} placeholder="Off"
                            onChange={(e) => setWllThreshold(parseFloat(e.target.value) || 0)}
                            style={{ width: '80px' }} />
                        <span>lbs</span>
                    </div>
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
                            <button onClick={startLogging} className="action-btn large record-btn"
                                disabled={status === 'disconnected'}>
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
                                    <input type="checkbox" checked={keepAwake} onChange={toggleKeepAwake} />
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
                                {lastAutosave && (
                                    <span className="autosave-indicator">
                                        <span className="check">&#10003;</span>
                                        Auto-saved {lastAutosave.toLocaleTimeString()}
                                    </span>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <div className="load-cells-grid">
                {selectedTags.slice(0, cellCount).map((selectedTag, index) => {
                    const packet = selectedTag ? devices[selectedTag] : null;
                    const isOverload = selectedTag && overloadTags.has(selectedTag);
                    const signalStatus = getSignalStatus(selectedTag);
                    const signalLabel = getSignalLabel(selectedTag);
                    const peak = isLogging && selectedTag ? peakValues[selectedTag] : null;

                    return (
                        <div key={index} className={`load-cell-slot ${selectedTag ? 'active' : ''} ${isOverload ? 'overload' : ''}`}>
                            <div className="slot-header">
                                <span className="slot-number">CELL {index + 1}</span>
                                <select className="slot-dropdown" value={selectedTag || 'none'}
                                    onChange={(e) => handleTagChange(index, e.target.value)} disabled={isLogging}>
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

                                {/* Peak hold */}
                                {peak !== null && peak !== undefined && (
                                    <div className="peak-hold">
                                        <span className="peak-label">Peak:</span>
                                        <span className="peak-value">
                                            {Math.abs(peak).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} lbs
                                        </span>
                                    </div>
                                )}

                                {/* Signal indicator */}
                                {selectedTag && (
                                    <div className="signal-indicator">
                                        <span className={`signal-dot ${signalStatus}`}></span>
                                        <span>{signalLabel}</span>
                                    </div>
                                )}

                                {selectedTag && (
                                    <button className="zero-btn" onClick={() => handleZero(selectedTag)} disabled={isLogging}>
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
                {isLogging && totalPeak > 0 && (
                    <div className="stat-card accent">
                        <h3>Peak Total Load</h3>
                        <div className="stat-value" style={{ color: 'var(--yellow-accent)' }}>
                            {totalPeak.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} lbs
                        </div>
                    </div>
                )}
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
