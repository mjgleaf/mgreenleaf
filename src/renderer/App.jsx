import { useState, useEffect, createContext, useContext } from 'react';
import ErrorBoundary from './components/ErrorBoundary';
import MainMenu from './components/MainMenu';
import ServiceView from './components/ServiceView';
import CustomerView from './components/CustomerView';
import { SettingsModal } from './components/SettingsView';
import { getElectronAPI } from './utils/electronAPI';

// Theme Context
export const ThemeContext = createContext({ theme: 'dark', toggleTheme: () => {} });
export const useTheme = () => useContext(ThemeContext);

function App() {
    const [currentMode, setCurrentMode] = useState(null);
    const [showSettings, setShowSettings] = useState(false);
    const [theme, setTheme] = useState('dark');

    // Load theme from settings on mount
    useEffect(() => {
        const loadTheme = async () => {
            try {
                const settings = await getElectronAPI().loadSettings();
                if (settings?.theme) {
                    setTheme(settings.theme);
                    document.documentElement.setAttribute('data-theme', settings.theme);
                }
            } catch (e) { /* ignore */ }
        };
        loadTheme();
    }, []);

    const toggleTheme = async () => {
        const newTheme = theme === 'dark' ? 'light' : 'dark';
        setTheme(newTheme);
        document.documentElement.setAttribute('data-theme', newTheme);
        try {
            const settings = await getElectronAPI().loadSettings() || {};
            settings.theme = newTheme;
            await getElectronAPI().saveSettings(settings);
        } catch (e) { /* ignore */ }
    };

    const renderMode = () => {
        switch (currentMode) {
            case 'service':
                return <ServiceView onGoHome={() => setCurrentMode(null)} onOpenSettings={() => setShowSettings(true)} />;
            case 'customer':
                return <CustomerView onGoHome={() => setCurrentMode(null)} />;
            default:
                return <MainMenu onSelectMode={setCurrentMode} onOpenSettings={() => setShowSettings(true)} />;
        }
    };

    return (
        <ThemeContext.Provider value={{ theme, toggleTheme }}>
            <ErrorBoundary>
                {renderMode()}
                <SettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} />
            </ErrorBoundary>
        </ThemeContext.Provider>
    );
}

export default App;
