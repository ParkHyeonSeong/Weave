import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { Plus, MessageCircle, CircleDot, CheckCircle2 } from 'lucide-react';
import { axios } from '@/library/_axios';
import { formatRelative } from '@/library/formatTime';
import Avatar from '@/components/common/Avatar';

export default function TaskIssueSection({ branchId, taskId, expanded = false }) {
  const router = useRouter();
  const [issues, setIssues] = useState([]);

  const fetchIssues = async () => {
    if (!branchId || !taskId) return;
    try {
      const res = await axios.get(`/branches/${branchId}/tasks/${taskId}/issues`);
      if (res.data.status) {
        setIssues(res.data.issues);
      }
    } catch {}
  };

  useEffect(() => {
    fetchIssues();
  }, [branchId, taskId]);

  useEffect(() => {
    const handler = () => fetchIssues();
    window.addEventListener('issue:created', handler);
    window.addEventListener('issue:updated', handler);
    window.addEventListener('issue:deleted', handler);
    return () => {
      window.removeEventListener('issue:created', handler);
      window.removeEventListener('issue:updated', handler);
      window.removeEventListener('issue:deleted', handler);
    };
  }, [branchId, taskId]);

  const displayIssues = expanded ? issues : issues.slice(0, 5);
  const openCount = issues.filter((i) => i.status === 'open').length;
  const closedCount = issues.length - openCount;

  return (
    <div className="TaskIssueSection">
      <div className="TaskIssueSection__Header">
        <span className="TaskIssueSection__Label">
          Issues
          {issues.length > 0 && (
            <span className="TaskIssueSection__Count">
              {openCount} open{closedCount > 0 ? `, ${closedCount} closed` : ''}
            </span>
          )}
        </span>
        <button className="TaskIssueSection__AddBtn" onClick={() => router.push(`/branch/${branchId}/task/${taskId}/issue/new`)}>
          <Plus size={14} />
          {expanded && <span>New issue</span>}
        </button>
      </div>

      {displayIssues.length === 0 ? (
        <div className="TaskIssueSection__Empty">No issues yet.</div>
      ) : (
        <div className="TaskIssueSection__List">
          {displayIssues.map((issue) => (
            <button
              key={issue.issue_id}
              className="TaskIssueSection__Item"
              onClick={() => router.push(`/branch/${branchId}/task/${taskId}/issue/${issue.issue_id}`)}
            >
              {issue.status === 'open'
                ? <CircleDot size={14} className="TaskIssueSection__StatusIcon TaskIssueSection__StatusIcon--open" />
                : <CheckCircle2 size={14} className="TaskIssueSection__StatusIcon TaskIssueSection__StatusIcon--closed" />
              }
              <div className="TaskIssueSection__ItemContent">
                <span className="TaskIssueSection__ItemTitle">{issue.title}</span>
                {expanded && (
                  <span className="TaskIssueSection__ItemMeta">
                    #{issue.issue_id} opened {formatRelative(issue.created_at)} by{' '}
                    <Avatar
                      name={issue.author_name}
                      userId={issue.created_by}
                      size="xs"
                      className="TaskIssueSection__AuthorAvatar"
                    />
                    {issue.author_name}
                  </span>
                )}
              </div>
              {issue.comment_count > 0 && (
                <span className="TaskIssueSection__CommentCount">
                  <MessageCircle size={12} />
                  {issue.comment_count}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {!expanded && issues.length > 5 && (
        <button
          className="TaskIssueSection__More"
          onClick={() => router.push(`/branch/${branchId}/task/${taskId}`)}
        >
          View all {issues.length} issues
        </button>
      )}

    </div>
  );
}
