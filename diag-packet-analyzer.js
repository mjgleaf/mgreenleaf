const HID = require('node-hid');
const VID = 0x1781;
const PID = 0x0BA4;

console.log('=== T24 Raw Packet Analyzer ===\n');
console.log('This tool captures raw packets from your load cells to diagnose unit mismatches.\n');

const packetsById = new Map(); // tag -> array of packets

async function analyzePackets() {
    try {
        const devices = HID.devices();
        const info = devices.find(d => d.vendorId === VID && d.productId === PID);

        if (!info) {
            console.error('❌ T24 Dongle not found. Please connect the dongle.');
            return;
        }

        console.log('✅ T24 Dongle found\n');
        const device = new HID.HID(info.path);

        device.on('data', (data) => {
            // Only process Data Provider packets (0x0B)
            if (data[0] === 0x0B && data.length >= 12) {
                try {
                    const dataTag = data.readUInt16BE(4);
                    const tagHex = dataTag.toString(16).toUpperCase().padStart(4, '0');

                    // Read raw float bytes
                    const byte8 = data[8];
                    const byte9 = data[9];
                    const byte10 = data[10];
                    const byte11 = data[11];

                    // Read as float (Big Endian)
                    const tonnes = data.readFloatBE(8);
                    const lbs = tonnes * 2204.62262;

                    const packet = {
                        tag: tagHex,
                        rawBytes: `${byte8.toString(16).padStart(2, '0')} ${byte9.toString(16).padStart(2, '0')} ${byte10.toString(16).padStart(2, '0')} ${byte11.toString(16).padStart(2, '0')}`,
                        tonnes: tonnes,
                        lbs: lbs,
                        timestamp: Date.now()
                    };

                    if (!packetsById.has(tagHex)) {
                        packetsById.set(tagHex, []);
                    }
                    packetsById.get(tagHex).push(packet);

                } catch (e) {
                    // Ignore parsing errors
                }
            }
        });

        device.on('error', (err) => {
            console.error('HID Device Error:', err);
        });

        // Send wake-up broadcasts
        const groupId = 0; // Adjust if your Group ID is different
        setInterval(() => {
            try {
                const wake = Buffer.alloc(65);
                wake[0] = 0x05;
                wake[1] = 0x02;
                wake[2] = 0xFF;
                wake[3] = 0xFF;
                wake[4] = groupId;
                device.write(wake);
            } catch (e) {
                console.error('Broadcast error:', e.message);
            }
        }, 1000);

        // Print analysis every 3 seconds
        setInterval(() => {
            console.clear();
            console.log('=== T24 Raw Packet Analyzer ===\n');

            if (packetsById.size === 0) {
                console.log('⏳ Waiting for data packets...\n');
                return;
            }

            packetsById.forEach((packets, tag) => {
                if (packets.length === 0) return;

                // Get last 3 packets for this tag
                const recent = packets.slice(-3);

                console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
                console.log(`TAG: ${tag} (${packets.length} packets captured)`);
                console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);

                recent.forEach((p, idx) => {
                    console.log(`\nPacket ${packets.length - recent.length + idx + 1}:`);
                    console.log(`  Raw Bytes (8-11): 0x${p.rawBytes.toUpperCase()}`);
                    console.log(`  Interpreted as Float (BE): ${p.tonnes.toFixed(6)} tonnes`);
                    console.log(`  Converted to LBS: ${p.lbs.toFixed(2)} lbs`);
                });

                // Calculate average
                const avgLbs = packets.reduce((sum, p) => sum + p.lbs, 0) / packets.length;
                console.log(`\n  📊 Average: ${avgLbs.toFixed(2)} lbs`);
            });

            console.log('\n\n💡 INTERPRETATION GUIDE:');
            console.log('  - If Tag 2075 shows small values (near 0) and Tag 6762 shows large values,');
            console.log('    then 6762 may be configured with a different capacity/scale.');
            console.log('  - Compare the raw bytes to see if they follow the same pattern.');
            console.log('  - The T24 spec says bytes 8-11 should be a Float32 in metric tonnes.');
            console.log('\nPress Ctrl+C to exit.\n');

        }, 3000);

    } catch (err) {
        console.error('Error:', err.message);
    }
}

analyzePackets();
