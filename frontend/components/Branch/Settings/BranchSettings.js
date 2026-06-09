import { useState } from 'react';
import { Settings, Users, Layers, GitBranch } from 'lucide-react';
import SettingsGeneral from './SettingsGeneral';
import SettingsMembers from './SettingsMembers';
import SettingsTaskTypes from './SettingsTaskTypes';
import SettingsWorkflow from './SettingsWorkflow';

const SUB_TABS = [
  { key: 'general', label: 'General', icon: Settings },
  { key: 'members', label: 'Members', icon: Users },
  { key: 'task_types', label: 'Task Types', icon: Layers },
  { key: 'workflow', label: 'Workflow', icon: GitBranch },
];

export default function BranchSettings({ branchId, branch, myRole, onBranchUpdated }) {
  const [activeSubTab, setActiveSubTab] = useState('general');
  const isAdmin = myRole === 'admin';

  return (
    <div className="BranchSettings">
      {/* 서브탭 */}
      <div className="BranchSettings__SubTabs">
        {SUB_TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            className={`BranchSettings__SubTab ${activeSubTab === key ? 'BranchSettings__SubTab--active' : ''}`}
            onClick={() => setActiveSubTab(key)}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      {/* 서브탭 콘텐츠 */}
      <div className="BranchSettings__Content">
        {activeSubTab === 'general' && (
          <SettingsGeneral
            key={branchId}
            branchId={branchId}
            branch={branch}
            isAdmin={isAdmin}
            onUpdated={onBranchUpdated}
          />
        )}
        {activeSubTab === 'members' && (
          <SettingsMembers branchId={branchId} isAdmin={isAdmin} />
        )}
        {activeSubTab === 'task_types' && (
          <SettingsTaskTypes branchId={branchId} isAdmin={isAdmin} />
        )}
        {activeSubTab === 'workflow' && (
          <SettingsWorkflow branchId={branchId} isAdmin={isAdmin} />
        )}
      </div>
    </div>
  );
}
