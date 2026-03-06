import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { Plus, Users } from 'lucide-react';
import { axios } from '@/library/_axios';

export default function BranchHome() {
  const router = useRouter();
  const [branches, setBranches] = useState([]);

  const fetchBranches = async () => {
    try {
      const res = await axios.get('/branches');
      if (res.data.status) {
        setBranches(res.data.branches);
      }
    } catch {}
  };

  useEffect(() => {
    fetchBranches();
  }, []);

  useEffect(() => {
    const handleRefresh = () => fetchBranches();
    window.addEventListener('branch:created', handleRefresh);
    return () => window.removeEventListener('branch:created', handleRefresh);
  }, []);

  return (
    <div className="BranchHome">
      <div className="BranchHome__Header">
        <h2 className="BranchHome__Title">Branch</h2>
        <button
          className="BranchHome__CreateBtn"
          onClick={() => window.dispatchEvent(new CustomEvent('layout:create-branch'))}
        >
          <Plus size={16} />
          New Branch
        </button>
      </div>

      {branches.length === 0 ? (
        <div className="BranchHome__Empty">
          <p>No branches yet.</p>
          <p>Create a branch to start managing your project.</p>
        </div>
      ) : (
        <div className="BranchHome__Grid">
          {branches.map((branch) => (
            <button
              key={branch.branch_id}
              className="BranchHome__Card"
              onClick={() => router.push(`/branch/${branch.branch_id}`)}
            >
              <div className="BranchHome__CardHeader">
                <span
                  className="BranchHome__CardDot"
                  style={{ backgroundColor: branch.color || '#5E6AD2' }}
                />
                <span className="BranchHome__CardName">{branch.branch_name}</span>
                <span className="BranchHome__CardKey">{branch.key}</span>
              </div>
              {branch.description && (
                <p className="BranchHome__CardDesc">{branch.description}</p>
              )}
              <div className="BranchHome__CardMeta">
                <span className="BranchHome__CardRole">{branch.my_role}</span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
