const HID = require('node-hid');

const VID = 0x1781;
const PID = 0x0BA4;

function dumpHID() {
    try {
        const devices = HID.devices();
        const info = devices.find(d => d.vendorId === VID && d.productId === PID);

        if (!info) {
            console.log('Mantracourt T24 dongle not found.');
            return;
        }

        console.log('Opening device at:', info.path);
        const device = new HID.HID(info.path);

        device.on('data', (data) => {
            console.log('Received data (hex):', data.toString('hex'));
            console.log('Received data (raw):', data);
        });

        device.on('error', (err) => {
            console.error('HID Error:', err);
        });

        console.log('Waiting for data... (Ctrl+C to stop)');
    } catch (err) {
        console.error('Error opening HID device:', err);
    }
}

dumpHID();
