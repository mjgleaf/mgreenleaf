import { useState } from 'react';
import { getElectronAPI } from '../utils/electronAPI';

function StandardFinder({ onComplete, onClose }) {
    const [step, setStep] = useState(1);
    const [answers, setAnswers] = useState({
        equipment: '',
        environment: '',
        wllPercentage: '125%',
        context: ''
    });
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState(null);
    const [selectedStandards, setSelectedStandards] = useState(new Set());

    const handleNext = () => setStep(step + 1);
    const handleBack = () => setStep(step - 1);

    const handleSubmit = async () => {
        setLoading(true);
        try {
            const aiResult = await getElectronAPI().determineStandard(answers);
            setResult(aiResult);
            setStep(5);
        } catch (err) {
            alert(err.message);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="modal-overlay">
            <div className="wizard-card">
                <div className="wizard-header">
                    <h3>AI Standard Assistant</h3>
                    <button onClick={onClose} className="close-btn">&times;</button>
                </div>

                <div className="wizard-body">
                    {step === 1 && (
                        <div className="wizard-step">
                            <h4>Step 1: Equipment Details</h4>
                            <label>What equipment is being tested?</label>
                            <textarea
                                value={answers.equipment}
                                onChange={(e) => setAnswers({ ...answers, equipment: e.target.value })}
                                placeholder="e.g. Overhead bridge crane, 50-ton winch, spreader bar..."
                            />
                            <div className="wizard-actions">
                                <button className="action-btn" onClick={handleNext} disabled={!answers.equipment}>Next</button>
                            </div>
                        </div>
                    )}

                    {step === 2 && (
                        <div className="wizard-step">
                            <h4>Step 2: Environment</h4>
                            <label>Where is the job located / what industry?</label>
                            <select value={answers.environment} onChange={(e) => setAnswers({ ...answers, environment: e.target.value })}>
                                <option value="">Select Environment...</option>
                                <option value="NASA / Aerospace">NASA / Aerospace</option>
                                <option value="Military Base">Military Base</option>
                                <option value="Power Plant / Nuclear">Power Plant / Nuclear</option>
                                <option value="Offshore Oil & Gas">Offshore Oil & Gas</option>
                                <option value="Mining Site">Mining Site</option>
                                <option value="Commercial Maritime">Commercial Maritime</option>
                                <option value="General Industrial Construction">General Industrial Construction</option>
                            </select>
                            <div className="wizard-actions">
                                <button className="action-btn secondary" onClick={handleBack}>Back</button>
                                <button className="action-btn" onClick={handleNext} disabled={!answers.environment}>Next</button>
                            </div>
                        </div>
                    )}

                    {step === 3 && (
                        <div className="wizard-step">
                            <h4>Step 3: Test Requirements</h4>
                            <label>Required % of Working Load Limit (WLL)?</label>
                            <select value={answers.wllPercentage} onChange={(e) => setAnswers({ ...answers, wllPercentage: e.target.value })}>
                                <option value="100%">100%</option>
                                <option value="110%">110%</option>
                                <option value="125%">125%</option>
                                <option value="150%">150%</option>
                                <option value="Other">Other (specify in context)</option>
                            </select>
                            <div className="wizard-actions">
                                <button className="action-btn secondary" onClick={handleBack}>Back</button>
                                <button className="action-btn" onClick={handleNext}>Next</button>
                            </div>
                        </div>
                    )}

                    {step === 4 && (
                        <div className="wizard-step">
                            <h4>Step 4: Additional Context</h4>
                            <label>Any other details? (e.g. specific customer requirements)</label>
                            <textarea
                                value={answers.context}
                                onChange={(e) => setAnswers({ ...answers, context: e.target.value })}
                                placeholder="e.g. First annual inspection, post-repair test..."
                            />
                            <div className="wizard-actions">
                                <button className="action-btn secondary" onClick={handleBack}>Back</button>
                                <button className="action-btn" onClick={handleSubmit} disabled={loading}>
                                    {loading ? 'Consulting AI...' : 'Get Determination'}
                                </button>
                            </div>
                        </div>
                    )}

                    {step === 5 && (
                        <div className="wizard-step">
                            <h4>AI Determination</h4>
                            {result && result.standards && result.standards.length > 0 ? (
                                <div className="ai-results-list">
                                    <p style={{ fontSize: '0.9rem', marginBottom: '15px' }}>
                                        {result.generalExplanation || "The following standards were identified as applicable. Select the ones you want to apply to the certificate:"}
                                    </p>
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '300px', overflowY: 'auto', padding: '5px' }}>
                                        {result.standards.map((std, idx) => (
                                            <label
                                                key={idx}
                                                className={`standard-selection-card ${selectedStandards.has(std.referenceId) ? 'selected' : ''}`}
                                                style={{
                                                    display: 'flex',
                                                    gap: '12px',
                                                    padding: '12px',
                                                    background: 'rgba(255,255,255,0.05)',
                                                    border: `1px solid ${selectedStandards.has(std.referenceId) ? 'var(--yellow-accent)' : 'rgba(255,255,255,0.1)'}`,
                                                    borderRadius: '6px',
                                                    cursor: 'pointer',
                                                    transition: 'all 0.2s'
                                                }}
                                            >
                                                <input
                                                    type="checkbox"
                                                    checked={selectedStandards.has(std.referenceId)}
                                                    onChange={(e) => {
                                                        const next = new Set(selectedStandards);
                                                        if (e.target.checked) next.add(std.referenceId);
                                                        else next.delete(std.referenceId);
                                                        setSelectedStandards(next);
                                                    }}
                                                    style={{ marginTop: '3px' }}
                                                />
                                                <div>
                                                    <div style={{ fontWeight: 'bold', color: 'var(--yellow-accent)', fontSize: '1rem' }}>{std.referenceId}</div>
                                                    <div style={{ fontSize: '0.8rem', fontStyle: 'italic', marginTop: '4px', opacity: 0.8 }}>{std.explanation}</div>
                                                </div>
                                            </label>
                                        ))}
                                    </div>
                                </div>
                            ) : result ? (
                                <div className="ai-result-box">
                                    <div className="concise-result" style={{ fontSize: '1.2rem', color: 'var(--yellow-accent)', marginBottom: '15px' }}>
                                        <strong>Applied Reference:</strong> {result.referenceId || result}
                                    </div>
                                    <div className="explanation-result" style={{ borderTop: '1px solid rgba(255,255,255,0.1)', paddingTop: '15px', fontStyle: 'italic', fontSize: '0.9rem' }}>
                                        <strong>Explanation:</strong><br />
                                        {result.explanation || result.generalExplanation || "No additional explanation provided."}
                                    </div>
                                </div>
                            ) : null}
                            <div className="wizard-actions">
                                <button className="action-btn secondary" onClick={() => { setStep(1); setSelectedStandards(new Set()); }}>Try Again</button>
                                <button
                                    className="action-btn"
                                    onClick={() => {
                                        if (selectedStandards.size > 0) {
                                            onComplete(Array.from(selectedStandards).join(', '));
                                        } else if (result.referenceId || (typeof result === 'string')) {
                                            onComplete(result.referenceId || result);
                                        }
                                    }}
                                    disabled={selectedStandards.size === 0 && !result.referenceId && typeof result !== 'string'}
                                >
                                    Apply to Certificate
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

export default StandardFinder;
