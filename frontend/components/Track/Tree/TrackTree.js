import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, AlertCircle, Lock, CalendarDays } from 'lucide-react';

function formatDue(date) {
  if (!date) return null;
  const d = new Date(date);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

/**
 * Tree view — 같은 mock 데이터를 outline 형태로.
 * 그룹핑: Branch → (옵션) Epic 가상 그룹 → Task.
 * 의존성은 우측에 "→ N items" 처럼 카운트로만 노출 (시각화는 Flow에 위임).
 */
export default function TrackTree({
  items, links, branchById, workflowStatuses,
  selectedItemId, onSelectItem,
}) {
  // outgoing dependency 카운트
  const outCount = useMemo(() => {
    const map = new Map();
    links.forEach((l) => {
      map.set(l.source_item_id, (map.get(l.source_item_id) || 0) + 1);
    });
    return map;
  }, [links]);

  // branch별 그룹
  const groups = useMemo(() => {
    const byBranch = new Map();
    items.forEach((it) => {
      const bid = it.branch_id;
      if (!byBranch.has(bid)) byBranch.set(bid, []);
      byBranch.get(bid).push(it);
    });
    return Array.from(byBranch.entries())
      .map(([bid, list]) => ({
        branch: branchById[bid] || (bid === null ? { name: 'Restricted', color: '#9CA3AF', key: '?' } : { name: '?', color: '#9CA3AF', key: '?' }),
        branchId: bid,
        items: list.sort((a, b) => {
          if (a.restricted || b.restricted) return a.restricted ? 1 : -1;
          const ad = a.due_date ? new Date(a.due_date) : new Date('2099-01-01');
          const bd = b.due_date ? new Date(b.due_date) : new Date('2099-01-01');
          return ad - bd;
        }),
      }))
      .sort((a, b) => {
        // null branch (restricted) 는 맨 아래로
        if (a.branchId === null) return 1;
        if (b.branchId === null) return -1;
        return a.branch.name.localeCompare(b.branch.name);
      });
  }, [items, branchById]);

  const [openGroups, setOpenGroups] = useState(() => new Set(groups.map((g) => g.branchId)));
  const toggleGroup = (id) => {
    setOpenGroups((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  return (
    <div className="TrackTree">
      <div className="TrackTree__Head">
        <div className="TrackTree__HeadCell TrackTree__HeadCell--main">Title</div>
        <div className="TrackTree__HeadCell">Status</div>
        <div className="TrackTree__HeadCell">Priority</div>
        <div className="TrackTree__HeadCell">Assignee</div>
        <div className="TrackTree__HeadCell">Due</div>
        <div className="TrackTree__HeadCell TrackTree__HeadCell--narrow">Links</div>
      </div>

      <div className="TrackTree__Body">
        {groups.map((g) => {
          const open = openGroups.has(g.branchId);
          return (
            <div key={`grp-${g.branchId}`} className="TrackTree__Group">
              <button
                className="TrackTree__GroupRow"
                style={{ '--branch-color': g.branch.color }}
                onClick={() => toggleGroup(g.branchId)}
              >
                <span className="TrackTree__GroupChevron">
                  {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                </span>
                <span className="TrackTree__GroupColorBar" />
                <span className="TrackTree__GroupName">{g.branch.name}</span>
                <span className="TrackTree__GroupKey">{g.branch.key}</span>
                <span className="TrackTree__GroupCount">{g.items.length}</span>
              </button>

              {open && g.items.map((it) => {
                if (it.restricted) {
                  return (
                    <div
                      key={it.item_id}
                      className={`TrackTree__Row TrackTree__Row--restricted ${selectedItemId === it.item_id ? 'TrackTree__Row--selected' : ''}`}
                      onClick={() => onSelectItem(it.item_id)}
                    >
                      <div className="TrackTree__Cell TrackTree__Cell--main">
                        <span className="TrackTree__Indent" />
                        <Lock size={12} className="TrackTree__RestrictedIcon" />
                        <span className="TrackTree__RestrictedTitle">Restricted item</span>
                        <span className="TrackTree__RestrictedHint">{it.restricted_hint}</span>
                      </div>
                      <div className="TrackTree__Cell" />
                      <div className="TrackTree__Cell" />
                      <div className="TrackTree__Cell" />
                      <div className="TrackTree__Cell" />
                      <div className="TrackTree__Cell TrackTree__Cell--narrow" />
                    </div>
                  );
                }
                const ws = workflowStatuses[it.status] || {};
                const out = outCount.get(it.item_id) || 0;
                return (
                  <div
                    key={it.item_id}
                    className={`TrackTree__Row ${selectedItemId === it.item_id ? 'TrackTree__Row--selected' : ''}`}
                    style={{ '--branch-color': g.branch.color }}
                    onClick={() => onSelectItem(it.item_id)}
                  >
                    <div className="TrackTree__Cell TrackTree__Cell--main">
                      <span className="TrackTree__Indent" />
                      <span className="TrackTree__BranchBar" />
                      <span className="TrackTree__TaskId">{it.display_id}</span>
                      <span className="TrackTree__TaskTitle">{it.title}</span>
                      {it.priority === 'urgent' && (
                        <span className="TrackTree__UrgentFlag" title="Urgent">
                          <AlertCircle size={11} />
                        </span>
                      )}
                    </div>
                    <div className="TrackTree__Cell">
                      <span className="TrackTree__StatusPill" style={{ background: `${ws.color}14`, color: ws.color }}>
                        <span className="TrackTree__StatusDot" style={{ background: ws.color }} />
                        {ws.label}
                      </span>
                    </div>
                    <div className="TrackTree__Cell">
                      <span className={`TrackTree__Priority TrackTree__Priority--${it.priority}`}>
                        {it.priority}
                      </span>
                    </div>
                    <div className="TrackTree__Cell">
                      {it.assignees && it.assignees[0] ? (
                        <span className="TrackTree__Assignee">
                          <span className="TrackTree__AssigneeAvatar" style={{ background: it.assignees[0].color }}>
                            {it.assignees[0].initial}
                          </span>
                          <span className="TrackTree__AssigneeName">{it.assignees[0].username}</span>
                        </span>
                      ) : <span className="TrackTree__Empty">—</span>}
                    </div>
                    <div className="TrackTree__Cell">
                      {it.due_date ? (
                        <span className="TrackTree__Due">
                          <CalendarDays size={11} />
                          {formatDue(it.due_date)}
                        </span>
                      ) : <span className="TrackTree__Empty">—</span>}
                    </div>
                    <div className="TrackTree__Cell TrackTree__Cell--narrow">
                      {out > 0 ? (
                        <span className="TrackTree__LinkCount" title={`leads to ${out} item(s)`}>
                          → {out}
                        </span>
                      ) : <span className="TrackTree__Empty">—</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}
