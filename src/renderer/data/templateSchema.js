// Helpers for job-assigned certificate templates.
//
// A "template" captures the certificate editor's state triple
// { certLayout, testSchema, formData } (same shape as the built-in entries in
// certificateTemplates.js) and is stored in SharePoint keyed by job number so a
// Project Manager can prepare a certificate ahead of time. When a field tech opens
// that job, the certificate auto-fills from the assigned template.
//
// The hard rule: auto-fill must NEVER overwrite values a technician has already
// entered. `deepFillBlanks` implements that — it only writes into blank fields.

// Per-certificate artifacts that belong to the live cert, never to a template.
// They are always kept from the target and never seeded from a template.
const PRESERVE_KEYS = new Set(['photos', 'graphPageBreaks', 'sectionOrder']);

function isBlank(v) {
    return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
}

function cloneDeep(v) {
    if (Array.isArray(v)) return v.map(cloneDeep);
    if (v && typeof v === 'object') {
        const out = {};
        for (const k of Object.keys(v)) out[k] = cloneDeep(v[k]);
        return out;
    }
    return v;
}

/**
 * Recursively fill blank fields of `target` from `source`, returning a NEW value.
 * Neither argument is mutated.
 *
 * - primitives: `source` is used only when `target` is blank (undefined / null / '')
 * - arrays: merged index-wise — missing target slots are cloned from `source`,
 *   present slots are recursed into. The target array is never shortened.
 * - objects: recursed key-by-key over the union of keys.
 * - PRESERVE_KEYS on objects are left exactly as they are on `target`.
 *
 * Note the directionality: `deepFillBlanks(current, template)` keeps everything the
 * tech typed and only fills gaps from the template, while
 * `deepFillBlanks(template, current)` makes the template authoritative and only
 * borrows from `current` where the template itself is blank.
 */
function deepFillBlanks(target, source) {
    if (source === undefined || source === null) return target;
    if (isBlank(target)) return cloneDeep(source);

    if (Array.isArray(source) && Array.isArray(target)) {
        const out = target.slice();
        for (let i = 0; i < source.length; i++) {
            if (i >= out.length || isBlank(out[i])) out[i] = cloneDeep(source[i]);
            else out[i] = deepFillBlanks(out[i], source[i]);
        }
        return out;
    }

    const bothPlainObjects =
        source && typeof source === 'object' && !Array.isArray(source) &&
        target && typeof target === 'object' && !Array.isArray(target);
    if (bothPlainObjects) {
        const out = { ...target };
        for (const key of Object.keys(source)) {
            if (PRESERVE_KEYS.has(key)) continue;
            out[key] = deepFillBlanks(out[key], source[key]);
        }
        return out;
    }

    // Non-blank primitive target, or a type mismatch: keep the target value.
    return target;
}

export { deepFillBlanks, isBlank, PRESERVE_KEYS };
