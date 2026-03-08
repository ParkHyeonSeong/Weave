import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import AdminLayout from '@/components/Admin/AdminLayout';
import { axios } from '@/library/_axios';
import { Shield, UserCheck, UserX, UserPlus, Bot } from 'lucide-react';
import Alert from '@/components/modal/Alert';
import AddMember from '@/components/modal/AddMember';

export default function AdminPage() {
  const router = useRouter();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [myUserId, setMyUserId] = useState(null);
  const [showAddMember, setShowAddMember] = useState(false);

  // AI Config 상태
  const [aiProvider, setAiProvider] = useState('anthropic');
  const [aiApiKey, setAiApiKey] = useState('');
  const [aiModel, setAiModel] = useState('');
  const [aiKeyPlaceholder, setAiKeyPlaceholder] = useState('');
  const [aiSaving, setAiSaving] = useState(false);

  // Alert 상태
  const [alertOpen, setAlertOpen] = useState(false);
  const [alertTitle, setAlertTitle] = useState('');
  const [alertMessage, setAlertMessage] = useState('');

  const showAlert = (title, message) => {
    setAlertTitle(title);
    setAlertMessage(message);
    setAlertOpen(true);
  };

  // 권한 확인 + 사용자 목록 로드
  useEffect(() => {
    try {
      const profile = JSON.parse(sessionStorage.getItem('profile') || '{}');
      if (profile.role !== 'admin') {
        router.replace('/');
        return;
      }
      setMyUserId(profile.user_id);
    } catch {
      router.replace('/');
      return;
    }
    fetchUsers();
    fetchAiConfig();
  }, []);

  // 멤버 추가 후 목록 갱신
  useEffect(() => {
    const handleRefresh = () => fetchUsers();
    window.addEventListener('member:created', handleRefresh);
    return () => window.removeEventListener('member:created', handleRefresh);
  }, []);

  const fetchUsers = async () => {
    try {
      const res = await axios.get('/admin/users');
      if (res.data.status) {
        setUsers(res.data.users);
      }
    } catch {
      showAlert('Error', 'Failed to load users.');
    } finally {
      setLoading(false);
    }
  };

  const fetchAiConfig = async () => {
    try {
      const res = await axios.get('/ai/config');
      if (res.data.status && res.data.config) {
        const cfg = res.data.config;
        setAiProvider(cfg.provider || 'anthropic');
        setAiModel(cfg.model || '');
        if (cfg.api_key) {
          setAiApiKey('');
          setAiKeyPlaceholder(cfg.api_key);
        }
      }
    } catch {
      // Config not set yet, ignore
    }
  };

  const handleSaveAiConfig = async () => {
    if (!aiApiKey && !aiKeyPlaceholder) {
      showAlert('Error', 'Please enter an API key.');
      return;
    }
    setAiSaving(true);
    try {
      const defaultModel = aiProvider === 'anthropic' ? 'claude-sonnet-4-20250514' : 'gpt-4o';
      const body = { provider: aiProvider, model: aiModel || defaultModel };
      if (aiApiKey) {
        body.api_key = aiApiKey;
      }
      const res = await axios.put('/ai/config', body);
      if (res.data.status) {
        showAlert('Success', 'AI configuration saved successfully.');
        fetchAiConfig();
      } else {
        showAlert('Error', res.data.message || 'Failed to save configuration.');
      }
    } catch {
      showAlert('Error', 'Failed to save AI configuration.');
    } finally {
      setAiSaving(false);
    }
  };

  const handleApprove = async (userId) => {
    try {
      const res = await axios.patch(`/admin/users/${userId}/status`, { status: 'active' });
      if (res.data.status) {
        fetchUsers();
      } else {
        showAlert('Error', res.data.message);
      }
    } catch {
      showAlert('Error', 'Failed to approve user.');
    }
  };

  const handleReject = async (userId) => {
    try {
      const res = await axios.patch(`/admin/users/${userId}/status`, { status: 'rejected' });
      if (res.data.status) {
        fetchUsers();
      } else {
        showAlert('Error', res.data.message);
      }
    } catch {
      showAlert('Error', 'Failed to reject user.');
    }
  };

  const handleRoleChange = async (userId, newRole) => {
    try {
      const res = await axios.patch(`/admin/users/${userId}/role`, { role: newRole });
      if (res.data.status) {
        fetchUsers();
      } else {
        const messages = {
          'CANNOT_CHANGE_OWN_ROLE': 'You cannot change your own role.',
          'USER_NOT_FOUND': 'User not found.',
        };
        showAlert('Error', messages[res.data.message] || res.data.message);
      }
    } catch {
      showAlert('Error', 'Failed to change role.');
    }
  };

  const pendingUsers = users.filter(u => u.status === 'pending');
  const activeUsers = users.filter(u => u.status !== 'pending');

  const getStatusClass = (status) => {
    switch (status) {
      case 'active': return 'Admin__Badge--active';
      case 'pending': return 'Admin__Badge--pending';
      case 'rejected': return 'Admin__Badge--rejected';
      default: return '';
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return '-';
    return new Date(dateStr).toLocaleDateString('ko-KR', {
      year: 'numeric', month: '2-digit', day: '2-digit',
    });
  };

  if (loading) return null;

  return (
    <AdminLayout>
      <div className="Admin">
        <div className="Admin__Header">
          <Shield size={20} />
          <h1 className="Admin__Title">Admin Settings</h1>
        </div>

        <div className="Admin__Section">
          <div className="Admin__SectionHeader">
            <h2 className="Admin__SectionTitle">Member Management</h2>
            <button className="Admin__AddBtn" onClick={() => setShowAddMember(true)}>
              <UserPlus size={14} />
              Add Member
            </button>
          </div>

          {/* 승인 대기 섹션 */}
          {pendingUsers.length > 0 && (
            <div className="Admin__Subsection">
              <h3 className="Admin__SubsectionTitle">
                Pending Approval ({pendingUsers.length})
              </h3>
              <table className="Admin__Table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Registered</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {pendingUsers.map(user => (
                    <tr key={user.user_id}>
                      <td>{user.username}</td>
                      <td>{user.email}</td>
                      <td>{formatDate(user.created_at)}</td>
                      <td className="Admin__Actions">
                        <button
                          className="Admin__ApproveBtn"
                          onClick={() => handleApprove(user.user_id)}
                        >
                          <UserCheck size={14} />
                          Approve
                        </button>
                        <button
                          className="Admin__RejectBtn"
                          onClick={() => handleReject(user.user_id)}
                        >
                          <UserX size={14} />
                          Reject
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* 전체 멤버 섹션 */}
          <div className="Admin__Subsection">
            <h3 className="Admin__SubsectionTitle">All Members ({activeUsers.length})</h3>
            <table className="Admin__Table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Joined</th>
                </tr>
              </thead>
              <tbody>
                {activeUsers.map(user => {
                  const isSelf = user.user_id === myUserId;
                  return (
                    <tr key={user.user_id}>
                      <td>{user.username}</td>
                      <td>{user.email}</td>
                      <td>
                        {isSelf ? (
                          <span className="Admin__RoleText">{user.role}</span>
                        ) : (
                          <select
                            className="Admin__RoleSelect"
                            value={user.role}
                            onChange={(e) => handleRoleChange(user.user_id, e.target.value)}
                          >
                            <option value="member">member</option>
                            <option value="admin">admin</option>
                          </select>
                        )}
                      </td>
                      <td>
                        <span className={`Admin__Badge ${getStatusClass(user.status)}`}>
                          {user.status}
                        </span>
                      </td>
                      <td>{formatDate(user.created_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        <div className="Admin__Section">
          <div className="Admin__SectionHeader">
            <h2 className="Admin__SectionTitle">
              <Bot size={16} style={{ marginRight: 6, verticalAlign: -2 }} />
              AI Configuration
            </h2>
          </div>

          <div className="Admin__Form">
            <div className="Admin__Field">
              <label className="Admin__Label">Provider</label>
              <select
                className="Admin__Select"
                value={aiProvider}
                onChange={(e) => setAiProvider(e.target.value)}
              >
                <option value="anthropic">Anthropic</option>
                <option value="openai">OpenAI</option>
              </select>
            </div>

            <div className="Admin__Field">
              <label className="Admin__Label">API Key</label>
              <input
                className="Admin__Input"
                type="password"
                value={aiApiKey}
                placeholder={aiKeyPlaceholder || 'Enter API key'}
                onChange={(e) => setAiApiKey(e.target.value)}
                onFocus={() => setAiApiKey('')}
              />
            </div>

            <div className="Admin__Field">
              <label className="Admin__Label">Model</label>
              <input
                className="Admin__Input"
                type="text"
                value={aiModel}
                placeholder={aiProvider === 'anthropic' ? 'claude-sonnet-4-20250514' : 'gpt-4o'}
                onChange={(e) => setAiModel(e.target.value)}
              />
            </div>

            <button
              className="Admin__SaveBtn"
              onClick={handleSaveAiConfig}
              disabled={aiSaving}
            >
              {aiSaving ? 'Saving...' : 'Save Configuration'}
            </button>
          </div>
        </div>
      </div>

      {showAddMember && (
        <AddMember onClose={() => setShowAddMember(false)} />
      )}

      <Alert
        isOpen={alertOpen}
        title={alertTitle}
        contents={alertMessage}
        onClose={() => setAlertOpen(false)}
      />
    </AdminLayout>
  );
}
