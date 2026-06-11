import { useEffect } from 'react';
import { axios } from '@/library/_axios';

// 인라인 ref 칩(taskRef/docRef/issueRef/mention) 라이브 하이드레이션.
// 칩 attrs는 삽입 시점 스냅샷(폴백)이고, 표면이 마운트될 때마다 /ref-status로
// 최신 제목·상태를 받아 DOM을 패치한다 (컨플루언스 Smart Link 모델).
// 응답에 없는 ID(삭제·권한 밖)는 스냅샷 텍스트를 유지한 채 중립 표기만 한다.

const TTL_MS = 30_000;
const cache = new Map(); // 'tasks:1' → { data, at }

function cacheGet(kind, id) {
  const key = `${kind}:${id}`;
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at >= TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.data;
}

function cacheSet(kind, map) {
  const at = Date.now();
  Object.entries(map || {}).forEach(([id, data]) => cache.set(`${kind}:${id}`, { data, at }));
}

// root(DOM) 안의 칩들에서 종류별 ID 수집
export function collectRefIds(root) {
  const ids = { task_ids: new Set(), issue_ids: new Set(), page_ids: new Set(), user_ids: new Set() };
  root.querySelectorAll('[data-task-ref]').forEach((el) => {
    const id = Number(el.getAttribute('data-task-id'));
    if (id) ids.task_ids.add(id);
  });
  root.querySelectorAll('[data-issue-ref]').forEach((el) => {
    const id = Number(el.getAttribute('data-issue-id'));
    if (id) ids.issue_ids.add(id);
  });
  root.querySelectorAll('[data-doc-ref]').forEach((el) => {
    const id = Number(el.getAttribute('data-page-id'));
    if (id) ids.page_ids.add(id);
  });
  root.querySelectorAll('[data-mention]').forEach((el) => {
    const id = Number(el.getAttribute('data-user-id'));
    if (id) ids.user_ids.add(id);
  });
  return ids;
}

// 캐시 미스만 골라 배치 요청 → { tasks, issues, pages, users } (캐시 병합본)
export async function resolveRefs(ids) {
  const want = {
    tasks: [...ids.task_ids], issues: [...ids.issue_ids],
    pages: [...ids.page_ids], users: [...ids.user_ids],
  };
  const out = { tasks: {}, issues: {}, pages: {}, users: {} };
  const miss = { task_ids: [], issue_ids: [], page_ids: [], user_ids: [] };
  const pick = (kind, list, missKey) => {
    list.forEach((id) => {
      const hit = cacheGet(kind, id);
      if (hit) out[kind][id] = hit;
      else miss[missKey].push(id);
    });
  };
  pick('tasks', want.tasks, 'task_ids');
  pick('issues', want.issues, 'issue_ids');
  pick('pages', want.pages, 'page_ids');
  pick('users', want.users, 'user_ids');

  if (miss.task_ids.length || miss.issue_ids.length || miss.page_ids.length || miss.user_ids.length) {
    const res = await axios.post('/ref-status', miss);
    if (res.data.status) {
      ['tasks', 'issues', 'pages', 'users'].forEach((kind) => {
        cacheSet(kind, res.data[kind]);
        Object.assign(out[kind], res.data[kind]);
      });
    }
  }
  return out;
}

// 칩 첫 텍스트 노드 교체 (displayId·title 갱신)
function setChipText(el, text) {
  if (el.firstChild && el.firstChild.nodeType === Node.TEXT_NODE) {
    el.firstChild.nodeValue = text;
  }
}

// 서버 응답 값이 className에 그대로 보간되므로 화이트리스트로 방어
const SAFE_CATEGORIES = new Set(['todo', 'in_progress', 'done', 'cancelled', 'open', 'closed']);

function setBadge(el, { category, label, color }) {
  el.querySelector('[data-ref-badge]')?.remove();
  const badge = document.createElement('span');
  const safeCategory = SAFE_CATEGORIES.has(category) ? category : 'todo';
  badge.className = `ref-chip__badge ref-chip__badge--${safeCategory}`;
  badge.textContent = label;
  if (color) {
    badge.style.backgroundColor = `${color}20`;
    badge.style.color = color;
  }
  badge.setAttribute('data-ref-badge', 'true');
  el.appendChild(badge);
}

const ISSUE_LABELS = { open: 'Open', closed: 'Closed' };

const UNRESOLVED_TITLE = '삭제되었거나 접근할 수 없는 항목';

// 응답에서 누락된 칩(삭제됐거나 접근 권한 없음 — 서버는 보안상 구분하지 않음) 중립 표기.
// 캐시 만료 후 재해석에서 다시 살아나면 표기를 걷는다 (title은 우리가 쓴 것만 제거).
function setUnresolved(el, unresolved) {
  el.classList.toggle('ref-chip--unresolved', unresolved);
  if (unresolved) {
    el.title = UNRESOLVED_TITLE;
  } else if (el.title === UNRESOLVED_TITLE) {
    el.removeAttribute('title');
  }
}

