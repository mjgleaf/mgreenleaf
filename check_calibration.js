const HID = require('node-hid');
const VID = 0x1781;
const PID = 0x0BA4;

console.log('Logging Tag 6762 (Retry)...');

try {
    const devices = HID.devices();
    const info = devices.find(d => d.vendorId === VID && d.productId === PID);

    if (!info) process.exit(1);

    const device = new HID.HID(info.path);

    device.on('data', (data) => {
        if (data[0] === 0x0B && data.length >= 12) {
            const dataTag = data.readUInt16BE(4);
            const tagHex = dataTag.toString(16).toUpperCase().padStart(4, '0');

            if (tagHex === '6762') {
                const floatBE = data.readFloatBE(8);
                const floatLE = data.readFloatLE(8);
                console.log(`Tag=${tagHex} FloatBE=${floatBE.toFixed(4)} FloatLE=${floatLE.toFixed(4)}`);
            }
        }
    });

    // Wake
    setInterval(() => {
        try {
            const wake = Buffer.alloc(65);
            wake[0] = 0x05; wake[1] = 0x02; wake[2] = 0xFF; wake[3] = 0xFF;
            device.write(wake);
        } catch (e) { }
    }, 1000);

} catch (e) { console.error(e); }
