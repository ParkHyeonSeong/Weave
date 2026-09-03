import { useState, useEffect, useRef } from 'react';
import { User, Mail, Lock, Eye, EyeOff, Camera, Trash2 } from 'lucide-react';
import { axios } from '@/library/_axios';
import Alert from '@/components/modal/Alert';
import ProfileTokens from '@/components/Profile/ProfileTokens';
import AppearanceSection from '@/components/Profile/AppearanceSection';
import Avatar from '@/components/common/Avatar';
import { AVATAR_COLORS } from '@/library/userAvatar';
import { getError } from '@/library/errorCode';
import { errorText } from '@/library/errorText';

// sessionStorage의 profile 객체에 변경분을 병합하고 헤더 동기화 이벤트 발생
function syncProfileSession(patch) {
  try {
    const profile = JSON.parse(sessionStorage.getItem('profile') || '{}');
    sessionStorage.setItem('profile', JSON.stringify({ ...profile, ...patch }));
  } catch {}
  window.dispatchEvent(new CustomEvent('profile:updated'));
}

export default function Profile() {
  // 프로필 정보
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [userId, setUserId] = useState(null);
  const [avatarColor, setAvatarColor] = useState(null);
  const [colorSaving, setColorSaving] = useState(false);
  const [avatarDeleting, setAvatarDeleting] = useState(false);
  const [loading, setLoading] = useState(true);

  // 이름 변경
  const [newUsername, setNewUsername] = useState('');
  const [usernameSaving, setUsernameSaving] = useState(false);

  // 비밀번호 변경
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrentPw, setShowCurrentPw] = useState(false);
  const [showNewPw, setShowNewPw] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);

  // 아바타 업로드
  const [avatarUploading, setAvatarUploading] = useState(false);
  const fileInputRef = useRef(null);

  // Alert
  const [alertOpen, setAlertOpen] = useState(false);
  const [alertTitle, setAlertTitle] = useState('');
  const [alertMessage, setAlertMessage] = useState('');

  const showAlert = (title, message) => {
    setAlertTitle(title);
    setAlertMessage(message);
    setAlertOpen(true);
  };

  // 프로필 로드
  useEffect(() => {
    fetchProfile();
  }, []);

  const fetchProfile = async () => {
    try {
      const res = await axios.get('/profile/me');
      if (res.data.status) {
        const user = res.data.user;
        setEmail(user.email);
        setUsername(user.username);
        setNewUsername(user.username);
        setAvatarUrl(user.avatar_url || '');
        setUserId(user.user_id ?? null);
        setAvatarColor(user.avatar_color || null);
        if (user.avatar_url) {
          sessionStorage.setItem('avatar_url', user.avatar_url);
        }
      }
    } catch {
      showAlert('Error', 'Failed to load profile.');
    } finally {
      setLoading(false);
    }
  };

  // 이름 변경
  const handleUsernameSubmit = async (e) => {
    e.preventDefault();
    if (usernameSaving) return;
    if (!newUsername.trim()) {
      showAlert('Error', 'Name must not be empty.');
      return;
    }
    if (newUsername === username) return;

    setUsernameSaving(true);
    try {
      const res = await axios.patch('/profile/username', { username: newUsername });
      if (res.data.status) {
        sessionStorage.setItem('profile', JSON.stringify(res.data.profile));
        setUsername(newUsername);
        window.dispatchEvent(new CustomEvent('profile:updated'));
        showAlert('Success', 'Name updated.');
      } else {
        const err = getError(res.data);
        const msg = errorText(err.code, err.category) ?? 'Failed to update name.';
        showAlert('Error', msg);
      }
    } catch {
      showAlert('Error', 'Failed to update name.');
    } finally {
      setUsernameSaving(false);
    }
  };

  // 비밀번호 변경
  const handlePasswordSubmit = async (e) => {
    e.preventDefault();
    if (passwordSaving) return;
    if (!currentPassword) {
      showAlert('Error', 'Please enter current password.');
      return;
    }
    if (newPassword.length < 8) {
      showAlert('Error', 'New password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      showAlert('Error', 'Passwords do not match.');
      return;
    }

    setPasswordSaving(true);
    try {
      const res = await axios.patch('/profile/password', {
        current_password: currentPassword,
        new_password: newPassword,
        confirm_password: confirmPassword,
      });
      if (res.data.status) {
        setCurrentPassword('');
        setNewPassword('');
        setConfirmPassword('');
        showAlert('Success', 'Password updated.');
      } else {
        const err = getError(res.data);
        let fallback = 'Failed to update password.';
        if (err.code === 'INVALID_CURRENT_PASSWORD') fallback = 'Current password is incorrect.';
        else if (err.code === 'PASSWORD_MISMATCH') fallback = 'New passwords do not match.';
        const msg = errorText(err.code, err.category) ?? fallback;
        showAlert('Error', msg);
      }
    } catch {
      showAlert('Error', 'Failed to update password.');
    } finally {
      setPasswordSaving(false);
    }
  };

  // 아바타 업로드
  const handleAvatarClick = () => {
    fileInputRef.current?.click();
  };

  const handleAvatarChange = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (!allowedTypes.includes(file.type)) {
      showAlert('Error', 'Only JPG, PNG, GIF, WebP images are allowed.');
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      showAlert('Error', 'File size must be less than 2MB.');
      return;
    }

    setAvatarUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await axios.post('/profile/avatar', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      if (res.data.status) {
        setAvatarUrl(res.data.avatar_url);
        sessionStorage.setItem('avatar_url', res.data.avatar_url);
        window.dispatchEvent(new CustomEvent('profile:updated'));
        showAlert('Success', 'Avatar updated.');
      } else {
        const err = getError(res.data);
        let fallback = 'Failed to upload avatar.';
        if (err.code === 'INVALID_FILE_TYPE') fallback = 'Invalid file type.';
        else if (err.code === 'FILE_TOO_LARGE') fallback = 'File size must be less than 2MB.';
        const msg = errorText(err.code, err.category) ?? fallback;
        showAlert('Error', msg);
      }
    } catch {
      showAlert('Error', 'Failed to upload avatar.');
    } finally {
      setAvatarUploading(false);
      e.target.value = '';
    }
  };

  // 아바타 사진 제거
  const handleAvatarDelete = async () => {
    if (avatarDeleting) return;
    setAvatarDeleting(true);
    try {
      const res = await axios.delete('/profile/avatar');
      if (res.data.status) {
        setAvatarUrl('');
        sessionStorage.removeItem('avatar_url');
        // avatar_url은 별도 sessionStorage 키 — 이벤트로 헤더만 갱신
        window.dispatchEvent(new CustomEvent('profile:updated'));
      } else {
        const err = getError(res.data);
        const msg = errorText(err.code, err.category) ?? 'Failed to remove avatar.';
        showAlert('Error', msg);
      }
    } catch {
      showAlert('Error', 'Failed to remove avatar.');
    } finally {
      setAvatarDeleting(false);
    }
  };

  // 아바타 색상 선택 (null = 자동 해시 색)
  const handleColorSelect = async (color) => {
    if (colorSaving || color === avatarColor) return;
    setColorSaving(true);
    const prev = avatarColor;
    setAvatarColor(color); // 즉시 미리보기 반영
    try {
      const res = await axios.patch('/profile/avatar-color', { color });
      if (res.data.status) {
        const saved = res.data.avatar_color ?? null;
        setAvatarColor(saved);
        syncProfileSession({ avatar_color: saved });
      } else {
        setAvatarColor(prev);
        const err = getError(res.data);
        const msg = errorText(err.code, err.category) ?? 'Failed to update avatar color.';
        showAlert('Error', msg);
      }
    } catch {
      setAvatarColor(prev);
      showAlert('Error', 'Failed to update avatar color.');
    } finally {
      setColorSaving(false);
    }
  };

  if (loading) return null;

  return (
    <div className="Profile">
      <h1 className="Profile__Title">Profile Settings</h1>

      {/* 아바타 섹션 */}
      <div className="Profile__Section">
        <h2 className="Profile__SectionTitle">Avatar</h2>
        <div className="Profile__AvatarArea">
          <div className="Profile__AvatarPreview" onClick={handleAvatarClick}>
            <Avatar
              name={username}
              userId={userId}
              avatarUrl={avatarUrl}
              avatarColor={avatarColor}
              size={80}
              className="Profile__AvatarMain"
            />
            <div className="Profile__AvatarOverlay">
              {avatarUploading ? (
                <span className="Profile__AvatarSpinner" />
              ) : (
                <Camera size={20} />
              )}
            </div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/gif,image/webp"
            onChange={handleAvatarChange}
            hidden
          />
          <div className="Profile__AvatarSide">
            <p className="Profile__AvatarHint">Click to upload (JPG, PNG, GIF, WebP, max 2MB)</p>
            {avatarUrl && (
              <button
                type="button"
                className="Profile__AvatarRemoveBtn"
                onClick={handleAvatarDelete}
                disabled={avatarDeleting}
              >
                <Trash2 size={13} />
                {avatarDeleting ? 'Removing...' : 'Remove photo'}
              </button>
            )}
            <div className="Profile__ColorLabel">사진 없을 때 색</div>
            <div className="Profile__ColorRow">
              <button
                type="button"
                className={`Profile__ColorAuto ${avatarColor == null ? 'Profile__ColorAuto--selected' : ''}`}
                title="자동 (계정 기본 색)"
                onClick={() => handleColorSelect(null)}
              >
                자동
              </button>
              {AVATAR_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={`Profile__ColorSwatch ${avatarColor === c ? 'Profile__ColorSwatch--selected' : ''}`}
                  style={{ background: c }}
                  title={c}
                  onClick={() => handleColorSelect(c)}
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* 이름 변경 섹션 */}
      <div className="Profile__Section">
        <h2 className="Profile__SectionTitle">Name</h2>
        <form className="Profile__Form" onSubmit={handleUsernameSubmit}>
          <div className="Profile__Field">
            <label className="Profile__Label">Email</label>
            <div className="Profile__InputWrap">
              <Mail size={16} className="Profile__InputIcon" />
              <input className="Profile__Input Profile__Input--disabled" value={email} disabled />
            </div>
          </div>
          <div className="Profile__Field">
            <label className="Profile__Label">Name</label>
            <div className="Profile__InputWrap">
              <User size={16} className="Profile__InputIcon" />
              <input
                className="Profile__Input"
                value={newUsername}
                onChange={(e) => setNewUsername(e.target.value)}
                placeholder="Your name"
              />
            </div>
          </div>
          <button
            type="submit"
            className="Profile__SaveBtn"
            disabled={usernameSaving || newUsername === username}
          >
            {usernameSaving ? 'Saving...' : 'Save Name'}
          </button>
        </form>
      </div>

      {/* 표시 설정 섹션 — 공개 플래그 뒤에서만 DOM을 만든다 */}
      <AppearanceSection />

      {/* 비밀번호 변경 섹션 */}
      <div className="Profile__Section">
        <h2 className="Profile__SectionTitle">Change Password</h2>
        <form className="Profile__Form" onSubmit={handlePasswordSubmit}>
          <div className="Profile__Field">
            <label className="Profile__Label">Current Password</label>
            <div className="Profile__InputWrap">
              <Lock size={16} className="Profile__InputIcon" />
              <input
                className="Profile__Input"
                type={showCurrentPw ? 'text' : 'password'}
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Current password"
              />
              <button
                type="button"
                className="Profile__TogglePassword"
                onClick={() => setShowCurrentPw((prev) => !prev)}
              >
                {showCurrentPw ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          <div className="Profile__Field">
            <label className="Profile__Label">New Password</label>
            <div className="Profile__InputWrap">
              <Lock size={16} className="Profile__InputIcon" />
              <input
                className="Profile__Input"
                type={showNewPw ? 'text' : 'password'}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="New password (min 8 chars)"
              />
              <button
                type="button"
                className="Profile__TogglePassword"
                onClick={() => setShowNewPw((prev) => !prev)}
              >
                {showNewPw ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          <div className="Profile__Field">
            <label className="Profile__Label">Confirm Password</label>
            <div className="Profile__InputWrap">
              <Lock size={16} className="Profile__InputIcon" />
              <input
                className="Profile__Input"
                type={showNewPw ? 'text' : 'password'}
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
              />
            </div>
          </div>
          <button
            type="submit"
            className="Profile__SaveBtn"
            disabled={passwordSaving || !currentPassword || !newPassword || !confirmPassword}
          >
            {passwordSaving ? 'Saving...' : 'Change Password'}
          </button>
        </form>
      </div>

      <ProfileTokens showAlert={showAlert} />

      <Alert isOpen={alertOpen} title={alertTitle} contents={alertMessage} onClose={() => setAlertOpen(false)} />
    </div>
  );
}
