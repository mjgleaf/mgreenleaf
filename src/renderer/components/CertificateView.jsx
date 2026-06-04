import { useState, useEffect, useMemo, useRef } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import processChartData from '../utils/processChartData';
import { getElectronAPI } from '../utils/electronAPI';
import { SignaturePad } from './CustomerView';
import StandardFinder from './StandardFinder';
import logo from '../logo.png';
import { certificateTemplates } from '../data/certificateTemplates';

const MAX_CHART_POINTS = 500;

function toRechartsData(chartData) {
    if (!chartData?.labels) return [];
    const total = chartData.labels.length;
    const step = total > MAX_CHART_POINTS ? Math.ceil(total / MAX_CHART_POINTS) : 1;
    const result = [];
    for (let i = 0; i < total; i += step) {
        const point = { time: parseFloat(chartData.labels[i]) };
        chartData.datasets.forEach(ds => {
            point[ds.label] = ds.data[i];
        });
        result.push(point);
    }
    return result;
}

const certPalette = ['#1a3a6c', '#3fb950', '#2188ff', '#f85149', '#dbab09', '#8957e5'];

function CertChart({ stats, yAxisLabel, xAxisLabel, isPrint }) {
    const rechartsData = toRechartsData(stats.chartData);
    const fontSize = isPrint ? 7 : 9;
    return (
        <ResponsiveContainer width="100%" height="100%" minWidth={0}>
            <LineChart data={rechartsData}>
                <CartesianGrid strokeDasharray="3 3" stroke={isPrint ? '#eee' : 'rgba(33,51,77,0.5)'} />
                <XAxis
                    dataKey="time"
                    label={{ value: xAxisLabel, position: 'insideBottom', offset: -5, fontSize, fontWeight: 'bold' }}
                    tick={{ fontSize }}
                    tickFormatter={v => v.toFixed(1)}
                />
                <YAxis
                    label={{ value: yAxisLabel, angle: -90, position: 'insideLeft', fontSize, fontWeight: 'bold' }}
                    tick={{ fontSize }}
                    domain={[0, 'auto']}
                />
                <Tooltip />
                {stats.chartData.datasets.length > 1 && (
                    <Legend wrapperStyle={{ fontSize: 8, fontWeight: 'bold' }} />
                )}
                {stats.chartData.datasets.map((ds, i) => (
                    <Line
                        key={ds.label}
                        type="monotone"
                        dataKey={ds.label}
                        stroke={certPalette[i % certPalette.length]}
                        dot={false}
                        strokeWidth={2}
                        isAnimationActive={false}
                    />
                ))}
            </LineChart>
        </ResponsiveContainer>
    );
}

const buildDefaultFormData = () => ({
    soldTo: '',
    facilityLocation: '',
    customerPO: '',
    buyer: '',
    vesselName: '',
    vesselClass: '',
    projectRef: '',
    testDate: new Date().toISOString().split('T')[0],
    projectMgr: '',
    certNo: '',
    instruments: [{
        instrument: '',
        capacity: '',
        serialNo: '',
        dataLink: '',
        accuracy: ''
    }],
    targetLoad: '',
    equipmentTested: '',
    equipmentManufacturer: '',
    equipmentSerial: '',
    equipmentWll: '',
    hooks: [{
        name: 'Main Hook',
        manufacturer: '',
        serial: '',
        wll: ''
    }],
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
        itemDescription: '',
        hookData: Array(10).fill(null).map(() => ({
            measuredForce: '',
            accept: 'YES'
        }))
    })),
    photos: [],
    hasAuxHook: false,
    auxHookWll: '',
    graphPageBreaks: {},
    sectionOrder: ['header', 'infoGrid', 'testTable', 'footer', 'graphs', 'photos'],
    beamLength: '',
    beamManufacturer: '',
    beamSerial: '',
    beamWll: '',
    numPickPoints: 2,
    pickPoints: Array(6).fill(null).map((_, i) => ({
        label: `Pick Point ${i + 1}`,
        position: '',
        measuredForce: '',
        accept: 'YES'
    })),
    spreaderTests: Array(10).fill(null).map(() => ({
        loadType: 'Static',
        wllPercentage: '100%',
        testDuration: '',
        localTime: null,
        accept: 'YES',
        testResults: 'PASS',
        itemDescription: '',
        numPickPoints: null,
        pickPointStart: 0,
        pickPointData: Array(6).fill(null).map(() => ({
            measuredForce: '',
            accept: 'YES'
        }))
    })),
    steelWeightTests: Array(10).fill(null).map(() => ({
        loadType: 'Static',
        equipmentTested: '',
        swl: '',
        testLoad: '',
        localTime: null,
        testDuration: '',
        description: '',
        accept: 'YES',
        testResults: 'PASS',
        useLoadCell: false,
        loadCellSerial: '',
        loadCellCapacity: '',
        loadCellReading: ''
    })),
    gangwayTests: Array(10).fill(null).map(() => ({
        loadType: 'Static',
        equipmentTested: '',
        swl: '',
        testLoad: '',
        flowMeterBefore: '',
        flowMeterAtLoad: '',
        flowMeterUnits: 'gal',
        deflectionBefore: '',
        deflectionAfter: '',
        deflectionRecovered: '',
        deflectionUnits: 'in',
        localTime: null,
        testDuration: '',
        description: '',
        accept: 'YES',
        testResults: 'PASS'
    })),
    dynamicTests: []
});

