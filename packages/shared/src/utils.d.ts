/** Small shared helpers (no runtime deps). */
export declare const clamp: (v: number, lo: number, hi: number) => number;
export declare const round: (v: number, dp?: number) => number;
export declare const sum: (xs: number[]) => number;
export declare const mean: (xs: number[]) => number;
export declare const stddev: (xs: number[]) => number;
export declare const ageOn: (dateOfBirth: string, onDate: string) => number;
/** Wilson score interval (95%) for a binomial proportion — used for sim CIs. */
export declare const wilsonInterval: (successes: number, n: number) => {
    low: number;
    high: number;
};
export declare const formatPct: (p: number, dp?: number) => string;
/** Deterministic 32-bit FNV-1a hash for cache keys / seeds. */
export declare const fnv1a: (s: string) => number;
export declare const generateJoinCode: (rand?: () => number) => string;
//# sourceMappingURL=utils.d.ts.map