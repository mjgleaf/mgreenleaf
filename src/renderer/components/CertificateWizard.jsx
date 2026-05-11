import { useState } from 'react';

const LAYOUT_OPTIONS = [
    { value: 'crane-hook', label: 'Standard Crane Hook' },
    { value: 'spreader-beam', label: 'Spreader Beam' },
    { value: 'steel-weight', label: 'Steel Weight Test' },
    { value: 'gangway-ladder', label: 'Gangway / Accommodation Ladder' }
];

const INSTRUMENT_OPTIONS = [
    { value: 'load-cell', label: 'Load Cell' },
    { value: 'flow-meter', label: 'Flow Meter' },
    { value: 'none', label: 'N/A' }
];

const instrumentLabel = (v) => INSTRUMENT_OPTIONS.find(o => o.value === v)?.label || 'N/A';

const blankTest = () => ({
    equipment: '',
    instrument: 'none',
    testType: 'static'
});

const TOTAL_STEPS = 4;

function CertificateWizard({ onComplete, onClose }) {
    const [step, setStep] = useState(1);
    const [layout, setLayout] = useState('crane-hook');
    const [numTests, setNumTests] = useState(1);
    const [tests, setTests] = useState([blankTest()]);

    const resizeTests = (n) => {
        const clamped = Math.max(1, Math.min(20, parseInt(n) || 1));
        setNumTests(clamped);
        setTests(prev => {
            const next = prev.slice(0, clamped);
            while (next.length < clamped) next.push(blankTest());
            return next;
        });
    };

    const updateTest = (idx, patch) => {
        setTests(prev => prev.map((t, i) => i === idx ? { ...t, ...patch } : t));
    };

    const allEquipmentFilled = tests.every(t => t.equipment.trim().length > 0);

    const handleApply = () => {
        onComplete({ layout, numTests, tests });
    };

    const goNext = () => setStep(s => s + 1);
    const goBack = () => setStep(s => Math.max(1, s - 1));

    return (
        <div className="modal-overlay">
            <div className="wizard-card" style={{ maxWidth: '720px', width: '90%' }}>
                <div className="wizard-header">
                    <h3>New Certificate Wizard — Step {step} of {TOTAL_STEPS}</h3>
                    <button onClick={onClose} className="close-btn">&times;</button>
                </div>

                <div className="wizard-body">
                    {step === 1 && (
                        <div className="wizard-step">
                            <h4>Step 1: Certificate Layout</h4>
                            <label>Which layout fits this load test?</label>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '10px' }}>
                                {LAYOUT_OPTIONS.map(opt => (
                                    <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px', border: `1px solid ${layout === opt.value ? 'var(--yellow-accent)' : 'rgba(255,255,255,0.1)'}`, borderRadius: '6px', cursor: 'pointer', background: layout === opt.value ? 'rgba(255,255,255,0.05)' : 'transparent' }}>
                                        <input type="radio" name="layout" value={opt.value} checked={layout === opt.value} onChange={() => setLayout(opt.value)} />
                                        <span>{opt.label}</span>
                                    </label>
                                ))}
                            </div>
                            <div className="wizard-actions">
                                <button className="action-btn secondary" onClick={onClose}>Cancel</button>
                                <button className="action-btn" onClick={goNext}>Next</button>
                            </div>
                        </div>
                    )}

                    {step === 2 && (
                        <div className="wizard-step">
                            <h4>Step 2: Number of Tests</h4>
                            <label>How many tests are in this certificate?</label>
                            <input
                                type="number"
                                min="1"
                                max="20"
                                value={numTests}
                                onChange={(e) => resizeTests(e.target.value)}
                                style={{ width: '120px', padding: '8px', fontSize: '1.1rem', marginTop: '8px' }}
                            />
                            <p style={{ fontSize: '0.85rem', opacity: 0.7, marginTop: '8px' }}>The wizard will ask the same questions for each test on the next step.</p>
                            <div className="wizard-actions">
                                <button className="action-btn secondary" onClick={goBack}>Back</button>
                                <button className="action-btn" onClick={goNext}>Next</button>
                            </div>
                        </div>
                    )}

                    {step === 3 && (
                        <div className="wizard-step">
                            <h4>Step 3: Per-Test Details</h4>
                            <p style={{ fontSize: '0.85rem', opacity: 0.75, marginBottom: '12px' }}>Answer the questions for each test below.</p>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxHeight: '420px', overflowY: 'auto', paddingRight: '6px' }}>
                                {tests.map((t, idx) => (
                                    <div key={idx} style={{ padding: '12px', border: '1px solid rgba(255,255,255,0.12)', borderRadius: '6px', background: 'rgba(255,255,255,0.03)' }}>
                                        <div style={{ fontWeight: 'bold', color: 'var(--yellow-accent)', marginBottom: '10px' }}>Test {idx + 1}</div>
                                        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '8px' }}>
                                            <div>
                                                <label style={{ fontSize: '0.85rem' }}>Equipment being tested</label>
                                                <input
                                                    type="text"
                                                    value={t.equipment}
                                                    onChange={(e) => updateTest(idx, { equipment: e.target.value })}
                                                    placeholder="e.g. Stern A-frame, N3K lifting point, 50-ton spreader bar..."
                                                    style={{ width: '100%', padding: '6px 8px' }}
                                                />
                                            </div>
                                            <div style={{ display: 'flex', gap: '20px', flexWrap: 'wrap' }}>
                                                <div>
                                                    <label style={{ fontSize: '0.85rem' }}>Test instrument</label>
                                                    <div style={{ display: 'flex', gap: '12px', marginTop: '4px' }}>
                                                        {INSTRUMENT_OPTIONS.map(opt => (
                                                            <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.9rem' }}>
                                                                <input type="radio" name={`inst-${idx}`} value={opt.value} checked={t.instrument === opt.value} onChange={() => updateTest(idx, { instrument: opt.value })} />
                                                                {opt.label}
                                                            </label>
                                                        ))}
                                                    </div>
                                                </div>
                                                <div>
                                                    <label style={{ fontSize: '0.85rem' }}>Test type</label>
                                                    <div style={{ display: 'flex', gap: '12px', marginTop: '4px' }}>
                                                        {['static', 'dynamic', 'both'].map(v => (
                                                            <label key={v} style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '0.9rem' }}>
                                                                <input type="radio" name={`tt-${idx}`} value={v} checked={t.testType === v} onChange={() => updateTest(idx, { testType: v })} />
                                                                {v.charAt(0).toUpperCase() + v.slice(1)}
                                                            </label>
                                                        ))}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            {!allEquipmentFilled && (
                                <div style={{ marginTop: '10px', padding: '8px 12px', background: 'rgba(248,81,73,0.1)', border: '1px solid rgba(248,81,73,0.4)', borderRadius: '6px', fontSize: '0.8rem', color: '#ff9a93' }}>
                                    Enter equipment for every test before continuing.
                                </div>
                            )}
                            <div className="wizard-actions">
                                <button className="action-btn secondary" onClick={goBack}>Back</button>
                                <button
                                    className="action-btn"
                                    onClick={goNext}
                                    disabled={!allEquipmentFilled}
                                    style={!allEquipmentFilled ? { opacity: 0.45, cursor: 'not-allowed' } : undefined}
                                    title={allEquipmentFilled ? '' : 'Enter equipment for every test'}
                                >
                                    Next
                                </button>
                            </div>
                        </div>
                    )}

                    {step === 4 && (
                        <div className="wizard-step">
                            <h4>Step 4: Review</h4>
                            <div style={{ background: 'rgba(255,255,255,0.04)', padding: '12px', borderRadius: '6px', fontSize: '0.9rem' }}>
                                <div><strong>Layout:</strong> {LAYOUT_OPTIONS.find(l => l.value === layout)?.label}</div>
                                <div><strong>Number of tests:</strong> {numTests}</div>
                                <div><strong>Tests:</strong>
                                    <ul style={{ marginTop: '6px', paddingLeft: '20px' }}>
                                        {tests.map((t, i) => (
                                            <li key={i}>{t.equipment} — {t.testType}{t.instrument !== 'none' ? `, ${instrumentLabel(t.instrument)}` : ''}</li>
                                        ))}
                                    </ul>
                                </div>
                            </div>
                            <p style={{ fontSize: '0.8rem', opacity: 0.7, marginTop: '10px' }}>Applying will replace the current test rows and layout on the editor. Set the Reference Standards section on the certificate page itself.</p>
                            <div className="wizard-actions">
                                <button className="action-btn secondary" onClick={goBack}>Back</button>
                                <button className="action-btn" onClick={handleApply}>Apply to Certificate</button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

export default CertificateWizard;
