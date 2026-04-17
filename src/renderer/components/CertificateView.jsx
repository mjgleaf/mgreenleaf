import { useState, useEffect, useMemo, useRef } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import processChartData from '../utils/processChartData';
import { getElectronAPI } from '../utils/electronAPI';
import { SignaturePad } from './CustomerView';
import StandardFinder from './StandardFinder';
import logo from '../logo.png';

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
        <ResponsiveContainer width="100%" height={280} minWidth={0}>
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
            pickPointData: Array(6).fill(null).map(() => ({
                measuredForce: '',
                accept: 'YES'
            }))
        }))
    });

    const [isPreview, setIsPreview] = useState(false);
    const [showAiWizard, setShowAiWizard] = useState(false);
    const [certLayout, setCertLayout] = useState('crane-hook');
    const [showSignaturePad, setShowSignaturePad] = useState(false);
    const [customerSignature, setCustomerSignature] = useState(null);
    const [certRegistry, setCertRegistry] = useState([]);

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
                        // Also auto-fill hookData[0] for the first test
                        if (updatedTests[0].hookData && !updatedTests[0].hookData[0]?.measuredForce) {
                            const newHookData = [...updatedTests[0].hookData];
                            newHookData[0] = { ...newHookData[0], measuredForce: stats.maxWeight.toFixed(0) };
                            updatedTests[0] = { ...updatedTests[0], hookData: newHookData };
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
        await getElectronAPI().savePDF(`Certificate_${formData.certNo || 'Draft'}`);
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
                        <button onClick={() => setShowSignaturePad(true)} className="action-btn secondary">
                            ✍️ {customerSignature ? 'Re-sign' : 'Customer Signature'}
                        </button>
                        <button onClick={finalizePDF} className="action-btn" style={{ background: '#1a3a6c' }}>
                            💾 Finalize & Save PDF
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
                                        </div>
                                    );
                                    break;
                                case 'testTable':
                                    if (certLayout === 'spreader-beam') {
                                        const numPP = parseInt(formData.numPickPoints) || 2;
                                        content = (
                                            <table className="cert-table">
                                                <thead>
                                                    <tr>
                                                        <th style={{ width: '35px' }}>Item</th>
                                                        <th>Description</th>
                                                        <th style={{ width: '65px' }}>Time</th>
                                                        <th style={{ width: '65px' }}>Dur.</th>
                                                        {formData.pickPoints.slice(0, numPP).map((pp, i) => (
                                                            <th key={i} style={{ width: '85px', fontSize: '0.65rem' }}>{pp.label || `PP ${i+1}`}</th>
                                                        ))}
                                                        <th style={{ width: '50px' }}>Accept</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    <tr>
                                                        <td></td>
                                                        <td className="text-left" colSpan={3 + numPP} style={{ paddingBottom: '8px' }}>
                                                            <div style={{ display: 'flex', flexWrap: 'wrap', columnGap: '15px', rowGap: '2px', marginBottom: '4px', fontSize: '0.75rem' }}>
                                                                <div><strong style={{ color: '#555' }}>Beam Manufacturer:</strong> {formData.beamManufacturer || formData.equipmentManufacturer || 'N/A'}</div>
                                                                <div><strong style={{ color: '#555' }}>Beam S/N:</strong> {formData.beamSerial || formData.equipmentSerial || 'N/A'}</div>
                                                                <div><strong style={{ color: '#555' }}>Beam Length:</strong> {formData.beamLength || 'N/A'}</div>
                                                                <div><strong style={{ color: '#555' }}>Beam WLL:</strong> {formData.beamWll || formData.equipmentWll || 'N/A'}</div>
                                                                <div><strong style={{ color: '#555' }}>Target Test Load:</strong> {formData.targetLoad || 'N/A'}</div>
                                                            </div>
                                                            <div style={{ marginBottom: '2px', fontSize: '0.7rem' }}>
                                                                <strong>Pick Points:</strong>{' '}
                                                                {formData.pickPoints.slice(0, numPP).map((pp, i) => (
                                                                    <span key={i}>{pp.label}{pp.position ? ` (${pp.position})` : ''}{i < numPP - 1 ? ' | ' : ''}</span>
                                                                ))}
                                                            </div>
                                                            <div style={{ marginBottom: '4px', fontSize: '0.75rem' }}><strong>Reference Standards:</strong> {formData.referenceStandards}</div>
                                                            <div style={{ marginTop: '4px', fontSize: '0.75rem' }}>
                                                                <strong>Procedure Summary:</strong><br />
                                                                <div style={{ fontSize: '0.62rem', fontStyle: 'italic', lineHeight: '1.2', marginTop: '2px' }}>
                                                                    {formData.procedureSummary}
                                                                </div>
                                                            </div>
                                                        </td>
                                                    </tr>
                                                    {formData.spreaderTests
                                                        .slice(0, parseInt(formData.numTests))
                                                        .map((test, index) => (
                                                            <tr key={index}>
                                                                <td style={{ verticalAlign: 'top', paddingTop: '8px' }}>{index + 1}</td>
                                                                <td className="text-left" style={{ paddingTop: '8px', paddingBottom: '8px' }}>
                                                                    <div className="font-bold" style={{ fontSize: '0.9rem', color: '#1a3a6c', borderBottom: '1px solid #1a3a6c', paddingBottom: '1px', marginBottom: '4px' }}>
                                                                        {test.itemDescription || formData.equipmentTested || 'Spreader Beam Load Test'}
                                                                    </div>
                                                                    <div style={{ fontSize: '0.75rem', marginTop: '2px' }}>
                                                                        <strong>Type:</strong> {test.loadType} | <strong>TEST LOAD:</strong> {test.wllPercentage || '100%'} WLL
                                                                    </div>
                                                                </td>
                                                                <td style={{ verticalAlign: 'middle', paddingTop: '8px', fontSize: '0.8rem' }}>{test.localTime}</td>
                                                                <td style={{ verticalAlign: 'middle', paddingTop: '8px', fontSize: '0.8rem' }}>{test.testDuration}</td>
                                                                {test.pickPointData.slice(0, numPP).map((ppd, ppIdx) => (
                                                                    <td key={ppIdx} className="force-val" style={{ fontSize: '0.85rem', verticalAlign: 'middle', paddingTop: '8px' }}>
                                                                        {ppd.measuredForce ? `${ppd.measuredForce} lbs` : '--'}
                                                                    </td>
                                                                ))}
                                                                <td className="accept-val" style={{ color: test.accept === 'YES' ? '#006600' : '#cc0000', verticalAlign: 'middle', paddingTop: '8px' }}>{test.accept}</td>
                                                            </tr>
                                                        ))}
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
                                                        <td colSpan={4 + (formData.hooks || []).length + 2} className="text-left" style={{ paddingBottom: '8px' }}>
                                                            <div style={{ display: 'flex', flexWrap: 'wrap', columnGap: '15px', rowGap: '2px', marginBottom: '4px', fontSize: '0.75rem' }}>
                                                                <div><strong style={{ color: '#555' }}>Crane Manufacturer:</strong> {formData.equipmentManufacturer || 'N/A'}</div>
                                                                <div><strong style={{ color: '#555' }}>Crane S/N:</strong> {formData.equipmentSerial || 'N/A'}</div>
                                                                <div><strong style={{ color: '#555' }}>Crane WLL:</strong> {formData.equipmentWll || 'N/A'}</div>
                                                                <div><strong style={{ color: '#555' }}>Target Test Load:</strong> {formData.targetLoad || 'N/A'}</div>
                                                            </div>
                                                            <div style={{ marginBottom: '4px', marginTop: '4px', fontSize: '0.75rem' }}><strong>Reference Standards:</strong> {formData.referenceStandards}</div>
                                                            <div style={{ marginTop: '4px', fontSize: '0.75rem' }}>
                                                                <strong>Procedure Summary:</strong><br />
                                                                <div style={{ fontSize: '0.62rem', fontStyle: 'italic', lineHeight: '1.2', marginTop: '2px' }}>
                                                                    {formData.procedureSummary}
                                                                </div>
                                                            </div>
                                                        </td>
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
                                                                        <strong>Type:</strong> {test.loadType} | <strong>TEST LOAD:</strong> {test.wllPercentage || '100%'} WLL
                                                                    </div>
                                                                </td>
                                                                <td style={{ verticalAlign: 'middle', paddingTop: '8px' }}>{test.localTime}</td>
                                                                <td style={{ verticalAlign: 'middle', paddingTop: '8px' }}>{test.testDuration}</td>
                                                                {(formData.hooks || []).map((hook, hIdx) => {
                                                                    const force = test.hookData && test.hookData[hIdx]?.measuredForce;
                                                                    return (
                                                                        <td key={hIdx} className="force-val" style={{ fontSize: '0.85rem', verticalAlign: 'middle', paddingTop: '8px' }}>
                                                                            {force && String(force).trim() ? `${force} lbs` : '--'}
                                                                        </td>
                                                                    );
                                                                })}
                                                                <td className="force-val" style={{ fontSize: '0.85rem', fontWeight: 700, verticalAlign: 'middle', paddingTop: '8px' }}>
                                                                    {(() => {
                                                                        const total = (formData.hooks || []).reduce((sum, _, hIdx) => {
                                                                            const raw = test.hookData && test.hookData[hIdx]?.measuredForce;
                                                                            const val = parseFloat(String(raw || '').replace(/,/g, ''));
                                                                            return sum + (isNaN(val) ? 0 : val);
                                                                        }, 0);
                                                                        return total > 0 ? `${total.toLocaleString()} lbs` : '--';
                                                                    })()}
                                                                </td>
                                                                <td className="accept-val" style={{ color: test.accept === 'YES' ? '#006600' : '#cc0000', verticalAlign: 'middle', paddingTop: '8px' }}>{test.accept}</td>
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
                                                            <CertChart
                                                                stats={stats}
                                                                yAxisLabel={dataSets[idx]?.yAxisLabel || 'Weight (lbs)'}
                                                                xAxisLabel="Elapsed Time (min)"
                                                                isPrint={true}
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
                    <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginTop: '8px' }}>
                        <select
                            value={certLayout}
                            onChange={(e) => setCertLayout(e.target.value)}
                            className="control-select"
                            style={{ fontSize: '0.9rem', padding: '6px 12px', minWidth: '220px' }}
                        >
                            <option value="crane-hook">Standard Crane Hook</option>
                            <option value="spreader-beam">Spreader Beam</option>
                        </select>
                        <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-secondary)' }}>
                            Job: <strong style={{ color: 'white' }}>{job?.metadata?.jobNumber || 'N/A'}</strong>
                            <span style={{ marginLeft: '10px', fontSize: '0.7rem', opacity: 0.6 }}>ID: {jobId}</span>
                            <span style={{ marginLeft: '10px', padding: '2px 6px', background: 'var(--accent)', borderRadius: '4px', fontSize: '0.7rem' }}>
                                {job?.metadata?.drafts?.length || 0} Drafts
                            </span>
                        </p>
                    </div>
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

            {/* Crane Hook Test Records */}
            {certLayout === 'crane-hook' && formData.tests.slice(0, parseInt(formData.numTests)).map((test, index) => (
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
                    <h3 style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        Test Record #{index + 1}
                        <span style={{ fontSize: '0.7rem', background: 'var(--yellow-accent)', color: '#000', padding: '2px 8px', borderRadius: '4px', fontWeight: 700 }}>SPREADER BEAM</span>
                    </h3>
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
                    <div style={{ marginTop: '12px', background: 'var(--bg-elevated)', padding: '14px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                        <div style={{ fontSize: '0.78rem', color: 'var(--yellow-accent)', fontWeight: 700, marginBottom: '10px' }}>MEASURED FORCE AT EACH PICK POINT</div>
                        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${Math.min(parseInt(formData.numPickPoints), 3)}, 1fr)`, gap: '10px' }}>
                            {test.pickPointData.slice(0, parseInt(formData.numPickPoints)).map((ppd, ppIdx) => (
                                <div key={ppIdx} style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                    <label style={{ fontSize: '0.72rem', color: 'var(--text-secondary)' }}>
                                        {formData.pickPoints[ppIdx]?.label || `Pick Point ${ppIdx + 1}`}
                                        {formData.pickPoints[ppIdx]?.position && <span style={{ opacity: 0.6 }}> ({formData.pickPoints[ppIdx].position})</span>}
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

export default CertificateView;
