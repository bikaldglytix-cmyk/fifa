import { createContext, useContext, useEffect, useState, useCallback } from 'react';

const AppContext = createContext(null);
const STORAGE_KEY = 'fifa2026-mvp-state';

const DEFAULT_STATE = {
  user: { username: 'Manager', country: null },
  fantasy: {
    country: null, // selected country code
    formation: '4-3-3',
    lineup: {}, // { [slotIndex]: playerId }
    captain: null,
  },
  predictions: {}, // { [matchKey]: { a, b } }
  leaderboard: [], // [{ name, points, accuracy }]
  history: [], // recent simulations
};

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_STATE;
    return { ...DEFAULT_STATE, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_STATE;
  }
}

export function AppProvider({ children }) {
  const [state, setState] = useState(load);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* ignore quota errors */
    }
  }, [state]);

  const setFantasy = useCallback((patch) => {
    setState((s) => ({ ...s, fantasy: { ...s.fantasy, ...patch } }));
  }, []);

  const selectCountry = useCallback((code) => {
    setState((s) => ({
      ...s,
      user: { ...s.user, country: code },
      fantasy: { country: code, formation: '4-3-3', lineup: {}, captain: null },
    }));
  }, []);

  const setPrediction = useCallback((matchKey, pred) => {
    setState((s) => ({ ...s, predictions: { ...s.predictions, [matchKey]: pred } }));
  }, []);

  const addHistory = useCallback((entry) => {
    setState((s) => ({ ...s, history: [entry, ...s.history].slice(0, 25) }));
  }, []);

  const seedLeaderboard = useCallback((rows) => {
    setState((s) => ({ ...s, leaderboard: rows }));
  }, []);

  const value = {
    state,
    setState,
    setFantasy,
    selectCountry,
    setPrediction,
    addHistory,
    seedLeaderboard,
  };

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
