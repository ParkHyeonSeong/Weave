import { useState } from 'react';
import { X, Copy, Check, Mail } from 'lucide-react';
import { axios } from '@/library/_axios';

export default function ResetPassword({ user, onClose }) {
  const [useCustom, setUseCustom] = useState(false);
  const [customPassword, setCustomPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // 결과 상태
  const [tempPassword, setTempPassword] = useState('');
  const [emailSent, setEmailSent] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;
    if (useCustom && customPassword.length < 6) return;

    setError('');
    setLoading(true);
    try {
      const payload = useCustom ? { new_password: customPassword } : {};
      const res = await axios.post(`/admin/users/${user.user_id}/reset-password`, payload);
      if (res.data.status) {
        if (res.data.email_sent) {
          setEmailSent(true);
        } else {
          setTempPassword(res.data.temporary_password);
        }
      } else {
        const messages = {
          'CANNOT_RESET_OWN_PASSWORD': 'You cannot reset your own password.',
          'USER_NOT_FOUND': 'User not found.',
        };
        setError(messages[res.data.message] || res.data.message);
      }
    } catch {
      setError('Failed to reset password.');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(tempPassword);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
      const textarea = document.createElement('textarea');
      textarea.value = tempPassword;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // 이메일 발송 완료 화면
  if (emailSent) {
    return (
      <div className="ResetPassword__Backdrop" onClick={onClose}>
        <div className="ResetPassword" onClick={(e) => e.stopPropagation()}>
          <div className="ResetPassword__Header">
            <h2 className="ResetPassword__Title">Password Reset</h2>
            <button type="button" className="ResetPassword__CloseBtn" onClick={onClose}>
              <X size={16} />
            </button>
          </div>

          <div className="ResetPassword__Body">
            <div className="ResetPassword__EmailSent">
              <Mail size={32} style={{ color: '#5E6AD2', marginBottom: 12 }} />
              <p className="ResetPassword__Description">
                A temporary password has been sent to<br />
                <strong>{user.email}</strong>
              </p>
              <p className="ResetPassword__Notice">
                The user will be required to change their password on next login.
              </p>
            </div>
          </div>

          <div className="ResetPassword__Footer">
            <button type="button" className="ResetPassword__SubmitBtn" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 임시 비밀번호 결과 화면
  if (tempPassword) {
    return (
      <div className="ResetPassword__Backdrop" onClick={onClose}>
        <div className="ResetPassword" onClick={(e) => e.stopPropagation()}>
          <div className="ResetPassword__Header">
            <h2 className="ResetPassword__Title">Password Reset</h2>
            <button type="button" className="ResetPassword__CloseBtn" onClick={onClose}>
              <X size={16} />
            </button>
          </div>

          <div className="ResetPassword__Body">
            <p className="ResetPassword__Description">
              Temporary password for <strong>{user.username}</strong>
            </p>
            <div className="ResetPassword__PasswordDisplay">
              <code className="ResetPassword__PasswordCode">{tempPassword}</code>
              <button
                type="button"
                className="ResetPassword__CopyBtn"
                onClick={handleCopy}
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>
            <p className="ResetPassword__Notice">
              The user will be required to change their password on next login.
            </p>
          </div>

          <div className="ResetPassword__Footer">
            <button type="button" className="ResetPassword__SubmitBtn" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      </div>
    );
  }

  // 비밀번호 초기화 입력 화면
  return (
    <div className="ResetPassword__Backdrop" onClick={onClose}>
      <form className="ResetPassword" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <div className="ResetPassword__Header">
          <h2 className="ResetPassword__Title">Reset Password</h2>
          <button type="button" className="ResetPassword__CloseBtn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="ResetPassword__Body">
          <p className="ResetPassword__Description">
            Reset password for <strong>{user.username}</strong> ({user.email})
          </p>

          <label className="ResetPassword__CheckboxLabel">
            <input
              type="checkbox"
              checked={useCustom}
              onChange={(e) => setUseCustom(e.target.checked)}
            />
            Set custom password
          </label>

          {useCustom && (
            <div className="ResetPassword__Field">
              <label className="ResetPassword__Label">New Password</label>
              <input
                className="ResetPassword__Input"
                type="password"
                placeholder="Minimum 6 characters"
                value={customPassword}
                onChange={(e) => setCustomPassword(e.target.value)}
                autoFocus
              />
            </div>
          )}

          {error && <div className="ResetPassword__Error">{error}</div>}
        </div>

        <div className="ResetPassword__Footer">
          <button type="button" className="ResetPassword__CancelBtn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="ResetPassword__SubmitBtn"
            disabled={loading || (useCustom && customPassword.length < 6)}
          >
            {loading ? 'Resetting...' : 'Reset Password'}
          </button>
        </div>
      </form>
    </div>
  );
}
