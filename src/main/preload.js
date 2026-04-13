const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    // Add API methods here
    ping: () => ipcRenderer.invoke('ping'),
    openFile: () => ipcRenderer.invoke('dialog:openFile'),
    saveData: (data, filename) => ipcRenderer.invoke('storage:save', data, filename),
    loadData: (filename) => ipcRenderer.invoke('storage:load', filename),
    onDeviceStatusChanged: (callback) => ipcRenderer.on('device-status-changed', (_event, value) => callback(value)),
    onLiveData: (callback) => ipcRenderer.on('live-data-packet', (_event, value) => callback(value)),
    savePDF: (title) => ipcRenderer.invoke('storage:savePDF', title),
    saveCSV: (data, defaultName) => ipcRenderer.invoke('storage:saveCSV', data, defaultName),

    // Settings & SharePoint
    loadSettings: () => ipcRenderer.invoke('settings:load'),
    saveSettings: (settings) => ipcRenderer.invoke('settings:save', settings),
    fetchJobs: () => ipcRenderer.invoke('sharepoint:fetchJobs'),
    getJobsCache: () => ipcRenderer.invoke('sharepoint:getJobsCache'),
    fetchInventory: () => ipcRenderer.invoke('sharepoint:fetchInventory'),
    logout: () => ipcRenderer.invoke('sharepoint:logout'),
    determineStandard: (answers) => ipcRenderer.invoke('ai:determineStandard', answers),
    onAuthMessage: (callback) => ipcRenderer.on('auth-message', (_event, value) => callback(value)),
    toggleKeepAwake: (enabled) => ipcRenderer.invoke('t24:toggleKeepAwake', enabled),
    getKeepStatus: () => ipcRenderer.invoke('t24:getKeepStatus'),
    startPolling: (tags) => ipcRenderer.invoke('t24:startPolling', tags),
    stopPolling: () => ipcRenderer.invoke('t24:stopPolling'),
    tare: (tag) => ipcRenderer.invoke('t24:tare', tag),
    clearTare: (tag) => ipcRenderer.invoke('t24:clearTare', tag),
    getDeviceStatus: () => ipcRenderer.invoke('t24:getStatus'),
    checkRecovery: () => ipcRenderer.invoke('t24:checkRecovery'),
    loadRecovery: () => ipcRenderer.invoke('t24:loadRecovery'),
    clearRecovery: () => ipcRenderer.invoke('t24:clearRecovery'),
    startSafetyLog: (intervalMs) => ipcRenderer.send('t24:startSafetyLog', intervalMs),
    stopSafetyLog: () => ipcRenderer.send('t24:stopSafetyLog'),
    wakeSensors: () => ipcRenderer.invoke('t24:wakeSensors'),

    // Session History
    saveSession: (payload) => ipcRenderer.invoke('sessions:save', payload),
    listSessions: () => ipcRenderer.invoke('sessions:list'),
    loadSession: (id) => ipcRenderer.invoke('sessions:load', id),
    deleteSession: (id) => ipcRenderer.invoke('sessions:delete', id),
    autosaveSession: (payload) => ipcRenderer.invoke('sessions:autosave', payload),
    loadAutosave: () => ipcRenderer.invoke('sessions:loadAutosave'),
    clearAutosave: () => ipcRenderer.invoke('sessions:clearAutosave'),

    // Companion Server (Mobile PWA)
    companionStart: () => ipcRenderer.invoke('companion:start'),
    companionStop: () => ipcRenderer.invoke('companion:stop'),
    companionStatus: () => ipcRenderer.invoke('companion:status'),
    companionGetPhotos: () => ipcRenderer.invoke('companion:getPhotos'),
    companionClearPhotos: () => ipcRenderer.invoke('companion:clearPhotos'),
    onCompanionPhoto: (callback) => {
        const handler = (_event, value) => callback(value);
        ipcRenderer.on('companion-photo-received', handler);
        return () => ipcRenderer.removeListener('companion-photo-received', handler);
    },

    // Certificate Registry
    certNextNumber: () => ipcRenderer.invoke('cert:nextNumber'),
    certRegister: (entry) => ipcRenderer.invoke('cert:register', entry),
    certListRegistry: () => ipcRenderer.invoke('cert:listRegistry'),

    // Customer Export
    exportCustomerPackage: (opts) => ipcRenderer.invoke('export:customerPackage', opts),

    // Auto-Updater
    updaterCheck: () => ipcRenderer.invoke('updater:check'),
    updaterDownload: () => ipcRenderer.invoke('updater:download'),
    updaterInstall: () => ipcRenderer.invoke('updater:install'),
    updaterStatus: () => ipcRenderer.invoke('updater:status'),
    onUpdaterStatus: (callback) => {
        const handler = (_event, value) => callback(value);
        ipcRenderer.on('updater-status', handler);
        return () => ipcRenderer.removeListener('updater-status', handler);
    },

    // Utilities
    openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
    openBundledDoc: (filename) => ipcRenderer.invoke('shell:openBundledDoc', filename),

    // C.H. Robinson Navisphere
    fetchCHRShipments: () => ipcRenderer.invoke('chr:fetchShipments'),
    getCHRShipmentsCache: () => ipcRenderer.invoke('chr:getShipmentsCache'),

    // Geotab API Integration
    authenticateGeotab: (credentials) => ipcRenderer.invoke('geotab:authenticate', credentials),
    fetchGeotabVehicles: () => ipcRenderer.invoke('geotab:fetchVehicles'),
    fetchGeotabELD: (params) => ipcRenderer.invoke('geotab:fetchELD', params),

});
