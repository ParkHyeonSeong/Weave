import { useState } from 'react';
import { X, Copy, Check, Mail, Link2 } from 'lucide-react';
import { axios } from '@/library/_axios';
import { getError } from '@/library/errorCode';
import { errorText } from '@/library/errorText';

export default function ResetPassword({ user, onClose }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // 결과 상태
  const [emailSent, setEmailSent] = useState(false);
  const [resetLink, setResetLink] = useState('');
  const [copied, setCopied] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (loading) return;

    setError('');
    setLoading(true);
    try {
      const res = await axios.post(`/admin/users/${user.user_id}/reset-password`, {});
      if (res.data.status) {
        if (res.data.email_sent) {
          setEmailSent(true);
        } else {
          // 상대경로면 현재 origin을 붙여 절대 URL로 만든다.
          const link = res.data.reset_link || '';
          const absolute = /^https?:\/\//i.test(link)
            ? link
            : `${window.location.origin}${link}`;
          setResetLink(absolute);
        }
      } else {
        const err = getError(res.data);
        let fallback = 'Failed to reset password.';
        if (err.code === 'CANNOT_RESET_OWN_PASSWORD') fallback = 'You cannot reset your own password.';
        else if (err.code === 'USER_NOT_FOUND') fallback = 'User not found.';
        setError(errorText(err.code, err.category) ?? fallback);
      }
    } catch {
      setError('Failed to reset password.');
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(resetLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback
      const textarea = document.createElement('textarea');
      textarea.value = resetLink;
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
              <Mail size={32} style={{ color: 'var(--color-primary)', marginBottom: 12 }} />
              <p className="ResetPassword__Description">
                A password reset link has been sent to<br />
                <strong>{user.email}</strong>
              </p>
              <p className="ResetPassword__Notice">
                The link can be used once and expires in 1 hour.
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

  // 재설정 링크 결과 화면 (SMTP 미설정/발송 실패 시 관리자에게 링크 전달)
  if (resetLink) {
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
              Reset link for <strong>{user.username}</strong>
            </p>
            <div className="ResetPassword__LinkDisplay">
              <Link2 size={16} className="ResetPassword__LinkIcon" />
              <span className="ResetPassword__LinkText">{resetLink}</span>
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
              Share this link with the user. It can be used once and expires in 1 hour.
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

  // 비밀번호 초기화 확인 화면
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
          <p className="ResetPassword__Notice">
            A single-use reset link will be generated. If email is configured, it will be
            sent to the user; otherwise the link will be shown here for you to share.
          </p>

          {error && <div className="ResetPassword__Error">{error}</div>}
        </div>

        <div className="ResetPassword__Footer">
          <button type="button" className="ResetPassword__CancelBtn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="ResetPassword__SubmitBtn"
            disabled={loading}
          >
            {loading ? 'Resetting...' : 'Reset Password'}
          </button>
        </div>
      </form>
    </div>
  );
}
