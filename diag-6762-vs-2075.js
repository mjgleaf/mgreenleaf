const HID = require('node-hid');
const VID = 0x1781;
const PID = 0x0BA4;

console.log('=== Tag 6762 Raw Data Inspector ===\n');

try {
    const devices = HID.devices();
    const info = devices.find(d => d.vendorId === VID && d.productId === PID);

    if (!info) {
        console.error('❌ Dongle not found');
        process.exit(1);
    }

    const device = new HID.HID(info.path);
    const tag6762Packets = [];
    const tag2075Packets = [];

    device.on('data', (data) => {
        if (data[0] === 0x0B && data.length >= 12) {
            const dataTag = data.readUInt16BE(4);
            const tagHex = dataTag.toString(16).toUpperCase().padStart(4, '0');

            // Get raw bytes
            const b8 = data[8].toString(16).padStart(2, '0').toUpperCase();
            const b9 = data[9].toString(16).padStart(2, '0').toUpperCase();
            const b10 = data[10].toString(16).padStart(2, '0').toUpperCase();
            const b11 = data[11].toString(16).padStart(2, '0').toUpperCase();

            // Try different interpretations
            const floatBE = data.readFloatBE(8);
            const floatLE = data.readFloatLE(8);
            const uint32BE = data.readUInt32BE(8);
            const int32BE = data.readInt32BE(8);

            const lbsBE = floatBE * 2204.62262;
            const lbsLE = floatLE * 2204.62262;

            const packet = {
                tag: tagHex,
                rawHex: `${b8} ${b9} ${b10} ${b11}`,
                floatBE: floatBE.toFixed(6),
                floatLE: floatLE.toFixed(6),
                uint32BE,
                int32BE,
                lbsBE: lbsBE.toFixed(2),
                lbsLE: lbsLE.toFixed(2),
                timestamp: Date.now()
            };

            if (tagHex === '6762') {
                tag6762Packets.push(packet);
                if (tag6762Packets.length > 10) tag6762Packets.shift();
            } else if (tagHex === '2075') {
                tag2075Packets.push(packet);
                if (tag2075Packets.length > 10) tag2075Packets.shift();
            }
        }
    });

    // Send wake signals
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
        // console.clear();
        console.log('=== Tag 6762 vs Tag 2075 Comparison ===\n');

        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('TAG 6762 (Last 3 packets):');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        const last6762 = tag6762Packets.slice(-3);
        last6762.forEach((p, i) => {
            console.log(`\nPacket ${i + 1}:`);
            console.log(`  Raw Hex: ${p.rawHex}`);
            console.log(`  Float BE: ${p.floatBE} tonnes → ${p.lbsBE} lbs`);
            console.log(`  Float LE: ${p.floatLE} tonnes → ${p.lbsLE} lbs`);
        });

        console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        console.log('TAG 2075 (Last 3 packets):');
        console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
        const last2075 = tag2075Packets.slice(-3);
        last2075.forEach((p, i) => {
            console.log(`\nPacket ${i + 1}:`);
            console.log(`  Raw Hex: ${p.rawHex}`);
            console.log(`  Float BE: ${p.floatBE} tonnes → ${p.lbsBE} lbs`);
            console.log(`  Float LE: ${p.floatLE} tonnes → ${p.lbsLE} lbs`);
        });

        console.log('\n\nPress Ctrl+C to exit');
    }, 2000);

} catch (err) {
    console.error('Error:', err.message);
}
