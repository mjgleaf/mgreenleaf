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
const crypto = require('crypto');

class CompanionServer {
    constructor() {
        this.app = express();
        this.server = http.createServer(this.app);
        // Reject unauthorized WebSocket upgrades during the handshake (cleaner than
        // accepting then closing). verifyClient runs per-connection, by which time
        // this.authToken is set. The token rides in the URL (?t=) since browsers can't
        // set headers on a WebSocket.
        this.wss = new WebSocket.Server({
            server: this.server,
            verifyClient: (info, cb) => {
                let token = '';
                try { token = new URL(info.req.url, 'http://localhost').searchParams.get('t') || ''; } catch (e) { /* malformed */ }
                if (this._tokenValid(token)) return cb(true);
                console.log('[COMPANION] Rejected WebSocket upgrade (missing/invalid token)');
                cb(false, 401, 'Unauthorized');
            }
        });
        this.port = 3001;
        this.isRunning = false;
        this.clients = new Set();
        // Per-run bearer token: required on every /api request and the WS upgrade. The
        // static PWA shell stays public so the page can load; it then authenticates with
        // this token (passed in the connect URL as ?t=...).
        this.authToken = crypto.randomBytes(24).toString('hex');
        // Bound in-memory growth — these endpoints are reachable by any device on the LAN.
        this.maxLeaks = 1000;
        this.maxPhotos = 50;

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
            deviceStatus: 'disconnected',
            leaks: [],
            equipmentItems: []
        };
        this.leaks = [];
        this.certCache = new Map(); // id -> { name, buffer, mime }
        this.certCacheSeq = 0;

        this._setupRoutes();
        this._setupWebSocket();
    }

    // Accept the token from an Authorization: Bearer header or a ?t= query param.
    // Uses a constant-time compare to avoid leaking the token via timing.
    _tokenValid(provided) {
        if (!provided) return false;
        const a = Buffer.from(String(provided));
        const b = Buffer.from(this.authToken);
        return a.length === b.length && crypto.timingSafeEqual(a, b);
    }

    _tokenOk(req) {
        const auth = req.headers['authorization'] || '';
        const bearer = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
        const q = (req.query && req.query.t) ? String(req.query.t) : '';
        return this._tokenValid(bearer || q);
    }

    _setupRoutes() {
        // Serve the mobile PWA (static shell is public so the page can load).
        const mobileDir = path.join(__dirname, 'companion-app');
        this.app.use(express.static(mobileDir));

        // Gate the API surface with the session token BEFORE body parsing, so an
        // unauthorized request is rejected without us buffering its (up to 10MB) body.
        this.app.use('/api', (req, res, next) => {
            if (this._tokenOk(req)) return next();
            res.status(401).json({ error: 'Unauthorized' });
        });

        this.app.use(express.json({ limit: '10mb' }));

        // API endpoint for phone to send photos back to OSCAR
        this.photos = [];
        this.app.post('/api/photo', (req, res) => {
            const { dataUrl, timestamp, gps } = req.body;
            if (dataUrl) {
                this.photos.push({ dataUrl, timestamp: timestamp || Date.now(), gps: gps || null });
                if (this.photos.length > this.maxPhotos) this.photos.splice(0, this.photos.length - this.maxPhotos);
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

        // API endpoint for phone to log a leak
        this.app.post('/api/leak', (req, res) => {
            const { dataUrl, description, severity, timestamp, gps, serial } = req.body;
            if (!dataUrl || !description) {
                res.status(400).json({ error: 'Photo and description are required' });
                return;
            }
            const leak = {
                id: `leak-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                dataUrl,
                description,
                severity: severity || 'minor',
                serial: (serial || '').trim() || null,
                timestamp: timestamp || Date.now(),
                gps: gps || null
            };
            this.leaks.push(leak);
            if (this.leaks.length > this.maxLeaks) this.leaks.splice(0, this.leaks.length - this.maxLeaks);
            this.currentState.leaks = this.leaks;
            console.log(`[COMPANION] Leak logged (${this.leaks.length} total): ${description.slice(0, 40)}`);
            this.broadcast('leak', leak);
            if (this.onLeakReceived) this.onLeakReceived(leak);
            if (this.onLeaksChanged) this.onLeaksChanged(this.leaks);
            res.json({ success: true, leak, count: this.leaks.length });
        });

        // API to get all leaks
        this.app.get('/api/leaks', (req, res) => {
            res.json(this.leaks);
        });

        // API to delete a leak
        this.app.delete('/api/leaks/:id', (req, res) => {
            const removed = this.deleteLeak(req.params.id);
            res.json({ success: removed, count: this.leaks.length });
        });

        // API to get current state (for initial load)
        this.app.get('/api/state', (req, res) => {
            res.json(this.currentState);
        });

        // API to serve a cached equipment certificate attachment
        this.app.get('/api/cert/:id', (req, res) => {
            const entry = this.certCache.get(req.params.id);
            if (!entry) {
                res.status(404).json({ error: 'Certificate not found' });
                return;
            }
            res.setHeader('Content-Type', entry.mime || 'application/octet-stream');
            res.setHeader('Content-Disposition', `inline; filename="${entry.name.replace(/"/g, '')}"`);
            res.send(entry.buffer);
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
            // Token already validated during the upgrade by verifyClient above.
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

    // Cache a certificate attachment for the companion to fetch via /api/cert/:id
    addCertCache({ name, buffer, mime }) {
        this.certCacheSeq += 1;
        const id = `c${this.certCacheSeq}`;
        this.certCache.set(id, { name, buffer, mime: mime || 'application/octet-stream' });
        return id;
    }

    clearCertCache() {
        this.certCache.clear();
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
            photos: this.photos.length,
            token: this.authToken
        };
    }

    clearPhotos() {
        this.photos = [];
    }

    getPhotos() {
        return this.photos;
    }

    getLeaks() {
        return this.leaks;
    }

    clearLeaks() {
        this.leaks = [];
        this.currentState.leaks = [];
        this.broadcast('leaksCleared', {});
        if (this.onLeaksChanged) this.onLeaksChanged(this.leaks);
    }

    deleteLeak(id) {
        const before = this.leaks.length;
        this.leaks = this.leaks.filter(l => l.id !== id);
        this.currentState.leaks = this.leaks;
        const removed = before !== this.leaks.length;
        if (removed) {
            this.broadcast('leakDeleted', { id });
            if (this.onLeaksChanged) this.onLeaksChanged(this.leaks);
        }
        return removed;
    }

    setLeaks(leaks) {
        this.leaks = Array.isArray(leaks) ? leaks : [];
        this.currentState.leaks = this.leaks;
    }
}

module.exports = CompanionServer;
