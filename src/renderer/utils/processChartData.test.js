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
});
