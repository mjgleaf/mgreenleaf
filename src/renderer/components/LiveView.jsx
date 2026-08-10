import { useState, useEffect, useRef, useCallback } from 'react';
import ErrorBoundary from './ErrorBoundary';
import LiveGraph from './LiveGraph';
import { getElectronAPI } from '../utils/electronAPI';
import { getTagLabel } from '../utils/tagNames';

const formatElapsed = (ms) => {
    const totalSec = Math.max(0, Math.round(ms / 1000));
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
};

// One independent recording session (a single load test). Rendered once in
// normal mode and twice (Test A + Test B) when dual-test mode is on. Each panel
// owns its own cell assignment, logged buffer, markers and peak hold; the parent
// LiveView feeds them all from one shared telemetry stream.
function TestPanel({
    label,
    status,
    devices,
    allTags,
    excludeTags,
    selectedTags,
    setSelectedTags,
    tagNames = {},
    onRenameTag,
    cellCount,
    setCellCount,
    isLogging,
    loggedData,
    markers,
    setMarkers,
    onStart,
    onStop,
    overloadTags,
    getSignalStatus,
    getSignalLabel,
    onZero,
    onClearZeros,
    displayUnit,
    onUnitChange,
    xUnit,
    onXUnitChange,
    selectedJob,
    jobNumberLabel,
    previewData,
}) {
    const [error, setError] = useState('');

    // Feature: Rename load cell tags (friendly names, e.g. 58E3 -> LL-1053)
    const [renameTarget, setRenameTarget] = useState(null); // tag hex being renamed, or null
    const [renameInput, setRenameInput] = useState('');

    const openRename = (tag) => {
        setRenameTarget(tag);
        setRenameInput(tagNames[tag] || '');
    };

    const saveRename = () => {
        if (renameTarget && onRenameTag) onRenameTag(renameTarget, renameInput);
        setRenameTarget(null);
    };

    // Peak hold — local to this test so starting one test doesn't reset the
    // other test's peaks.
    const [peakValues, setPeakValues] = useState({});
    const peakValuesRef = useRef({});

    // Reset peaks whenever this test's logging state flips.
    useEffect(() => {
        peakValuesRef.current = {};
        setPeakValues({});
    }, [isLogging]);

    // Track peak per assigned cell while recording.
    useEffect(() => {
        if (!isLogging) return;
        const activeTags = selectedTags.slice(0, cellCount);
        let changed = false;
        activeTags.forEach(tag => {
            if (!tag || !devices[tag]) return;
            const current = peakValuesRef.current[tag] || 0;
            if (Math.abs(devices[tag].value) > Math.abs(current)) {
                peakValuesRef.current[tag] = devices[tag].value;
                changed = true;
            }
        });
        if (changed) setPeakValues({ ...peakValuesRef.current });
    }, [devices, isLogging, selectedTags, cellCount]);

    const isPhaseOpen = (phase) => {
        const ph = markers.filter(m => m.phase === phase);
        return ph.length > 0 && ph[ph.length - 1].edge === 'start';
    };

    const toggleMarker = (phase, phaseLabel) => {
        const firstTimestamp = loggedData.length > 0 ? loggedData[0].timestamp : Date.now();
        const edge = isPhaseOpen(phase) ? 'end' : 'start';
        setMarkers(prev => [...prev, {
            phase,
            edge,
            label: `${phaseLabel} ${edge === 'start' ? 'Start' : 'End'}`,
            elapsedMs: Date.now() - firstTimestamp,
            timestamp: Date.now()
        }]);
    };

    const undoLastMarker = () => setMarkers(prev => prev.slice(0, -1));

    const handleStartClick = () => {
        const activeTags = selectedTags.slice(0, cellCount).filter(t => t);
        if (activeTags.length === 0) {
            setError(`Please assign at least one load cell${label ? ` to ${label}` : ''} before recording.`);
            return;
        }
        setError('');
        onStart();
    };

    const handleStopClick = async () => {
        const err = await onStop();
        if (err) setError(err);
    };

    const handleTagChange = (index, value) => {
        const newTags = [...selectedTags];
        newTags[index] = value === 'none' ? null : value;
        setSelectedTags(newTags);
    };

    const activeTags = selectedTags.slice(0, cellCount);
    const assignedCount = activeTags.filter(t => t).length;

    const totalLbs = activeTags.reduce((acc, tag) => {
        if (tag && devices[tag]) return acc + devices[tag].value;
        return acc;
    }, 0);
    const shortTons = totalLbs / 2000;
    const metricTons = totalLbs * 0.00045359237;
    const totalPeak = Object.values(peakValues).reduce((acc, v) => acc + Math.abs(v), 0);

    // Only show this test's own cells in the preview graph.
    const panelPreview = previewData.filter(p => activeTags.includes(p.Tag));

    // Cells the dropdown should offer: everything except cells claimed by the
    // other test (but always keep this slot's current pick visible).
    const optionTags = (currentTag) => allTags.filter(tag => !excludeTags.includes(tag) || tag === currentTag);

    return (
        <div className={`test-panel${label ? ' dual' : ''}`} style={label ? {
            border: '1px solid var(--border)', borderRadius: 'var(--radius-md, 12px)',
            padding: '14px', background: 'rgba(255,255,255,0.02)'
        } : {}}>
            {label && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                    <span style={{
                        fontWeight: 800, fontSize: '0.95rem', letterSpacing: '0.04em',
                        color: 'var(--yellow-accent)', background: 'rgba(240,184,0,0.12)',
                        border: '1px solid rgba(240,184,0,0.3)', padding: '3px 12px', borderRadius: 999
                    }}>{label}</span>
                    <span style={{ fontSize: '0.78rem', color: 'var(--text-secondary)' }}>
                        {assignedCount} cell{assignedCount !== 1 ? 's' : ''} assigned
                    </span>
                    {isLogging && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.78rem', color: 'var(--green)', fontWeight: 700 }}>
                            <span className="pulse-dot"></span> Recording — {loggedData.length}
                        </span>
                    )}
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

            <div className="serial-box" style={{ marginBottom: 12, display: 'inline-flex' }}>
                <span className="label">NUMBER OF CELLS</span>
                <select className="cell-count-dropdown" value={cellCount}
                    onChange={(e) => setCellCount(parseInt(e.target.value))} disabled={isLogging}>
                    {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => (
                        <option key={n} value={n}>{n} Cell{n > 1 ? 's' : ''}</option>
                    ))}
                </select>
            </div>

            <div className="main-stats">
                <div className="primary-stat">
                    <div className="stat-unit">TOTAL LOAD (Lbs){label ? ` — ${label}` : ''}</div>
                    <div className="stat-big-value">{totalLbs.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</div>
                </div>

                <div className="logging-controls mt-2">
                    {!isLogging ? (
                        <div className="control-row">
                            <button onClick={handleStartClick} className="action-btn large record-btn"
                                disabled={status === 'disconnected'}>
                                <span className="dot"></span> {label ? `Start ${label}` : 'Start Logging Multi-Data'}
                            </button>
                            <button onClick={onClearZeros} className="action-btn secondary ml-4">
                                Clear Zeros
                            </button>
                        </div>
                    ) : (
                        <>
                            <div className="logging-active-group">
                                <button onClick={handleStopClick} className="action-btn large stop-btn">
                                    <span className="square"></span> {label ? `Stop & Save ${label}` : 'Stop & Save Project'}
                                </button>
                                <div className="logging-status">
                                    <span className="pulse-dot"></span>
                                    Recording: {loggedData.length} samples collected
                                </div>
                            </div>

                            <div className="marker-controls" style={{ marginTop: 12, padding: '12px 14px', background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm, 8px)' }}>
                                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                                    <span style={{ fontWeight: 700, fontSize: '0.78rem', color: 'var(--text-secondary)', letterSpacing: '0.05em' }}>TEST PHASE MARKERS</span>
                                    <button
                                        onClick={() => toggleMarker('function', 'Function Test')}
                                        className="action-btn"
                                        style={{ background: isPhaseOpen('function') ? '#ef4444' : '#0ea5e9' }}
                                    >
                                        {isPhaseOpen('function') ? '⏹ End Function Test' : '▶ Start Function Test'}
                                    </button>
                                    <button
                                        onClick={() => toggleMarker('static', 'Static Hold')}
                                        className="action-btn"
                                        style={{ background: isPhaseOpen('static') ? '#ef4444' : '#8b5cf6' }}
                                    >
                                        {isPhaseOpen('static') ? '⏹ End Static Hold' : '▶ Start Static Hold'}
                                    </button>
                                    {markers.length > 0 && (
                                        <button onClick={undoLastMarker} className="action-btn secondary" title="Remove the most recent mark">
                                            ↩ Undo Last
                                        </button>
                                    )}
                                </div>
                                {markers.length > 0 && (
                                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 10 }}>
                                        {markers.map((m, i) => (
                                            <span key={i} style={{
                                                display: 'inline-flex', alignItems: 'center', gap: 6,
                                                fontSize: '0.78rem', padding: '3px 9px', borderRadius: 999,
                                                background: m.phase === 'function' ? 'rgba(14,165,233,0.15)' : 'rgba(139,92,246,0.15)',
                                                border: `1px solid ${m.phase === 'function' ? 'rgba(14,165,233,0.4)' : 'rgba(139,92,246,0.4)'}`,
                                                color: 'var(--text-primary)'
                                            }}>
                                                <span style={{ width: 7, height: 7, borderRadius: '50%', background: m.edge === 'start' ? '#22c55e' : '#ef4444' }}></span>
                                                {m.label}
                                                <strong style={{ color: 'var(--text-secondary)' }}>{formatElapsed(m.elapsedMs)}</strong>
                                            </span>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </div>
            </div>

            <div className="load-cells-grid">
                {activeTags.map((selectedTag, index) => {
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
                                    {optionTags(selectedTag).map(tag => (
                                        <option key={tag} value={tag}>{getTagLabel(tag, tagNames)}</option>
                                    ))}
                                </select>
                                {selectedTag && (
                                    <button
                                        className="rename-tag-btn"
                                        onClick={() => openRename(selectedTag)}
                                        title={`Rename tag ${selectedTag}`}
                                    >
                                        ✏️
                                    </button>
                                )}
                            </div>
                            <div className="slot-body">
                                <div className="slot-value">
                                    {(packet ? packet.value : 0).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                                </div>
                                <div className="slot-unit">Lbs</div>

                                {packet && Math.abs(packet.tareOffset || 0) >= 0.5 && (
                                    <div className="zeroed-indicator" title="This cell has an active Zero (tare). The reading above has this amount subtracted, so it will read low vs. an un-zeroed handheld. Use 'Clear Zeros' to remove it.">
                                        ⊘ ZEROED {packet.tareOffset > 0 ? '−' : '+'}{Math.abs(packet.tareOffset).toLocaleString(undefined, { maximumFractionDigits: 0 })} lbs
                                    </div>
                                )}

                                {peak !== null && peak !== undefined && (
                                    <div className="peak-hold">
                                        <span className="peak-label">Peak:</span>
                                        <span className="peak-value">
                                            {Math.abs(peak).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} lbs
                                        </span>
                                    </div>
                                )}

                                {selectedTag && (
                                    <div className="signal-indicator">
                                        <span className={`signal-dot ${signalStatus}`}></span>
                                        <span>{signalLabel}</span>
                                    </div>
                                )}

                                {selectedTag && (
                                    <button className="zero-btn" onClick={() => onZero(selectedTag)} disabled={isLogging}>
                                        Zero
                                    </button>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            {renameTarget && (
                <div className="modal-overlay">
                    <div className="job-prompt-card">
                        <h3>Rename Load Cell</h3>
                        <p>Set a friendly name for tag <strong>{renameTarget}</strong> (e.g. the serial number painted on the cell). The name is display-only — recordings keep the radio tag.</p>
                        <div className="form-group mt-4">
                            <label>Display Name</label>
                            <input
                                type="text"
                                value={renameInput}
                                onChange={(e) => setRenameInput(e.target.value)}
                                onKeyDown={(e) => { if (e.key === 'Enter') saveRename(); }}
                                placeholder="e.g. LL-1053"
                                className="large-input"
                                autoFocus
                            />
                        </div>
                        <div className="form-actions mt-4">
                            <button onClick={saveRename} className="action-btn">Save</button>
                            {tagNames[renameTarget] && (
                                <button onClick={() => { onRenameTag && onRenameTag(renameTarget, ''); setRenameTarget(null); }}
                                    className="action-btn secondary ml-4">
                                    Clear Name
                                </button>
                            )}
                            <button onClick={() => setRenameTarget(null)} className="action-btn secondary ml-4">Cancel</button>
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
                    data={isLogging ? loggedData : panelPreview}
                    markers={isLogging ? markers : []}
                    activeTags={activeTags}
                    tagNames={tagNames}
                    companyName={selectedJob?.LeadCompany || selectedJob?.Customer}
                    jobNumber={jobNumberLabel}
                    displayUnit={displayUnit}
                    onUnitChange={onUnitChange}
                    xUnit={xUnit}
                    onXUnitChange={onXUnitChange}
                />
            </ErrorBoundary>
        </div>
    );
}

function LiveView({
    status,
    onSaveLog,
    selectedJob,
    recoveryData,
    devices,
    dualMode,
    setDualMode,
    selectedTags,
    setSelectedTags,
    tagNames = {},
    onRenameTag,
    cellCount,
    setCellCount,
    isLogging,
    setIsLogging,
    loggedData,
    setLoggedData,
    markers,
    setMarkers,
    selectedTagsB,
    setSelectedTagsB,
    cellCountB,
    setCellCountB,
    isLoggingB,
    setIsLoggingB,
    loggedDataB,
    setLoggedDataB,
    markersB,
    setMarkersB,
    logInterval,
    setLogInterval,
    keepAwake,
    setKeepAwake,
    previewData,
    setPreviewData,
    displayUnit,
    onUnitChange,
    xUnit,
    onXUnitChange,
    companionRunning,
    companionClients,
    onStartCompanion,
    onOpenCompanion
}) {
    const [showJobPrompt, setShowJobPrompt] = useState(false);
    const [jobInput, setJobInput] = useState('');
    const [error, setError] = useState('');
    // Data of a stopped test awaiting a manually-entered job number (only used
    // when no SharePoint job is selected).
    const [pendingPrompt, setPendingPrompt] = useState(null);

    // Feature: Overload Alarm
    const [wllThreshold, setWllThreshold] = useState(0);
    const [overloadTags, setOverloadTags] = useState(new Set());
    const overloadAudioRef = useRef(null);
    const wllThresholdRef = useRef(0);

    // Feature: Signal Strength
    const [lastPacketTimes, setLastPacketTimes] = useState({});

    // Feature: Auto-save (one rolling timer per test)
    const [lastAutosave, setLastAutosave] = useState(null);
    const autosaveRefA = useRef(null);
    const autosaveRefB = useRef(null);

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
        if (selectedJob?.QuoteNum) setJobInput(selectedJob.QuoteNum);
    }, [selectedJob]);

    // Crash recovery restores into Test A (the primary session).
    const recoveryAppliedRef = useRef(false);
    useEffect(() => {
        if (recoveryData && recoveryData.length > 0 && !recoveryAppliedRef.current) {
            setLoggedData(recoveryData);
            setIsLogging(true);
            const recoveryTags = Array.from(new Set(recoveryData.map(d => d.Tag)));
            if (recoveryTags.length > 0) {
                const nextTags = [...selectedTags];
                recoveryTags.slice(0, 10).forEach((tag, i) => { nextTags[i] = tag; });
                setSelectedTags(nextTags);
                setCellCount(Math.max(cellCount, recoveryTags.length));
            }
            recoveryAppliedRef.current = true;
            // Restart the on-disk safety nets for the restored session: keep
            // appending to the existing safety log (preserve — don't wipe the
            // data being recovered) and resume the 60s autosave.
            if (getElectronAPI().startSafetyLog) {
                getElectronAPI().startSafetyLog(logInterval, true);
            }
            if (autosaveRefA.current) clearInterval(autosaveRefA.current);
            autosaveRefA.current = setInterval(() => performAutosave({ label: null, setLoggedData }), 60000);
        }
    }, [recoveryData]);

    // Track overload + signal from live data (global across all cells).
    useEffect(() => {
        if (!devices) return;
        const now = Date.now();
        Object.entries(devices).forEach(([tag, packet]) => {
            setLastPacketTimes(prev => ({ ...prev, [tag]: packet.timestamp || now }));

            if (wllThresholdRef.current > 0 && Math.abs(packet.value) > wllThresholdRef.current) {
                setOverloadTags(prev => { const next = new Set(prev); next.add(tag); return next; });
                playOverloadBeep();
            } else {
                setOverloadTags(prev => {
                    if (prev.has(tag)) { const next = new Set(prev); next.delete(tag); return next; }
                    return prev;
                });
            }
        });
    }, [devices, playOverloadBeep]);

    // Signal indicator refresh
    useEffect(() => {
        const interval = setInterval(() => setLastPacketTimes(prev => ({ ...prev })), 1000);
        return () => clearInterval(interval);
    }, []);

    const tags = Object.keys(devices);

    const performAutosave = useCallback((ctx) => {
        const api = getElectronAPI();
        if (!api.autosaveSession) return;
        const baseName = selectedJob?.QuoteNum || jobInput || 'service-autosave';
        const name = ctx.label ? `${baseName} — ${ctx.label}` : baseName;
        ctx.setLoggedData(current => {
            if (current.length > 0) {
                api.autosaveSession({ name, data: current, meta: {} });
                setLastAutosave(new Date());
            }
            return current;
        });
    }, [selectedJob, jobInput]);

    const startTest = (ctx) => {
        ctx.setLoggedData([]);
        ctx.setMarkers([]);
        ctx.setIsLogging(true);
        // The single shared safety log spans the whole recording window: start it
        // when the first test begins, stop it when the last test ends.
        if (!ctx.otherIsLogging && getElectronAPI().startSafetyLog) {
            getElectronAPI().startSafetyLog(logInterval);
        }
        if (ctx.autosaveRef.current) clearInterval(ctx.autosaveRef.current);
        ctx.autosaveRef.current = setInterval(() => performAutosave(ctx), 60000);
    };

    // Returns an error string to show in the panel, or null on success / when a
    // job-number prompt is opened instead.
    const stopTest = async (ctx) => {
        const api = getElectronAPI();
        ctx.setIsLogging(false);
        if (ctx.autosaveRef.current) { clearInterval(ctx.autosaveRef.current); ctx.autosaveRef.current = null; }

        const data = ctx.loggedData;
        const testMarkers = ctx.markers;
        if (!data || data.length === 0) {
            if (!ctx.otherIsLogging && api.stopSafetyLog) api.stopSafetyLog();
            return 'No data was recorded. Nothing to save.';
        }

        // Durably write the recording to its own session file BEFORE anything
        // else can go wrong — a crash, a failed dashboard write or a mis-click
        // in the dialogs below can no longer destroy it.
        let backedUp = false;
        if (api.saveSession) {
            const baseName = selectedJob?.QuoteNum || jobInput || 'recording';
            const result = await api.saveSession({
                name: ctx.label ? `${baseName} — ${ctx.label}` : baseName,
                data,
                meta: { markers: testMarkers, source: 'live-view' }
            });
            backedUp = !!result?.success;
        }

        if (!ctx.otherIsLogging && api.stopSafetyLog) api.stopSafetyLog();

        // Only retire the crash-recovery log and rolling autosave once this
        // recording has a durable copy of its own and no other test is still
        // relying on them. (clearRecovery archives the log, never deletes it.)
        const clearNets = () => {
            if (!backedUp || ctx.otherIsLogging) return;
            if (api.clearRecovery) api.clearRecovery();
            if (api.clearAutosave) api.clearAutosave();
        };

        if (selectedJob?.QuoteNum) {
            const metadata = {
                customer: selectedJob.Customer,
                leadCompany: selectedJob.LeadCompany,
                poDate: selectedJob.PODate,
                poNumber: selectedJob.PONumber,
                markers: testMarkers,
                ...(ctx.label ? { fileName: ctx.label } : {})
            };
            onSaveLog(data, selectedJob.QuoteNum, metadata);
            const csvName = ctx.label ? `${selectedJob.QuoteNum}-${ctx.label.replace(/\s+/g, '')}` : selectedJob.QuoteNum;
            await api.saveCSV(data, csvName);
            clearNets();
            ctx.setLoggedData([]);
            ctx.setMarkers([]);
            return backedUp ? null : 'Saved to job, but the backup session file could not be written — keep this window open until you verify the data in Reports.';
        }

        // No SharePoint job — collect a job number via the modal.
        setPendingPrompt({
            data,
            markers: testMarkers,
            label: ctx.label,
            backedUp,
            clearNets,
            clear: () => { ctx.setLoggedData([]); ctx.setMarkers([]); }
        });
        setShowJobPrompt(true);
        return null;
    };

    const handleSave = async () => {
        const regex = /^HWI-\d{2}-\d{3}$/i;
        if (!regex.test(jobInput)) {
            setError('Invalid Format. Use HWI-XX-XXX (e.g., HWI-24-001)');
            return;
        }
        const upperJob = jobInput.toUpperCase();
        const p = pendingPrompt;
        if (p) {
            onSaveLog(p.data, upperJob, { markers: p.markers, ...(p.label ? { fileName: p.label } : {}) });
            await getElectronAPI().saveCSV(p.data, p.label ? `${upperJob}-${p.label.replace(/\s+/g, '')}` : upperJob);
            p.clearNets?.();
            p.clear?.();
        }
        setShowJobPrompt(false);
        setJobInput('');
        setError('');
        setPendingPrompt(null);
    };

    const cancelSave = () => {
        const p = pendingPrompt;
        const count = p?.data?.length || 0;
        if (count > 0) {
            const backupNote = p?.backedUp
                ? 'A backup copy was saved to Session History, but it will not appear in your jobs.'
                : 'It has NOT been backed up — it will be gone for good.';
            if (!window.confirm(`Discard this recording (${count.toLocaleString()} samples)?\n\n${backupNote}`)) return;
        }
        // clearNets only retires the safety log when a durable backup exists, so
        // an un-backed-up recording stays recoverable even after a discard.
        p?.clearNets?.();
        p?.clear?.();
        setShowJobPrompt(false);
        setJobInput('');
        setError('');
        setPendingPrompt(null);
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
        if (getElectronAPI().wakeSensors) await getElectronAPI().wakeSensors();
    };

    const clearZerosFor = (tagsToClear) => {
        tagsToClear.forEach(tag => { if (tag) getElectronAPI().clearTare(tag); });
    };

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

    const anyLogging = isLogging || (dualMode && isLoggingB);
    const totalAssigned = selectedTags.slice(0, cellCount).filter(t => t).length
        + (dualMode ? selectedTagsB.slice(0, cellCountB).filter(t => t).length : 0);

    const tagsA = selectedTags.slice(0, cellCount).filter(Boolean);
    const tagsB = dualMode ? selectedTagsB.slice(0, cellCountB).filter(Boolean) : [];

    const handleToggleDual = () => {
        if (anyLogging) return; // don't change layout mid-recording
        setDualMode(!dualMode);
    };

    const jobNumberLabel = jobInput || selectedJob?.QuoteNum;

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

            <div className="live-header">
                <div className="live-badge">LIVE MULTI-LINK</div>
                <div className="serial-box">
                    <span className="label">SIGNAL STATUS</span>
                    <span className="value">
                        {status === 'connected' ? `CONNECTED (${totalAssigned} Cells)` : 'DISCONNECTED'}
                    </span>
                </div>
                <div className="serial-box">
                    <span className="label">SAMPLE RATE</span>
                    <select className="cell-count-dropdown" value={logInterval}
                        onChange={(e) => setLogInterval(parseInt(e.target.value))} disabled={anyLogging}>
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
                <div className="serial-box">
                    <span className="label">TWO TESTS AT ONCE</span>
                    <button
                        onClick={handleToggleDual}
                        className={`action-btn ${dualMode ? '' : 'secondary'}`}
                        disabled={anyLogging}
                        style={{ fontSize: '0.78rem', padding: '4px 12px', whiteSpace: 'nowrap' }}
                        title={anyLogging ? 'Stop recording before changing test layout' : 'Record two independent load tests simultaneously'}
                    >
                        {dualMode ? '✓ Dual Test ON' : 'Enable Dual Test'}
                    </button>
                </div>
                <div className="serial-box">
                    <span className="label">COMPANION APP</span>
                    {companionRunning ? (
                        <button
                            onClick={onOpenCompanion}
                            className="action-btn secondary"
                            style={{ fontSize: '0.78rem', padding: '4px 12px', whiteSpace: 'nowrap' }}
                            title="Companion server is running — tap to view the phone connection link"
                        >
                            📱 Running{companionClients > 0 ? ` (${companionClients})` : ''} — Show Link
                        </button>
                    ) : (
                        <button
                            onClick={onStartCompanion}
                            className="action-btn"
                            style={{ fontSize: '0.78rem', padding: '4px 12px', whiteSpace: 'nowrap' }}
                            title="Start the companion server so field crew can watch live data on their phones"
                        >
                            📱 Start Server
                        </button>
                    )}
                </div>
            </div>

            {/* Global controls shared by both tests */}
            <div className="control-row" style={{ marginBottom: 12 }}>
                <button onClick={handleWakeSensors} className="action-btn secondary" title="Sends an aggressive broadcast to wake all nearby sensors">
                    Wake All Sensors
                </button>
                <div className="keep-awake-container ml-auto">
                    <label className="awake-label">
                        <input type="checkbox" checked={keepAwake} onChange={toggleKeepAwake} />
                        KEEP TRANSMITTERS AWAKE
                    </label>
                </div>
            </div>

            <div style={{
                display: 'grid',
                gridTemplateColumns: dualMode ? 'repeat(auto-fit, minmax(420px, 1fr))' : '1fr',
                gap: dualMode ? '16px' : 0
            }}>
                <TestPanel
                    label={dualMode ? 'Test A' : null}
                    status={status}
                    devices={devices}
                    allTags={tags}
                    excludeTags={tagsB}
                    selectedTags={selectedTags}
                    setSelectedTags={setSelectedTags}
                    tagNames={tagNames}
                    onRenameTag={onRenameTag}
                    cellCount={cellCount}
                    setCellCount={setCellCount}
                    isLogging={isLogging}
                    loggedData={loggedData}
                    markers={markers}
                    setMarkers={setMarkers}
                    onStart={() => startTest({
                        label: dualMode ? 'Test A' : null,
                        setLoggedData, setMarkers, setIsLogging,
                        autosaveRef: autosaveRefA,
                        otherIsLogging: dualMode && isLoggingB,
                    })}
                    onStop={() => stopTest({
                        label: dualMode ? 'Test A' : null,
                        loggedData, markers,
                        setLoggedData, setMarkers, setIsLogging,
                        autosaveRef: autosaveRefA,
                        otherIsLogging: dualMode && isLoggingB,
                    })}
                    overloadTags={overloadTags}
                    getSignalStatus={getSignalStatus}
                    getSignalLabel={getSignalLabel}
                    onZero={handleZero}
                    onClearZeros={() => clearZerosFor(tagsA)}
                    displayUnit={displayUnit}
                    onUnitChange={onUnitChange}
                    xUnit={xUnit}
                    onXUnitChange={onXUnitChange}
                    selectedJob={selectedJob}
                    jobNumberLabel={jobNumberLabel}
                    previewData={previewData}
                />

                {dualMode && (
                    <TestPanel
                        label="Test B"
                        status={status}
                        devices={devices}
                        allTags={tags}
                        excludeTags={tagsA}
                        selectedTags={selectedTagsB}
                        setSelectedTags={setSelectedTagsB}
                        tagNames={tagNames}
                        onRenameTag={onRenameTag}
                        cellCount={cellCountB}
                        setCellCount={setCellCountB}
                        isLogging={isLoggingB}
                        loggedData={loggedDataB}
                        markers={markersB}
                        setMarkers={setMarkersB}
                        onStart={() => startTest({
                            label: 'Test B',
                            setLoggedData: setLoggedDataB, setMarkers: setMarkersB, setIsLogging: setIsLoggingB,
                            autosaveRef: autosaveRefB,
                            otherIsLogging: isLogging,
                        })}
                        onStop={() => stopTest({
                            label: 'Test B',
                            loggedData: loggedDataB, markers: markersB,
                            setLoggedData: setLoggedDataB, setMarkers: setMarkersB, setIsLogging: setIsLoggingB,
                            autosaveRef: autosaveRefB,
                            otherIsLogging: isLogging,
                        })}
                        overloadTags={overloadTags}
                        getSignalStatus={getSignalStatus}
                        getSignalLabel={getSignalLabel}
                        onZero={handleZero}
                        onClearZeros={() => clearZerosFor(tagsB)}
                        displayUnit={displayUnit}
                        onUnitChange={onUnitChange}
                        xUnit={xUnit}
                        onXUnitChange={onXUnitChange}
                        selectedJob={selectedJob}
                        jobNumberLabel={jobNumberLabel}
                        previewData={previewData}
                    />
                )}
            </div>

            {lastAutosave && anyLogging && (
                <div className="autosave-indicator" style={{ marginTop: 10, justifyContent: 'center', display: 'flex', gap: 6 }}>
                    <span className="check">&#10003;</span>
                    Auto-saved {lastAutosave.toLocaleTimeString()}
                </div>
            )}

            {showJobPrompt && (
                <div className="modal-overlay">
                    <div className="job-prompt-card">
                        <h3>Save to Projects</h3>
                        <p>Complete the recording{pendingPrompt?.label ? ` for ${pendingPrompt.label}` : ''} by assigning a Job Number.</p>
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
        </div>
    );
}

export default LiveView;
