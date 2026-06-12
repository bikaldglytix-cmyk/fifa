import { COUNTRIES, COUNTRY_BY_CODE } from '../data/countries.js';

// A labelled <select> of all national teams.
export default function TeamPicker({ value, onChange, label, exclude }) {
  return (
    <label className="stack" style={{ gap: '0.35rem', flex: 1 }}>
      {label && <span className="section-title" style={{ margin: 0 }}>{label}</span>}
      <select value={value || ''} onChange={(e) => onChange(e.target.value)}>
        <option value="" disabled>Select team…</option>
        {COUNTRIES.filter((c) => c.code !== exclude).map((c) => (
          <option key={c.code} value={c.code}>
            {c.flag} {c.name} (#{c.fifaRank})
          </option>
        ))}
      </select>
    </label>
  );
}

export function TeamName({ code, withFlag = true }) {
  const c = COUNTRY_BY_CODE[code];
  if (!c) return null;
  return (
    <span>
      {withFlag && <span className="flag">{c.flag}</span>} {c.name}
    </span>
  );
}
