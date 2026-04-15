import { useState, useEffect, useRef, useCallback } from 'react';
import { useTheme } from '../App';
import ErrorBoundary from './ErrorBoundary';
import LiveGraph from './LiveGraph';
import CustomerReport from './CustomerReport';
import { getElectronAPI } from '../utils/electronAPI';

// ── Unit Conversion Calculator ──
function ConverterTab() {
    const [inputVal, setInputVal] = useState('');
    const [fromUnit, setFromUnit] = useState('lbs');
    const [toUnit, setToUnit] = useState('kg');

    const units = {
        // Weight
        lbs: { label: 'Pounds (lbs)', category: 'Weight', toBase: v => v * 0.45359237, fromBase: v => v / 0.45359237 },
        kg: { label: 'Kilograms (kg)', category: 'Weight', toBase: v => v, fromBase: v => v },
        shortTons: { label: 'Short Tons (US)', category: 'Weight', toBase: v => v * 907.18474, fromBase: v => v / 907.18474 },
        metricTons: { label: 'Metric Tons', category: 'Weight', toBase: v => v * 1000, fromBase: v => v / 1000 },
        longTons: { label: 'Long Tons (UK)', category: 'Weight', toBase: v => v * 1016.0469, fromBase: v => v / 1016.0469 },
        oz: { label: 'Ounces (oz)', category: 'Weight', toBase: v => v * 0.02834952, fromBase: v => v / 0.02834952 },
        g: { label: 'Grams (g)', category: 'Weight', toBase: v => v / 1000, fromBase: v => v * 1000 },
        // Force
        kN: { label: 'Kilonewtons (kN)', category: 'Force', toBase: v => v * 101.97162, fromBase: v => v / 101.97162 },
        N: { label: 'Newtons (N)', category: 'Force', toBase: v => v * 0.10197162, fromBase: v => v / 0.10197162 },
        lbf: { label: 'Pound-force (lbf)', category: 'Force', toBase: v => v * 0.45359237, fromBase: v => v / 0.45359237 },
        // Length
        ft: { label: 'Feet (ft)', category: 'Length', toBase: v => v * 0.3048, fromBase: v => v / 0.3048 },
        m: { label: 'Meters (m)', category: 'Length', toBase: v => v, fromBase: v => v },
        inches: { label: 'Inches (in)', category: 'Length', toBase: v => v * 0.0254, fromBase: v => v / 0.0254 },
        cm: { label: 'Centimeters (cm)', category: 'Length', toBase: v => v * 0.01, fromBase: v => v / 0.01 },
        mm: { label: 'Millimeters (mm)', category: 'Length', toBase: v => v * 0.001, fromBase: v => v / 0.001 },
        yd: { label: 'Yards (yd)', category: 'Length', toBase: v => v * 0.9144, fromBase: v => v / 0.9144 },
        // Pressure
        psi: { label: 'PSI', category: 'Pressure', toBase: v => v * 6894.757, fromBase: v => v / 6894.757 },
        bar: { label: 'Bar', category: 'Pressure', toBase: v => v * 100000, fromBase: v => v / 100000 },
        pa: { label: 'Pascals (Pa)', category: 'Pressure', toBase: v => v, fromBase: v => v },
        kpa: { label: 'Kilopascals (kPa)', category: 'Pressure', toBase: v => v * 1000, fromBase: v => v / 1000 },
        mpa: { label: 'Megapascals (MPa)', category: 'Pressure', toBase: v => v * 1000000, fromBase: v => v / 1000000 },
    };

    const categories = [...new Set(Object.values(units).map(u => u.category))];

    const convert = () => {
        const val = parseFloat(inputVal);
        if (isNaN(val)) return '';
        const baseVal = units[fromUnit].toBase(val);
        return units[toUnit].fromBase(baseVal);
    };

    const result = convert();
    const swapUnits = () => { setFromUnit(toUnit); setToUnit(fromUnit); };

    return (
        <div className="converter-tab">
            <h2>Unit Converter</h2>
            <p className="converter-subtitle">Quick conversions for weight, force, length, and pressure</p>

            <div className="converter-card">
                <div className="converter-row">
                    <div className="converter-input-group">
                        <label>From</label>
                        <input
                            type="number"
                            className="large-input"
                            value={inputVal}
                            onChange={(e) => setInputVal(e.target.value)}
                            placeholder="Enter value"
                        />
                        <select className="converter-select" value={fromUnit} onChange={(e) => setFromUnit(e.target.value)}>
                            {categories.map(cat => (
                                <optgroup key={cat} label={cat}>
                                    {Object.entries(units).filter(([, u]) => u.category === cat).map(([key, u]) => (
                                        <option key={key} value={key}>{u.label}</option>
                                    ))}
                                </optgroup>
                            ))}
                        </select>
                    </div>

                    <button className="swap-btn" onClick={swapUnits} title="Swap units">&#8644;</button>

                    <div className="converter-input-group">
                        <label>To</label>
                        <div className="converter-result">
                            {result !== '' ? Number(result).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 }) : '--'}
                        </div>
                        <select className="converter-select" value={toUnit} onChange={(e) => setToUnit(e.target.value)}>
                            {categories.map(cat => (
                                <optgroup key={cat} label={cat}>
                                    {Object.entries(units).filter(([, u]) => u.category === cat).map(([key, u]) => (
                                        <option key={key} value={key}>{u.label}</option>
                                    ))}
                                </optgroup>
                            ))}
                        </select>
                    </div>
                </div>
            </div>

            {/* Quick reference table */}
            {inputVal && !isNaN(parseFloat(inputVal)) && (
                <div className="quick-ref">
                    <h3>Quick Reference — {parseFloat(inputVal).toLocaleString()} {units[fromUnit].label}</h3>
                    <div className="quick-ref-grid">
                        {Object.entries(units)
                            .filter(([key]) => key !== fromUnit && units[key].category === units[fromUnit].category)
                            .map(([key, u]) => {
                                const baseVal = units[fromUnit].toBase(parseFloat(inputVal));
                                const converted = u.fromBase(baseVal);
                                return (
                                    <div key={key} className="quick-ref-item">
                                        <span className="quick-ref-value">{Number(converted).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</span>
                                        <span className="quick-ref-label">{u.label}</span>
                                    </div>
                                );
                            })}
                    </div>
                </div>
            )}
        </div>
    );
}

