import { useState, useEffect, useMemo, useRef } from 'react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import processChartData from '../utils/processChartData';
import { getElectronAPI } from '../utils/electronAPI';
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
    const [certLayout, setCertLayout] = useState('crane-hook');

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
            const saved = await getElectronAPI().loadData('cert-info.json');

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
        getElectronAPI().saveData(newFormData, 'cert-info.json');
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

    const handleInput = (e) => {
        const { name, value } = e.target;
        const newFormData = { ...formData, [name]: value };
        setFormData(newFormData);
        getElectronAPI().saveData(newFormData, 'cert-info.json');
    };

    const handleTestInput = (index, name, value) => {
        const newTests = [...formData.tests];
        newTests[index] = { ...newTests[index], [name]: value };
        const newFormData = { ...formData, tests: newTests };
        setFormData(newFormData);
        getElectronAPI().saveData(newFormData, 'cert-info.json');
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
            getElectronAPI().saveData(newFormData, 'cert-info.json');
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
            getElectronAPI().saveData(newFormData, 'cert-info.json');
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
                                                            <div><strong style={{ color: '#555' }}>Target Test Load:</strong> {formData.targetLoad || 'N/A'}</div>
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
                            <option value="rigging" disabled>Rigging & Spreader Bar (Coming Soon)</option>
                            <option value="vessel" disabled>Pressure Vessel (Coming Soon)</option>
                            <option value="custom" disabled>Custom Template (Coming Soon)</option>
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
                        <div className="form-group">
                            <label>Target Test Load</label>
                            <input name="targetLoad" value={formData.targetLoad} onChange={handleInput} placeholder="e.g. 50 Tons" />
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

export default CertificateView;
