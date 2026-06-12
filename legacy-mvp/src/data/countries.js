// National teams for the FIFA 2026 World Cup simulation.
// elo ratings are approximate strength indicators that drive the simulation engine.
// 32-team format (8 groups of 4) is used for a clean, classic bracket.

export const COUNTRIES = [
  { code: 'ARG', name: 'Argentina', flag: '🇦🇷', confed: 'CONMEBOL', fifaRank: 1, elo: 2105 },
  { code: 'FRA', name: 'France', flag: '🇫🇷', confed: 'UEFA', fifaRank: 2, elo: 2055 },
  { code: 'ESP', name: 'Spain', flag: '🇪🇸', confed: 'UEFA', fifaRank: 3, elo: 2045 },
  { code: 'ENG', name: 'England', flag: '🏴', confed: 'UEFA', fifaRank: 4, elo: 2010 },
  { code: 'BRA', name: 'Brazil', flag: '🇧🇷', confed: 'CONMEBOL', fifaRank: 5, elo: 2000 },
  { code: 'POR', name: 'Portugal', flag: '🇵🇹', confed: 'UEFA', fifaRank: 6, elo: 1990 },
  { code: 'NED', name: 'Netherlands', flag: '🇳🇱', confed: 'UEFA', fifaRank: 7, elo: 1975 },
  { code: 'BEL', name: 'Belgium', flag: '🇧🇪', confed: 'UEFA', fifaRank: 8, elo: 1950 },
  { code: 'GER', name: 'Germany', flag: '🇩🇪', confed: 'UEFA', fifaRank: 9, elo: 1945 },
  { code: 'CRO', name: 'Croatia', flag: '🇭🇷', confed: 'UEFA', fifaRank: 10, elo: 1920 },
  { code: 'ITA', name: 'Italy', flag: '🇮🇹', confed: 'UEFA', fifaRank: 11, elo: 1915 },
  { code: 'URU', name: 'Uruguay', flag: '🇺🇾', confed: 'CONMEBOL', fifaRank: 12, elo: 1900 },
  { code: 'COL', name: 'Colombia', flag: '🇨🇴', confed: 'CONMEBOL', fifaRank: 13, elo: 1885 },
  { code: 'MAR', name: 'Morocco', flag: '🇲🇦', confed: 'CAF', fifaRank: 14, elo: 1870 },
  { code: 'USA', name: 'United States', flag: '🇺🇸', confed: 'CONCACAF', fifaRank: 15, elo: 1840 },
  { code: 'MEX', name: 'Mexico', flag: '🇲🇽', confed: 'CONCACAF', fifaRank: 16, elo: 1820 },
  { code: 'SEN', name: 'Senegal', flag: '🇸🇳', confed: 'CAF', fifaRank: 17, elo: 1815 },
  { code: 'JPN', name: 'Japan', flag: '🇯🇵', confed: 'AFC', fifaRank: 18, elo: 1810 },
  { code: 'SUI', name: 'Switzerland', flag: '🇨🇭', confed: 'UEFA', fifaRank: 19, elo: 1800 },
  { code: 'DEN', name: 'Denmark', flag: '🇩🇰', confed: 'UEFA', fifaRank: 20, elo: 1795 },
  { code: 'KOR', name: 'South Korea', flag: '🇰🇷', confed: 'AFC', fifaRank: 21, elo: 1775 },
  { code: 'AUS', name: 'Australia', flag: '🇦🇺', confed: 'AFC', fifaRank: 22, elo: 1760 },
  { code: 'POL', name: 'Poland', flag: '🇵🇱', confed: 'UEFA', fifaRank: 23, elo: 1750 },
  { code: 'ECU', name: 'Ecuador', flag: '🇪🇨', confed: 'CONMEBOL', fifaRank: 24, elo: 1745 },
  { code: 'AUT', name: 'Austria', flag: '🇦🇹', confed: 'UEFA', fifaRank: 25, elo: 1740 },
  { code: 'CAN', name: 'Canada', flag: '🇨🇦', confed: 'CONCACAF', fifaRank: 26, elo: 1725 },
  { code: 'NGA', name: 'Nigeria', flag: '🇳🇬', confed: 'CAF', fifaRank: 27, elo: 1720 },
  { code: 'SRB', name: 'Serbia', flag: '🇷🇸', confed: 'UEFA', fifaRank: 28, elo: 1715 },
  { code: 'EGY', name: 'Egypt', flag: '🇪🇬', confed: 'CAF', fifaRank: 29, elo: 1700 },
  { code: 'GHA', name: 'Ghana', flag: '🇬🇭', confed: 'CAF', fifaRank: 30, elo: 1685 },
  { code: 'KSA', name: 'Saudi Arabia', flag: '🇸🇦', confed: 'AFC', fifaRank: 31, elo: 1660 },
  { code: 'QAT', name: 'Qatar', flag: '🇶🇦', confed: 'AFC', fifaRank: 32, elo: 1640 },
];

export const COUNTRY_BY_CODE = Object.fromEntries(COUNTRIES.map((c) => [c.code, c]));

// Eight groups of four for the group stage draw.
export const GROUPS = {
  A: ['ARG', 'POL', 'MEX', 'KSA'],
  B: ['FRA', 'DEN', 'AUS', 'QAT'],
  C: ['ESP', 'CRO', 'JPN', 'CAN'],
  D: ['ENG', 'URU', 'USA', 'GHA'],
  E: ['BRA', 'SUI', 'SEN', 'KOR'],
  F: ['POR', 'ITA', 'MAR', 'EGY'],
  G: ['NED', 'COL', 'AUT', 'NGA'],
  H: ['GER', 'BEL', 'ECU', 'SRB'],
};
