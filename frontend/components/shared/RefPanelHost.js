import dynamic from 'next/dynamic';

// 패널은 칩 클릭 후에만 렌더되므로 무거운 의존(TipTap 에디터 서브트리,
// dompurify)을 호스트 화면의 초기 번들에 싣지 않는다.
const TaskDetailPanel = dynamic(() => import('@/components/Branch/Tasks/TaskDetailPanel'), { ssr: false });
const RefPreviewPanel = dynamic(() => import('@/components/Canvas/RefPreviewPanel'), { ssr: false });

/**
 * 인라인 ref 칩 클릭 패널 라우터 — 칩 타입별로 패널을 분기한다.
 * task는 편집 가능한 TaskDetailPanel을 그대로 재사용(편집 패널 중복 구현 금지),
 * doc/issue는 읽기 전용 RefPreviewPanel. 체이닝: onSelectTask(task→task)와,
 * 호스트가 window의 canvas:ref_click을 구독하는 경우(스크럼) 패널 본문 안
 * 칩 클릭 전반이 onChangeRef로 이어진다.
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
