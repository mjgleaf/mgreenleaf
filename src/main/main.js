const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage, powerSaveBlocker } = require('electron');
const path = require('path');
const { exec } = require('child_process');
const fs = require('fs');
require('dotenv').config();
const HID = require('node-hid');
const { PublicClientApplication } = require('@azure/msal-node');
const axios = require('axios');

const VID = 0x1781;
const PID = 0x0ba4;

class T24Reader {
    constructor() {
        this.device = null;
        this.keepAwakeTimer = null;
        this.pollTimer = null;
        this.pollTags = [];
        this.powerSaveId = null;
        this.tares = new Map(); // Tag -> Offset Value
        this.lastValues = new Map(); // Tag -> Last Raw Value (for taring)
        this.isLogging = false;
        this.logFilePath = path.join(app.getPath('userData'), 'safety-log.jsonl');
        this.firstTimestamp = null;
        this.logInterval = 0; // 0 = record every packet
        this.lastLoggedTimestamps = new Map(); // Tag -> Last Log Time
        this.groupId = 0; // Default Group ID = 0 (will be loaded from settings)
        this.scaleFactors = new Map(); // Tag -> Scale Factor (default 1.0)
        this.sampleBuffers = new Map(); // Tag -> Array of last N samples
        // Default calibration to prevent massive readings if file fails to load
        this.calibrationConfig = {};
        this.loadCalibration();
    }

    loadCalibration() {
        try {
            const userDataPath = path.join(app.getPath('userData'), 'calibration.json');
            const resourcesPath = process.resourcesPath ? path.join(process.resourcesPath, 'calibration.json') : null;
            const projectRoot = path.resolve(__dirname, '../../');
            const devPath = path.join(projectRoot, 'config/calibration.json');

            let configPath = null;

            // Priority:
            // 1. User Data (Highest priority, allows user overrides)
            // 2. Resources folder (Bundled with app)
            // 3. Dev path (For development)
            if (fs.existsSync(userDataPath)) {
                configPath = userDataPath;
            } else if (resourcesPath && fs.existsSync(resourcesPath)) {
                configPath = resourcesPath;
            } else if (fs.existsSync(devPath)) {
                configPath = devPath;
            } else {
                // Last resort: process.cwd()
                const fallbackPath = path.join(process.cwd(), 'config/calibration.json');
                if (fs.existsSync(fallbackPath)) configPath = fallbackPath;
            }

            if (configPath) {
                const raw = fs.readFileSync(configPath, 'utf8');
                const loaded = JSON.parse(raw);
                this.calibrationConfig = { ...this.calibrationConfig, ...loaded };
                console.log(`[CALIBRATION] Loaded config from ${configPath}:`, this.calibrationConfig);
            } else {
                console.warn('[CALIBRATION] No calibration config found. Using defaults.');
            }
        } catch (err) {
            console.error('[CALIBRATION] Failed to load calibration config:', err);
        }
    }

    open(path) {
        try {
            if (this.device) this.close();
            this.device = new HID.HID(path);

            this.device.on('data', (data) => {
                this.parsePacket(data);
            });

            this.device.on('error', (err) => {
                console.error('HID Device Error:', err);
                this.close();
            });

            console.log('T24 Device opened.');
        } catch (err) {
            console.error('Failed to open T24 device:', err);
        }
    }

    close() {
        this.stopKeepAwake();
        if (this.device) {
            try {
                this.device.close();
            } catch (e) { }
            this.device = null;
        }
    }

    startKeepAwake() {
        console.log('Sending T24 Telemetry Wake Burst...');

        // 1. Initial Wake Burst (Helpful for modules with short wake-listening windows)
        let burstCount = 0;
        const burstTimer = setInterval(() => {
            this.sendWakeBroadcast();
            burstCount++;
            if (burstCount >= 50) clearInterval(burstTimer); // 5 seconds of aggressive wake
        }, 100);

        if (this.keepAwakeTimer) return;

        console.log('Starting T24 Telemetry Maintenance pulse (65-byte buffers)...');

        // 2. Continuous Maintenance
        this.keepAwakeTimer = setInterval(() => {
            if (this.device) {
                try {
                    // Stay Awake Broadcast (Report 5, Cmd 1, Group ID in byte 4)
                    const stayAwake = Buffer.alloc(65);
                    stayAwake[0] = 0x05;
                    stayAwake[1] = 0x01;
                    stayAwake[2] = 0xFF;
                    stayAwake[3] = 0xFF;
                    stayAwake[4] = this.groupId; // Set Group ID
                    this.device.write(stayAwake);
                } catch (err) {
                    console.error('Stay-awake failed:', err);
                }
            }
        }, 1500); // Pulse every 1.5s
    }

    manualWake() {
        if (!this.device) return;
        console.log('User initiated MANUAL WAKE-UP burst (Global + Selected Group)...');
        let burstCount = 0;
        const burstTimer = setInterval(() => {
            // Send to selected group
            this.sendWakeBroadcast(this.groupId);
            // Also send to Group 0 (Global Wake) just in case
            if (this.groupId !== 0) {
                this.sendWakeBroadcast(0);
            }
            burstCount++;
            if (burstCount >= 50) {
                clearInterval(burstTimer);
                console.log('Manual wake burst complete.');
            }
        }, 100);
    }

    sendWakeBroadcast(groupId = this.groupId) {
        if (!this.device) return;
        try {
            // Wake Up Broadcast (Report 5, Cmd 2, Group ID in byte 4)
            const wake = Buffer.alloc(65);
            wake[0] = 0x05;
            wake[1] = 0x02;
            wake[2] = 0xFF;
            wake[3] = 0xFF;
            wake[4] = groupId;
            this.device.write(wake);
        } catch (e) { }
    }

    stopKeepAwake() {
        if (this.keepAwakeTimer) {
            clearInterval(this.keepAwakeTimer);
            this.keepAwakeTimer = null;
            console.log('Stopped Keep Awake signals.');
        }
    }
    startPolling(tags) {
        this.stopPolling();
        this.pollTags = tags.filter(t => t !== null);
        if (this.pollTags.length === 0) return;

        console.log(`Starting active polling for tags: ${this.pollTags.join(', ')}`);
        this.pollTimer = setInterval(() => {
            if (!this.device) return;
            this.pollTags.forEach(tag => {
                try {
                    const pollPacket = Buffer.alloc(65);
                    pollPacket[0] = 0x01; // Report ID
                    pollPacket[1] = 0x03; // Command: Request Data
                    pollPacket[2] = parseInt(tag.slice(0, 2), 16);
                    pollPacket[3] = parseInt(tag.slice(2, 4), 16);
                    this.device.write(pollPacket);
                } catch (err) {
                    console.error('Polling error:', err);
                }
            });
        }, 500); // Increased frequency to 500ms
    }

