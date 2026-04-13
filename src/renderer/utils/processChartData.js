/**
 * Pivot multi-tag live-logged data into one row per time bucket with a column per tag.
 * Input:  [{ Tag: "58EF", value: 100, "Elapsed (ms)": 0 }, { Tag: "6762", value: 50, "Elapsed (ms)": 334 }, ...]
 * Output: [{ "Elapsed (ms)": 0, "Cell 58EF": 100, "Cell 6762": 50, "Total Load": 150, timestamp: ... }, ...]
 */
const pivotMultiTagData = (data) => {
    const headers = Object.keys(data[0]);
    const hasTag = headers.includes('Tag') || headers.includes('tag');
    if (!hasTag) return null;

    const tagKey = headers.includes('Tag') ? 'Tag' : 'tag';
    const tags = [...new Set(data.map(d => d[tagKey]).filter(Boolean))];
    if (tags.length <= 1) return null; // Single tag — no pivot needed

    const timeKey = headers.find(h => /elapsed/i.test(h)) || headers.find(h => /time/i.test(h));
    if (!timeKey) return null;

    // Group by time bucket (round to nearest 500ms to merge close timestamps)
    const bucketSize = 500;
    const buckets = new Map();
    const lastKnown = {}; // Track last known value per tag for interpolation

    data.forEach(row => {
        const tag = row[tagKey];
        const rawTime = typeof row[timeKey] === 'number' ? row[timeKey] : parseFloat(row[timeKey]) || 0;
        const bucketTime = Math.round(rawTime / bucketSize) * bucketSize;

        if (!buckets.has(bucketTime)) {
            // Start with last known values for all tags
            const newRow = { [timeKey]: bucketTime };
            tags.forEach(t => {
                newRow[`Cell ${t}`] = lastKnown[t] || 0;
            });
            if (row.timestamp) newRow.timestamp = row.timestamp;
            buckets.set(bucketTime, newRow);
        }

        const bucket = buckets.get(bucketTime);
        const val = typeof row.value === 'number' ? row.value : parseFloat(row.value) || 0;
        bucket[`Cell ${tag}`] = val;
        lastKnown[tag] = val;

        // Recalculate total
        let total = 0;
        tags.forEach(t => { total += bucket[`Cell ${t}`] || 0; });
        bucket['Total Load'] = total;
    });

    return [...buckets.values()].sort((a, b) => a[timeKey] - b[timeKey]);
};