// 해석 결과를 root 안 칩 DOM에 반영 (data-* 속성도 갱신해 클릭/배지 재주입이 fresh 값을 읽게)
export function applyToDom(root, { tasks, issues, pages, users }) {
  root.querySelectorAll('[data-task-ref]').forEach((el) => {
    const info = tasks[el.getAttribute('data-task-id')];
    setUnresolved(el, !info);
    if (!info) return;
    setChipText(el, `${info.display_id} ${info.title}`);
    el.setAttribute('data-display-id', info.display_id);
    el.setAttribute('data-title', info.title);
    el.setAttribute('data-status', info.status);
    el.setAttribute('data-status-label', info.status_label || '');
    el.setAttribute('data-status-color', info.status_color || '');
    el.setAttribute('data-status-category', info.status_category || '');
    setBadge(el, {
      category: info.status_category || info.status,
      label: info.status_label || info.status,
      color: info.status_color,
    });
  });
  root.querySelectorAll('[data-issue-ref]').forEach((el) => {
    const info = issues[el.getAttribute('data-issue-id')];
    setUnresolved(el, !info);
    if (!info) return;
    const displayId = el.getAttribute('data-display-id') || '';
    setChipText(el, `${displayId} ${info.title}`);
    el.setAttribute('data-title', info.title);
    el.setAttribute('data-status', info.status);
    setBadge(el, { category: info.status, label: ISSUE_LABELS[info.status] || info.status, color: null });
  });
  root.querySelectorAll('[data-doc-ref]').forEach((el) => {
    const info = pages[el.getAttribute('data-page-id')];
    setUnresolved(el, !info);
    if (!info) return;
    setChipText(el, info.title);
    el.setAttribute('data-title', info.title);
    el.setAttribute('data-canvas-name', info.canvas_name);
    el.title = `${info.canvas_name} > ${info.title}`;
  });
  root.querySelectorAll('[data-mention]').forEach((el) => {
    const info = users[el.getAttribute('data-user-id')];
    setUnresolved(el, !info);
    if (!info) return;
    setChipText(el, `@${info.username}`);
    el.setAttribute('data-username', info.username);
  });
}

// readonly 표면용: root 안의 칩 전부 해석·패치
export async function hydrateDom(root) {
  if (!root) return;
  const ids = collectRefIds(root);
  if (!ids.task_ids.size && !ids.issue_ids.size && !ids.page_ids.size && !ids.user_ids.size) return;
  try {
    const data = await resolveRefs(ids);
    if (root.isConnected) applyToDom(root, data);
  } catch {}
}

// 에디터 표면용: NodeView DOM을 같은 패처로 패치
export async function hydrateEditor(editor) {
  if (!editor || editor.isDestroyed) return;
  return hydrateDom(editor.view.dom);
}

// task:updated 등 이벤트 구동 재해석 시 TTL 캐시가 stale을 되돌려주지 않게 비운다
export function invalidateRefCache() {
  cache.clear();
}

// readonly 표면용 훅: 콘텐츠 변경 시 + task/issue 변경 이벤트 시 하이드레이션.
// deps는 호출부가 콘텐츠 의존성을 그대로 넘긴다.
export function useRefHydration(ref, deps, enabled = true) {
  useEffect(() => {
    if (!enabled || !ref.current) return;
    hydrateDom(ref.current);
    const refresh = () => {
      invalidateRefCache();
      if (ref.current) hydrateDom(ref.current);
    };
    window.addEventListener('task:updated', refresh);
    window.addEventListener('issue:updated', refresh);
    return () => {
      window.removeEventListener('task:updated', refresh);
      window.removeEventListener('issue:updated', refresh);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, ...deps]);
}

// 에디터(TipTap) 표면용 훅. collab(yjs) 에디터는 초기 동기화 대기용 delay를 준다.
export function useEditorRefHydration(editor, delay = 0) {
  useEffect(() => {
    if (!editor) return;
    const t = setTimeout(() => hydrateEditor(editor), delay);
    const refresh = () => {
      invalidateRefCache();
      hydrateEditor(editor);
    };
    window.addEventListener('task:updated', refresh);
    window.addEventListener('issue:updated', refresh);
    return () => {
      clearTimeout(t);
      window.removeEventListener('task:updated', refresh);
      window.removeEventListener('issue:updated', refresh);
    };
  }, [editor, delay]);
}

// fetch 전 즉시 표시용: 칩의 data-* 스냅샷 attrs로 배지를 주입한다
// (CanvasPageView/CanvasOverview 공용 — 구 인라인 구현 2벌 대체)
export function applyFallbackBadges(root) {
  if (!root) return;
  root.querySelectorAll('[data-task-ref]').forEach((el) => {
    const status = el.getAttribute('data-status') || 'todo';
    setBadge(el, {
      category: el.getAttribute('data-status-category') || status,
      label: el.getAttribute('data-status-label') || status,
      color: el.getAttribute('data-status-color') || null,
    });
  });
  root.querySelectorAll('[data-issue-ref]').forEach((el) => {
    const status = el.getAttribute('data-status') || 'open';
    setBadge(el, { category: status, label: ISSUE_LABELS[status] || status, color: null });
  });
}