    stopPolling() {
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
            console.log('Stopped active polling.');
        }
    }

    startSafetyLog(intervalMs = 0) {
        this.isLogging = true;
        this.firstTimestamp = null;
        this.logInterval = intervalMs;
        this.lastLoggedTimestamps.clear();
        // Clear previous log if any
        if (fs.existsSync(this.logFilePath)) {
            try { fs.unlinkSync(this.logFilePath); } catch (e) { }
        }
        if (!this.powerSaveId || !powerSaveBlocker.isStarted(this.powerSaveId)) {
            this.powerSaveId = powerSaveBlocker.start('prevent-app-suspension');
            console.log(`[T24] Power save blocker started: ${this.powerSaveId}`);
        }
        console.log('Safety Log started.');
    }

    stopSafetyLog() {
        this.isLogging = false;
        this.firstTimestamp = null;
        if (this.powerSaveId !== null) {
            if (powerSaveBlocker.isStarted(this.powerSaveId)) {
                powerSaveBlocker.stop(this.powerSaveId);
                console.log(`[T24] Power save blocker stopped: ${this.powerSaveId}`);
            }
            this.powerSaveId = null;
        }
        console.log('Safety Log stopped.');
    }

    clearSafetyLog() {
        if (fs.existsSync(this.logFilePath)) {
            try { fs.unlinkSync(this.logFilePath); } catch (e) { }
        }
    }

    tare(tag) {
        if (this.lastValues.has(tag)) {
            this.tares.set(tag, this.lastValues.get(tag));
            console.log(`Tared tag ${tag} at value ${this.lastValues.get(tag).toFixed(2)}`);
        }
    }

    clearTare(tag) {
        this.tares.delete(tag);
        console.log(`Cleared tare for tag ${tag}`);
    }

    parsePacket(data) {
        // T24 Data Provider Packet Format (Report ID 0x0B):
        // Byte 0: Report ID (must be 0x0B for data packets)
        // Byte 4-5: Data Tag (Uint16, Big Endian)
        // Byte 8-11: Weight Value (Float32, Big Endian, in Metric Tonnes)

        if (data.length < 12) return;

        // CRITICAL: Only process Report ID 0x0B (Data Provider packets)
        if (data[0] !== 0x0B) return;

        try {
            const dataTag = data.readUInt16BE(4);
            const tagHex = dataTag.toString(16).toUpperCase().padStart(4, '0');

            const config = this.calibrationConfig[tagHex] || {};
            const useFloatLE = config.useFloatLE !== undefined ? config.useFloatLE : false; // Default big endian

            let tonnes;
            if (useFloatLE) {
                tonnes = data.readFloatLE(8);
            } else {
                tonnes = data.readFloatBE(8);
            }

            let value;

            if (config.skipTonnesConversion) {
                value = tonnes; // Use raw float
            } else {
                value = tonnes * 2204.62262; // Convert Metric Tonnes to LBS
            }

            // Apply Zero Offset if configured
            if (config.zeroOffset !== undefined) {
                value -= config.zeroOffset;
            }

            // Apply scale factor from calibration.json overrides local scale factors?
            // Let's multiply by calibration scale factor FIRST, then any dynamic scaling (tare, etc)
            if (config.scaleFactor !== undefined) {
                value *= config.scaleFactor;
            }

            // Sanity check: filter out garbage values (reasonable range: -1M to +1M lbs)
            if (!isFinite(value) || Math.abs(value) > 1000000) {
                console.log(`[T24] Filtered out tag ${tagHex}: value=${value}`);
                return; // Skip this packet - it contains garbage data
            }

            // Smoothing Filter (Moving Average)
            // Use 10-sample buffer to smooth out jitter (Tag 6762 needs this)
            if (!this.sampleBuffers.has(tagHex)) {
                this.sampleBuffers.set(tagHex, []);
            }
            const buffer = this.sampleBuffers.get(tagHex);
            buffer.push(value);
            if (buffer.length > 10) buffer.shift(); // Keep last 10 samples

            // Calculate Average
            const sum = buffer.reduce((a, b) => a + b, 0);
            const avgValue = sum / buffer.length;

            // Use averaged value passing forward
            value = avgValue;

            this.lastValues.set(tagHex, value);

            // Apply Tare
            if (this.tares.has(tagHex)) {
                value -= this.tares.get(tagHex);
            }

            // Apply Scale Factor
            // If we used a system calibration scale factor (config.scaleFactor), 
            // we should IGNORE the user-defined scale factor (this.scaleFactors) to avoid double-scaling.
            // Unless the user explicitly wants to fine-tune it? 
            // For now, let's assume system calibration supersedes user settings to fix the "3000 lbs" issue.

            if (config.scaleFactor === undefined) {
                const userScale = this.scaleFactors.get(tagHex) || 1.0;
                value *= userScale;
            } else {
                // System calibration active. Ignore user scale factor, or perhaps log it?
                // value *= 1.0; 
            }

            const packet = {
                tag: tagHex,
                value: value,
                timestamp: Date.now()
            };

            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('live-data-packet', packet);
            }

            // Persistence: Safety Log (Throttled by interval)
            if (this.isLogging) {
                const lastLog = this.lastLoggedTimestamps.get(tagHex) || 0;
                if (packet.timestamp - lastLog >= this.logInterval) {
                    if (this.firstTimestamp === null) this.firstTimestamp = packet.timestamp;
                    const logEntry = {
                        ...packet,
                        "Elapsed (ms)": packet.timestamp - this.firstTimestamp
                    };
                    fs.appendFileSync(this.logFilePath, JSON.stringify(logEntry) + '\n');
                    this.lastLoggedTimestamps.set(tagHex, packet.timestamp);
                }
            }
        } catch (err) {
            // Silently fail if buffer reading fails (wrong packet format)
        }
    }

    setGroupId(groupId) {
        this.groupId = groupId;
        console.log(`T24 Group ID set to: ${groupId}`);
    }

    setScaleFactor(tag, factor) {
        this.scaleFactors.set(tag, factor);
        console.log(`Scale factor for tag ${tag} set to: ${factor}`);
    }

    loadScaleFactors(scaleFactorsObj) {
        // Load scale factors from settings object { "6762": 0.01, "2075": 1.0, ... }
        this.scaleFactors.clear();
        if (scaleFactorsObj) {
            Object.entries(scaleFactorsObj).forEach(([tag, factor]) => {
                this.scaleFactors.set(tag, factor);
            });
            console.log(`Loaded ${this.scaleFactors.size} scale factors from settings`);
        }
    }
}

const t24Reader = new T24Reader();
let mainWindow;
let deviceStatus = 'disconnected';



