import electron from 'electron';
console.log('ESM electron:', electron);
console.log('Keys:', Object.keys(electron));
try {
    const { app } = electron;
    if (app) console.log('App is present');
    app.quit();
} catch (e) {
    console.error(e);
}
