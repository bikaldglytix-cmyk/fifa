"use strict";
/** Small shared helpers (no runtime deps). */
Object.defineProperty(exports, "__esModule", { value: true });
exports.generateJoinCode = exports.fnv1a = exports.formatPct = exports.wilsonInterval = exports.ageOn = exports.stddev = exports.mean = exports.sum = exports.round = exports.clamp = void 0;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
exports.clamp = clamp;
const round = (v, dp = 2) => {
    const f = 10 ** dp;
    return Math.round(v * f) / f;
};
exports.round = round;
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
exports.sum = sum;
const mean = (xs) => (xs.length ? (0, exports.sum)(xs) / xs.length : 0);
exports.mean = mean;
const stddev = (xs) => {
    if (xs.length < 2)
        return 0;
    const m = (0, exports.mean)(xs);
    return Math.sqrt((0, exports.sum)(xs.map((x) => (x - m) ** 2)) / (xs.length - 1));
};
exports.stddev = stddev;
const ageOn = (dateOfBirth, onDate) => {
    const dob = new Date(dateOfBirth + 'T00:00:00Z');
    const on = new Date(onDate + 'T00:00:00Z');
    let age = on.getUTCFullYear() - dob.getUTCFullYear();
    const m = on.getUTCMonth() - dob.getUTCMonth();
    if (m < 0 || (m === 0 && on.getUTCDate() < dob.getUTCDate()))
        age--;
    return age;
};
exports.ageOn = ageOn;
/** Wilson score interval (95%) for a binomial proportion — used for sim CIs. */
const wilsonInterval = (successes, n) => {
    if (n === 0)
        return { low: 0, high: 1 };
    const z = 1.96;
    const p = successes / n;
    const denom = 1 + (z * z) / n;
    const center = p + (z * z) / (2 * n);
    const margin = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
    return { low: Math.max(0, (center - margin) / denom), high: Math.min(1, (center + margin) / denom) };
};
exports.wilsonInterval = wilsonInterval;
const formatPct = (p, dp = 1) => `${(p * 100).toFixed(dp)}%`;
exports.formatPct = formatPct;
/** Deterministic 32-bit FNV-1a hash for cache keys / seeds. */
const fnv1a = (s) => {
    let h = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
};
exports.fnv1a = fnv1a;
const generateJoinCode = (rand = Math.random) => {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 8; i++)
        code += alphabet[Math.floor(rand() * alphabet.length)];
    return code;
};
exports.generateJoinCode = generateJoinCode;
//# sourceMappingURL=utils.js.map