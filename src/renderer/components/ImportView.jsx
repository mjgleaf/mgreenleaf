import { useState } from 'react';
import Papa from 'papaparse';
import { getElectronAPI } from '../utils/electronAPI';

function ImportView({ onDataImported, contextJob }) {
    const [pendingData, setPendingData] = useState(null);
    const [jobInput, setJobInput] = useState('');
    const [isPrompting, setIsPrompting] = useState(false);
    const [error, setError] = useState('');

    const handleImport = async () => {
        try {
            const content = await getElectronAPI().openFile();
            if (!content) return;

            const parsed = Papa.parse(content, {
                header: true,
                dynamicTyping: true,
                skipEmptyLines: true
            });

            if (parsed.data && parsed.data.length > 0) {
                if (contextJob) {
                    onDataImported(parsed.data, contextJob.QuoteNum, {
                        customer: contextJob.Customer,
                        leadCompany: contextJob.LeadCompany,
                        poDate: contextJob.PODate,
                        poNumber: contextJob.PONumber
                    });
                } else {
                    setPendingData(parsed.data);
                    setIsPrompting(true);
                    setError('');
                }
            }
        } catch (error) {
            console.error("Import failed:", error);
        }
    };

    const confirmImport = () => {
        if (pendingData) {
            const regex = /^HWI-\d{2}-\d{3}$/i;
            if (!regex.test(jobInput)) {
                setError('Invalid Format. Use HWI-XX-XXX (e.g., HWI-24-001)');
                return;
            }
            onDataImported(pendingData, jobInput.toUpperCase());
            setIsPrompting(false);
            setPendingData(null);
            setJobInput('');
            setError('');
        }
    };

    return (
        <div className="view-container">
            <div className="controls center-content">
                {!isPrompting ? (
                    <>
                        <button onClick={handleImport} className="action-btn large">
                            Select Data File (CSV/Excel)
                        </button>
                        <p className="helper-text">Select a CSV or Excel file containing test data (Time, Weight, etc.)</p>
                    </>
                ) : (
                    <div className="job-prompt-card">
                        <h3>Assign Job Number</h3>
                        <p>Please enter a job or project reference number for this data set.</p>
                        <div className="form-group mt-4">
                            <label>Job Number (Format: HWI-XX-XXX)</label>
                            <input
                                type="text"
                                value={jobInput}
                                onChange={(e) => { setJobInput(e.target.value); setError(''); }}
                                className={`large-input ${error ? 'error-border' : ''}`}
                                autoFocus
                            />
                            {error && <div className="error-text">{error}</div>}
                        </div>
                        <div className="form-actions mt-4">
                            <button onClick={confirmImport} className="action-btn">
                                Confirm & Import Data
                            </button>
                            <button onClick={() => { setIsPrompting(false); setError(''); }} className="action-btn secondary ml-4">
                                Cancel
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export default ImportView;
