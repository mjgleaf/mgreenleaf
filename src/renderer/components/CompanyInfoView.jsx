function CompanyInfoView({ company, onBack, onSelectForLive, onImportCsv }) {
    if (!company) return null;

    const formatLabel = (key) => {
        const result = key.replace(/([A-Z])/g, " $1");
        return result.charAt(0).toUpperCase() + result.slice(1);
    };

    const primaryFields = ['LeadName', 'LeadEmail', 'LeadPhone', 'ProjType', 'QuoteNum', 'PODate'];

    const hiddenFields = [
        'id', '__metadata', 'ContentType', 'ComplianceAssetId',
        'FileSystemObjectType', 'ServerRedirectedEmbedUrl', 'ChildCount',
        'FolderChildCount', 'ItemChildCount', '_Address', '_ColorTag',
        'Attachments', '_UIVersionString'
    ];

    const detailFields = Object.keys(company).filter(k =>
        !primaryFields.includes(k) &&
        !hiddenFields.includes(k) &&
        !k.toLowerCase().includes('lookupid') &&
        !k.toLowerCase().includes('odata') &&
        company[k] !== null &&
        company[k] !== undefined &&
        typeof company[k] !== 'object' &&
        company[k] !== ''
    );

    return (
        <div className="company-info-container" style={{ padding: '20px' }}>
            <div className="view-header" style={{ marginBottom: '30px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '20px' }}>
                    <button onClick={onBack} className="action-btn secondary small">Back to Jobs</button>
                    <h2 style={{ margin: 0 }}>{company?.LeadCompany || company?.Customer || 'Company Details'}</h2>
                </div>
                <div style={{ display: 'flex', gap: '10px' }}>
                    <button onClick={() => onImportCsv(company)} className="action-btn secondary">
                        Import CSV for This Job
                    </button>
                    <button onClick={() => onSelectForLive(company)} className="action-btn">
                        Use This Job for Live Test
                    </button>
                </div>
            </div>

            <div className="info-grid mt-4">
                <div className="info-card">
                    <h4>Primary Contact & Info</h4>
                    <div className="detail-row">
                        <span className="detail-label">Contact Name:</span>
                        <span className="detail-value">{company.LeadName || 'N/A'}</span>
                    </div>
                    <div className="detail-row">
                        <span className="detail-label">Email:</span>
                        <span className="detail-value">{company.LeadEmail || 'N/A'}</span>
                    </div>
                    <div className="detail-row">
                        <span className="detail-label">Phone:</span>
                        <span className="detail-value">{company.LeadPhone || 'N/A'}</span>
                    </div>
                    <div className="detail-row">
                        <span className="detail-label">Project Type:</span>
                        <span className="detail-value"><span className="badge service">{company.ProjType || 'Service'}</span></span>
                    </div>
                </div>

                <div className="info-card">
                    <h4>Project Reference</h4>
                    <div className="detail-row">
                        <span className="detail-label">Quote Number:</span>
                        <span className="detail-value"><strong>{company.QuoteNum || 'N/A'}</strong></span>
                    </div>
                    <div className="detail-row">
                        <span className="detail-label">PO Date:</span>
                        <span className="detail-value">{company.PODate ? new Date(company.PODate).toLocaleDateString() : 'N/A'}</span>
                    </div>
                </div>

                {detailFields.length > 0 && (
                    <div className="info-card span-2" style={{ gridColumn: 'span 2' }}>
                        <h4>Additional SharePoint Data</h4>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '15px' }}>
                            {detailFields.map(field => {
                                let val = "N/A";
                                try {
                                    val = String(company[field]);
                                } catch (e) {
                                    val = "[Complex Data]";
                                }
                                return (
                                    <div key={field} className="detail-row" style={{ display: 'flex', gap: '10px' }}>
                                        <span className="detail-label" style={{ width: '160px', fontWeight: 'bold', color: 'var(--text-secondary)' }}>{formatLabel(field)}:</span>
                                        <span className="detail-value">{val}</span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

export default CompanyInfoView;
