const HID = require('node-hid');
const VID = 0x1781;
const PID = 0x0BA4;

// This script outputs real-time weight data in LBS using current OSCAR logic.
// Compare this output to LOG100's displayed value to find the discrepancy.

function runComparison() {
    try {
        const info = HID.devices().find(d => d.vendorId === VID && d.productId === PID);
        const device = new HID.HID(info.path);

        console.log('=== OSCAR vs LOG100 Live Comparison ===');
        console.log('Watch LOG100 and this output. Report any differences.\n');

        device.on('data', (data) => {
            // Only process RID 0x0B with valid tag
            if (data[0] !== 0x0B) return;

            const tag = data.readUInt16BE(4);
            if (tag !== 0x2075) return; // User's main tag

            // Current OSCAR logic (offset 8, FloatBE, MT -> LBS)
            const tonnes = data.readFloatBE(8);
            const lbs = tonnes * 2204.62262;

            // Alternative interpretations for debugging
            const altOffset9 = data.readFloatBE(9) * 2204.62262;
            const altOffset10 = data.readFloatBE(10) * 2204.62262;

            const time = new Date().toLocaleTimeString();
            console.log(`[${time}] OSCAR(O8): ${lbs.toFixed(1)} lbs | Raw MT: ${tonnes.toFixed(6)} | O9: ${altOffset9.toFixed(1)} | O10: ${altOffset10.toFixed(1)}`);
        });

        // Run for 30 seconds
        setTimeout(() => {
            console.log('\nDone. Close LOG100 and check for discrepancies.');
            process.exit(0);
        }, 30000);
    } catch (err) {
        console.error('Error:', err.message);
        process.exit(1);
    }
}

runComparison();
