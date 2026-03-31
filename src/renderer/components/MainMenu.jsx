import logo from '../logo.png';

function MainMenu({ onSelectMode, onOpenSettings }) {
    return (
        <div className="app-container">
            <header className="app-header">
                <div className="app-header-left">
                    <img src={logo} alt="Hydro-Wates" className="header-logo" />
                    <div className="brand-separator"></div>
                    <div className="brand-name">OSCAR 1.0</div>
                </div>
                <div className="app-header-right">
                    <button onClick={onOpenSettings} className="action-btn secondary circle" title="Settings">&#9881;&#65039;</button>
                </div>
            </header>
            <div className="main-menu-content">
                <div className="menu-header">
                    <h1>Welcome to OSCAR</h1>
                    <p>Operational Service & Certification Analysis Reporter</p>
                </div>
                <div className="menu-grid">
                    <div className="menu-card" onClick={() => onSelectMode('service')}>
                        <div className="icon">&#128736;&#65039;</div>
                        <div className="card-content">
                            <h2>Service</h2>
                            <p>Live Load Testing, Data Logging, and Certificate Generation.</p>
                        </div>
                        <div className="badge">ACTIVE</div>
                    </div>
                </div>
            </div>
        </div>
    );
}

export default MainMenu;
