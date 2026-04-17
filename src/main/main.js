const { app, BrowserWindow, ipcMain, dialog, shell, safeStorage, powerSaveBlocker } = require('electron');
const path = require('path');
const { exec } = require('child_process');
const fs = require('fs');
require('dotenv').config();
const HID = require('node-hid');
const { PublicClientApplication } = require('@azure/msal-node');
const axios = require('axios');
const XLSX = require('xlsx-js-style');
const CompanionServer = require('./companion-server');
const AppUpdater = require('./updater');
const {
    T24_VID, T24_PID, HID_BUFFER_SIZE,
    REPORT_ID_POLL, REPORT_ID_CONTROL, REPORT_ID_DATA,
    CMD_STAY_AWAKE, CMD_WAKE_UP, CMD_REQUEST_DATA,
    BROADCAST_ADDR, DATA_TAG_OFFSET, WEIGHT_VALUE_OFFSET, MIN_PACKET_LENGTH,
    WAKE_BURST_COUNT, WAKE_BURST_INTERVAL_MS,
    KEEP_AWAKE_INTERVAL_MS, POLL_INTERVAL_MS, DEVICE_SCAN_INTERVAL_MS,
    DEFAULT_GROUP_ID, SMOOTHING_BUFFER_SIZE, MAX_REASONABLE_VALUE,
    WEIGHT_CONVERSION,
} = require('./config/hardware');

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
        this.groupId = DEFAULT_GROUP_ID; // Will be loaded from settings
        this.scaleFactors = new Map(); // Tag -> Scale Factor (default 1.0)
        this.sampleBuffers = new Map(); // Tag -> Array of last N samples
        this.autoDetectBuffers = new Map(); // Tag -> Array of raw packet buffers for auto-detection
        this.autoDetectComplete = new Set(); // Tags that have been auto-detected
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
            // If parsing failed, the file may be corrupted. Back it up and start fresh.
            if (err instanceof SyntaxError) {
                try {
                    const userDataPath = path.join(app.getPath('userData'), 'calibration.json');
                    if (fs.existsSync(userDataPath)) {
                        const backupPath = userDataPath + '.corrupted.' + Date.now();
                        fs.renameSync(userDataPath, backupPath);
                        console.warn(`[CALIBRATION] Corrupted config backed up to: ${backupPath}`);
                    }
                } catch (backupErr) {
                    console.error('[CALIBRATION] Failed to backup corrupted config:', backupErr);
                }
            }
        }
    }

    autoDetectTag(tagHex, samples) {
        // Try all 4 combinations: BE/LE x raw/tonnes-converted
        // Pick the one where values are most reasonable for a load cell reading in lbs
        const combos = [
            { useFloatLE: false, skipTonnesConversion: false, label: 'BE+tonnes' },
            { useFloatLE: false, skipTonnesConversion: true, label: 'BE+raw' },
            { useFloatLE: true, skipTonnesConversion: false, label: 'LE+tonnes' },
            { useFloatLE: true, skipTonnesConversion: true, label: 'LE+raw' },
        ];

        let bestCombo = combos[0];
        let bestScore = Infinity;

        for (const combo of combos) {
            const values = samples.map(buf => {
                const raw = combo.useFloatLE
                    ? buf.readFloatLE(WEIGHT_VALUE_OFFSET)
                    : buf.readFloatBE(WEIGHT_VALUE_OFFSET);
                return combo.skipTonnesConversion ? raw : raw * WEIGHT_CONVERSION.TONNES_TO_LBS;
            });

            // Filter out non-finite values
            const finite = values.filter(v => isFinite(v));
            if (finite.length < samples.length * 0.8) continue; // Too many garbage values

            const mean = finite.reduce((a, b) => a + b, 0) / finite.length;
            const variance = finite.reduce((a, v) => a + (v - mean) ** 2, 0) / finite.length;
            const absMean = Math.abs(mean);

            // Penalize values outside reasonable range heavily
            if (absMean > MAX_REASONABLE_VALUE) continue;

            // Scoring: A real load cell in lbs should produce values in a typical range.
            // Key insight: if the raw float is very small (< 1), it's likely in tonnes
            // and needs conversion. If it's in the hundreds/thousands, it's already lbs.
            // We prefer values that land in the "typical load cell lbs" range: 0-50000 lbs.
            // Penalize values that are suspiciously small (< 1 lbs) — likely wrong unit.
            let score = absMean + Math.sqrt(variance) * 0.5;

            // If the result is extremely small (< 1 lbs), it's probably in the wrong unit
            // A real lbs reading even unloaded usually has some offset (10+ lbs)
            if (absMean < 1.0) {
                score += 10000; // Heavy penalty — this is likely tonnes, not lbs
            }

            if (score < bestScore) {
                bestScore = score;
                bestCombo = combo;
            }
        }

        // Build config
        const config = {};
        if (bestCombo.skipTonnesConversion) config.skipTonnesConversion = true;
        if (bestCombo.useFloatLE) config.useFloatLE = true;

        console.log(`[AUTO-DETECT] Tag ${tagHex}: detected ${bestCombo.label} (score: ${bestScore.toFixed(1)})`);
        console.log(`[AUTO-DETECT] Config for ${tagHex}:`, config);

        // Apply immediately
        this.calibrationConfig[tagHex] = { ...config, ...(this.calibrationConfig[tagHex] || {}) };

        // Persist to calibration.json
        this.saveCalibration();
    }

    saveCalibration() {
        try {
            const userDataPath = path.join(app.getPath('userData'), 'calibration.json');
            const projectRoot = path.resolve(__dirname, '../../');
            const devPath = path.join(projectRoot, 'config/calibration.json');
            const savePath = app.isPackaged ? userDataPath : devPath;
            fs.writeFileSync(savePath, JSON.stringify(this.calibrationConfig, null, 4));
            console.log(`[CALIBRATION] Saved config to ${savePath}`);
        } catch (err) {
            console.error('[CALIBRATION] Failed to save calibration config:', err);
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
            if (burstCount >= WAKE_BURST_COUNT) clearInterval(burstTimer);
        }, WAKE_BURST_INTERVAL_MS);

        if (this.keepAwakeTimer) return;

        console.log('Starting T24 Telemetry Maintenance pulse (65-byte buffers)...');

        // 2. Continuous Maintenance — LOG100-style aggressive keep-awake
        //    Sends stay-awake + wake-up broadcasts AND direct polls to all known tags
        this.keepAwakeTimer = setInterval(() => {
            if (this.device) {
                try {
                    // Stay Awake Broadcast (current group)
                    const stayAwake = Buffer.alloc(HID_BUFFER_SIZE);
                    stayAwake[0] = REPORT_ID_CONTROL;
                    stayAwake[1] = CMD_STAY_AWAKE;
                    stayAwake[2] = BROADCAST_ADDR;
                    stayAwake[3] = BROADCAST_ADDR;
                    stayAwake[4] = this.groupId;
                    this.device.write(stayAwake);

                    // Wake Up broadcast (current group)
                    const wakeUp = Buffer.alloc(HID_BUFFER_SIZE);
                    wakeUp[0] = REPORT_ID_CONTROL;
                    wakeUp[1] = CMD_WAKE_UP;
                    wakeUp[2] = BROADCAST_ADDR;
                    wakeUp[3] = BROADCAST_ADDR;
                    wakeUp[4] = this.groupId;
                    this.device.write(wakeUp);

                    // Send to Group 0 as well if not already on Group 0
                    if (this.groupId !== DEFAULT_GROUP_ID) {
                        const stayGlobal = Buffer.alloc(HID_BUFFER_SIZE);
                        stayGlobal[0] = REPORT_ID_CONTROL;
                        stayGlobal[1] = CMD_STAY_AWAKE;
                        stayGlobal[2] = BROADCAST_ADDR;
                        stayGlobal[3] = BROADCAST_ADDR;
                        stayGlobal[4] = DEFAULT_GROUP_ID;
                        this.device.write(stayGlobal);

                        const wakeGlobal = Buffer.alloc(HID_BUFFER_SIZE);
                        wakeGlobal[0] = REPORT_ID_CONTROL;
                        wakeGlobal[1] = CMD_WAKE_UP;
                        wakeGlobal[2] = BROADCAST_ADDR;
                        wakeGlobal[3] = BROADCAST_ADDR;
                        wakeGlobal[4] = DEFAULT_GROUP_ID;
                        this.device.write(wakeGlobal);
                    }

                    // Tag-specific polling is handled by startPolling() separately
                } catch (err) {
                    console.error('Stay-awake failed:', err);
                }
            }
        }, KEEP_AWAKE_INTERVAL_MS);
    }

    manualWake() {
        if (!this.device) return;
        if (this.manualWakeActive) return; // Prevent overlapping bursts
        this.manualWakeActive = true;
        console.log('User initiated MANUAL WAKE-UP burst (Global + Selected Group)...');
        let burstCount = 0;
        const burstTimer = setInterval(() => {
            // Send to selected group
            this.sendWakeBroadcast(this.groupId);
            // Also send to Group 0 (Global Wake) just in case
            if (this.groupId !== DEFAULT_GROUP_ID) {
                this.sendWakeBroadcast(DEFAULT_GROUP_ID);
            }
            burstCount++;
            if (burstCount >= WAKE_BURST_COUNT) {
                clearInterval(burstTimer);
                this.manualWakeActive = false;
                console.log('Manual wake burst complete.');
            }
        }, WAKE_BURST_INTERVAL_MS);
    }

    sendWakeBroadcast(groupId = this.groupId) {
        if (!this.device) return;
        try {
            // Wake Up Broadcast
            const wake = Buffer.alloc(HID_BUFFER_SIZE);
            wake[0] = REPORT_ID_CONTROL;
            wake[1] = CMD_WAKE_UP;
            wake[2] = BROADCAST_ADDR;
            wake[3] = BROADCAST_ADDR;
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

        // Also poll all previously discovered tags so they stay active and visible
        const allKnownTags = new Set([...this.pollTags, ...this.lastValues.keys()]);

        console.log(`Starting active polling for tags: ${[...allKnownTags].join(', ')}`);
        this.pollTimer = setInterval(() => {
            if (!this.device) return;
            // Re-check for newly discovered tags each interval
            const currentTags = new Set([...this.pollTags, ...this.lastValues.keys()]);
            currentTags.forEach(tag => {
                try {
                    const pollPacket = Buffer.alloc(HID_BUFFER_SIZE);
                    pollPacket[0] = REPORT_ID_POLL;
                    pollPacket[1] = CMD_REQUEST_DATA;
                    pollPacket[2] = parseInt(tag.slice(0, 2), 16);
                    pollPacket[3] = parseInt(tag.slice(2, 4), 16);
                    this.device.write(pollPacket);
                } catch (err) {
                    console.error('Polling error:', err);
                }
            });
        }, POLL_INTERVAL_MS);
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

        // Auto-enable keep-awake during logging
        this.wasKeepAwakeBeforeLog = !!this.keepAwakeTimer;
        if (!this.keepAwakeTimer) {
            this.startKeepAwake();
            console.log('[T24] Auto-enabled keep-awake for logging session.');
        }

        // Start watchdog: detect silent tags and aggressively wake them
        this.lastPacketTimes = new Map();
        this.startWatchdog();

        console.log('Safety Log started.');
    }

    stopSafetyLog() {
        this.isLogging = false;
        this.firstTimestamp = null;
        this.stopWatchdog();
        // Restore keep-awake to previous state
        if (!this.wasKeepAwakeBeforeLog && this.keepAwakeTimer) {
            this.stopKeepAwake();
            console.log('[T24] Auto-disabled keep-awake after logging session.');
        }
        if (this.powerSaveId !== null) {
            if (powerSaveBlocker.isStarted(this.powerSaveId)) {
                powerSaveBlocker.stop(this.powerSaveId);
                console.log(`[T24] Power save blocker stopped: ${this.powerSaveId}`);
            }
            this.powerSaveId = null;
        }
        console.log('Safety Log stopped.');
    }

    // LOG100-style watchdog: timer-based logging + aggressive reconnection
    // Unlike packet-driven logging, this fires on an interval and uses last-known
    // values when transmitters are silent — matching Mantracourt LOG100 behavior.
    startWatchdog() {
        this.stopWatchdog();
        const SILENT_THRESHOLD_MS = 3000; // 3 seconds = tag considered timed out
        const WATCHDOG_INTERVAL_MS = 2000; // Check every 2 seconds

        this.watchdogTimer = setInterval(() => {
            if (!this.isLogging || !this.device) return;
            const now = Date.now();

            for (const [tag, lastTime] of (this.lastPacketTimes || new Map())) {
                const silentMs = now - lastTime;

                if (silentMs > SILENT_THRESHOLD_MS) {
                    // Tag is silent — LOG100 behavior: use default/last-known value
                    // and aggressively try to wake the transmitter

                    // 1. Wake + poll for the silent tag (one pass to avoid USB flooding)
                    this.sendWakeBroadcast(this.groupId);
                    if (this.groupId !== DEFAULT_GROUP_ID) {
                        this.sendWakeBroadcast(DEFAULT_GROUP_ID);
                    }
                    try {
                        const stayAwake = Buffer.alloc(HID_BUFFER_SIZE);
                        stayAwake[0] = REPORT_ID_CONTROL;
                        stayAwake[1] = CMD_STAY_AWAKE;
                        stayAwake[2] = BROADCAST_ADDR;
                        stayAwake[3] = BROADCAST_ADDR;
                        stayAwake[4] = this.groupId;
                        this.device.write(stayAwake);
                    } catch (e) { }
                    try {
                        const pollPacket = Buffer.alloc(HID_BUFFER_SIZE);
                        pollPacket[0] = REPORT_ID_POLL;
                        pollPacket[1] = CMD_REQUEST_DATA;
                        pollPacket[2] = parseInt(tag.slice(0, 2), 16);
                        pollPacket[3] = parseInt(tag.slice(2, 4), 16);
                        this.device.write(pollPacket);
                    } catch (e) { }

                    // 2. Emit heartbeat with last-known value (LOG100 "Default Value" behavior)
                    //    This keeps the recording continuous with no gaps
                    if (this.lastValues.has(tag) && mainWindow && !mainWindow.isDestroyed()) {
                        let value = this.lastValues.get(tag);
                        if (this.tares.has(tag)) {
                            value -= this.tares.get(tag);
                        }
                        const heartbeat = {
                            tag: tag,
                            value: value,
                            timestamp: now
                        };
                        mainWindow.webContents.send('live-data-packet', heartbeat);
                        // Forward heartbeat to companion
                        if (companionServer.isRunning) {
                            companionServer.sendLiveData(heartbeat);
                        }
                    }

                    // Log timeout event periodically (not every second to avoid spam)
                    if (silentMs % 10000 < WATCHDOG_INTERVAL_MS) {
                        console.log(`[WATCHDOG] Tag ${tag} timed out (${(silentMs / 1000).toFixed(0)}s) — using last-known value, sending wake commands`);
                    }
                }
            }
        }, WATCHDOG_INTERVAL_MS);
        console.log('[WATCHDOG] LOG100-style watchdog started (2s interval, 3s timeout threshold).');
    }

    stopWatchdog() {
        if (this.watchdogTimer) {
            clearInterval(this.watchdogTimer);
            this.watchdogTimer = null;
            console.log('[WATCHDOG] Watchdog stopped.');
        }
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

        if (data.length < MIN_PACKET_LENGTH) return;


        // CRITICAL: Only process Data Provider packets
        if (data[0] !== REPORT_ID_DATA) return;

        try {
            const dataTag = data.readUInt16BE(DATA_TAG_OFFSET);
            const tagHex = dataTag.toString(16).toUpperCase().padStart(4, '0');

            // Auto-detect calibration for unknown tags
            if (!this.calibrationConfig[tagHex] && !this.autoDetectComplete.has(tagHex)) {
                if (!this.autoDetectBuffers.has(tagHex)) {
                    this.autoDetectBuffers.set(tagHex, []);
                    console.log(`[AUTO-DETECT] New unknown tag ${tagHex}, collecting samples...`);
                }
                const buf = this.autoDetectBuffers.get(tagHex);
                buf.push(Buffer.from(data));
                if (buf.length >= 10) {
                    this.autoDetectTag(tagHex, buf);
                    this.autoDetectComplete.add(tagHex);
                    this.autoDetectBuffers.delete(tagHex);
                } else {
                    return; // Don't emit packets until detection is complete
                }
            }

            const config = this.calibrationConfig[tagHex] || {};
            const useFloatLE = config.useFloatLE !== undefined ? config.useFloatLE : false; // Default big endian

            let tonnes;
            if (useFloatLE) {
                tonnes = data.readFloatLE(WEIGHT_VALUE_OFFSET);
            } else {
                tonnes = data.readFloatBE(WEIGHT_VALUE_OFFSET);
            }

            let value;

            if (config.skipTonnesConversion) {
                value = tonnes; // Use raw float
            } else {
                value = tonnes * WEIGHT_CONVERSION.TONNES_TO_LBS; // Convert Metric Tonnes to LBS
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
            if (!isFinite(value) || Math.abs(value) > MAX_REASONABLE_VALUE) {
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
            if (buffer.length > SMOOTHING_BUFFER_SIZE) buffer.shift();

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

            // Track last packet time for watchdog
            if (this.lastPacketTimes) {
                this.lastPacketTimes.set(tagHex, Date.now());
            }

            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('live-data-packet', packet);
            }

            // Forward to companion server for mobile phones
            if (companionServer.isRunning) {
                companionServer.sendLiveData(packet);
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
const companionServer = new CompanionServer();
let mainWindow;
let deviceStatus = 'disconnected';



function scanForDongle() {
    try {
        const devices = HID.devices();
        const info = devices.find(d => d.vendorId === T24_VID && d.productId === T24_PID);
        const newStatus = info ? 'connected' : 'disconnected';

        if (newStatus !== deviceStatus) {
            const wasLogging = t24Reader.isLogging;
            const prevPollTags = [...t24Reader.pollTags];
            deviceStatus = newStatus;
            console.log(`Device status changed: ${deviceStatus}`);

            if (deviceStatus === 'connected') {
                t24Reader.open(info.path);
                // Ensure stay-awake is active by default on connection
                t24Reader.startKeepAwake();

                // Auto-reconnect: resume polling and logging if they were active before disconnect
                if (prevPollTags.length > 0) {
                    console.log('[AUTO-RECONNECT] Resuming polling for:', prevPollTags.join(', '));
                    t24Reader.startPolling(prevPollTags);
                }
                if (wasLogging) {
                    console.log('[AUTO-RECONNECT] Resuming logging session after dongle replug.');
                    // Re-enable logging state (watchdog, keep-awake, etc.)
                    t24Reader.isLogging = true;
                    t24Reader.startWatchdog();
                }
            } else {
                // Dongle unplugged — close device but DON'T clear logging state
                // so it can resume on replug
                t24Reader.stopWatchdog();
                if (t24Reader.device) {
                    try { t24Reader.device.close(); } catch (e) { }
                    t24Reader.device = null;
                }
                t24Reader.stopKeepAwake();
                console.log('[AUTO-RECONNECT] Dongle disconnected. Logging state preserved for reconnect.');
            }

            if (mainWindow && !mainWindow.isDestroyed()) {
                mainWindow.webContents.send('device-status-changed', deviceStatus);
            }

            // Forward device status to companion server for mobile phones
            if (companionServer.isRunning) {
                companionServer.updateSessionState({ deviceStatus });
            }
        }
    } catch (err) {
        console.error('Error scanning for HID devices:', err);
    }
}

// Start scanning for T24 dongle
setInterval(scanForDongle, DEVICE_SCAN_INTERVAL_MS);

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
            if (!data || data.length === 0) {
                return { success: false, error: 'No data to export' };
            }

            // Check if this is multi-tag live data (has Tag and Elapsed fields)
            const hasMultipleTags = data[0].Tag && data[0]['Elapsed (ms)'] !== undefined;

            let csvContent;

            if (hasMultipleTags) {
                // Pivot: one row per timestamp, one column per tag
                const tags = [...new Set(data.map(d => d.Tag))].sort();
                const timeGroups = new Map(); // elapsed -> { tag -> value, totalLoad }

                for (const row of data) {
                    const elapsed = row['Elapsed (ms)'];
                    if (!timeGroups.has(elapsed)) {
                        timeGroups.set(elapsed, { totalLoad: row['Total Load'] });
                    }
                    const group = timeGroups.get(elapsed);
                    group[row.Tag] = row.value;
                    // Keep the most recent total load for this timestamp
                    if (row['Total Load'] !== undefined) {
                        group.totalLoad = row['Total Load'];
                    }
                }

                // Build headers
                const headers = [
                    'Elapsed (ms)',
                    'Elapsed (sec)',
                    ...tags.map(t => `Cell ${t} (lbs)`),
                    'Total Load (lbs)'
                ];

                const csvRows = [headers.join(',')];

                // Sort by elapsed time
                const sortedTimes = [...timeGroups.keys()].sort((a, b) => a - b);

                // Track last known value per tag for filling gaps
                const lastKnown = {};

                for (const elapsed of sortedTimes) {
                    const group = timeGroups.get(elapsed);
                    const row = [
                        elapsed,
                        (elapsed / 1000).toFixed(2),
                    ];
                    for (const tag of tags) {
                        if (group[tag] !== undefined) {
                            lastKnown[tag] = group[tag];
                            row.push(group[tag].toFixed(2));
                        } else {
                            // Carry forward last known value
                            row.push(lastKnown[tag] !== undefined ? lastKnown[tag].toFixed(2) : '');
                        }
                    }
                    row.push(group.totalLoad !== undefined ? group.totalLoad.toFixed(2) : '');
                    csvRows.push(row.join(','));
                }

                csvContent = csvRows.join('\n');
            } else {
                // Generic CSV export (non-live data, imports, etc.)
                const headers = Object.keys(data[0]);
                const csvRows = [headers.join(',')];

                for (const row of data) {
                    const values = headers.map(header => {
                        const val = row[header];
                        if (val === null || val === undefined) return '';
                        const str = String(val);
                        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                            return `"${str.replace(/"/g, '""')}"`;
                        }
                        return str;
                    });
                    csvRows.push(values.join(','));
                }

                csvContent = csvRows.join('\n');
            }

            fs.writeFileSync(filePath, csvContent, 'utf-8');
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
            { name: 'Data Files', extensions: ['csv', 'xlsx', 'xls'] },
            { name: 'CSV Files', extensions: ['csv'] },
            { name: 'Excel Files', extensions: ['xlsx', 'xls'] }
        ]
    });
    if (!canceled) {
        const filePath = filePaths[0];
        const ext = path.extname(filePath).toLowerCase();

        if (ext === '.xlsx' || ext === '.xls') {
            try {
                const workbook = XLSX.readFile(filePath);
                const firstSheetName = workbook.SheetNames[0];
                const worksheet = workbook.Sheets[firstSheetName];
                // Convert to CSV string to stay compatible with renderer's PapaParse
                return XLSX.utils.sheet_to_csv(worksheet);
            } catch (err) {
                console.error('Failed to parse Excel file:', err);
                throw err;
            }
        } else {
            return fs.readFileSync(filePath, 'utf-8');
        }
    }
}

