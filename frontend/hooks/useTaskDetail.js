import { useState, useEffect, useCallback } from 'react';
import { axios } from '@/library/_axios';

export default function useTaskDetail(branchId, taskId) {
  const [task, setTask] = useState(null);
  const [loading, setLoading] = useState(true);

  // 옵션 데이터
  const [sprints, setSprints] = useState([]);
  const [epics, setEpics] = useState([]);
  const [members, setMembers] = useState([]);
  const [labels, setLabels] = useState([]);

  const fetchTask = useCallback(async () => {
    if (!branchId || !taskId) return;
    setLoading(true);
    try {
      const res = await axios.get(`/branches/${branchId}/tasks/${taskId}`);
      if (res.data.status) {
        setTask(res.data.task);
      }
    } catch {}
    setLoading(false);
  }, [branchId, taskId]);

  const fetchOptions = useCallback(async () => {
    if (!branchId) return;
    try {
      const [sprintRes, epicRes, memberRes, labelRes] = await Promise.all([
        axios.get(`/branches/${branchId}/sprints`),
        axios.get(`/branches/${branchId}/epics`),
        axios.get(`/branches/${branchId}/members`),
        axios.get(`/branches/${branchId}/labels`),
      ]);
      if (sprintRes.data.status) setSprints(sprintRes.data.sprints);
      if (epicRes.data.status) setEpics(epicRes.data.epics);
      if (memberRes.data.status) setMembers(memberRes.data.members);
      if (labelRes.data.status) setLabels(labelRes.data.labels);
    } catch {}
  }, [branchId]);

  useEffect(() => {
    fetchTask();
    fetchOptions();
  }, [fetchTask, fetchOptions]);

  // 필드 업데이트 (자동 저장 + 재조회)
  const updateField = async (field, value) => {
    if (!task) return;
    try {
      const payload = { [field]: value };
      const res = await axios.patch(`/branches/${branchId}/tasks/${task.task_id}`, payload);
      if (res.data.status) {
        await fetchTask();
        window.dispatchEvent(new Event('task:updated'));
      }
    } catch {}
  };

  // 담당자 업데이트
  const updateAssignees = async (mainId, subIds) => {
    if (!task) return;
    try {
      const res = await axios.patch(`/branches/${branchId}/tasks/${task.task_id}`, {
        assignees: { main: mainId || null, sub: subIds },
      });
      if (res.data.status) {
        await fetchTask();
        window.dispatchEvent(new Event('task:updated'));
      }
    } catch {}
  };

  // 라벨 토글
  const toggleLabel = async (labelId) => {
    if (!task) return;
    const currentIds = (task.labels || []).map((l) => l.label_id);
    const newIds = currentIds.includes(labelId)
      ? currentIds.filter((id) => id !== labelId)
      : [...currentIds, labelId];
    try {
      const res = await axios.patch(`/branches/${branchId}/tasks/${task.task_id}`, { label_ids: newIds });
      if (res.data.status) {
        fetchTask();
        window.dispatchEvent(new Event('task:updated'));
      }
    } catch {}
  };

  // 삭제
  const handleDelete = async () => {
    if (!task) return false;
    try {
      const res = await axios.delete(`/branches/${branchId}/tasks/${task.task_id}`);
      if (res.data.status) {
        window.dispatchEvent(new Event('task:updated'));
        return true;
      }
    } catch {}
    return false;
  };

  // Select 필드 변경 핸들러
  const handleSelectChange = (field, value) => {
    const parsed = value === '' ? null : (field.endsWith('_id') ? Number(value) : value);
    updateField(field, parsed);
  };

  return {
    task,
    loading,
    sprints,
    epics,
    members,
    labels,
    fetchTask,
    updateField,
    updateAssignees,
    toggleLabel,
    handleDelete,
    handleSelectChange,
  };
}
