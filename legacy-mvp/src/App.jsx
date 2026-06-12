import { Routes, Route, NavLink } from 'react-router-dom';
import { useApp } from './context/AppContext.jsx';
import { COUNTRY_BY_CODE } from './data/countries.js';
import Home from './pages/Home.jsx';
import Simulator from './pages/Simulator.jsx';
import MyTeam from './pages/MyTeam.jsx';
import Tournament from './pages/Tournament.jsx';
import Leaderboard from './pages/Leaderboard.jsx';

function TopBar() {
  const { state } = useApp();
  const country = state.user.country ? COUNTRY_BY_CODE[state.user.country] : null;
  return (
    <div className="topbar">
      <div className="brand">
        FIFA <span className="accent">2026</span> Simulator
      </div>
      <nav className="nav">
        <NavLink to="/" end>Home</NavLink>
        <NavLink to="/simulator">Simulator</NavLink>
        <NavLink to="/my-team">My Team</NavLink>
        <NavLink to="/tournament">Tournament</NavLink>
        <NavLink to="/leaderboard">Leaderboard</NavLink>
      </nav>
      <div className="user-chip">
        {country && <span className="flag">{country.flag}</span>}
        <span>{state.user.username}</span>
      </div>
    </div>
  );
}

export default function App() {
  return (
    <div className="app-shell">
      <TopBar />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/simulator" element={<Simulator />} />
        <Route path="/my-team" element={<MyTeam />} />
        <Route path="/tournament" element={<Tournament />} />
        <Route path="/leaderboard" element={<Leaderboard />} />
      </Routes>
    </div>
  );
}
