const HID = require('node-hid');
const VID = 0x1781;
const PID = 0x0BA4;

console.log('Scanning for Tag 7834...');

try {
    const devices = HID.devices();
    const info = devices.find(d => d.vendorId === VID && d.productId === PID);

    if (!info) {
        console.error('Dongle not found');
        process.exit(1);
    }

    const device = new HID.HID(info.path);

    device.on('data', (data) => {
        if (data[0] === 0x0B && data.length >= 12) {
            const dataTag = data.readUInt16BE(4);
            const tagHex = dataTag.toString(16).toUpperCase().padStart(4, '0');

            if (tagHex === '7834') {
                const floatBE = data.readFloatBE(8);
                const floatLE = data.readFloatLE(8);
                const lbsBE = floatBE * 2204.62262;

                console.log(`Tag 7834: FloatBE=${floatBE.toFixed(4)} (LBS=${lbsBE.toFixed(1)}) | FloatLE=${floatLE.toFixed(4)}`);
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
