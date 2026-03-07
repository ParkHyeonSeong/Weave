import { useRouter } from 'next/router';
import { X, CircleDot } from 'lucide-react';

const STATUS_LABELS = {
  open: 'Open',
  closed: 'Closed',
};

export default function IssueRefCard({ issueRef, removable, onRemove }) {
  const router = useRouter();
  if (!issueRef) return null;

  const handleClick = () => {
    if (removable) return;
    if (issueRef.branch_id && issueRef.task_id && issueRef.issue_id) {
      router.push(`/branch/${issueRef.branch_id}/task/${issueRef.task_id}/issue/${issueRef.issue_id}`);
    }
  };

  return (
    <div
      className={`IssueRefCard ${!removable ? 'IssueRefCard--clickable' : ''}`}
      onClick={handleClick}
    >
      <div className="IssueRefCard__Header">
        <CircleDot size={12} className="IssueRefCard__Icon" />
        <span className="IssueRefCard__DisplayId">{issueRef.display_id}</span>
        <span className={`IssueRefCard__Status IssueRefCard__Status--${issueRef.status}`}>
          {STATUS_LABELS[issueRef.status] || issueRef.status}
        </span>
        {removable && (
          <button className="IssueRefCard__Remove" onClick={(e) => { e.stopPropagation(); onRemove(); }}>
            <X size={12} />
          </button>
        )}
      </div>
      <div className="IssueRefCard__Title">{issueRef.title}</div>
    </div>
  );
}
