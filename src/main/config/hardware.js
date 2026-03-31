// T24 USB HID Hardware Constants
module.exports = {
    // USB Device Identification
    T24_VID: 0x1781,
    T24_PID: 0x0ba4,

    // HID Report Buffer
    HID_BUFFER_SIZE: 65,

    // Report IDs
    REPORT_ID_POLL: 0x01,
    REPORT_ID_CONTROL: 0x05,
    REPORT_ID_DATA: 0x0B,

    // Commands
    CMD_STAY_AWAKE: 0x01,
    CMD_WAKE_UP: 0x02,
    CMD_REQUEST_DATA: 0x03,

    // Broadcast Address
    BROADCAST_ADDR: 0xFF,

    // Packet Parsing
    DATA_TAG_OFFSET: 4,
    WEIGHT_VALUE_OFFSET: 8,
    MIN_PACKET_LENGTH: 12,

    // Wake Burst Configuration
    WAKE_BURST_COUNT: 50,
    WAKE_BURST_INTERVAL_MS: 100,

    // Timing Intervals
    KEEP_AWAKE_INTERVAL_MS: 1000,
    POLL_INTERVAL_MS: 500,
    DEVICE_SCAN_INTERVAL_MS: 2000,

    // Default Group ID
    DEFAULT_GROUP_ID: 0,

    // Smoothing Filter
    SMOOTHING_BUFFER_SIZE: 10,

    // Sanity Check
    MAX_REASONABLE_VALUE: 1000000,

    // Weight Conversion
    WEIGHT_CONVERSION: {
        TONNES_TO_LBS: 2204.62262,
    },
};
