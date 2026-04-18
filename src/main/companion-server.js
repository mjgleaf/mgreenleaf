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

        // Map of equipment id → { certUrl, name } — used by /api/cert/:id proxy.
        // Populated from updateSessionState() whenever equipmentItems is synced.
        this.equipmentIndex = new Map();

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

        // Proxy a certificate file from SharePoint through the laptop.
        // The laptop holds the MSAL token; phones don't need SharePoint auth.
        this.app.get('/api/cert/:id', async (req, res) => {
            const id = req.params.id;
            if (!this.onCertRequest) {
                res.status(503).type('text/plain').send('Certificate proxy not wired');
                return;
            }
            try {
                const { buffer, contentType, filename } = await this.onCertRequest(id);
                const safeName = String(filename || 'certificate').replace(/[\r\n"]/g, '');
                res.setHeader('Content-Type', contentType || 'application/octet-stream');
                res.setHeader('Content-Disposition', `inline; filename="${safeName}"`);
                res.setHeader('Cache-Control', 'private, max-age=300');
                res.end(buffer);
            } catch (err) {
                const status = err.statusCode || 502;
                console.error(`[COMPANION] /api/cert/${id} failed (${status}):`, err.message);
                res.status(status).type('text/plain').send(err.message || 'Cert fetch failed');
            }
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
        // Rebuild equipment index whenever the list is synced so /api/cert/:id works.
        if (Array.isArray(state.equipmentItems)) {
            this.equipmentIndex.clear();
            state.equipmentItems.forEach(item => {
                if (item && item.id && item.certUrl && item.certUrl !== 'HAS_ATTACHMENT') {
                    this.equipmentIndex.set(String(item.id), {
                        certUrl: item.certUrl,
                        certName: item.certName || null,
                        name: item.name || 'Certificate'
                    });
                }
            });
            console.log(`[COMPANION] Equipment index updated: ${this.equipmentIndex.size} item(s) with certs`);
        }
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
