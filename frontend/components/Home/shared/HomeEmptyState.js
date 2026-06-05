export default function HomeEmptyState({ icon, title, desc, ctaLabel, onCta }) {
  return (
    <div className="HomeEmpty">
      <div className="HomeEmpty__Icon">{icon}</div>
      <div className="HomeEmpty__Title">{title}</div>
      {desc && <div className="HomeEmpty__Desc">{desc}</div>}
      {ctaLabel && (
        <button className="HomeEmpty__Cta" onClick={onCta}>
          {ctaLabel}
        </button>
      )}
    </div>
  );
}
