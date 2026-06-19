import { ChevronDown } from 'lucide-react';

// tiles: [{ icon: <Lucide/>, label, value, delta?: {text, tone:'up'|'warn'}, tone?: 'primary'|'inprog'|'error'|'success'|'doc'|'track', bucket?: string }]
const TONE_BG = {
  primary: 'rgba(94,106,210,.08)', inprog: '#DBEAFE', error: '#FEF2F2',
  success: '#F0FDF4', doc: '#FFF7ED', warn: '#FFFBEB', track: '#CCFBF1',
};
const TONE_FG = {
  primary: '#5E6AD2', inprog: '#1E40AF', error: '#DC2626',
  success: '#16A34A', doc: '#C2410C', warn: '#D97706', track: '#0D9488',
};

export default function StatTiles({ tiles = [], loading = false, onTileClick, activeBucket, renderPopover }) {
  if (loading) {
    return (
      <div className="StatTiles">
        {[0, 1, 2, 3].map(i => <div key={i} className="StatTile StatTile--skeleton" />)}
      </div>
    );
  }
  return (
    <div className="StatTiles">
      {tiles.map((t, i) => {
        const clickable = !!t.bucket && !!onTileClick;
        const active = activeBucket && t.bucket === activeBucket;
        const Tag = clickable ? 'button' : 'div';  // command surface는 진짜 <button>(네이티브 키보드)
        return (
          <div className="StatTile__Anchor" key={i}>
            <Tag
              className={`StatTile${clickable ? ' StatTile--clickable' : ''}${active ? ' is-active' : ''}`}
              type={clickable ? 'button' : undefined}
              aria-haspopup={clickable ? 'true' : undefined}
              aria-expanded={clickable ? !!active : undefined}
              onClick={clickable ? () => onTileClick(t.bucket, i) : undefined}
            >
              <div
                className="StatTile__Icon"
                style={{ background: TONE_BG[t.tone] || TONE_BG.primary, color: TONE_FG[t.tone] || TONE_FG.primary }}
              >
                {t.icon}
              </div>
              <div>
                <div className="StatTile__Label">{t.label}</div>
                <div className="StatTile__Num">
                  {t.value}
                  {t.delta && (
                    <span className={`StatTile__Delta StatTile__Delta--${t.delta.tone}`}>{t.delta.text}</span>
                  )}
                </div>
              </div>
              {clickable && <ChevronDown size={14} className="StatTile__Chev" aria-hidden />}
            </Tag>
            {active && renderPopover && renderPopover(t.bucket)}
          </div>
        );
      })}
    </div>
  );
}
