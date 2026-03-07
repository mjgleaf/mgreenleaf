const HID = require('node-hid');
const VID = 0x1781;
const PID = 0x0BA4;

console.log('Dumping RAW T24 Packets (first 16 bytes)...');

try {
    const info = HID.devices().find(d => d.vendorId === VID && d.productId === PID);
    if (!info) process.exit(1);

    const device = new HID.HID(info.path);

    device.on('data', (data) => {
        if (data[0] === 0x0B) {
            const hex = data.slice(0, 16).toString('hex').toUpperCase().match(/.{2}/g).join(' ');
            const tag = data.readUInt16BE(4).toString(16).toUpperCase();
            console.log(`Tag=${tag} | RAW: ${hex}`);
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
