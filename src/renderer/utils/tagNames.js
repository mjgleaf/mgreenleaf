// Friendly display names for T24 load cell tags.
// The radio tag hex (e.g. "58E3") often differs from the serial number painted
// on the cell (e.g. "LL-1053"). Names live in settings.json under t24TagNames
// and are display-only: logged data, calibration, and CSV exports keep the raw
// hex tag so renaming never breaks historical data or calibration lookups.

// Dropdown label: "LL-1053 (58E3)" when named, "Tag: 58E3" otherwise.
export function getTagLabel(tag, tagNames) {
    if (!tag) return '';
    const name = tagNames?.[tag];
    return name ? `${name} (${tag})` : `Tag: ${tag}`;
}

// Compact label for graph legends and readouts: "LL-1053" or "Cell 58E3".
export function getTagDisplayName(tag, tagNames) {
    if (!tag) return '';
    return tagNames?.[tag] || `Cell ${tag}`;
}
