import { useState, useEffect, useMemo, useRef, useReducer } from 'react';
import logo from '../logo.png';
import ErrorBoundary from './ErrorBoundary';
import WelcomeView from './WelcomeView';
import CompanyInfoView from './CompanyInfoView';
import LiveView from './LiveView';
import ImportView from './ImportView';
import ReportView from './ReportView';
import CertificateView from './CertificateView';
import { SettingsView } from './SettingsView';
import JobSelector from './JobSelector';
import { getElectronAPI } from '../utils/electronAPI';

const navInitialState = {
    activeTab: 'welcome',
    activeJobId: null,
    selectedSharePointJob: null,
    viewingCompany: null,
    importContext: null,
    isCertPreview: false,
    displayUnit: 'lbs',
    displayTimeUnit: 'min',
    xUnit: 'min',
};

function navReducer(state, action) {
    switch (action.type) {
        case 'SET_TAB': return { ...state, activeTab: action.tab };
        case 'SELECT_JOB': return { ...state, activeJobId: action.jobId };
        case 'SELECT_SHAREPOINT_JOB': return { ...state, selectedSharePointJob: action.job };
        case 'VIEW_COMPANY': return { ...state, viewingCompany: action.company };
        case 'SET_IMPORT_CONTEXT': return { ...state, importContext: action.context };
        case 'SET_CERT_PREVIEW': return { ...state, isCertPreview: action.preview };
        case 'SET_DISPLAY_UNIT': return { ...state, displayUnit: action.unit };
        case 'SET_TIME_UNIT': return { ...state, displayTimeUnit: action.unit };
        case 'SET_X_UNIT': return { ...state, xUnit: action.unit };
        case 'GO_LIVE': return { ...state, activeTab: 'live', selectedSharePointJob: action.job };
        case 'GO_IMPORT': return { ...state, activeTab: 'import', importContext: action.context };
        default: return state;
    }
}

function ServiceView({ onGoHome, onOpenSettings }) {
    const [nav, dispatch] = useReducer(navReducer, navInitialState);
    const { activeTab, activeJobId, selectedSharePointJob, viewingCompany, importContext, isCertPreview, displayUnit, displayTimeUnit, xUnit } = nav;

    const setActiveTab = (tab) => dispatch({ type: 'SET_TAB', tab });
    const setActiveJobId = (jobId) => dispatch({ type: 'SELECT_JOB', jobId });
    const setSelectedSharePointJob = (job) => dispatch({ type: 'SELECT_SHAREPOINT_JOB', job });
    const setViewingCompany = (company) => dispatch({ type: 'VIEW_COMPANY', company });
    const setImportContext = (context) => dispatch({ type: 'SET_IMPORT_CONTEXT', context });
    const setIsCertPreview = (preview) => dispatch({ type: 'SET_CERT_PREVIEW', preview });
    const setDisplayUnit = (unit) => dispatch({ type: 'SET_DISPLAY_UNIT', unit });
    const setDisplayTimeUnit = (unit) => dispatch({ type: 'SET_TIME_UNIT', unit });
    const setXUnit = (unit) => dispatch({ type: 'SET_X_UNIT', unit });

    const [allJobs, setAllJobs] = useState([]);
    const [deviceStatus, setDeviceStatus] = useState('disconnected');
    const [recoverySession, setRecoverySession] = useState(null);
    const [showRecoveryPrompt, setShowRecoveryPrompt] = useState(false);

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
        if (getElectronAPI().onLiveData) {
            const removeListener = getElectronAPI().onLiveData((packet) => {
                devicesRef.current = { ...devicesRef.current, [packet.tag]: packet };
                setDevices({ ...devicesRef.current });

                const activeTags = selectedTagsRef.current.slice(0, cellCountRef.current);
                if (isLoggingRef.current && activeTags.includes(packet.tag)) {
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
            const saved = await getElectronAPI().loadData('dashboard-data.json');
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
            if (getElectronAPI().getDeviceStatus) {
                const status = await getElectronAPI().getDeviceStatus();
                if (status) setDeviceStatus(status);
            }
        };
        syncStatus();

        if (getElectronAPI().onDeviceStatusChanged) {
            getElectronAPI().onDeviceStatusChanged((status) => {
                if (status) setDeviceStatus(status);
            });
        }

        const checkRecovery = async () => {
            if (getElectronAPI().checkRecovery) {
                const hasRecovery = await getElectronAPI().checkRecovery();
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
            getElectronAPI().saveData({
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
            getElectronAPI().startPolling(activeTags);
        } else {
            getElectronAPI().stopPolling();
        }

        if (deviceStatus === 'connected' && getElectronAPI().getKeepStatus) {
            getElectronAPI().getKeepStatus().then(isActive => {
                setKeepAwake(isActive);
            });
        }
    }, [selectedTags, cellCount, deviceStatus]);

    const handleRecover = async () => {
        if (getElectronAPI().loadRecovery) {
            const data = await getElectronAPI().loadRecovery();
            setRecoverySession(data);
            setActiveTab('live');
        }
        setShowRecoveryPrompt(false);
    };

    const handleDiscardRecovery = async () => {
        if (getElectronAPI().clearRecovery) {
            await getElectronAPI().clearRecovery();
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

        // Auto-detect input time unit from column headers
        const headers = data.length > 0 ? Object.keys(data[0]) : [];
        const timeHeader = headers.find(h => /elapsed|second/i.test(h)) || headers.find(h => /time|stamp/i.test(h)) || '';
        let detectedTimeUnit = 'sec';
        if (/ms|millisecond/i.test(timeHeader)) detectedTimeUnit = 'ms';
        else if (/min/i.test(timeHeader)) detectedTimeUnit = 'min';
        else if (/hour|hr/i.test(timeHeader)) detectedTimeUnit = 'hrs';

        if (existingJobIndex !== -1) {
            // Replace existing job's data with new import
            const existingJob = allJobs[existingJobIndex];

            const newDataSet = {
                data: data,
                name: extraMetadata.fileName || 'Data Set 1',
                inputTimeUnit: detectedTimeUnit,
                timestamp: Date.now()
            };

            const updatedJob = {
                ...existingJob,
                dataSets: [newDataSet],
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
                    inputTimeUnit: detectedTimeUnit,
                    timestamp: Date.now()
                }],
                metadata: { jobNumber, ...extraMetadata }
            };
            updatedJobs = [newJob, ...allJobs];
            finalJobId = newJob.id;
        }

        setAllJobs(updatedJobs);
        setActiveJobId(finalJobId);

        if (getElectronAPI().clearRecovery) {
            getElectronAPI().clearRecovery();
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
        getElectronAPI().saveData({
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
        getElectronAPI().saveData({
            jobs: updatedJobs,
            lastActiveJobId: activeJobId
        }, 'dashboard-data.json');
    };

    const handleClearAllData = (jobId) => {
        if (!window.confirm('Are you sure you want to clear all data sets for this job? This cannot be undone.')) return;

        const updatedJobs = allJobs.map(j => {
            if (j.id.toString() === jobId.toString()) {
                return { ...j, dataSets: [] };
            }
            return j;
        });

        setAllJobs(updatedJobs);
        getElectronAPI().saveData({
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
        getElectronAPI().saveData({
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
                        <span className={`status-dot ${deviceStatus || 'disconnected'}`}></span>
                        {(deviceStatus || 'disconnected').charAt(0).toUpperCase() + (deviceStatus || 'disconnected').slice(1)}
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
                            onClearAllData={() => handleClearAllData(activeJob.id)}
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

export default ServiceView;
