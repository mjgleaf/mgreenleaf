import { useState, useEffect, useMemo, useRef, useReducer } from 'react';
import { useTheme } from '../App';
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
import { QRCodeSVG } from 'qrcode.react';
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
    const { theme, toggleTheme } = useTheme();
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
    // Set when a job is selected from the dashboard so the certificate section
    // offers to generate the cert with AI on arrival. Reset once the user answers.
    const [aiPromptPending, setAiPromptPending] = useState(false);
    // When leaving the certificate screen with a set-up cert, ask whether to save it
    // as a draft. pendingLeaveCert holds the navigation to run once the user answers.
    const [showSaveCertPrompt, setShowSaveCertPrompt] = useState(false);
    const [pendingLeaveCert, setPendingLeaveCert] = useState(null);

    // Companion Server state
    const [companionRunning, setCompanionRunning] = useState(false);
    const [companionIPs, setCompanionIPs] = useState([]);
    const [companionPort, setCompanionPort] = useState(3001);
    const [companionToken, setCompanionToken] = useState('');
    const [companionClients, setCompanionClients] = useState(0);
    const [companionPhotos, setCompanionPhotos] = useState([]);
    const [companionLeaks, setCompanionLeaks] = useState([]);
    const companionPollRef = useRef(null);

    // --- Lifted Live Telemetry & Logging State ---
    const [devices, setDevices] = useState({}); // tag -> latest packet
    const [logInterval, setLogInterval] = useState(0); // ms (shared sample rate)
    const [keepAwake, setKeepAwake] = useState(false);
    const [previewData, setPreviewData] = useState([]); // Rolling buffer for preview

    // Dual-test mode: record two independent load tests at once. Test A is the
    // original single-test path (unchanged when dualMode is off); Test B is a
    // parallel recording session that saves as a second data set on the same job.
    const [dualMode, setDualMode] = useState(false);

    // Test A
    const [selectedTags, setSelectedTags] = useState(Array(10).fill(null));
    const [cellCount, setCellCount] = useState(1);
    const [isLogging, setIsLogging] = useState(false);
    const [loggedData, setLoggedData] = useState([]);
    const [markers, setMarkers] = useState([]); // test-phase markers for the active recording

    // Test B (only active while dualMode is on)
    const [selectedTagsB, setSelectedTagsB] = useState(Array(10).fill(null));
    const [cellCountB, setCellCountB] = useState(1);
    const [isLoggingB, setIsLoggingB] = useState(false);
    const [loggedDataB, setLoggedDataB] = useState([]);
    const [markersB, setMarkersB] = useState([]);

    // Refs for IPC listener access
    const [saveStatus, setSaveStatus] = useState('synced'); // 'synced' | 'saving' | 'error'
    const devicesRef = useRef({});
    const logIntervalRef = useRef(logInterval);
    const dualModeRef = useRef(dualMode);
    const selectedTagsRef = useRef(selectedTags);
    const cellCountRef = useRef(cellCount);
    const isLoggingRef = useRef(isLogging);
    const lastLoggedTimesRef = useRef({}); // tag -> time (Test A)
    const selectedTagsBRef = useRef(selectedTagsB);
    const cellCountBRef = useRef(cellCountB);
    const isLoggingBRef = useRef(isLoggingB);
    const lastLoggedTimesBRef = useRef({}); // tag -> time (Test B)

    useEffect(() => { logIntervalRef.current = logInterval; }, [logInterval]);
    useEffect(() => { dualModeRef.current = dualMode; }, [dualMode]);
    useEffect(() => { selectedTagsRef.current = selectedTags; }, [selectedTags]);
    useEffect(() => { cellCountRef.current = cellCount; }, [cellCount]);
    useEffect(() => {
        isLoggingRef.current = isLogging;
        if (!isLogging) lastLoggedTimesRef.current = {};
    }, [isLogging]);
    useEffect(() => { selectedTagsBRef.current = selectedTagsB; }, [selectedTagsB]);
    useEffect(() => { cellCountBRef.current = cellCountB; }, [cellCountB]);
    useEffect(() => {
        isLoggingBRef.current = isLoggingB;
        if (!isLoggingB) lastLoggedTimesBRef.current = {};
    }, [isLoggingB]);

    // Central Live Data Listener
    useEffect(() => {
        if (getElectronAPI().onLiveData) {
            // Append a packet to one test's logged buffer if that test is
            // logging and owns the packet's tag. Shared by Test A and Test B.
            const recordForTest = (packet, activeTags, isLoggingNow, lastTimesRef, setData) => {
                if (!isLoggingNow || !activeTags.includes(packet.tag)) return;
                const interval = logIntervalRef.current;
                const lastLogged = lastTimesRef.current[packet.tag] || 0;
                const shouldLog = interval === 0 || (packet.timestamp - lastLogged) >= interval;
                if (!shouldLog) return;

                setData(prev => {
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
                lastTimesRef.current[packet.tag] = packet.timestamp;
            };

            const removeListener = getElectronAPI().onLiveData((packet) => {
                devicesRef.current = { ...devicesRef.current, [packet.tag]: packet };
                setDevices({ ...devicesRef.current });

                const activeTags = selectedTagsRef.current.slice(0, cellCountRef.current);
                recordForTest(packet, activeTags, isLoggingRef.current, lastLoggedTimesRef, setLoggedData);

                const activeTagsB = dualModeRef.current
                    ? selectedTagsBRef.current.slice(0, cellCountBRef.current)
                    : [];
                recordForTest(packet, activeTagsB, isLoggingBRef.current, lastLoggedTimesBRef, setLoggedDataB);

                // Auto-assign a newly seen tag to an empty Test A slot. Disabled in
                // dual mode so incoming tags don't get claimed before the operator
                // can split them between the two tests manually.
                if (!isLoggingRef.current && !dualModeRef.current) {
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
                // Stay on the default 'welcome' (Dashboard & Jobs) tab after
                // loading saved data -- don't jump to the reports tab.
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
        const activeTags = [
            ...selectedTags.slice(0, cellCount),
            ...(dualMode ? selectedTagsB.slice(0, cellCountB) : [])
        ];
        if (deviceStatus === 'connected' && activeTags.some(t => t)) {
            getElectronAPI().startPolling(activeTags.filter(Boolean));
        } else {
            getElectronAPI().stopPolling();
        }

        if (deviceStatus === 'connected' && getElectronAPI().getKeepStatus) {
            getElectronAPI().getKeepStatus().then(isActive => {
                setKeepAwake(isActive);
            });
        }
    }, [selectedTags, cellCount, selectedTagsB, cellCountB, dualMode, deviceStatus]);

    // Sync session state to companion server (mobile PWA).
    // companionRunning is in the deps so the current state (tags/cells/logging)
    // is re-pushed the moment the server starts -- otherwise a server started
    // AFTER cells were configured would keep empty selectedTags and the phone
    // would show no weight.
    useEffect(() => {
        getElectronAPI().companionUpdateState({
            selectedTags,
            cellCount,
            isLogging: isLogging || (dualMode && isLoggingB),
            activeJobName: selectedSharePointJob?.JobName || selectedSharePointJob?.QuoteNum
                || (allJobs.find(j => j.id?.toString() === activeJobId?.toString())?.metadata?.jobNumber) || ''
        });
    }, [selectedTags, cellCount, isLogging, isLoggingB, dualMode, companionRunning, selectedSharePointJob, activeJobId, allJobs]);

    useEffect(() => {
        const openPhases = [];
        ['function', 'static'].forEach(phase => {
            const ph = markers.filter(m => m.phase === phase);
            if (ph.length > 0 && ph[ph.length - 1].edge === 'start') openPhases.push(phase);
        });
        getElectronAPI().companionUpdateState({ openPhases });
    }, [markers, companionRunning]);

    // Push equipment + certificates for the selected SharePoint job to the companion.
    useEffect(() => {
        const api = getElectronAPI();
        if (!api.fetchEquipmentForJob || !api.companionUpdateState) return;
        const jobNum = selectedSharePointJob?.QuoteNum || selectedSharePointJob?.JobNum || selectedSharePointJob?.JobNumber
            || (allJobs.find(j => j.id?.toString() === activeJobId?.toString())?.metadata?.jobNumber);
        if (!jobNum) {
            api.companionUpdateState({ equipmentItems: [] });
            return;
        }
        let cancelled = false;
        (async () => {
            try {
                const equipmentItems = await api.fetchEquipmentForJob(jobNum);
                if (cancelled) return;
                await api.companionUpdateState({ equipmentItems: equipmentItems || [] });
            } catch (err) {
                console.error('Failed to load equipment for job', jobNum, err);
                if (!cancelled) api.companionUpdateState({ equipmentItems: [] });
            }
        })();
        return () => { cancelled = true; };
    }, [selectedSharePointJob, activeJobId, companionRunning]);

    // Auto-advance: when all recording has stopped with data → Review & Finalize.
    // In dual mode this waits until both Test A and Test B have stopped.
    const anyLogging = isLogging || isLoggingB;
    const prevLoggingRef = useRef(anyLogging);
    useEffect(() => {
        const wasLogging = prevLoggingRef.current;
        prevLoggingRef.current = anyLogging;
        if (wasLogging && !anyLogging && activeJob?.dataSets?.length > 0) {
            setActiveTab('report');
        }
    }, [anyLogging]);

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
        // Markers belong to this specific recording (dataSet), not the whole job.
        const { markers: importMarkers, ...restMetadata } = extraMetadata;
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
            // Append new data set to existing job
            const existingJob = allJobs[existingJobIndex];
            const existingDataSets = existingJob.dataSets || (existingJob.data ? [{
                data: existingJob.data,
                name: 'Data Set 1',
                inputTimeUnit: detectedTimeUnit,
                timestamp: existingJob.id
            }] : []);

            const newDataSet = {
                data: data,
                name: restMetadata.fileName || `Data Set ${existingDataSets.length + 1}`,
                inputTimeUnit: detectedTimeUnit,
                timestamp: Date.now(),
                ...(importMarkers && importMarkers.length ? { markers: importMarkers } : {})
            };

            const updatedJob = {
                ...existingJob,
                dataSets: [...existingDataSets, newDataSet],
                metadata: { ...existingJob.metadata, ...restMetadata }
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
                    name: restMetadata.fileName || 'Data Set 1',
                    inputTimeUnit: detectedTimeUnit,
                    timestamp: Date.now(),
                    ...(importMarkers && importMarkers.length ? { markers: importMarkers } : {})
                }],
                metadata: { jobNumber, ...restMetadata }
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

    // ── Companion Server Effects ──
    useEffect(() => {
        const checkStatus = async () => {
            try {
                const status = await getElectronAPI().companionStatus();
                setCompanionRunning(status.running);
                setCompanionClients(status.clients);
                if (status.token) setCompanionToken(status.token);
                if (status.running) setCompanionIPs(status.ips);
            } catch (e) { /* ignore */ }
        };
        checkStatus();
    }, []);

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

    useEffect(() => {
        const removeListener = getElectronAPI().onCompanionPhoto?.((photo) => {
            setCompanionPhotos(prev => [...prev, photo]);
        });
        return () => { if (typeof removeListener === 'function') removeListener(); };
    }, []);

    useEffect(() => {
        const removeListener = getElectronAPI().onCompanionLeak?.((leak) => {
            setCompanionLeaks(prev => {
                if (prev.some(l => l.id === leak.id)) return prev;
                return [...prev, leak];
            });
        });
        return () => { if (typeof removeListener === 'function') removeListener(); };
    }, []);

    useEffect(() => {
        const removeListener = getElectronAPI().onCompanionMarkerToggle?.((phase) => {
            if (!isLogging) return;
            const firstTimestamp = loggedData.length > 0 ? loggedData[0].timestamp : Date.now();
            const phaseLabel = phase === 'function' ? 'Function Test' : 'Static Hold';
            const phaseMarkers = markers.filter(m => m.phase === phase);
            const isOpen = phaseMarkers.length > 0 && phaseMarkers[phaseMarkers.length - 1].edge === 'start';
            const edge = isOpen ? 'end' : 'start';
            setMarkers(prev => [...prev, {
                phase,
                edge,
                label: `${phaseLabel} ${edge === 'start' ? 'Start' : 'End'}`,
                elapsedMs: Date.now() - firstTimestamp,
                timestamp: Date.now()
            }]);
        });
        return () => { if (typeof removeListener === 'function') removeListener(); };
    }, [isLogging, loggedData, markers]);

    // Hydrate leaks from disk on mount and whenever companion server toggles
    useEffect(() => {
        if (getElectronAPI().companionGetLeaks) {
            getElectronAPI().companionGetLeaks().then(leaks => {
                if (Array.isArray(leaks)) setCompanionLeaks(leaks);
            }).catch(() => {});
        }
    }, [companionRunning]);

    const handleDeleteLeak = async (id) => {
        if (!window.confirm('Delete this leak report?')) return;
        await getElectronAPI().companionDeleteLeak?.(id);
        setCompanionLeaks(prev => prev.filter(l => l.id !== id));
    };

    const handleClearLeaks = async () => {
        if (!window.confirm('Clear all leak reports?')) return;
        await getElectronAPI().companionClearLeaks?.();
        setCompanionLeaks([]);
    };

    const handleCompanionStart = async () => {
        const result = await getElectronAPI().companionStart();
        if (result.success) {
            setCompanionRunning(true);
            setCompanionIPs(result.ips);
            setCompanionPort(result.port);
            setCompanionToken(result.token || '');
        }
    };

    const handleCompanionStop = async () => {
        await getElectronAPI().companionStop();
        setCompanionRunning(false);
        setCompanionClients(0);
        setCompanionIPs([]);
    };

    const handleJobChange = (id) => {
        setActiveJobId(id);
        getElectronAPI().saveData({
            jobs: allJobs,
            lastActiveJobId: id
        }, 'dashboard-data.json');
    };

    // Persist the current certificate setup as a single rolling "auto-saved" draft on
    // the active job (keyed by job number). Updates in place so the drafts list isn't
    // flooded; manual "Save as Draft" snapshots are left untouched. Saves immediately
    // (not via the debounced engine) so it survives navigating back to the main menu.
    const saveCertDraft = () => {
        const job = allJobs.find(j => j.id.toString() === activeJobId?.toString());
        const certData = job?.metadata?.certData;
        if (!certData) return;
        const jobNum = job.metadata?.jobNumber || activeJobId;
        const autoDraft = {
            name: `Auto-saved — Job ${jobNum}`,
            data: { ...certData },
            timestamp: Date.now(),
            auto: true,
        };
        const existing = job.metadata?.drafts || [];
        const idx = existing.findIndex(d => d.auto);
        const newDrafts = idx >= 0
            ? existing.map((d, i) => (i === idx ? autoDraft : d))
            : [autoDraft, ...existing];
        const updatedJobs = allJobs.map(j => j.id.toString() === activeJobId?.toString()
            ? { ...j, metadata: { ...j.metadata, drafts: newDrafts } }
            : j);
        setAllJobs(updatedJobs);
        getElectronAPI().saveData({ jobs: updatedJobs, lastActiveJobId: activeJobId }, 'dashboard-data.json');
    };

    // Guard navigation away from the certificate tab: if the user has set up a cert,
    // ask whether to save it as a draft first, then run the requested navigation.
    const leaveCert = (proceed) => {
        if (activeTab === 'cert' && activeJob?.metadata?.certData) {
            setPendingLeaveCert(() => proceed);
            setShowSaveCertPrompt(true);
        } else {
            proceed();
        }
    };

    const runPendingLeaveCert = () => {
        const proceed = pendingLeaveCert;
        setPendingLeaveCert(null);
        setShowSaveCertPrompt(false);
        if (typeof proceed === 'function') proceed();
    };

    // Selecting a SharePoint job immediately makes it a persistent, autosaving
    // local job so the certificate auto-fills and edits/uploads attach to it
    // without ever prompting for a job number.
    const selectJob = (spJob) => {
        if (!spJob) return;
        setSelectedSharePointJob(spJob);

        const existing = allJobs.find(j => j.metadata?.jobNumber === spJob.QuoteNum);
        let targetId;
        if (existing) {
            targetId = existing.id;
        } else {
            const newJob = {
                id: Date.now(),
                dataSets: [],
                metadata: {
                    jobNumber: spJob.QuoteNum,
                    customer: spJob.Customer,
                    leadCompany: spJob.LeadCompany,
                    poDate: spJob.PODate,
                    poNumber: spJob.PONumber
                }
            };
            targetId = newJob.id;
            setAllJobs(prev => prev.some(j => j.metadata?.jobNumber === spJob.QuoteNum) ? prev : [newJob, ...prev]);
        }

        setActiveJobId(targetId);
        setImportContext({
            QuoteNum: spJob.QuoteNum,
            Customer: spJob.Customer,
            LeadCompany: spJob.LeadCompany,
            PODate: spJob.PODate,
            PONumber: spJob.PONumber
        });
        setActiveTab('cert');
        // Arriving at the certificate from a job selection -> offer AI generation.
        setAiPromptPending(true);
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
                        <div className="theme-toggle" title="Toggle theme">
                            <button className={`theme-toggle-option ${theme === 'light' ? 'active' : ''}`} onClick={toggleTheme}>☀️</button>
                            <button className={`theme-toggle-option ${theme === 'dark' ? 'active' : ''}`} onClick={toggleTheme}>🌙</button>
                        </div>
                        <button onClick={onOpenSettings} className="action-btn secondary circle" title="Settings">⚙️</button>
                    </div>
                </header>
            )}
            {!isCertPreview && activeJobId && (() => {
                const job = allJobs.find(j => j.id?.toString() === activeJobId?.toString());
                const jobName = selectedSharePointJob?.JobName || selectedSharePointJob?.QuoteNum || job?.metadata?.jobNumber || '';
                const customer = selectedSharePointJob?.LeadCompany || selectedSharePointJob?.Customer || job?.metadata?.leadCompany || job?.metadata?.customer || '';
                return jobName ? (
                    <div className="no-print" style={{ background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border)', padding: '5px 20px', display: 'flex', alignItems: 'center', gap: '12px', fontSize: '0.8rem' }}>
                        <span style={{ color: 'var(--yellow-accent)', fontWeight: 700 }}>{jobName}</span>
                        {customer && <span style={{ color: 'var(--text-secondary)' }}>{customer}</span>}
                    </div>
                ) : null;
            })()}
            {!isCertPreview && (isLogging || (dualMode && isLoggingB)) && (
                <div className="no-print" style={{ background: 'rgba(74,222,128,0.1)', borderBottom: '1px solid var(--green)', padding: '5px 20px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', fontSize: '0.8rem', fontWeight: 600, color: 'var(--green)' }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--green)', animation: 'pulse 1.5s infinite', display: 'inline-block' }}></span>
                    {dualMode ? (
                        <>
                            Recording
                            {isLogging ? ` — Test A: ${loggedData.length} samples` : ''}
                            {isLoggingB ? ` — Test B: ${loggedDataB.length} samples` : ''}
                        </>
                    ) : (
                        <>Recording{loggedData.length > 0 ? ` — ${loggedData.length} samples` : ''}</>
                    )}
                </div>
            )}
            <main className="app-content">
                {!isCertPreview && (
                    <div className="sidebar no-print">
                        <button className="nav-btn home-btn" onClick={() => leaveCert(onGoHome)}>🏠 Main Menu</button>

                        <div className="sidebar-section-label">Workflow</div>

                        {(() => {
                            const jobSelected = !!activeJobId;
                            const certReady = !!(activeJob?.metadata?.certData?.procedureSummary?.trim());
                            const hasData = !!(activeJob?.dataSets?.length > 0);

                            const steps = [
                                { id: 'welcome', num: 1, label: 'Select Job', unlocked: true, completed: jobSelected },
                                { id: 'cert', num: 2, label: 'Certificate Setup', unlocked: jobSelected, completed: certReady },
                                { id: 'live', num: 3, label: 'Live Recording', unlocked: certReady, completed: hasData },
                                { id: 'report', num: 4, label: 'Review & Finalize', unlocked: hasData, completed: false },
                            ];

                            return steps.map(step => {
                                const isActive = activeTab === step.id;
                                const cls = `workflow-step${isActive ? ' active' : ''}${step.completed ? ' completed' : ''}${!step.unlocked && !step.completed ? ' locked' : ''}`;
                                return (
                                    <button key={step.id} className={cls} onClick={() => {
                                        if (step.id === 'cert') setActiveTab('cert');
                                        else if (step.id === 'welcome') leaveCert(() => { setActiveTab('welcome'); setImportContext(null); });
                                        else leaveCert(() => setActiveTab(step.id));
                                    }}>
                                        <span className="step-num">{step.completed ? '✓' : step.num}</span>
                                        {step.label}
                                    </button>
                                );
                            });
                        })()}

                        <div className="sidebar-divider"></div>
                        <div className="sidebar-section-label">Tools</div>

                        <button className={`nav-btn ${activeTab === 'import' ? 'active' : ''}`} onClick={() => leaveCert(() => { if (activeJob) { triggerAppendData(activeJob); } else { setActiveTab('import'); setImportContext(null); } })}>Import CSV</button>
                        <button className={`nav-btn ${activeTab === 'companion' ? 'active' : ''}`} onClick={() => leaveCert(() => setActiveTab('companion'))}>
                            📱 Companion{companionRunning ? ` (${companionClients})` : ''}
                        </button>
                        <button className={`nav-btn ${activeTab === 'leaks' ? 'active' : ''}`} onClick={() => leaveCert(() => setActiveTab('leaks'))}>💧 Leak Logs{companionLeaks.length > 0 ? ` (${companionLeaks.length})` : ''}</button>

                        <div className="flex-grow"></div>
                        <button className={`nav-btn ${activeTab === 'settings' ? 'active' : ''}`} onClick={() => leaveCert(() => setActiveTab('settings'))}>⚙️ Settings</button>
                    </div>
                )}
                <div className="content-area" style={isCertPreview ? { padding: 0, margin: 0, overflowY: 'auto' } : {}}>
                    {activeTab === 'welcome' && (
                        <WelcomeView
                            onJobSelected={(job) => selectJob(job)}
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
                            onSelectForLive={(job) => selectJob(job)}
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
                                dualMode={dualMode}
                                setDualMode={setDualMode}
                                selectedTags={selectedTags}
                                setSelectedTags={setSelectedTags}
                                cellCount={cellCount}
                                setCellCount={setCellCount}
                                isLogging={isLogging}
                                setIsLogging={setIsLogging}
                                loggedData={loggedData}
                                setLoggedData={setLoggedData}
                                markers={markers}
                                setMarkers={setMarkers}
                                selectedTagsB={selectedTagsB}
                                setSelectedTagsB={setSelectedTagsB}
                                cellCountB={cellCountB}
                                setCellCountB={setCellCountB}
                                isLoggingB={isLoggingB}
                                setIsLoggingB={setIsLoggingB}
                                loggedDataB={loggedDataB}
                                setLoggedDataB={setLoggedDataB}
                                markersB={markersB}
                                setMarkersB={setMarkersB}
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
                                companionRunning={companionRunning}
                                companionClients={companionClients}
                                onStartCompanion={handleCompanionStart}
                                onOpenCompanion={() => setActiveTab('companion')}
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
                            promptAiOnArrival={aiPromptPending}
                            onAiPromptResolved={() => setAiPromptPending(false)}
                        />
                    )}
                    {activeTab === 'leaks' && (
                        <div style={{ maxWidth: '900px', margin: '0 auto', padding: '1.5rem' }}>
                            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '12px' }}>
                                <div>
                                    <h2 style={{ marginBottom: '0.25rem' }}>💧 Waterbag Leak Logs</h2>
                                    <p style={{ color: 'var(--text-muted)', margin: 0 }}>
                                        All leaks reported from the companion app. Reports are saved to disk and persist across sessions.
                                    </p>
                                </div>
                                {companionLeaks.length > 0 && (
                                    <button className="action-btn secondary" onClick={handleClearLeaks}>Clear All</button>
                                )}
                            </div>

                            {companionLeaks.length === 0 ? (
                                <div style={{
                                    background: 'var(--bg-card)', borderRadius: '12px', padding: '2.5rem 1.5rem',
                                    border: '1px dashed var(--border-color)', textAlign: 'center', color: 'var(--text-muted)'
                                }}>
                                    <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>💧</div>
                                    <div style={{ fontSize: '1rem', marginBottom: '0.25rem', color: 'var(--text)' }}>No leak logs yet</div>
                                    <div style={{ fontSize: '0.85rem' }}>
                                        Leaks reported from the phone companion will appear here.
                                    </div>
                                </div>
                            ) : (
                                <div style={{
                                    display: 'grid',
                                    gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                                    gap: '16px'
                                }}>
                                    {companionLeaks.slice().reverse().map((leak) => {
                                        const sev = leak.severity || 'minor';
                                        const sevColor = sev === 'severe' ? '#ef4444' : sev === 'moderate' ? '#f0b800' : '#4ade80';
                                        const sevBg = sev === 'severe' ? 'rgba(239,68,68,0.15)' : sev === 'moderate' ? 'rgba(240,184,0,0.15)' : 'rgba(74,222,128,0.15)';
                                        const when = new Date(leak.timestamp).toLocaleString();
                                        return (
                                            <div key={leak.id} style={{
                                                background: 'var(--bg-card)', borderRadius: '10px', overflow: 'hidden',
                                                border: '1px solid var(--border-color)', display: 'flex', flexDirection: 'column'
                                            }}>
                                                <img src={leak.dataUrl} alt="Leak" style={{ width: '100%', aspectRatio: '4/3', objectFit: 'cover', display: 'block' }} />
                                                <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '6px', flex: 1 }}>
                                                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '8px' }}>
                                                        <span style={{
                                                            fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase',
                                                            letterSpacing: '0.5px', padding: '2px 10px', borderRadius: '10px',
                                                            background: sevBg, color: sevColor
                                                        }}>{sev}</span>
                                                        <button
                                                            onClick={() => handleDeleteLeak(leak.id)}
                                                            style={{
                                                                background: 'none', border: 'none', color: 'var(--text-muted)',
                                                                cursor: 'pointer', fontSize: '1.2rem', padding: '0 4px', lineHeight: 1
                                                            }}
                                                            title="Delete"
                                                        >×</button>
                                                    </div>
                                                    {leak.serial && (
                                                        <div style={{ fontSize: '0.8rem', color: '#f0b800', fontWeight: 700, fontFamily: 'monospace' }}>
                                                            S/N: {leak.serial}
                                                        </div>
                                                    )}
                                                    <div style={{ fontSize: '0.9rem', color: 'var(--text)', wordBreak: 'break-word', flex: 1 }}>
                                                        {leak.description}
                                                    </div>
                                                    <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '4px' }}>
                                                        {when}
                                                    </div>
                                                    {leak.gps && (
                                                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)' }}>
                                                            📍 {leak.gps.lat.toFixed(5)}, {leak.gps.lng.toFixed(5)}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}
                    {activeTab === 'companion' && (
                        <div style={{ maxWidth: '800px', margin: '0 auto', padding: '1.5rem' }}>
                            <h2 style={{ marginBottom: '0.25rem' }}>📱 Companion App</h2>
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
                            {companionRunning && (
                                <div style={{
                                    background: 'var(--bg-card)', borderRadius: '12px', padding: '1.5rem',
                                    border: '1px solid var(--border-color)', marginBottom: '1.5rem'
                                }}>
                                    <h3 style={{ margin: '0 0 1rem 0' }}>📲 Connect a Phone</h3>
                                    {companionIPs.length > 0 ? (
                                      <>
                                    <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1rem' }}>
                                        Make sure the phone is on the <strong>same WiFi network</strong> as this computer, then <strong>scan the QR code</strong> with the phone's camera (or tap Copy and open the link):
                                    </p>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                        {companionIPs.map((ip, i) => {
                                            const shortUrl = `http://${ip.address}:${companionPort}`;
                                            const fullUrl = shortUrl + '/' + (companionToken ? `?t=${companionToken}` : '');
                                            return (
                                                <div key={i} style={{
                                                    display: 'flex', alignItems: 'center', gap: '14px',
                                                    background: 'var(--bg-main)', borderRadius: '8px', padding: '12px 16px',
                                                    border: '1px solid var(--border-color)'
                                                }}>
                                                    {companionToken && (
                                                        <div style={{ background: '#fff', padding: '6px', borderRadius: '8px', lineHeight: 0, flexShrink: 0 }}>
                                                            <QRCodeSVG value={fullUrl} size={96} />
                                                        </div>
                                                    )}
                                                    <div style={{ flex: 1, minWidth: 0 }}>
                                                        <div style={{ fontFamily: 'monospace', fontSize: '1.1rem', fontWeight: 600, color: 'var(--accent-primary)' }}>
                                                            {shortUrl}
                                                        </div>
                                                        <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginTop: '2px' }}>
                                                            {ip.name} &middot; 📷 Scan the QR to connect
                                                        </div>
                                                    </div>
                                                    <button
                                                        className="action-btn secondary"
                                                        style={{ fontSize: '0.85rem', padding: '6px 14px', flexShrink: 0 }}
                                                        onClick={() => navigator.clipboard.writeText(fullUrl)}
                                                        title="Copy the full link (includes the access token)"
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
                                      </>
                                    ) : (
                                      <div style={{
                                        marginTop: '0.5rem', padding: '14px', borderRadius: '8px',
                                        background: 'rgba(240, 184, 0, 0.08)', border: '1px solid rgba(240, 184, 0, 0.2)',
                                        color: 'var(--text-muted)', fontSize: '0.9rem', lineHeight: 1.5
                                      }}>
                                        ⏳ <strong>Waiting for a network address…</strong> The server is running, but this computer doesn't have a Wi-Fi/LAN (IPv4) address yet, so there's no link to share. Make sure it's connected to the <strong>same Wi-Fi</strong> as the phone — the QR code and link will appear here automatically once an address is available (this view refreshes every few seconds).
                                      </div>
                                    )}
                                </div>
                            )}

                            {/* Leaks Received */}
                            {companionLeaks.length > 0 && (
                                <div style={{
                                    background: 'var(--bg-card)', borderRadius: '12px', padding: '1.5rem',
                                    border: '1px solid var(--border-color)', marginBottom: '1.5rem'
                                }}>
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                                        <h3 style={{ margin: 0 }}>💧 Waterbag Leaks to Fix ({companionLeaks.length})</h3>
                                        <button className="action-btn secondary" style={{ fontSize: '0.8rem', padding: '4px 12px' }} onClick={handleClearLeaks}>Clear All</button>
                                    </div>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                        {companionLeaks.slice().reverse().map((leak) => {
                                            const sev = leak.severity || 'minor';
                                            const sevColor = sev === 'severe' ? '#ef4444' : sev === 'moderate' ? '#f0b800' : '#4ade80';
                                            const sevBg = sev === 'severe' ? 'rgba(239,68,68,0.15)' : sev === 'moderate' ? 'rgba(240,184,0,0.15)' : 'rgba(74,222,128,0.15)';
                                            const when = new Date(leak.timestamp).toLocaleString();
                                            return (
                                                <div key={leak.id} style={{
                                                    display: 'flex', gap: '12px',
                                                    background: 'var(--bg-main)', borderRadius: '8px', padding: '10px',
                                                    border: '1px solid var(--border-color)'
                                                }}>
                                                    <img src={leak.dataUrl} alt="Leak" style={{ width: '100px', height: '100px', objectFit: 'cover', borderRadius: '6px', flexShrink: 0 }} />
                                                    <div style={{ flex: 1, minWidth: 0 }}>
                                                        {leak.serial && (
                                                            <div style={{ fontSize: '0.75rem', color: '#f0b800', fontWeight: 700, marginBottom: '4px', fontFamily: 'monospace' }}>
                                                                S/N: {leak.serial}
                                                            </div>
                                                        )}
                                                        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '6px', flexWrap: 'wrap' }}>
                                                            <span style={{
                                                                fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase',
                                                                letterSpacing: '0.5px', padding: '2px 10px', borderRadius: '10px',
                                                                background: sevBg, color: sevColor
                                                            }}>{sev}</span>
                                                            <span style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>{when}</span>
                                                            {leak.gps && (
                                                                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                                                                    📍 {leak.gps.lat.toFixed(5)}, {leak.gps.lng.toFixed(5)}
                                                                </span>
                                                            )}
                                                        </div>
                                                        <div style={{ fontSize: '0.9rem', color: 'var(--text)', wordBreak: 'break-word' }}>
                                                            {leak.description}
                                                        </div>
                                                    </div>
                                                    <button
                                                        onClick={() => handleDeleteLeak(leak.id)}
                                                        style={{
                                                            background: 'none', border: 'none', color: 'var(--text-muted)',
                                                            cursor: 'pointer', fontSize: '1.2rem', padding: '4px 8px',
                                                            alignSelf: 'flex-start'
                                                        }}
                                                        title="Delete"
                                                    >×</button>
                                                </div>
                                            );
                                        })}
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
                                        <button className="action-btn secondary" style={{ fontSize: '0.8rem', padding: '4px 12px' }} onClick={() => setCompanionPhotos([])}>Clear</button>
                                    </div>
                                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: '10px' }}>
                                        {companionPhotos.map((photo, i) => (
                                            <div key={i} style={{ borderRadius: '8px', overflow: 'hidden', border: '1px solid var(--border-color)' }}>
                                                <img src={photo.dataUrl} alt={`Field photo ${i + 1}`} style={{ width: '100%', height: '120px', objectFit: 'cover', display: 'block' }} />
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
                    )}
                    {activeTab === 'settings' && <SettingsView onSettingsSaved={() => { }} />}
                </div>
            </main>

            {showSaveCertPrompt && (
                <div className="modal-overlay" onClick={() => { setPendingLeaveCert(null); setShowSaveCertPrompt(false); }}>
                    <div className="job-prompt-card" style={{ maxWidth: '460px', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                        <div style={{ fontSize: '2.2rem', marginBottom: '8px' }}>💾</div>
                        <h3 style={{ marginBottom: '6px' }}>Save certificate draft?</h3>
                        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '18px' }}>
                            Save your current certificate setup as a draft for job{' '}
                            <strong>{activeJob?.metadata?.jobNumber || activeJobId}</strong>? This updates the
                            job's auto-saved draft so you can pick up right where you left off.
                        </p>
                        <div className="form-actions" style={{ justifyContent: 'center' }}>
                            <button onClick={() => { saveCertDraft(); runPendingLeaveCert(); }} className="action-btn">💾 Save Draft</button>
                            <button onClick={runPendingLeaveCert} className="action-btn secondary ml-4">Don't Save</button>
                        </div>
                    </div>
                </div>
            )}

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
