import { useRef } from 'react';
import { useRouter } from 'next/router';
import { X, CalendarDays, Flag, ExternalLink, Lock, Layers, MessageSquare, GitBranch } from 'lucide-react';
import { sanitizeHtml } from '@/library/sanitize';
import { useRefHydration } from '@/library/refHydration';
import { useMathHydration } from '@/library/mathRender';
import Avatar from '@/components/common/Avatar';
import { PRIORITIES } from '../mockData';
import { entityBorderStyle, entityInkStyle, entitySolidStyle, entityTintStyle } from '@/library/entityTint';

function formatDateLong(date) {
  if (!date) return '—';
  const d = new Date(date);
  const m = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
  return `${m} ${d.getDate()}`;
}

export default function TrackItemDetail({ item, branch, workflowStatuses, onClose, onRemove }) {
  const router = useRouter();
  // openInBranch는 restricted/empty 분기 이후 렌더되므로 item/branch_id/task_id는 항상 존재
  const openInBranch = () => router.push(`/branch/${item.branch_id}?task=${item.task_id}`);

  // readonly 설명의 ref 칩 하이드레이션 (최신 제목·상태 + 탭 내 변경 이벤트)
  const descRef = useRef(null);
  useRefHydration(descRef, [item?.description]);
  useMathHydration(descRef, [item?.description]);

  if (!item) {
    return (
      <aside className="TrackDetail TrackDetail--empty">
        <div className="TrackDetail__EmptyIcon">
          <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
            <circle cx="24" cy="24" r="20" stroke="#E5E5E5" strokeWidth="1.2" strokeDasharray="3 4" />
            <circle cx="24" cy="24" r="3" fill="#D1D5DB" />
          </svg>
        </div>
        <div className="TrackDetail__EmptyTitle">No item selected</div>
        <div className="TrackDetail__EmptyHint">캔버스의 카드를 클릭하면 상세가 여기 표시돼요</div>
      </aside>
    );
  }

  if (item.restricted) {
    return (
      <aside className="TrackDetail TrackDetail--restricted">
        <button className="TrackDetail__Close" onClick={onClose} aria-label="Close"><X size={14} /></button>
        <div className="TrackDetail__RestrictedHero">
          <div className="TrackDetail__RestrictedShield">
            <Lock size={20} />
          </div>
          <div className="TrackDetail__RestrictedTitle">Restricted item</div>
          <div className="TrackDetail__RestrictedBody">
            이 Task는 너가 접근할 수 없는 브랜치에 있어요.
            Track 위치만 보이고 상세 정보는 가려져 있어요.
          </div>
          {item.restricted_hint && (
            <div className="TrackDetail__RestrictedHint">{item.restricted_hint}</div>
          )}
        </div>
      </aside>
    );
  }

  const ws = workflowStatuses[item.status] || {};
  const prio = PRIORITIES[item.priority] || {};
  // ⚠️ 이 패널의 배지 부모는 --track-card다(TrackTree 행과 같은 표면) — track-card 프로파일을 쓴다.
  //    default로 계산하면 다크에서 31색 중 17색이 BADGE_MIN 미달이다(실측 StatusPill 1.2425).
  const branchTint = entityTintStyle(branch.color, { from: 8, alpha: '14', surface: 'track-card' });
  const wsTint = entityTintStyle(ws.color, { from: 8, alpha: '14', surface: 'track-card' });
  const wsSolid = entitySolidStyle(ws.color);
  // 텍스트는 ink 축, 테두리는 우선순위 색 축 — 같은 값을 쓰면 high가 AA 미달이다.
  const prioInk = entityInkStyle(prio.ink);
  const prioBd = entityBorderStyle(prio.color, { from: 25, alpha: '40' });

  return (
    <aside className="TrackDetail">
      <div className="TrackDetail__Head">
        <div className="TrackDetail__Breadcrumb">
          <span
            className={`TrackDetail__BranchPill${branchTint?.['--et-on'] ? ' EntityTint' : ''}`}
            style={branchTint}
          >
            <GitBranch size={11} />
            {branch.name}
          </span>
          <span className="TrackDetail__BcSep">/</span>
          {item.parent && (
            <>
              <span
                className="TrackDetail__ParentCrumb"
                role="link"
                tabIndex={0}
                title={item.parent.title}
                onClick={() => router.push(`/branch/${item.branch_id}?task=${item.parent.task_id}`)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') router.push(`/branch/${item.branch_id}?task=${item.parent.task_id}`);
                }}
              >
                {item.parent.display_id}
              </span>
              <span className="TrackDetail__BcSep">/</span>
            </>
          )}
          <span className="TrackDetail__DisplayId">{item.display_id}</span>
        </div>
        <button className="TrackDetail__Close" onClick={onClose} aria-label="Close"><X size={14} /></button>
      </div>

      <h2 className="TrackDetail__Title">{item.title}</h2>

      <div className="TrackDetail__StatusRow">
        <span
          className={`TrackDetail__StatusPill${wsTint?.['--et-on'] ? ' EntityTint' : ''}`}
          style={wsTint}
        >
          <span
            className={`TrackDetail__StatusDot${wsSolid?.['--et-on'] ? ' EntitySolid' : ''}`}
            style={wsSolid}
          />
          {ws.label}
        </span>
        <span
          className={`TrackDetail__PrioPill${prioInk?.['--et-on'] ? ' EntityInk EntityBorder' : ''}`}
          style={{ ...prioInk, ...prioBd }}
        >
          <Flag size={10} />
          {prio.label}
        </span>
      </div>

      <dl className="TrackDetail__Meta">
        <div className="TrackDetail__MetaRow">
          <dt>Assignee</dt>
          <dd>
            {item.assignees && item.assignees.length > 0 ? (
              <span className="TrackDetail__Assignee">
                <Avatar user={item.assignees[0]} size={20} />
                <span>{item.assignees[0].username}</span>
              </span>
            ) : <span className="TrackDetail__MetaEmpty">unassigned</span>}
          </dd>
        </div>
        <div className="TrackDetail__MetaRow">
          <dt>Due</dt>
          <dd>
            <CalendarDays size={12} className="TrackDetail__MetaIcon" />
            {formatDateLong(item.due_date)}
          </dd>
        </div>
        <div className="TrackDetail__MetaRow">
          <dt>Origin</dt>
          <dd>
            <span>{branch.name}</span>
            <button
              type="button"
              className="TrackDetail__OriginLink"
              onClick={openInBranch}
            >
              <ExternalLink size={11} />
              <span>open</span>
            </button>
          </dd>
        </div>
      </dl>

      <section className="TrackDetail__Section">
        <h3 className="TrackDetail__SectionTitle">
          <MessageSquare size={12} />
          Description
        </h3>
        {item.description ? (
          <div
            ref={descRef}
            className="TrackDetail__Description"
            // eslint-disable-next-line react/no-danger -- sanitizeHtml로 정제, Branch TaskDetailPanel과 동일 패턴
            dangerouslySetInnerHTML={{ __html: sanitizeHtml(item.description) }}
          />
        ) : (
          <p className="TrackDetail__Description">
            <span className="TrackDetail__MetaEmpty">No description</span>
          </p>
        )}
      </section>

      <section className="TrackDetail__Section">
        <h3 className="TrackDetail__SectionTitle">
          <Layers size={12} />
          Also in tracks
        </h3>
        {item.other_tracks && item.other_tracks.length > 0 ? (
          <div className="TrackDetail__TrackChips">
            {item.other_tracks.map((t) => (
              <a key={t.track_id} className="TrackDetail__TrackChip" href={`/tracks/${t.track_id}`}>
                <span className="TrackDetail__TrackChipMark" />
                {t.track_name}
              </a>
            ))}
          </div>
        ) : (
          <div className="TrackDetail__MetaEmpty">only this track</div>
        )}
      </section>

      <footer className="TrackDetail__Foot">
        <button
          className="TrackDetail__FootBtn TrackDetail__FootBtn--ghost"
          onClick={() => onRemove?.(item.item_id)}
        >
          Remove from track
        </button>
        <button
          className="TrackDetail__FootBtn TrackDetail__FootBtn--primary"
          onClick={openInBranch}
        >
          Open in branch ↗
        </button>
      </footer>
    </aside>
  );
}
