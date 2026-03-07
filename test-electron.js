const electron = require('electron');
console.log('require("electron") type:', typeof electron);
console.log('require("electron") value:', electron);
if (typeof electron === 'string') {
    console.log('It resolved to the path string (npm package)!');
} else {
    console.log('Keys:', Object.keys(electron));
}

try {
    const { app } = electron;
    if (app) app.quit();
} catch (e) {
    console.error(e);
}
