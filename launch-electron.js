// launch-electron.js - Clears ELECTRON_RUN_AS_NODE before launching Electron
const { spawn } = require('child_process');
const electronPath = require('electron');

// Build clean env without ELECTRON_RUN_AS_NODE
const cleanEnv = { ...process.env };
delete cleanEnv.ELECTRON_RUN_AS_NODE;

const child = spawn(electronPath, ['--no-sandbox', '.'], {
    stdio: 'inherit',
    env: cleanEnv
});

child.on('exit', (code) => process.exit(code));
