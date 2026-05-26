import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { axios } from '@/library/_axios';
import { userInitial, userColor } from '@/library/userAvatar';
import TrackHeader from './TrackHeader';
import SourcePickerSidebar from './SourcePicker/SourcePickerSidebar';
import TrackFlowCanvas from './Flow/TrackFlowCanvas';
import TrackTimeline from './Timeline/TrackTimeline';
import TrackTree from './Tree/TrackTree';
import TrackItemDetail from './Detail/TrackItemDetail';
import ManageBranchesModal from './ManageBranchesModal';
import BulkAddModal from './BulkAddModal';
import { showToast } from '@/components/Layout/Toast';
import { WORKFLOW_STATUSES, getBranchDistribution } from './mockData';

// 서버 hydrated item → 컴포넌트가 기대하는 형태로 정규화
function normalizeItem(raw) {
  const base = {
    item_id: raw.item_id,
    source_type: raw.source_type,
    position: { x: raw.position_x || 0, y: raw.position_y || 0 },
    layer_id: raw.layer_id,
    virtual_parent_id: raw.virtual_parent_id,
  };
  if (raw.restricted === true) {
    return { ...base, restricted: true, restricted_hint: raw.restricted_hint };
  }
  return {
    ...base,
    restricted: false,
    task_id: raw.task_id,
    branch_id: raw.branch_id,
    branch_key: raw.branch_key,
    branch_color: raw.branch_color,
    branch_name: raw.branch_name,
    display_id: raw.display_id,
    title: raw.title,
    status: raw.status,
    status_label: raw.status_label,
    status_color: raw.status_color,
    status_category: raw.status_category,
    priority: raw.priority,
    start_date: raw.start_date,
    due_date: raw.due_date,
    assignees: (raw.assignees || []).map((a) => ({
      user_id: a.user_id,
      username: a.username,
      initial: userInitial(a.username),
      color: userColor(a.user_id),
      role: a.role,
    })),
    // 컴포넌트가 참조하는 추가 필드 (v1.1엔 빈 값)
    description: '',
    other_tracks: [],
  };
}

