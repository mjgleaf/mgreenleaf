import { useState, useEffect } from 'react';
import { getElectronAPI } from '../utils/electronAPI';

// PM-facing manager for job-assigned certificate templates (shared via SharePoint).
// Loads instantly from the offline cache, then offers an explicit "Refresh" that hits
// SharePoint (and signs in if needed) — mirroring the app's "Refresh Job List" pattern,
// so opening this screen never triggers a surprise Microsoft login.
function TemplatesView({ onNewTemplate, onEditTemplate }) {
    const [templates, setTemplates] = useState([]);
    const [lastSynced, setLastSynced] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const loadFromCache = async () => {
        try {
            const cache = await getElectronAPI().getTemplatesCache?.();
            if (cache?.templates) setTemplates(cache.templates);
            if (cache?.timestamp) setLastSynced(cache.timestamp);
        } catch (_) { /* no cache yet */ }
    };

    useEffect(() => { loadFromCache(); }, []);

    const refresh = async () => {
        setLoading(true);
        setError('');
        try {
            const list = await getElectronAPI().listTemplates();
            setTemplates(Array.isArray(list) ? list : []);
            setLastSynced(new Date().toISOString());
        } catch (err) {
            setError(err?.message || 'Could not reach SharePoint. Showing the last cached templates.');
        } finally {
            setLoading(false);
        }
    };

    const handleDelete = async (tpl) => {
        if (!window.confirm(`Delete template "${tpl.name}"?\n\nThis removes it from SharePoint for everyone.`)) return;
        const result = await getElectronAPI().deleteTemplate(tpl.id);
        if (result?.success) {
            setTemplates(prev => prev.filter(t => t.id !== tpl.id));
        } else {
            alert('Could not delete template.\n\n' + (result?.error || 'Microsoft sign-in required. Click Refresh to sign in, then try again.'));
        }
    };

    const handleReassign = async (tpl) => {
        const jobNumber = prompt(`Assign template "${tpl.name}" to which job number?`, tpl.jobNumber || '');
        if (jobNumber === null) return;
        const result = await getElectronAPI().saveTemplate({
            id: tpl.id,
            name: tpl.name,
            description: tpl.description || '',
            jobNumber: jobNumber.trim(),
            certLayout: tpl.certLayout,
            testSchema: tpl.testSchema,
            formData: tpl.formData
        });
        if (result?.success) {
            setTemplates(prev => prev.map(t => t.id === tpl.id ? { ...t, jobNumber: jobNumber.trim() } : t));
        } else {
            alert('Could not update template.\n\n' + (result?.error || 'Microsoft sign-in required. Click Refresh to sign in, then try again.'));
        }
    };

    const fmtDate = (iso) => {
        if (!iso) return '—';
        const d = new Date(iso);
        return isNaN(d.getTime()) ? '—' : d.toLocaleString();
    };

    return (
        <div style={{ maxWidth: '1000px', margin: '0 auto', padding: '1.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '1rem', flexWrap: 'wrap', gap: '12px' }}>
                <div>
                    <h2 style={{ marginBottom: '0.25rem' }}>📋 Certificate Templates</h2>
                    <p style={{ color: 'var(--text-muted)', margin: 0 }}>
                        Prepare certificates ahead of time and assign them to a job number. When a field tech
                        opens that job, the certificate auto-fills from the template (blank fields only).
                    </p>
                </div>
                <div style={{ display: 'flex', gap: '10px', flexShrink: 0 }}>
                    <button className="action-btn secondary" onClick={refresh} disabled={loading}>
                        {loading ? '🔄 Syncing…' : '🔄 Refresh'}
                    </button>
                    <button className="action-btn" onClick={() => onNewTemplate && onNewTemplate()}>
                        ＋ New Template
                    </button>
                </div>
            </div>

            <div style={{ color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '1rem' }}>
                {lastSynced ? `Last synced: ${fmtDate(lastSynced)}` : 'Not yet synced — click Refresh to load shared templates from SharePoint.'}
            </div>

            {error && (
                <div style={{ background: 'rgba(240,184,0,0.1)', border: '1px solid var(--yellow-accent)', borderRadius: '8px', padding: '10px 14px', marginBottom: '1rem', fontSize: '0.85rem' }}>
                    ⚠️ {error}
                </div>
            )}

            {templates.length === 0 ? (
                <div style={{
                    background: 'var(--bg-card)', borderRadius: '12px', padding: '2.5rem 1.5rem',
                    border: '1px dashed var(--border-color, var(--border))', textAlign: 'center', color: 'var(--text-muted)'
                }}>
                    <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📋</div>
                    <div style={{ fontSize: '1rem', marginBottom: '0.25rem', color: 'var(--text)' }}>No templates yet</div>
                    <div style={{ fontSize: '0.85rem', marginBottom: '1rem' }}>
                        Click <strong>Refresh</strong> to load shared templates, or <strong>New Template</strong> to build one from scratch.
                        You can also open any job's certificate and use <strong>Save as Template</strong>.
                    </div>
                </div>
            ) : (
                <div style={{ background: 'var(--bg-card)', borderRadius: '12px', border: '1px solid var(--border-color, var(--border))', overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
                        <thead>
                            <tr style={{ background: 'var(--bg-elevated)', textAlign: 'left' }}>
                                <th style={{ padding: '10px 14px' }}>Name</th>
                                <th style={{ padding: '10px 14px' }}>Job #</th>
                                <th style={{ padding: '10px 14px' }}>Updated By</th>
                                <th style={{ padding: '10px 14px' }}>Updated</th>
                                <th style={{ padding: '10px 14px', textAlign: 'right' }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {templates.map(tpl => (
                                <tr key={tpl.id} style={{ borderTop: '1px solid var(--border)' }}>
                                    <td style={{ padding: '10px 14px', fontWeight: 600 }}>
                                        {tpl.name}
                                        {tpl.description && (
                                            <div style={{ fontWeight: 400, color: 'var(--text-muted)', fontSize: '0.78rem' }}>{tpl.description}</div>
                                        )}
                                    </td>
                                    <td style={{ padding: '10px 14px' }}>
                                        {tpl.jobNumber
                                            ? <span style={{ color: 'var(--yellow-accent)', fontWeight: 700 }}>{tpl.jobNumber}</span>
                                            : <span style={{ color: 'var(--text-muted)' }}>Unassigned</span>}
                                    </td>
                                    <td style={{ padding: '10px 14px', color: 'var(--text-secondary)' }}>{tpl.updatedBy || '—'}</td>
                                    <td style={{ padding: '10px 14px', color: 'var(--text-secondary)' }}>{fmtDate(tpl.updatedAt)}</td>
                                    <td style={{ padding: '10px 14px' }}>
                                        <div style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                                            <button className="action-btn secondary small" style={{ fontSize: '0.75rem', padding: '4px 10px' }} onClick={() => onEditTemplate && onEditTemplate(tpl)}>Edit</button>
                                            <button className="action-btn secondary small" style={{ fontSize: '0.75rem', padding: '4px 10px' }} onClick={() => handleReassign(tpl)}>Assign</button>
                                            <button className="action-btn secondary small" style={{ fontSize: '0.75rem', padding: '4px 10px', color: '#ff6b6b', borderColor: '#cc3333' }} onClick={() => handleDelete(tpl)}>Delete</button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
}

export default TemplatesView;
