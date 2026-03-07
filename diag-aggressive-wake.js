const HID = require('node-hid');
const VID = 0x1781;
const PID = 0x0BA4;

async function runAggressiveWake() {
    console.log('--- Aggressive T24 Wake-up Diagnostic ---');
    try {
        const devices = HID.devices();
        const info = devices.find(d => d.vendorId === VID && d.productId === PID);
        if (!info) {
            console.error('❌ T24 Dongle not found.');
            return;
        }

        console.log('✅ Dongle found at:', info.path);
        const device = new HID.HID(info.path);

        device.on('data', (data) => {
            if (data[0] === 0x0B) {
                console.log('📡 DATA RECEIVED! Tag:', data.readUInt16BE(4).toString(16).toUpperCase());
            } else {
                console.log('Received Packet ID:', data[0].toString(16));
            }
        });

        console.log('Starting 5-second aggressive wake-up burst (65-byte buffers)...');

        const burstInterval = setInterval(() => {
            try {
                // T24-BSue usually requires 65 bytes on Windows (1 Report ID + 64 bytes)
                const packet = Buffer.alloc(65);
                packet[0] = 0x05; // Report ID
                packet[1] = 0x02; // Command: Wake Up
                packet[2] = 0xFF; // Broadcast high
                packet[3] = 0xFF; // Broadcast low

                device.write(packet);

                // Also send Stay Awake just in case
                const stayAwake = Buffer.alloc(65);
                stayAwake[0] = 0x05;
                stayAwake[1] = 0x01; // Command: Stay Awake
                stayAwake[2] = 0xFF;
                stayAwake[3] = 0xFF;
                device.write(stayAwake);
            } catch (e) {
                console.error('Write failed:', e.message);
            }
        }, 100); // 10 pulses per second

        setTimeout(() => {
            clearInterval(burstInterval);
            console.log('Burst finished. Slowing down to maintenance pulses (1s)...');

            setInterval(() => {
                try {
                    const stayAwake = Buffer.alloc(65);
                    stayAwake[0] = 0x05;
                    stayAwake[1] = 0x01;
                    stayAwake[2] = 0xFF;
                    stayAwake[3] = 0xFF;
                    device.write(stayAwake);
                    console.log('Sent Stay-Awake Maintenance');
                } catch (e) { }
            }, 1000);
        }, 5000);

    } catch (err) {
        console.error('Error:', err.message);
    }
}

runAggressiveWake();
