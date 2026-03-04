import { useState } from 'react';
import { X } from 'lucide-react';
import { axios } from '@/library/_axios';

export default function CreateBranch({ onClose }) {
  const [branchName, setBranchName] = useState('');
  const [description, setDescription] = useState('');
  const [visibility, setVisibility] = useState('private');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!branchName.trim() || loading) return;

    setLoading(true);
    try {
      const res = await axios.post('/branches', {
        branch_name: branchName.trim(),
        description: description.trim() || null,
        visibility,
      });
      if (res.data.status) {
        // Sidebar 목록 갱신 이벤트
        window.dispatchEvent(new Event('branch:created'));
        onClose();
      }
    } catch {
      // TODO: 에러 처리
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
            <label className="CreateBranch__Label">Description</label>
            <textarea
              className="CreateBranch__Textarea"
              placeholder="What is this branch about?"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
            />
          </div>
        </div>

        <div className="CreateBranch__Footer">
          <button type="button" className="CreateBranch__CancelBtn" onClick={onClose}>
            Cancel
          </button>
          <button
            type="submit"
            className="CreateBranch__SubmitBtn"
            disabled={!branchName.trim() || loading}
          >
            {loading ? 'Creating...' : 'Create'}
          </button>
        </div>
      </form>
    </div>
  );
}