function scanForDongle() {
    try {
        const devices = HID.devices();
        const info = devices.find(d => d.vendorId === VID && d.productId === PID);
        const newStatus = info ? 'connected' : 'disconnected';

        if (newStatus !== deviceStatus) {
            deviceStatus = newStatus;
            console.log(`Device status changed: ${deviceStatus} `);

            if (deviceStatus === 'connected') {
                t24Reader.open(info.path);
                // Ensure stay-awake is active by default on connection
                t24Reader.startKeepAwake();
            } else {
                t24Reader.close();
            }

            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('device-status-changed', deviceStatus);
            }
        }
    } catch (err) {
        console.error('Error scanning for HID devices:', err);
    }
}

// Start scanning every 2 seconds
setInterval(scanForDongle, 2000);

async function handleSavePDF(event, title) {
    const { filePath } = await dialog.showSaveDialog({
        title: 'Save Certificate',
        defaultPath: `${title || 'Certificate'}.pdf`,
        filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
    });

    if (filePath) {
        const options = {
            marginsType: 0,
            pageSize: 'A4',
            printBackground: true,
            printSelectionOnly: false,
            landscape: false,
            preferCSSPageSize: true,
            scaleFactor: 100
        };

        try {
            const data = await mainWindow.webContents.printToPDF(options);
            fs.writeFileSync(filePath, data);
            shell.openPath(filePath);
            return { success: true, filePath };
        } catch (error) {
            console.error('Failed to save PDF:', error);
            return { success: false, error: error.message };
        }
    }
    return { success: false, canceled: true };
}

async function handleSaveCSV(event, data, defaultName) {
    const { filePath } = await dialog.showSaveDialog({
        title: 'Export Data as CSV',
        defaultPath: `${defaultName || 'test_data'}.csv`,
        filters: [{ name: 'CSV Files', extensions: ['csv'] }]
    });

    if (filePath) {
        try {
            // Convert data array to CSV
            if (!data || data.length === 0) {
                return { success: false, error: 'No data to export' };
            }

            const headers = Object.keys(data[0]);
            const csvRows = [];

            // Add header row
            csvRows.push(headers.join(','));

            // Add data rows
            for (const row of data) {
                const values = headers.map(header => {
                    const val = row[header];
                    // Escape quotes and wrap in quotes if contains comma or quote
                    if (val === null || val === undefined) return '';
                    const str = String(val);
                    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                        return `"${str.replace(/"/g, '""')}"`;
                    }
                    return str;
                });
                csvRows.push(values.join(','));
            }

            fs.writeFileSync(filePath, csvRows.join('\n'), 'utf-8');
            shell.openPath(filePath);
            return { success: true, filePath };
        } catch (error) {
            console.error('Failed to save CSV:', error);
            return { success: false, error: error.message };
        }
    }
    return { success: false, canceled: true };
}

async function handleFileOpen() {
    const { canceled, filePaths } = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [
            { name: 'CSV Files', extensions: ['csv'] }
        ]
    });
    if (!canceled) {
        const content = fs.readFileSync(filePaths[0], 'utf-8');
        return content;
    }
}

function getDataPath(filename) {
    return path.join(app.getPath('userData'), filename || 'dashboard-data.json');
}

// --- Settings Management ---
function loadSettings() {
    const settingsPath = getDataPath('settings.json');
    let saved = {};
    if (fs.existsSync(settingsPath)) {
        try {
            saved = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        } catch (e) {
            console.error('Failed to parse settings:', e);
        }
    }

    // Default configuration (from .env or reasonable defaults)
    const defaults = {
        clientId: process.env.AZURE_CLIENT_ID || '',
        tenantId: process.env.AZURE_TENANT_ID || '',
        sharepointSite: 'https://hydrowates.sharepoint.com/sites/Hydro-WatesFiles',
        leadListName: 'Lead List',
        openaiKey: process.env.OPENAI_API_KEY || '',
        t24GroupId: 0,
        t24ScaleFactors: {},
        // C.H. Robinson Navisphere credentials
        chrUsername: '',
        chrPassword: '',
        // Geotab Credentials
        geotabServer: process.env.VITE_GEOTAB_SERVER || 'my.geotab.com',
        geotabDatabase: process.env.VITE_GEOTAB_DATABASE || '',
        geotabUsername: process.env.VITE_GEOTAB_USERNAME || '',
        geotabPassword: process.env.VITE_GEOTAB_PASSWORD || '',
    };

    // Return defaults merged with saved user settings
    const merged = { ...defaults, ...saved };
    console.log('[Geotab Debug] loadSettings merged result:', {
        server: merged.geotabServer,
        database: merged.geotabDatabase,
        username: merged.geotabUsername,
        password: merged.geotabPassword ? '********' : 'MISSING'
    });
    return merged;
}