export default function TrackDetail() {
  const router = useRouter();
  // router.isReady 전까지 query.id는 undefined — 첫 렌더에서 NaN 만들어지지 않게 가드
  const trackId = router.isReady ? Number(router.query.id) : null;

  const [track, setTrack] = useState(null);
  const [participatingBranches, setParticipatingBranches] = useState([]);
  const [members, setMembers] = useState([]);
  const [allBranches, setAllBranches] = useState([]); // ManageBranches 모달용 (가입된 branch 전체)
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const [items, setItems] = useState([]);
  const [links, setLinks] = useState([]);

  const [selectedItemId, setSelectedItemId] = useState(null);
  const [viewMode, setViewMode] = useState('flow');
  const [edgeType, setEdgeType] = useState('flow_to');
  const [materializeOnCreate, setMaterializeOnCreate] = useState(true);
  const [showManageBranches, setShowManageBranches] = useState(false);
  const [bulkAddMode, setBulkAddMode] = useState(null);  // null | 'epic' | 'sprint' | 'filter'

  // debounced position save용 ref
  const positionSaveTimer = useRef(null);
  const pendingPositions = useRef(new Map());

  // SourcePicker 재조회 트리거: items add/remove마다 +1
  const [sourceReloadKey, setSourceReloadKey] = useState(0);

  // -- 초기 로드 -----------------------------------------------------------
  const fetchTrack = useCallback(async () => {
    if (!router.isReady || !trackId) return;
    try {
      const [trackRes, membersRes, branchesRes, itemsRes, linksRes] = await Promise.all([
        axios.get(`/tracks/${trackId}`),
        axios.get(`/tracks/${trackId}/members`),
        axios.get('/branches'),
        axios.get(`/tracks/${trackId}/items`),
        axios.get(`/tracks/${trackId}/links`),
      ]);
      if (trackRes.data.status) {
        setTrack(trackRes.data.track);
        setParticipatingBranches(trackRes.data.track.participating_branches || []);
      } else {
        setNotFound(true);
      }
      if (membersRes.data.status) setMembers(membersRes.data.members);
      if (branchesRes.data.status) setAllBranches(branchesRes.data.branches);
      if (itemsRes.data.status) {
        setItems(itemsRes.data.items.map(normalizeItem));
      }
      if (linksRes.data.status) setLinks(linksRes.data.links);
    } catch {
      setNotFound(true);
    }
    setLoading(false);
  }, [router.isReady, trackId]);

  useEffect(() => {
    fetchTrack();
  }, [fetchTrack]);

  // 마운트 해제 시 pending position 즉시 flush 안 함 (다음 fetch에서 서버 상태로 덮어씀)
  useEffect(() => () => {
    if (positionSaveTimer.current) clearTimeout(positionSaveTimer.current);
  }, []);

  // -- 파생 상태 ----------------------------------------------------------
  const selectedItem = useMemo(
    () => items.find((it) => it.item_id === selectedItemId) || null,
    [items, selectedItemId]
  );

  // participating branches를 한 형태(branch_id/name/key/color)로 정규화 — 여러 곳에서 재사용
  const normalizedBranches = useMemo(
    () => participatingBranches.map((b) => ({
      branch_id: b.branch_id,
      name: b.display_name,
      key: b.branch_key,
      color: b.color,
    })),
    [participatingBranches]
  );

  // Bulk add는 branch를 participating으로 합류시키지 않으므로 canvas에 non-participating
  // branch task가 있을 수 있음. 그 경우 item이 갖고 있는 branch_* 필드로 fallback.
  const branchById = useMemo(() => {
    const map = {};
    normalizedBranches.forEach((b) => { map[b.branch_id] = b; });
    items.forEach((it) => {
      if (it.restricted || !it.branch_id || map[it.branch_id]) return;
      map[it.branch_id] = {
        branch_id: it.branch_id,
        name: it.branch_name || 'Unknown',
        key: it.branch_key || '?',
        color: it.branch_color || '#9CA3AF',
      };
    });
    return map;
  }, [normalizedBranches, items]);

  const distribution = useMemo(
    () => getBranchDistribution(items, normalizedBranches),
    [items, normalizedBranches]
  );

  const participatingBranchIds = useMemo(
    () => normalizedBranches.map((b) => b.branch_id),
    [normalizedBranches]
  );

  const membersForHeader = useMemo(
    () => members.map((m) => ({
      user_id: m.user_id,
      username: m.username,
      role: m.role,
      initial: userInitial(m.username),
      color: userColor(m.user_id),
    })),
    [members]
  );

  const itemsByBranchId = useMemo(() => {
    const m = new Map();
    items.forEach((it) => {
      if (it.restricted || !it.branch_id) return;
      m.set(it.branch_id, (m.get(it.branch_id) || 0) + 1);
    });
    return m;
  }, [items]);

  // -- Manage branches -----------------------------------------------------
  const handleManageBranches = useCallback(() => {
    setShowManageBranches(true);
  }, []);

  const handleUnparticipateBranch = useCallback(async (branchId, branchName) => {
    const itemCount = itemsByBranchId.get(branchId) || 0;
    const msg = itemCount > 0
      ? `"${branchName}" branch를 Track에서 빼면 그 branch의 ${itemCount}개 item이 함께 제거됩니다. 계속할까요?`
      : `"${branchName}" branch를 Track에서 빼시겠어요?`;
    if (!window.confirm(msg)) return;
    try {
      const res = await axios.delete(`/tracks/${trackId}/branches/${branchId}`);
      if (!res.data?.status) {
        showToast(`제거 실패: ${res.data.message}`, 'error');
        return;
      }
      // 권위 있는 refetch
      const [branchesRes, itemsRes] = await Promise.all([
        axios.get(`/tracks/${trackId}/branches`),
        axios.get(`/tracks/${trackId}/items`),
      ]);
      if (branchesRes.data.status) setParticipatingBranches(branchesRes.data.branches);
      if (itemsRes.data.status) setItems(itemsRes.data.items.map(normalizeItem));
      setSourceReloadKey((k) => k + 1);
    } catch {
      showToast('Branch 제거 실패', 'error');
    }
  }, [trackId, itemsByBranchId]);

  const handleConfirmBranches = useCallback(async (nextIds) => {
    const current = new Set(participatingBranches.map((b) => b.branch_id));
    const next = new Set(nextIds);
    const toAdd = [...next].filter((id) => !current.has(id));
    const toRemove = [...current].filter((id) => !next.has(id));

    // allSettled로 부분 실패 허용 — 성공한 변경은 살리고 실패만 보고
    const results = await Promise.allSettled([
      ...toAdd.map((branch_id) =>
        axios.post(`/tracks/${trackId}/branches`, { branch_id })
      ),
      ...toRemove.map((branch_id) =>
        axios.delete(`/tracks/${trackId}/branches/${branch_id}`)
      ),
    ]);
    const failed = results.filter((r) =>
      r.status === 'rejected' || (r.value?.data && r.value.data.status === false)
    ).length;

    // 서버 상태 기준으로 항상 refetch — branch 제거 시 backend가 그 branch의 item과
    // materialized dep도 cascade로 정리하므로 items/links도 함께 refetch해야 함.
    try {
      const [branchesRes, itemsRes, linksRes] = await Promise.all([
        axios.get(`/tracks/${trackId}/branches`),
        axios.get(`/tracks/${trackId}/items`),
        axios.get(`/tracks/${trackId}/links`),
      ]);
      if (branchesRes.data.status) setParticipatingBranches(branchesRes.data.branches);
      if (itemsRes.data.status) setItems(itemsRes.data.items.map(normalizeItem));
      if (linksRes.data.status) setLinks(linksRes.data.links);
      setSourceReloadKey((k) => k + 1);
    } catch {}

    if (failed > 0) {
      showToast(`${failed}개 변경 사항이 적용되지 않았어요`, 'error');
      // 실패가 있으면 모달은 열어둠 — 사용자가 다시 시도/취소 결정
      return;
    }
    setShowManageBranches(false);
  }, [trackId, participatingBranches]);

  // -- Items handlers -----------------------------------------------------

  // 동시 drop 시 응답이 뒤바뀌어 잘못된 item이 선택될 수 있음 → 시리얼화
  const dropQueueRef = useRef(Promise.resolve());

  const handleSourceDrop = useCallback((sourceItem, dropPosition) => {
    const next = dropQueueRef.current.then(async () => {
      try {
        const res = await axios.post(`/tracks/${trackId}/items`, {
          source_task_id: sourceItem.task_id,
          position_x: dropPosition.x,
          position_y: dropPosition.y,
        });
        if (!res.data.status) {
          window.dispatchEvent(new CustomEvent('toast', {
            detail: {
              message: res.data.message === 'NOT_BRANCH_MEMBER'
                ? '이 task의 branch 멤버가 아니에요'
                : `Failed: ${res.data.message}`,
              type: 'error',
            },
          }));
          return;
        }
        // 새 item을 fetch하기 전에 임시로 추가하면 race(즉시 drag) 위험.
        // 응답으로 받은 item_id 만으로 selection만 잡고, items 자체는 권위 있는 GET으로 교체.
        const [itemsRes, branchesRes] = await Promise.all([
          axios.get(`/tracks/${trackId}/items`),
          axios.get(`/tracks/${trackId}/branches`),
        ]);
        if (itemsRes.data.status) setItems(itemsRes.data.items.map(normalizeItem));
        if (branchesRes.data.status) setParticipatingBranches(branchesRes.data.branches);
        setSelectedItemId(res.data.item_id);
        setSourceReloadKey((k) => k + 1);
      } catch {}
    });
    dropQueueRef.current = next;
  }, [trackId]);

  const flushPositionsNow = useCallback(async () => {
    if (pendingPositions.current.size === 0) return;
    const positions = Array.from(pendingPositions.current.entries()).map(
      ([item_id, pos]) => ({ item_id, position_x: pos.x, position_y: pos.y })
    );
    pendingPositions.current.clear();
    try {
      await axios.patch(`/tracks/${trackId}/items/positions`, { positions });
    } catch {}
  }, [trackId]);

  const handleItemPositionChange = useCallback((itemId, position) => {
    // 낙관적 갱신
    setItems((prev) => prev.map((it) =>
      it.item_id === itemId ? { ...it, position } : it
    ));
    // 누적 후 debounced 저장
    pendingPositions.current.set(itemId, position);
    if (positionSaveTimer.current) clearTimeout(positionSaveTimer.current);
    positionSaveTimer.current = setTimeout(flushPositionsNow, 500);
  }, [flushPositionsNow]);

  const handleItemDelete = useCallback(async (itemId) => {
    // 낙관적 제거 + 실패 시 rollback을 위해 직전 상태 보관
    let snapshot;
    setItems((prev) => {
      snapshot = prev;
      return prev.filter((it) => it.item_id !== itemId);
    });
    if (selectedItemId === itemId) setSelectedItemId(null);
    try {
      const res = await axios.delete(`/tracks/${trackId}/items/${itemId}`);
      if (!res.data?.status) throw new Error(res.data?.message || 'DELETE_FAILED');
      setSourceReloadKey((k) => k + 1);
    } catch (err) {
      // 롤백 + 사용자 알림
      if (snapshot) setItems(snapshot);
      window.dispatchEvent(new CustomEvent('toast', {
        detail: { message: 'Item 삭제 실패. 다시 시도해주세요.', type: 'error' },
      }));
    }
  }, [trackId, selectedItemId]);

  const handleLinkCreate = useCallback(async (sourceItemId, targetItemId) => {
    if (sourceItemId === targetItemId) return;
    // 같은 페어 이미 있으면 skip (canvas onConnect는 reactflow가 자체 처리)
    const exists = links.some((l) =>
      l.source_item_id === sourceItemId
      && l.target_item_id === targetItemId
      && l.link_type === edgeType
    );
    if (exists) return;

    try {
      const res = await axios.post(`/tracks/${trackId}/links`, {
        source_item_id: sourceItemId,
        target_item_id: targetItemId,
        link_type: edgeType,
        materialize: edgeType === 'flow_to' ? materializeOnCreate : false,
      });
      if (!res.data.status) {
        window.dispatchEvent(new CustomEvent('toast', {
          detail: {
            message: res.data.message === 'SELF_LINK' ? '자기 자신과 연결할 수 없어요'
              : `Failed: ${res.data.message}`,
            type: 'error',
          },
        }));
        return;
      }
      // 권위 있는 상태 재로드
      const linksRes = await axios.get(`/tracks/${trackId}/links`);
      if (linksRes.data.status) setLinks(linksRes.data.links);
      // materialize 요청했는데 서버에서 skip된 경우 사유별 안내
      if (materializeOnCreate && edgeType === 'flow_to' && !res.data.materialized && res.data.created) {
        const reasonText = {
          CIRCULAR: '순환 의존 가능성 — draft link로 저장됨',
          BRANCH_PERMISSION: 'source/target branch 비멤버 — draft link로 저장됨',
          NOT_TASK_REF: 'task 참조가 아닌 item은 의존성으로 만들 수 없어요',
        }[res.data.skip_reason] || 'Materialize 안 됨 — draft link';
        window.dispatchEvent(new CustomEvent('toast', {
          detail: { message: reasonText, type: 'info' },
        }));
      }
    } catch {}
  }, [trackId, links, edgeType, materializeOnCreate]);

  const handleLinkDelete = useCallback(async (linkId) => {
    let snapshot;
    setLinks((prev) => {
      snapshot = prev;
      return prev.filter((l) => l.link_id !== linkId);
    });
    try {
      const res = await axios.delete(`/tracks/${trackId}/links/${linkId}`);
      if (!res.data?.status) throw new Error(res.data?.message);
    } catch {
      if (snapshot) setLinks(snapshot);
      window.dispatchEvent(new CustomEvent('toast', {
        detail: { message: 'Link 삭제 실패', type: 'error' },
      }));
    }
  }, [trackId]);

  // -- 렌더 ----------------------------------------------------------------
  if (loading) {
    return <div className="Track Track--loading">Loading…</div>;
  }
  if (notFound || !track) {
    return (
      <div className="Track Track--notfound">
        <div className="Track__NotFoundTitle">Track not found</div>
        <button className="Track__NotFoundBack" onClick={() => router.push('/tracks')}>
          ← Back to Tracks
        </button>
      </div>
    );
  }

  // ManageBranchesModal에 넘길 branch 전체 (가입된 것만)
  const allBranchesForModal = allBranches.map((b) => ({
    branch_id: b.branch_id,
    name: b.branch_name,
    key: b.key,
    color: b.color || '#5E6AD2',
  }));

  return (
    <div className="Track">
      <TrackHeader
        track={{
          track_id: track.track_id,
          track_name: track.track_name,
          description: track.description,
          color: track.color,
        }}
        members={membersForHeader}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        distribution={distribution}
        totalItems={items.filter((i) => !i.restricted).length}
        totalLinks={links.length}
        participatingBranches={normalizedBranches}
        onManageBranches={handleManageBranches}
      />

      <div className="Track__Body">
        <SourcePickerSidebar
          trackId={trackId}
          participatingBranchIds={participatingBranchIds}
          onManageBranches={handleManageBranches}
          onBulkAdd={(mode) => setBulkAddMode(mode)}
          onUnparticipateBranch={handleUnparticipateBranch}
          reloadKey={sourceReloadKey}
        />

        <div className="Track__CanvasWrap">
          {viewMode === 'flow' && (
            <TrackFlowCanvas
              items={items}
              links={links}
              branchById={branchById}
              workflowStatuses={WORKFLOW_STATUSES}
              selectedItemId={selectedItemId}
              edgeType={edgeType}
              materializeOnCreate={materializeOnCreate}
              onSelectItem={setSelectedItemId}
              onSourceDrop={handleSourceDrop}
              onItemPositionChange={handleItemPositionChange}
              onLinkCreate={handleLinkCreate}
              onLinkDelete={handleLinkDelete}
              onItemDelete={handleItemDelete}
              onEdgeTypeChange={setEdgeType}
              onMaterializeChange={setMaterializeOnCreate}
            />
          )}
          {viewMode === 'timeline' && (
            <TrackTimeline
              items={items}
              links={links}
              branchById={branchById}
              workflowStatuses={WORKFLOW_STATUSES}
              selectedItemId={selectedItemId}
              onSelectItem={setSelectedItemId}
            />
          )}
          {viewMode === 'tree' && (
            <TrackTree
              items={items}
              links={links}
              branchById={branchById}
              workflowStatuses={WORKFLOW_STATUSES}
              selectedItemId={selectedItemId}
              onSelectItem={setSelectedItemId}
            />
          )}
        </div>

        <TrackItemDetail
          item={selectedItem}
          branch={selectedItem && !selectedItem.restricted ? branchById[selectedItem.branch_id] : null}
          workflowStatuses={WORKFLOW_STATUSES}
          onClose={() => setSelectedItemId(null)}
          onRemove={handleItemDelete}
        />
      </div>

      {showManageBranches && (
        <ManageBranchesModal
          allBranches={allBranchesForModal}
          participatingBranchIds={participatingBranchIds}
          itemsByBranchId={itemsByBranchId}
          onClose={() => setShowManageBranches(false)}
          onConfirm={handleConfirmBranches}
        />
      )}

      {bulkAddMode && (
        <BulkAddModal
          mode={bulkAddMode}
          trackId={trackId}
          participatingBranches={normalizedBranches}
          allBranches={allBranchesForModal}
          onClose={() => setBulkAddMode(null)}
          onAdded={async () => {
            setBulkAddMode(null);
            // Bulk add는 participating에 자동 합류시키지 않음 → items만 refetch
            try {
              const itemsRes = await axios.get(`/tracks/${trackId}/items`);
              if (itemsRes.data.status) setItems(itemsRes.data.items.map(normalizeItem));
              setSourceReloadKey((k) => k + 1);
            } catch {}
          }}
        />
      )}
    </div>
  );
}
