import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/router';
import { axios } from '@/library/_axios';
import { UserPlus, X, Search, LogOut } from 'lucide-react';
import CustomSelect from '@/components/common/CustomSelect';
import Avatar from '@/components/common/Avatar';
import { showToast } from '@/components/Layout/Toast';

const ROLE_OPTIONS = [
  { value: 'member', label: 'Member' },
  { value: 'admin', label: 'Admin' },
];

function readMyUserId() {
  try {
    const p = JSON.parse(sessionStorage.getItem('profile') || '{}');
    return p.user_id || null;
  } catch { return null; }
}

/**
 * 멤버 관리 본문 (모달 셸 없이 재사용 가능).
 * - ScrumMembersModal: 모달 백드롭/헤더/닫기 안에서 이걸 감쌈
 * - ScrumSettings Members 탭: 셸 없이 직접 렌더
 * props:
 *  - boardId
 *  - myRole ('admin' | 'member')
 *  - onChanged: 멤버 변경 후 부모 보드 갱신 콜백
 *  - onLeave: (선택) 보드 나간 뒤 처리. 미지정 시 router.push('/scrum')
 */
export default function ScrumMembersPanel({ boardId, myRole, onChanged, onLeave }) {
  const router = useRouter();
  const [members, setMembers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [confirmRemove, setConfirmRemove] = useState(null); // { user_id, username }

  const [showInvite, setShowInvite] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const searchTimerRef = useRef(null);
  const inviteRef = useRef(null);

  const myUserId = readMyUserId();
  const isAdmin = myRole === 'admin';

  const fetchMembers = useCallback(async () => {
    if (!boardId) return;
    try {
      const res = await axios.get(`/scrum/${boardId}/members`);
      if (res.data.status) setMembers(res.data.members);
    } catch {}
    setLoading(false);
  }, [boardId]);

  useEffect(() => { fetchMembers(); }, [fetchMembers]);

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

  const handleSearchChange = (value) => {
    setSearchQuery(value);
    if (searchTimerRef.current) clearTimeout(searchTimerRef.current);
    if (!value.trim()) {
      setSearchResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    searchTimerRef.current = setTimeout(async () => {
      try {
        const res = await axios.get(
          `/scrum/${boardId}/members/search?q=${encodeURIComponent(value)}`,
        );
        if (res.data.status) setSearchResults(res.data.users);
      } catch {}
      setSearching(false);
    }, 300);
  };

  const afterMutation = useCallback(async () => {
    await fetchMembers();
    if (onChanged) onChanged();
  }, [fetchMembers, onChanged]);

  const handleInvite = async (userId) => {
    try {
      const res = await axios.post(`/scrum/${boardId}/members`, {
        user_id: userId, role: 'member',
      });
      if (res.data.status) {
        setSearchResults((prev) => prev.filter((u) => u.user_id !== userId));
        await afterMutation();
      } else {
        showToast(`초대 실패: ${res.data.message}`, 'error');
      }
    } catch {
      showToast('초대 실패', 'error');
    }
  };

  const handleRoleChange = async (userId, newRole) => {
    try {
      const res = await axios.patch(`/scrum/${boardId}/members/${userId}`, {
        role: newRole,
      });
      if (res.data.status) await afterMutation();
      else if (res.data.message === 'LAST_ADMIN') {
        showToast('마지막 admin은 변경할 수 없습니다', 'error');
      } else {
        showToast(`변경 실패: ${res.data.message}`, 'error');
      }
    } catch {
      showToast('변경 실패', 'error');
    }
  };

  const handleRemove = async (userId) => {
    try {
      const res = await axios.delete(`/scrum/${boardId}/members/${userId}`);
      if (res.data.status) {
        await afterMutation();
      } else if (res.data.message === 'LAST_ADMIN') {
        showToast('마지막 admin은 제거할 수 없습니다', 'error');
      } else {
        showToast(`제거 실패: ${res.data.message}`, 'error');
      }
    } catch {
      showToast('제거 실패', 'error');
    }
    setConfirmRemove(null);
  };

  const handleLeave = async () => {
    if (!myUserId) return;
    if (!window.confirm('이 보드에서 나가시겠어요?')) return;
    try {
      const res = await axios.delete(`/scrum/${boardId}/members/${myUserId}`);
      if (res.data.status) {
        if (onLeave) onLeave();
        else router.push('/scrum');
      } else if (res.data.message === 'LAST_ADMIN') {
        alert('다른 admin을 먼저 지정하세요');
      } else {
        showToast(`나가기 실패: ${res.data.message}`, 'error');
      }
    } catch {
      showToast('나가기 실패', 'error');
    }
  };

  const adminCount = members.filter((m) => m.role === 'admin').length;
  const myRow = members.find((m) => m.user_id === myUserId);

  return (
    <>
      <div className="ScrumMembers__Body">
        {isAdmin && (
          <div className="ScrumMembers__Actions" ref={inviteRef}>
            <button
              type="button"
              className="ScrumMembers__InviteBtn"
              onClick={() => setShowInvite((v) => !v)}
            >
              <UserPlus size={14} />
              멤버 초대
            </button>

            {showInvite && (
              <div className="ScrumMembers__InviteDropdown">
                <div className="ScrumMembers__SearchWrap">
                  <Search size={14} className="ScrumMembers__SearchIcon" />
                  <input
                    className="ScrumMembers__SearchInput"
                    placeholder="이름 또는 이메일로 검색…"
                    value={searchQuery}
                    onChange={(e) => handleSearchChange(e.target.value)}
                    autoFocus
                  />
                </div>
                <div className="ScrumMembers__SearchResults">
                  {searching && (
                    <div className="ScrumMembers__SearchEmpty">검색 중…</div>
                  )}
                  {!searching && searchQuery && searchResults.length === 0 && (
                    <div className="ScrumMembers__SearchEmpty">결과 없음</div>
                  )}
                  {searchResults.map((u) => (
                    <button
                      key={u.user_id}
                      type="button"
                      className="ScrumMembers__SearchItem"
                      onClick={() => handleInvite(u.user_id)}
                    >
                      <Avatar user={u} size={30} className="ScrumMembers__SearchItemAvatar" />
                      <div className="ScrumMembers__SearchItemInfo">
                        <span className="ScrumMembers__SearchItemName">{u.username}</span>
                        <span className="ScrumMembers__SearchItemEmail">{u.email}</span>
                      </div>
                      <UserPlus size={14} />
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {loading ? (
          <div className="ScrumMembers__Loading">불러오는 중…</div>
        ) : (
          <div className="ScrumMembers__List">
            {members.map((member) => {
              const isSelf = member.user_id === myUserId;
              const isLastAdminRow = member.role === 'admin' && adminCount <= 1;
              // 마지막 admin row는 누구에게도 변경/제거 불가 (백엔드 가드와 일치)
              const canManage = isAdmin && !isLastAdminRow;
              return (
                <div key={member.user_id} className="ScrumMembers__Row">
                  <Avatar user={member} size={30} className="ScrumMembers__Avatar" />
                  <div className="ScrumMembers__Info">
                    <span className="ScrumMembers__Name">
                      {member.username}
                      {isSelf && <em className="ScrumMembers__You">나</em>}
                    </span>
                    <span className="ScrumMembers__Email">{member.email}</span>
                  </div>
                  <span className="ScrumMembers__RoleCol">
                    {canManage ? (
                      <CustomSelect
                        value={member.role}
                        options={ROLE_OPTIONS}
                        onChange={(val) => handleRoleChange(member.user_id, val)}
                        size="sm"
                      />
                    ) : (
                      <span
                        className="ScrumMembers__RoleBadge"
                        title={isLastAdminRow ? '마지막 admin은 변경 불가' : ''}
                      >
                        {member.role}
                      </span>
                    )}
                  </span>
                  {isAdmin && (
                    <span className="ScrumMembers__ActionCol">
                      {canManage && (
                        confirmRemove?.user_id === member.user_id ? (
                          <span className="ScrumMembers__ConfirmInline">
                            <button
                              type="button"
                              className="ScrumMembers__ConfirmYes"
                              onClick={() => handleRemove(member.user_id)}
                            >
                              제거
                            </button>
                            <button
                              type="button"
                              className="ScrumMembers__ConfirmNo"
                              onClick={() => setConfirmRemove(null)}
                            >
                              취소
                            </button>
                          </span>
                        ) : (
                          <button
                            type="button"
                            className="ScrumMembers__RemoveBtn"
                            onClick={() => setConfirmRemove({
                              user_id: member.user_id,
                              username: member.username,
                            })}
                            title="멤버 제거"
                          >
                            <X size={14} />
                          </button>
                        )
                      )}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {myRow && (
        <footer className="ScrumMembers__Foot">
          <button
            type="button"
            className="ScrumMembers__LeaveBtn"
            onClick={handleLeave}
          >
            <LogOut size={14} />
            보드 나가기
          </button>
        </footer>
      )}
    </>
  );
}