function saveSettings(event, settings) {
    const settingsPath = getDataPath('settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

    // Apply Group ID to T24Reader immediately
    if (settings.t24GroupId !== undefined) {
        t24Reader.setGroupId(settings.t24GroupId);
    }

    // Apply Scale Factors to T24Reader immediately
    if (settings.t24ScaleFactors) {
        t24Reader.loadScaleFactors(settings.t24ScaleFactors);
    }

    // Attempt Geotab Authentication automatically if credentials are provided
    if (settings.geotabServer && settings.geotabDatabase && settings.geotabUsername && settings.geotabPassword) {
        geotabAuthenticate({
            server: settings.geotabServer,
            database: settings.geotabDatabase,
            username: settings.geotabUsername,
            password: settings.geotabPassword
        }).catch(err => console.error('Auto-Geotab Auth Failed:', err.message));
    }

    return { success: true };
}

// --- Geotab Logic ---
async function geotabAuthenticate(credentials) {
    const { server, database, username, password } = credentials;
    const response = await axios.post(`https://${server}/apiv1`, {
        method: "Authenticate",
        params: {
            database,
            userName: username,
            password
        }
    });

    if (response.data.error) throw new Error(response.data.error.message);

    // Save session
    const session = response.data.result;
    const sessionPath = getDataPath('geotab-session.json');
    fs.writeFileSync(sessionPath, JSON.stringify({
        server,
        database,
        credentials: session.credentials,
        path: session.path
    }, null, 2));

    return { success: true, user: session.user };
}

async function ensureGeotabSession() {
    const sessionPath = getDataPath('geotab-session.json');
    if (fs.existsSync(sessionPath)) {
        try {
            return JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
        } catch (e) {
            console.error('Failed to parse Geotab session, re-authenticating...');
        }
    }

    // Try to re-authenticate using settings
    const settings = loadSettings();
    console.log('[Geotab Debug] Loaded settings for auto-auth:', {
        server: settings.geotabServer,
        database: settings.geotabDatabase,
        username: settings.geotabUsername,
        password: settings.geotabPassword ? '********' : 'MISSING'
    });

    if (settings.geotabServer && settings.geotabDatabase && settings.geotabUsername && settings.geotabPassword) {
        console.log('Attempting automatic Geotab re-authentication...');
        const auth = await geotabAuthenticate({
            server: settings.geotabServer,
            database: settings.geotabDatabase,
            username: settings.geotabUsername,
            password: settings.geotabPassword
        });
        if (auth.success) {
            return JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
        }
    }
    throw new Error('Not authenticated with Geotab. Please check credentials in Settings.');
}

async function fetchGeotabVehicles() {
    try {
        const session = await ensureGeotabSession();
        const response = await axios.post(`https://${session.server}/apiv1`, {
            method: "Get",
            params: {
                typeName: "Device",
                credentials: session.credentials
            }
        });

        if (response.data.error) {
            if (response.data.error.name === 'DbUnavailableException' || response.data.error.name === 'InvalidUserException') {
                const sessionPath = getDataPath('geotab-session.json');
                if (fs.existsSync(sessionPath)) fs.unlinkSync(sessionPath);
                return await fetchGeotabVehicles(); // Recurse once
            }
            throw new Error(response.data.error.message);
        }
        return { success: true, vehicles: response.data.result };
    } catch (err) {
        console.error('Geotab Vehicles Error:', err.message);
        return { success: false, error: err.message };
    }
}

async function fetchGeotabELD(fromDate, toDate) {
    try {
        const session = await ensureGeotabSession();
        const response = await axios.post(`https://${session.server}/apiv1`, {
            method: "Get",
            params: {
                typeName: "DutyStatusLog",
                search: {
                    fromDate: fromDate || new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
                    toDate: toDate || new Date().toISOString()
                },
                credentials: session.credentials
            }
        });

        if (response.data.error) {
            if (response.data.error.name === 'DbUnavailableException' || response.data.error.name === 'InvalidUserException') {
                const sessionPath = getDataPath('geotab-session.json');
                if (fs.existsSync(sessionPath)) fs.unlinkSync(sessionPath);
                return await fetchGeotabELD(fromDate, toDate); // Recurse once
            }
            throw new Error(response.data.error.message);
        }
        return { success: true, logs: response.data.result };
    } catch (err) {
        console.error('Geotab ELD Error:', err.message);
        return { success: false, error: err.message };
    }
}

// --- Job Cache for Offline Use ---
function saveJobCache(jobs) {
    const cachePath = getDataPath('jobs-cache.json');
    const cacheData = {
        timestamp: new Date().toISOString(),
        jobs: jobs
    };
    fs.writeFileSync(cachePath, JSON.stringify(cacheData, null, 2));
    console.log(`Job cache saved: ${jobs.length} jobs at ${cacheData.timestamp}`);
}

function loadJobCache() {
    const cachePath = getDataPath('jobs-cache.json');
    if (fs.existsSync(cachePath)) {
        try {
            const data = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
            console.log(`Job cache loaded: ${data.jobs?.length || 0} jobs from ${data.timestamp}`);
            return data;
        } catch (e) {
            console.error('Failed to load job cache:', e);
            return null;
        }
    }
    return null;
}

// --- C.H. Robinson Navisphere Integration (Moved to Greens App) ---


function saveCHRTokenCache() {
    const cachePath = getDataPath('chr-token-cache.json');
    const data = {
        accessToken: chrAccessToken,
        refreshToken: chrRefreshToken,
        expiry: chrTokenExpiry?.toISOString()
    };
    fs.writeFileSync(cachePath, JSON.stringify(data, null, 2));
}

async function getCHRobinsonToken() {
    // Check if we have a valid cached token
    if (chrAccessToken && chrTokenExpiry && new Date() < chrTokenExpiry) {
        console.log('✅ Using cached CHR token');
        return chrAccessToken;
    }

    // Try to load from cache
    if (loadCHRTokenCache()) {
        return chrAccessToken;
    }

    // Try to refresh if we have a refresh token
    if (chrRefreshToken) {
        try {
            console.log('🔄 Refreshing CHR token...');
            const params = new URLSearchParams();
            params.append('grant_type', 'refresh_token');
            params.append('refresh_token', chrRefreshToken);
            params.append('client_id', CHR_CLIENT_ID);
            if (CHR_CLIENT_SECRET) {
                params.append('client_secret', CHR_CLIENT_SECRET);
            }

            const response = await axios.post(CHR_TOKEN_URL, params, {
                headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
            });

            chrAccessToken = response.data.access_token;
            chrRefreshToken = response.data.refresh_token || chrRefreshToken;
            const expiresIn = response.data.expires_in || 3600;
            chrTokenExpiry = new Date(Date.now() + (expiresIn - 60) * 1000);
            saveCHRTokenCache();

            console.log('✅ CHR token refreshed');
            return chrAccessToken;
        } catch (e) {
            console.log('⚠️ Refresh failed, need new login');
            chrRefreshToken = null;
        }
    }

    // Need to do browser-based authorization with PKCE
    console.log('🔐 Opening CHR login window...');

    // Generate PKCE code_verifier and code_challenge
    const crypto = require('crypto');
    const codeVerifier = crypto.randomBytes(32).toString('base64url');
    const codeChallenge = crypto.createHash('sha256').update(codeVerifier).digest('base64url');

    return new Promise((resolve, reject) => {
        const authWindow = new BrowserWindow({
            width: 800,
            height: 700,
            show: true,
            webPreferences: {
                nodeIntegration: false,
                contextIsolation: true
            }
        });

        // Build authorization URL with PKCE
        const state = crypto.randomBytes(16).toString('hex');
        const authUrl = `${CHR_AUTH_URL}?` + new URLSearchParams({
            client_id: CHR_CLIENT_ID,
            response_type: 'code',
            scope: CHR_SCOPE,
            redirect_uri: CHR_REDIRECT_URI,
            state: state,
            code_challenge: codeChallenge,
            code_challenge_method: 'S256'
        }).toString();

        console.log('📋 PKCE code_verifier generated, opening auth URL...');
        authWindow.loadURL(authUrl);

        // Listen for navigation to redirect URI with auth code
        const handleNavigation = async (event, url) => {
            if (!url.startsWith(CHR_REDIRECT_URI)) return;

            try {
                const urlObj = new URL(url);
                const code = urlObj.searchParams.get('code');

                if (!code) {
                    const error = urlObj.searchParams.get('error_description') || 'No authorization code received';
                    authWindow.close();
                    return reject(new Error(error));
                }

                console.log('🔑 Got auth code, exchanging for token with PKCE verifier...');

                // Exchange code for tokens with PKCE code_verifier
                const params = new URLSearchParams();
                params.append('grant_type', 'authorization_code');
                params.append('code', code);
                params.append('redirect_uri', CHR_REDIRECT_URI);
                params.append('client_id', CHR_CLIENT_ID);
                if (CHR_CLIENT_SECRET) {
                    params.append('client_secret', CHR_CLIENT_SECRET);
                }
                params.append('code_verifier', codeVerifier);

                const response = await axios.post(CHR_TOKEN_URL, params, {
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
                });

                chrAccessToken = response.data.access_token;
                chrRefreshToken = response.data.refresh_token;
                const expiresIn = response.data.expires_in || 3600;
                chrTokenExpiry = new Date(Date.now() + (expiresIn - 60) * 1000);
                saveCHRTokenCache();

                console.log('✅ CHR Authentication successful');
                authWindow.close();
                resolve(chrAccessToken);
            } catch (error) {
                console.error('❌ Token exchange failed:', error.response?.data || error.message);
                authWindow.close();
                reject(new Error(`Token exchange failed: ${error.response?.data?.error_description || error.message}`));
            }
        };

        authWindow.webContents.on('will-redirect', handleNavigation);
        authWindow.webContents.on('will-navigate', handleNavigation);

        authWindow.on('closed', () => {
            if (!chrAccessToken) {
                reject(new Error('Login window was closed before authentication completed'));
            }
        });
    });
}

async function fetchCHRobinsonShipments() {
    try {
        const token = await getCHRobinsonToken();

        console.log('📦 Fetching shipments from C.H. Robinson...');

        const endpoints = [
            'https://api.chrobinson.com/v1/events',
            'https://api.chrobinson.com/v1/shipment-events',
            'https://api.chrobinson.com/v1/load-events',
            'https://api.chrobinson.com/v1/shipments/events',
            'https://api.chrobinson.com/v1/loads/events',
            'https://api.chrobinson.com/v1/tracking/shipments',
            'https://api.chrobinson.com/v1/shipments/active',
            'https://api.chrobinson.com/v1/shipments',
            'https://api.chrobinson.com/v2/shipments',
            'https://api.chrobinson.com/v1/loads',
            'https://api.chrobinson.com/v2/loads',
            'https://api.chrobinson.com/shipments/v1',
            'https://api.chrobinson.com/shipments/v2',
            'https://api.chrobinson.com/v1/shipments/tracking',
            'https://api.chrobinson.com/v1/shipment-status',
            'https://customer-api.chrobinson.com/homepage/v1/shipments',
            'https://customer-api.chrobinson.com/homepage/v1/loads',
            'https://api.navisphere.com/v1/shipments',
            'https://online.chrobinson.com/api/shipments',
            'https://inavisphere.chrobinson.com/api/shipments'
        ];

        let response = null;
        let lastError = null;

        for (const endpoint of endpoints) {
            try {
                console.log(`🔍 Trying endpoint: ${endpoint}`);
                response = await axios.get(endpoint, {
                    headers: {
                        'Authorization': `Bearer ${token}`,
                        'Accept': 'application/json'
                    },
                    params: {
                        status: 'active',
                        limit: 50
                    },
                    timeout: 10000
                });
                console.log(`✅ Success with endpoint: ${endpoint}`);
                break;
            } catch (e) {
                if (e.response) {
                    lastError = `Status ${e.response.status}: ${JSON.stringify(e.response.data || e.response.statusText)}`;
                    console.log(`❌ Endpoint failed (${endpoint}):`, lastError);

                    // If we get a 401, the token might be bad - don't keep trying endpoints
                    if (e.response.status === 401) {
                        throw new Error(`Authentication failed (401). Please try logging out and in again. Details: ${lastError}`);
                    }
                } else {
                    lastError = e.message;
                    console.log(`❌ Endpoint failed (${endpoint}): ${e.message}`);
                }
            }
        }

        if (!response) {
            throw new Error(`Failed to fetch shipments: Could not find working API endpoint. C.H. Robinson may require a registered API application or specific scopes. Last error: ${lastError}`);
        }

        const shipments = response.data.shipments || response.data.loads || response.data.data || response.data;

        // Map to our format
        const mappedShipments = (Array.isArray(shipments) ? shipments : []).map((s, index) => ({
            id: s.shipmentId || s.id || Date.now() + index,
            trackingNumber: s.trackingNumber || s.loadNumber || s.shipmentId || `CHR-${Date.now()}`,
            orderName: s.customerReference || s.orderName || s.poNumber || '',
            origin: formatLocation(s.origin || s.pickup),
            destination: formatLocation(s.destination || s.delivery),
            status: mapCHRStatus(s.status || s.shipmentStatus),
            eta: s.estimatedDeliveryDate || s.eta || s.delivery?.appointmentDate || '',
            carrier: s.carrierName || 'C.H. Robinson',
            description: s.commodityDescription || s.description || '',
            lastUpdate: s.lastUpdated || new Date().toISOString()
        }));

        console.log(`✅ Fetched ${mappedShipments.length} shipments from C.H. Robinson`);

        // Cache the shipments
        saveShipmentsCache(mappedShipments);

        return { success: true, shipments: mappedShipments };
    } catch (error) {
        console.error('❌ Failed to fetch CHR shipments:', error.response?.data || error.message);
        if (error.response?.data) {
            console.log('❌ Error Response Data:', JSON.stringify(error.response.data, null, 2));
        }

        // Try to return cached data
        const cached = loadShipmentsCache();
        if (cached) {
            return { success: true, shipments: cached.shipments, cached: true };
        }

        return { success: false, error: error.message };
    }
}

function formatLocation(loc) {
    if (!loc) return '';
    if (typeof loc === 'string') return loc;
    const city = loc.city || loc.cityName || '';
    const state = loc.state || loc.stateProvinceCode || '';
    return city && state ? `${city}, ${state}` : city || state || '';
}


// --- SharePoint / MS Graph Integration ---
let msalClient = null;

function getCachePath() {
    return getDataPath('msal-cache.json');
}

const tokenCachePlugin = {
    beforeCacheAccess: async (cacheContext) => {
        const cachePath = getCachePath();
        if (fs.existsSync(cachePath)) {
            try {
                const encryptedData = fs.readFileSync(cachePath);
                let data = encryptedData;

                // Decrypt if possible (only works on the same machine/user)
                if (safeStorage.isEncryptionAvailable()) {
                    try {
                        data = safeStorage.decryptString(encryptedData);
                    } catch (e) {
                        console.warn('Failed to decrypt MSAL cache, might be from a different machine/user. Resetting cache.');
                        data = null;
                    }
                }

                if (data) {
                    cacheContext.tokenCache.deserialize(data);
                    console.log('MSAL Cache loaded and decrypted from disk.');
                }
            } catch (e) {
                console.error('Failed to load MSAL cache:', e);
            }
        }
    },
    afterCacheAccess: async (cacheContext) => {
        const cachePath = getCachePath();
        if (cacheContext.cacheHasChanged) {
            try {
                let data = cacheContext.tokenCache.serialize();
                let finalData = data;

                // Encrypt if possible
                if (safeStorage.isEncryptionAvailable()) {
                    finalData = safeStorage.encryptString(data);
                }

                fs.writeFileSync(cachePath, finalData);
                console.log('MSAL Cache encrypted and saved to disk.');
            } catch (e) {
                console.error('Failed to save MSAL cache:', e);
            }
        }
    },
};

async function getAccessToken() {
    const settings = loadSettings();

    // START CHANGE: Prioritize Settings over .env and fix client reset
    // Prioritize file settings (which default to .env if empty)
    // The previous code `process.env.AZURE_CLIENT_ID || settings.clientId` forced .env to always win.
    const clientId = settings.clientId || process.env.AZURE_CLIENT_ID;
    const tenantId = settings.tenantId || process.env.AZURE_TENANT_ID;

    if (!clientId || !tenantId) {
        console.error('Azure AD credentials missing');
        throw new Error('Azure AD Credentials Missing: Please enter Client ID and Tenant ID in Settings.');
    }

    // Check if configuration changed, needing a new client
    if (msalClient) {
        if (msalClient._customClientId !== clientId || msalClient._customTenantId !== tenantId) {
            console.log('Configuration changed, resetting MSAL client.');
            msalClient = null;
        }
    }

    if (!msalClient) {
        msalClient = new PublicClientApplication({
            auth: {
                clientId: clientId,
                authority: `https://login.microsoftonline.com/${tenantId}`
            },
            cache: {
                cachePlugin: tokenCachePlugin
            }
        });
        msalClient._customClientId = clientId;
        msalClient._customTenantId = tenantId;
    }
    // END CHANGE

    try {
        const tokenCache = msalClient.getTokenCache();
        const accounts = await tokenCache.getAllAccounts();

        if (accounts.length > 0) {
            console.log(`Found ${accounts.length} cached accounts. Attempting silent token for: ${accounts[0].username}`);
            const silentRequest = {
                account: accounts[0],
                scopes: ['Files.Read.All', 'Sites.Read.All'],
            };
            try {
                const result = await msalClient.acquireTokenSilent(silentRequest);
                console.log('✅ Silent token acquisition successful.');
                console.log('   Token expires:', result.expiresOn);
                if (mainWindow) mainWindow.webContents.send('auth-message', ''); // Clear message if successful
                return result.accessToken;
            } catch (silentError) {
                console.log('⚠️ Silent token acquisition failed:', silentError.message);
                console.log('   Error name:', silentError.name);
            }
        } else {
            console.log('⚠️ No cached accounts found in MSAL cache.');
        }
    } catch (error) {
        console.error('❌ Error accessing token cache:', error);
        // Don't return null, let flow continue to interactive or throw if critical
    }

    try {
        console.log('🔐 Initiating device code flow...');
        console.log('   Client ID:', clientId);
        console.log('   Tenant ID:', tenantId);

        const authResponse = await msalClient.acquireTokenByDeviceCode({
            scopes: ['Files.Read.All', 'Sites.Read.All'],
            // No timeout - use MSAL default (900 seconds / 15 minutes)
            deviceCodeCallback: (response) => {
                console.log('📱 Device code received:', response.userCode);
                console.log('   Verification URI:', response.verificationUri);
                console.log('   Expires in:', response.expiresIn, 'seconds');
                // Open the browser for them automatically!
                if (response.verificationUri) {
                    shell.openExternal(response.verificationUri);
                }
                if (mainWindow) {
                    mainWindow.webContents.send('auth-message', response.message);
                }
            }
        });

        console.log('✅ Authentication successful!');
        console.log('   Account:', authResponse.account?.username);
        console.log('   Token expires:', authResponse.expiresOn);
        console.log('   Scopes:', authResponse.scopes?.join(', '));

        if (mainWindow) mainWindow.webContents.send('auth-message', ''); // Clear message
        return authResponse.accessToken;
    } catch (error) {
        console.error('❌ Auth Error during device code flow:');
        console.error('   Name:', error.name);
        console.error('   Message:', error.message);
        console.error('   Error code:', error.errorCode);
        console.error('   Suberror:', error.subError);

        // Propagate the actual error message
        throw new Error(`Authentication Failed: ${error.message}`);
    }
}

async function determineStandard(event, answers) {
    const settings = loadSettings();
    const openaiKey = process.env.OPENAI_API_KEY || settings.openaiKey;
    if (!openaiKey) throw new Error('OpenAI key missing. Please check settings or .env file.');

    const cleanKey = openaiKey.trim();

    try {
        const response = await axios.post('https://api.openai.com/v1/chat/completions', {
            model: "gpt-4o",
            messages: [
                {
                    role: "system",
                    content: `You are an expert in industrial load testing standards.
                    
                    Return your response as a RAW JSON object.
                    Fields: 
                    - "standards": An array of objects, one for each applicable standard.
                      Each object must have:
                      - "referenceId": ONLY the alphanumeric identifier (e.g. "ASME B30.2", "OSHA 1910.179"). No sentences.
                      - "explanation": A concise explanation of why this standard applies.
                    - "generalExplanation": A summary explanation for the technician.`
                },
                {
                    role: "user",
                    content: `Identify ALL applicable standards for: ${answers.equipment} in ${answers.environment}. Target load: ${answers.wllPercentage}. If multiple standards apply (e.g. both ASME and OSHA), include all of them.`
                }
            ],
            response_format: { type: "json_object" },
            temperature: 0
        }, {
            headers: {
                'Authorization': `Bearer ${cleanKey}`,
                'Content-Type': 'application/json'
            }
        });

        const content = response.data.choices[0].message.content;
        try {
            const parsed = JSON.parse(content);
            const standards = (parsed.standards || []).map(s => {
                let id = s.referenceId || s.id || "";
                if (id.includes(' ') && id.length > 20) {
                    const match = id.match(/(ASME|OSHA|ASTM|ISO|CMAA)\s?[A-Z0-9.]+/i);
                    if (match) id = match[0];
                }
                return {
                    referenceId: id.trim().toUpperCase(),
                    explanation: s.explanation || ""
                };
            }).filter(s => s.referenceId !== "");

            // Support legacy single-result format just in case
            if (standards.length === 0 && (parsed.referenceId || parsed.conciseStandard)) {
                let id = parsed.referenceId || parsed.conciseStandard || "";
                if (id.includes(' ') && id.length > 20) {
                    const match = id.match(/(ASME|OSHA|ASTM|ISO|CMAA)\s?[A-Z0-9.]+/i);
                    if (match) id = match[0];
                }
                standards.push({
                    referenceId: id.trim().toUpperCase(),
                    explanation: parsed.explanation || ""
                });
            }

            return {
                standards: standards,
                generalExplanation: parsed.generalExplanation || ""
            };
        } catch (e) {
            return {
                standards: [{ referenceId: "CHECK STANDARD", explanation: "Parsing error" }],
                generalExplanation: content
            };
        }
    } catch (err) {
        const errorDetail = err.response?.data?.error?.message || err.message;
        console.error('AI Error Detail:', err.response?.data || err.message);
        throw new Error(`AI Assistant Error: ${errorDetail}`);
    }
}

async function fetchLeadList() {
    try { fs.writeFileSync('C:\\oscar_debug.txt', 'fetchLeadList started at ' + new Date().toISOString()); } catch (e) { }
    console.log('Starting fetchLeadList...');
    const token = await getAccessToken(); // Now throws on error
    // Token valid if we get here


    const settings = loadSettings();
    const sharepointSite = settings.sharepointSite || 'https://oscarapp.sharepoint.com/sites/Production';
    const leadListName = settings.leadListName || 'Lead List';

    console.log('SharePoint Site:', sharepointSite);
    console.log('Lead List Name:', leadListName);

    const config = { headers: { Authorization: `Bearer ${token}` } };

    try {
        // 1. Get Site ID
        let siteId;
        const urlObj = new URL(sharepointSite);
        const hostname = urlObj.hostname;
        const sitePath = urlObj.pathname.startsWith('/') ? urlObj.pathname : `/${urlObj.pathname}`;

        console.log(`Getting Site ID for ${hostname}:${sitePath}...`);
        try {
            const siteResponse = await axios.get(`https://graph.microsoft.com/v1.0/sites/${hostname}:${sitePath}`, config);
            siteId = siteResponse.data.id;
            console.log('Site ID found via direct path:', siteId);
        } catch (e) {
            console.log('Direct path site lookup failed, trying search fallback...');
            const searchResponse = await axios.get(`https://graph.microsoft.com/v1.0/sites?search=${path.basename(sitePath)}`, config);
            const foundSite = searchResponse.data.value.find(s => s.name === path.basename(sitePath));
            if (!foundSite) {
                console.error('Site search failed to find matching site name.');
                throw new Error(`Site at ${sharepointSite} not found`);
            }
            siteId = foundSite.id;
            console.log('Site ID found via search:', siteId);
        }

        // 2. Get List ID
        console.log(`Getting List ID for "${leadListName}"...`);
        const listsResponse = await axios.get(`https://graph.microsoft.com/v1.0/sites/${siteId}/lists`, config);
        const list = listsResponse.data.value.find(l => l.name === leadListName || l.displayName === leadListName);

        if (!list) {
            const listNames = listsResponse.data.value.map(l => l.displayName || l.name).join(', ');
            console.error('Available lists:', listNames);
            throw new Error(`List "${leadListName}" not found. Available lists: ${listNames}`);
        }

        const listId = list.id;
        console.log('List ID found:', listId);


        // 3. Get Items (Expand fields to get actual data, sorted by most recent first)
        console.log('Fetching list items (expand=fields, orderby=lastModifiedDateTime desc)...');
        const itemsResponse = await axios.get(`https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${listId}/items?expand=fields&$orderby=lastModifiedDateTime desc&$top=200`, config);

        console.log(`Total items fetched: ${itemsResponse.data.value.length}`);


        if (itemsResponse.data.value.length === 0) {
            console.warn('SharePoint returned 0 items. Check if the list name and permissions are correct.');
            return [];
        }

        const allItems = itemsResponse.data.value.map(item => {
            const fields = item.fields || {};

            // Helper to find a field by various common SharePoint internal name patterns
            const getField = (displayNames) => {
                for (let name of displayNames) {
                    if (fields[name] !== undefined) {
                        const val = fields[name];
                        if (val && typeof val === 'object' && val.Value) return val.Value;
                        return val;
                    }
                    const cleanName = name.replace(/[^a-zA-Z0-9]/g, '');
                    if (fields[cleanName] !== undefined) {
                        const val = fields[cleanName];
                        if (val && typeof val === 'object' && val.Value) return val.Value;
                        return val;
                    }
                }
                const key = Object.keys(fields).find(k =>
                    displayNames.some(dn => k.toLowerCase() === dn.toLowerCase().replace(/ /g, ''))
                );
                if (key) {
                    const val = fields[key];
                    if (val && typeof val === 'object' && val.Value) return val.Value;
                    return val;
                }
                return undefined;
            };

            return {
                ...fields,
                id: item.id,
                QuoteNum: getField(['QuoteNum', 'Quote Number', 'Quote_x0023_', 'Title']),
                Customer: getField(['Customer', 'Client']),
                LeadCompany: getField(['LeadCompany', 'Company', 'Lead Company']),
                PODate: getField(['PODate', 'PO Date']),
                PONumber: getField(['PONumber', 'PONum', 'PO_x0020_Number', 'PurchaseOrder']),
                JobNum: getField(['JobNumber', 'Job_x0023_', 'Job Num']),
                ProjType: getField(['ProjType', 'Project Type', 'Type']),
                Status: getField(['Status', 'LeadStatus', 'JobStatus', 'Job_x0020_Status'])
            };
        });


        // Filter for Project Type "Service" OR "Rental" AND "PO Received" indicator
        const filteredItems = allItems.filter((item, index) => {
            const type = (item.ProjType || "").toString().trim().toLowerCase();
            const status = (item.Status || "").toString().trim().toLowerCase();
            const poNum = (item.PONumber || item.PONum || "").toString().trim();

            const isService = type === 'service';

            // Heuristic for "PO Received": 
            // 1. Explicit status string
            // 2. Presence of a PO Number
            const isAwarded = status.includes('po received') || status.includes('awarded') || poNum.length > 0;

            return isService && isAwarded;
        });


        // Sort by ID descending (most recent first)
        filteredItems.sort((a, b) => parseInt(b.id) - parseInt(a.id));

        console.log(`[BACKEND] Found ${filteredItems.length} service jobs. (Total: ${allItems.length})`);


        // Cache the results for offline use
        saveJobCache(filteredItems);

        return filteredItems;

    } catch (err) {
        const errorMsg = err.response?.data?.error?.message || err.message;
        const errorStack = err.stack || '';


        console.error('SharePoint Fetch failed, trying cache:', errorMsg);
        const cached = loadJobCache();
        if (cached && cached.jobs) {
            console.log('Returning cached jobs for offline state.');
            return cached.jobs;
        }

        throw new Error(`SharePoint Error: ${errorMsg}`);
    }
}

// --- Inventory List Fetch (Removed: Moved to Greens App) ---

function saveData(event, data, filename) {
    const dataPath = getDataPath(filename);
    try {
        fs.writeFileSync(dataPath, JSON.stringify(data));
        return { success: true };
    } catch (error) {
        console.error('Failed to save data:', error);
        return { success: false, error: error.message };
    }
}

function loadData(event, filename) {
    const dataPath = getDataPath(filename);
    try {
        if (fs.existsSync(dataPath)) {
            const data = fs.readFileSync(dataPath, 'utf-8');
            return JSON.parse(data);
        }
        return null;
    } catch (error) {
        console.error('Failed to load data:', error);
        return null;
    }
}

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        icon: path.join(__dirname, '../../public/icon.png'),
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: false,
            contextIsolation: true,
            backgroundThrottling: false,
            webviewTag: true, // Enable webview for embedded browsing
        },
    });

    // Check if we are in dev mode (Vite server running)
    const isDev = !app.isPackaged;

    if (isDev) {
        mainWindow.loadURL('http://localhost:5173');
        mainWindow.webContents.openDevTools();
    } else {
        mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
    }

    // Send initial status after window loads
    mainWindow.webContents.on('did-finish-load', () => {
        mainWindow.webContents.send('device-status-changed', deviceStatus);
    });
}

