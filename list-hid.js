const HID = require('node-hid');

function listHIDDevices() {
    try {
        const devices = HID.devices();
        console.log('Available HID Devices:');
        devices.forEach(device => {
            if (device.vendorId === 0x1781 || device.product === 'T24-BSue' || device.manufacturer === 'Mantracourt') {
                console.log('FOUND MANTRACOURT DEVICE:');
            }
            console.log(`Path: ${device.path}`);
            console.log(`  Manufacturer: ${device.manufacturer}`);
            console.log(`  Product: ${device.product}`);
            console.log(`  Vendor ID: ${device.vendorId} (0x${device.vendorId.toString(16)})`);
            console.log(`  Product ID: ${device.productId} (0x${device.productId.toString(16)})`);
            console.log(`  Usage Page: ${device.usagePage}`);
            console.log(`  Usage: ${device.usage}`);
            console.log('-----------------------------');
        });
    } catch (err) {
        console.error('Error listing HID devices:', err);
    }
}

listHIDDevices();
