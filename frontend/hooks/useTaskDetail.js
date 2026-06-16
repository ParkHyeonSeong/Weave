import { useState, useEffect, useCallback, useRef } from 'react';
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
  // 낙관적 변경의 백그라운드 재동기화 순번. 늦게 도착한 응답이 더 최신 변경을 덮어쓰지 않도록 가드한다.
  const resyncSeq = useRef(0);

  // silent=true: 변경 저장 후 백그라운드 재동기화용. 스켈레톤/에러로 패널을 갈아끼우지 않아
  // 인라인 편집(서브담당자 멀티선택 등) 중 열린 드롭다운/포커스가 유지된다.
  // seq: 전달 시, 응답 도착 시점에 더 최신 재동기화가 시작됐다면(seq != 현재) 결과를 폐기한다.
  const fetchTask = useCallback(async ({ silent = false, seq } = {}) => {
    if (!branchId || !taskId) return;
    if (!silent) {
      setLoading(true);
      setError(null);
    }
    try {
      const res = await axios.get(`/branches/${branchId}/tasks/${taskId}`);
      if (seq !== undefined && seq !== resyncSeq.current) return; // 더 최신 재동기화에 추월됨 — 폐기
      if (res.data.status) {
        setTask(res.data.task);
      } else if (!silent) {
        setError(res.data.message || 'UNKNOWN_ERROR');
      }
    } catch {
      if (!silent) setError('NETWORK_ERROR');
    }
    if (!silent) setLoading(false);
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
    // 낙관적 반영: 패널 재로딩 없이 즉시 체크 상태를 갱신해 드롭다운을 연 채로 연속 선택할 수 있고,
    // 직전 선택이 재동기화 전에 유실되는 레이스(빠르게 여러 명 체크)도 막는다. members로 username 등 보강.
    const enrich = (id, role) => ({ ...(members.find((m) => m.user_id === id) || {}), user_id: id, role });
    const optimistic = [
      ...(mainId ? [enrich(mainId, 'main')] : []),
      ...subIds.map((id) => enrich(id, 'sub')),
    ];
    const seq = ++resyncSeq.current; // 이 변경이 최신임을 표시 — 늦게 온 이전 재동기화는 폐기됨
    setTask((prev) => (prev ? { ...prev, assignees: optimistic } : prev));
    try {
      const res = await axios.patch(`/branches/${branchId}/tasks/${task.task_id}`, {
        assignees: { main: mainId || null, sub: subIds },
      });
      // 성공/실패 모두 서버 상태로 조용히 동기화 (실패 시 낙관적 반영이 서버값으로 롤백됨)
      await fetchTask({ silent: true, seq });
      if (res.data.status) {
        window.dispatchEvent(new Event('task:updated'));
      }
    } catch {
      await fetchTask({ silent: true, seq });
    }
  };

  // 라벨 토글
  const toggleLabel = async (labelId) => {
    if (!task) return;
    const currentIds = (task.labels || []).map((l) => l.label_id);
    const newIds = currentIds.includes(labelId)
      ? currentIds.filter((id) => id !== labelId)
      : [...currentIds, labelId];
    // 낙관적 반영: 패널 재로딩 없이 즉시 칩을 추가/제거해 라벨 드롭다운을 연 채로 연속 토글할 수 있고,
    // 직전 토글이 재동기화 전에 유실되는 레이스도 막는다. labels(전체)에서 라벨 객체를 보강.
    const optimistic = newIds.map((id) => labels.find((l) => l.label_id === id)).filter(Boolean);
    const seq = ++resyncSeq.current;
    setTask((prev) => (prev ? { ...prev, labels: optimistic } : prev));
    try {
      const res = await axios.patch(`/branches/${branchId}/tasks/${task.task_id}`, { label_ids: newIds });
      await fetchTask({ silent: true, seq });
      if (res.data.status) {
        window.dispatchEvent(new Event('task:updated'));
      }
    } catch {
      await fetchTask({ silent: true, seq });
    }
  };

  // 라벨 생성 후 태스크에 할당
  const createLabel = async (labelName, color) => {
    if (!task || !labelName.trim()) return;
    try {
      const body = { label_name: labelName.trim() };
      if (color) body.color = color;
      const res = await axios.post(`/branches/${branchId}/labels`, body);
      if (res.data.status) {
        const newLabelId = res.data.label_id;
        await fetchOptions();
        const currentIds = (task.labels || []).map((l) => l.label_id);
        const patchRes = await axios.patch(`/branches/${branchId}/tasks/${task.task_id}`, {
          label_ids: [...currentIds, newLabelId],
        });
        if (patchRes.data.status) {
          // 생성 직후 다른 라벨을 빠르게 토글하는 경우를 대비해 toggleLabel/updateAssignees와 같은 seq 규약에 합류
          const seq = ++resyncSeq.current;
          await fetchTask({ silent: true, seq });
          window.dispatchEvent(new Event('task:updated'));
        }
      }
    } catch {}
  };

  // 라벨 수정 (색상 변경 등)
  const updateLabel = async (labelId, updates) => {
    try {
      const res = await axios.patch(`/branches/${branchId}/labels/${labelId}`, updates);
      if (res.data.status) {
        await fetchOptions();
        fetchTask({ silent: true });
        window.dispatchEvent(new Event('task:updated'));
      }
    } catch {}
  };

  // 브랜치에서 라벨 삭제
  const deleteLabel = async (labelId) => {
    try {
      const res = await axios.delete(`/branches/${branchId}/labels/${labelId}`);
      if (res.data.status) {
        await fetchOptions();
        fetchTask({ silent: true });
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
    createLabel,
    updateLabel,
    deleteLabel,
    handleDelete,
    handleSelectChange,
  };
}
