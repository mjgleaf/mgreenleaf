import { useState } from 'react';
import ErrorBoundary from './components/ErrorBoundary';
import ServiceView from './components/ServiceView';
import { SettingsModal } from './components/SettingsView';

function App() {
    const [showSettings, setShowSettings] = useState(false);

    return (
        <ErrorBoundary>
            <ServiceView onGoHome={() => {}} onOpenSettings={() => setShowSettings(true)} />
            <SettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} />
        </ErrorBoundary>
    );
}

export default App;