// ── Help & Contact Page ──
function HelpTab({ onShowGuide }) {
    return (
        <div className="help-tab">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                <div>
                    <h2 style={{ margin: 0 }}>Help & Support</h2>
                    <p className="help-subtitle" style={{ margin: '4px 0 0' }}>Resources, documentation, and contact information</p>
                </div>
                {onShowGuide && (
                    <button className="action-btn secondary" onClick={onShowGuide} style={{ whiteSpace: 'nowrap' }}>
                        📖 Show Setup Guide
                    </button>
                )}
            </div>

            <div className="help-section">
                <h3>Contact Us</h3>
                <div className="contact-banner">
                    <div className="contact-banner-left">
                        <div className="contact-row">
                            <span className="contact-label">Office</span>
                            <span className="contact-value">(713) 643-9990</span>
                        </div>
                        <div className="contact-row">
                            <span className="contact-label">Project Manager</span>
                            <span className="contact-value">(281) 967-1130</span>
                        </div>
                        <div className="contact-row">
                            <span className="contact-label">Email</span>
                            <span className="contact-value">mgreenleaf@hydrowates.com</span>
                        </div>
                    </div>
                    <div className="contact-banner-divider"></div>
                    <div className="contact-banner-right">
                        <div className="contact-row">
                            <span className="contact-label">Website</span>
                            <a
                                href="#"
                                className="contact-value contact-link"
                                onClick={(e) => { e.preventDefault(); getElectronAPI().openExternal('https://www.hydrowates.com'); }}
                            >
                                www.hydrowates.com
                            </a>
                        </div>
                        <div className="contact-row">
                            <span className="contact-label">Address</span>
                            <span className="contact-value">8100 Lockheed Ave.<br/>Houston, TX 77061</span>
                        </div>
                    </div>
                </div>
            </div>

            <div className="help-section">
                <h3>Documents & Guides</h3>
                <div className="help-docs-grid">
                    <div className="help-doc-card" onClick={() => getElectronAPI().openBundledDoc('Rental-Procedure-Water-Bag.pdf')}>
                        <div className="doc-icon">&#128203;</div>
                        <div className="doc-content">
                            <strong>Rental Procedure — Water Bag</strong>
                            <p>Standard operating procedure for water bag rental, setup, and load testing.</p>
                        </div>
                    </div>
                    <div className="help-doc-card" onClick={() => getElectronAPI().openBundledDoc('OSCAR-Quick-Start-Guide.pdf')}>
                        <div className="doc-icon">&#128196;</div>
                        <div className="doc-content">
                            <strong>OSCAR Quick Start Guide</strong>
                            <p>Getting started with live data capture, recording sessions, and saving your data.</p>
                        </div>
                    </div>
                    <div className="help-doc-card">
                        <div className="doc-icon">&#128295;</div>
                        <div className="doc-content">
                            <strong>Troubleshooting</strong>
                            <p>Common issues with dongle connections, sensor wake-up, and data recording.</p>
                        </div>
                    </div>
                </div>
            </div>

            <div className="help-section">
                <h3>Frequently Asked Questions</h3>
                <div className="faq-list">
                    <details className="faq-item">
                        <summary>How do I connect my T24 sensors?</summary>
                        <p>Plug the T24 USB dongle into your computer. OSCAR will automatically detect it. Power on your load cell transmitters and they will appear in the cell assignment dropdowns. Use "Wake All Sensors" if they don't appear within a few seconds.</p>
                    </details>
                    <details className="faq-item">
                        <summary>How do I save my recorded data?</summary>
                        <p>After stopping a recording, click "Save Data as CSV" to save the raw data, or "Save Graph as Image" to save a screenshot of the graph. Both files will be saved to a location you choose on your computer.</p>
                    </details>
                    <details className="faq-item">
                        <summary>What does "Zero" do on a load cell?</summary>
                        <p>Zeroing (taring) a load cell sets the current reading as the zero reference point. This is useful for subtracting the weight of rigging or equipment so you only measure the actual load.</p>
                    </details>
                    <details className="faq-item">
                        <summary>Can I use OSCAR without internet?</summary>
                        <p>Yes! Live data capture, recording, and saving to your computer all work completely offline. Internet is only needed for syncing with SharePoint job lists in the Service mode.</p>
                    </details>
                    <details className="faq-item">
                        <summary>What sample rate should I use?</summary>
                        <p>For most load tests, "1 Second" is a good balance between detail and file size. Use "Continuous" for high-speed tests or short durations. Use longer intervals (30s, 1 min) for extended monitoring sessions.</p>
                    </details>
                </div>
            </div>
        </div>
    );
}