function getDataPath(filename) {
    return path.join(app.getPath('userData'), filename || 'dashboard-data.json');
}

// --- Settings Management ---
// Keys that contain sensitive credentials — encrypted with safeStorage
const SENSITIVE_KEYS = ['openaiKey', 'chrPassword', 'geotabPassword'];

function encryptValue(value) {
    if (!value || !safeStorage.isEncryptionAvailable()) return value;
    try {
        return safeStorage.encryptString(value).toString('base64');
    } catch (e) {
        console.error('Failed to encrypt value:', e);
        return value;
    }
}

function decryptValue(value) {
    if (!value || !safeStorage.isEncryptionAvailable()) return value;
    try {
        const buffer = Buffer.from(value, 'base64');
        return safeStorage.decryptString(buffer);
    } catch (e) {
        // Value may not be encrypted yet (pre-migration) — return as-is
        return value;
    }
}

function loadSettings() {
    const settingsPath = getDataPath('settings.json');
    let saved = {};
    if (fs.existsSync(settingsPath)) {
        try {
            saved = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        } catch (e) {
            console.error('Failed to parse settings:', e);
            // Back up corrupted settings file
            if (e instanceof SyntaxError) {
                try {
                    const backupPath = settingsPath + '.corrupted.' + Date.now();
                    fs.renameSync(settingsPath, backupPath);
                    console.warn(`[SETTINGS] Corrupted settings backed up to: ${backupPath}`);
                } catch (be) { }
            }
        }
    }

    // Default configuration (from .env or reasonable defaults)
    const defaults = {
        clientId: process.env.AZURE_CLIENT_ID || '',
        tenantId: process.env.AZURE_TENANT_ID || '',
        sharepointSite: 'https://hydrowates.sharepoint.com/sites/Hydro-WatesFiles',
        leadListName: 'Lead List',
        openaiKey: process.env.OPENAI_API_KEY || '',
        t24GroupId: DEFAULT_GROUP_ID,
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

    // Decrypt sensitive fields
    for (const key of SENSITIVE_KEYS) {
        if (merged[key]) {
            merged[key] = decryptValue(merged[key]);
        }
    }

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

    // Encrypt sensitive fields before writing to disk
    const toSave = { ...settings };
    for (const key of SENSITIVE_KEYS) {
        if (toSave[key]) {
            toSave[key] = encryptValue(toSave[key]);
        }
    }
    fs.writeFileSync(settingsPath, JSON.stringify(toSave, null, 2));

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
        saveGeotabVehiclesCache(response.data.result);
        return { success: true, vehicles: response.data.result };
    } catch (err) {
        console.error('Geotab Vehicles Error:', err.message);
        const cached = loadGeotabVehiclesCache();
        if (cached) {
            console.log('Returning cached Geotab vehicles for offline state.');
            return { success: true, vehicles: cached.vehicles, cached: true };
        }
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
        saveGeotabELDCache(response.data.result);
        return { success: true, logs: response.data.result };
    } catch (err) {
        console.error('Geotab ELD Error:', err.message);
        const cached = loadGeotabELDCache();
        if (cached) {
            console.log('Returning cached Geotab ELD data for offline state.');
            return { success: true, logs: cached.logs, cached: true };
        }
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

// --- Shipments Cache for Offline Use ---
function saveShipmentsCache(shipments) {
    const cachePath = getDataPath('shipments-cache.json');
    const cacheData = {
        timestamp: new Date().toISOString(),
        shipments: shipments
    };
    fs.writeFileSync(cachePath, JSON.stringify(cacheData, null, 2));
    console.log(`Shipments cache saved: ${shipments.length} shipments at ${cacheData.timestamp}`);
}

function loadShipmentsCache() {
    const cachePath = getDataPath('shipments-cache.json');
    if (fs.existsSync(cachePath)) {
        try {
            const data = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
            console.log(`Shipments cache loaded: ${data.shipments?.length || 0} shipments from ${data.timestamp}`);
            return data;
        } catch (e) {
            console.error('Failed to load shipments cache:', e);
            return null;
        }
    }
    return null;
}

// --- Geotab Cache for Offline Use ---
function saveGeotabVehiclesCache(vehicles) {
    const cachePath = getDataPath('geotab-vehicles-cache.json');
    const cacheData = {
        timestamp: new Date().toISOString(),
        vehicles: vehicles
    };
    fs.writeFileSync(cachePath, JSON.stringify(cacheData, null, 2));
    console.log(`Geotab vehicles cache saved: ${vehicles.length} vehicles`);
}

function loadGeotabVehiclesCache() {
    const cachePath = getDataPath('geotab-vehicles-cache.json');
    if (fs.existsSync(cachePath)) {
        try {
            return JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
        } catch (e) {
            console.error('Failed to load Geotab vehicles cache:', e);
            return null;
        }
    }
    return null;
}

function saveGeotabELDCache(logs) {
    const cachePath = getDataPath('geotab-eld-cache.json');
    const cacheData = {
        timestamp: new Date().toISOString(),
        logs: logs
    };
    fs.writeFileSync(cachePath, JSON.stringify(cacheData, null, 2));
    console.log(`Geotab ELD cache saved: ${logs.length} logs`);
}

function loadGeotabELDCache() {
    const cachePath = getDataPath('geotab-eld-cache.json');
    if (fs.existsSync(cachePath)) {
        try {
            return JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
        } catch (e) {
            console.error('Failed to load Geotab ELD cache:', e);
            return null;
        }
    }
    return null;
}

// --- C.H. Robinson Navisphere Integration (Moved to Greens App) ---

function loadCHRTokenCache() {
    const cachePath = getDataPath('chr-token-cache.json');
    if (fs.existsSync(cachePath)) {
        try {
            const data = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
            if (data.accessToken && data.expiry && new Date(data.expiry) > new Date()) {
                chrAccessToken = data.accessToken;
                chrRefreshToken = data.refreshToken;
                chrTokenExpiry = new Date(data.expiry);
                console.log('CHR token loaded from cache');
                return true;
            }
        } catch (e) {
            console.error('Failed to load CHR token cache:', e);
        }
    }
    return false;
}

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

// Resolve the configured SharePoint site ID (with search fallback)
async function resolveSharePointSiteId(config) {
    const settings = loadSettings();
    const sharepointSite = settings.sharepointSite || 'https://hydrowates.sharepoint.com/sites/Hydro-WatesFiles';
    const urlObj = new URL(sharepointSite);
    const hostname = urlObj.hostname;
    const sitePath = urlObj.pathname.startsWith('/') ? urlObj.pathname : `/${urlObj.pathname}`;
    try {
        const res = await axios.get(`https://graph.microsoft.com/v1.0/sites/${hostname}:${sitePath}`, config);
        return res.data.id;
    } catch (e) {
        const searchRes = await axios.get(`https://graph.microsoft.com/v1.0/sites?search=${path.basename(sitePath)}`, config);
        const found = searchRes.data.value.find(s => s.name === path.basename(sitePath));
        if (!found) throw new Error(`Site at ${sharepointSite} not found`);
        return found.id;
    }
}

// Generic: fetch all items from a list by display name, returning raw fields
async function fetchListItemsRaw(listName) {
    const token = await getAccessToken();
    const config = { headers: { Authorization: `Bearer ${token}` } };
    const siteId = await resolveSharePointSiteId(config);
    const listsRes = await axios.get(`https://graph.microsoft.com/v1.0/sites/${siteId}/lists`, config);
    const list = listsRes.data.value.find(l => l.name === listName || l.displayName === listName);
    if (!list) {
        const available = listsRes.data.value.map(l => l.displayName || l.name).join(', ');
        throw new Error(`List "${listName}" not found. Available: ${available}`);
    }
    const items = [];
    let nextUrl = `https://graph.microsoft.com/v1.0/sites/${siteId}/lists/${list.id}/items?expand=fields&$top=200`;
    while (nextUrl) {
        const res = await axios.get(nextUrl, config);
        items.push(...res.data.value);
        nextUrl = res.data['@odata.nextLink'] || null;
    }
    return { items, listId: list.id, siteId };
}

// Read a field value from a SharePoint item, trying multiple candidate keys (case-insensitive, strip non-alnum)
function readField(fields, candidates) {
    if (!fields) return undefined;
    const keys = Object.keys(fields);
    const norm = (s) => String(s).toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const cand of candidates) {
        const target = norm(cand);
        const key = keys.find(k => norm(k) === target);
        if (key !== undefined) {
            const val = fields[key];
            if (val && typeof val === 'object' && val.Value) return val.Value;
            return val;
        }
    }
    return undefined;
}

// Detect a truthy "has certificate" signal on an inventory item.
// Looks for any field whose name contains "cert" or "attach" with a truthy/URL value.
function extractCertUrl(fields) {
    if (!fields) return null;
    for (const [key, val] of Object.entries(fields)) {
        const lk = key.toLowerCase();
        if (!lk.includes('cert') && !lk.includes('attach')) continue;
        if (!val) continue;
        if (typeof val === 'string' && val.trim()) return val.trim();
        if (typeof val === 'object') {
            if (val.Url) return val.Url;
            if (val.url) return val.url;
            if (val.Value) return typeof val.Value === 'string' ? val.Value : null;
        }
        if (val === true) return 'HAS_ATTACHMENT';
    }
    return null;
}

// Fetch equipment associated with a job: Load Out List × HydroWates Inventory (cert-bearing only)
async function fetchJobEquipment(event, jobNumber) {
    if (!jobNumber) return [];
    const jobKey = String(jobNumber).trim().toLowerCase();
    console.log(`[EQUIPMENT] Fetching equipment for job "${jobNumber}"`);

    const [loadOut, inventory] = await Promise.all([
        fetchListItemsRaw('Load Out List'),
        fetchListItemsRaw('HydroWates Inventory')
    ]);

    // One-time column diagnostic: log keys from first row of each list
    if (loadOut.items[0]?.fields) {
        console.log('[EQUIPMENT] Load Out columns:', Object.keys(loadOut.items[0].fields).join(', '));
    }
    if (inventory.items[0]?.fields) {
        console.log('[EQUIPMENT] Inventory columns:', Object.keys(inventory.items[0].fields).join(', '));
    }

    const jobCandidates = ['JobNumber', 'JobNum', 'Job', 'QuoteNum', 'Quote Number', 'Quote_x0023_', 'Title'];
    const serialCandidates = ['SerialNumber', 'Serial', 'Serial Number', 'Serial_x0020_Number', 'AssetTag', 'AssetID', 'Asset', 'EquipmentID', 'Title'];
    const nameCandidates = ['Title', 'Description', 'EquipmentName', 'ItemName', 'Name'];
    const wllCandidates = ['WLL', 'WorkingLoadLimit', 'Capacity', 'Rating'];

    // Filter Load Out to rows matching the job number (case-insensitive, trimmed)
    const loadOutRows = loadOut.items.filter(item => {
        const val = readField(item.fields, jobCandidates);
        if (val === undefined || val === null) return false;
        return String(val).trim().toLowerCase() === jobKey;
    });
    console.log(`[EQUIPMENT] Load Out rows matching job: ${loadOutRows.length}`);

    // Build inventory map: serial → { ...fields, certUrl }
    const invBySerial = new Map();
    for (const item of inventory.items) {
        const certUrl = extractCertUrl(item.fields);
        if (!certUrl) continue;
        const serial = readField(item.fields, serialCandidates);
        if (serial === undefined || serial === null || String(serial).trim() === '') continue;
        invBySerial.set(String(serial).trim().toLowerCase(), { fields: item.fields, id: item.id, certUrl });
    }
    console.log(`[EQUIPMENT] Inventory rows with certs: ${invBySerial.size}`);

    // Intersect
    const equipment = [];
    for (const row of loadOutRows) {
        const serial = readField(row.fields, serialCandidates);
        if (serial === undefined || serial === null || String(serial).trim() === '') continue;
        const invRow = invBySerial.get(String(serial).trim().toLowerCase());
        if (!invRow) continue;
        equipment.push({
            id: row.id,
            name: readField(row.fields, nameCandidates) || readField(invRow.fields, nameCandidates) || `Equipment ${serial}`,
            serial: String(serial),
            wll: readField(row.fields, wllCandidates) || readField(invRow.fields, wllCandidates) || '',
            certUrl: invRow.certUrl
        });
    }
    console.log(`[EQUIPMENT] Final equipment with certs for job: ${equipment.length}`);
    return equipment;
}

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
    ipcMain.handle('sharepoint:fetchJobEquipment', fetchJobEquipment);
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

    ipcMain.handle('shell:openBundledDoc', (event, filename) => {
        // Sanitize: only allow filenames, no path traversal
        const safeName = path.basename(filename);
        const isDev = !app.isPackaged;
        const docPath = isDev
            ? path.join(__dirname, '..', '..', 'public', 'docs', safeName)
            : path.join(process.resourcesPath, 'docs', safeName);
        if (fs.existsSync(docPath)) {
            shell.openPath(docPath);
            return { success: true };
        }
        return { success: false, error: 'Document not found' };
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

    // ── Session History (Customer Center) ──
    const sessionsDir = path.join(app.getPath('userData'), 'sessions');
    if (!fs.existsSync(sessionsDir)) fs.mkdirSync(sessionsDir, { recursive: true });

    ipcMain.handle('sessions:save', (event, { name, data, meta }) => {
        try {
            const id = `${Date.now()}-${name.replace(/[^a-zA-Z0-9]/g, '_')}`;
            const sessionFile = path.join(sessionsDir, `${id}.json`);
            fs.writeFileSync(sessionFile, JSON.stringify({ name, data, meta, savedAt: new Date().toISOString() }));
            console.log(`[SESSIONS] Saved session: ${name} (${data.length} samples)`);
            return { success: true, id };
        } catch (err) {
            console.error('[SESSIONS] Save failed:', err);
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('sessions:list', () => {
        try {
            const files = fs.readdirSync(sessionsDir).filter(f => f.endsWith('.json')).sort().reverse();
            return files.map(f => {
                try {
                    const raw = fs.readFileSync(path.join(sessionsDir, f), 'utf8');
                    const session = JSON.parse(raw);
                    return { id: f.replace('.json', ''), name: session.name, savedAt: session.savedAt, meta: session.meta, sampleCount: session.data?.length || 0 };
                } catch (e) { return null; }
            }).filter(Boolean);
        } catch (err) { return []; }
    });

    ipcMain.handle('sessions:load', (event, id) => {
        try {
            const raw = fs.readFileSync(path.join(sessionsDir, `${id}.json`), 'utf8');
            return JSON.parse(raw);
        } catch (err) { return null; }
    });

    ipcMain.handle('sessions:delete', (event, id) => {
        try {
            fs.unlinkSync(path.join(sessionsDir, `${id}.json`));
            return { success: true };
        } catch (err) { return { success: false }; }
    });

    // ── Auto-save (periodic temp save during recording) ──
    ipcMain.handle('sessions:autosave', (event, { name, data, meta }) => {
        try {
            const autosaveFile = path.join(sessionsDir, '_autosave.json');
            fs.writeFileSync(autosaveFile, JSON.stringify({ name, data, meta, savedAt: new Date().toISOString() }));
            return { success: true };
        } catch (err) { return { success: false }; }
    });

    ipcMain.handle('sessions:loadAutosave', () => {
        try {
            const autosaveFile = path.join(sessionsDir, '_autosave.json');
            if (!fs.existsSync(autosaveFile)) return null;
            const raw = fs.readFileSync(autosaveFile, 'utf8');
            return JSON.parse(raw);
        } catch (err) { return null; }
    });

    ipcMain.handle('sessions:clearAutosave', () => {
        try {
            const autosaveFile = path.join(sessionsDir, '_autosave.json');
            if (fs.existsSync(autosaveFile)) fs.unlinkSync(autosaveFile);
            return { success: true };
        } catch (err) { return { success: false }; }
    });

    // ── Companion Server (Mobile PWA) ──
    ipcMain.handle('companion:start', async () => {
        try {
            const result = await companionServer.start();
            // Sync current device status immediately so phones see the correct state
            companionServer.updateSessionState({ deviceStatus });
            return { success: true, port: result.port, ips: result.ips };
        } catch (err) {
            console.error('[COMPANION] Start failed:', err);
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('companion:stop', async () => {
        try {
            await companionServer.stop();
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    });

    ipcMain.handle('companion:status', () => {
        return companionServer.getStatus();
    });

    ipcMain.handle('companion:syncState', (event, state) => {
        if (companionServer.isRunning) {
            // Always include current device status from main process
            companionServer.updateSessionState({ ...state, deviceStatus });
        }
        return { success: true };
    });

    ipcMain.handle('companion:getPhotos', () => {
        return companionServer.getPhotos();
    });

    ipcMain.handle('companion:clearPhotos', () => {
        companionServer.clearPhotos();
        return { success: true };
    });

    // When a phone sends a photo, notify the renderer
    companionServer.onPhotoReceived = (photo) => {
        if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('companion-photo-received', photo);
        }
    };

    // ── Certificate Registry (Auto-Numbering) ──
    const certRegistryPath = path.join(app.getPath('userData'), 'cert-registry.json');

    const loadCertRegistry = () => {
        try {
            if (fs.existsSync(certRegistryPath)) {
                return JSON.parse(fs.readFileSync(certRegistryPath, 'utf8'));
            }
        } catch (e) { console.error('[CERT-REGISTRY] Load failed:', e); }
        return { lastNumber: 0, certs: [] };
    };

    const saveCertRegistry = (registry) => {
        try {
            fs.writeFileSync(certRegistryPath, JSON.stringify(registry, null, 2));
        } catch (e) { console.error('[CERT-REGISTRY] Save failed:', e); }
    };

    ipcMain.handle('cert:nextNumber', () => {
        const registry = loadCertRegistry();
        const year = new Date().getFullYear();
        registry.lastNumber = (registry.lastNumber || 0) + 1;
        const certNo = `HW-${year}-${String(registry.lastNumber).padStart(4, '0')}`;
        saveCertRegistry(registry);
        return certNo;
    });

    ipcMain.handle('cert:register', (event, { certNo, jobName, customer, testDate, template, result }) => {
        const registry = loadCertRegistry();
        registry.certs = registry.certs || [];
        // Avoid duplicates
        const existing = registry.certs.findIndex(c => c.certNo === certNo);
        const entry = { certNo, jobName, customer, testDate, template, result, issuedAt: new Date().toISOString() };
        if (existing >= 0) {
            registry.certs[existing] = entry;
        } else {
            registry.certs.push(entry);
        }
        saveCertRegistry(registry);
        return { success: true };
    });

    ipcMain.handle('cert:listRegistry', () => {
        const registry = loadCertRegistry();
        return registry.certs || [];
    });

    // ── Export to Customer USB / Folder ──
    ipcMain.handle('export:customerPackage', async (event, { certPdfTitle, csvData, csvName, sessionName }) => {
        try {
            const result = await dialog.showOpenDialog(mainWindow, {
                title: 'Select Folder for Customer Export',
                properties: ['openDirectory', 'createDirectory'],
                buttonLabel: 'Export Here'
            });
            if (result.canceled || !result.filePaths.length) return { success: false, canceled: true };

            const exportDir = path.join(result.filePaths[0], sessionName || `OSCAR-Export-${new Date().toISOString().slice(0, 10)}`);
            if (!fs.existsSync(exportDir)) fs.mkdirSync(exportDir, { recursive: true });

            const files = [];

            // Save PDF certificate if requested
            if (certPdfTitle && mainWindow) {
                const pdfData = await mainWindow.webContents.printToPDF({
                    printBackground: true,
                    landscape: false,
                    pageSize: 'Letter'
                });
                const pdfPath = path.join(exportDir, `${certPdfTitle}.pdf`);
                fs.writeFileSync(pdfPath, pdfData);
                files.push(pdfPath);
            }

            // Save CSV if provided
            if (csvData && csvName) {
                const csvPath = path.join(exportDir, csvName.endsWith('.csv') ? csvName : `${csvName}.csv`);
                fs.writeFileSync(csvPath, csvData);
                files.push(csvPath);
            }

            console.log(`[EXPORT] Customer package saved to: ${exportDir} (${files.length} files)`);
            return { success: true, path: exportDir, files };
        } catch (err) {
            console.error('[EXPORT] Failed:', err);
            return { success: false, error: err.message };
        }
    });

    // ── GPS Location (for session tagging) ──
    ipcMain.handle('gps:getLocation', async () => {
        // In Electron, we use the Chromium geolocation API from renderer
        // This handler is a passthrough for manual coordinate entry if needed
        return { success: true, note: 'Use navigator.geolocation in renderer' };
    });

    // Initial scan before window creates
    scanForDongle();

    createWindow();

    // Auto-updater (after window is created)
    const appUpdater = new AppUpdater(mainWindow);
    appUpdater.registerIPC();
    // Check for updates 5 seconds after launch (non-blocking)
    setTimeout(() => {
        if (app.isPackaged) {
            appUpdater.checkForUpdates();
        }
    }, 5000);

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    companionServer.stop().catch(() => {});
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
