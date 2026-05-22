import { Workflow, Calendar, GitBranch, Settings, Share2, Star, Plus } from 'lucide-react';

const VIEW_MODES = [
  { key: 'flow', label: 'Flow', icon: Workflow },
  { key: 'timeline', label: 'Timeline', icon: Calendar },
  { key: 'tree', label: 'Tree', icon: GitBranch },
];

export default function TrackHeader({
  track, members, viewMode, onViewModeChange,
  distribution, totalItems, totalLinks,
  participatingBranches, onManageBranches,
}) {
  return (
    <header className="TrackHeader">
      <div className="TrackHeader__Top">
        <div className="TrackHeader__TitleBlock">
          <div className="TrackHeader__Eyebrow">
            <span className="TrackHeader__EyebrowDot" style={{ background: track.color }} />
            <span className="TrackHeader__EyebrowText">TRACK · {String(track.track_id).padStart(3, '0')}</span>
          </div>
          <h1 className="TrackHeader__Title">{track.track_name}</h1>
          <p className="TrackHeader__Subtitle">{track.description}</p>

          {participatingBranches && participatingBranches.length > 0 && (
            <div className="TrackHeader__Participating">
              <span className="TrackHeader__ParticipatingLabel">Branches</span>
              <div className="TrackHeader__ParticipatingChips">
                {participatingBranches.map((b) => (
                  <span
                    key={b.branch_id}
                    className="TrackHeader__ParticipatingChip"
                    style={{ color: b.color, background: `${b.color}14`, borderColor: `${b.color}33` }}
                    title={b.name}
                  >
                    <span className="TrackHeader__ParticipatingDot" style={{ background: b.color }} />
                    {b.name}
                  </span>
                ))}
                <button
                  className="TrackHeader__ParticipatingAdd"
                  onClick={onManageBranches}
                  title="Manage participating branches"
                >
                  <Plus size={11} />
                  <span>add</span>
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="TrackHeader__Actions">
          <div className="TrackHeader__MemberStack">
            {members.slice(0, 4).map((m, i) => (
              <div
                key={m.user_id}
                className="TrackHeader__Member"
                style={{ background: m.color, zIndex: members.length - i }}
                title={`${m.username} · ${m.role}`}
              >
                {m.initial}
              </div>
            ))}
            {members.length > 4 && (
              <div className="TrackHeader__MemberMore">+{members.length - 4}</div>
            )}
          </div>
          <button className="TrackHeader__IconBtn" title="Star">
            <Star size={16} />
          </button>
          <button className="TrackHeader__IconBtn" title="Share">
            <Share2 size={16} />
          </button>
          <button className="TrackHeader__IconBtn" title="Settings">
            <Settings size={16} />
          </button>
        </div>
      </div>

      <div className="TrackHeader__Meta">
        <div className="TrackHeader__WeaveBlock">
          <div className="TrackHeader__WeaveLabel">
            <span className="TrackHeader__WeaveCaption">Composition</span>
            <span className="TrackHeader__WeaveCount">
              {totalItems} <em>items</em> · {totalLinks} <em>links</em>
            </span>
          </div>
          <div className="TrackHeader__WeaveBar" role="img" aria-label="branch composition">
            {distribution.map((b) => (
              <div
                key={b.branch_id}
                className="TrackHeader__WeaveSeg"
                style={{ flexBasis: `${b.ratio * 100}%`, background: b.color }}
                title={`${b.name}: ${b.count} items (${Math.round(b.ratio * 100)}%)`}
              >
                <span className="TrackHeader__WeaveSegLabel">{b.key}</span>
                <span className="TrackHeader__WeaveSegCount">{b.count}</span>
              </div>
            ))}
          </div>
          <div className="TrackHeader__WeaveLegend">
            {distribution.map((b) => (
              <span key={b.branch_id} className="TrackHeader__WeaveLegendItem">
                <span className="TrackHeader__WeaveLegendDot" style={{ background: b.color }} />
                <span className="TrackHeader__WeaveLegendName">{b.name}</span>
              </span>
            ))}
          </div>
        </div>

        <div className="TrackHeader__ViewToggle" role="tablist">
          {VIEW_MODES.map((v) => {
            const Icon = v.icon;
            const active = viewMode === v.key;
            return (
              <button
                key={v.key}
                role="tab"
                aria-selected={active}
                className={`TrackHeader__ViewBtn ${active ? 'TrackHeader__ViewBtn--active' : ''}`}
                onClick={() => onViewModeChange(v.key)}
              >
                <Icon size={14} />
                <span>{v.label}</span>
              </button>
            );
          })}
        </div>
      </div>
    </header>
  );
}
