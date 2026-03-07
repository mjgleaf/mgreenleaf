const { SerialPort } = require('serialport');

async function listPorts() {
    try {
        const ports = await SerialPort.list();
        console.log('Available Serial Ports:');
        ports.forEach(port => {
            console.log(`Port: ${port.path}`);
            console.log(`  Manufacturer: ${port.manufacturer}`);
            console.log(`  Serial Number: ${port.serialNumber}`);
            console.log(`  Location ID: ${port.locationId}`);
            console.log(`  Vendor ID: ${port.vendorId}`);
            console.log(`  Product ID: ${port.productId}`);
            console.log('-----------------------------');
        });
    } catch (err) {
        console.error('Error listing ports:', err);
    }
}

listPorts();
