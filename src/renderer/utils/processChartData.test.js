import { describe, it, expect } from 'vitest';
import processChartData from './processChartData';

describe('processChartData', () => {
    it('returns null for empty data', () => {
        expect(processChartData(null)).toBeNull();
        expect(processChartData([])).toBeNull();
        expect(processChartData(undefined)).toBeNull();
    });

    it('parses simple time/weight data', () => {
        const data = [
            { 'Elapsed Seconds': '0', 'Pounds': '100' },
            { 'Elapsed Seconds': '10', 'Pounds': '500' },
            { 'Elapsed Seconds': '20', 'Pounds': '300' },
        ];
        const result = processChartData(data);

        expect(result).not.toBeNull();
        expect(result.maxWeight).toBe(500);
        expect(result.chartData.datasets).toHaveLength(1);
        expect(result.chartData.datasets[0].data).toEqual([100, 500, 300]);
    });

    it('detects weight key from header names', () => {
        const data = [
            { 'Time': '0', 'Load (lbs)': '200' },
            { 'Time': '5', 'Load (lbs)': '800' },
        ];
        const result = processChartData(data);

        expect(result).not.toBeNull();
        expect(result.maxWeight).toBe(800);
    });

    it('converts tons display unit', () => {
        const data = [
            { 'Elapsed Seconds': '0', 'Pounds': '2000' },
            { 'Elapsed Seconds': '10', 'Pounds': '4000' },
        ];
        const result = processChartData(data, [], 'tons');

        expect(result.maxWeight).toBe(2); // 4000 lbs = 2 tons
        expect(result.chartData.datasets[0].data[1]).toBe(2);
    });

    it('handles multiple weight columns (filters total when individual present)', () => {
        const data = [
            { 'Time': '0', 'Hook 1 Pounds': '100', 'Hook 2 Pounds': '200', 'Total Pounds': '300' },
            { 'Time': '5', 'Hook 1 Pounds': '400', 'Hook 2 Pounds': '500', 'Total Pounds': '900' },
        ];
        const result = processChartData(data);

        expect(result).not.toBeNull();
        // Should filter out "Total" and use individual hooks
        expect(result.chartData.datasets).toHaveLength(2);
    });

    it('applies custom serial labels to datasets', () => {
        const data = [
            { 'Elapsed Seconds': '0', 'Hook 1 Pounds': '100', 'Hook 2 Pounds': '200' },
            { 'Elapsed Seconds': '5', 'Hook 1 Pounds': '300', 'Hook 2 Pounds': '400' },
        ];
        const result = processChartData(data, ['Crane A', 'Crane B']);

        expect(result.chartData.datasets[0].label).toBe('Crane A');
        expect(result.chartData.datasets[1].label).toBe('Crane B');
    });

    it('calculates total time in minutes', () => {
        const data = [
            { 'Elapsed Seconds': '0', 'Weight': '100' },
            { 'Elapsed Seconds': '120', 'Weight': '200' },
        ];
        const result = processChartData(data);

        expect(result.totalTime).toBe(2); // 120 seconds = 2 minutes
    });

    it('calculates total time in hours when requested', () => {
        const data = [
            { 'Elapsed Seconds': '0', 'Weight': '100' },
            { 'Elapsed Seconds': '7200', 'Weight': '200' },
        ];
        const result = processChartData(data, [], 'lbs', 'hrs');

        expect(result.totalTime).toBe(2); // 7200 seconds = 2 hours
    });

    it('handles time in HH:MM:SS format', () => {
        const data = [
            { 'Elapsed Time': '00:00:00', 'Force': '100' },
            { 'Elapsed Time': '00:05:00', 'Force': '500' },
        ];
        const result = processChartData(data);

        expect(result).not.toBeNull();
        expect(result.maxWeight).toBe(500);
        expect(result.totalTime).toBe(5); // 5 minutes
    });

    it('filters zero-weight glitch data points', () => {
        const data = [
            { 'Elapsed Seconds': '0', 'Pounds': '1000' },
            { 'Elapsed Seconds': '5', 'Pounds': '0' },    // glitch - surrounded by >500
            { 'Elapsed Seconds': '10', 'Pounds': '1000' },
        ];
        const result = processChartData(data);

        // The zero point should be filtered out
        expect(result.chartData.datasets[0].data).toHaveLength(2);
        expect(result.chartData.datasets[0].data).toEqual([1000, 1000]);
    });

    it('handles tonne-to-lbs conversion in headers', () => {
        const data = [
            { 'Elapsed Seconds': '0', 'Force (tonne)': '1' },
            { 'Elapsed Seconds': '10', 'Force (tonne)': '2' },
        ];
        const result = processChartData(data);

        expect(result.maxWeight).toBeCloseTo(4409.2, 0); // 2 tonnes * 2204.6
    });

    it('sorts data by time before processing', () => {
        const data = [
            { 'Elapsed Seconds': '20', 'Pounds': '300' },
            { 'Elapsed Seconds': '0', 'Pounds': '100' },
            { 'Elapsed Seconds': '10', 'Pounds': '500' },
        ];
        const result = processChartData(data);

        // Data should be sorted: 100, 500, 300
        expect(result.chartData.datasets[0].data).toEqual([100, 500, 300]);
    });

    it('handles minutes as input time unit', () => {
        const data = [
            { 'Elapsed Minutes': '0', 'Weight': '100' },
            { 'Elapsed Minutes': '5', 'Weight': '200' },
        ];
        const result = processChartData(data, [], 'lbs', 'min', 'min');

        // Note: inputTimeUnit affects chart labels but duration uses raw timeToSec values
        expect(result).not.toBeNull();
        expect(result.maxWeight).toBe(200);
    });

    it('returns peakTime when available', () => {
        const data = [
            { 'Elapsed Seconds': '0', 'Pounds': '100', 'Time': '08:30' },
            { 'Elapsed Seconds': '10', 'Pounds': '500', 'Time': '08:35' },
        ];
        const result = processChartData(data);

        expect(result.peakTime).toBeTruthy();
    });

    it('does NOT scavenge peakTime from comma-formatted weight strings', () => {
        // "28,450.75" used to yield peakTime "50:75" — a nonsense certified time.
        const data = [
            { 'Elapsed Seconds': 0, 'Pounds': '10,100.25' },
            { 'Elapsed Seconds': 10, 'Pounds': '28,450.75' },
        ];
        const result = processChartData(data);

        expect(result).not.toBeNull();
        expect(result.peakTime).not.toMatch(/^\d{1,2}:[6-9]\d$/); // no minutes >= 60
        expect(result.peakTime).not.toBe('50:75');
    });

    it('preserves the true per-tag peak within a 500ms pivot bucket (multi-tag)', () => {
        // Two tags → pivot path. Tag A peaks at 10250 lbs mid-bucket, then a
        // later lower sample lands in the SAME bucket (both round to 10000ms).
        // Last-sample-wins used to discard the peak, understating the
        // certificate's measured force.
        const data = [
            { Tag: 'AAAA', value: 10000, 'Elapsed (ms)': 9800 },
            { Tag: 'BBBB', value: 5000, 'Elapsed (ms)': 9810 },
            { Tag: 'AAAA', value: 10250, 'Elapsed (ms)': 10100 }, // true peak
            { Tag: 'AAAA', value: 9900, 'Elapsed (ms)': 10200 },  // same bucket, lower
            { Tag: 'BBBB', value: 5000, 'Elapsed (ms)': 10150 },
        ];
        const result = processChartData(data);

        expect(result).not.toBeNull();
        // Peak of the total must include tag A's 10250, not the later 9900.
        expect(result.maxWeight).toBe(15250);
    });

    it('multi-tag maxWeight is the peak INSTANTANEOUS total, not a sum of non-simultaneous peaks', () => {
        // A peaks early in the bucket, B peaks late. Sum-of-bucket-peaks would
        // claim 5200+5100=10300 lbs; the true applied maximum was 9900.
        const data = [
            { Tag: 'AAAA', value: 5200, 'Elapsed (ms)': 120 },
            { Tag: 'BBBB', value: 4700, 'Elapsed (ms)': 130 },
            { Tag: 'AAAA', value: 4800, 'Elapsed (ms)': 400 },
            { Tag: 'BBBB', value: 5100, 'Elapsed (ms)': 430 },
        ];
        const result = processChartData(data);

        expect(result).not.toBeNull();
        expect(result.maxWeight).toBe(9900);
    });

    it('multi-tag pivot still carries the LATEST value forward between buckets', () => {
        const data = [
            { Tag: 'AAAA', value: 100, 'Elapsed (ms)': 0 },
            { Tag: 'BBBB', value: 50, 'Elapsed (ms)': 10 },
            { Tag: 'AAAA', value: 300, 'Elapsed (ms)': 100 },  // peak in bucket 0
            { Tag: 'AAAA', value: 200, 'Elapsed (ms)': 200 },  // last in bucket 0
            { Tag: 'BBBB', value: 60, 'Elapsed (ms)': 1000 },  // bucket 1000: A carried forward
        ];
        const result = processChartData(data);

        expect(result).not.toBeNull();
        const cellA = result.chartData.datasets.find(d => d.label === 'Cell AAAA');
        expect(cellA).toBeTruthy();
        // Bucket 0 keeps A's peak (300); bucket 1000 carries A's LAST value (200).
        expect(cellA.data[0]).toBe(300);
        expect(cellA.data[cellA.data.length - 1]).toBe(200);
    });
});
