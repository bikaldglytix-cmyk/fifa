// Horizontal home/draw/away probability bar.
export default function ProbabilityBar({ home, draw, away }) {
  const segs = [
    { cls: 'home', val: home },
    { cls: 'draw', val: draw },
    { cls: 'away', val: away },
  ];
  return (
    <div className="prob-bar">
      {segs.map((s, i) => (
        <div
          key={i}
          className={`prob-seg ${s.cls}`}
          style={{ width: `${Math.max(s.val, 0)}%` }}
          title={`${s.val}%`}
        >
          {s.val >= 8 ? `${s.val}%` : ''}
        </div>
      ))}
    </div>
  );
}
