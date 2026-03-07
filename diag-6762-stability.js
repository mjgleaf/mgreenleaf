const HID = require('node-hid');
const VID = 0x1781;
const PID = 0x0BA4;

console.log('=== Tag 6762 Stability Test ===\n');

try {
    const devices = HID.devices();
    const info = devices.find(d => d.vendorId === VID && d.productId === PID);

    if (!info) {
        console.error('❌ Dongle not found');
        process.exit(1);
    }

    const device = new HID.HID(info.path);
    const packets = [];
    let packetCount = 0;

    device.on('data', (data) => {
        if (data[0] === 0x0B && data.length >= 12) {
            const dataTag = data.readUInt16BE(4);
            const tagHex = dataTag.toString(16).toUpperCase().padStart(4, '0');

            if (tagHex === '6762') {
                packetCount++;
                const tonnes = data.readFloatBE(8);
                const lbs = tonnes * 2204.62262;

                packets.push({
                    num: packetCount,
                    tonnes: tonnes.toFixed(6),
                    lbs: lbs.toFixed(2),
                    rawHex: `${data[8].toString(16).padStart(2, '0')} ${data[9].toString(16).padStart(2, '0')} ${data[10].toString(16).padStart(2, '0')} ${data[11].toString(16).padStart(2, '0')}`.toUpperCase()
                });

                if (packets.length > 15) packets.shift();
            }
        }
    });

    // Wake signals
    setInterval(() => {
        try {
            const wake = Buffer.alloc(65);
            wake[0] = 0x05;
            wake[1] = 0x02;
            wake[2] = 0xFF;
            wake[3] = 0xFF;
            wake[4] = 0;
            device.write(wake);
        } catch (e) { }
    }, 1000);

    // Display
    setInterval(() => {
        console.clear();
        console.log('=== Tag 6762 Stability Test ===\n');
        console.log(`Total Packets Received: ${packetCount}\n`);

        if (packets.length === 0) {
            console.log('⏳ Waiting for Tag 6762 packets...\n');
            return;
        }

        console.log('Last 15 packets:');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('#    | Raw Hex        | Tonnes      | LBS');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

        packets.forEach(p => {
            console.log(`${String(p.num).padStart(4)} | ${p.rawHex} | ${p.tonnes.padStart(11)} | ${p.lbs.padStart(12)}`);
        });

        // Calculate statistics
        const values = packets.map(p => parseFloat(p.lbs));
        const min = Math.min(...values);
        const max = Math.max(...values);
        const avg = values.reduce((a, b) => a + b, 0) / values.length;
        const range = max - min;

        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log(`\n📊 Statistics (last ${packets.length} packets):`);
        console.log(`   Min: ${min.toFixed(2)} lbs`);
        console.log(`   Max: ${max.toFixed(2)} lbs`);
        console.log(`   Avg: ${avg.toFixed(2)} lbs`);
        console.log(`   Range: ${range.toFixed(2)} lbs`);

        if (range > 10000) {
            console.log(`\n⚠️  WARNING: Large variation detected! (${range.toFixed(0)} lbs)`);
            console.log('   This indicates unstable/corrupted data from Tag 6762.');
        } else if (range > 1000) {
            console.log(`\n⚠️  Moderate variation (${range.toFixed(0)} lbs) - may be normal noise`);
        } else {
            console.log(`\n✅ Stable readings (variation: ${range.toFixed(0)} lbs)`);
        }

        console.log('\nPress Ctrl+C to exit');
    }, 1000);

} catch (err) {
    console.error('Error:', err.message);
}
