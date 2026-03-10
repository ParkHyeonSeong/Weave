import { useState, useEffect, useCallback } from 'react';
import { axios } from '@/library/_axios';

export default function useTaskDetail(branchId, taskId) {
  const [task, setTask] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // 옵션 데이터
  const [sprints, setSprints] = useState([]);
  const [epics, setEpics] = useState([]);
  const [members, setMembers] = useState([]);
  const [labels, setLabels] = useState([]);
  const [workflowStatuses, setWorkflowStatuses] = useState([]);
  const [taskTypes, setTaskTypes] = useState([]);
  const [customFields, setCustomFields] = useState([]);

  const fetchTask = useCallback(async () => {
    if (!branchId || !taskId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await axios.get(`/branches/${branchId}/tasks/${taskId}`);
      if (res.data.status) {
        setTask(res.data.task);
      } else {
        setError(res.data.message || 'UNKNOWN_ERROR');
      }
    } catch {
      setError('NETWORK_ERROR');
    }
    setLoading(false);
  }, [branchId, taskId]);

  const fetchOptions = useCallback(async () => {
    if (!branchId) return;
    try {
      const [sprintRes, epicRes, memberRes, labelRes, wsRes, typeRes] = await Promise.all([
        axios.get(`/branches/${branchId}/sprints`),
        axios.get(`/branches/${branchId}/epics`),
        axios.get(`/branches/${branchId}/members`),
        axios.get(`/branches/${branchId}/labels`),
        axios.get(`/branches/${branchId}/workflow-statuses`),
        axios.get(`/branches/${branchId}/task-types`),
      ]);
      if (sprintRes.data.status) setSprints(sprintRes.data.sprints);
      if (epicRes.data.status) setEpics(epicRes.data.epics);
      if (memberRes.data.status) setMembers(memberRes.data.members);
      if (labelRes.data.status) setLabels(labelRes.data.labels);
      if (wsRes.data.status) setWorkflowStatuses(wsRes.data.statuses);
      if (typeRes.data.status) setTaskTypes(typeRes.data.task_types);
    } catch {}
  }, [branchId]);

  // task type에 따라 custom fields 가져오기
  const fetchCustomFields = useCallback(async () => {
    if (!branchId || !task?.task_type || taskTypes.length === 0) return;
    const typeConfig = taskTypes.find((t) => t.type_key === task.task_type);
    if (!typeConfig) {
      setCustomFields([]);
      return;
    }
    try {
      const cfRes = await axios.get(`/branches/${branchId}/task-types/${typeConfig.type_id}/custom-fields`);
      if (cfRes.data.status) setCustomFields(cfRes.data.fields);
    } catch {
      setCustomFields([]);
    }
  }, [branchId, task?.task_type, taskTypes]);

  useEffect(() => {
    fetchTask();
    fetchOptions();
  }, [fetchTask, fetchOptions]);

  // task와 taskTypes가 로드된 후 custom fields 가져오기
  useEffect(() => {
    fetchCustomFields();
  }, [fetchCustomFields]);

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
    error,
    sprints,
    epics,
    members,
    labels,
    workflowStatuses,
    taskTypes,
    customFields,
    fetchTask,
    updateField,
    updateAssignees,
    toggleLabel,
    handleDelete,
    handleSelectChange,
  };
}
