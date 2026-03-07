const HID = require('node-hid');
const VID = 0x1781;
const PID = 0x0BA4;

function runSample() {
    try {
        const info = HID.devices().find(d => d.vendorId === VID && d.productId === PID);
        const device = new HID.HID(info.path);
        const samples = [];

        device.on('data', (data) => {
            if (data[0] === 0x0B) {
                const hex = data.toString('hex').slice(0, 32);
                const results = [];
                for (let i = 8; i <= 12; i++) {
                    const fVal = data.readFloatBE(i);
                    const lbs = fVal * 2204.62262;
                    results.push({ offset: i, raw: fVal.toFixed(6), lbs: lbs.toFixed(2) });
                }
                samples.push({ hex, results });
                if (samples.length >= 3) {
                    console.log(JSON.stringify(samples, null, 2));
                    process.exit(0);
                }
            }
        });

        setTimeout(() => process.exit(0), 10000);
    } catch (err) {
        process.exit(1);
    }
}

runSample();