// ── Main Customer View ──
function CustomerView({ onGoHome }) {
    const { theme, toggleTheme } = useTheme();
    const [activeTab, setActiveTab] = useState('live');
    const [fullscreenMode, setFullscreenMode] = useState(false);
    const [gpsLocation, setGpsLocation] = useState(null);
    const [gpsLoading, setGpsLoading] = useState(false);
    const [deviceStatus, setDeviceStatus] = useState('disconnected');
    const [devices, setDevices] = useState({});
    const [selectedTags, setSelectedTags] = useState(Array(10).fill(null));
    const [cellCount, setCellCount] = useState(1);
    const [isLogging, setIsLogging] = useState(false);
    const [loggedData, setLoggedData] = useState([]);
    const [logInterval, setLogInterval] = useState(0);
    const [keepAwake, setKeepAwake] = useState(false);
    const [previewData, setPreviewData] = useState([]);
    const [displayUnit, setDisplayUnit] = useState('lbs');
    const [xUnit, setXUnit] = useState('min');
    const [sessionName, setSessionName] = useState('');
    const [savedMessage, setSavedMessage] = useState('');

    // Feature #1: Overload Alarm
    const [wllThreshold, setWllThreshold] = useState(0); // 0 = disabled
    const [overloadTags, setOverloadTags] = useState(new Set());
    const overloadAudioRef = useRef(null);

    // Feature #3: Signal strength / last-seen per cell
    const [lastPacketTimes, setLastPacketTimes] = useState({}); // tag -> timestamp

    // Feature #8: Peak hold display
    const [peakValues, setPeakValues] = useState({}); // tag -> max value during recording

    // Feature #5: Session history
    const [savedSessions, setSavedSessions] = useState([]);
    const [showHistory, setShowHistory] = useState(false);

    // Feature #6: PDF Report
    const [showReport, setShowReport] = useState(false);

    // Feature #2: Auto-save indicator
    const [lastAutosave, setLastAutosave] = useState(null);

    // Welcome Guide
    const [showWelcome, setShowWelcome] = useState(false);
    const [welcomeStep, setWelcomeStep] = useState(0);

    // Companion Server state
    const [companionRunning, setCompanionRunning] = useState(false);
    const [companionIPs, setCompanionIPs] = useState([]);
    const [companionPort, setCompanionPort] = useState(3001);
    const [companionClients, setCompanionClients] = useState(0);
    const [companionPhotos, setCompanionPhotos] = useState([]);
    const companionPollRef = useRef(null);

    const devicesRef = useRef({});
    const selectedTagsRef = useRef(selectedTags);
    const cellCountRef = useRef(cellCount);
    const isLoggingRef = useRef(isLogging);
    const logIntervalRef = useRef(logInterval);
    const lastLoggedTimesRef = useRef({});
    const chartRef = useRef(null);
    const autosaveTimerRef = useRef(null);
    const peakValuesRef = useRef({});
    const wllThresholdRef = useRef(0);

    const prefsLoadedRef = useRef(false);

    useEffect(() => { selectedTagsRef.current = selectedTags; }, [selectedTags]);
    useEffect(() => { cellCountRef.current = cellCount; }, [cellCount]);
    useEffect(() => {
        isLoggingRef.current = isLogging;
        if (!isLogging) lastLoggedTimesRef.current = {};
    }, [isLogging]);
    useEffect(() => { logIntervalRef.current = logInterval; }, [logInterval]);
    useEffect(() => { wllThresholdRef.current = wllThreshold; }, [wllThreshold]);

    // Settings persistence: load preferences on mount
    useEffect(() => {
        const loadPrefs = async () => {
            const settings = await getElectronAPI().loadSettings();
            // Show welcome guide if not previously dismissed
            if (!settings?.customerWelcomeDismissed) {
                setShowWelcome(true);
                setWelcomeStep(0);
            }
            if (settings?.customerPrefs) {
                const p = settings.customerPrefs;
                if (p.cellCount) setCellCount(p.cellCount);
                if (p.logInterval !== undefined) setLogInterval(p.logInterval);
                if (p.wllThreshold !== undefined) setWllThreshold(p.wllThreshold);
                if (p.keepAwake !== undefined) setKeepAwake(p.keepAwake);
                if (p.displayUnit) setDisplayUnit(p.displayUnit);
                if (p.xUnit) setXUnit(p.xUnit);
            }
            prefsLoadedRef.current = true;
        };
        loadPrefs();
    }, []);

    // Settings persistence: save preferences on change (debounced)
    useEffect(() => {
        if (!prefsLoadedRef.current) return; // Don't save on initial load
        const timer = setTimeout(async () => {
            const settings = await getElectronAPI().loadSettings() || {};
            settings.customerPrefs = { cellCount, logInterval, wllThreshold, keepAwake, displayUnit, xUnit };
            await getElectronAPI().saveSettings(settings);
        }, 1000);
        return () => clearTimeout(timer);
    }, [cellCount, logInterval, wllThreshold, keepAwake, displayUnit, xUnit]);

    // Create overload alarm audio context
    useEffect(() => {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (AudioContext) {
            overloadAudioRef.current = new AudioContext();
        }
        return () => {
            if (overloadAudioRef.current) {
                overloadAudioRef.current.close();
            }
        };
    }, []);

    const playOverloadBeep = useCallback(() => {
        const ctx = overloadAudioRef.current;
        if (!ctx || ctx.state === 'suspended') {
            ctx?.resume();
            return;
        }
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
        } catch (e) { /* audio context issues */ }
    }, []);

    // Load session history on mount
    useEffect(() => {
        loadSessionList();
    }, []);

    const loadSessionList = async () => {
        if (getElectronAPI().listSessions) {
            const sessions = await getElectronAPI().listSessions();
            setSavedSessions(sessions || []);
        }
    };

    useEffect(() => {
        const syncStatus = async () => {
            if (getElectronAPI().getDeviceStatus) {
                const status = await getElectronAPI().getDeviceStatus();
                if (status) setDeviceStatus(status);
            }
        };
        syncStatus();
        if (getElectronAPI().onDeviceStatusChanged) {
            const unsub = getElectronAPI().onDeviceStatusChanged((status) => {
                if (status) setDeviceStatus(status);
            });
            return unsub;
        }
    }, []);

    useEffect(() => {
        if (!getElectronAPI().onLiveData) return;
        const removeListener = getElectronAPI().onLiveData((packet) => {
            devicesRef.current = { ...devicesRef.current, [packet.tag]: packet };
            setDevices({ ...devicesRef.current });

            // Feature #3: Track last packet time
            setLastPacketTimes(prev => ({ ...prev, [packet.tag]: packet.timestamp }));

            // Feature #1: Overload alarm check
            if (wllThresholdRef.current > 0 && Math.abs(packet.value) > wllThresholdRef.current) {
                setOverloadTags(prev => {
                    const next = new Set(prev);
                    next.add(packet.tag);
                    return next;
                });
                playOverloadBeep();
            } else {
                setOverloadTags(prev => {
                    if (prev.has(packet.tag)) {
                        const next = new Set(prev);
                        next.delete(packet.tag);
                        return next;
                    }
                    return prev;
                });
            }

            const activeTags = selectedTagsRef.current.slice(0, cellCountRef.current);
            if (isLoggingRef.current && activeTags.includes(packet.tag)) {
                // Feature #8: Peak hold tracking
                const currentPeak = peakValuesRef.current[packet.tag] || 0;
                if (Math.abs(packet.value) > Math.abs(currentPeak)) {
                    peakValuesRef.current[packet.tag] = packet.value;
                    setPeakValues({ ...peakValuesRef.current });
                }

                const interval = logIntervalRef.current;
                const lastLogged = lastLoggedTimesRef.current[packet.tag] || 0;
                const shouldLog = interval === 0 || (packet.timestamp - lastLogged) >= interval;
                if (shouldLog) {
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
            }

            if (!isLoggingRef.current) {
                const currentTags = [...selectedTagsRef.current];
                if (!currentTags.includes(packet.tag)) {
                    const emptyIndex = currentTags.findIndex(t => t === null);
                    if (emptyIndex !== -1 && emptyIndex < cellCountRef.current) {
                        currentTags[emptyIndex] = packet.tag;
                        selectedTagsRef.current = currentTags;
                        setSelectedTags(currentTags);
                    }
                }
            }

            const now = Date.now();
            setPreviewData(prev => {
                const filtered = prev.filter(p => now - p.timestamp < 30000);
                const first = filtered.length > 0 ? filtered[0].timestamp : now;
                return [...filtered, {
                    Tag: packet.tag, value: packet.value, timestamp: packet.timestamp,
                    "Elapsed (ms)": packet.timestamp - first
                }];
            });
        });
        return () => { if (typeof removeListener === 'function') removeListener(); };
    }, [playOverloadBeep]);

    useEffect(() => {
        const activeTags = selectedTags.slice(0, cellCount);
        if (deviceStatus === 'connected' && activeTags.some(t => t)) {
            getElectronAPI().startPolling(activeTags);
        } else {
            getElectronAPI().stopPolling();
        }
    }, [selectedTags, cellCount, deviceStatus]);

    const tags = Object.keys(devices);

    // Feature #7: Auto-zero on recording start
    const zeroAllAndStart = () => {
        const activeTags = selectedTags.slice(0, cellCount).filter(t => t);
        if (activeTags.length === 0) {
            setSavedMessage('Please assign at least one load cell before recording.');
            setTimeout(() => setSavedMessage(''), 4000);
            return;
        }
        activeTags.forEach(tag => getElectronAPI().tare(tag));
        // Small delay to let zero take effect
        setTimeout(() => startLogging(), 200);
    };

    const startLogging = () => {
        // Data validation: need at least one cell assigned
        const activeTags = selectedTags.slice(0, cellCount).filter(t => t);
        if (activeTags.length === 0) {
            setSavedMessage('Please assign at least one load cell before recording.');
            setTimeout(() => setSavedMessage(''), 4000);
            return;
        }
        setLoggedData([]);
        setIsLogging(true);
        setSavedMessage('');
        // Feature #8: Reset peak hold
        peakValuesRef.current = {};
        setPeakValues({});
        if (getElectronAPI().startSafetyLog) getElectronAPI().startSafetyLog(logInterval);

        // Feature #2: Start auto-save timer (every 60 seconds)
        if (autosaveTimerRef.current) clearInterval(autosaveTimerRef.current);
        autosaveTimerRef.current = setInterval(() => {
            performAutosave();
        }, 60000);
    };

    const stopLogging = () => {
        setIsLogging(false);
        if (getElectronAPI().stopSafetyLog) getElectronAPI().stopSafetyLog();
        // Stop auto-save
        if (autosaveTimerRef.current) {
            clearInterval(autosaveTimerRef.current);
            autosaveTimerRef.current = null;
        }
    };

    // Feature #2: Auto-save function
    const performAutosave = useCallback(async () => {
        if (!isLoggingRef.current) return;
        const api = getElectronAPI();
        if (!api.autosaveSession) return;
        // Use a ref callback to get latest data
        setLoggedData(current => {
            if (current.length > 0) {
                const name = sessionName || `autosave-${new Date().toISOString().slice(0, 10)}`;
                api.autosaveSession({
                    name,
                    data: current,
                    meta: {
                        cellCount,
                        tags: selectedTagsRef.current.slice(0, cellCountRef.current).filter(Boolean),
                        peakValues: { ...peakValuesRef.current }
                    }
                });
                setLastAutosave(new Date());
            }
            return current; // Don't modify the data
        });
    }, [sessionName, cellCount]);

    // Feature #5: Save session to history
    const saveSessionToHistory = async () => {
        if (loggedData.length === 0) return;
        const name = sessionName || `Session ${new Date().toLocaleString()}`;
        const api = getElectronAPI();
        if (!api.saveSession) return;
        const activeTags = selectedTags.slice(0, cellCount).filter(Boolean);
        const result = await api.saveSession({
            name,
            data: loggedData,
            meta: {
                cellCount,
                tags: activeTags,
                peakValues: { ...peakValuesRef.current },
                duration: loggedData.length > 1 ? loggedData[loggedData.length - 1]['Elapsed (ms)'] : 0,
                totalSamples: loggedData.length
            }
        });
        if (result?.success) {
            setSavedMessage('Session saved to history!');
            setTimeout(() => setSavedMessage(''), 4000);
            loadSessionList();
            // Clear autosave since we've saved properly
            if (api.clearAutosave) api.clearAutosave();
        }
    };

    // Feature #5: Load session from history
    const loadSessionFromHistory = async (id) => {
        const api = getElectronAPI();
        if (!api.loadSession) return;
        const session = await api.loadSession(id);
        if (session && session.data) {
            setLoggedData(session.data);
            setSessionName(session.name || '');
            if (session.meta?.peakValues) {
                peakValuesRef.current = session.meta.peakValues;
                setPeakValues(session.meta.peakValues);
            }
            setShowHistory(false);
            setSavedMessage(`Loaded: ${session.name}`);
            setTimeout(() => setSavedMessage(''), 4000);
        }
    };

    const deleteSessionFromHistory = async (id) => {
        const api = getElectronAPI();
        if (!api.deleteSession) return;
        await api.deleteSession(id);
        loadSessionList();
    };

    const saveDataToCSV = async () => {
        if (loggedData.length === 0) return;
        const name = sessionName || `customer-data-${new Date().toISOString().slice(0, 10)}`;
        const result = await getElectronAPI().saveCSV(loggedData, name);
        if (result?.success) {
            setSavedMessage('Data saved successfully!');
            setTimeout(() => setSavedMessage(''), 4000);
        }
    };

    // ── Export to Customer USB/Folder ──
    const exportCustomerPackage = async () => {
        if (loggedData.length === 0) return;
        const name = sessionName || `Load-Test-${new Date().toISOString().slice(0, 10)}`;
        // Build CSV string
        const activeTags = selectedTags.slice(0, cellCount).filter(Boolean);
        const headers = ['Timestamp', 'Elapsed (s)', ...activeTags.map(t => `Cell ${t} (lbs)`)];
        const firstTs = loggedData[0]?.timestamp || 0;
        const rows = loggedData.map(row => {
            const elapsed = ((row.timestamp - firstTs) / 1000).toFixed(1);
            const vals = activeTags.map(t => (row[t] !== undefined ? row[t].toFixed(2) : ''));
            return [new Date(row.timestamp).toISOString(), elapsed, ...vals].join(',');
        });
        const csvData = [headers.join(','), ...rows].join('\n');

        const result = await getElectronAPI().exportCustomerPackage({
            csvData,
            csvName: `${name}-data.csv`,
            sessionName: name
        });
        if (result?.success) {
            setSavedMessage(`Exported to: ${result.path}`);
            setTimeout(() => setSavedMessage(''), 6000);
        } else if (!result?.canceled) {
            setSavedMessage('Export failed');
            setTimeout(() => setSavedMessage(''), 4000);
        }
    };

    const saveGraphAsImage = () => {
        const chartContainer = chartRef.current;
        if (!chartContainer) return;
        const svgElement = chartContainer.querySelector('.recharts-wrapper svg');
        if (!svgElement) return;

        const svgData = new XMLSerializer().serializeToString(svgElement);
        const canvas = document.createElement('canvas');
        const bbox = svgElement.getBoundingClientRect();
        canvas.width = bbox.width * 2;
        canvas.height = bbox.height * 2;
        const ctx = canvas.getContext('2d');
        ctx.scale(2, 2);
        ctx.fillStyle = '#0f1923';
        ctx.fillRect(0, 0, bbox.width, bbox.height);

        const img = new Image();
        img.onload = () => {
            ctx.drawImage(img, 0, 0, bbox.width, bbox.height);
            canvas.toBlob((blob) => {
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${sessionName || 'graph'}-${new Date().toISOString().slice(0, 10)}.png`;
                a.click();
                URL.revokeObjectURL(url);
                setSavedMessage('Graph image saved!');
                setTimeout(() => setSavedMessage(''), 4000);
            }, 'image/png');
        };
        img.src = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgData)));
    };

    const handleTagChange = (index, value) => {
        const newTags = [...selectedTags];
        newTags[index] = value === 'none' ? null : value;
        setSelectedTags(newTags);
    };

    const handleZero = (tag) => { if (tag) getElectronAPI().tare(tag); };
    const handleWakeSensors = async () => { if (getElectronAPI().wakeSensors) await getElectronAPI().wakeSensors(); };
    const toggleKeepAwake = async () => { const ns = !keepAwake; setKeepAwake(ns); await getElectronAPI().toggleKeepAwake(ns); };

    const totalLbs = selectedTags.slice(0, cellCount).reduce((acc, tag) => {
        if (tag && devices[tag]) return acc + devices[tag].value;
        return acc;
    }, 0);
    const shortTons = totalLbs / 2000;
    const metricTons = totalLbs * 0.00045359237;

    // Feature #3: Signal status helper
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
        if (elapsed < 5000) return `${(elapsed / 1000).toFixed(0)}s ago`;
        return `${(elapsed / 1000).toFixed(0)}s ago`;
    };

    // Refresh signal indicators
    useEffect(() => {
        const interval = setInterval(() => {
            setLastPacketTimes(prev => ({ ...prev })); // Force re-render
        }, 1000);
        return () => clearInterval(interval);
    }, []);

    // ── Companion Server ──
    // Check companion status on mount
    useEffect(() => {
        const checkStatus = async () => {
            try {
                const status = await getElectronAPI().companionStatus();
                setCompanionRunning(status.running);
                setCompanionClients(status.clients);
                if (status.running) setCompanionIPs(status.ips);
            } catch (e) { /* ignore */ }
        };
        checkStatus();
    }, []);

    // Poll companion status while running
    useEffect(() => {
        if (companionRunning) {
            companionPollRef.current = setInterval(async () => {
                try {
                    const status = await getElectronAPI().companionStatus();
                    setCompanionClients(status.clients);
                    setCompanionIPs(status.ips);
                } catch (e) { /* ignore */ }
            }, 3000);
        }
        return () => { if (companionPollRef.current) clearInterval(companionPollRef.current); };
    }, [companionRunning]);

    // Sync session state to companion server whenever key state changes
    useEffect(() => {
        if (companionRunning && getElectronAPI().companionSyncState) {
            getElectronAPI().companionSyncState({
                selectedTags,
                cellCount,
                isLogging,
                sessionName,
                loggedSamples: loggedData.length,
            });
        }
    }, [companionRunning, selectedTags, cellCount, isLogging, sessionName, loggedData.length]);

    // Listen for photos from companion
    useEffect(() => {
        const removeListener = getElectronAPI().onCompanionPhoto?.((photo) => {
            setCompanionPhotos(prev => [...prev, photo]);
        });
        return () => { if (typeof removeListener === 'function') removeListener(); };
    }, []);

    // ── GPS Location ──
    const acquireGPS = useCallback(() => {
        if (!navigator.geolocation) return;
        setGpsLoading(true);
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                setGpsLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy });
                setGpsLoading(false);
            },
            (err) => {
                console.warn('[GPS] Failed:', err.message);
                setGpsLoading(false);
            },
            { enableHighAccuracy: true, timeout: 10000 }
        );
    }, []);

    // Auto-acquire GPS on mount
    useEffect(() => {
        if (navigator.geolocation) acquireGPS();
    }, [acquireGPS]);

    // ── Fullscreen Escape key ──
    useEffect(() => {
        const handler = (e) => { if (e.key === 'Escape' && fullscreenMode) setFullscreenMode(false); };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [fullscreenMode]);

    const handleCompanionStart = async () => {
        const result = await getElectronAPI().companionStart();
        if (result.success) {
            setCompanionRunning(true);
            setCompanionIPs(result.ips);
            setCompanionPort(result.port);
            // Update companion server with current session state
            setSavedMessage('Companion server started!');
            setTimeout(() => setSavedMessage(''), 4000);
        } else {
            setSavedMessage(`Failed to start: ${result.error}`);
            setTimeout(() => setSavedMessage(''), 4000);
        }
    };

    const handleCompanionStop = async () => {
        await getElectronAPI().companionStop();
        setCompanionRunning(false);
        setCompanionClients(0);
        setCompanionIPs([]);
        setSavedMessage('Companion server stopped');
        setTimeout(() => setSavedMessage(''), 4000);
    };

    const renderCompanionTab = () => {
        return (
            <div className="companion-tab">
                <h2>📱 Companion App</h2>
                <p style={{ color: 'var(--text-muted)', marginBottom: '1.5rem' }}>
                    Let field crew monitor live load data on their phones over the local WiFi network.
                </p>

                {/* Server Controls */}
                <div style={{
                    background: 'var(--bg-card)', borderRadius: '12px', padding: '1.5rem',
                    border: '1px solid var(--border-color)', marginBottom: '1.5rem'
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                        <div>
                            <h3 style={{ margin: 0 }}>Server Status</h3>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '6px' }}>
                                <span style={{
                                    display: 'inline-block', width: '10px', height: '10px', borderRadius: '50%',
                                    background: companionRunning ? '#22c55e' : '#ef4444',
                                    boxShadow: companionRunning ? '0 0 8px rgba(34,197,94,0.5)' : 'none'
                                }}></span>
                                <span style={{ color: companionRunning ? '#22c55e' : '#ef4444', fontWeight: 600 }}>
                                    {companionRunning ? 'Running' : 'Stopped'}
                                </span>
                                {companionRunning && (
                                    <span style={{ color: 'var(--text-muted)', fontSize: '0.85rem', marginLeft: '12px' }}>
                                        {companionClients} phone{companionClients !== 1 ? 's' : ''} connected
                                    </span>
                                )}
                            </div>
                        </div>
                        <button
                            className={`action-btn ${companionRunning ? 'danger' : 'primary'}`}
                            onClick={companionRunning ? handleCompanionStop : handleCompanionStart}
                        >
                            {companionRunning ? '⏹ Stop Server' : '▶ Start Server'}
                        </button>
                    </div>
                </div>

                {/* Connection Instructions */}
                {companionRunning && companionIPs.length > 0 && (
                    <div style={{
                        background: 'var(--bg-card)', borderRadius: '12px', padding: '1.5rem',
                        border: '1px solid var(--border-color)', marginBottom: '1.5rem'
                    }}>
                        <h3 style={{ margin: '0 0 1rem 0' }}>📲 Connect a Phone</h3>
                        <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1rem' }}>
                            Make sure the phone is on the <strong>same WiFi network</strong> as this computer, then open one of these URLs in the phone's browser:
                        </p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            {companionIPs.map((ip, i) => {
                                const url = `http://${ip.address}:${companionPort}`;
                                return (
                                    <div key={i} style={{
                                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                        background: 'var(--bg-main)', borderRadius: '8px', padding: '12px 16px',
                                        border: '1px solid var(--border-color)'
                                    }}>
                                        <div>
                                            <div style={{ fontFamily: 'monospace', fontSize: '1.1rem', fontWeight: 600, color: 'var(--accent-primary)' }}>
                                                {url}
                                            </div>
                                            <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '2px' }}>
                                                {ip.name}
                                            </div>
                                        </div>
                                        <button
                                            className="action-btn secondary"
                                            style={{ fontSize: '0.85rem', padding: '6px 14px' }}
                                            onClick={() => {
                                                navigator.clipboard.writeText(url);
                                                setSavedMessage('URL copied!');
                                                setTimeout(() => setSavedMessage(''), 2000);
                                            }}
                                        >
                                            📋 Copy
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                        <div style={{
                            marginTop: '1rem', padding: '12px', borderRadius: '8px',
                            background: 'rgba(240, 184, 0, 0.08)', border: '1px solid rgba(240, 184, 0, 0.2)',
                            color: 'var(--text-muted)', fontSize: '0.85rem'
                        }}>
                            💡 <strong>Tip:</strong> On the phone, tap "Add to Home Screen" in the browser menu to install it as an app icon.
                        </div>
                    </div>
                )}

                {/* Photos Received */}
                {companionPhotos.length > 0 && (
                    <div style={{
                        background: 'var(--bg-card)', borderRadius: '12px', padding: '1.5rem',
                        border: '1px solid var(--border-color)', marginBottom: '1.5rem'
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                            <h3 style={{ margin: 0 }}>📷 Photos from Field ({companionPhotos.length})</h3>
                            <button
                                className="action-btn secondary"
                                style={{ fontSize: '0.8rem', padding: '4px 12px' }}
                                onClick={() => setCompanionPhotos([])}
                            >
                                Clear
                            </button>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '10px' }}>
                            {companionPhotos.map((photo, i) => (
                                <div key={i} style={{ borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--border-color)' }}>
                                    <img
                                        src={photo.dataUrl}
                                        alt={`Field photo ${i + 1}`}
                                        style={{ width: '100%', height: '120px', objectFit: 'cover', display: 'block' }}
                                    />
                                    <div style={{ padding: '4px 8px', fontSize: '0.7rem', color: 'var(--text-muted)', background: 'var(--bg-main)' }}>
                                        {new Date(photo.timestamp).toLocaleTimeString()}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                {/* How It Works */}
                {!companionRunning && (
                    <div style={{
                        background: 'var(--bg-card)', borderRadius: '12px', padding: '1.5rem',
                        border: '1px solid var(--border-color)'
                    }}>
                        <h3 style={{ margin: '0 0 1rem 0' }}>How It Works</h3>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                            {[
                                { step: '1', title: 'Start the Server', desc: 'Click "Start Server" above to begin broadcasting live data on your local network.' },
                                { step: '2', title: 'Connect a Phone', desc: 'On any phone connected to the same WiFi, open the URL shown in the browser.' },
                                { step: '3', title: 'Monitor Live Data', desc: 'The phone will display real-time load readings, overload alerts with vibration, and total load.' },
                                { step: '4', title: 'Capture Photos', desc: 'Field crew can take photos from their phone that are sent back to OSCAR automatically.' },
                            ].map(item => (
                                <div key={item.step} style={{ display: 'flex', gap: '12px', alignItems: 'flex-start' }}>
                                    <div style={{
                                        width: '28px', height: '28px', borderRadius: '50%', flexShrink: 0,
                                        background: 'var(--accent-primary)', color: '#fff', fontWeight: 700,
                                        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.85rem'
                                    }}>
                                        {item.step}
                                    </div>
                                    <div>
                                        <div style={{ fontWeight: 600, marginBottom: '2px' }}>{item.title}</div>
                                        <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>{item.desc}</div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                )}
            </div>
        );
    };

    // Feature #8: Total peak
    const totalPeak = Object.values(peakValues).reduce((acc, v) => acc + Math.abs(v), 0);

    const renderLiveTab = () => {
        return (
            <>
                {/* Dongle status banner */}
                {deviceStatus === 'disconnected' && (
                    <div style={{
                        background: 'rgba(239, 68, 68, 0.12)',
                        border: '1px solid rgba(239, 68, 68, 0.3)',
                        color: '#f87171',
                        padding: '8px 16px',
                        borderRadius: 'var(--radius-sm)',
                        fontSize: '0.82rem',
                        fontWeight: 600,
                        marginBottom: 12,
                        textAlign: 'center',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 8
                    }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ef4444', display: 'inline-block' }}></span>
                        Dongle Disconnected — Plug in your T24 USB dongle to stream live data
                    </div>
                )}

                {deviceStatus === 'connected' && tags.length === 0 && (
                    <div style={{
                        background: 'rgba(251, 191, 36, 0.1)',
                        border: '1px solid rgba(251, 191, 36, 0.25)',
                        color: '#fbbf24',
                        padding: '8px 16px',
                        borderRadius: 'var(--radius-sm)',
                        fontSize: '0.82rem',
                        fontWeight: 600,
                        marginBottom: 12,
                        textAlign: 'center',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 8
                    }}>
                        <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#fbbf24', display: 'inline-block' }}></span>
                        Dongle connected — Waiting for transmitter signals...
                        <button onClick={handleWakeSensors} className="action-btn" style={{ fontSize: '0.78rem', padding: '4px 12px', marginLeft: 8 }}>
                            Wake All Sensors
                        </button>
                    </div>
                )}

                {savedMessage && <div className="customer-save-toast">{savedMessage}</div>}

                {/* Feature #1: Overload banner */}
                {overloadTags.size > 0 && (
                    <div className="overload-banner">
                        OVERLOAD WARNING — {[...overloadTags].map(t => `Cell ${t}`).join(', ')} exceeding WLL of {wllThreshold.toLocaleString()} lbs!
                    </div>
                )}

                <div className="customer-controls">
                    <div className="customer-control-group">
                        <label>Session Name</label>
                        <input type="text" className="large-input" placeholder="My Test Session" value={sessionName}
                            onChange={(e) => setSessionName(e.target.value)} disabled={isLogging} />
                    </div>
                    <div className="customer-control-group">
                        <label>Number of Cells</label>
                        <select className="cell-count-dropdown" value={cellCount}
                            onChange={(e) => setCellCount(parseInt(e.target.value))} disabled={isLogging}>
                            {[1,2,3,4,5,6,7,8,9,10].map(n => <option key={n} value={n}>{n} Cell{n > 1 ? 's' : ''}</option>)}
                        </select>
                    </div>
                    <div className="customer-control-group">
                        <label>Sample Rate</label>
                        <select className="cell-count-dropdown" value={logInterval}
                            onChange={(e) => setLogInterval(parseInt(e.target.value))} disabled={isLogging}>
                            <option value={0}>Continuous</option>
                            <option value={1000}>1 Second</option>
                            <option value={10000}>10 Seconds</option>
                            <option value={30000}>30 Seconds</option>
                            <option value={60000}>1 Minute</option>
                            <option value={300000}>5 Minutes</option>
                            <option value={600000}>10 Minutes</option>
                        </select>
                    </div>
                    {/* Feature #1: WLL Threshold */}
                    <div className="customer-control-group">
                        <label>Overload Alarm (WLL)</label>
                        <div className="wll-input-group">
                            <input type="number" value={wllThreshold || ''} placeholder="Off"
                                onChange={(e) => setWllThreshold(parseFloat(e.target.value) || 0)} />
                            <span>lbs</span>
                        </div>
                    </div>
                    <div className="customer-control-group">
                        <label className="awake-label">
                            <input type="checkbox" checked={keepAwake} onChange={toggleKeepAwake} /> Keep Awake
                        </label>
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
                                        {tags.map(tag => <option key={tag} value={tag}>Tag: {tag}</option>)}
                                    </select>
                                </div>
                                <div className="slot-body">
                                    <div className="slot-value">
                                        {(packet ? packet.value : 0).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                                    </div>
                                    <div className="slot-unit">Lbs</div>

                                    {/* Feature #8: Peak hold */}
                                    {peak !== null && peak !== undefined && (
                                        <div className="peak-hold">
                                            <span className="peak-label">Peak:</span>
                                            <span className="peak-value">
                                                {Math.abs(peak).toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} lbs
                                            </span>
                                        </div>
                                    )}

                                    {/* Feature #3: Signal indicator */}
                                    {selectedTag && (
                                        <div className="signal-indicator">
                                            <span className={`signal-dot ${signalStatus}`}></span>
                                            <span>{signalLabel}</span>
                                        </div>
                                    )}

                                    {selectedTag && <button className="zero-btn" onClick={() => handleZero(selectedTag)} disabled={isLogging}>Zero</button>}
                                </div>
                            </div>
                        );
                    })}
                </div>

                <div className="main-stats">
                    <div className="primary-stat">
                        <div className="stat-unit">TOTAL LOAD (Lbs)</div>
                        <div className="stat-big-value">{totalLbs.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}</div>
                    </div>
                </div>

                <div className="secondary-stats-grid mt-4">
                    <div className="stat-card accent">
                        <h3>Total Short Tons (US)</h3>
                        <div className="stat-value">{shortTons.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })}</div>
                    </div>
                    <div className="stat-card accent">
                        <h3>Total Metric Tons</h3>
                        <div className="stat-value">{metricTons.toLocaleString(undefined, { minimumFractionDigits: 3, maximumFractionDigits: 3 })}</div>
                    </div>
                    {/* Feature #8: Peak hold total */}
                    {isLogging && totalPeak > 0 && (
                        <div className="stat-card accent">
                            <h3>Peak Total Load</h3>
                            <div className="stat-value" style={{ color: 'var(--yellow-accent)' }}>
                                {totalPeak.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} lbs
                            </div>
                        </div>
                    )}
                </div>

                <div className="customer-record-controls mt-4">
                    {!isLogging ? (
                        <div className="control-row">
                            <button onClick={startLogging} className="action-btn large record-btn">
                                <span className="dot"></span> Start Recording
                            </button>
                            <button onClick={() => {
                                const activeTags = selectedTags.slice(0, cellCount).filter(t => t);
                                activeTags.forEach(tag => getElectronAPI().tare(tag));
                                setSavedMessage('All cells zeroed!');
                                setTimeout(() => setSavedMessage(''), 3000);
                            }} className="action-btn secondary large ml-4">
                                Zero All
                            </button>
                            <button onClick={handleWakeSensors} className="action-btn secondary ml-4">Wake All Sensors</button>
                            <button onClick={() => setFullscreenMode(true)} className="action-btn secondary ml-4" title="Fullscreen Display">⛶ Fullscreen</button>
                        </div>
                    ) : (
                        <div className="logging-active-group">
                            <button onClick={stopLogging} className="action-btn large stop-btn">
                                <span className="square"></span> Stop Recording
                            </button>
                            <div className="logging-status">
                                <span className="pulse-dot"></span>
                                Recording: {loggedData.length} samples collected
                                {/* Feature #2: Auto-save indicator */}
                                {lastAutosave && (
                                    <span className="autosave-indicator">
                                        <span className="check">&#10003;</span>
                                        Auto-saved {lastAutosave.toLocaleTimeString()}
                                    </span>
                                )}
                            </div>
                            <button onClick={() => setFullscreenMode(true)} className="action-btn secondary" title="Fullscreen Display" style={{ marginLeft: '12px' }}>⛶ Fullscreen</button>
                        </div>
                    )}
                </div>

                {!isLogging && loggedData.length > 0 && (
                    <div className="customer-save-actions mt-4">
                        <button onClick={saveDataToCSV} className="action-btn large">Save Data as CSV</button>
                        <button onClick={() => setShowReport(true)} className="action-btn large ml-4">Generate PDF Report</button>
                        <button onClick={saveGraphAsImage} className="action-btn secondary large ml-4">Save Graph as Image</button>
                        <button onClick={saveSessionToHistory} className="action-btn secondary large ml-4">Save to History</button>
                        <button onClick={exportCustomerPackage} className="action-btn secondary large ml-4">📦 Export to Folder</button>
                        <button onClick={() => { setLoggedData([]); setSavedMessage(''); setPeakValues({}); peakValuesRef.current = {}; }} className="action-btn secondary large ml-4">Clear Data</button>
                    </div>
                )}

                <div className="mt-4" ref={chartRef}>
                    <ErrorBoundary>
                        <LiveGraph
                            data={isLogging ? loggedData : (loggedData.length > 0 ? loggedData : previewData)}
                            activeTags={selectedTags.slice(0, cellCount)}
                            displayUnit={displayUnit}
                            onUnitChange={setDisplayUnit}
                            xUnit={xUnit}
                            onXUnitChange={setXUnit}
                        />
                    </ErrorBoundary>
                </div>

                {/* Feature #5: Session history section */}
                <div className="session-history mt-4">
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <h3>Session History</h3>
                        <button className="action-btn secondary" onClick={() => { setShowHistory(!showHistory); if (!showHistory) loadSessionList(); }} style={{ fontSize: '0.8rem', padding: '6px 14px' }}>
                            {showHistory ? 'Hide' : `Show (${savedSessions.length})`}
                        </button>
                    </div>
                    {showHistory && (
                        <div className="session-list">
                            {savedSessions.length === 0 ? (
                                <div className="no-sessions">No saved sessions yet. Record data and click "Save to History".</div>
                            ) : (
                                savedSessions.map(s => (
                                    <div key={s.id} className="session-item">
                                        <div className="session-item-info">
                                            <span className="session-item-name">{s.name}</span>
                                            <span className="session-item-meta">
                                                {new Date(s.savedAt).toLocaleString()} | {s.sampleCount} samples
                                                {s.meta?.tags && ` | Cells: ${s.meta.tags.join(', ')}`}
                                            </span>
                                        </div>
                                        <div className="session-item-actions">
                                            <button onClick={() => loadSessionFromHistory(s.id)}>Load</button>
                                            <button onClick={() => deleteSessionFromHistory(s.id)}>Delete</button>
                                        </div>
                                    </div>
                                ))
                            )}
                        </div>
                    )}
                </div>
            </>
        );
    };

    return (
        <div className="customer-view">
            <div className="customer-header">
                <button className="action-btn secondary" onClick={onGoHome}>Back to Main Menu</button>
                <h1>Customer Center</h1>
                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '12px' }}>
                    {gpsLocation && (
                        <div className="gps-badge" title={`${gpsLocation.lat.toFixed(5)}, ${gpsLocation.lng.toFixed(5)} (±${Math.round(gpsLocation.accuracy)}m)`}>
                            <span className="gps-dot"></span>
                            GPS
                        </div>
                    )}
                    <div className="status-indicator">
                        <span className={`status-dot ${deviceStatus}`}></span>
                        {deviceStatus.charAt(0).toUpperCase() + deviceStatus.slice(1)}
                    </div>
                    <div className="theme-toggle" title="Toggle theme">
                        <button className={`theme-toggle-option ${theme === 'light' ? 'active' : ''}`} onClick={toggleTheme}>☀️</button>
                        <button className={`theme-toggle-option ${theme === 'dark' ? 'active' : ''}`} onClick={toggleTheme}>🌙</button>
                    </div>
                </div>
            </div>

            <div className="customer-tabs">
                <button className={`customer-tab ${activeTab === 'live' ? 'active' : ''}`} onClick={() => setActiveTab('live')}>
                    Live Data
                </button>
                <button className={`customer-tab ${activeTab === 'converter' ? 'active' : ''}`} onClick={() => setActiveTab('converter')}>
                    Unit Converter
                </button>
                <button className={`customer-tab ${activeTab === 'companion' ? 'active' : ''}`} onClick={() => setActiveTab('companion')}>
                    📱 Companion{companionRunning ? ` (${companionClients})` : ''}
                </button>
                <button className={`customer-tab ${activeTab === 'help' ? 'active' : ''}`} onClick={() => setActiveTab('help')}>
                    Help & Support
                </button>
            </div>

            <div className="customer-tab-content">
                {activeTab === 'live' && renderLiveTab()}
                {activeTab === 'converter' && <ConverterTab />}
                {activeTab === 'companion' && renderCompanionTab()}
                {activeTab === 'help' && <HelpTab onShowGuide={() => { setShowWelcome(true); setWelcomeStep(0); }} />}
            </div>

            {/* PDF Report Modal */}
            {showReport && loggedData.length > 0 && (
                <CustomerReport
                    sessionName={sessionName}
                    loggedData={loggedData}
                    peakValues={peakValues}
                    activeTags={selectedTags.slice(0, cellCount).filter(Boolean)}
                    cellCount={cellCount}
                    onClose={() => setShowReport(false)}
                    onSavePDF={async () => {
                        const name = sessionName || `load-test-report-${new Date().toISOString().slice(0, 10)}`;
                        const result = await getElectronAPI().savePDF(name);
                        if (result?.success) {
                            setSavedMessage('PDF report saved!');
                            setShowReport(false);
                            setTimeout(() => setSavedMessage(''), 4000);
                        }
                    }}
                />
            )}

            {/* Fullscreen Live Display */}
            {fullscreenMode && (
                <FullscreenDisplay
                    devices={devices}
                    selectedTags={selectedTags}
                    cellCount={cellCount}
                    isLogging={isLogging}
                    loggedData={loggedData}
                    wllThreshold={wllThreshold}
                    peakValues={peakValues}
                    gpsLocation={gpsLocation}
                    onClose={() => setFullscreenMode(false)}
                />
            )}

            {/* Welcome Guide Modal */}
            {showWelcome && (
                <WelcomeGuide
                    step={welcomeStep}
                    onNext={() => setWelcomeStep(s => s + 1)}
                    onBack={() => setWelcomeStep(s => s - 1)}
                    onClose={async (dontShowAgain) => {
                        setShowWelcome(false);
                        if (dontShowAgain) {
                            const settings = await getElectronAPI().loadSettings() || {};
                            settings.customerWelcomeDismissed = true;
                            await getElectronAPI().saveSettings(settings);
                        }
                    }}
                />
            )}
        </div>
    );
}

// ── Welcome Guide Component ──
function WelcomeGuide({ step, onNext, onBack, onClose }) {
    const [dontShow, setDontShow] = useState(false);

    const steps = [
        {
            icon: '👋',
            title: 'Welcome to OSCAR',
            subtitle: 'Your wireless load monitoring system',
            content: (
                <>
                    <p>OSCAR connects to <strong>T24 wireless load cell transmitters</strong> to give you real-time weight readings on screen — no cables required.</p>
                    <p>This quick guide will walk you through the basics so you can start monitoring loads in just a few minutes.</p>
                </>
            ),
        },
        {
            icon: '🔌',
            title: 'Step 1: Connect the USB Dongle',
            subtitle: 'Plug in the T24 receiver',
            content: (
                <>
                    <p>Plug the <strong>T24 USB dongle</strong> into any USB port on this computer.</p>
                    <p>OSCAR will automatically detect it — you'll see the status at the top change from <span style={{ color: '#ef4444', fontWeight: 600 }}>Disconnected</span> to <span style={{ color: '#22c55e', fontWeight: 600 }}>Connected</span>.</p>
                    <div style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: '8px', padding: '12px', marginTop: '12px', fontSize: '0.9rem' }}>
                        💡 If the dongle is already plugged in, OSCAR may have detected it automatically.
                    </div>
                </>
            ),
        },
        {
            icon: '📡',
            title: 'Step 2: Power On Your Load Cells',
            subtitle: 'Turn on the T24 transmitters',
            content: (
                <>
                    <p>Turn on your <strong>T24 wireless load cell transmitters</strong>. They will begin broadcasting wirelessly to the USB dongle.</p>
                    <p>You should see available sensors appear in the <strong>cell assignment dropdowns</strong> within a few seconds.</p>
                    <div style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: '8px', padding: '12px', marginTop: '12px', fontSize: '0.9rem' }}>
                        💡 If sensors don't appear, try clicking <strong>"Wake All Sensors"</strong> — this sends a burst signal to wake up any sleeping transmitters.
                    </div>
                </>
            ),
        },
        {
            icon: '⚙️',
            title: 'Step 3: Assign Your Load Cells',
            subtitle: 'Choose which cells to monitor',
            content: (
                <>
                    <p>Use the <strong>"Number of Cells"</strong> selector to set how many load cells you're using (1–10).</p>
                    <p>Then use the <strong>dropdown on each cell card</strong> to assign a detected sensor. You'll see live weight readings appear immediately.</p>
                    <p>You can also <strong>zero (tare) individual cells</strong> to subtract rigging weight by clicking the "Zero" button on each card.</p>
                </>
            ),
        },
        {
            icon: '⚠️',
            title: 'Step 4: Set an Overload Alarm (Optional)',
            subtitle: 'Get alerted when weight exceeds a limit',
            content: (
                <>
                    <p>Enter a <strong>WLL (Working Load Limit)</strong> value in the field at the top. If any cell exceeds this threshold, OSCAR will:</p>
                    <ul style={{ margin: '10px 0', paddingLeft: '20px', lineHeight: '1.8' }}>
                        <li>Flash the cell card <span style={{ color: '#ef4444', fontWeight: 600 }}>red</span></li>
                        <li>Sound an <strong>audible alarm beep</strong></li>
                    </ul>
                    <p>Set it to <strong>0</strong> or leave it blank to disable the alarm.</p>
                </>
            ),
        },
        {
            icon: '🔴',
            title: 'Step 5: Record Your Data',
            subtitle: 'Capture load readings over time',
            content: (
                <>
                    <p>When you're ready, click <strong>"Start Recording"</strong>. OSCAR will log every reading to build a time-series graph.</p>
                    <p>Use the <strong>"Zero All"</strong> button first if you want to zero all cells before recording.</p>
                    <p>Choose a <strong>sample rate</strong> — "1 Second" works well for most load tests. Use "Continuous" for fast events or longer intervals for extended monitoring.</p>
                    <div style={{ background: 'rgba(59,130,246,0.08)', border: '1px solid rgba(59,130,246,0.2)', borderRadius: '8px', padding: '12px', marginTop: '12px', fontSize: '0.9rem' }}>
                        💡 Your data auto-saves every 60 seconds, so you won't lose anything if something goes wrong.
                    </div>
                </>
            ),
        },
        {
            icon: '💾',
            title: 'Step 6: Save & Export',
            subtitle: 'Get your results off the computer',
            content: (
                <>
                    <p>After stopping the recording, you have several options:</p>
                    <ul style={{ margin: '10px 0', paddingLeft: '20px', lineHeight: '1.8' }}>
                        <li><strong>Save Data as CSV</strong> — Raw data for Excel or other tools</li>
                        <li><strong>Generate PDF Report</strong> — Branded one-page summary with statistics</li>
                        <li><strong>Save Graph as Image</strong> — Screenshot of the time-series chart</li>
                        <li><strong>Save to History</strong> — Keep it in OSCAR for later review</li>
                    </ul>
                </>
            ),
        },
        {
            icon: '🎉',
            title: 'You\'re All Set!',
            subtitle: 'Start monitoring your loads with confidence',
            content: (
                <>
                    <p>That's everything you need to know. Here are a few bonus features:</p>
                    <ul style={{ margin: '10px 0', paddingLeft: '20px', lineHeight: '1.8' }}>
                        <li><strong>📱 Companion App</strong> — Let your field crew monitor data on their phones</li>
                        <li><strong>🔄 Unit Converter</strong> — Quick conversions between lbs, kg, tons, etc.</li>
                        <li><strong>❓ Help & Support</strong> — Contact info and FAQs</li>
                    </ul>
                    <p>If you need this guide again, visit the <strong>Help & Support</strong> tab.</p>
                </>
            ),
        },
    ];

    const current = steps[step];
    const isLast = step === steps.length - 1;
    const isFirst = step === 0;

    return (
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(dontShow); }}>
            <div style={{
                background: 'linear-gradient(145deg, var(--bg-card), var(--bg-elevated, var(--bg-card)))',
                border: '1px solid var(--border-color)',
                borderRadius: '16px',
                width: '560px',
                maxWidth: '90vw',
                maxHeight: '85vh',
                overflow: 'hidden',
                boxShadow: '0 25px 60px rgba(0,0,0,0.5)',
                animation: 'slideUp 0.3s ease-out',
                display: 'flex',
                flexDirection: 'column',
            }}>
                {/* Header */}
                <div style={{
                    padding: '28px 32px 20px',
                    borderBottom: '1px solid var(--border-color)',
                    textAlign: 'center',
                }}>
                    <div style={{ fontSize: '2.5rem', marginBottom: '8px' }}>{current.icon}</div>
                    <h2 style={{ margin: '0 0 4px', fontSize: '1.4rem' }}>{current.title}</h2>
                    <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '0.95rem' }}>{current.subtitle}</p>
                </div>

                {/* Content */}
                <div style={{
                    padding: '24px 32px',
                    flex: 1,
                    overflowY: 'auto',
                    fontSize: '0.95rem',
                    lineHeight: '1.7',
                    color: 'var(--text-primary)',
                }}>
                    {current.content}
                </div>

                {/* Progress dots */}
                <div style={{
                    display: 'flex', justifyContent: 'center', gap: '8px',
                    padding: '0 32px 12px',
                }}>
                    {steps.map((_, i) => (
                        <div key={i} style={{
                            width: i === step ? '24px' : '8px',
                            height: '8px',
                            borderRadius: '4px',
                            background: i === step ? 'var(--accent-primary)' : i < step ? 'var(--accent-primary)' : 'var(--border-color)',
                            opacity: i === step ? 1 : i < step ? 0.5 : 0.3,
                            transition: 'all 0.3s ease',
                        }} />
                    ))}
                </div>

                {/* Footer */}
                <div style={{
                    padding: '16px 32px 24px',
                    borderTop: '1px solid var(--border-color)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '0.85rem', color: 'var(--text-muted)', cursor: 'pointer' }}>
                        <input
                            type="checkbox"
                            checked={dontShow}
                            onChange={(e) => setDontShow(e.target.checked)}
                            style={{ accentColor: 'var(--accent-primary)' }}
                        />
                        Don't show this again
                    </label>
                    <div style={{ display: 'flex', gap: '10px' }}>
                        {!isFirst && (
                            <button className="action-btn secondary" onClick={onBack} style={{ padding: '8px 20px' }}>
                                Back
                            </button>
                        )}
                        {isFirst && (
                            <button className="action-btn secondary" onClick={() => onClose(dontShow)} style={{ padding: '8px 20px' }}>
                                Skip
                            </button>
                        )}
                        {!isLast ? (
                            <button className="action-btn primary" onClick={onNext} style={{ padding: '8px 24px' }}>
                                Next →
                            </button>
                        ) : (
                            <button className="action-btn primary" onClick={() => onClose(dontShow)} style={{ padding: '8px 24px' }}>
                                Get Started
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

// ── Fullscreen Live Display ──
function FullscreenDisplay({ devices, selectedTags, cellCount, isLogging, loggedData, wllThreshold, peakValues, gpsLocation, onClose }) {
    const activeTags = selectedTags.slice(0, cellCount).filter(Boolean);
    const totalLbs = activeTags.reduce((sum, tag) => {
        const val = devices[tag]?.value || 0;
        return sum + Math.abs(val);
    }, 0);

    const totalPeak = Object.values(peakValues).reduce((acc, v) => acc + Math.abs(v), 0);

    // Force re-render every second for live updates
    const [, setTick] = useState(0);
    useEffect(() => {
        const interval = setInterval(() => setTick(t => t + 1), 500);
        return () => clearInterval(interval);
    }, []);

    return (
        <div className="fullscreen-overlay">
            <div className="fullscreen-header">
                <h2>OSCAR — Live Monitor</h2>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                    {gpsLocation && (
                        <div className="gps-badge">
                            <span className="gps-dot"></span>
                            {gpsLocation.lat.toFixed(4)}, {gpsLocation.lng.toFixed(4)}
                        </div>
                    )}
                    {wllThreshold > 0 && (
                        <span style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                            WLL: {wllThreshold.toLocaleString()} lbs
                        </span>
                    )}
                    <button className="action-btn secondary" onClick={onClose} style={{ padding: '6px 16px' }}>
                        ✕ Exit Fullscreen
                    </button>
                </div>
            </div>

            <div className="fullscreen-body">
                <div className="fullscreen-total">
                    <div className="fullscreen-total-label">Total Load</div>
                    <div className="fullscreen-total-value">
                        {totalLbs.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                        <span className="fullscreen-total-unit">lbs</span>
                    </div>
                    {isLogging && totalPeak > 0 && (
                        <div style={{ fontSize: '1.2rem', color: 'var(--yellow-accent)', marginTop: '8px' }}>
                            Peak: {totalPeak.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} lbs
                        </div>
                    )}
                </div>

                <div className="fullscreen-cells">
                    {activeTags.map((tag, i) => {
                        const value = Math.abs(devices[tag]?.value || 0);
                        const isOverload = wllThreshold > 0 && value > wllThreshold;
                        const peak = peakValues[tag] ? Math.abs(peakValues[tag]) : 0;
                        return (
                            <div key={tag} className={`fullscreen-cell ${isOverload ? 'overload' : ''}`}>
                                <div className="fullscreen-cell-label">Cell {i + 1} — {tag}</div>
                                <div className="fullscreen-cell-value">
                                    {value.toLocaleString(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 })}
                                </div>
                                {isLogging && peak > 0 && (
                                    <div style={{ fontSize: '0.85rem', color: 'var(--yellow-accent)', marginTop: '4px' }}>
                                        Peak: {peak.toLocaleString(undefined, { minimumFractionDigits: 1 })}
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            <div className="fullscreen-status-bar">
                {isLogging && (
                    <>
                        <div className="recording-dot"></div>
                        <span>Recording — {loggedData.length} samples</span>
                    </>
                )}
                <span style={{ marginLeft: 'auto' }}>
                    {new Date().toLocaleTimeString()} | Press ESC to exit
                </span>
            </div>
        </div>
    );
}

// ── Signature Pad Component ──
function SignaturePad({ onSave, onClose }) {
    const canvasRef = useRef(null);
    const isDrawing = useRef(false);
    const [hasDrawn, setHasDrawn] = useState(false);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d');
        // Set canvas size
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * 2;
        canvas.height = rect.height * 2;
        ctx.scale(2, 2);
        ctx.lineWidth = 2;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        ctx.strokeStyle = '#1a1a2e';
        // Draw signature line
        ctx.beginPath();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = '#ccc';
        ctx.moveTo(20, rect.height - 30);
        ctx.lineTo(rect.width - 20, rect.height - 30);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.strokeStyle = '#1a1a2e';
    }, []);

    const getPos = (e) => {
        const canvas = canvasRef.current;
        const rect = canvas.getBoundingClientRect();
        const clientX = e.touches ? e.touches[0].clientX : e.clientX;
        const clientY = e.touches ? e.touches[0].clientY : e.clientY;
        return { x: clientX - rect.left, y: clientY - rect.top };
    };

    const startDraw = (e) => {
        e.preventDefault();
        isDrawing.current = true;
        const ctx = canvasRef.current.getContext('2d');
        const pos = getPos(e);
        ctx.beginPath();
        ctx.moveTo(pos.x, pos.y);
        setHasDrawn(true);
    };

    const draw = (e) => {
        e.preventDefault();
        if (!isDrawing.current) return;
        const ctx = canvasRef.current.getContext('2d');
        const pos = getPos(e);
        ctx.strokeStyle = '#1a1a2e';
        ctx.lineWidth = 2;
        ctx.lineTo(pos.x, pos.y);
        ctx.stroke();
    };

    const endDraw = () => { isDrawing.current = false; };

    const clearSignature = () => {
        const canvas = canvasRef.current;
        const ctx = canvas.getContext('2d');
        const rect = canvas.getBoundingClientRect();
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        // Redraw signature line
        ctx.beginPath();
        ctx.setLineDash([4, 4]);
        ctx.strokeStyle = '#ccc';
        ctx.moveTo(20, rect.height - 30);
        ctx.lineTo(rect.width - 20, rect.height - 30);
        ctx.stroke();
        ctx.setLineDash([]);
        setHasDrawn(false);
    };

    const handleSave = () => {
        const canvas = canvasRef.current;
        const dataUrl = canvas.toDataURL('image/png');
        onSave(dataUrl);
    };

    return (
        <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
            <div style={{
                background: '#ffffff', borderRadius: '16px', width: '560px', maxWidth: '90vw',
                boxShadow: '0 25px 60px rgba(0,0,0,0.5)', animation: 'slideUp 0.3s ease-out',
                overflow: 'hidden'
            }}>
                <div style={{ padding: '20px 24px', borderBottom: '1px solid #e5e7eb' }}>
                    <h3 style={{ margin: 0, color: '#1a1a2e' }}>Customer Signature</h3>
                    <p style={{ margin: '4px 0 0', color: '#6b7280', fontSize: '0.9rem' }}>
                        Sign below to acknowledge the load test results
                    </p>
                </div>
                <div style={{ padding: '16px 24px' }}>
                    <canvas
                        ref={canvasRef}
                        style={{
                            width: '100%', height: '200px', border: '2px solid #d1d5db',
                            borderRadius: '8px', cursor: 'crosshair', background: '#fafafa',
                            touchAction: 'none'
                        }}
                        onMouseDown={startDraw}
                        onMouseMove={draw}
                        onMouseUp={endDraw}
                        onMouseLeave={endDraw}
                        onTouchStart={startDraw}
                        onTouchMove={draw}
                        onTouchEnd={endDraw}
                    />
                </div>
                <div style={{ padding: '16px 24px 20px', display: 'flex', justifyContent: 'space-between', borderTop: '1px solid #e5e7eb' }}>
                    <button className="action-btn secondary" onClick={clearSignature}>Clear</button>
                    <div style={{ display: 'flex', gap: '10px' }}>
                        <button className="action-btn secondary" onClick={onClose}>Cancel</button>
                        <button className="action-btn primary" onClick={handleSave} disabled={!hasDrawn}>
                            Save Signature
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

export { SignaturePad };
export default CustomerView;