const processChartData = (data, serialLabels = [], displayUnit = 'lbs', displayTimeUnit = 'min', inputTimeUnit = null, xUnit = 'min', chartMode = 'perCell') => {
    if (!data || data.length === 0) return null;

    try {
        // Pivot multi-tag data so each load cell gets its own chart line
        const pivoted = pivotMultiTagData(data);
        if (pivoted) {
            if (chartMode === 'combined') {
                // Combined mode: use pivoted data but only show Total Load line
                data = pivoted.map(row => {
                    const { ...rest } = row;
                    // Remove individual Cell columns, keep Total Load
                    const cleaned = {};
                    Object.keys(rest).forEach(k => {
                        if (!/^Cell\s/i.test(k)) cleaned[k] = rest[k];
                    });
                    return cleaned;
                });
            } else {
                data = pivoted;
            }
        }

        const headers = Object.keys(data[0]);

        const parseNum = (v) => {
            if (typeof v === 'number') return v;
            if (!v) return 0;
            return parseFloat(v.toString().replace(/,/g, '')) || 0;
        };

        const timeToSec = (v) => {
            if (!v) return 0;
            const s = v.toString().trim();
            const m = s.match(/(\d{1,2}):(\d{2})(:(\d{2}))?/);
            if (m) {
                return parseInt(m[1], 10) * 3600 + parseInt(m[2], 10) * 60 + (m[4] ? parseInt(m[4], 10) : 0);
            }
            return parseNum(v);
        };

        let weightKeys = headers.filter(h => /pounds|lbs|weight|load|force|^Cell\s/i.test(h));
        if (weightKeys.length > 1) {
            const hasTotal = weightKeys.some(h => /total/i.test(h));
            const hasIndividual = weightKeys.some(h => /hook|cell|channel|tag|pounds|lbs/i.test(h) && !/total/i.test(h));
            if (hasTotal && hasIndividual) {
                weightKeys = weightKeys.filter(h => !/total/i.test(h));
            }
        }
        if (weightKeys.length === 0) weightKeys.push(headers[1] || headers[0]);

        const timeKey = headers.find(h => /elapsed|second/i.test(h)) ||
            headers.find(h => /time|stamp/i.test(h)) ||
            headers[0];

        const isMs = /ms|millisecond/i.test(timeKey);
        const isMin = !isMs && /min/i.test(timeKey);
        const isHrs = !isMs && !isMin && /hour/i.test(timeKey);

        const times = data.map(d => {
            const val = timeToSec(d[timeKey]);
            const unit = inputTimeUnit || (isMs ? 'ms' : (isMin ? 'min' : (isHrs ? 'hrs' : 'sec')));

            if (unit === 'ms') return val / 1000;
            if (unit === 'min') return val * 60;
            if (unit === 'hrs') return val * 3600;
            return val; // assumed seconds
        });

        const getValInLbs = (row, key) => {
            const raw = parseNum(row[key]);
            const header = key.toLowerCase();
            if (header.includes('tonne') || header.includes('mt')) return raw * 2204.6;
            if (header.includes('ton')) return raw * 2000;
            return raw;
        };

        const sortedData = [...data].sort((a, b) => timeToSec(a[timeKey]) - timeToSec(b[timeKey]));

        const filteredData = sortedData.filter((d, i, arr) => {
            const currentWeight = weightKeys.reduce((sum, key) => sum + getValInLbs(d, key), 0);
            if (currentWeight === 0 && i > 0 && i < arr.length - 1) {
                const prevWeight = weightKeys.reduce((sum, key) => sum + getValInLbs(arr[i - 1], key), 0);
                const nextWeight = weightKeys.reduce((sum, key) => sum + getValInLbs(arr[i + 1], key), 0);
                if (prevWeight > 500 && nextWeight > 500) return false;
            }
            return true;
        });

        const effectiveUnit = inputTimeUnit || (isMs ? 'ms' : (isMin ? 'min' : (isHrs ? 'hrs' : 'sec')));
        const filteredTimes = filteredData.map(d => {
            const val = timeToSec(d[timeKey]);
            if (effectiveUnit === 'ms') return val / 1000;
            if (effectiveUnit === 'min') return val * 60;
            if (effectiveUnit === 'hrs') return val * 3600;
            return val;
        });
        const totalLoads = filteredData.map(d => weightKeys.reduce((sum, key) => sum + getValInLbs(d, key), 0));

        let maxWeight = 0;
        let maxIndex = 0;
        for (let i = 0; i < totalLoads.length; i++) {
            if (totalLoads[i] > maxWeight) {
                maxWeight = totalLoads[i];
                maxIndex = i;
            }
        }
        const maxRow = filteredData[maxIndex === -1 ? 0 : maxIndex];

        let peakTime = '';
        if (maxRow) {
            const allValues = Object.entries(maxRow);
            const timeVal = allValues.find(([k, v]) => v && typeof v === 'string' && /(\d{1,2}[:.]\d{2})/.test(v));
            if (timeVal) {
                const match = timeVal[1].match(/(\d{1,2}[:.]\d{2})/);
                peakTime = match[1].replace('.', ':');
            } else if (maxRow.timestamp) {
                peakTime = new Date(maxRow.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
            } else {
                const tHeader = headers.find(h => /time|clock|hour|recorded/i.test(h));
                if (tHeader && maxRow[tHeader]) {
                    const val = maxRow[tHeader].toString().trim();
                    peakTime = val.match(/(\d{1,2}[:.]?\d{2})/)?.[1] || val.slice(0, 5);
                    if (peakTime.length === 4 && !peakTime.includes(':')) {
                        peakTime = peakTime.slice(0, 2) + ':' + peakTime.slice(2);
                    }
                }
            }
        }

        let minVal = filteredTimes.length > 0 ? filteredTimes[0] : 0;
        let maxVal = filteredTimes.length > 0 ? filteredTimes[0] : 0;
        for (let i = 1; i < filteredTimes.length; i++) {
            if (filteredTimes[i] < minVal) minVal = filteredTimes[i];
            if (filteredTimes[i] > maxVal) maxVal = filteredTimes[i];
        }
        let totalTimeSec = maxVal - minVal;

        let totalTimeVal = totalTimeSec / 60;
        if (displayTimeUnit === 'hrs') {
            totalTimeVal = totalTimeSec / 3600;
        }

        const unitFactor = displayUnit === 'tons' ? 1 / 2000 : 1;
        const timeFactor = xUnit === 'hour' ? 1 / 60 : 1;

        return {
            maxWeight: maxWeight * unitFactor,
            totalTime: totalTimeVal || 0,
            peakTime: peakTime || '',
            timeKey,
            weightKey: weightKeys[0],
            chartData: {
                labels: filteredTimes.map(seconds => {
                    const val = xUnit === 'hour' ? seconds / 3600 : seconds / 60;
                    return val.toFixed(2);
                }),
                datasets: weightKeys.map((key, i) => {
                    const palette = ['#1a3a6c', '#3fb950', '#2188ff', '#f85149', '#dbab09', '#8957e5'];
                    const defaultLabel = /^Cell\s/i.test(key) ? key : `Hook ${i + 1}`;
                    const customLabel = serialLabels[i] ? serialLabels[i].trim() : defaultLabel;
                    return {
                        label: customLabel,
                        data: filteredData.map(d => getValInLbs(d, key) * unitFactor),
                        borderColor: palette[i % palette.length],
                        backgroundColor: i === 0 ? 'rgba(26, 58, 108, 0.1)' : 'transparent',
                        fill: i === 0 && weightKeys.length === 1,
                        tension: 0.2,
                        pointRadius: 0
                    };
                })
            }
        };
    } catch (err) {
        console.error("OSCAR Data Logic Error:", err.message, err.stack);
        console.error("Data length:", data?.length, "First row:", JSON.stringify(data?.[0]));
        return null;
    }
};

export default processChartData;
