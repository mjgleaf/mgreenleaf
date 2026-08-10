import { describe, it, expect } from 'vitest';
import { deepFillBlanks } from './templateSchema';

describe('deepFillBlanks', () => {
    it('fills blank fields but never overwrites manual edits', () => {
        const manual = { soldTo: 'Acme Corp', customerPO: '', procedureSummary: '' };
        const template = { soldTo: 'TEMPLATE CO', customerPO: 'PO-123', procedureSummary: 'Proof load test' };
        const result = deepFillBlanks(manual, template);
        expect(result.soldTo).toBe('Acme Corp');        // manual edit preserved
        expect(result.customerPO).toBe('PO-123');        // blank filled
        expect(result.procedureSummary).toBe('Proof load test');
    });

    it('treats whitespace-only strings as blank but keeps 0 and false', () => {
        const target = { a: '   ', b: 0, c: false, d: 'x' };
        const source = { a: 'filled', b: 99, c: true, d: 'y' };
        const result = deepFillBlanks(target, source);
        expect(result.a).toBe('filled');
        expect(result.b).toBe(0);      // 0 is a real value, not blank
        expect(result.c).toBe(false);  // false is a real value, not blank
        expect(result.d).toBe('x');
    });

    it('recurses into nested objects (e.g. an instrument row)', () => {
        const target = { instruments: [{ instrument: 'Load Cell', serialNo: '', accuracy: '' }] };
        const source = { instruments: [{ instrument: 'IGNORED', serialNo: 'SN-1', accuracy: '0.2% FS' }] };
        const result = deepFillBlanks(target, source);
        expect(result.instruments[0].instrument).toBe('Load Cell'); // kept
        expect(result.instruments[0].serialNo).toBe('SN-1');        // filled
        expect(result.instruments[0].accuracy).toBe('0.2% FS');     // filled
    });

    it('merges arrays index-wise and extends without shrinking', () => {
        const target = { tests: [{ description: 'kept' }] };               // 1 row
        const source = { tests: [{ description: 'ignored' }, { description: 'second' }, { description: 'third' }] };
        const result = deepFillBlanks(target, source);
        expect(result.tests).toHaveLength(3);            // extended to template's length
        expect(result.tests[0].description).toBe('kept'); // existing row preserved
        expect(result.tests[1].description).toBe('second');
        expect(result.tests[2].description).toBe('third');
    });

    it('never shortens the target array even if the template has fewer rows', () => {
        const target = { tests: [{ d: 'a' }, { d: 'b' }, { d: 'c' }] };
        const source = { tests: [{ d: 'x' }] };
        const result = deepFillBlanks(target, source);
        expect(result.tests).toHaveLength(3);
        expect(result.tests.map(t => t.d)).toEqual(['a', 'b', 'c']);
    });

    it('preserves per-cert artifacts (photos/graphPageBreaks/sectionOrder)', () => {
        const target = { photos: ['data:img'], graphPageBreaks: { 1: true }, sectionOrder: ['a'] };
        const source = { photos: ['TEMPLATE'], graphPageBreaks: { 9: true }, sectionOrder: ['z'] };
        const result = deepFillBlanks(target, source);
        expect(result.photos).toEqual(['data:img']);
        expect(result.graphPageBreaks).toEqual({ 1: true });
        expect(result.sectionOrder).toEqual(['a']);
    });

    it('does not seed artifacts from the template even when target lacks them', () => {
        const result = deepFillBlanks({ soldTo: '' }, { soldTo: 'Co', photos: ['T'] });
        expect(result.soldTo).toBe('Co');
        expect(result.photos).toBeUndefined();
    });

    it('directionality: template-authoritative fresh-job merge keeps template values, borrows blanks', () => {
        const template = { numTests: 11, procedureSummary: 'Vessel test', customerPO: '' };
        const fromJob = { numTests: 1, procedureSummary: '', customerPO: 'PO-fromSP' };
        const result = deepFillBlanks(template, fromJob); // template is the target
        expect(result.numTests).toBe(11);                 // template wins
        expect(result.procedureSummary).toBe('Vessel test');
        expect(result.customerPO).toBe('PO-fromSP');       // template blank -> filled from job
    });

    it('does not mutate either input', () => {
        const target = { a: '', nested: { b: '' } };
        const source = { a: 'x', nested: { b: 'y' } };
        deepFillBlanks(target, source);
        expect(target).toEqual({ a: '', nested: { b: '' } });
        expect(source).toEqual({ a: 'x', nested: { b: 'y' } });
    });
});
