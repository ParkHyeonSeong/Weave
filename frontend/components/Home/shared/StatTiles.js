import { ChevronDown } from 'lucide-react';

// tiles: [{ icon: <Lucide/>, label, value, delta?: {text, tone:'up'|'warn'},
//           tone?: 'primary'|'inprog'|'error'|'success'|'doc'|'warn'|'track'|'scrum', bucket?: string }]
//
// 톤은 토큰 참조로만 쓴다 — 같은 타일이 라이트/다크를 따라가야 하고, 값을 여기 박아 두면
// 다크에서 청록·연분홍 파스텔이 그대로 떠 배경과 분리가 깨진다.
//
// ⚠️ `track`과 `scrum`을 **가르는 이유**: 이 컴포넌트는 TrackHome과 ScrumHome이 같이 쓰는데,
//    둘 다 예전에는 tone:'track' 하나(청록 리터럴 한 쌍)를 썼다. 그러면 "활성 트랙"과
//    "스크럼 보드"가 같은 색이 되어 화면 의미를 못 나눈다. 각 앱의 아이덴티티 축을 따른다 —
//    Track은 primary(브랜드), Scrum은 accent-scrum(그린).
const TONE_BG = {
  primary: 'var(--color-primary-subtle)',
  inprog:  'var(--color-status-in-progress-bg)',
  error:   'var(--color-error-bg)',
  success: 'var(--color-success-bg)',
  doc:     'var(--color-ref-doc-bg)',
  warn:    'var(--color-warning-bg)',
  track:   'var(--color-primary-subtle)',        // TrackHome
  scrum:   'var(--color-accent-scrum-subtle)',   // ScrumHome
};
const TONE_FG = {
  primary: 'var(--color-primary)',
  inprog:  'var(--color-status-in-progress)',
  error:   'var(--color-error)',
  success: 'var(--color-success)',
  doc:     'var(--color-ref-doc)',
  warn:    'var(--color-warning)',
  track:   'var(--color-primary)',               // TrackHome
  scrum:   'var(--color-accent-scrum)',          // ScrumHome
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
