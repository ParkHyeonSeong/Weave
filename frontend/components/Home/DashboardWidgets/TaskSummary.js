import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { axios } from '@/library/_axios';
import { Circle, Loader, CheckCircle2, ListTodo } from 'lucide-react';

export default function TaskSummary() {
  const router = useRouter();
  const [counts, setCounts] = useState({ todo: 0, in_progress: 0, done: 0 });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchTasks();
  }, []);

  const fetchTasks = async () => {
    try {
      const res = await axios.get('/my-tasks');
      if (res.data.status) {
        const tasks = res.data.tasks;
        // category 기반 집계: task에 status_category가 있으면 사용, 없으면 status 기반 fallback
        const catCounts = { todo: 0, in_progress: 0, done: 0 };
        tasks.forEach((t) => {
          const cat = t.status_category || t.status;
          if (cat === 'done') catCounts.done++;
          else if (cat === 'in_progress') catCounts.in_progress++;
          else catCounts.todo++;
        });
        setCounts(catCounts);
      }
    } catch {
      // silently fail
    } finally {
      setLoading(false);
    }
  };

  const handleClick = () => {
    router.push('/my-tasks');
  };

  if (loading) {
    return (
      <div className="Widget">
        <div className="Widget__Header">
          <ListTodo size={16} />
          <span className="Widget__Title">My Tasks</span>
        </div>
        <div className="Widget__Body">
          <div className="Widget__Empty">Loading...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="Widget">
      <div className="Widget__Header">
        <ListTodo size={16} />
        <span className="Widget__Title">My Tasks</span>
      </div>
      <div className="Widget__Body">
        <div className="TaskSummary__Stats">
          <div className="TaskSummary__Stat" onClick={handleClick}>
            <Circle size={18} color="#6B7280" />
            <span className="TaskSummary__StatCount">{counts.todo}</span>
            <span className="TaskSummary__StatLabel">Todo</span>
          </div>
          <div className="TaskSummary__Stat" onClick={handleClick}>
            <Loader size={18} color="#1E40AF" />
            <span className="TaskSummary__StatCount">{counts.in_progress}</span>
            <span className="TaskSummary__StatLabel">In Progress</span>
          </div>
          <div className="TaskSummary__Stat" onClick={handleClick}>
            <CheckCircle2 size={18} color="#16A34A" />
            <span className="TaskSummary__StatCount">{counts.done}</span>
            <span className="TaskSummary__StatLabel">Done</span>
          </div>
        </div>
      </div>
    </div>
  );
}
