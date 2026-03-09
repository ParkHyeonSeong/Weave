import { useState, useEffect, useRef } from 'react';
import { axios } from '@/library/_axios';
import { ChevronDown, Workflow } from 'lucide-react';
import FlowCanvas from './FlowCanvas';

export default function EpicFlow({ branchId, workflowStatuses, onSelectTask }) {
  const [epics, setEpics] = useState([]);
  const [selectedEpicId, setSelectedEpicId] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [dependencies, setDependencies] = useState([]);
  const [flowPositions, setFlowPositions] = useState({});
  const [loading, setLoading] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef(null);

  // 드롭다운 바깥 클릭 시 닫기
  useEffect(() => {
    if (!dropdownOpen) return;
    const handleClick = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [dropdownOpen]);

  // 에픽 목록 로드
  useEffect(() => {
    fetchEpics();
  }, [branchId]);

  const fetchEpics = async () => {
    try {
      const res = await axios.get(`/branches/${branchId}/epics`);
      if (res.data.status) setEpics(res.data.epics.filter((e) => e.status !== 'done'));
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

  const selectedEpic = epics.find((e) => e.epic_id === selectedEpicId);

  return (
    <div className="EpicFlow">
      {/* 헤더 */}
      <div className="EpicFlow__Header">
        <div className="EpicFlow__SelectorWrap" ref={dropdownRef}>
          <button
            className="EpicFlow__Selector"
            onClick={() => setDropdownOpen(!dropdownOpen)}
          >
            {selectedEpic ? (
              <>
                <span
                  className="EpicFlow__EpicDot"
                  style={{ backgroundColor: selectedEpic.color || '#5E6AD2' }}
                />
                <span>{selectedEpic.epic_name}</span>
              </>
            ) : (
              <span className="EpicFlow__SelectorPlaceholder">Select an epic</span>
            )}
            <ChevronDown size={14} />
          </button>
          {dropdownOpen && (
            <div className="EpicFlow__Dropdown">
              {epics.map((epic) => (
                <button
                  key={epic.epic_id}
                  className={`EpicFlow__DropdownItem ${epic.epic_id === selectedEpicId ? 'EpicFlow__DropdownItem--active' : ''}`}
                  onClick={() => { setSelectedEpicId(epic.epic_id); setDropdownOpen(false); }}
                >
                  <span
                    className="EpicFlow__EpicDot"
                    style={{ backgroundColor: epic.color || '#5E6AD2' }}
                  />
                  <span>{epic.epic_name}</span>
                  <span className="EpicFlow__TaskCount">{epic.task_count} tasks</span>
                </button>
              ))}
              {epics.length === 0 && (
                <div className="EpicFlow__DropdownEmpty">No epics</div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 컨텐츠 */}
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
  );
}
