import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';

// 패널은 칩 클릭 후에만 렌더되므로 무거운 의존(TipTap 에디터 서브트리,
// dompurify)을 호스트 화면의 초기 번들에 싣지 않는다.
const TaskDetailPanel = dynamic(() => import('@/components/Branch/Tasks/TaskDetailPanel'), { ssr: false });
const RefPreviewPanel = dynamic(() => import('@/components/Canvas/RefPreviewPanel'), { ssr: false });

/**
 * canvas:ref_click 수신 + previewRef 상태 공용 훅.
 * RefPanelHost를 마운트하는 표면들이 공유한다 — 표면마다 패널 레이아웃이
 * 달라(좌/우/단일) 래퍼 컴포넌트가 아닌 훅이 추출 단위.
 *
 * 주의: 같은 화면 트리에서 두 번 호출하지 말 것 — 독립 리스너·상태가 두 벌
 * 생겨, RefPanelHost에 연결되지 않은 쪽이 이벤트를 받아 클릭이 조용히
 * 무시된 것처럼 보인다. 화면(라우트/보드)당 한 번만 호출한다.
 */
export function useRefPreview() {
  const [previewRef, setPreviewRef] = useState(null);
  useEffect(() => {
    const handler = (e) => setPreviewRef(e.detail);
    window.addEventListener('canvas:ref_click', handler);
    return () => window.removeEventListener('canvas:ref_click', handler);
  }, []);
  return [previewRef, setPreviewRef];
}

/**
 * 인라인 ref 칩 클릭 패널 라우터 — 칩 타입별로 패널을 분기한다.
 * task는 편집 가능한 TaskDetailPanel을 그대로 재사용(편집 패널 중복 구현 금지),
 * doc/issue는 읽기 전용 RefPreviewPanel. 호스트는 useRefPreview로 칩 클릭을
 * 구독하므로 패널 본문 안 칩 클릭도 onChangeRef 체이닝으로 이어진다.
 */
export default function RefPanelHost({ previewRef, onClose, onChangeRef }) {
  if (!previewRef) return null;

  if (previewRef.type === 'task') {
    // 칩 클릭 경로에 따라 id가 string(DOM attr)일 수 있어 한 곳에서 정규화
    const branchId = Number(previewRef.data.branchId);
    const taskId = Number(previewRef.data.taskId);
    return (
      <TaskDetailPanel
        key={`${branchId}-${taskId}`}
        branchId={branchId}
        taskSummary={{ task_id: taskId }}
        onClose={onClose}
        onSelectTask={(t) =>
          onChangeRef({ type: 'task', data: { branchId: t.branch_id || branchId, taskId: t.task_id } })
        }
      />
    );
  }

  return <RefPreviewPanel refType={previewRef.type} refData={previewRef.data} onClose={onClose} />;
}
