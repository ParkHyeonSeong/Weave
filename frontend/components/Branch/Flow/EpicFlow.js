import { useState, useEffect } from 'react';
import { axios } from '@/library/_axios';
import { Workflow } from 'lucide-react';
import FlowCanvas from './FlowCanvas';

export default function EpicFlow({ branchId, workflowStatuses, onSelectTask }) {
  const [epics, setEpics] = useState([]);
  const [selectedEpicId, setSelectedEpicId] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [dependencies, setDependencies] = useState([]);
  const [flowPositions, setFlowPositions] = useState({});
  const [loading, setLoading] = useState(false);

  // 에픽 목록 로드
  useEffect(() => {
    fetchEpics();
  }, [branchId]);

  const fetchEpics = async () => {
    try {
      const res = await axios.get(`/branches/${branchId}/epics`);
      if (res.data.status) {
        const filtered = res.data.epics.filter((e) => e.status !== 'done');
        setEpics(filtered);
        // 첫 에픽 자동 선택
        if (filtered.length > 0 && !selectedEpicId) {
          setSelectedEpicId(filtered[0].epic_id);
        }
      }
    } catch {}
  };

  // 에픽 선택 시 데이터 로드
  useEffect(() => {
    if (!selectedEpicId) return;
    fetchFlowData();
  }, [selectedEpicId]);

  const fetchFlowData = async () => {
    setLoading(true);
    try {
      const [taskRes, depRes, epicRes] = await Promise.all([
        axios.get(`/branches/${branchId}/epics/${selectedEpicId}/tasks`),
        axios.get(`/branches/${branchId}/dependencies/epic/${selectedEpicId}`),
        axios.get(`/branches/${branchId}/epics/${selectedEpicId}`),
      ]);
      if (taskRes.data.status) setTasks(taskRes.data.tasks);
      if (depRes.data.status) setDependencies(depRes.data.dependencies);
      if (epicRes.data.status) {
        setFlowPositions(epicRes.data.epic?.flow_positions || {});
      }
    } catch {}
    setLoading(false);
  };

  return (
    <div className="EpicFlow">
      {/* 사이드바 */}
      <div className="EpicFlow__Sidebar">
        {epics.map((epic) => (
          <button
            key={epic.epic_id}
            className={`EpicFlow__EpicItem ${epic.epic_id === selectedEpicId ? 'EpicFlow__EpicItem--active' : ''}`}
            onClick={() => setSelectedEpicId(epic.epic_id)}
          >
            <span
              className="EpicFlow__EpicDot"
              style={{ backgroundColor: epic.color || '#5E6AD2' }}
            />
            <span className="EpicFlow__EpicName">{epic.epic_name}</span>
            <span className="EpicFlow__TaskCount">{epic.task_count}</span>
          </button>
        ))}
        {epics.length === 0 && (
          <div className="EpicFlow__SidebarEmpty">No epics</div>
        )}
      </div>

      {/* 컨텐츠 */}
      <div className="EpicFlow__Content">
        {!selectedEpicId ? (
          <div className="EpicFlow__Empty">
            <Workflow size={40} strokeWidth={1} />
            <p>Select an epic to view its task flow</p>
          </div>
        ) : loading ? (
          <div className="EpicFlow__Empty">
            <p>Loading...</p>
          </div>
        ) : tasks.length === 0 ? (
          <div className="EpicFlow__Empty">
            <Workflow size={40} strokeWidth={1} />
            <p>No tasks in this epic</p>
            <span className="EpicFlow__EmptySub">Add tasks from the Tasks tab</span>
          </div>
        ) : (
          <FlowCanvas
            key={selectedEpicId}
            branchId={branchId}
            epicId={selectedEpicId}
            tasks={tasks}
            dependencies={dependencies}
            flowPositions={flowPositions}
            workflowStatuses={workflowStatuses}
            onSelectTask={onSelectTask}
            onDataChange={fetchFlowData}
          />
        )}
      </div>
    </div>
  );
}
