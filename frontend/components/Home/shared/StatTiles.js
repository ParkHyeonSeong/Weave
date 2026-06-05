// tiles: [{ icon: <Lucide/>, label, value, delta?: {text, tone:'up'|'warn'}, tone?: 'primary'|'inprog'|'error'|'success'|'doc'|'track' }]
const TONE_BG = {
  primary: 'rgba(94,106,210,.08)', inprog: '#DBEAFE', error: '#FEF2F2',
  success: '#F0FDF4', doc: '#FFF7ED', warn: '#FFFBEB', track: '#CCFBF1',
};
const TONE_FG = {
  primary: '#5E6AD2', inprog: '#1E40AF', error: '#DC2626',
  success: '#16A34A', doc: '#C2410C', warn: '#D97706', track: '#0D9488',
};

export default function StatTiles({ tiles = [], loading = false }) {
  if (loading) {
    return (
      <div className="StatTiles">
        {[0, 1, 2, 3].map(i => <div key={i} className="StatTile StatTile--skeleton" />)}
      </div>
    );
  }
  return (
    <div className="StatTiles">
      {tiles.map((t, i) => (
        <div className="StatTile" key={i}>
          <div
            className="StatTile__Icon"
            style={{
              background: TONE_BG[t.tone] || TONE_BG.primary,
              color: TONE_FG[t.tone] || TONE_FG.primary,
            }}
          >
            {t.icon}
          </div>
          <div>
            <div className="StatTile__Label">{t.label}</div>
            <div className="StatTile__Num">
              {t.value}
              {t.delta && (
                <span className={`StatTile__Delta StatTile__Delta--${t.delta.tone}`}>
                  {t.delta.text}
                </span>
              )}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