app.whenReady().then(() => {
    // Clear saved data on restart
    ['dashboard-data.json', 'cert-info.json'].forEach(file => {
        const filePath = getDataPath(file);
        if (fs.existsSync(filePath)) {
            try {
                fs.unlinkSync(filePath);
            } catch (e) {
                console.error(`Failed to clear ${file}:`, e);
            }
        }
    });

    // Load T24 Group ID from settings
    const settings = loadSettings();
    if (settings.t24GroupId !== undefined) {
        t24Reader.setGroupId(settings.t24GroupId);
    }
    if (settings.t24ScaleFactors) {
        t24Reader.loadScaleFactors(settings.t24ScaleFactors);
    }

    ipcMain.handle('dialog:openFile', handleFileOpen);
    ipcMain.handle('storage:save', saveData);
    ipcMain.handle('storage:load', loadData);
    ipcMain.handle('t24:wakeSensors', (event) => {
        t24Reader.manualWake();
        return { success: true };
    });

    ipcMain.handle('t24:toggleKeepAwake', (event, enabled) => {
        if (enabled) {
            t24Reader.startKeepAwake();
        } else {
            t24Reader.stopKeepAwake();
        }
        return { success: true };
    });

    ipcMain.handle('t24:getKeepStatus', (event) => {
        return t24Reader.keepAwakeTimer !== null;
    });

    ipcMain.handle('t24:startPolling', (event, tags) => {
        t24Reader.startPolling(tags);
        return { success: true };
    });

    ipcMain.handle('t24:stopPolling', (event) => {
        t24Reader.stopPolling();
        return { success: true };
    });

    ipcMain.handle('t24:tare', (event, tag) => {
        t24Reader.tare(tag);
        return { success: true };
    });

    ipcMain.handle('t24:clearTare', (event, tag) => {
        t24Reader.clearTare(tag);
        return { success: true };
    });

    ipcMain.handle('storage:savePDF', handleSavePDF);
    ipcMain.handle('storage:saveCSV', handleSaveCSV);

    // Settings & SharePoint
    ipcMain.handle('settings:load', (event) => loadSettings());
    ipcMain.handle('settings:save', saveSettings);
    ipcMain.handle('sharepoint:fetchJobs', fetchLeadList);
    ipcMain.handle('sharepoint:getJobsCache', () => loadJobCache());
    ipcMain.handle('sharepoint:logout', async () => {
        const cachePath = getCachePath();
        if (fs.existsSync(cachePath)) fs.unlinkSync(cachePath);
        msalClient = null; // Force recreation with fresh cache state
        return { success: true };
    });
    ipcMain.handle('ai:determineStandard', determineStandard);
    ipcMain.handle('t24:getStatus', () => deviceStatus);

    // --- Geotab Logic ---
    // (Functions moved to top level for global access)

    // Geotab API Integration
    ipcMain.handle('geotab:authenticate', async (event, credentials) => {
        try {
            return await geotabAuthenticate(credentials);
        } catch (err) {
            console.error('Geotab Auth Error:', err.message);
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('geotab:fetchVehicles', async () => {
        try {
            return await fetchGeotabVehicles();
        } catch (err) {
            console.error('Geotab Vehicles Error:', err.message);
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('geotab:fetchELD', async (event, { fromDate, toDate }) => {
        try {
            return await fetchGeotabELD(fromDate, toDate);
        } catch (err) {
            console.error('Geotab ELD Error:', err.message);
            return { success: false, error: err.message };
        }
    });

    // Utilities
    ipcMain.handle('shell:openExternal', (event, url) => {
        if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
            shell.openExternal(url);
            return { success: true };
        }
        return { success: false, error: 'Invalid URL' };
    });


    // Persistence & Recovery
    ipcMain.handle('t24:checkRecovery', () => {
        const logPath = path.join(app.getPath('userData'), 'safety-log.jsonl');
        if (fs.existsSync(logPath)) {
            try {
                const stats = fs.statSync(logPath);
                return stats.size > 10; // More than just a few bytes
            } catch (e) { return false; }
        }
        return false;
    });

    ipcMain.handle('t24:loadRecovery', () => {
        const logPath = path.join(app.getPath('userData'), 'safety-log.jsonl');
        if (fs.existsSync(logPath)) {
            try {
                const content = fs.readFileSync(logPath, 'utf-8');
                const lines = content.split('\n').filter(l => l.trim());
                return lines.map(l => JSON.parse(l));
            } catch (e) { return []; }
        }
        return [];
    });

    ipcMain.handle('t24:clearRecovery', () => {
        const logPath = path.join(app.getPath('userData'), 'safety-log.jsonl');
        if (fs.existsSync(logPath)) {
            try { fs.unlinkSync(logPath); } catch (e) { }
        }
        return true;
    });

    ipcMain.on('t24:startSafetyLog', (event, intervalMs) => {
        t24Reader.startSafetyLog(intervalMs);
    });

    ipcMain.on('t24:stopSafetyLog', () => {
        t24Reader.stopSafetyLog();
    });

    // Initial scan before window creates
    scanForDongle();

    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
