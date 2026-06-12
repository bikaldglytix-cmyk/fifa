"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.computePlayerRating = computePlayerRating;
exports.fantasyPrice = fantasyPrice;
const constants_1 = require("./constants");
const utils_1 = require("./utils");
const POSITION_BASE = { GK: 62, DF: 63, MF: 64, FW: 64 };
/** goals-per-cap considered "elite" for the position group */
const POSITION_GPG_NORM = { GK: 0.005, DF: 0.12, MF: 0.35, FW: 0.65 };
const POSITION_GPG_POINTS = { GK: 0, DF: 6, MF: 10, FW: 16 };
function computePlayerRating(p) {
    const base = POSITION_BASE[p.position];
    const experience = (14 * Math.log10(1 + p.caps)) / Math.log10(1 + 150);
    const gpg = p.internationalGoals / Math.max(8, p.caps);
    const scoring = POSITION_GPG_POINTS[p.position] * Math.min(1.15, gpg / POSITION_GPG_NORM[p.position]);
    const league = 12 * (p.clubCountry ? (constants_1.LEAGUE_STRENGTH[p.clubCountry] ?? constants_1.LEAGUE_STRENGTH_DEFAULT) : constants_1.LEAGUE_STRENGTH_DEFAULT);
    const peak = p.position === 'GK' ? 30 : 27;
    const ageCurve = Math.max(-10, -0.35 * (p.age - peak) ** 2 + 2);
    const captain = p.captain ? 1.5 : 0;
    return (0, utils_1.clamp)(Math.round((base + experience + scoring + league + ageCurve + captain) * 10) / 10, 45, 94);
}
/** Simple per-position fantasy "price" derived from rating, for UI display. */
function fantasyPrice(rating) {
    return Math.round((4 + ((rating - 45) / 49) * 9.5) * 2) / 2; // 4.0 .. 13.5
}
//# sourceMappingURL=rating.js.map