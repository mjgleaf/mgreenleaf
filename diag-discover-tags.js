const HID = require('node-hid');
const VID = 0x1781;
const PID = 0x0BA4;

console.log('=== T24 Transmitter Discovery Tool ===\n');

const seenTags = new Map(); // tag -> { count, lastSeen, lastValue }

async function scanForTransmitters() {
    try {
        const devices = HID.devices();
        const info = devices.find(d => d.vendorId === VID && d.productId === PID);

        if (!info) {
            console.error('❌ T24 Dongle not found. Please connect the dongle.');
            return;
        }

        console.log('✅ T24 Dongle found at:', info.path);
        const device = new HID.HID(info.path);

        device.on('data', (data) => {
            // Only process Data Provider packets (0x0B)
            if (data[0] === 0x0B && data.length >= 12) {
                try {
                    const dataTag = data.readUInt16BE(4);
                    const tagHex = dataTag.toString(16).toUpperCase().padStart(4, '0');
                    const tonnes = data.readFloatBE(8);
                    const lbs = tonnes * 2204.62262;

                    if (!seenTags.has(tagHex)) {
                        console.log(`\n🆕 NEW TAG DISCOVERED: ${tagHex}`);
                        seenTags.set(tagHex, { count: 0, lastSeen: Date.now(), lastValue: lbs });
                    }

                    const tagInfo = seenTags.get(tagHex);
                    tagInfo.count++;
                    tagInfo.lastSeen = Date.now();
                    tagInfo.lastValue = lbs;
                } catch (e) {
                    // Ignore parsing errors
                }
            }
        });

        device.on('error', (err) => {
            console.error('HID Device Error:', err);
        });

        // Send wake-up broadcasts every second
        console.log('\n📡 Sending wake-up broadcasts...\n');
        setInterval(() => {
            try {
                const wake = Buffer.alloc(65);
                wake[0] = 0x05;
                wake[1] = 0x02; // Wake Up
                wake[2] = 0xFF;
                wake[3] = 0xFF;
                device.write(wake);

                const stayAwake = Buffer.alloc(65);
                stayAwake[0] = 0x05;
                stayAwake[1] = 0x01; // Stay Awake
                stayAwake[2] = 0xFF;
                stayAwake[3] = 0xFF;
                device.write(stayAwake);
            } catch (e) {
                console.error('Broadcast error:', e.message);
            }
        }, 1000);

        // Print summary every 5 seconds
        setInterval(() => {
            console.clear();
            console.log('=== T24 Transmitter Discovery Tool ===\n');
            console.log(`Discovered Tags: ${seenTags.size}\n`);

            if (seenTags.size === 0) {
                console.log('⚠️  No transmitters detected yet.');
                console.log('   - Are the load cells powered on?');
                console.log('   - Are they on the same Group ID as the dongle?');
                console.log('   - Try pressing a button on the handheld to wake them.\n');
            } else {
                console.log('Tag ID  | Packets | Last Value (lbs) | Last Seen');
                console.log('--------|---------|------------------|----------');

                const now = Date.now();
                seenTags.forEach((info, tag) => {
                    const age = Math.floor((now - info.lastSeen) / 1000);
                    const ageStr = age < 5 ? '✅ Active' : `⏰ ${age}s ago`;
                    console.log(`${tag}   | ${String(info.count).padStart(7)} | ${info.lastValue.toFixed(2).padStart(16)} | ${ageStr}`);
                });
            }
        }, 5000);

    } catch (err) {
        console.error('Error:', err.message);
    }
}

scanForTransmitters();
