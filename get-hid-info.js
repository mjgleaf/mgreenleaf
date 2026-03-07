const HID = require('node-hid');
const VID = 0x1781;
const PID = 0x0BA4;

try {
    const devices = HID.devices();
    const device = devices.find(d => d.vendorId === VID && d.productId === PID);
    if (device) {
        console.log('--- DEVICE INFO ---');
        console.log(JSON.stringify(device, null, 2));
    } else {
        console.log('Device not found');
    }
} catch (err) {
    console.error(err);
}
