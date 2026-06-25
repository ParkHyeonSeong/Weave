import { useState } from 'react';
import { X } from 'lucide-react';
import { axios } from '@/library/_axios';
import { getErrorCode, getError } from '@/library/errorCode';
import { errorText } from '@/library/errorText';

export default function AddMember({ onClose }) {
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('member');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email.trim() || !username.trim() || password.length < 8 || loading) return;

    setError('');
    setLoading(true);
    try {
      const res = await axios.post('/admin/users', {
        email: email.trim(),
        username: username.trim(),
        password,
        role,
      });
      if (res.data.status) {
        window.dispatchEvent(new Event('member:created'));
        onClose();
      } else if (getErrorCode(res.data) === 'EMAIL_ALREADY_EXISTS') {
        setError('This email is already registered.');
      } else {
        const err = getError(res.data);
        const msg = errorText(err.code, err.category) ?? 'Failed to create member.';
        setError(msg);
      }
    } catch {
      setError('Failed to create member.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="AddMember__Backdrop" onClick={onClose}>
      <form className="AddMember" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <div className="AddMember__Header">
          <h2 className="AddMember__Title">Add Member</h2>
          <button type="button" className="AddMember__CloseBtn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="AddMember__Body">
          <div className="AddMember__Field">
            <label className="AddMember__Label">Email</label>
            <input
              className="AddMember__Input"
              type="email"
              placeholder="user@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoFocus
              required
            />
          </div>

          <div className="AddMember__Field">
            <label className="AddMember__Label">Name</label>
            <input
              className="AddMember__Input"
              type="text"
              placeholder="User name"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </div>

          <div className="AddMember__Field">
            <label className="AddMember__Label">Password</label>
            <input
              className="AddMember__Input"
              type="password"
              placeholder="Minimum 8 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <div className="AddMember__Field">
            <label className="AddMember__Label">Role</label>
            <select
              className="AddMember__Select"
              value={role}
              onChange={(e) => setRole(e.target.value)}
            >
              <option value="member">Member</option>
              <option value="admin">Admin</option>
            </select>
          </div>

          {error && <div className="AddMember__Error">{error}</div>}
        </div>

        <div className="AddMember__Footer">
          <button type="button" className="AddMember__CancelBtn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="AddMember__SubmitBtn"
            disabled={!email.trim() || !username.trim() || password.length < 8 || loading}
          >
            {loading ? 'Adding...' : 'Add Member'}
          </button>
        </div>
      </form>
    </div>
  );
}
