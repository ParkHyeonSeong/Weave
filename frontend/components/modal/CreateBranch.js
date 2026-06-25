import { useState } from 'react';
import { X, Globe, Lock } from 'lucide-react';
import { axios } from '@/library/_axios';
import { getErrorCode } from '@/library/errorCode';

export default function CreateBranch({ onClose }) {
  const [branchName, setBranchName] = useState('');
  const [key, setKey] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState('private');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Key 입력: 대문자 영문 + 숫자만 허용, 최대 10자
  const handleKeyChange = (e) => {
    const value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 10);
    setKey(value);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!branchName.trim() || key.length < 2 || loading) return;

    setError('');
    setLoading(true);
    try {
      const res = await axios.post('/branches', {
        branch_name: branchName.trim(),
        key: key.trim(),
        description: description.trim() || null,
        visibility,
      });
      if (res.data.status) {
        // Sidebar 목록 갱신 이벤트
        window.dispatchEvent(new Event('branch:created'));
        onClose();
      } else if (getErrorCode(res.data) === 'KEY_ALREADY_EXISTS') {
        setError('This key is already in use.');
      }
    } catch {
      setError('Failed to create branch.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="CreateBranch__Backdrop" onClick={onClose}>
      <form className="CreateBranch" onClick={(e) => e.stopPropagation()} onSubmit={handleSubmit}>
        <div className="CreateBranch__Header">
          <h2 className="CreateBranch__Title">Create Branch</h2>
          <button type="button" className="CreateBranch__CloseBtn" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="CreateBranch__Body">
          <div className="CreateBranch__Field">
            <label className="CreateBranch__Label">Branch name</label>
            <input
              className="CreateBranch__Input"
              type="text"
              placeholder="e.g. Engineering, Marketing"
              value={branchName}
              onChange={(e) => setBranchName(e.target.value)}
              autoFocus
            />
          </div>

          <div className="CreateBranch__Field">
            <label className="CreateBranch__Label">Key</label>
            <input
              className="CreateBranch__Input CreateBranch__Input--key"
              type="text"
              placeholder="e.g. ENG, MKT"
              value={key}
              onChange={handleKeyChange}
            />
            <span className="CreateBranch__Hint">
              Issues will be labeled as {key || '___'}-1, {key || '___'}-2, ...
            </span>
          </div>

          <div className="CreateBranch__Field">
            <label className="CreateBranch__Label">Description</label>
            <textarea
              className="CreateBranch__Textarea"
              placeholder="What is this branch about?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>

          <div className="CreateBranch__Field">
            <label className="CreateBranch__Label">Visibility</label>
            <div className="CreateBranch__VisibilityGroup">
              <button
                type="button"
                className={`CreateBranch__VisibilityBtn ${visibility === 'private' ? 'CreateBranch__VisibilityBtn--active' : ''}`}
                onClick={() => setVisibility('private')}
              >
                <Lock size={14} />
                Private
              </button>
              <button
                type="button"
                className={`CreateBranch__VisibilityBtn ${visibility === 'public' ? 'CreateBranch__VisibilityBtn--active' : ''}`}
                onClick={() => setVisibility('public')}
              >
                <Globe size={14} />
                Public
              </button>
            </div>
            <span className="CreateBranch__Hint">
              {visibility === 'private'
                ? 'Only invited members can access this branch.'
                : 'Anyone in the workspace can view this branch.'}
            </span>
          </div>

          {error && <div className="CreateBranch__Error">{error}</div>}
        </div>

        <div className="CreateBranch__Footer">
          <button type="button" className="CreateBranch__CancelBtn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="CreateBranch__SubmitBtn"
            disabled={!branchName.trim() || key.length < 2 || loading}
          >
            {loading ? 'Creating...' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  );
}
