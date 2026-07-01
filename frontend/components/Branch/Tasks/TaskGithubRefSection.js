import { useState, useEffect } from 'react';
import { Plus, GitPullRequest, X } from 'lucide-react';
import { axios } from '@/library/_axios';
import { getErrorCode } from '@/library/errorCode';
import { errorText } from '@/library/errorText';

const STATE_LABEL = {
  open: 'Open',
  merged: 'Merged',
  closed: 'Closed',
  draft: 'Draft',
};

export default function TaskGithubRefSection({ branchId, taskId }) {
  const [refs, setRefs] = useState([]);
  const [showAdd, setShowAdd] = useState(false);
  const [url, setUrl] = useState('');
  const [linking, setLinking] = useState(false);
  const [err, setErr] = useState('');

  const fetchRefs = async () => {
    if (!branchId || !taskId) return;
    try {
      const res = await axios.get(`/branches/${branchId}/tasks/${taskId}/github-refs`);
      if (res.data.status) setRefs(res.data.refs || []);
    } catch {}
  };

  useEffect(() => {
    fetchRefs();
    // GitHub webhook이 PR ref를 upsert하고 broadcast → Layout이 task:updated emit.
    // 같은 taskId면 이 컴포넌트는 remount되지 않으므로 직접 수신해 ref 목록을 재조회한다.
    // (안 그러면 자동 연결돼도 "No linked pull requests"가 그대로 남는다 — 핵심 피드백 누락.)
    const onTaskUpdated = () => { fetchRefs(); };
    window.addEventListener('task:updated', onTaskUpdated);
    return () => window.removeEventListener('task:updated', onTaskUpdated);
  }, [branchId, taskId]);

  const handleLink = async () => {
    const value = url.trim();
    if (!value || linking) return;
    setLinking(true);
    setErr('');
    try {
      const res = await axios.post(
        `/branches/${branchId}/tasks/${taskId}/github-refs`,
        { html_url: value },
      );
      if (res.data.status) {
        setUrl('');
        setShowAdd(false);
        await fetchRefs();
      } else {
        const code = getErrorCode(res.data);
        setErr(errorText(code, res.data.category) || '연결에 실패했어요.');
      }
    } catch {
      setErr('연결에 실패했어요.');
    }
    setLinking(false);
  };

  const handleUnlink = async (e, refId) => {
    e.stopPropagation();
    e.preventDefault();
    try {
      const res = await axios.delete(
        `/branches/${branchId}/tasks/${taskId}/github-refs/${refId}`,
      );
      if (res.data.status) await fetchRefs();
    } catch {}
  };

  return (
    <div className="TaskGithubRefSection">
      <div className="TaskGithubRefSection__Header">
        <span className="TaskGithubRefSection__Label">Pull Requests</span>
        <button
          className="TaskGithubRefSection__AddBtn"
          onClick={() => { setShowAdd((v) => !v); setErr(''); }}
        >
          <Plus size={14} />
        </button>
      </div>

      {showAdd && (
        <div className="TaskGithubRefSection__AddForm">
          <input
            className="TaskGithubRefSection__Input"
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://github.com/org/repo/pull/123"
            autoFocus
            onKeyDown={(e) => { if (e.key === 'Enter') handleLink(); }}
          />
          {err && <span className="TaskGithubRefSection__Error">{err}</span>}
          <div className="TaskGithubRefSection__AddActions">
            <button
              className="TaskGithubRefSection__SubmitBtn"
              onClick={handleLink}
              disabled={!url.trim() || linking}
            >
              {linking ? 'Linking…' : 'Link'}
            </button>
            <button
              className="TaskGithubRefSection__CancelBtn"
              onClick={() => { setShowAdd(false); setErr(''); }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {refs.length === 0 && !showAdd ? (
        <div className="TaskGithubRefSection__Empty">No linked pull requests</div>
      ) : (
        <div className="TaskGithubRefSection__List">
          {refs.map((r) => (
            <div key={r.ref_id} className="TaskGithubRefSection__Item">
              <a
                className="TaskGithubRefSection__ItemOverlay"
                href={r.html_url}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={r.title || `PR #${r.ref_number}`}
              />
              <GitPullRequest size={14} className="TaskGithubRefSection__Icon" />
              <span className="TaskGithubRefSection__PrTitle">
                {r.title || `#${r.ref_number}`}
              </span>
              {r.ref_number != null && (
                <span className="TaskGithubRefSection__PrNumber">#{r.ref_number}</span>
              )}
              {r.state && (
                <span
                  className={`TaskGithubRefSection__State TaskGithubRefSection__State--${r.state}`}
                >
                  {STATE_LABEL[r.state] || r.state}
                </span>
              )}
              <button
                className="TaskGithubRefSection__UnlinkBtn"
                onClick={(e) => handleUnlink(e, r.ref_id)}
                title="Unlink"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
