import { useState } from 'react';
import { useTheme } from '../App';
import logo from '../logo.png';

function MainMenu({ onSelectMode, onOpenSettings }) {
    const { theme, toggleTheme } = useTheme();
    const [showPinModal, setShowPinModal] = useState(false);
    const [pin, setPin] = useState('');
    const [pinError, setPinError] = useState('');

    const SERVICE_PIN = '8100';

    const handleServiceClick = () => {
        setShowPinModal(true);
        setPin('');
        setPinError('');
    };

    const handlePinSubmit = () => {
        if (pin === SERVICE_PIN) {
            setShowPinModal(false);
            setPin('');
            setPinError('');
            onSelectMode('service');
        } else {
            setPinError('Incorrect PIN');
            setPin('');
        }
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter') handlePinSubmit();
        if (e.key === 'Escape') { setShowPinModal(false); setPin(''); setPinError(''); }
    };

    return (
        <div className="app-container">
            <header className="app-header">
                <div className="app-header-left">
                    <img src={logo} alt="Hydro-Wates" className="header-logo" />
                    <div className="brand-separator"></div>
                    <div className="brand-name">OSCAR 1.0</div>
                </div>
                <div className="app-header-right" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <div className="theme-toggle" title="Toggle theme">
                        <button className={`theme-toggle-option ${theme === 'light' ? 'active' : ''}`} onClick={toggleTheme}>☀️</button>
                        <button className={`theme-toggle-option ${theme === 'dark' ? 'active' : ''}`} onClick={toggleTheme}>🌙</button>
                    </div>
                    <button onClick={onOpenSettings} className="action-btn secondary circle" title="Settings">&#9881;&#65039;</button>
                </div>
            </header>
            <div className="main-menu-content">
                <div className="menu-header">
                    <h1>Welcome to OSCAR</h1>
                    <p>Operational Service & Certification Analysis Reporter</p>
                </div>
                <div className="menu-grid">
                    <div className="menu-card" onClick={handleServiceClick}>
                        <div className="icon">&#128736;&#65039;</div>
                        <div className="card-content">
                            <h2>Service</h2>
                            <p>Live Load Testing, Data Logging, and Certificate Generation.</p>
                        </div>
                        <div className="badge">ACTIVE</div>
                    </div>
                    <div className="menu-card" onClick={() => onSelectMode('customer')}>
                        <div className="icon">&#128202;</div>
                        <div className="card-content">
                            <h2>Customer Center</h2>
                            <p>Capture live data, view real-time graphs, and save recordings to your computer.</p>
                        </div>
                        <div className="badge">ACTIVE</div>
                    </div>
                </div>
            </div>

            {showPinModal && (
                <div className="modal-overlay" onClick={() => { setShowPinModal(false); setPin(''); setPinError(''); }}>
                    <div className="job-prompt-card" style={{ maxWidth: '360px', textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                        <div style={{ fontSize: '2rem', marginBottom: '8px' }}>&#128274;</div>
                        <h3 style={{ marginBottom: '4px' }}>Service Mode</h3>
                        <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem', marginBottom: '16px' }}>Enter PIN to continue</p>
                        <input
                            type="password"
                            value={pin}
                            onChange={(e) => { setPin(e.target.value); setPinError(''); }}
                            onKeyDown={handleKeyDown}
                            placeholder="Enter PIN"
                            autoFocus
                            maxLength={10}
                            className="large-input"
                            style={{ textAlign: 'center', fontSize: '1.3rem', letterSpacing: '6px', marginBottom: '8px' }}
                        />
                        {pinError && <div style={{ color: '#f87171', fontSize: '0.82rem', fontWeight: 600, marginBottom: '8px' }}>{pinError}</div>}
                        <div className="form-actions mt-4" style={{ justifyContent: 'center' }}>
                            <button onClick={handlePinSubmit} className="action-btn">Unlock</button>
                            <button onClick={() => { setShowPinModal(false); setPin(''); setPinError(''); }} className="action-btn secondary ml-4">Cancel</button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}

export default MainMenu;
