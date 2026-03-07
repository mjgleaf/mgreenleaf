const HID = require('node-hid');
const VID = 0x1781;
const PID = 0x0BA4;

console.log('=== Quick T24 Connection Test ===\n');

try {
    const devices = HID.devices();
    const info = devices.find(d => d.vendorId === VID && d.productId === PID);

    if (!info) {
        console.error('❌ T24 Dongle NOT FOUND');
        console.log('\nPlease check:');
        console.log('  • Is the dongle plugged in?');
        console.log('  • Try unplugging and replugging the dongle');
        process.exit(1);
    }

    console.log('✅ T24 Dongle FOUND');
    console.log(`   Path: ${info.path}\n`);

    const device = new HID.HID(info.path);
    let packetCount = 0;
    let tags = new Set();

    device.on('data', (data) => {
        packetCount++;

        if (data[0] === 0x0B && data.length >= 12) {
            const dataTag = data.readUInt16BE(4);
            const tagHex = dataTag.toString(16).toUpperCase().padStart(4, '0');
            tags.add(tagHex);
        }
    });

    device.on('error', (err) => {
        console.error('❌ Device Error:', err.message);
    });

    // Send wake-up broadcasts
    setInterval(() => {
        try {
            const wake = Buffer.alloc(65);
            wake[0] = 0x05;
            wake[1] = 0x02;
            wake[2] = 0xFF;
            wake[3] = 0xFF;
            wake[4] = 0; // Group ID 0
            device.write(wake);
        } catch (e) {
            console.error('Broadcast error:', e.message);
        }
    }, 1000);

    // Report status every 2 seconds
    setInterval(() => {
        console.clear();
        console.log('=== Quick T24 Connection Test ===\n');
        console.log(`✅ Dongle Connected`);
        console.log(`📡 Packets Received: ${packetCount}`);
        console.log(`🏷️  Tags Discovered: ${tags.size > 0 ? Array.from(tags).join(', ') : 'None yet'}`);

        if (packetCount === 0) {
            console.log('\n⚠️  NO DATA RECEIVED');
            console.log('   • Are the load cells powered on?');
            console.log('   • Do they show on the handheld?');
            console.log('   • Press a button on the handheld to wake them');
        } else if (tags.size === 0) {
            console.log('\n⚠️  Receiving packets but no valid tags found');
        }

        console.log('\nPress Ctrl+C to exit');
    }, 2000);

} catch (err) {
    console.error('❌ Error:', err.message);
}
