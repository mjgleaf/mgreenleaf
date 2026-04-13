/**
 * Auto-Updater Module for OSCAR
 *
 * Uses electron-updater to check for and install updates from GitHub Releases.
 * In development, this module is a no-op.
 *
 * Setup Requirements:
 * 1. Create GitHub releases with built artifacts (electron-builder output)
 * 2. Set "publish" config in package.json build section:
 *    "publish": { "provider": "github", "owner": "mgreenleaf", "repo": "mgreenleaf" }
 * 3. Set GH_TOKEN environment variable for publishing releases
 */

const { ipcMain } = require('electron');
let autoUpdater;

try {
    autoUpdater = require('electron-updater').autoUpdater;
} catch (e) {
    console.warn('[UPDATER] electron-updater not available:', e.message);
    autoUpdater = null;
}

class AppUpdater {
    constructor(mainWindow) {
        this.mainWindow = mainWindow;
        this.updateAvailable = false;
        this.updateDownloaded = false;
        this.updateInfo = null;
        this.downloadProgress = null;
        this.error = null;

        if (!autoUpdater) {
            console.log('[UPDATER] Auto-updater not available (development mode or missing dependency)');
            return;
        }

        // Configure
        autoUpdater.autoDownload = false; // Let user choose when to download
        autoUpdater.autoInstallOnAppQuit = true;

        // Events
        autoUpdater.on('checking-for-update', () => {
            console.log('[UPDATER] Checking for updates...');
            this.sendStatus('checking');
        });

        autoUpdater.on('update-available', (info) => {
            console.log('[UPDATER] Update available:', info.version);
            this.updateAvailable = true;
            this.updateInfo = info;
            this.sendStatus('available', { version: info.version, releaseNotes: info.releaseNotes });
        });

        autoUpdater.on('update-not-available', (info) => {
            console.log('[UPDATER] App is up to date:', info.version);
            this.updateAvailable = false;
            this.sendStatus('up-to-date', { version: info.version });
        });

        autoUpdater.on('download-progress', (progress) => {
            this.downloadProgress = progress;
            this.sendStatus('downloading', { percent: Math.round(progress.percent) });
        });

        autoUpdater.on('update-downloaded', (info) => {
            console.log('[UPDATER] Update downloaded:', info.version);
            this.updateDownloaded = true;
            this.sendStatus('downloaded', { version: info.version });
        });

        autoUpdater.on('error', (err) => {
            console.error('[UPDATER] Error:', err.message);
            this.error = err.message;
            this.sendStatus('error', { error: err.message });
        });
    }

    sendStatus(status, data = {}) {
        if (this.mainWindow && !this.mainWindow.isDestroyed()) {
            this.mainWindow.webContents.send('updater-status', { status, ...data });
        }
    }

    checkForUpdates() {
        if (!autoUpdater) return { success: false, error: 'Auto-updater not available' };
        try {
            autoUpdater.checkForUpdates();
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    downloadUpdate() {
        if (!autoUpdater) return { success: false, error: 'Auto-updater not available' };
        try {
            autoUpdater.downloadUpdate();
            return { success: true };
        } catch (err) {
            return { success: false, error: err.message };
        }
    }

    installUpdate() {
        if (!autoUpdater || !this.updateDownloaded) return { success: false, error: 'No update downloaded' };
        autoUpdater.quitAndInstall(false, true);
        return { success: true };
    }

    getStatus() {
        return {
            available: this.updateAvailable,
            downloaded: this.updateDownloaded,
            info: this.updateInfo,
            progress: this.downloadProgress,
            error: this.error
        };
    }

    registerIPC() {
        ipcMain.handle('updater:check', () => this.checkForUpdates());
        ipcMain.handle('updater:download', () => this.downloadUpdate());
        ipcMain.handle('updater:install', () => this.installUpdate());
        ipcMain.handle('updater:status', () => this.getStatus());
    }
}

module.exports = AppUpdater;
