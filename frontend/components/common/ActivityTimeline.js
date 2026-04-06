import { useState, useEffect, useCallback, useRef } from 'react';
import { Clock, ArrowRight } from 'lucide-react';
import { axios } from '@/library/_axios';

/**
 * ActivityTimeline - Task/Canvas 페이지의 활동 이력 타임라인
 *
 * @param {string} apiUrl - activity API 경로 (예: /branches/1/tasks/2/activity)
 * @param {boolean} expanded - 전체 표시 여부 (false면 최근 5개만)
 */
export default function ActivityTimeline({ apiUrl, expanded = false }) {
  const [activities, setActivities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const offsetRef = useRef(0);
  const LIMIT = 20;

  const fetchActivities = useCallback(async (append = false) => {
    if (!apiUrl) return;
    const currentOffset = append ? offsetRef.current : 0;
    try {
      const res = await axios.get(apiUrl, {
        params: { limit: LIMIT, offset: currentOffset },
      });
      if (res.data.status) {
        const items = res.data.activities || [];
        if (append) {
          setActivities((prev) => [...prev, ...items]);
        } else {
          setActivities(items);
        }
        setHasMore(items.length >= LIMIT);
        offsetRef.current = currentOffset + items.length;
      }
    } catch {}
    setLoading(false);
  }, [apiUrl]);

  useEffect(() => {
    setLoading(true);
    offsetRef.current = 0;
    fetchActivities(false);
  }, [fetchActivities]);

  // 외부 이벤트로 갱신
  useEffect(() => {
    const handler = () => {
      offsetRef.current = 0;
      fetchActivities(false);
    };
    window.addEventListener('task:updated', handler);
    window.addEventListener('canvas_page:updated', handler);
    return () => {
      window.removeEventListener('task:updated', handler);
      window.removeEventListener('canvas_page:updated', handler);
    };
  }, [fetchActivities]);

  const displayActivities = expanded ? activities : activities.slice(0, 5);

  // 날짜별 그룹핑
  const grouped = groupByDate(displayActivities);

  if (loading && activities.length === 0) {
    return (
      <div className="ActivityTimeline">
        <div className="ActivityTimeline__Header">
          <span className="ActivityTimeline__Label">
            <Clock size={13} />
            Activity
          </span>
        </div>
        <div className="ActivityTimeline__Empty">Loading...</div>
      </div>
    );
  }

  return (
    <div className="ActivityTimeline">
      <div className="ActivityTimeline__Header">
        <span className="ActivityTimeline__Label">
          <Clock size={13} />
          Activity
          {activities.length > 0 && (
            <span className="ActivityTimeline__Count">{activities.length}</span>
          )}
        </span>
      </div>

      {displayActivities.length === 0 ? (
        <div className="ActivityTimeline__Empty">No activity yet.</div>
      ) : (
        <div className="ActivityTimeline__List">
          {grouped.map(({ label, items }) => (
            <div key={label} className="ActivityTimeline__Group">
              <div className="ActivityTimeline__DateLabel">{label}</div>
              {items.map((activity) => (
                <ActivityItem key={activity.log_id} activity={activity} />
              ))}
            </div>
          ))}
        </div>
      )}

      {expanded && hasMore && (
        <button
          className="ActivityTimeline__More"
          onClick={() => fetchActivities(true)}
        >
          Load more
        </button>
      )}
    </div>
  );
}


function ActivityItem({ activity }) {
  const { actor_name, summary, changes, created_at } = activity;

  return (
    <div className="ActivityTimeline__Item">
      <div className="ActivityTimeline__ItemHeader">
        <span className="ActivityTimeline__Author">{actor_name || 'Unknown'}</span>
        <span className="ActivityTimeline__Time">{timeAgo(created_at)}</span>
      </div>
      <div className="ActivityTimeline__Summary">{summary}</div>
      {Array.isArray(changes) && changes.length > 0 && (
        <div className="ActivityTimeline__Changes">
          {changes.map((ch, i) => (
            <ChangeDetail key={i} change={ch} />
          ))}
        </div>
      )}
    </div>
  );
}


function ChangeDetail({ change }) {
  const { field, old: oldVal, new: newVal, added, removed, changed } = change;

  // content 변경 (메타데이터만)
  if (changed) {
    return null; // summary에 이미 표시됨
  }

  // 집합형 (assignees, labels)
  if (added || removed) {
    const addedNames = (added || []).map((a) => a.username || a.label_name || '?');
    const removedNames = (removed || []).map((r) => r.username || r.label_name || '?');
    return (
      <div className="ActivityTimeline__ChangeRow">
        {addedNames.length > 0 && (
          <span className="ActivityTimeline__ChangeAdded">+{addedNames.join(', ')}</span>
        )}
        {removedNames.length > 0 && (
          <span className="ActivityTimeline__ChangeRemoved">-{removedNames.join(', ')}</span>
        )}
      </div>
    );
  }

  // description은 diff가 너무 김 -> 생략
  if (field === 'description') return null;

  // 스칼라 필드
  const displayOld = change.old_label || formatValue(oldVal);
  const displayNew = change.new_label || formatValue(newVal);

  return (
    <div className="ActivityTimeline__ChangeRow">
      <span className="ActivityTimeline__ChangeOld">{displayOld}</span>
      <ArrowRight size={10} className="ActivityTimeline__ChangeArrow" />
      <span className="ActivityTimeline__ChangeNew">{displayNew}</span>
    </div>
  );
}


function formatValue(val) {
  if (val === null || val === undefined) return '-';
  if (typeof val === 'string' && val.length > 50) return val.slice(0, 50) + '...';
  return String(val);
}


function timeAgo(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString('ko-KR', {
    month: 'short',
    day: 'numeric',
  });
}


function groupByDate(activities) {
  const groups = [];
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);

  let currentLabel = null;
  let currentItems = [];

  for (const act of activities) {
    const d = new Date(act.created_at);
    const day = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    let label;
    if (day.getTime() === today.getTime()) {
      label = 'Today';
    } else if (day.getTime() === yesterday.getTime()) {
      label = 'Yesterday';
    } else {
      label = d.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric' });
    }

    if (label !== currentLabel) {
      if (currentLabel !== null) {
        groups.push({ label: currentLabel, items: currentItems });
      }
      currentLabel = label;
      currentItems = [act];
    } else {
      currentItems.push(act);
    }
  }
  if (currentLabel !== null) {
    groups.push({ label: currentLabel, items: currentItems });
  }

  return groups;
}
