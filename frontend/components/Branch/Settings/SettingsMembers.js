import { useState, useEffect, useRef } from 'react';
import { axios } from '@/library/_axios';
import { UserPlus, X, Search } from 'lucide-react';
import CustomSelect from '@/components/common/CustomSelect';

const roleOptions = [
  { value: 'admin', label: 'Admin' },
  { value: 'member', label: 'Member' },
];

export default function SettingsMembers({ branchId, isAdmin }) {
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);

  // 초대 검색
  const [showInvite, setShowInvite] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const searchTimerRef = useRef(null);
  const inviteRef = useRef(null);

  useEffect(() => {
    fetchMembers();
  }, [branchId]);

  // 외부 클릭으로 초대 드롭다운 닫기
  useEffect(() => {
    if (!showInvite) return;
    const handleClick = (e) => {
      if (inviteRef.current && !inviteRef.current.contains(e.target)) {
        setShowInvite(false);
        setSearchQuery('');
        setSearchResults([]);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showInvite]);

  const fetchMembers = async () => {
    try {
      const res = await axios.get(`/branches/${branchId}/members`);
      if (res.data.status) setMembers(res.data.members);
    } catch {}
    setLoading(false);
  };

  // 검색 (debounce)
  const handleSearchChange = (value) => {
    setSearchQuery(value);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (!value.trim()) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    searchTimerRef.current = setTimeout(async () => {
      try {
        const res = await axios.get(`/branches/${branchId}/members/search?q=${encodeURIComponent(value)}`);
        if (res.data.status) setSearchResults(res.data.users);
      } catch {}
      setSearching(false);
    }, 300);
  };

  // 멤버 초대
  const handleInvite = async (userId) => {
    try {
      const res = await axios.post(`/branches/${branchId}/members`, { user_id: userId, role: 'member' });
      if (res.data.status) {
        fetchMembers();
        // 검색 결과에서 제거
        setSearchResults((prev) => prev.filter((u) => u.user_id !== userId));
      }
    } catch {}
  };

  // 역할 변경
  const handleRoleChange = async (userId, newRole) => {
    try {
      const res = await axios.patch(`/branches/${branchId}/members/${userId}`, { role: newRole });
      if (res.data.status) fetchMembers();
    } catch {}
  };

  // 멤버 제거
  const handleRemove = async (userId) => {
    try {
      const res = await axios.delete(`/branches/${branchId}/members/${userId}`);
      if (res.data.status) fetchMembers();
    } catch {}
  };

  if (loading) return null;

  return (
    <div className="SettingsMembers">
      {/* 헤더 */}
      {isAdmin && (
        <div className="SettingsMembers__Actions" ref={inviteRef}>
          <button
            className="SettingsMembers__InviteBtn"
            onClick={() => setShowInvite(!showInvite)}
          >
            <UserPlus size={14} />
            Invite Member
          </button>

          {showInvite && (
            <div className="SettingsMembers__InviteDropdown">
              <div className="SettingsMembers__SearchWrap">
                <Search size={14} className="SettingsMembers__SearchIcon" />
                <input
                  className="SettingsMembers__SearchInput"
                  placeholder="Search by name or email..."
                  value={searchQuery}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  autoFocus
                />
              </div>
              <div className="SettingsMembers__SearchResults">
                {searching && (
                  <div className="SettingsMembers__SearchEmpty">Searching...</div>
                )}
                {!searching && searchQuery && searchResults.length === 0 && (
                  <div className="SettingsMembers__SearchEmpty">No users found</div>
                )}
                {searchResults.map((user) => (
                  <button
                    key={user.user_id}
                    className="SettingsMembers__SearchItem"
                    onClick={() => handleInvite(user.user_id)}
                  >
                    <div className="SettingsMembers__SearchItemInfo">
                      <span className="SettingsMembers__SearchItemName">{user.username}</span>
                      <span className="SettingsMembers__SearchItemEmail">{user.email}</span>
                    </div>
                    <UserPlus size={14} />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 멤버 테이블 */}
      <div className="SettingsMembers__Table">
        <div className="SettingsMembers__TableHeader">
          <span className="SettingsMembers__Col SettingsMembers__Col--name">Name</span>
          <span className="SettingsMembers__Col SettingsMembers__Col--email">Email</span>
          <span className="SettingsMembers__Col SettingsMembers__Col--role">Role</span>
          {isAdmin && <span className="SettingsMembers__Col SettingsMembers__Col--action" />}
        </div>
        {members.map((member) => (
          <div key={member.user_id} className="SettingsMembers__Row">
            <span className="SettingsMembers__Col SettingsMembers__Col--name">
              <span className="SettingsMembers__Avatar">
                {member.username?.charAt(0).toUpperCase()}
              </span>
              {member.username}
            </span>
            <span className="SettingsMembers__Col SettingsMembers__Col--email">
              {member.email}
            </span>
            <span className="SettingsMembers__Col SettingsMembers__Col--role">
              {isAdmin ? (
                <CustomSelect
                  value={member.role}
                  options={roleOptions}
                  onChange={(val) => handleRoleChange(member.user_id, val)}
                  size="sm"
                />
              ) : (
                <span className="SettingsMembers__RoleBadge">{member.role}</span>
              )}
            </span>
            {isAdmin && (
              <span className="SettingsMembers__Col SettingsMembers__Col--action">
                <button
                  className="SettingsMembers__RemoveBtn"
                  onClick={() => handleRemove(member.user_id)}
                  title="Remove member"
                >
                  <X size={14} />
                </button>
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
