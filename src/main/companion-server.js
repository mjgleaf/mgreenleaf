/**
 * OSCAR Companion Server
 *
 * Runs an Express + WebSocket server on the local network so that
 * phones/tablets can connect and view live load data in real-time.
 *
 * Architecture:
 * - Express serves the mobile PWA (static HTML/CSS/JS)
 * - WebSocket broadcasts live data packets, overload alerts, session state
 * - Phones connect via http://<laptop-ip>:3001
 */

const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const path = require('path');
const os = require('os');

class CompanionServer {
    constructor() {
        this.app = express();
        this.server = http.createServer(this.app);
        this.wss = new WebSocket.Server({ server: this.server });
        this.port = 3001;
        this.isRunning = false;
        this.clients = new Set();

        // State that gets broadcast
        this.currentState = {
            devices: {},
            selectedTags: [],
            cellCount: 1,
            isLogging: false,
            sessionName: '',
            loggedSamples: 0,
            peakValues: {},
            totalLoad: 0,
            wllThreshold: 0,
            overloadTags: [],
            deviceStatus: 'disconnected'
        };

        this._setupRoutes();
        this._setupWebSocket();
    }

    _setupRoutes() {
        // Serve the mobile PWA
        const mobileDir = path.join(__dirname, 'companion-app');
        this.app.use(express.static(mobileDir));
        this.app.use(express.json({ limit: '10mb' }));

        // API endpoint for phone to send photos back to OSCAR
        this.photos = [];
        this.app.post('/api/photo', (req, res) => {
            const { dataUrl, timestamp, gps } = req.body;
            if (dataUrl) {
                this.photos.push({ dataUrl, timestamp: timestamp || Date.now(), gps: gps || null });
                console.log(`[COMPANION] Photo received from phone (${this.photos.length} total)`);
                // Notify main window
                if (this.onPhotoReceived) this.onPhotoReceived({ dataUrl, timestamp, gps });
                res.json({ success: true, count: this.photos.length });
            } else {
                res.status(400).json({ error: 'No image data' });
            }
        });

        // API to get all photos
        this.app.get('/api/photos', (req, res) => {
            res.json(this.photos);
        });

        // API to get current state (for initial load)
        this.app.get('/api/state', (req, res) => {
            res.json(this.currentState);
        });

        // API to get server info
        this.app.get('/api/info', (req, res) => {
            res.json({
                name: 'OSCAR Companion',
                version: '1.0',
                clients: this.clients.size,
                uptime: process.uptime()
            });
        });
    }

    _setupWebSocket() {
        this.wss.on('connection', (ws, req) => {
            this.clients.add(ws);
            const clientIP = req.socket.remoteAddress;
            console.log(`[COMPANION] Phone connected from ${clientIP} (${this.clients.size} total)`);

            // Send current state immediately on connect
            ws.send(JSON.stringify({ type: 'state', data: this.currentState }));

            ws.on('close', () => {
                this.clients.delete(ws);
                console.log(`[COMPANION] Phone disconnected (${this.clients.size} remaining)`);
            });

            ws.on('error', (err) => {
                console.error('[COMPANION] WebSocket error:', err.message);
                this.clients.delete(ws);
            });
        });
    }

    // Broadcast a message to all connected phones
    broadcast(type, data) {
        const message = JSON.stringify({ type, data });
        this.clients.forEach(ws => {
            if (ws.readyState === WebSocket.OPEN) {
                try { ws.send(message); } catch (e) { }
            }
        });
    }

    // Called from main.js when live data arrives
    sendLiveData(packet) {
        this.currentState.devices[packet.tag] = packet;

        // Recalculate total load
        let total = 0;
        this.currentState.selectedTags.forEach(tag => {
            if (tag && this.currentState.devices[tag]) {
                total += this.currentState.devices[tag].value;
            }
        });
        this.currentState.totalLoad = total;

        this.broadcast('liveData', packet);
    }

    // Called when overload is detected
    sendOverloadAlert(tags, wllThreshold) {
        this.currentState.overloadTags = tags;
        this.currentState.wllThreshold = wllThreshold;
        this.broadcast('overload', { tags, wllThreshold });
    }

    // Update session state
    updateSessionState(state) {
        Object.assign(this.currentState, state);
        this.broadcast('state', this.currentState);
    }

    // Get local network IPs
    getLocalIPs() {
        const interfaces = os.networkInterfaces();
        const ips = [];
        for (const name of Object.keys(interfaces)) {
            for (const iface of interfaces[name]) {
                if (iface.family === 'IPv4' && !iface.internal) {
                    ips.push({ name, address: iface.address });
                }
            }
        }
        return ips;
    }

    start() {
        return new Promise((resolve, reject) => {
            if (this.isRunning) {
                resolve({ port: this.port, ips: this.getLocalIPs() });
                return;
            }

            this.server.listen(this.port, '0.0.0.0', () => {
                this.isRunning = true;
                const ips = this.getLocalIPs();
                console.log(`[COMPANION] Server started on port ${this.port}`);
                ips.forEach(ip => {
                    console.log(`[COMPANION]   http://${ip.address}:${this.port}`);
                });
                resolve({ port: this.port, ips });
            });

            this.server.on('error', (err) => {
                console.error('[COMPANION] Server error:', err);
                reject(err);
            });
        });
    }

    stop() {
        return new Promise((resolve) => {
            if (!this.isRunning) { resolve(); return; }
            this.clients.forEach(ws => ws.close());
            this.clients.clear();
            this.server.close(() => {
                this.isRunning = false;
                console.log('[COMPANION] Server stopped');
                resolve();
            });
        });
    }

    getStatus() {
        return {
            running: this.isRunning,
            port: this.port,
            clients: this.clients.size,
            ips: this.isRunning ? this.getLocalIPs() : [],
            photos: this.photos.length
        };
    }

    clearPhotos() {
        this.photos = [];
    }

    getPhotos() {
        return this.photos;
    }
}

module.exports = CompanionServer;
