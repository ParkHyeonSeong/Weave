import { useState, useCallback } from 'react';
import { useRouter } from 'next/router';
import { ArrowRight, Maximize2, Link2, Trash2 } from 'lucide-react';
import { axios } from '@/library/_axios';
import useContextMenu from '@/components/common/useContextMenu';
import { showToast } from '@/components/Layout/Toast';

/**
 * 태스크 행/카드 공용 우클릭 메뉴 훅. 리스트·보드 뷰가 같이 쓴다.
 *
 * 사용:
 *   const menu = useTaskContextMenu({ branchId, onSelectTask });
 *   행/카드: onContextMenu={(e) => menu.openMenu(e, task)}
 *   렌더: <ContextMenu {...menu.menuProps} /> + ConfirmModal(menu.confirmTask 기반)
 */
export default function useTaskContextMenu({ branchId, onSelectTask }) {
  const router = useRouter();
  const ctx = useContextMenu();
  const { open } = ctx;
  const [confirmTask, setConfirmTask] = useState(null);

  const openMenu = useCallback((e, task) => {
    const path = `/branch/${branchId}/task/${task.task_id}`;
    open(e, [
      { id: 'open', group: 'open', icon: ArrowRight, label: '열기', onSelect: () => onSelectTask?.(task) },
      { id: 'open-full', group: 'open', icon: Maximize2, label: '풀페이지로 열기', onSelect: () => router.push(path) },
      {
        id: 'copy-link', group: 'share', icon: Link2, label: '링크 복사',
        onSelect: () => {
          navigator.clipboard.writeText(`${window.location.origin}${path}`)
            .then(() => showToast('링크가 복사되었습니다'))
            .catch(() => {});
        },
      },
      { id: 'delete', group: 'danger', icon: Trash2, variant: 'danger', label: '삭제', onSelect: () => setConfirmTask(task) },
    ]);
  }, [branchId, onSelectTask, router, open]);

  const handleConfirmDelete = useCallback(async () => {
    const task = confirmTask;
    setConfirmTask(null);
    if (!task) return;
    try {
      const res = await axios.delete(`/branches/${branchId}/tasks/${task.task_id}`);
      if (res.data?.status) {
        window.dispatchEvent(new Event('task:updated'));
        // 상세 패널이 이 태스크를 열고 있으면 닫도록 알림 (BranchDetail이 수신)
        window.dispatchEvent(new CustomEvent('task:deleted', { detail: { taskId: task.task_id } }));
      } else {
        showToast(res.data?.message || '태스크를 삭제하지 못했습니다.', 'error');
      }
    } catch {
      showToast('태스크를 삭제하지 못했습니다. 잠시 후 다시 시도해 주세요.', 'error');
    }
  }, [branchId, confirmTask]);

  const clearConfirm = useCallback(() => setConfirmTask(null), []);

  return {
    openMenu,
    menuProps: ctx.props,
    confirmTask,
    clearConfirm,
    handleConfirmDelete,
  };
}