const CertificateView = ({ data, jobId, onUpdateMetadata, onPreviewModeChange, selectedJob, xUnit, displayUnit, promptAiOnArrival, onAiPromptResolved }) => {
    // data is actually the job object now due to activeJob refactor
    const job = data;
    const dataSets = job?.dataSets || [];
    const firstData = dataSets[0]?.data || [];

    // --- Multi-certificate support ---
    // Active certificate data lives in the top-level certData/certLayout/testSchema fields.
    // The certificates array stores snapshots of inactive certificates.
    const [activeCertIndex, setActiveCertIndex] = useState(job?.metadata?.activeCertIndex || 0);
    const certificates = job?.metadata?.certificates || [];

    const saveCurrentToSlot = (idx) => {
        if (!onUpdateMetadata || !jobId) return;
        const certs = [...(certificates.length > 0 ? certificates : [])];
        while (certs.length <= idx) certs.push({ name: `Certificate ${certs.length + 1}` });
        certs[idx] = {
            ...certs[idx],
            certData: job?.metadata?.certData || null,
            certLayout: job?.metadata?.certLayout || 'crane-hook',
            testSchema: job?.metadata?.testSchema || null,
        };
        onUpdateMetadata(jobId, { certificates: certs });
    };

    const addNewCertificate = () => {
        if (!onUpdateMetadata || !jobId) return;
        saveCurrentToSlot(activeCertIndex);
        const certs = [...(certificates.length > 0 ? certificates : [])];
        while (certs.length <= activeCertIndex) certs.push({ name: `Certificate ${certs.length + 1}`, certData: job?.metadata?.certData, certLayout: job?.metadata?.certLayout, testSchema: job?.metadata?.testSchema });
        const newIdx = certs.length;
        certs.push({ name: `Certificate ${newIdx + 1}`, certData: null, certLayout: 'crane-hook', testSchema: null });
        const defaults = buildDefaultFormData();
        onUpdateMetadata(jobId, { certificates: certs, activeCertIndex: newIdx, certData: defaults, certLayout: 'crane-hook', testSchema: null });
        setActiveCertIndex(newIdx);
        setFormData(defaults);
        setCertLayoutState('crane-hook');
        setTestSchema(null);
        setCustomerSignature(null);
        setAiMessages([]);
    };

    const switchCertificate = (idx) => {
        if (idx === activeCertIndex || !onUpdateMetadata || !jobId) return;
        saveCurrentToSlot(activeCertIndex);
        const certs = [...(certificates.length > 0 ? certificates : [])];
        while (certs.length <= activeCertIndex) certs.push({ name: `Certificate ${certs.length + 1}`, certData: job?.metadata?.certData, certLayout: job?.metadata?.certLayout, testSchema: job?.metadata?.testSchema });
        if (idx >= certs.length) return;
        const cert = certs[idx];
        const certData = cert.certData || buildDefaultFormData();
        const certLayout = cert.certLayout || 'crane-hook';
        const schema = cert.testSchema || null;
        onUpdateMetadata(jobId, { certificates: certs, activeCertIndex: idx, certData, certLayout, testSchema: schema });
        setActiveCertIndex(idx);
        setFormData(prev => ({ ...buildDefaultFormData(), ...certData }));
        setCertLayoutState(certLayout);
        setTestSchema(schema);
        setCustomerSignature(null);
        setAiMessages([]);
    };

    const renameCertificate = (idx, name) => {
        if (!onUpdateMetadata || !jobId) return;
        const certs = [...(certificates.length > 0 ? certificates : [{ name: 'Certificate 1' }])];
        if (idx < certs.length) {
            certs[idx] = { ...certs[idx], name };
            onUpdateMetadata(jobId, { certificates: certs });
        }
    };


    const [formData, setFormData] = useState({
        soldTo: '',
        facilityLocation: '',
        customerPO: '',
        buyer: '',
        vesselName: '',
        vesselClass: '',
        projectRef: '',
        testDate: new Date().toISOString().split('T')[0],
        projectMgr: '',
        certNo: '',
        instruments: [{
            instrument: '',
            capacity: '',
            serialNo: '',
            dataLink: '',
            accuracy: ''
        }],
        targetLoad: '',
        equipmentTested: '',
        equipmentManufacturer: '',
        equipmentSerial: '',
        equipmentWll: '',
        hooks: [{
            name: 'Main Hook',
            manufacturer: '',
            serial: '',
            wll: ''
        }],
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
            itemDescription: '',
            hookData: Array(10).fill(null).map(() => ({
                measuredForce: '',
                accept: 'YES'
            }))
        })),
        photos: [],
        hasAuxHook: false,
        auxHookWll: '',
        graphPageBreaks: {}, // { dataSetIndex: boolean }
        sectionOrder: ['header', 'infoGrid', 'testTable', 'footer', 'graphs', 'photos'],
        // Spreader Beam fields
        beamLength: '',
        beamManufacturer: '',
        beamSerial: '',
        beamWll: '',
        numPickPoints: 2,
        pickPoints: Array(6).fill(null).map((_, i) => ({
            label: `Pick Point ${i + 1}`,
            position: '',
            measuredForce: '',
            accept: 'YES'
        })),
        spreaderTests: Array(10).fill(null).map(() => ({
            loadType: 'Static',
            wllPercentage: '100%',
            testDuration: '',
            localTime: null,
            accept: 'YES',
            testResults: 'PASS',
            itemDescription: '',
            numPickPoints: null,
            pickPointStart: 0,
            pickPointData: Array(6).fill(null).map(() => ({
                measuredForce: '',
                accept: 'YES'
            }))
        })),
        // Steel Weight Test fields
        steelWeightTests: Array(10).fill(null).map(() => ({
            loadType: 'Static',
            equipmentTested: '',
            swl: '',
            testLoad: '',
            localTime: null,
            testDuration: '',
            description: '',
            accept: 'YES',
            testResults: 'PASS',
            useLoadCell: false,
            loadCellSerial: '',
            loadCellCapacity: '',
            loadCellReading: ''
        })),
        // Accommodation Ladder / Gangway (Flow Meter) fields
        gangwayTests: Array(10).fill(null).map(() => ({
            loadType: 'Static',
            equipmentTested: '',
            swl: '',
            testLoad: '',
            flowMeterBefore: '',
            flowMeterAtLoad: '',
            flowMeterUnits: 'gal',
            deflectionBefore: '',
            deflectionAfter: '',
            deflectionUnits: 'in',
            localTime: null,
            testDuration: '',
            description: '',
            accept: 'YES',
            testResults: 'PASS'
        })),
        dynamicTests: []
    });

    const [isPreview, setIsPreview] = useState(false);
    const [showAiWizard, setShowAiWizard] = useState(false);
    const [certLayout, setCertLayoutState] = useState(job?.metadata?.certLayout || 'crane-hook');
    const setCertLayout = (next) => {
        setCertLayoutState(next);
        if (onUpdateMetadata && jobId) onUpdateMetadata(jobId, { certLayout: next });
        if (next === 'gangway') {
            setFormData(prev => {
                const newFormData = {
                    ...prev,
                    instruments: [{
                        instrument: '3" Zenner Flow Meter',
                        capacity: prev.instruments?.[0]?.capacity || '3"',
                        serialNo: prev.instruments?.[0]?.serialNo || '',
                        dataLink: prev.instruments?.[0]?.dataLink || 'Analog',
                        accuracy: prev.instruments?.[0]?.accuracy || ''
                    }]
                };
                if (onUpdateMetadata && jobId) onUpdateMetadata(jobId, { certData: newFormData });
                return newFormData;
            });
        }
    };
    const [showSignaturePad, setShowSignaturePad] = useState(false);
    const [customerSignature, setCustomerSignature] = useState(null);
    const [certRegistry, setCertRegistry] = useState([]);
    const [showAiGenerator, setShowAiGenerator] = useState(false);
    const [aiDescription, setAiDescription] = useState('');
    const [aiLoading, setAiLoading] = useState(false);
    const [aiError, setAiError] = useState('');
    const [aiMessages, setAiMessages] = useState([]);
    const aiChatEndRef = useRef(null);
    const [aiLayoutOverrides, setAiLayoutOverrides] = useState(null);
    const [aiLayoutLoading, setAiLayoutLoading] = useState(false);
    // "Generate with AI?" prompt shown when arriving here from a dashboard job selection.
    const [showAiPrompt, setShowAiPrompt] = useState(false);

    // Email Certificate dialog
    const [showEmailDialog, setShowEmailDialog] = useState(false);
    const [emailTo, setEmailTo] = useState('');
    const [emailCc, setEmailCc] = useState('');
    const [emailSubject, setEmailSubject] = useState('');
    const [emailBody, setEmailBody] = useState('');
    const [emailSending, setEmailSending] = useState(false);
    const [emailStatus, setEmailStatus] = useState(null); // { type: 'success'|'error', message }

    const [testSchema, setTestSchema] = useState(job?.metadata?.testSchema || null);

    const setTestSchemaAndPersist = (schema) => {
        setTestSchema(schema);
        if (onUpdateMetadata && jobId) onUpdateMetadata(jobId, { testSchema: schema });
    };

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
        return dataSets.map(ds => {
            // Resolve the dataset's input time unit (explicit or detected from headers),
            // matching ReportView, then pass display/input/x units in the CORRECT argument
            // slots so the certificate graphs scale identically to the Reports tab. (This
            // call previously passed xUnit into the displayTimeUnit slot and omitted
            // inputTimeUnit, which mis-scaled the cert preview x-axis.)
            let inputTimeUnit = ds.inputTimeUnit;
            if (!inputTimeUnit && ds.data?.length > 0) {
                const headers = Object.keys(ds.data[0]);
                const timeHeader = headers.find(h => /elapsed|second/i.test(h)) || headers.find(h => /time|stamp/i.test(h)) || '';
                if (/ms|millisecond/i.test(timeHeader)) inputTimeUnit = 'ms';
                else if (/min/i.test(timeHeader)) inputTimeUnit = 'min';
                else if (/hour|hr/i.test(timeHeader)) inputTimeUnit = 'hrs';
                else inputTimeUnit = 'sec';
            }
            return processChartData(ds.data, serials, displayUnit, xUnit === 'hour' ? 'hrs' : 'min', inputTimeUnit || 'sec', xUnit, ds.chartMode || 'perCell');
        });
    }, [dataSets, formData.instruments, displayUnit, xUnit]);

    // chartStats (legacy single) points to the first one for auto-fill logic
    const chartStats = allChartStats[0] || null;

    useEffect(() => {
        // Cleanup: ensure preview mode is turned off when unmounting
        return () => {
            if (onPreviewModeChange) onPreviewModeChange(false);
        };
    }, []);

    // The parent flips promptAiOnArrival to true each time a job is selected from
    // the dashboard. Show the "Generate with AI?" prompt once per selection.
    useEffect(() => {
        if (promptAiOnArrival) setShowAiPrompt(true);
    }, [promptAiOnArrival]);

    const acceptAiPrompt = () => {
        setShowAiPrompt(false);
        if (onAiPromptResolved) onAiPromptResolved();
        setShowAiGenerator(true);
    };

    const dismissAiPrompt = () => {
        setShowAiPrompt(false);
        if (onAiPromptResolved) onAiPromptResolved();
    };

    const hasAutoOpenedAi = useRef(false);

    useEffect(() => {
        const load = async () => {
            // If no SharePoint job is selected, try to find one from cache by job number
            let spJob = selectedJob;
            if (!spJob && job?.metadata?.jobNumber) {
                try {
                    const cached = await getElectronAPI().getJobsCache();
                    const jobs = cached?.jobs || (Array.isArray(cached) ? cached : []);
                    spJob = jobs.find(j => j.QuoteNum === job.metadata.jobNumber) || null;
                } catch (_) { /* offline or no cache */ }
            }

            setFormData(prev => {
                let current = { ...prev };

                // Only load saved data if we have a specific job context
                if (job?.metadata?.certData) {
                    // 1. Load from job-specific metadata
                    current = { ...current, ...job.metadata.certData };
                }
                // No job selected = start with a blank form

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
                        accuracy: current.accuracy || ''
                    }];
                    // Migrate targetLoad from instrument to top-level if present
                    if (current.targetLoad) {
                        current.targetLoad = current.targetLoad;
                    }
                    delete current.instrument;
                    delete current.capacity;
                    delete current.serialNo;
                    delete current.dataLink;
                    delete current.accuracy;
                }

                // Migrate legacy single-hook data to hooks array if needed
                if (!current.hooks || current.hooks.length === 0) {
                    const mainHook = {
                        name: 'Main Hook',
                        manufacturer: current.equipmentManufacturer || '',
                        serial: current.equipmentSerial || '',
                        wll: current.equipmentWll || ''
                    };
                    if (current.hasAuxHook) {
                        current.hooks = [
                            mainHook,
                            { name: 'Aux Hook', manufacturer: '', serial: '', wll: current.auxHookWll || '' }
                        ];
                    } else {
                        current.hooks = [mainHook];
                    }
                }

                // Migrate legacy test records: move measuredForce into hookData[0]
                if (current.tests) {
                    current.tests = current.tests.map(test => {
                        if (!test.hookData) {
                            test.hookData = Array(10).fill(null).map(() => ({ measuredForce: '', accept: 'YES' }));
                            if (test.measuredForce) {
                                test.hookData[0] = { measuredForce: String(test.measuredForce), accept: test.accept || 'YES' };
                            }
                        }
                        return test;
                    });
                }

                // Auto-fill from SharePoint job (live selection or cache lookup)
                if (spJob) {
                    if (!current.projectRef) current.projectRef = spJob.QuoteNum || '';
                    if (!current.soldTo) {
                        const company = spJob.LeadCompany || spJob.Customer || '';
                        const addr = spJob.CompanyAddress || '';
                        current.soldTo = addr ? `${company}\n${addr}` : company;
                    }
                    if (!current.customerPO) current.customerPO = spJob.PONumber || '';
                    if (!current.buyer) current.buyer = spJob.Customer || spJob.LeadName || '';
                    if (!current.facilityLocation) current.facilityLocation = spJob.ShipToAddress || spJob.Location || spJob.JobLocation || spJob.ShippingAddress || '';
                }
                if (job?.metadata) {
                    if (!current.projectRef) current.projectRef = job.metadata.jobNumber || '';
                    if (!current.soldTo) current.soldTo = job.metadata.leadCompany || job.metadata.customer || '';
                    if (!current.customerPO) current.customerPO = job.metadata.poNumber || '';
                    if (!current.buyer) current.buyer = job.metadata.customer || '';
                }

                // Auto-fill test records from each dataset's peak stats
                if (dataSets.length > 0) {
                    const serials = current.instruments?.map(inst => inst.serialNo).filter(Boolean).flatMap(s => s.split(/[, \s]+/)) || [];
                    const updatedTests = [...current.tests];

                    // Duration of the marked Static Hold window (in MINUTES, to match the testDuration field).
                    // Uses the first complete static start->end marker pair recorded during live capture.
                    const staticHoldDuration = (markers) => {
                        if (!Array.isArray(markers) || markers.length === 0) return null;
                        let start = null;
                        for (const m of markers) {
                            if (m.phase !== 'static') continue;
                            if (m.edge === 'start') start = m;
                            else if (m.edge === 'end' && start) {
                                const mins = (m.elapsedMs - start.elapsedMs) / 60000;
                                return mins > 0 ? mins : null;
                            }
                        }
                        return null;
                    };

                    dataSets.forEach((ds, idx) => {
                        if (!ds.data || ds.data.length === 0 || idx >= updatedTests.length) return;
                        const stats = processChartData(ds.data, serials);
                        if (!stats) return;

                        if (updatedTests[idx].measuredForce === null) {
                            updatedTests[idx].measuredForce = stats.maxWeight.toFixed(0);
                        }
                        if (updatedTests[idx].hookData && !updatedTests[idx].hookData[0]?.measuredForce) {
                            const newHookData = [...updatedTests[idx].hookData];
                            newHookData[0] = { ...newHookData[0], measuredForce: stats.maxWeight.toFixed(0) };
                            updatedTests[idx] = { ...updatedTests[idx], hookData: newHookData };
                        }
                        if (updatedTests[idx].localTime === null) {
                            updatedTests[idx].localTime = stats.peakTime;
                        }
                        if (updatedTests[idx].testDuration === null || updatedTests[idx].testDuration === '') {
                            const holdMins = staticHoldDuration(ds.markers);
                            updatedTests[idx].testDuration = holdMins !== null ? holdMins.toFixed(0) : stats.totalTime.toFixed(0);
                        }
                    });

                    current.tests = updatedTests;
                    if (dataSets.length > parseInt(current.numTests)) {
                        current.numTests = dataSets.length;
                    }
                    if (!current.equipmentWll) {
                        const firstStats = processChartData(dataSets[0].data, serials);
                        if (firstStats) current.equipmentWll = firstStats.maxWeight.toFixed(0) + ' lbs';
                    }

                    // Auto-fill spreader beam tests: distribute datasets across pick points
                    if (current.spreaderTests) {
                        const updatedSBTests = [...current.spreaderTests];
                        const globalPP = parseInt(current.numPickPoints) || 2;
                        const activeCount = parseInt(current.numTests) || 1;
                        let dsIdx = 0;

                        for (let tIdx = 0; tIdx < activeCount && tIdx < updatedSBTests.length && dsIdx < dataSets.length; tIdx++) {
                            const testPPCount = updatedSBTests[tIdx].numPickPoints ?? globalPP;
                            const newPPData = [...updatedSBTests[tIdx].pickPointData];
                            let firstStats = null;
                            let firstMarkers = null;

                            for (let ppIdx = 0; ppIdx < testPPCount && dsIdx < dataSets.length; ppIdx++, dsIdx++) {
                                const ds = dataSets[dsIdx];
                                if (!ds.data || ds.data.length === 0) continue;
                                const stats = processChartData(ds.data, serials);
                                if (!stats) continue;

                                if (!newPPData[ppIdx]?.measuredForce) {
                                    newPPData[ppIdx] = { ...newPPData[ppIdx], measuredForce: stats.maxWeight.toFixed(0) };
                                }
                                if (!firstStats) { firstStats = stats; firstMarkers = ds.markers; }
                            }

                            updatedSBTests[tIdx] = { ...updatedSBTests[tIdx], pickPointData: newPPData };

                            if (firstStats) {
                                if (updatedSBTests[tIdx].localTime === null) {
                                    updatedSBTests[tIdx] = { ...updatedSBTests[tIdx], localTime: firstStats.peakTime };
                                }
                                if (!updatedSBTests[tIdx].testDuration) {
                                    const holdMins = staticHoldDuration(firstMarkers);
                                    updatedSBTests[tIdx] = { ...updatedSBTests[tIdx], testDuration: holdMins !== null ? holdMins.toFixed(0) : firstStats.totalTime.toFixed(0) };
                                }
                            }
                        }

                        current.spreaderTests = updatedSBTests;
                    }
                }

                return current;
            });
        };
        load();
    }, [jobId, selectedJob, dataSets.length]);

    const handleInstrumentInput = (index, name, value) => {
        const newInstruments = [...formData.instruments];
        newInstruments[index] = { ...newInstruments[index], [name]: value };
        const newFormData = { ...formData, instruments: newInstruments };
        setFormData(newFormData);
        if (onUpdateMetadata && jobId) {
            onUpdateMetadata(jobId, { certData: newFormData });
        }
    };

    const addInstrument = () => {
        const newInstruments = [...formData.instruments, {
            instrument: '', capacity: '', serialNo: '', dataLink: '', accuracy: ''
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

    const handleTestHookData = (testIndex, hookIndex, field, value) => {
        const newTests = [...formData.tests];
        const newHookData = [...(newTests[testIndex].hookData || [])];
        newHookData[hookIndex] = { ...newHookData[hookIndex], [field]: value };
        newTests[testIndex] = { ...newTests[testIndex], hookData: newHookData };
        const newFormData = { ...formData, tests: newTests };
        setFormData(newFormData);
        if (onUpdateMetadata && jobId) onUpdateMetadata(jobId, { certData: newFormData });
    };

    const handleHookInput = (index, field, value) => {
        const newHooks = [...(formData.hooks || [])];
        newHooks[index] = { ...newHooks[index], [field]: value };
        const newFormData = { ...formData, hooks: newHooks };
        setFormData(newFormData);
        if (onUpdateMetadata && jobId) {
            onUpdateMetadata(jobId, { certData: newFormData });
        }
    };

    const addHook = () => {
        const newHooks = [...(formData.hooks || []), {
            name: `Hook ${(formData.hooks || []).length + 1}`,
            manufacturer: '',
            serial: '',
            wll: ''
        }];
        const newFormData = { ...formData, hooks: newHooks };
        setFormData(newFormData);
        if (onUpdateMetadata) {
            onUpdateMetadata(jobId, { certData: newFormData });
        }
    };

    const removeHook = (index) => {
        if ((formData.hooks || []).length <= 1) return;
        const newHooks = formData.hooks.filter((_, i) => i !== index);
        const newFormData = { ...formData, hooks: newHooks };
        setFormData(newFormData);
        if (onUpdateMetadata) {
            onUpdateMetadata(jobId, { certData: newFormData });
        }
    };

    const handleInput = (e) => {
        const { name, value } = e.target;
        const newFormData = { ...formData, [name]: value };
        setFormData(newFormData);
        if (onUpdateMetadata && jobId) {
            onUpdateMetadata(jobId, { certData: newFormData });
        }
    };

    const handleTestInput = (index, name, value) => {
        const newTests = [...formData.tests];
        newTests[index] = { ...newTests[index], [name]: value };
        const newFormData = { ...formData, tests: newTests };
        setFormData(newFormData);
        if (onUpdateMetadata && jobId) {
            onUpdateMetadata(jobId, { certData: newFormData });
        }
    };

    // Spreader Beam handlers
    const handlePickPointInput = (ppIndex, field, value) => {
        const newPickPoints = [...formData.pickPoints];
        newPickPoints[ppIndex] = { ...newPickPoints[ppIndex], [field]: value };
        const newFormData = { ...formData, pickPoints: newPickPoints };
        setFormData(newFormData);
        if (onUpdateMetadata && jobId) onUpdateMetadata(jobId, { certData: newFormData });
    };

    const handleSpreaderTestInput = (testIndex, field, value) => {
        const newTests = [...formData.spreaderTests];
        newTests[testIndex] = { ...newTests[testIndex], [field]: value };
        const newFormData = { ...formData, spreaderTests: newTests };
        setFormData(newFormData);
        if (onUpdateMetadata && jobId) onUpdateMetadata(jobId, { certData: newFormData });
    };

    const handleSpreaderPickPointData = (testIndex, ppIndex, field, value) => {
        const newTests = [...formData.spreaderTests];
        const newPPData = [...newTests[testIndex].pickPointData];
        newPPData[ppIndex] = { ...newPPData[ppIndex], [field]: value };
        newTests[testIndex] = { ...newTests[testIndex], pickPointData: newPPData };
        const newFormData = { ...formData, spreaderTests: newTests };
        setFormData(newFormData);
        if (onUpdateMetadata && jobId) onUpdateMetadata(jobId, { certData: newFormData });
    };

    const buildEmptyDynamicTest = (schema) => {
        if (!schema) return { accept: 'YES' };
        const test = {};
        for (const col of (schema.columns || [])) {
            if (col.type === 'select' && col.options?.length) {
                test[col.key] = col.options[0];
            } else {
                test[col.key] = '';
            }
        }
        for (const group of (schema.groups || [])) {
            if (group.toggleKey) test[group.toggleKey] = false;
            for (const field of (group.fields || [])) {
                test[field.key] = '';
            }
        }
        return test;
    };

    const buildEmptyTest = (layout) => {
        if (layout === 'dynamic') {
            return buildEmptyDynamicTest(testSchema);
        }
        if (layout === 'spreader-beam') {
            return {
                loadType: 'Static',
                wllPercentage: '100%',
                testDuration: '',
                localTime: null,
                accept: 'YES',
                testResults: 'PASS',
                itemDescription: '',
                numPickPoints: null,
                pickPointStart: 0,
                pickPointData: Array(6).fill(null).map(() => ({ measuredForce: '', accept: 'YES' }))
            };
        }
        if (layout === 'steel-weight') {
            return {
                loadType: 'Static',
                equipmentTested: '',
                swl: '',
                testLoad: '',
                localTime: null,
                testDuration: '',
                description: '',
                accept: 'YES',
                testResults: 'PASS',
                useLoadCell: false,
                loadCellSerial: '',
                loadCellCapacity: '',
                loadCellReading: ''
            };
        }
        if (layout === 'gangway') {
            return {
                loadType: 'Static',
                equipmentTested: '',
                swl: '',
                testLoad: '',
                flowMeterBefore: '',
                flowMeterAtLoad: '',
                flowMeterUnits: 'gal',
                deflectionBefore: '',
                deflectionAfter: '',
                deflectionRecovered: '',
                deflectionUnits: 'in',
                localTime: null,
                testDuration: '',
                description: '',
                accept: 'YES',
                testResults: 'PASS'
            };
        }
        return {
            loadType: 'Static',
            wllPercentage: '100%',
            measuredForce: null,
            localTime: null,
            testDuration: '',
            accept: 'YES',
            testResults: 'PASS',
            hookTested: 'Main Hook',
            itemDescription: '',
            hookData: Array(10).fill(null).map(() => ({ measuredForce: '', accept: 'YES' }))
        };
    };

    const testFieldFor = (layout) => (
        layout === 'spreader-beam' ? 'spreaderTests'
        : layout === 'steel-weight' ? 'steelWeightTests'
        : layout === 'gangway' ? 'gangwayTests'
        : layout === 'dynamic' ? 'dynamicTests'
        : 'tests'
    );

    const addTestRecord = () => {
        const field = testFieldFor(certLayout);
        const existing = [...(formData[field] || [])];
        existing.push(buildEmptyTest(certLayout));
        const newCount = Math.min(parseInt(formData.numTests) + 1, existing.length);
        const newFormData = { ...formData, [field]: existing, numTests: newCount };
        setFormData(newFormData);
        if (onUpdateMetadata && jobId) onUpdateMetadata(jobId, { certData: newFormData });
    };

    const removeTestRecord = (index) => {
        const field = testFieldFor(certLayout);
        const existing = [...(formData[field] || [])];
        if (existing.length <= 1) return;
        existing.splice(index, 1);
        const newCount = Math.max(1, parseInt(formData.numTests) - 1);
        const newFormData = { ...formData, [field]: existing, numTests: newCount };
        setFormData(newFormData);
        if (onUpdateMetadata && jobId) onUpdateMetadata(jobId, { certData: newFormData });
    };

    const handleSteelWeightTestInput = (testIndex, field, value) => {
        const newTests = [...(formData.steelWeightTests || [])];
        newTests[testIndex] = { ...newTests[testIndex], [field]: value };
        const newFormData = { ...formData, steelWeightTests: newTests };
        setFormData(newFormData);
        if (onUpdateMetadata && jobId) onUpdateMetadata(jobId, { certData: newFormData });
    };

    const handleGangwayTestInput = (testIndex, field, value) => {
        const newTests = [...(formData.gangwayTests || [])];
        newTests[testIndex] = { ...newTests[testIndex], [field]: value };
        const newFormData = { ...formData, gangwayTests: newTests };
        setFormData(newFormData);
        if (onUpdateMetadata && jobId) onUpdateMetadata(jobId, { certData: newFormData });
    };

    const handleDynamicTestInput = (testIndex, field, value) => {
        const newTests = [...(formData.dynamicTests || [])];
        newTests[testIndex] = { ...newTests[testIndex], [field]: value };
        const newFormData = { ...formData, dynamicTests: newTests };
        setFormData(newFormData);
        if (onUpdateMetadata && jobId) onUpdateMetadata(jobId, { certData: newFormData });
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

    const handleResetForm = () => {
        if (!window.confirm('Reset the certificate editor to defaults?\n\nThis will clear all customer info, instruments, hooks, tests, photos, and signatures. Saved drafts are preserved.')) return;
        const defaults = buildDefaultFormData();
        setCertLayout('crane-hook');
        setTestSchemaAndPersist(null);
        setCustomerSignature(null);
        setFormData(defaults);
        if (onUpdateMetadata && jobId) {
            onUpdateMetadata(jobId, { certData: defaults });
        }
    };

    const handleLoadTemplate = (templateId) => {
        if (!templateId) return;
        const template = certificateTemplates.find(t => t.id === templateId);
        if (!template) return;
        if (!window.confirm(`Load template "${template.name}"?\n\nThis will replace the current customer info, instruments, procedure, and tests. Photos and drafts are preserved.`)) return;

        if (template.certLayout) setCertLayout(template.certLayout);
        if (template.testSchema) setTestSchemaAndPersist(template.testSchema);

        setFormData(prev => {
            const merged = {
                ...prev,
                ...template.formData,
                photos: prev.photos || [],
                graphPageBreaks: prev.graphPageBreaks || {},
                sectionOrder: prev.sectionOrder
            };
            if (onUpdateMetadata && jobId) {
                onUpdateMetadata(jobId, { certData: merged });
            }
            return merged;
        });
    };

    const handleAiQuickGenerate = () => {
        if (!aiDescription.trim()) return;
        setAiDescription(prev => prev.trim() + '\n\n[QUICK GENERATE — skip questions, generate the certificate immediately with best guesses for any missing details]');
        setTimeout(() => handleAiGenerate(), 0);
    };

    const handleAiGenerate = async () => {
        if (!aiDescription.trim()) return;
        setAiLoading(true);
        setAiError('');

        const userMsg = aiDescription.trim();
        const isFollowUp = aiMessages.length > 0;
        const newMessages = [...aiMessages, { role: 'user', content: userMsg }];
        setAiMessages(newMessages);
        setAiDescription('');

        try {
            const result = await getElectronAPI().generateCertTemplate(
                userMsg,
                isFollowUp ? newMessages : null,
                isFollowUp ? { certLayout, formData, testSchema } : null
            );
            if (result.ready === false) {
                setAiMessages(prev => [...prev, { role: 'assistant', content: result.message }]);
            } else {
                if (result.certLayout) setCertLayout(result.certLayout);
                if (result.testSchema) setTestSchemaAndPersist(result.testSchema);
                setFormData(prev => {
                    const merged = { ...prev };
                    if (result.formData) {
                        for (const [key, val] of Object.entries(result.formData)) {
                            if (val === undefined || val === null) continue;
                            if (typeof val === 'string' && val.trim() === '') continue;
                            if (Array.isArray(val) && val.length === 0) continue;
                            merged[key] = val;
                        }
                    }
                    merged.photos = prev.photos || [];
                    merged.graphPageBreaks = prev.graphPageBreaks || {};
                    merged.sectionOrder = prev.sectionOrder;
                    if (onUpdateMetadata && jobId) {
                        onUpdateMetadata(jobId, { certData: merged });
                    }
                    return merged;
                });
                setAiMessages(prev => [...prev, { role: 'assistant', content: result.summary || 'Certificate generated.' }]);
            }
        } catch (err) {
            setAiError(err.message || 'Failed to generate template');
            setAiMessages(prev => prev.slice(0, -1));
        } finally {
            setAiLoading(false);
            setTimeout(() => aiChatEndRef.current?.scrollIntoView({ behavior: 'smooth' }), 100);
        }
    };

    const handleAiLayout = async () => {
        setAiLayoutLoading(true);
        try {
            const metrics = {
                chartCount: allChartStats.length,
                photoCount: (formData.photos || []).length,
                chartDataPoints: allChartStats.map(s => s?.chartData?.labels?.length || 0),
                chartNames: dataSets.map(ds => ds?.name || ''),
                hasPhotos: (formData.photos || []).length > 0,
                numTests: parseInt(formData.numTests) || 0,
                certLayout
            };
            const result = await getElectronAPI().optimizeCertLayout(metrics);
            setAiLayoutOverrides(result);
        } catch (err) {
            alert('AI Layout Error: ' + (err.message || 'Failed'));
        } finally {
            setAiLayoutLoading(false);
        }
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

    // Certificate file name: "Certificate_<job number>" for the saved PDF and the
    // emailed attachment. Falls back to the cert number, then a plain "Certificate".
    const certIdentifier = job?.metadata?.jobNumber || formData.certNo;
    const certFileBase = certIdentifier ? `Certificate_${certIdentifier}` : 'Certificate';

    const finalizePDF = async () => {
        await getElectronAPI().savePDF(certFileBase);
        // Register certificate in registry
        if (formData.certNo && getElectronAPI().certRegister) {
            await getElectronAPI().certRegister({
                certNo: formData.certNo,
                jobName: selectedJob?.JobName || '',
                customer: formData.soldTo,
                testDate: formData.testDate,
                template: certLayout,
                result: formData.testResults
            });
        }
    };

    const showPreview = async () => {
        if (onUpdateMetadata) {
            onUpdateMetadata(jobId, { certData: formData });
        }
        if (allChartStats.length > 0 || (formData.photos && formData.photos.length > 0)) {
            try {
                const metrics = {
                    chartCount: allChartStats.length,
                    photoCount: (formData.photos || []).length,
                    chartDataPoints: allChartStats.map(s => s?.chartData?.labels?.length || 0),
                    chartNames: dataSets.map(ds => ds?.name || ''),
                    hasPhotos: (formData.photos || []).length > 0,
                    numTests: parseInt(formData.numTests) || 0,
                    certLayout
                };
                const result = await getElectronAPI().optimizeCertLayout(metrics);
                setAiLayoutOverrides(result);
            } catch (_) {}
        }
        setIsPreview(true);
        if (onPreviewModeChange) onPreviewModeChange(true);
    };

    // Pull the customer's contact email from the SharePoint job. Prefer the mapped
    // ContactEmail field; fall back to scanning every field for an email-looking value
    // so older cached jobs (saved before the mapping existed) still resolve.
    const resolveContactEmail = (spJob) => {
        if (!spJob) return '';
        if (spJob.ContactEmail && String(spJob.ContactEmail).trim()) return String(spJob.ContactEmail).trim();
        const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        for (const v of Object.values(spJob)) {
            const candidate = (v && typeof v === 'object' && v.Value) ? v.Value : v;
            if (typeof candidate === 'string' && emailRe.test(candidate.trim())) return candidate.trim();
        }
        return '';
    };

    const openEmailDialog = async () => {
        // Persist the latest edits so the rendered PDF matches what's on screen.
        if (onUpdateMetadata && jobId) onUpdateMetadata(jobId, { certData: formData });

        let spJob = selectedJob;
        if ((!spJob || !resolveContactEmail(spJob)) && job?.metadata?.jobNumber) {
            try {
                const cached = await getElectronAPI().getJobsCache();
                const jobs = cached?.jobs || (Array.isArray(cached) ? cached : []);
                const found = jobs.find(j => j.QuoteNum === job.metadata.jobNumber);
                if (found) spJob = found;
            } catch (_) { /* offline or no cache */ }
        }

        const to = resolveContactEmail(spJob);
        const contactName = (spJob?.ContactName && String(spJob.ContactName).trim())
            || formData.buyer || formData.soldTo || spJob?.Customer || 'Customer';
        const certNo = formData.certNo ? formData.certNo.trim() : '';

        setEmailTo(to);
        setEmailCc('sales@hydrowates.com');
        const subjectLabel = certNo ? `Load Test Certificate ${certNo}` : 'Load Test Certificate';
        setEmailSubject(`${subjectLabel}${formData.projectRef ? ` — ${formData.projectRef}` : ''}`);
        const bodyCertPhrase = certNo
            ? `Please find attached load test certificate ${certNo} for your records.`
            : `Please find attached your load test certificate for your records.`;
        setEmailBody(
            `Hello ${contactName},\n\n` +
            `${bodyCertPhrase}\n\n` +
            `Kind regards,\nHydro-Wates`
        );
        setEmailStatus(to ? null : { type: 'error', message: 'No contact email was found on the Leads List for this job — please enter one.' });
        setShowEmailDialog(true);
    };

    const handleSendEmail = async () => {
        if (!emailTo || !emailTo.trim()) {
            setEmailStatus({ type: 'error', message: 'Please enter a recipient email address.' });
            return;
        }
        setEmailSending(true);
        setEmailStatus(null);
        try {
            const result = await getElectronAPI().sendCertificateEmail({
                to: emailTo,
                cc: emailCc,
                subject: emailSubject,
                body: emailBody,
                fileName: certFileBase
            });
            if (result?.success) {
                setEmailStatus({ type: 'success', message: 'Certificate emailed successfully.' });
                if (formData.certNo && getElectronAPI().certRegister) {
                    try {
                        await getElectronAPI().certRegister({
                            certNo: formData.certNo,
                            jobName: selectedJob?.JobName || '',
                            customer: formData.soldTo,
                            testDate: formData.testDate,
                            template: certLayout,
                            result: formData.testResults
                        });
                    } catch (_) { /* registry is best-effort */ }
                }
                setTimeout(() => setShowEmailDialog(false), 1300);
            } else {
                setEmailStatus({ type: 'error', message: result?.error || 'Failed to send the email.' });
            }
        } catch (err) {
            setEmailStatus({ type: 'error', message: err.message || 'Failed to send the email.' });
        } finally {
            setEmailSending(false);
        }
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
                        <button onClick={() => setShowSignaturePad(true)} className="action-btn secondary">
                            ✍️ {customerSignature ? 'Re-sign' : 'Customer Signature'}
                        </button>
                        <button onClick={finalizePDF} className="action-btn" style={{ background: '#1a3a6c' }}>
                            💾 Finalize & Save PDF
                        </button>
                        <button onClick={openEmailDialog} className="action-btn" style={{ background: '#0e7c4a' }}>
                            ✉️ Email Certificate
                        </button>
                    </div>
                </div>

                {/* Signature Pad Modal */}
                {showSignaturePad && (
                    <SignaturePad
                        onSave={(dataUrl) => {
                            setCustomerSignature(dataUrl);
                            setShowSignaturePad(false);
                        }}
                        onClose={() => setShowSignaturePad(false)}
                    />
                )}

                {/* Email Certificate Modal (no-print so it is excluded from the rendered PDF) */}
                {showEmailDialog && (
                    <div className="no-print" style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <div style={{ background: '#fff', borderRadius: '8px', width: '560px', maxWidth: '92vw', maxHeight: '90vh', overflowY: 'auto', boxShadow: '0 10px 40px rgba(0,0,0,0.3)' }}>
                            <div style={{ background: '#0e7c4a', color: '#fff', padding: '14px 20px', borderRadius: '8px 8px 0 0', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                <strong style={{ fontSize: '16px' }}>✉️ Email Certificate</strong>
                                <button onClick={() => setShowEmailDialog(false)} disabled={emailSending} style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: '20px', cursor: 'pointer', lineHeight: 1 }}>×</button>
                            </div>
                            <div style={{ padding: '20px' }}>
                                <div className="form-group" style={{ marginBottom: '12px' }}>
                                    <label style={{ fontWeight: 600 }}>To</label>
                                    <input type="email" value={emailTo} onChange={(e) => setEmailTo(e.target.value)} placeholder="customer@example.com" style={{ width: '100%' }} />
                                </div>
                                <div className="form-group" style={{ marginBottom: '12px' }}>
                                    <label style={{ fontWeight: 600 }}>Cc <span style={{ fontWeight: 400, color: '#888' }}>(optional)</span></label>
                                    <input type="text" value={emailCc} onChange={(e) => setEmailCc(e.target.value)} placeholder="separate multiple with commas" style={{ width: '100%' }} />
                                </div>
                                <div className="form-group" style={{ marginBottom: '12px' }}>
                                    <label style={{ fontWeight: 600 }}>Subject</label>
                                    <input type="text" value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} style={{ width: '100%' }} />
                                </div>
                                <div className="form-group" style={{ marginBottom: '12px' }}>
                                    <label style={{ fontWeight: 600 }}>Message</label>
                                    <textarea value={emailBody} onChange={(e) => setEmailBody(e.target.value)} rows={7} style={{ width: '100%', resize: 'vertical', fontFamily: 'inherit' }} />
                                </div>
                                <div style={{ fontSize: '13px', color: '#555', background: '#f1f5f9', borderRadius: '6px', padding: '8px 12px', marginBottom: '14px' }}>
                                    📎 The current certificate preview will be attached as <strong>{certFileBase}.pdf</strong> and sent from your signed-in Microsoft account.
                                </div>
                                {emailStatus && (
                                    <div style={{ fontSize: '13px', padding: '8px 12px', borderRadius: '6px', marginBottom: '14px', background: emailStatus.type === 'success' ? '#dcfce7' : '#fee2e2', color: emailStatus.type === 'success' ? '#166534' : '#991b1b' }}>
                                        {emailStatus.type === 'success' ? '✓ ' : '⚠ '}{emailStatus.message}
                                    </div>
                                )}
                                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '10px' }}>
                                    <button onClick={() => setShowEmailDialog(false)} disabled={emailSending} className="action-btn secondary">Cancel</button>
                                    <button onClick={handleSendEmail} disabled={emailSending} className="action-btn" style={{ background: '#0e7c4a' }}>
                                        {emailSending ? 'Sending…' : '✉️ Send Email'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}
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
                                            <div className="cert-row-6" style={{ flexDirection: 'column', border: 'none', borderTop: '1.5px solid #000', marginTop: '8px' }}>
                                                <div className="cert-row-5" style={{ borderBottom: '1px solid #000', backgroundColor: '#f9f9f9' }}>
                                                    <div className="cert-box"><div className="label-top">Instrument</div></div>
                                                    <div className="cert-box"><div className="label-top">Capacity</div></div>
                                                    <div className="cert-box"><div className="label-top">Serial No.</div></div>
                                                    <div className="cert-box"><div className="label-top">Data Link</div></div>
                                                    <div className="cert-box"><div className="label-top">Accuracy</div></div>
                                                </div>
                                                {formData.instruments?.map((inst, i) => (
                                                    <div key={i} className="cert-row-5" style={{ borderBottom: i < formData.instruments.length - 1 ? '1px solid #000' : 'none' }}>
                                                        <div className="cert-box"><div className="content-center">{inst.instrument}</div></div>
                                                        <div className="cert-box"><div className="content-center">{inst.capacity}</div></div>
                                                        <div className="cert-box"><div className="content-center">{inst.serialNo}</div></div>
                                                        <div className="cert-box"><div className="content-center">{inst.dataLink}</div></div>
                                                        <div className="cert-box"><div className="content-center">{inst.accuracy}</div></div>
                                                    </div>
                                                ))}
                                            </div>
                                            {(formData.referenceStandards?.trim() || formData.procedureSummary?.trim()) && (
                                                <div style={{ gridColumn: '1 / -1', borderTop: '1.5px solid #000', marginTop: '6px', paddingTop: '4px' }}>
                                                    {formData.referenceStandards?.trim() && (
                                                        <div style={{ fontSize: '0.75rem', marginBottom: '4px' }}>
                                                            <strong>Reference Standards:</strong> {formData.referenceStandards}
                                                        </div>
                                                    )}
                                                    {formData.procedureSummary?.trim() && (
                                                        <div style={{ fontSize: '0.75rem' }}>
                                                            <strong>Procedure Summary:</strong>
                                                            <div style={{ fontSize: '0.62rem', fontStyle: 'italic', lineHeight: '1.2', marginTop: '2px' }}>
                                                                {formData.procedureSummary}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    );
                                    break;
                                case 'testTable':
                                    if (certLayout === 'steel-weight') {
                                        const swRows = (formData.steelWeightTests || []).slice(0, parseInt(formData.numTests));
                                        const anyLoadCell = swRows.some(t => t.useLoadCell);
                                        const anyTime = swRows.some(t => t.localTime && String(t.localTime).trim());
                                        const colSpan = 7 + (anyLoadCell ? 1 : 0) + (anyTime ? 1 : 0);
                                        content = (
                                            <table className="cert-table">
                                                <thead>
                                                    <tr>
                                                        <th style={{ width: '32px' }}>Item</th>
                                                        <th>Equipment / Description</th>
                                                        <th style={{ width: '52px' }}>Type</th>
                                                        <th style={{ width: '78px' }}>SWL</th>
                                                        <th style={{ width: '78px' }}>Test Load</th>
                                                        {anyLoadCell && <th style={{ width: '82px', fontSize: '0.65rem' }}>Load Cell Reading</th>}
                                                        {anyTime && <th style={{ width: '55px' }}>Time</th>}
                                                        <th style={{ width: '60px' }}>Duration</th>
                                                        <th style={{ width: '42px' }}>Accept</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    <tr>
                                                        <td colSpan={colSpan} className="text-left" style={{ paddingBottom: '8px' }}>
                                                            <div style={{ marginBottom: '4px', fontSize: '0.75rem' }}>
                                                                <strong style={{ color: '#555' }}>Test Type:</strong> Steel Weight Load Test
                                                            </div>
                                                        </td>
                                                    </tr>
                                                    {swRows.map((test, index) => (
                                                            <tr key={index}>
                                                                <td style={{ verticalAlign: 'top', paddingTop: '8px' }}>{index + 1}</td>
                                                                <td className="text-left" style={{ paddingTop: '8px', paddingBottom: '8px' }}>
                                                                    <div className="font-bold" style={{ fontSize: '0.82rem', color: '#1a3a6c', borderBottom: '1px solid #1a3a6c', paddingBottom: '1px', marginBottom: '4px', lineHeight: '1.15' }}>
                                                                        {test.equipmentTested || 'Equipment under test'}
                                                                    </div>
                                                                    {test.description && (
                                                                        <div style={{ fontSize: '0.7rem', marginTop: '2px', fontStyle: 'italic', lineHeight: '1.25' }}>
                                                                            {test.description}
                                                                        </div>
                                                                    )}
                                                                    {test.useLoadCell && (test.loadCellSerial || test.loadCellCapacity) && (
                                                                        <div style={{ fontSize: '0.65rem', marginTop: '2px', color: '#555' }}>
                                                                            <strong>Load Cell:</strong>
                                                                            {test.loadCellSerial ? ` S/N ${test.loadCellSerial}` : ''}
                                                                            {test.loadCellCapacity ? ` | Cap. ${test.loadCellCapacity}` : ''}
                                                                        </div>
                                                                    )}
                                                                </td>
                                                                <td style={{ verticalAlign: 'middle', paddingTop: '8px', fontSize: '0.78rem' }}>{test.loadType}</td>
                                                                <td style={{ verticalAlign: 'middle', paddingTop: '8px', fontSize: '0.8rem' }}>{test.swl || '--'}</td>
                                                                <td className="force-val" style={{ verticalAlign: 'middle', paddingTop: '8px', fontSize: '0.82rem' }}>{test.testLoad || '--'}</td>
                                                                {anyLoadCell && (
                                                                    <td className="force-val" style={{ verticalAlign: 'middle', paddingTop: '8px', fontSize: '0.82rem' }}>
                                                                        {test.useLoadCell && test.loadCellReading ? test.loadCellReading : '--'}
                                                                    </td>
                                                                )}
                                                                {anyTime && (
                                                                    <td style={{ verticalAlign: 'middle', paddingTop: '8px', fontSize: '0.78rem' }}>{test.localTime}</td>
                                                                )}
                                                                <td style={{ verticalAlign: 'middle', paddingTop: '8px', fontSize: '0.78rem' }}>{test.testDuration}</td>
                                                                <td className="accept-val" style={{ color: test.accept === 'YES' ? '#006600' : '#cc0000', verticalAlign: 'middle', paddingTop: '8px' }}>{test.accept}</td>
                                                            </tr>
                                                        ))}
                                                </tbody>
                                            </table>
                                        );
                                    } else if (certLayout === 'gangway') {
                                        const gwRows = (formData.gangwayTests || []).slice(0, parseInt(formData.numTests));
                                        const anyTime = gwRows.some(t => t.localTime && String(t.localTime).trim());
                                        const anyDeflection = gwRows.some(t =>
                                            (t.deflectionBefore !== '' && t.deflectionBefore != null) ||
                                            (t.deflectionAfter !== '' && t.deflectionAfter != null)
                                        );
                                        const anyPermSet = gwRows.some(t =>
                                            t.deflectionRecovered !== '' && t.deflectionRecovered != null
                                        );
                                        const colSpan = 9 + (anyTime ? 1 : 0) + (anyDeflection ? 1 : 0) + (anyPermSet ? 1 : 0);
                                        content = (
                                            <table className="cert-table">
                                                <thead>
                                                    <tr>
                                                        <th style={{ width: '32px' }}>Item</th>
                                                        <th>Equipment / Description</th>
                                                        <th style={{ width: '52px' }}>Type</th>
                                                        <th style={{ width: '78px' }}>SWL</th>
                                                        <th style={{ width: '78px' }}>Test Load</th>
                                                        <th style={{ width: '70px', fontSize: '0.65rem' }}>FM Before</th>
                                                        <th style={{ width: '70px', fontSize: '0.65rem' }}>FM @ Load</th>
                                                        <th style={{ width: '60px', fontSize: '0.65rem' }}>Δ Flow</th>
                                                        {anyDeflection && <th style={{ width: '70px', fontSize: '0.65rem' }}>Deflection</th>}
                                                        {anyPermSet && <th style={{ width: '70px', fontSize: '0.65rem' }}>Perm. Set</th>}
                                                        {anyTime && <th style={{ width: '55px' }}>Time</th>}
                                                        <th style={{ width: '60px' }}>Duration</th>
                                                        <th style={{ width: '42px' }}>Accept</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    <tr>
                                                        <td colSpan={colSpan} className="text-left" style={{ paddingBottom: '8px' }}>
                                                            <div style={{ marginBottom: '4px', fontSize: '0.75rem' }}>
                                                                <strong style={{ color: '#555' }}>Test Type:</strong> Accommodation Ladder / Gangway Load Test (Flow Meter Method)
                                                            </div>
                                                            {(formData.vesselName || formData.vesselClass) && (
                                                                <div style={{ display: 'flex', flexWrap: 'wrap', columnGap: '15px', rowGap: '2px', marginBottom: '4px', fontSize: '0.75rem' }}>
                                                                    {formData.vesselName && <div><strong style={{ color: '#555' }}>Vessel Name:</strong> {formData.vesselName}</div>}
                                                                    {formData.vesselClass && <div><strong style={{ color: '#555' }}>Vessel Class:</strong> {formData.vesselClass}</div>}
                                                                </div>
                                                            )}
                                                        </td>
                                                    </tr>
                                                    {gwRows.map((test, index) => {
                                                        const before = parseFloat(test.flowMeterBefore);
                                                        const atLoad = parseFloat(test.flowMeterAtLoad);
                                                        const delta = (!isNaN(before) && !isNaN(atLoad)) ? (atLoad - before) : null;
                                                        const units = test.flowMeterUnits || '';
                                                        const dBefore = parseFloat(test.deflectionBefore);
                                                        const dAfter = parseFloat(test.deflectionAfter);
                                                        const dRecovered = parseFloat(test.deflectionRecovered);
                                                        const deflectionDelta = (!isNaN(dBefore) && !isNaN(dAfter)) ? (dAfter - dBefore) : null;
                                                        const permSet = (!isNaN(dBefore) && !isNaN(dRecovered)) ? (dRecovered - dBefore) : null;
                                                        const deflUnits = test.deflectionUnits || '';
                                                        return (
                                                            <tr key={index}>
                                                                <td style={{ verticalAlign: 'top', paddingTop: '8px' }}>{index + 1}</td>
                                                                <td className="text-left" style={{ paddingTop: '8px', paddingBottom: '8px' }}>
                                                                    <div className="font-bold" style={{ fontSize: '0.82rem', color: '#1a3a6c', borderBottom: '1px solid #1a3a6c', paddingBottom: '1px', marginBottom: '4px', lineHeight: '1.15' }}>
                                                                        {test.equipmentTested || 'Equipment under test'}
                                                                    </div>
                                                                    {test.description && (
                                                                        <div style={{ fontSize: '0.7rem', marginTop: '2px', fontStyle: 'italic', lineHeight: '1.25' }}>
                                                                            {test.description}
                                                                        </div>
                                                                    )}
                                                                </td>
                                                                <td style={{ verticalAlign: 'middle', paddingTop: '8px', fontSize: '0.78rem' }}>{test.loadType}</td>
                                                                <td style={{ verticalAlign: 'middle', paddingTop: '8px', fontSize: '0.8rem' }}>{test.swl || '--'}</td>
                                                                <td className="force-val" style={{ verticalAlign: 'middle', paddingTop: '8px', fontSize: '0.82rem' }}>{test.testLoad || '--'}</td>
                                                                <td style={{ verticalAlign: 'middle', paddingTop: '8px', fontSize: '0.78rem' }}>
                                                                    {test.flowMeterBefore !== '' && test.flowMeterBefore != null ? `${test.flowMeterBefore} ${units}` : '--'}
                                                                </td>
                                                                <td style={{ verticalAlign: 'middle', paddingTop: '8px', fontSize: '0.78rem' }}>
                                                                    {test.flowMeterAtLoad !== '' && test.flowMeterAtLoad != null ? `${test.flowMeterAtLoad} ${units}` : '--'}
                                                                </td>
                                                                <td className="force-val" style={{ verticalAlign: 'middle', paddingTop: '8px', fontSize: '0.78rem' }}>
                                                                    {delta !== null ? `${delta.toFixed(2)} ${units}` : '--'}
                                                                </td>
                                                                {anyDeflection && (
                                                                    <td className="force-val" style={{ verticalAlign: 'middle', paddingTop: '8px', fontSize: '0.78rem' }}>
                                                                        {deflectionDelta !== null ? `${deflectionDelta.toFixed(3)} ${deflUnits}` : '--'}
                                                                    </td>
                                                                )}
                                                                {anyPermSet && (
                                                                    <td className="force-val" style={{ verticalAlign: 'middle', paddingTop: '8px', fontSize: '0.78rem', color: permSet !== null && Math.abs(permSet) > 0.001 ? '#cc0000' : 'inherit' }}>
                                                                        {permSet !== null ? `${permSet.toFixed(3)} ${deflUnits}` : '--'}
                                                                    </td>
                                                                )}
                                                                {anyTime && (
                                                                    <td style={{ verticalAlign: 'middle', paddingTop: '8px', fontSize: '0.78rem' }}>{test.localTime}</td>
                                                                )}
                                                                <td style={{ verticalAlign: 'middle', paddingTop: '8px', fontSize: '0.78rem' }}>{test.testDuration}</td>
                                                                <td className="accept-val" style={{ color: test.accept === 'YES' ? '#006600' : '#cc0000', verticalAlign: 'middle', paddingTop: '8px' }}>{test.accept}</td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        );
                                    } else if (certLayout === 'spreader-beam') {
                                        const globalPP = parseInt(formData.numPickPoints) || 2;
                                        const activeTests = formData.spreaderTests.slice(0, parseInt(formData.numTests));
                                        const numPP = Math.max(globalPP, ...activeTests.map(t => (t.pickPointStart || 0) + (t.numPickPoints ?? globalPP)));
                                        const ppColWidth = numPP >= 5 ? '58px' : numPP >= 3 ? '70px' : '85px';
                                        const ppFontSize = numPP >= 5 ? '0.58rem' : '0.65rem';
                                        const valFontSize = numPP >= 5 ? '0.75rem' : '0.85rem';
                                        content = (
                                            <table className="cert-table" style={{ tableLayout: 'fixed', width: '100%' }}>
                                                <thead>
                                                    <tr>
                                                        <th style={{ width: '28px' }}>Item</th>
                                                        <th>Description</th>
                                                        <th style={{ width: '45px', fontSize: '0.6rem' }}>Time</th>
                                                        <th style={{ width: '50px', fontSize: '0.6rem' }}>Dur.</th>
                                                        {formData.pickPoints.slice(0, numPP).map((pp, i) => (
                                                            <th key={i} style={{ width: ppColWidth, fontSize: ppFontSize }}>{pp.label || `PP ${i+1}`}</th>
                                                        ))}
                                                        <th style={{ width: numPP >= 5 ? '65px' : '80px', fontSize: ppFontSize }}>Total</th>
                                                        <th style={{ width: '38px', fontSize: '0.6rem' }}>Accept</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    <tr>
                                                        <td colSpan={5 + numPP} className="text-left" style={{ paddingBottom: '4px', paddingTop: '4px' }}>
                                                            <div style={{ display: 'flex', flexWrap: 'wrap', columnGap: '12px', rowGap: '1px', fontSize: '0.7rem' }}>
                                                                <div><strong style={{ color: '#555' }}>Beam Manufacturer:</strong> {formData.beamManufacturer || formData.equipmentManufacturer || 'N/A'}</div>
                                                                <div><strong style={{ color: '#555' }}>Beam S/N:</strong> {formData.beamSerial || formData.equipmentSerial || 'N/A'}</div>
                                                                {formData.beamLength && formData.beamLength !== 'N/A' && <div><strong style={{ color: '#555' }}>Length:</strong> {formData.beamLength}</div>}
                                                                <div><strong style={{ color: '#555' }}>Beam WLL:</strong> {formData.beamWll || formData.equipmentWll || 'N/A'}</div>
                                                                <div><strong style={{ color: '#555' }}>Target Test Load:</strong> {formData.targetLoad || 'N/A'}</div>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                    {formData.spreaderTests
                                                        .slice(0, parseInt(formData.numTests))
                                                        .map((test, index) => (
                                                            <tr key={index}>
                                                                <td style={{ verticalAlign: 'top', paddingTop: '6px', fontSize: '0.8rem' }}>{index + 1}</td>
                                                                <td className="text-left" style={{ paddingTop: '6px', paddingBottom: '4px', overflow: 'hidden' }}>
                                                                    <div className="font-bold" style={{ fontSize: '0.82rem', color: '#1a3a6c', borderBottom: '1px solid #1a3a6c', paddingBottom: '1px', marginBottom: '2px', lineHeight: '1.15' }}>
                                                                        {test.itemDescription || formData.equipmentTested || 'Spreader Beam Load Test'}
                                                                    </div>
                                                                    <div style={{ fontSize: '0.65rem', marginTop: '1px', lineHeight: '1.2' }}>
                                                                        <strong>Type:</strong> {test.loadType} | <strong>TEST LOAD:</strong> {test.wllPercentage || '100%'} WLL
                                                                    </div>
                                                                </td>
                                                                <td style={{ verticalAlign: 'middle', paddingTop: '6px', fontSize: '0.72rem' }}>{test.localTime}</td>
                                                                <td style={{ verticalAlign: 'middle', paddingTop: '6px', fontSize: '0.72rem' }}>{test.testDuration}</td>
                                                                {Array.from({ length: numPP }, (_, ppIdx) => {
                                                                    const testPPCount = test.numPickPoints ?? globalPP;
                                                                    const start = test.pickPointStart || 0;
                                                                    const inUse = ppIdx >= start && ppIdx < start + testPPCount;
                                                                    const ppd = inUse ? test.pickPointData[ppIdx - start] : null;
                                                                    return (
                                                                        <td key={ppIdx} className="force-val" style={{ fontSize: valFontSize, verticalAlign: 'middle', paddingTop: '6px', color: inUse ? undefined : '#999' }}>
                                                                            {inUse ? (ppd?.measuredForce ? `${Number(String(ppd.measuredForce).replace(/,/g, '')).toLocaleString()} lbs` : '--') : '—'}
                                                                        </td>
                                                                    );
                                                                })}
                                                                <td className="force-val" style={{ fontSize: valFontSize, fontWeight: 700, verticalAlign: 'middle', paddingTop: '6px' }}>
                                                                    {(() => {
                                                                        const testPPCount = test.numPickPoints ?? globalPP;
                                                                        const total = test.pickPointData.slice(0, testPPCount).reduce((sum, ppd) => {
                                                                            const val = parseFloat(String(ppd?.measuredForce || '').replace(/,/g, ''));
                                                                            return sum + (isNaN(val) ? 0 : val);
                                                                        }, 0);
                                                                        return total > 0 ? `${total.toLocaleString()} lbs` : '--';
                                                                    })()}
                                                                </td>
                                                                <td className="accept-val" style={{ color: test.accept === 'YES' ? '#006600' : '#cc0000', verticalAlign: 'middle', paddingTop: '6px', fontSize: '0.78rem' }}>{test.accept}</td>
                                                            </tr>
                                                        ))}
                                                </tbody>
                                            </table>
                                        );
                                    } else if (certLayout === 'dynamic' && testSchema) {
                                        const dynRows = (formData.dynamicTests || []).slice(0, parseInt(formData.numTests));
                                        const lo = testSchema.layout || {};
                                        const isDetailed = lo.rowStyle === 'detailed';
                                        const isExpanded = lo.descriptionPlacement === 'expanded';
                                        const testLabel = lo.testLabel || 'Item';
                                        const titleCol = (testSchema.columns || []).find(c => c.role === 'title');
                                        const subtitleCol = (testSchema.columns || []).find(c => c.role === 'subtitle');
                                        const tableCols = (testSchema.columns || []).filter(c => c.role !== 'title' && c.role !== 'subtitle');
                                        const conditionalVisible = {};
                                        tableCols.forEach(col => {
                                            if (col.showIf === 'any') {
                                                conditionalVisible[col.key] = dynRows.some(t => t[col.key] && String(t[col.key]).trim());
                                            } else {
                                                conditionalVisible[col.key] = true;
                                            }
                                        });
                                        const visibleCols = tableCols.filter(c => conditionalVisible[c.key]);
                                        const groupTableCols = [];
                                        (testSchema.groups || []).forEach(group => {
                                            const anyToggled = dynRows.some(t => t[group.toggleKey]);
                                            if (anyToggled) {
                                                (group.fields || []).filter(f => f.addToTable).forEach(f => {
                                                    groupTableCols.push({ ...f, _groupKey: group.key });
                                                });
                                            }
                                        });
                                        const totalCols = 1 + 1 + visibleCols.length + groupTableCols.length;
                                        const baseFontSize = isDetailed ? '0.82rem' : '0.78rem';
                                        const cellPad = isDetailed ? '10px' : '6px';

                                        const groupByKey = lo.groupBy || null;
                                        let lastGroupVal = null;

                                        const renderDataCell = (col, test) => {
                                            const val = test[col.key];
                                            const display = val != null && String(val).trim() ? String(val) : '--';
                                            const isForce = col.format === 'force';
                                            const isAccept = col.format === 'accept';
                                            return (
                                                <td key={col.key}
                                                    className={isForce ? 'force-val' : isAccept ? 'accept-val' : ''}
                                                    style={{
                                                        verticalAlign: 'middle', paddingTop: cellPad, fontSize: baseFontSize,
                                                        color: isAccept ? (val === 'YES' ? '#006600' : '#cc0000') : undefined
                                                    }}>
                                                    {display}
                                                </td>
                                            );
                                        };

                                        content = (
                                            <table className="cert-table">
                                                <thead>
                                                    <tr>
                                                        <th style={{ width: '32px' }}>{testLabel}</th>
                                                        <th>{titleCol?.label || 'Equipment / Description'}</th>
                                                        {!isExpanded && subtitleCol && <th style={{ fontSize: '0.65rem' }}>Details</th>}
                                                        {visibleCols.map(col => (
                                                            <th key={col.key} style={{ width: col.width || '78px', fontSize: col.width && parseInt(col.width) < 60 ? '0.65rem' : undefined }}>{col.label}</th>
                                                        ))}
                                                        {groupTableCols.map(col => (
                                                            <th key={col.key} style={{ width: col.tableWidth || '82px', fontSize: '0.65rem' }}>{col.tableLabel || col.label}</th>
                                                        ))}
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    <tr>
                                                        <td colSpan={totalCols + (!isExpanded && subtitleCol ? 1 : 0)} className="text-left" style={{ paddingBottom: '8px' }}>
                                                            <div style={{ marginBottom: '4px', fontSize: '0.75rem' }}>
                                                                <strong style={{ color: '#555' }}>Test Type:</strong> {testSchema.testType || 'Load Test'}
                                                            </div>
                                                            {(testSchema.headerFields || []).length > 0 && (
                                                                <div style={{ display: 'flex', flexWrap: 'wrap', columnGap: '15px', rowGap: '2px', fontSize: '0.75rem' }}>
                                                                    {testSchema.headerFields.map(hf => (
                                                                        formData[hf.key] ? <div key={hf.key}><strong style={{ color: '#555' }}>{hf.label}:</strong> {formData[hf.key]}</div> : null
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </td>
                                                    </tr>
                                                    {dynRows.map((test, index) => {
                                                        const rows = [];
                                                        if (groupByKey && test[groupByKey] !== lastGroupVal) {
                                                            lastGroupVal = test[groupByKey];
                                                            rows.push(
                                                                <tr key={`grp-${index}`}>
                                                                    <td colSpan={totalCols + (!isExpanded && subtitleCol ? 1 : 0)}
                                                                        style={{ background: '#1a3a6c', color: '#fff', fontWeight: 700, fontSize: '0.75rem', padding: '4px 8px', letterSpacing: '0.5px' }}>
                                                                        {lastGroupVal}
                                                                    </td>
                                                                </tr>
                                                            );
                                                        }
                                                        rows.push(
                                                            <tr key={index}>
                                                                <td style={{ verticalAlign: 'top', paddingTop: cellPad }}>{index + 1}</td>
                                                                <td className="text-left" style={{ paddingTop: cellPad, paddingBottom: cellPad }}>
                                                                    {titleCol && (
                                                                        <div className="font-bold" style={{ fontSize: isDetailed ? '0.88rem' : '0.82rem', color: '#1a3a6c', borderBottom: '1px solid #1a3a6c', paddingBottom: '1px', marginBottom: isExpanded ? '2px' : '4px', lineHeight: '1.15' }}>
                                                                            {test[titleCol.key] || 'Equipment under test'}
                                                                        </div>
                                                                    )}
                                                                    {!isExpanded && subtitleCol && test[subtitleCol.key] && (
                                                                        <div style={{ fontSize: '0.7rem', marginTop: '2px', fontStyle: 'italic', lineHeight: '1.25' }}>
                                                                            {test[subtitleCol.key]}
                                                                        </div>
                                                                    )}
                                                                </td>
                                                                {!isExpanded && subtitleCol && (
                                                                    <td className="text-left" style={{ verticalAlign: 'top', paddingTop: cellPad, fontSize: '0.68rem', fontStyle: 'italic', lineHeight: '1.25', maxWidth: '180px' }}>
                                                                        {test[subtitleCol.key] || ''}
                                                                    </td>
                                                                )}
                                                                {visibleCols.map(col => renderDataCell(col, test))}
                                                                {groupTableCols.map(col => {
                                                                    const group = (testSchema.groups || []).find(g => g.key === col._groupKey);
                                                                    const toggled = group && test[group.toggleKey];
                                                                    return (
                                                                        <td key={col.key} className="force-val" style={{ verticalAlign: 'middle', paddingTop: cellPad, fontSize: baseFontSize }}>
                                                                            {toggled && test[col.key] ? test[col.key] : '--'}
                                                                        </td>
                                                                    );
                                                                })}
                                                            </tr>
                                                        );
                                                        if (isExpanded && subtitleCol && test[subtitleCol.key]) {
                                                            rows.push(
                                                                <tr key={`desc-${index}`}>
                                                                    <td></td>
                                                                    <td colSpan={totalCols + (!isExpanded && subtitleCol ? 1 : 0) - 1} className="text-left"
                                                                        style={{ paddingTop: '2px', paddingBottom: cellPad, fontSize: '0.7rem', fontStyle: 'italic', lineHeight: '1.3', borderBottom: '0.5px solid #ddd' }}>
                                                                        {test[subtitleCol.key]}
                                                                    </td>
                                                                </tr>
                                                            );
                                                        }
                                                        return rows;
                                                    })}
                                                    {lo.showSummary && lo.summaryColumns?.length > 0 && (
                                                        <tr style={{ borderTop: '2px solid #1a3a6c', fontWeight: 700 }}>
                                                            <td></td>
                                                            <td className="text-left" style={{ fontSize: baseFontSize, color: '#1a3a6c' }}>SUMMARY</td>
                                                            {!isExpanded && subtitleCol && <td></td>}
                                                            {visibleCols.map(col => {
                                                                const sc = lo.summaryColumns.find(s => s.key === col.key);
                                                                if (!sc) return <td key={col.key}></td>;
                                                                let val;
                                                                const nums = dynRows.map(t => parseFloat(String(t[col.key] || '').replace(/,/g, ''))).filter(n => !isNaN(n));
                                                                if (sc.operation === 'sum') val = nums.reduce((a, b) => a + b, 0);
                                                                else if (sc.operation === 'max') val = nums.length ? Math.max(...nums) : 0;
                                                                else if (sc.operation === 'count') val = dynRows.length;
                                                                else val = nums.reduce((a, b) => a + b, 0);
                                                                return (
                                                                    <td key={col.key} className="force-val" style={{ fontSize: baseFontSize, color: '#1a3a6c' }}>
                                                                        {sc.label ? `${sc.label}: ` : ''}{val != null ? val.toLocaleString() : '--'}
                                                                    </td>
                                                                );
                                                            })}
                                                            {groupTableCols.map(col => <td key={col.key}></td>)}
                                                        </tr>
                                                    )}
                                                </tbody>
                                            </table>
                                        );
                                    } else {
                                        content = (
                                            <table className="cert-table">
                                                <thead>
                                                    <tr>
                                                        <th style={{ width: '40px' }}>Item</th>
                                                        <th>Item Description</th>
                                                        <th style={{ width: '80px' }}>Local Time</th>
                                                        <th style={{ width: '80px' }}>Test Dur.</th>
                                                        {(formData.hooks || []).map((hook, hIdx) => (
                                                            <th key={hIdx} style={{ width: '95px', fontSize: '0.65rem' }}>{hook.name || `Hook ${hIdx + 1}`}</th>
                                                        ))}
                                                        <th style={{ width: '95px', fontSize: '0.65rem' }}>Total</th>
                                                        <th style={{ width: '60px' }}>Accept</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    <tr>
                                                        <td colSpan={4 + (formData.hooks || []).length + 2} className="text-left" style={{ paddingBottom: '4px' }}>
                                                            <div style={{ display: 'flex', flexWrap: 'wrap', columnGap: '15px', rowGap: '2px', marginBottom: '2px', fontSize: '0.75rem' }}>
                                                                <div><strong style={{ color: '#555' }}>Crane Manufacturer:</strong> {formData.equipmentManufacturer || 'N/A'}</div>
                                                                <div><strong style={{ color: '#555' }}>Crane S/N:</strong> {formData.equipmentSerial || 'N/A'}</div>
                                                                <div><strong style={{ color: '#555' }}>Crane WLL:</strong> {formData.equipmentWll || 'N/A'}</div>
                                                                <div><strong style={{ color: '#555' }}>Target Test Load:</strong> {formData.targetLoad || 'N/A'}</div>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                    {formData.tests
                                                        .slice(0, parseInt(formData.numTests))
                                                        .map((test, index) => (
                                                            <tr key={index}>
                                                                <td style={{ verticalAlign: 'top', paddingTop: '5px' }}>{index + 1}</td>
                                                                <td className="text-left" style={{ paddingTop: '5px', paddingBottom: '5px' }}>
                                                                    <div className="font-bold" style={{ fontSize: '0.95rem', color: '#1a3a6c', borderBottom: '1px solid #1a3a6c', paddingBottom: '1px', marginBottom: '3px' }}>
                                                                        {test.itemDescription || formData.equipmentTested}
                                                                    </div>
                                                                    <div style={{ fontSize: '0.75rem', marginTop: '1px' }}>
                                                                        <strong>Type:</strong> {test.loadType} | <strong>TEST LOAD:</strong> {test.wllPercentage || '100%'} WLL
                                                                    </div>
                                                                </td>
                                                                <td style={{ verticalAlign: 'middle', paddingTop: '5px' }}>{test.localTime}</td>
                                                                <td style={{ verticalAlign: 'middle', paddingTop: '5px' }}>{test.testDuration}</td>
                                                                {(formData.hooks || []).map((hook, hIdx) => {
                                                                    const force = test.hookData && test.hookData[hIdx]?.measuredForce;
                                                                    return (
                                                                        <td key={hIdx} className="force-val" style={{ fontSize: '0.85rem', verticalAlign: 'middle', paddingTop: '5px' }}>
                                                                            {force && String(force).trim() ? `${force} lbs` : '--'}
                                                                        </td>
                                                                    );
                                                                })}
                                                                <td className="force-val" style={{ fontSize: '0.85rem', fontWeight: 700, verticalAlign: 'middle', paddingTop: '5px' }}>
                                                                    {(() => {
                                                                        const total = (formData.hooks || []).reduce((sum, _, hIdx) => {
                                                                            const raw = test.hookData && test.hookData[hIdx]?.measuredForce;
                                                                            const val = parseFloat(String(raw || '').replace(/,/g, ''));
                                                                            return sum + (isNaN(val) ? 0 : val);
                                                                        }, 0);
                                                                        return total > 0 ? `${total.toLocaleString()} lbs` : '--';
                                                                    })()}
                                                                </td>
                                                                <td className="accept-val" style={{ color: test.accept === 'YES' ? '#006600' : '#cc0000', verticalAlign: 'middle', paddingTop: '5px' }}>{test.accept}</td>
                                                            </tr>
                                                        ))}
                                                </tbody>
                                            </table>
                                        );
                                    }
                                    break;
                                case 'footer':
                                    content = (
                                        <>
                                            <div className="cert-footer-grid" style={{ marginTop: '3px' }}>
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
                                            {/* Customer Signature */}
                                            {customerSignature && (
                                                <div style={{ marginTop: '8px', display: 'flex', alignItems: 'flex-end', gap: '16px', borderTop: '0.5px solid #eee', paddingTop: '8px' }}>
                                                    <div style={{ flex: 1 }}>
                                                        <div style={{ fontSize: '0.65rem', color: '#888', marginBottom: '2px' }}>Customer Acknowledgement:</div>
                                                        <img src={customerSignature} alt="Customer Signature" style={{ maxHeight: '60px', maxWidth: '250px' }} />
                                                    </div>
                                                    <div style={{ fontSize: '0.65rem', color: '#888' }}>
                                                        Date: {new Date().toLocaleDateString()}
                                                    </div>
                                                </div>
                                            )}
                                        </>
                                    );
                                    break;
                                case 'graphs': {
                                    if (allChartStats.length === 0) return null;
                                    const gcCount = allChartStats.length;
                                    const gcPhotos = formData.photos || [];
                                    const gcHasPhotos = gcPhotos.length > 0;
                                    const GC_USABLE = 930;
                                    const GC_CHART_OH = 22;
                                    const GC_PHOTO_OH = 28;
                                    const gcTotalOH = gcCount * GC_CHART_OH + (gcHasPhotos ? GC_PHOTO_OH : 0);
                                    const gcContentPx = GC_USABLE - gcTotalOH;
                                    const gcPhotoWeight = !gcHasPhotos ? 0 : gcPhotos.length === 1 ? 0.7 : gcPhotos.length === 2 ? 0.9 : 1.1;
                                    const gcUnits = gcCount + gcPhotoWeight;
                                    const gcUnitPx = gcUnits > 0 ? gcContentPx / gcUnits : gcContentPx;
                                    const gcChartH = Math.max(80, Math.min(400, Math.floor(gcUnitPx)));
                                    content = (
                                        <>
                                            {allChartStats.map((stats, idx) => (
                                                <div key={idx} className="cert-chart-section" style={{
                                                    pageBreakInside: 'avoid',
                                                    breakInside: 'avoid',
                                                    pageBreakBefore: formData.graphPageBreaks[idx] ? 'always' : 'auto',
                                                    breakBefore: formData.graphPageBreaks[idx] ? 'page' : 'auto',
                                                    marginTop: gcCount >= 4 ? 2 : 6,
                                                    padding: gcCount >= 4 ? '2px 4px' : '4px'
                                                }}>
                                                    <div className="cert-chart-header" style={gcCount >= 3 ? { fontSize: '0.6rem', marginBottom: '1px', paddingBottom: '1px' } : undefined}>
                                                        {gcCount > 1 ? `LOAD TEST GRAPH #${idx + 1} (${dataSets[idx]?.name || 'N/A'})` : (dataSets[idx]?.name || 'LOAD TEST GRAPH')}
                                                    </div>
                                                    <div className="cert-chart-container" style={{ height: `${gcChartH}px` }}>
                                                        <CertChart
                                                            stats={stats}
                                                            yAxisLabel={dataSets[idx]?.yAxisLabel || `Weight (${displayUnit})`}
                                                            xAxisLabel={`Elapsed Time (${xUnit === 'hour' ? 'hr' : 'min'})`}
                                                            isPrint={false}
                                                        />
                                                    </div>
                                                </div>
                                            ))}
                                        </>
                                    );
                                    break;
                                }
                                case 'photos': {
                                    if (!formData.photos || formData.photos.length === 0) return null;
                                    const ppPhotos = formData.photos;
                                    const ppCount = ppPhotos.length;
                                    const ppChartCount = allChartStats.length;
                                    const PP_USABLE = 930;
                                    const PP_CHART_OH = 22;
                                    const PP_PHOTO_OH = 28;
                                    const ppTotalOH = (ppChartCount > 0 ? ppChartCount * PP_CHART_OH : 0) + PP_PHOTO_OH;
                                    const ppContentPx = PP_USABLE - ppTotalOH;
                                    const ppPhotoWeight = ppCount === 1 ? 0.7 : ppCount === 2 ? 0.9 : 1.1;
                                    const ppUnits = ppChartCount + ppPhotoWeight;
                                    const ppUnitPx = ppUnits > 0 ? ppContentPx / ppUnits : ppContentPx;
                                    const ppTotalPx = Math.max(100, Math.floor(ppUnitPx * ppPhotoWeight));
                                    const ppRows = ppCount <= 2 ? 1 : 2;
                                    const ppItemH = Math.floor((ppTotalPx - (ppRows > 1 ? 6 : 0)) / ppRows);
                                    const ppCols = ppCount <= 2 ? ppCount : 2;
                                    content = (
                                        <div className="cert-photos-section" style={{ marginTop: '8px', padding: '4px 4px 6px' }}>
                                            <div className="cert-photos-header" style={{ fontSize: '0.65rem', marginBottom: '4px', paddingBottom: '2px' }}>SITE PHOTOS</div>
                                            <div style={{
                                                display: 'grid',
                                                gridTemplateColumns: ppCount === 1 ? '1fr' : `repeat(${ppCols}, 1fr)`,
                                                gap: '6px',
                                                justifyItems: ppCount === 1 ? 'center' : 'stretch'
                                            }}>
                                                {ppPhotos.map((photo, index) => (
                                                    <div key={index} style={{
                                                        overflow: 'hidden',
                                                        border: '0.75px solid #000',
                                                        height: `${ppItemH}px`,
                                                        maxWidth: ppCount === 1 ? '60%' : '100%'
                                                    }}>
                                                        <img src={photo} alt={`Site photo ${index + 1}`} style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#f9f9f9', display: 'block' }} />
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    );
                                    break;
                                }
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

                        const disclaimerEl = (
                            <div style={{ marginTop: '4px', fontSize: '0.68rem', color: '#444', fontStyle: 'italic', textAlign: 'center', lineHeight: '1.2', borderTop: '0.5px solid #eee', paddingTop: '6px' }}>
                                Scofield Group, LLC is not a Class Certified Surveyor nor OSHA Part 1919 Accredited Agency and makes no claim of equipment structural conformance as a result of load testing services performed.
                            </div>
                        );

                        const remainingSections = sections.filter(id => ['graphs', 'photos'].includes(id));
                        const hasPage2 = remainingSections.some(id => {
                            if (id === 'graphs') return allChartStats.length > 0;
                            if (id === 'photos') return formData.photos && formData.photos.length > 0;
                            return false;
                        });

                        return (
                            <>
                                <div className="cert-main-page">
                                    {mainSections.map(id => renderSectionContent(id))}
                                    {!hasPage2 && disclaimerEl}
                                </div>
                            </>
                        );
                    })()}
                </div>

                {/* Page 2: Graphs, Photos, and Disclaimer — auto-layout or AI overrides */}
                {(() => {
                    const remainingSections = (formData.sectionOrder || ['header', 'infoGrid', 'testTable', 'footer', 'graphs', 'photos'])
                        .filter(id => ['graphs', 'photos'].includes(id));
                    const hasRemaining = remainingSections.some(id => {
                        if (id === 'graphs') return allChartStats.length > 0;
                        if (id === 'photos') return formData.photos && formData.photos.length > 0;
                        return false;
                    });
                    if (!hasRemaining) return null;

                    const chartCount = allChartStats.length;
                    const photos = formData.photos || [];
                    const photoCount = photos.length;
                    const hasGraphs = chartCount > 0;
                    const hasPhotos = photoCount > 0;
                    const lo = aiLayoutOverrides; // AI layout overrides (if any)

                    // --- Compute default layout ---
                    const USABLE_PX = 930;
                    const CHART_OVERHEAD = 22;
                    const PHOTO_OVERHEAD = 28;
                    const totalOverhead = (hasGraphs ? chartCount * CHART_OVERHEAD : 0) + (hasPhotos ? PHOTO_OVERHEAD : 0);
                    const contentPx = USABLE_PX - totalOverhead;
                    const defPhotoWeight = !hasPhotos ? 0 : photoCount === 1 ? 0.7 : photoCount === 2 ? 0.9 : 1.1;
                    const defUnits = chartCount + defPhotoWeight;
                    const defUnitPx = defUnits > 0 ? contentPx / defUnits : contentPx;
                    const defChartH = hasGraphs ? Math.max(80, Math.min(400, Math.floor(defUnitPx))) : 0;
                    const defPhotoRows = photoCount <= 2 ? 1 : 2;
                    const defPhotoTotalPx = hasPhotos ? Math.max(100, Math.floor(defUnitPx * defPhotoWeight)) : 0;
                    const defPhotoItemH = hasPhotos ? Math.floor((defPhotoTotalPx - (defPhotoRows > 1 ? 6 : 0)) / defPhotoRows) : 0;
                    const defPhotoCols = photoCount <= 2 ? photoCount : 2;

                    // --- Apply AI overrides or use defaults ---
                    const chartHeights = lo?.chartHeights || allChartStats.map(() => defChartH);
                    const photoCols = lo?.photoCols ?? defPhotoCols;
                    const photoItemHeight = lo?.photoHeight ?? defPhotoItemH;
                    const pageBreaks = lo?.graphPageBreaks || formData.graphPageBreaks || {};
                    const graphSpacing = lo?.graphSpacing ?? (chartCount >= 4 ? 3 : 6);

                    return (
                        <div className="certificate-paper cert-page-2" style={{ paddingLeft: '44px', pageBreakBefore: 'always', breakBefore: 'page', display: 'flex', flexDirection: 'column', minHeight: '275mm' }}>
                            <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                                {/* Graphs */}
                                {hasGraphs && allChartStats.map((stats, idx) => {
                                    const h = chartHeights[idx] ?? defChartH;
                                    const shouldBreak = pageBreaks[idx] || false;
                                    return (
                                        <div key={idx} className="cert-chart-section" style={{
                                            pageBreakInside: 'avoid',
                                            breakInside: 'avoid',
                                            pageBreakBefore: shouldBreak ? 'always' : 'auto',
                                            breakBefore: shouldBreak ? 'page' : 'auto',
                                            marginTop: idx === 0 ? 0 : graphSpacing,
                                            marginBottom: 0,
                                            padding: '3px 4px',
                                            flex: `1 1 ${h}px`,
                                            minHeight: `${Math.min(h, 80)}px`
                                        }}>
                                            <div className="cert-chart-header" style={{ fontSize: chartCount >= 3 ? '0.6rem' : '0.7rem', marginBottom: '2px', paddingBottom: '2px' }}>
                                                {chartCount > 1 ? `LOAD TEST GRAPH #${idx + 1} (${dataSets[idx]?.name || 'N/A'})` : (dataSets[idx]?.name || 'LOAD TEST GRAPH')}
                                            </div>
                                            <div className="cert-chart-container" style={{ height: `${h}px` }}>
                                                <CertChart
                                                    stats={stats}
                                                    yAxisLabel={dataSets[idx]?.yAxisLabel || 'Weight (lbs)'}
                                                    xAxisLabel="Elapsed Time (min)"
                                                    isPrint={true}
                                                />
                                            </div>
                                        </div>
                                    );
                                })}

                                {/* Photos — adaptive grid */}
                                {hasPhotos && (
                                    <div className="cert-photos-section" style={{
                                        marginTop: hasGraphs ? '6px' : 0,
                                        padding: '4px 4px 6px',
                                        flex: hasGraphs ? '0 0 auto' : '1 1 auto'
                                    }}>
                                        <div className="cert-photos-header" style={{ fontSize: '0.65rem', marginBottom: '4px', paddingBottom: '2px' }}>SITE PHOTOS</div>
                                        <div style={{
                                            display: 'grid',
                                            gridTemplateColumns: photoCount === 1 ? '1fr' : `repeat(${photoCols}, 1fr)`,
                                            gap: '6px',
                                            justifyItems: photoCount === 1 ? 'center' : 'stretch'
                                        }}>
                                            {photos.map((photo, index) => (
                                                <div key={index} style={{
                                                    overflow: 'hidden',
                                                    border: '0.75px solid #000',
                                                    height: `${photoItemHeight}px`,
                                                    maxWidth: photoCount === 1 ? '60%' : '100%'
                                                }}>
                                                    <img src={photo} alt={`Site photo ${index + 1}`} style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#f9f9f9', display: 'block' }} />
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>

                            {/* Disclaimer pinned to bottom of page 2 */}
                            <div style={{ marginTop: 'auto', fontSize: '0.68rem', color: '#444', fontStyle: 'italic', textAlign: 'center', lineHeight: '1.2', borderTop: '0.5px solid #eee', paddingTop: '6px' }}>
                                Scofield Group, LLC is not a Class Certified Surveyor nor OSHA Part 1919 Accredited Agency and makes no claim of equipment structural conformance as a result of load testing services performed.
                            </div>
                        </div>
                    );
                })()}
            </div>
        );
    }

    return (
        <div className="certificate-form-container">
            {/* Certificate Tabs */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginBottom: '12px', flexWrap: 'wrap' }}>
                {(() => {
                    const tabs = certificates.length > 0
                        ? certificates
                        : [{ name: 'Certificate 1' }];
                    return tabs.map((cert, idx) => (
                        <button
                            key={idx}
                            onClick={() => switchCertificate(idx)}
                            onDoubleClick={() => {
                                const name = prompt('Rename certificate:', cert.name || `Certificate ${idx + 1}`);
                                if (name) renameCertificate(idx, name);
                            }}
                            style={{
                                padding: '6px 14px',
                                fontSize: '0.8rem',
                                fontWeight: idx === activeCertIndex ? 700 : 400,
                                background: idx === activeCertIndex ? 'var(--yellow-accent)' : 'var(--bg-elevated)',
                                color: idx === activeCertIndex ? '#000' : 'var(--text-secondary)',
                                border: `1px solid ${idx === activeCertIndex ? 'var(--yellow-accent)' : 'var(--border)'}`,
                                borderRadius: '6px 6px 0 0',
                                cursor: 'pointer',
                            }}
                        >
                            {cert.name || `Certificate ${idx + 1}`}
                        </button>
                    ));
                })()}
                <button
                    onClick={addNewCertificate}
                    style={{ padding: '6px 10px', fontSize: '0.85rem', background: 'transparent', border: '1px dashed var(--border)', borderRadius: '6px 6px 0 0', color: 'var(--text-secondary)', cursor: 'pointer' }}
                    title="Add another certificate to this job"
                >
                    +
                </button>
            </div>

            <div className="cert-editor-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', background: 'var(--bg-card)', padding: '14px 20px', borderRadius: '0 10px 10px 10px', border: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <button
                        onClick={() => setShowAiGenerator(true)}
                        className="action-btn"
                        style={{ fontSize: '0.85rem', padding: '8px 16px', whiteSpace: 'nowrap', background: '#1a3a6c' }}
                    >
                        🤖 AI Generate
                    </button>
                    <select
                        value={certLayout}
                        onChange={(e) => setCertLayout(e.target.value)}
                        className="control-select"
                        style={{ fontSize: '0.82rem', padding: '6px 10px' }}
                    >
                        <option value="crane-hook">Crane Hook</option>
                        <option value="spreader-beam">Spreader Beam</option>
                        <option value="steel-weight">Steel Weight</option>
                        <option value="gangway">Gangway</option>
                        {testSchema && <option value="dynamic">{testSchema.testType || 'Dynamic'}</option>}
                    </select>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                    <button
                        onClick={handleResetForm}
                        className="action-btn secondary small"
                        title="Reset certificate to defaults"
                        style={{ color: '#ff6b6b', borderColor: '#cc3333', fontSize: '0.78rem', padding: '5px 10px' }}
                    >
                        Reset
                    </button>
                    <button onClick={showPreview} className="action-btn" style={{ fontSize: '0.85rem', padding: '8px 18px' }}>
                        Preview
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
                    {certLayout === 'gangway' && (
                        <div className="form-row">
                            <div className="form-group">
                                <label>Vessel Name</label>
                                <input name="vesselName" value={formData.vesselName || ''} onChange={handleInput} placeholder="e.g. M/V Atlantic Voyager" />
                            </div>
                            <div className="form-group">
                                <label>Vessel Class</label>
                                <input name="vesselClass" value={formData.vesselClass || ''} onChange={handleInput} placeholder="e.g. ABS A1, DNV +1A1, USCG..." />
                            </div>
                        </div>
                    )}
                    {certLayout === 'dynamic' && testSchema?.headerFields?.length > 0 && (
                        <div className="form-row">
                            {testSchema.headerFields.map(hf => (
                                <div className="form-group" key={hf.key}>
                                    <label>{hf.label}</label>
                                    <input name={hf.key} value={formData[hf.key] || ''} onChange={handleInput} placeholder={hf.label + '...'} />
                                </div>
                            ))}
                        </div>
                    )}
                </section>

                <section className="form-section span-2">
                    <div className="section-header-row">
                        <h3>Instruments{certLayout === 'gangway' && <span style={{ marginLeft: '10px', fontSize: '0.7rem', color: '#2188ff', fontWeight: 600 }}>(locked to 3" Zenner Flow Meter for Accommodation Ladder / Gangway)</span>}</h3>
                        {certLayout !== 'gangway' && (
                            <button onClick={addInstrument} className="action-btn small">
                                + Add Instrument
                            </button>
                        )}
                    </div>
                    {formData.instruments?.map((inst, index) => (
                        <div key={index} className="instrument-entry-block" style={{ borderBottom: index < formData.instruments.length - 1 ? '1px solid var(--border)' : 'none', paddingBottom: '20px', marginBottom: '20px' }}>
                            <div className="section-header-row" style={{ marginTop: '10px' }}>
                                <h4 style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>Instrument #{index + 1}</h4>
                                {formData.instruments.length > 1 && certLayout !== 'gangway' && (
                                    <button onClick={() => removeInstrument(index)} className="job-remove-btn" title="Remove Instrument">✕</button>
                                )}
                            </div>
                            <div className="form-row">
                                <div className="form-group" style={{ flex: 1 }}>
                                    <label>Instrument</label>
                                    {certLayout === 'gangway' ? (
                                        <input
                                            value={'3" Zenner Flow Meter'}
                                            readOnly
                                            style={{ background: 'var(--bg-card)', color: '#2188ff', fontWeight: 700, cursor: 'not-allowed' }}
                                        />
                                    ) : (
                                        <select value={inst.instrument} onChange={(e) => handleInstrumentInput(index, 'instrument', e.target.value)}>
                                            <option value="">Select Instrument...</option>
                                            <option value="Load Cell">Load Cell</option>
                                            <option value="Flow Meter">Flow Meter</option>
                                        </select>
                                    )}
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
                                        <option value="99.2%">99.2%</option>
                                        <option value="N/A">N/A</option>
                                    </select>
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
                            <label>Test Date</label>
                            <input type="date" name="testDate" value={formData.testDate} onChange={handleInput} />
                        </div>
                        <div className="form-group" style={{ flex: 1 }}>
                            <label>Cert No.</label>
                            <div style={{ display: 'flex', gap: '6px' }}>
                                <input name="certNo" value={formData.certNo} onChange={handleInput} style={{ flex: 1 }} />
                                <button
                                    type="button"
                                    className="action-btn secondary"
                                    style={{ padding: '4px 10px', fontSize: '0.75rem', whiteSpace: 'nowrap' }}
                                    onClick={async () => {
                                        const certNo = await getElectronAPI().certNextNumber();
                                        setFormData(prev => ({ ...prev, certNo }));
                                    }}
                                    title="Auto-generate next certificate number"
                                >
                                    Auto #
                                </button>
                            </div>
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
                    {certLayout === 'crane-hook' && (
                    <div className="form-row">
                        <div className="form-group">
                            <label>Crane Manufacturer</label>
                            <input name="equipmentManufacturer" value={formData.equipmentManufacturer} onChange={handleInput} placeholder="e.g. Mi-Jack, Liebherr..." />
                        </div>
                        <div className="form-group">
                            <label>Crane S/N</label>
                            <input name="equipmentSerial" value={formData.equipmentSerial} onChange={handleInput} placeholder="Serial Number..." />
                        </div>
                        <div className="form-group">
                            <label>Crane WLL</label>
                            <input name="equipmentWll" value={formData.equipmentWll} onChange={handleInput} placeholder="e.g. 100 Tons" />
                        </div>
                        <div className="form-group">
                            <label>Target Test Load</label>
                            <input name="targetLoad" value={formData.targetLoad} onChange={handleInput} placeholder="e.g. 50 Tons" />
                        </div>
                    </div>
                    )}
                    {certLayout === 'spreader-beam' && (
                    <div className="form-row">
                        <div className="form-group">
                            <label>Target Test Load</label>
                            <input name="targetLoad" value={formData.targetLoad} onChange={handleInput} placeholder="e.g. 50 Tons" />
                        </div>
                    </div>
                    )}
                    <div className="form-group">
                        <label>Procedure Summary</label>
                        <textarea name="procedureSummary" value={formData.procedureSummary} onChange={handleInput} rows="3" placeholder="Describe the testing procedure..." />
                    </div>
                </section>

                {certLayout === 'crane-hook' && (
                <section className="form-section span-2">
                    <div className="section-header-row">
                        <h3>Hooks</h3>
                        <button onClick={addHook} className="action-btn small">
                            + Add Hook
                        </button>
                    </div>
                    {(formData.hooks || []).map((hook, index) => (
                        <div key={index} style={{ borderBottom: index < formData.hooks.length - 1 ? '1px solid var(--border)' : 'none', paddingBottom: '16px', marginBottom: '16px' }}>
                            <div className="section-header-row" style={{ marginTop: '6px' }}>
                                <h4 style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>Hook #{index + 1}</h4>
                                {formData.hooks.length > 1 && (
                                    <button onClick={() => removeHook(index)} className="job-remove-btn" title="Remove Hook">&#10005;</button>
                                )}
                            </div>
                            <div className="form-row">
                                <div className="form-group" style={{ flex: 1 }}>
                                    <label>Hook Name</label>
                                    <input
                                        list={`hook-name-suggestions-${index}`}
                                        value={hook.name || ''}
                                        onChange={(e) => handleHookInput(index, 'name', e.target.value)}
                                        placeholder="e.g. Main Hook, Aux Hook..."
                                    />
                                    <datalist id={`hook-name-suggestions-${index}`}>
                                        <option value="Main Hook" />
                                        <option value="Aux Hook" />
                                        <option value="Whip Hook" />
                                    </datalist>
                                </div>
                                <div className="form-group" style={{ flex: 1 }}>
                                    <label>WLL</label>
                                    <input
                                        value={hook.wll || ''}
                                        onChange={(e) => handleHookInput(index, 'wll', e.target.value)}
                                        placeholder="Working Load Limit..."
                                    />
                                </div>
                            </div>
                        </div>
                    ))}
                </section>
                )}

                {certLayout === 'spreader-beam' && (
                <section className="form-section span-2">
                    <h3>Spreader Beam Configuration</h3>
                    <div className="form-row">
                        <div className="form-group">
                            <label>Beam Manufacturer</label>
                            <input name="beamManufacturer" value={formData.beamManufacturer} onChange={handleInput} placeholder="Manufacturer name..." />
                        </div>
                        <div className="form-group">
                            <label>Beam S/N</label>
                            <input name="beamSerial" value={formData.beamSerial} onChange={handleInput} placeholder="Serial number..." />
                        </div>
                        <div className="form-group">
                            <label>Beam Length</label>
                            <input name="beamLength" value={formData.beamLength} onChange={handleInput} placeholder="e.g. 40 ft" />
                        </div>
                        <div className="form-group">
                            <label>Beam WLL</label>
                            <input name="beamWll" value={formData.beamWll} onChange={handleInput} placeholder="e.g. 50 Tons" />
                        </div>
                    </div>
                    <div className="form-row" style={{ alignItems: 'flex-end' }}>
                        <div className="form-group" style={{ maxWidth: '200px' }}>
                            <label>Number of Pick Points</label>
                            <select name="numPickPoints" value={formData.numPickPoints} onChange={handleInput}>
                                {[1, 2, 3, 4, 5, 6].map(n => (
                                    <option key={n} value={n}>{n} Pick Point{n > 1 ? 's' : ''}</option>
                                ))}
                            </select>
                        </div>
                    </div>
                    <div style={{ marginTop: '12px' }}>
                        <h4 style={{ color: 'var(--yellow-accent)', fontSize: '0.85rem', marginBottom: '10px' }}>Pick Point Positions</h4>
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '10px' }}>
                            {formData.pickPoints.slice(0, parseInt(formData.numPickPoints)).map((pp, i) => (
                                <div key={i} style={{ background: 'var(--bg-elevated)', padding: '12px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--yellow-accent)', fontWeight: 700, marginBottom: '6px' }}>PICK POINT {i + 1}</div>
                                    <div className="form-group" style={{ marginBottom: '6px' }}>
                                        <label style={{ fontSize: '0.72rem' }}>Label</label>
                                        <input value={pp.label} onChange={(e) => handlePickPointInput(i, 'label', e.target.value)}
                                            placeholder={`Pick Point ${i + 1}`} style={{ fontSize: '0.82rem' }} />
                                    </div>
                                    <div className="form-group">
                                        <label style={{ fontSize: '0.72rem' }}>Position on Beam</label>
                                        <input value={pp.position} onChange={(e) => handlePickPointInput(i, 'position', e.target.value)}
                                            placeholder="e.g. 10 ft from center" style={{ fontSize: '0.82rem' }} />
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </section>
                )}

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
                            {(!formData.photos || formData.photos.length < 10) && (
                                <label className="add-photo-card">
                                    <input type="file" accept="image/*" multiple onChange={onPhotoChange} style={{ display: 'none' }} />
                                    <div className="add-icon">+</div>
                                    <div className="add-text">Add Photo</div>
                                </label>
                            )}
                        </div>
                        <p className="helper-text">Add up to 10 photos to include in the certificate.</p>
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

            {/* Crane Hook Test Records */}
            {certLayout === 'crane-hook' && formData.tests.slice(0, parseInt(formData.numTests)).map((test, index) => (
                <section className="form-section" key={index} style={{ borderLeft: '4px solid var(--accent)' }}>
                    <div className="section-header-row">
                        <h3 style={{ margin: 0 }}>Test Record #{index + 1} {index === 0 && <span style={{ fontSize: '0.7rem', color: 'var(--yellow-accent)', marginLeft: '10px' }}>(Auto-Filled)</span>}</h3>
                        {parseInt(formData.numTests) > 1 && (
                            <button onClick={() => removeTestRecord(index)} className="job-remove-btn" title="Remove this test record">✕</button>
                        )}
                    </div>
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
                            <label>Accept</label>
                            <select value={test.accept} onChange={(e) => handleTestInput(index, 'accept', e.target.value)}>
                                <option value="YES">YES</option>
                                <option value="NO">NO</option>
                                <option value="N/A">N/A</option>
                            </select>
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

                    {/* Per-hook measured forces — only shown when multiple hooks are being tested */}
                    {(formData.hooks || []).length > 1 && (
                    <div style={{ marginTop: '12px', background: 'var(--bg-elevated)', padding: '14px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                        <div style={{ fontSize: '0.78rem', color: 'var(--accent)', fontWeight: 700, marginBottom: '10px' }}>MEASURED FORCE PER HOOK</div>
                        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min((formData.hooks || []).length, 3)}, 1fr)`, gap: '10px' }}>
                            {(formData.hooks || []).map((hook, hIdx) => (
                                <div key={hIdx} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                    <label style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                                        {hook.name || `Hook ${hIdx + 1}`}
                                        {hook.wll && <span style={{ opacity: 0.6 }}> (WLL: {hook.wll})</span>}
                                    </label>
                                    <div style={{ display: 'flex', gap: '6px' }}>
                                        <input
                                            value={(test.hookData && test.hookData[hIdx]?.measuredForce) || ''}
                                            onChange={(e) => handleTestHookData(index, hIdx, 'measuredForce', e.target.value)}
                                            className={index === 0 && hIdx === 0 ? "auto-input" : ""}
                                            placeholder="lbs"
                                            style={{ flex: 1, fontSize: '0.85rem' }}
                                        />
                                        <select
                                            value={(test.hookData && test.hookData[hIdx]?.accept) || 'YES'}
                                            onChange={(e) => handleTestHookData(index, hIdx, 'accept', e.target.value)}
                                            style={{ width: '65px', fontSize: '0.78rem' }}
                                        >
                                            <option value="YES">YES</option>
                                            <option value="NO">NO</option>
                                        </select>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                    )}
                </section>
            ))}

            {/* Spreader Beam Test Records — with per-pick-point data */}
            {certLayout === 'spreader-beam' && formData.spreaderTests.slice(0, parseInt(formData.numTests)).map((test, index) => (
                <section className="form-section" key={`sb-${index}`} style={{ borderLeft: '4px solid var(--yellow-accent)' }}>
                    <div className="section-header-row">
                        <h3 style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: 0 }}>
                            Test Record #{index + 1}
                            <span style={{ fontSize: '0.7rem', background: 'var(--yellow-accent)', color: '#000', padding: '2px 8px', borderRadius: '4px', fontWeight: 700 }}>SPREADER BEAM</span>
                        </h3>
                        {parseInt(formData.numTests) > 1 && (
                            <button onClick={() => removeTestRecord(index)} className="job-remove-btn" title="Remove this test record">✕</button>
                        )}
                    </div>
                    <div className="form-row">
                        <div className="form-group">
                            <label>Load Type</label>
                            <select value={test.loadType} onChange={(e) => handleSpreaderTestInput(index, 'loadType', e.target.value)}>
                                <option value="Static">Static</option>
                                <option value="Dynamic">Dynamic</option>
                            </select>
                        </div>
                        <div className="form-group">
                            <label>% of WLL</label>
                            <input value={test.wllPercentage} onChange={(e) => handleSpreaderTestInput(index, 'wllPercentage', e.target.value)} placeholder="e.g. 100%" />
                        </div>
                        <div className="form-group">
                            <label>Pick Points</label>
                            <select value={test.numPickPoints ?? ''} onChange={(e) => handleSpreaderTestInput(index, 'numPickPoints', e.target.value === '' ? null : parseInt(e.target.value))}>
                                <option value="">Beam Default ({formData.numPickPoints})</option>
                                {[1, 2, 3, 4, 5, 6].map(n => (
                                    <option key={n} value={n}>{n} Pick Point{n > 1 ? 's' : ''}</option>
                                ))}
                            </select>
                        </div>
                        <div className="form-group">
                            <label>Starting At</label>
                            <select value={test.pickPointStart || 0} onChange={(e) => handleSpreaderTestInput(index, 'pickPointStart', parseInt(e.target.value))}>
                                {formData.pickPoints.slice(0, parseInt(formData.numPickPoints)).map((pp, i) => (
                                    <option key={i} value={i}>{pp.label || `PP ${i + 1}`}</option>
                                ))}
                            </select>
                        </div>
                        <div className="form-group">
                            <label>Local Time (hr:min)</label>
                            <input value={test.localTime || ''} onChange={(e) => handleSpreaderTestInput(index, 'localTime', e.target.value)} placeholder="00:00" />
                        </div>
                        <div className="form-group">
                            <label>Duration</label>
                            <input
                                list={`sb-duration-${index}`}
                                value={test.testDuration || ''}
                                onChange={(e) => handleSpreaderTestInput(index, 'testDuration', e.target.value)}
                                placeholder="Select or type..."
                            />
                            <datalist id={`sb-duration-${index}`}>
                                <option value="5 minutes" />
                                <option value="10 minutes" />
                                <option value="15 minutes" />
                            </datalist>
                        </div>
                        <div className="form-group">
                            <label>Overall Accept</label>
                            <select value={test.accept} onChange={(e) => handleSpreaderTestInput(index, 'accept', e.target.value)}>
                                <option value="YES">YES</option>
                                <option value="NO">NO</option>
                                <option value="N/A">N/A</option>
                            </select>
                        </div>
                        <div className="form-group" style={{ flex: 2 }}>
                            <label>Description</label>
                            <input value={test.itemDescription || ''} onChange={(e) => handleSpreaderTestInput(index, 'itemDescription', e.target.value)}
                                placeholder="e.g. Full span load test at 100% WLL..." />
                        </div>
                    </div>

                    {/* Per-pick-point measured forces */}
                    {(() => { const testPP = test.numPickPoints ?? parseInt(formData.numPickPoints); const ppStart = test.pickPointStart || 0; return (
                    <div style={{ marginTop: '12px', background: 'var(--bg-elevated)', padding: '14px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                        <div style={{ fontSize: '0.78rem', color: 'var(--yellow-accent)', fontWeight: 700, marginBottom: '10px' }}>MEASURED FORCE AT EACH PICK POINT ({testPP})</div>
                        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(testPP, 3)}, 1fr)`, gap: '10px' }}>
                            {test.pickPointData.slice(0, testPP).map((ppd, ppIdx) => (
                                <div key={ppIdx} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                    <label style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                                        {formData.pickPoints[ppStart + ppIdx]?.label || `Pick Point ${ppStart + ppIdx + 1}`}
                                        {formData.pickPoints[ppStart + ppIdx]?.position && <span style={{ opacity: 0.6 }}> ({formData.pickPoints[ppStart + ppIdx].position})</span>}
                                    </label>
                                    <div style={{ display: 'flex', gap: '6px' }}>
                                        <input
                                            value={ppd.measuredForce || ''}
                                            onChange={(e) => handleSpreaderPickPointData(index, ppIdx, 'measuredForce', e.target.value)}
                                            placeholder="lbs"
                                            style={{ flex: 1, fontSize: '0.85rem' }}
                                        />
                                        <select value={ppd.accept} onChange={(e) => handleSpreaderPickPointData(index, ppIdx, 'accept', e.target.value)}
                                            style={{ width: '65px', fontSize: '0.78rem' }}>
                                            <option value="YES">YES</option>
                                            <option value="NO">NO</option>
                                        </select>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                    ); })()}
                </section>
            ))}

            {/* Steel Weight Test Records */}
            {certLayout === 'steel-weight' && (formData.steelWeightTests || []).slice(0, parseInt(formData.numTests)).map((test, index) => (
                <section className="form-section" key={`sw-${index}`} style={{ borderLeft: '4px solid #6cb33a' }}>
                    <div className="section-header-row">
                        <h3 style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: 0 }}>
                            Test Record #{index + 1}
                            <span style={{ fontSize: '0.7rem', background: '#6cb33a', color: '#000', padding: '2px 8px', borderRadius: '4px', fontWeight: 700 }}>STEEL WEIGHT</span>
                        </h3>
                        {parseInt(formData.numTests) > 1 && (
                            <button onClick={() => removeTestRecord(index)} className="job-remove-btn" title="Remove this test record">✕</button>
                        )}
                    </div>
                    <div className="form-row">
                        <div className="form-group" style={{ flex: 2 }}>
                            <label>Equipment Tested</label>
                            <input
                                value={test.equipmentTested || ''}
                                onChange={(e) => handleSteelWeightTestInput(index, 'equipmentTested', e.target.value)}
                                placeholder="e.g. Crane #2, Padeye P-3, Boat A-frame..."
                            />
                        </div>
                        <div className="form-group">
                            <label>Load Type</label>
                            <select value={test.loadType} onChange={(e) => handleSteelWeightTestInput(index, 'loadType', e.target.value)}>
                                <option value="Static">Static</option>
                                <option value="Dynamic">Dynamic</option>
                            </select>
                        </div>
                        <div className="form-group">
                            <label>Accept</label>
                            <select value={test.accept} onChange={(e) => handleSteelWeightTestInput(index, 'accept', e.target.value)}>
                                <option value="YES">YES</option>
                                <option value="NO">NO</option>
                                <option value="N/A">N/A</option>
                            </select>
                        </div>
                    </div>
                    <div className="form-row">
                        <div className="form-group">
                            <label>SWL</label>
                            <input
                                value={test.swl || ''}
                                onChange={(e) => handleSteelWeightTestInput(index, 'swl', e.target.value)}
                                placeholder="e.g. 10,000 lbs"
                            />
                        </div>
                        <div className="form-group">
                            <label>Test Load (Steel Weight)</label>
                            <input
                                value={test.testLoad || ''}
                                onChange={(e) => handleSteelWeightTestInput(index, 'testLoad', e.target.value)}
                                placeholder="e.g. 12,500 lbs"
                            />
                        </div>
                        <div className="form-group">
                            <label>Local Time (hr:min)</label>
                            <input
                                value={test.localTime || ''}
                                onChange={(e) => handleSteelWeightTestInput(index, 'localTime', e.target.value)}
                                placeholder="00:00"
                            />
                        </div>
                        <div className="form-group">
                            <label>Test Duration</label>
                            <input
                                list={`sw-duration-${index}`}
                                value={test.testDuration || ''}
                                onChange={(e) => handleSteelWeightTestInput(index, 'testDuration', e.target.value)}
                                placeholder="Select or type..."
                            />
                            <datalist id={`sw-duration-${index}`}>
                                <option value="5 minutes" />
                                <option value="10 minutes" />
                                <option value="15 minutes" />
                            </datalist>
                        </div>
                    </div>
                    <div className="form-group">
                        <label>Test Description</label>
                        <textarea
                            value={test.description || ''}
                            onChange={(e) => handleSteelWeightTestInput(index, 'description', e.target.value)}
                            rows="2"
                            placeholder="Brief description of this test (e.g., 'Static hold of 10-min duration with calibrated steel weights at 125% SWL')"
                        />
                    </div>

                    {/* Optional Load Cell info */}
                    <div style={{ marginTop: '12px', background: 'var(--bg-elevated)', padding: '14px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.85rem', color: '#6cb33a', fontWeight: 700, marginBottom: test.useLoadCell ? '10px' : 0 }}>
                            <input
                                type="checkbox"
                                checked={!!test.useLoadCell}
                                onChange={(e) => handleSteelWeightTestInput(index, 'useLoadCell', e.target.checked)}
                                style={{ width: '16px', height: '16px' }}
                            />
                            LOAD CELL USED FOR THIS TEST
                        </label>
                        {test.useLoadCell && (
                            <div className="form-row">
                                <div className="form-group" style={{ flex: 1 }}>
                                    <label>Load Cell S/N</label>
                                    <input
                                        value={test.loadCellSerial || ''}
                                        onChange={(e) => handleSteelWeightTestInput(index, 'loadCellSerial', e.target.value)}
                                        placeholder="Serial number..."
                                    />
                                </div>
                                <div className="form-group" style={{ flex: 1 }}>
                                    <label>Load Cell Capacity</label>
                                    <input
                                        value={test.loadCellCapacity || ''}
                                        onChange={(e) => handleSteelWeightTestInput(index, 'loadCellCapacity', e.target.value)}
                                        placeholder="e.g. 25,000 lbs"
                                    />
                                </div>
                                <div className="form-group" style={{ flex: 1 }}>
                                    <label>Load Cell Reading</label>
                                    <input
                                        value={test.loadCellReading || ''}
                                        onChange={(e) => handleSteelWeightTestInput(index, 'loadCellReading', e.target.value)}
                                        placeholder="e.g. 12,480 lbs"
                                    />
                                </div>
                            </div>
                        )}
                    </div>
                </section>
            ))}

            {/* Gangway / Accommodation Ladder Test Records (Flow Meter) */}
            {certLayout === 'gangway' && (formData.gangwayTests || []).slice(0, parseInt(formData.numTests)).map((test, index) => {
                const before = parseFloat(test.flowMeterBefore);
                const atLoad = parseFloat(test.flowMeterAtLoad);
                const delta = (!isNaN(before) && !isNaN(atLoad)) ? (atLoad - before) : null;
                const dBefore = parseFloat(test.deflectionBefore);
                const dAfter = parseFloat(test.deflectionAfter);
                const dRecovered = parseFloat(test.deflectionRecovered);
                const deflectionDelta = (!isNaN(dBefore) && !isNaN(dAfter)) ? (dAfter - dBefore) : null;
                const permanentSet = (!isNaN(dBefore) && !isNaN(dRecovered)) ? (dRecovered - dBefore) : null;
                return (
                <section className="form-section" key={`gw-${index}`} style={{ borderLeft: '4px solid #2188ff' }}>
                    <div className="section-header-row">
                        <h3 style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: 0 }}>
                            Test Record #{index + 1}
                            <span style={{ fontSize: '0.7rem', background: '#2188ff', color: '#fff', padding: '2px 8px', borderRadius: '4px', fontWeight: 700 }}>GANGWAY (FLOW METER)</span>
                        </h3>
                        {parseInt(formData.numTests) > 1 && (
                            <button onClick={() => removeTestRecord(index)} className="job-remove-btn" title="Remove this test record">✕</button>
                        )}
                    </div>
                    <div className="form-row">
                        <div className="form-group" style={{ flex: 2 }}>
                            <label>Equipment Tested</label>
                            <input
                                value={test.equipmentTested || ''}
                                onChange={(e) => handleGangwayTestInput(index, 'equipmentTested', e.target.value)}
                                placeholder="e.g. Accommodation Ladder Port, Gangway #2..."
                            />
                        </div>
                        <div className="form-group">
                            <label>Load Type</label>
                            <select value={test.loadType} onChange={(e) => handleGangwayTestInput(index, 'loadType', e.target.value)}>
                                <option value="Static">Static</option>
                                <option value="Dynamic">Dynamic</option>
                            </select>
                        </div>
                        <div className="form-group">
                            <label>Accept</label>
                            <select value={test.accept} onChange={(e) => handleGangwayTestInput(index, 'accept', e.target.value)}>
                                <option value="YES">YES</option>
                                <option value="NO">NO</option>
                                <option value="N/A">N/A</option>
                            </select>
                        </div>
                    </div>
                    <div className="form-row">
                        <div className="form-group">
                            <label>SWL</label>
                            <input
                                value={test.swl || ''}
                                onChange={(e) => handleGangwayTestInput(index, 'swl', e.target.value)}
                                placeholder="e.g. 500 lbs"
                            />
                        </div>
                        <div className="form-group">
                            <label>Test Load</label>
                            <input
                                value={test.testLoad || ''}
                                onChange={(e) => handleGangwayTestInput(index, 'testLoad', e.target.value)}
                                placeholder="e.g. 625 lbs (125% SWL)"
                            />
                        </div>
                        <div className="form-group">
                            <label>Local Time (hr:min)</label>
                            <input
                                value={test.localTime || ''}
                                onChange={(e) => handleGangwayTestInput(index, 'localTime', e.target.value)}
                                placeholder="00:00"
                            />
                        </div>
                        <div className="form-group">
                            <label>Test Duration</label>
                            <input
                                list={`gw-duration-${index}`}
                                value={test.testDuration || ''}
                                onChange={(e) => handleGangwayTestInput(index, 'testDuration', e.target.value)}
                                placeholder="Select or type..."
                            />
                            <datalist id={`gw-duration-${index}`}>
                                <option value="5 minutes" />
                                <option value="10 minutes" />
                                <option value="15 minutes" />
                            </datalist>
                        </div>
                    </div>

                    {/* Flow Meter readings */}
                    <div style={{ marginTop: '12px', background: 'var(--bg-elevated)', padding: '14px', borderRadius: 'var(--radius-sm)', border: '1px solid #2188ff' }}>
                        <div style={{ fontSize: '0.85rem', color: '#2188ff', fontWeight: 700, marginBottom: '10px' }}>FLOW METER READINGS</div>
                        <div className="form-row">
                            <div className="form-group" style={{ flex: 1 }}>
                                <label>Before Test Reading</label>
                                <input
                                    type="number"
                                    step="0.01"
                                    value={test.flowMeterBefore || ''}
                                    onChange={(e) => handleGangwayTestInput(index, 'flowMeterBefore', e.target.value)}
                                    placeholder="Baseline reading"
                                />
                            </div>
                            <div className="form-group" style={{ flex: 1 }}>
                                <label>Test Load Reading</label>
                                <input
                                    type="number"
                                    step="0.01"
                                    value={test.flowMeterAtLoad || ''}
                                    onChange={(e) => handleGangwayTestInput(index, 'flowMeterAtLoad', e.target.value)}
                                    placeholder="Reading at test load"
                                />
                            </div>
                            <div className="form-group" style={{ flex: 1 }}>
                                <label>Units</label>
                                <input
                                    list={`gw-units-${index}`}
                                    value={test.flowMeterUnits || 'gal'}
                                    onChange={(e) => handleGangwayTestInput(index, 'flowMeterUnits', e.target.value)}
                                    placeholder="gal"
                                />
                                <datalist id={`gw-units-${index}`}>
                                    <option value="gal" />
                                    <option value="L" />
                                    <option value="m³" />
                                    <option value="ft³" />
                                </datalist>
                            </div>
                            <div className="form-group" style={{ flex: 1 }}>
                                <label>Delta (Test − Before)</label>
                                <input
                                    value={delta !== null ? `${delta.toFixed(2)} ${test.flowMeterUnits || ''}` : '--'}
                                    readOnly
                                    style={{ background: 'var(--bg-card)', color: 'var(--yellow-accent)', fontWeight: 700 }}
                                />
                            </div>
                        </div>
                    </div>

                    {/* Deflection readings */}
                    <div style={{ marginTop: '12px', background: 'var(--bg-elevated)', padding: '14px', borderRadius: 'var(--radius-sm)', border: '1px solid #2188ff' }}>
                        <div style={{ fontSize: '0.85rem', color: '#2188ff', fontWeight: 700, marginBottom: '10px' }}>DEFLECTION MEASUREMENTS</div>
                        <div className="form-row">
                            <div className="form-group" style={{ flex: 1 }}>
                                <label>Before Load</label>
                                <input
                                    type="number"
                                    step="0.001"
                                    value={test.deflectionBefore || ''}
                                    onChange={(e) => handleGangwayTestInput(index, 'deflectionBefore', e.target.value)}
                                    placeholder="Baseline"
                                />
                            </div>
                            <div className="form-group" style={{ flex: 1 }}>
                                <label>Under Load</label>
                                <input
                                    type="number"
                                    step="0.001"
                                    value={test.deflectionAfter || ''}
                                    onChange={(e) => handleGangwayTestInput(index, 'deflectionAfter', e.target.value)}
                                    placeholder="At test load"
                                />
                            </div>
                            <div className="form-group" style={{ flex: 1 }}>
                                <label>Recovered</label>
                                <input
                                    type="number"
                                    step="0.001"
                                    value={test.deflectionRecovered || ''}
                                    onChange={(e) => handleGangwayTestInput(index, 'deflectionRecovered', e.target.value)}
                                    placeholder="After load removed"
                                />
                            </div>
                            <div className="form-group" style={{ flex: 1 }}>
                                <label>Units</label>
                                <input
                                    list={`gw-defl-units-${index}`}
                                    value={test.deflectionUnits || 'in'}
                                    onChange={(e) => handleGangwayTestInput(index, 'deflectionUnits', e.target.value)}
                                    placeholder="in"
                                />
                                <datalist id={`gw-defl-units-${index}`}>
                                    <option value="in" />
                                    <option value="mm" />
                                    <option value="cm" />
                                    <option value="ft" />
                                </datalist>
                            </div>
                        </div>
                        <div className="form-row">
                            <div className="form-group" style={{ flex: 1 }}>
                                <label>Deflection (Under Load − Before)</label>
                                <input
                                    value={deflectionDelta !== null ? `${deflectionDelta.toFixed(3)} ${test.deflectionUnits || ''}` : '--'}
                                    readOnly
                                    style={{ background: 'var(--bg-card)', color: 'var(--yellow-accent)', fontWeight: 700 }}
                                />
                            </div>
                            <div className="form-group" style={{ flex: 1 }}>
                                <label>Permanent Set (Recovered − Before)</label>
                                <input
                                    value={permanentSet !== null ? `${permanentSet.toFixed(3)} ${test.deflectionUnits || ''}` : '--'}
                                    readOnly
                                    style={{ background: 'var(--bg-card)', color: permanentSet !== null && Math.abs(permanentSet) > 0.001 ? '#ff7b7b' : 'var(--yellow-accent)', fontWeight: 700 }}
                                />
                            </div>
                        </div>
                    </div>

                    <div className="form-group" style={{ marginTop: '12px' }}>
                        <label>Test Description</label>
                        <textarea
                            value={test.description || ''}
                            onChange={(e) => handleGangwayTestInput(index, 'description', e.target.value)}
                            rows="2"
                            placeholder="Brief description of this test (e.g., 'Static hold of 10-min duration with water bag at 125% SWL, flow meter measuring water displacement')"
                        />
                    </div>
                </section>
                );
            })}

            {/* Dynamic Test Records */}
            {certLayout === 'dynamic' && testSchema && (formData.dynamicTests || []).slice(0, parseInt(formData.numTests)).map((test, index) => {
                const titleCol = (testSchema.columns || []).find(c => c.role === 'title');
                const subtitleCol = (testSchema.columns || []).find(c => c.role === 'subtitle');
                const fieldCols = (testSchema.columns || []).filter(c => c.role !== 'title' && c.role !== 'subtitle');
                const selectCols = fieldCols.filter(c => c.type === 'select');
                const textCols = fieldCols.filter(c => c.type !== 'select' && c.type !== 'textarea');
                const textareaCols = fieldCols.filter(c => c.type === 'textarea');
                return (
                <section className="form-section" key={`dyn-${index}`} style={{ borderLeft: '4px solid #8957e5' }}>
                    <div className="section-header-row">
                        <h3 style={{ display: 'flex', alignItems: 'center', gap: '10px', margin: 0 }}>
                            Test Record #{index + 1}
                            <span style={{ fontSize: '0.7rem', background: '#8957e5', color: '#fff', padding: '2px 8px', borderRadius: '4px', fontWeight: 700 }}>{testSchema.testType || 'DYNAMIC'}</span>
                        </h3>
                        {parseInt(formData.numTests) > 1 && (
                            <button onClick={() => removeTestRecord(index)} className="job-remove-btn" title="Remove this test record">✕</button>
                        )}
                    </div>
                    {titleCol && (
                        <div className="form-row">
                            <div className="form-group" style={{ flex: 2 }}>
                                <label>{titleCol.label}</label>
                                <input
                                    value={test[titleCol.key] || ''}
                                    onChange={(e) => handleDynamicTestInput(index, titleCol.key, e.target.value)}
                                    placeholder={titleCol.label + '...'}
                                />
                            </div>
                            {selectCols.slice(0, 2).map(col => (
                                <div className="form-group" key={col.key}>
                                    <label>{col.label}</label>
                                    <select value={test[col.key] || col.options?.[0] || ''} onChange={(e) => handleDynamicTestInput(index, col.key, e.target.value)}>
                                        {(col.options || []).map(opt => <option key={opt} value={opt}>{opt}</option>)}
                                    </select>
                                </div>
                            ))}
                        </div>
                    )}
                    <div className="form-row">
                        {textCols.map(col => (
                            <div className="form-group" key={col.key}>
                                <label>{col.label}</label>
                                <input
                                    type={col.type === 'number' ? 'number' : 'text'}
                                    value={test[col.key] || ''}
                                    onChange={(e) => handleDynamicTestInput(index, col.key, e.target.value)}
                                    placeholder={col.label + '...'}
                                />
                            </div>
                        ))}
                        {selectCols.slice(2).map(col => (
                            <div className="form-group" key={col.key}>
                                <label>{col.label}</label>
                                <select value={test[col.key] || col.options?.[0] || ''} onChange={(e) => handleDynamicTestInput(index, col.key, e.target.value)}>
                                    {(col.options || []).map(opt => <option key={opt} value={opt}>{opt}</option>)}
                                </select>
                            </div>
                        ))}
                    </div>
                    {textareaCols.map(col => (
                        <div className="form-group" key={col.key} style={col !== textareaCols[0] ? { marginTop: '8px' } : undefined}>
                            <label>{col.label}</label>
                            <textarea
                                value={test[col.key] || ''}
                                onChange={(e) => handleDynamicTestInput(index, col.key, e.target.value)}
                                rows="2"
                                placeholder={col.label + '...'}
                            />
                        </div>
                    ))}
                    {subtitleCol && !textareaCols.find(c => c.key === subtitleCol.key) && (
                        <div className="form-group">
                            <label>{subtitleCol.label}</label>
                            <textarea
                                value={test[subtitleCol.key] || ''}
                                onChange={(e) => handleDynamicTestInput(index, subtitleCol.key, e.target.value)}
                                rows="2"
                                placeholder={subtitleCol.label + '...'}
                            />
                        </div>
                    )}
                    {(testSchema.groups || []).map(group => (
                        <div key={group.key} style={{ marginTop: '12px', background: 'var(--bg-elevated)', padding: '14px', borderRadius: 'var(--radius-sm)', border: `1px solid ${group.color || 'var(--border)'}` }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer', fontSize: '0.85rem', color: group.color || 'var(--accent)', fontWeight: 700, marginBottom: test[group.toggleKey] ? '10px' : 0 }}>
                                <input
                                    type="checkbox"
                                    checked={!!test[group.toggleKey]}
                                    onChange={(e) => handleDynamicTestInput(index, group.toggleKey, e.target.checked)}
                                    style={{ width: '16px', height: '16px' }}
                                />
                                {group.toggleLabel || group.label}
                            </label>
                            {test[group.toggleKey] && (
                                <div className="form-row">
                                    {(group.fields || []).map(field => (
                                        <div className="form-group" key={field.key} style={{ flex: 1 }}>
                                            <label>{field.label}</label>
                                            <input
                                                type={field.type === 'number' ? 'number' : 'text'}
                                                value={test[field.key] || ''}
                                                onChange={(e) => handleDynamicTestInput(index, field.key, e.target.value)}
                                                placeholder={field.label + '...'}
                                            />
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    ))}
                </section>
                );
            })}

            <div className="form-actions mt-4" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '20px', padding: '40px 0', borderTop: '1px solid var(--border)', flexWrap: 'wrap' }}>
                <button
                    onClick={addTestRecord}
                    className="action-btn secondary"
                    style={{ height: '60px', fontSize: '1.05rem', padding: '0 28px' }}
                    title="Append a new blank test record"
                >
                    + Add Test Record
                </button>
                <button onClick={showPreview} className="action-btn large" style={{ width: '500px', height: '60px', fontSize: '1.2rem' }}>
                    👁️ Preview Full Certificate
                </button>
            </div>

            {showAiPrompt && (
                <div className="modal-overlay" onClick={dismissAiPrompt}>
                    <div className="job-prompt-card" style={{ maxWidth: '440px', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                        <div style={{ fontSize: '2.4rem', marginBottom: '8px' }}>🤖</div>
                        <h3 style={{ marginBottom: '6px' }}>Generate Certificate with AI?</h3>
                        <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '18px' }}>
                            Want OSCAR to help build this certificate? Describe the load test and AI
                            will fill in the template &mdash; equipment, tests, standards, and more.
                            You can edit everything afterward.
                        </p>
                        <div className="form-actions" style={{ justifyContent: 'center' }}>
                            <button onClick={acceptAiPrompt} className="action-btn">🤖 Yes, use AI</button>
                            <button onClick={dismissAiPrompt} className="action-btn secondary ml-4">No, I'll fill it in</button>
                        </div>
                    </div>
                </div>
            )}

            {showAiGenerator && (
                <div className="modal-overlay" onClick={() => !aiLoading && setShowAiGenerator(false)}>
                    <div className="wizard-card" style={{ maxWidth: '700px', width: '90%', maxHeight: '85vh', display: 'flex', flexDirection: 'column', overflow: 'visible' }} onClick={e => e.stopPropagation()}>
                        <div className="wizard-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <h3>AI Certificate Generator</h3>
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                {aiMessages.length > 0 && (
                                    <button
                                        onClick={() => { setAiMessages([]); setAiError(''); }}
                                        className="action-btn secondary small"
                                        disabled={aiLoading}
                                        style={{ fontSize: '0.75rem', padding: '3px 10px' }}
                                    >
                                        New Chat
                                    </button>
                                )}
                                <button onClick={() => !aiLoading && setShowAiGenerator(false)} className="close-btn">&times;</button>
                            </div>
                        </div>
                        <div className="wizard-body" style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                            {aiMessages.length === 0 && (
                                <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)', marginBottom: '12px' }}>
                                    Describe the load test you need to perform. Include equipment, load ratings, number of tests, standards, and any special procedures. OSCAR will generate a matching certificate template. You can send follow-up messages to refine it.
                                </p>
                            )}

                            {aiMessages.length > 0 && (
                                <div style={{
                                    flex: 1,
                                    overflowY: 'auto',
                                    marginBottom: '12px',
                                    padding: '8px',
                                    background: 'rgba(0,0,0,0.2)',
                                    borderRadius: '6px',
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: '8px',
                                    minHeight: '120px',
                                    maxHeight: '340px'
                                }}>
                                    {aiMessages.map((msg, i) => (
                                        <div key={i} style={{
                                            alignSelf: msg.role === 'user' ? 'flex-end' : 'flex-start',
                                            maxWidth: '85%',
                                            padding: '8px 12px',
                                            borderRadius: msg.role === 'user' ? '12px 12px 2px 12px' : '12px 12px 12px 2px',
                                            background: msg.role === 'user' ? 'var(--accent)' : 'rgba(255,255,255,0.08)',
                                            color: 'var(--text-primary)',
                                            fontSize: '0.85rem',
                                            lineHeight: '1.4',
                                            whiteSpace: 'pre-wrap'
                                        }}>
                                            {msg.content}
                                        </div>
                                    ))}
                                    {aiLoading && (
                                        <div style={{
                                            alignSelf: 'flex-start',
                                            padding: '8px 12px',
                                            borderRadius: '12px 12px 12px 2px',
                                            background: 'rgba(255,255,255,0.08)',
                                            fontSize: '0.85rem',
                                            color: 'var(--text-secondary)'
                                        }}>
                                            Generating...
                                        </div>
                                    )}
                                    <div ref={aiChatEndRef} />
                                </div>
                            )}

                            <textarea
                                value={aiDescription}
                                onChange={(e) => setAiDescription(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && !e.shiftKey && aiDescription.trim() && !aiLoading) {
                                        e.preventDefault();
                                        handleAiGenerate();
                                    }
                                }}
                                placeholder={aiMessages.length === 0
                                    ? "e.g. We're testing a 50-ton pedestal crane with two hooks (main 40T, aux 10T) per API 2C. Need proof load at 125% SWL for both hooks, plus a boom functional test. Customer is Gulf Offshore Services at their Galveston yard."
                                    : "e.g. Add a winch functional test at 7,500 lbs..."
                                }
                                style={{
                                    width: '100%',
                                    minHeight: aiMessages.length > 0 ? '60px' : '140px',
                                    resize: 'vertical',
                                    fontSize: '0.95rem',
                                    background: 'var(--bg-dark)',
                                    color: 'var(--text-primary)',
                                    border: '1px solid var(--border)',
                                    borderRadius: '6px',
                                    padding: '12px',
                                    fontFamily: 'inherit'
                                }}
                                disabled={aiLoading}
                                autoFocus
                            />
                            {aiError && (
                                <p style={{ color: '#ff6b6b', fontSize: '0.85rem', marginTop: '8px' }}>{aiError}</p>
                            )}
                            <div className="wizard-actions" style={{ marginTop: '12px' }}>
                                <button
                                    className="action-btn secondary"
                                    onClick={() => { setShowAiGenerator(false); setAiError(''); }}
                                    disabled={aiLoading}
                                >
                                    {aiMessages.length > 0 ? 'Done' : 'Cancel'}
                                </button>
                                {aiMessages.length === 0 && (
                                    <button
                                        className="action-btn"
                                        onClick={handleAiQuickGenerate}
                                        disabled={aiLoading || !aiDescription.trim()}
                                        style={{ background: '#2d6a4f' }}
                                        title="Generate immediately without asking questions"
                                    >
                                        ⚡ Quick Generate
                                    </button>
                                )}
                                <button
                                    className="action-btn"
                                    onClick={handleAiGenerate}
                                    disabled={aiLoading || !aiDescription.trim()}
                                >
                                    {aiLoading ? '🔄 Generating...' : aiMessages.length > 0 ? 'Send' : '🤖 Generate Template'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default CertificateView;
