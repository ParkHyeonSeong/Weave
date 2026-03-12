import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { axios } from '@/library/_axios';
import { Star, FileText } from 'lucide-react';

export default function StarredItems() {
  const router = useRouter();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchStarred();
  }, []);

  const fetchStarred = async () => {
    try {
      const res = await axios.get('/stars', { params: { limit: 20 } });
      if (res.data.status) {
        setItems(res.data.items);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  };

  const handleClick = (item) => {
    if (item.type === 'task') {
      router.push(`/branch/${item.branch_id}/task/${item.task_id}`);
    } else if (item.type === 'doc') {
      router.push(`/canvas/${item.canvas_id}/${item.page_id}`);
    }
  };

  if (loading) {
    return (
      <div className="Widget StarredItems">
        <div className="Widget__Header">
          <Star size={16} />
          <span className="Widget__Title">Starred</span>
        </div>
        <div className="Widget__Body">
          <div className="Widget__Empty">Loading...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="Widget StarredItems">
      <div className="Widget__Header">
        <Star size={16} />
        <span className="Widget__Title">Starred</span>
      </div>
      <div className="Widget__Body">
        {items.length === 0 ? (
          <div className="Widget__Empty">No starred items</div>
        ) : (
          <div className="StarredItems__List">
            {items.map((item) => (
              <div
                key={`${item.type}-${item.type === 'task' ? item.task_id : item.page_id}`}
                className="StarredItems__Item"
                onClick={() => handleClick(item)}
              >
                {item.type === 'task' ? (
                  <div className={`StarredItems__StatusDot StarredItems__StatusDot--${item.status}`} />
                ) : (
                  <FileText size={12} className="StarredItems__DocIcon" />
                )}
                <span className="StarredItems__TaskId">
                  {item.type === 'task' ? item.display_number : item.canvas_name}
                </span>
                <span className="StarredItems__TaskTitle">{item.title}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
