import { useState } from 'react';
import { useRouter } from 'next/router';
import { Lock, Eye, EyeOff, Loader2, CheckCircle2 } from 'lucide-react';
import { axios } from '@/library/_axios';
import Alert from '@/components/modal/Alert';


export default function ResetPassword({ token }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // Alert 상태
  const [alertOpen, setAlertOpen] = useState(false);
  const [alertTitle, setAlertTitle] = useState('');
  const [alertMessage, setAlertMessage] = useState('');

  const showAlert = (title, message) => {
    setAlertTitle(title);
    setAlertMessage(message);
    setAlertOpen(true);
  };

  // 토큰 없음 → 유효하지 않은 링크 안내
  if (!token) {
    return (
      <div className="ChangePassword">
        <div className="ChangePassword__Card">
          <div className="ChangePassword__Header">
            <h1 className="ChangePassword__Logo">Weave</h1>
            <p className="ChangePassword__Subtitle">
              This password reset link is invalid.
            </p>
          </div>
          <button
            type="button"
            className="ChangePassword__SubmitBtn"
            onClick={() => router.replace('/auth/login')}
          >
            Go to Sign In
          </button>
        </div>
      </div>
    );
  }

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;

    if (newPassword.length < 8) {
      showAlert('Input Error', 'Password must be at least 8 characters.');
      return;
    }
    if (newPassword !== confirmPassword) {
      showAlert('Input Error', 'Passwords do not match.');
      return;
    }

    setLoading(true);
    try {
      const res = await axios.post('/auth/reset-password', {
        token,
        new_password: newPassword,
      });

      if (res.data.status) {
        setDone(true);
      } else {
        const messages = {
          'INVALID_OR_EXPIRED_TOKEN': 'This link has expired or is invalid. Please request a new password reset.',
          'PASSWORD_TOO_SHORT': 'Password must be at least 8 characters.',
        };
        showAlert('Error', messages[res.data.message] || res.data.message);
      }
    } catch {
      showAlert('Error', 'An unexpected error occurred. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // 변경 완료 화면
  if (done) {
    return (
      <div className="ChangePassword">
        <div className="ChangePassword__Card">
          <div className="ChangePassword__Header">
            <CheckCircle2 size={32} style={{ color: '#16A34A', marginBottom: 8 }} />
            <h1 className="ChangePassword__Logo">Password Changed</h1>
            <p className="ChangePassword__Subtitle">
              Your password has been updated. Please sign in with your new password.
            </p>
          </div>
          <button
            type="button"
            className="ChangePassword__SubmitBtn"
            onClick={() => router.replace('/auth/login')}
          >
            Go to Sign In
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="ChangePassword">
      <div className="ChangePassword__Card">
        <div className="ChangePassword__Header">
          <h1 className="ChangePassword__Logo">Weave</h1>
          <p className="ChangePassword__Subtitle">
            Set a new password for your account.
          </p>
        </div>

        <form className="ChangePassword__Form" onSubmit={handleSubmit} onKeyDown={(e) => {
          if (e.key === 'Enter' && e.nativeEvent.isComposing) e.preventDefault();
        }}>
          <div className="ChangePassword__Field">
            <label className="ChangePassword__Label" htmlFor="newPassword">New Password</label>
            <div className="ChangePassword__InputWrap">
              <Lock size={16} className="ChangePassword__InputIcon" />
              <input
                id="newPassword"
                type={showPassword ? 'text' : 'password'}
                className="ChangePassword__Input"
                placeholder="Minimum 8 characters"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                autoFocus
                required
              />
              <button
                type="button"
                className="ChangePassword__TogglePassword"
                onClick={() => setShowPassword(!showPassword)}
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>

          <div className="ChangePassword__Field">
            <label className="ChangePassword__Label" htmlFor="confirmPassword">Confirm Password</label>
            <div className="ChangePassword__InputWrap">
              <Lock size={16} className="ChangePassword__InputIcon" />
              <input
                id="confirmPassword"
                type={showPassword ? 'text' : 'password'}
                className="ChangePassword__Input"
                placeholder="Confirm password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>
          </div>

          <button type="submit" className="ChangePassword__SubmitBtn" disabled={loading}>
            {loading
              ? <Loader2 size={18} className="ChangePassword__Spinner" />
              : 'Set New Password'
            }
          </button>
        </form>
      </div>

      <Alert
        isOpen={alertOpen}
        title={alertTitle}
        contents={alertMessage}
        onClose={() => setAlertOpen(false)}
      />
    </div>
  );
}
