import { useState, useEffect } from 'react';
import { getElectronAPI } from '../utils/electronAPI';
import { useTheme } from '../App';

function SettingsView({ onSettingsSaved }) {
    const { theme, toggleTheme } = useTheme();
    const [settings, setSettings] = useState({
        clientId: '',
        tenantId: '',
        sharepointSite: '',
        leadListName: '',
        openaiKey: '',
        t24GroupId: 0,
        chrUsername: '',
        chrPassword: '',
        geotabServer: '',
        geotabDatabase: '',
        geotabUsername: '',
        geotabPassword: '',
        hiddenJobIds: []
    });
    const [message, setMessage] = useState('');

    useEffect(() => {
        const load = async () => {
            const saved = await getElectronAPI().loadSettings();
            if (saved) setSettings(prev => ({ ...prev, ...saved }));
        };
        load();
    }, []);

    const handleSave = async () => {
        const result = await getElectronAPI().saveSettings(settings);
        if (result?.success) {
            setMessage('Settings saved successfully!');
            if (onSettingsSaved) onSettingsSaved();
        }
    };

    const [updateStatus, setUpdateStatus] = useState(null);
    const [checkingUpdate, setCheckingUpdate] = useState(false);

    // Listen for updater events
    useEffect(() => {
        const api = getElectronAPI();
        if (api.onUpdaterStatus) {
            const removeListener = api.onUpdaterStatus((status) => {
                setUpdateStatus(status);
                setCheckingUpdate(false);
            });
            return () => { if (typeof removeListener === 'function') removeListener(); };
        }
    }, []);

    const handleCheckUpdate = async () => {
        setCheckingUpdate(true);
        setUpdateStatus(null);
        await getElectronAPI().updaterCheck();
    };

    return (
        <div className="view-container">
            {/* App Updates & Theme */}
            <div className="form-section" style={{ marginBottom: '1.5rem' }}>
                <h3>Appearance & Updates</h3>
                <div style={{ display: 'flex', gap: '24px', alignItems: 'flex-start', flexWrap: 'wrap' }}>
                    <div>
                        <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '6px', display: 'block' }}>Theme</label>
                        <div className="theme-toggle">
                            <button className={`theme-toggle-option ${theme === 'light' ? 'active' : ''}`} onClick={toggleTheme}>☀️ Light</button>
                            <button className={`theme-toggle-option ${theme === 'dark' ? 'active' : ''}`} onClick={toggleTheme}>🌙 Dark</button>
                        </div>
                    </div>
                    <div>
                        <label style={{ fontSize: '0.85rem', color: 'var(--text-secondary)', marginBottom: '6px', display: 'block' }}>Software Updates</label>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                            <button className="action-btn secondary" onClick={handleCheckUpdate} disabled={checkingUpdate} style={{ fontSize: '0.85rem' }}>
                                {checkingUpdate ? '⏳ Checking...' : '🔄 Check for Updates'}
                            </button>
                            {updateStatus?.status === 'up-to-date' && (
                                <span style={{ color: '#22c55e', fontSize: '0.85rem' }}>✓ Up to date (v{updateStatus.version})</span>
                            )}
                            {updateStatus?.status === 'available' && (
                                <span style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                    <span style={{ color: 'var(--yellow-accent)', fontSize: '0.85rem' }}>v{updateStatus.version} available</span>
                                    <button className="action-btn primary" onClick={() => getElectronAPI().updaterDownload()} style={{ fontSize: '0.8rem', padding: '4px 12px' }}>Download</button>
                                </span>
                            )}
                            {updateStatus?.status === 'downloading' && (
                                <span style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>Downloading... {updateStatus.percent}%</span>
                            )}
                            {updateStatus?.status === 'downloaded' && (
                                <button className="action-btn primary" onClick={() => getElectronAPI().updaterInstall()} style={{ fontSize: '0.8rem', padding: '4px 12px' }}>
                                    🚀 Install & Restart
                                </button>
                            )}
                            {updateStatus?.status === 'error' && (
                                <span style={{ color: '#ef4444', fontSize: '0.85rem' }}>Update check failed</span>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            <div className="form-section">
                <h3>System Settings</h3>
                <p className="helper-text">Configure SharePoint and AI credentials below.</p>

                <div className="form-grid mt-4">
                    <div className="form-group">
                        <label>Microsoft Client ID</label>
                        <input
                            type="text"
                            value={settings.clientId}
                            onChange={(e) => setSettings({ ...settings, clientId: e.target.value })}
                            placeholder="Enter Azure App Client ID"
                        />
                    </div>
                    <div className="form-group">
                        <label>Microsoft Tenant ID</label>
                        <input
                            type="text"
                            value={settings.tenantId}
                            onChange={(e) => setSettings({ ...settings, tenantId: e.target.value })}
                            placeholder="Enter Azure Tenant ID"
                        />
                    </div>
                    <div className="form-group">
                        <label>SharePoint Site URL</label>
                        <input
                            type="text"
                            value={settings.sharepointSite}
                            onChange={(e) => setSettings({ ...settings, sharepointSite: e.target.value })}
                            placeholder="e.g. https://company.sharepoint.com/sites/Production"
                        />
                    </div>
                    <div className="form-group">
                        <label>Lead List Name</label>
                        <input
                            type="text"
                            value={settings.leadListName}
                            onChange={(e) => setSettings({ ...settings, leadListName: e.target.value })}
                            placeholder="Lead List"
                        />
                    </div>
                    <div className="form-group span-2">
                        <label>OpenAI API Key (for Standard Finder)</label>
                        <input
                            type="password"
                            value={settings.openaiKey}
                            onChange={(e) => setSettings({ ...settings, openaiKey: e.target.value })}
                            placeholder="sk-..."
                        />
                    </div>
                </div>

                <div className="form-section mt-4">
                    <h3>T24 Telemetry Settings</h3>
                    <p className="helper-text">Configure T24 load cell communication settings.</p>
                    <div className="form-grid mt-4">
                        <div className="form-group">
                            <label>T24 Group ID</label>
                            <select
                                value={settings.t24GroupId || 0}
                                onChange={(e) => setSettings({ ...settings, t24GroupId: parseInt(e.target.value) })}
                            >
                                {[...Array(16)].map((_, i) => (
                                    <option key={i} value={i}>Group {i}</option>
                                ))}
                            </select>
                            <p style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', marginTop: '8px' }}>
                                Set this to match your T24 handheld's Group ID. Check your handheld's settings if unsure.
                            </p>
                        </div>
                    </div>
                </div>

                <div className="form-section mt-4">
                    <h3>Job Management</h3>
                    <p className="helper-text">Restore previously removed jobs to the list.</p>
                    <div style={{ marginTop: '16px' }}>
                        {settings.hiddenJobIds && settings.hiddenJobIds.length > 0 ? (
                            <>
                                <p style={{ fontSize: '0.9rem', marginBottom: '12px' }}>
                                    You have <strong>{settings.hiddenJobIds.length}</strong> hidden job(s).
                                </p>
                                <button
                                    onClick={() => {
                                        if (confirm('Are you sure you want to restore all hidden jobs?')) {
                                            setSettings({ ...settings, hiddenJobIds: [] });
                                            setMessage('Click Save to apply changes.');
                                        }
                                    }}
                                    className="action-btn secondary"
                                >
                                    Restore All Hidden Jobs
                                </button>
                            </>
                        ) : (
                            <p style={{ fontSize: '0.9rem', color: 'var(--text-secondary)' }}>No jobs are currently hidden.</p>
                        )}
                    </div>
                </div>

                <div className="form-actions mt-4">
                    <button onClick={handleSave} className="action-btn">Save Configuration</button>
                    <button
                        onClick={async () => {
                            if (confirm('Are you sure you want to sign out? This will clear your SharePoint login cache.')) {
                                await getElectronAPI().logout();
                                alert('Signed out successfully.');
                            }
                        }}
                        className="action-btn secondary ml-4"
                    >
                        Sign Out (Clear MS Cache)
                    </button>
                    {message && <span className="ml-4 info-text">{message}</span>}
                </div>
            </div>
        </div>
    );
}

function SettingsModal({ isOpen, onClose }) {
    if (!isOpen) return null;

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="job-prompt-card" style={{ maxWidth: '800px', width: '90%', maxHeight: '90vh', overflowY: 'auto', position: 'relative' }} onClick={e => e.stopPropagation()}>
                <button
                    className="action-btn secondary small"
                    style={{ position: 'absolute', top: '20px', right: '20px' }}
                    onClick={onClose}
                >
                    Close
                </button>
                <SettingsView onSettingsSaved={onClose} />
            </div>
        </div>
    );
}

export { SettingsView, SettingsModal };
export default SettingsView;
