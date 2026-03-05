import { useState, useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import { axios } from '@/library/_axios';
import { Search, Users, Globe } from 'lucide-react';

export default function BrowseBranches() {
  const router = useRouter();
  const [branches, setBranches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const timerRef = useRef(null);

  useEffect(() => {
    fetchBranches('');
  }, []);

  const fetchBranches = async (q) => {
    setLoading(true);
    try {
      const url = q ? `/branches/public?q=${encodeURIComponent(q)}` : '/branches/public';
      const res = await axios.get(url);
      if (res.data.status) setBranches(res.data.branches);
    } catch {}
    setLoading(false);
  };

  const handleSearch = (value) => {
    setQuery(value);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => fetchBranches(value), 300);
  };

  const handleJoin = async (branchId) => {
    try {
      const res = await axios.post(`/branches/${branchId}/join`);
      if (res.data.status) {
        // 목록에서 제거
        setBranches((prev) => prev.filter((b) => b.branch_id !== branchId));
        // Sidebar 갱신
        window.dispatchEvent(new Event('branch:created'));
      }
    } catch {}
  };

  return (
    <div className="BrowseBranches">
      <div className="BrowseBranches__Header">
        <div className="BrowseBranches__TitleRow">
          <Globe size={20} />
          <h2 className="BrowseBranches__Title">Browse Public Branches</h2>
        </div>
        <p className="BrowseBranches__Desc">
          Discover and join public branches to collaborate with others.
        </p>
      </div>

      {/* 검색 */}
      <div className="BrowseBranches__SearchWrap">
        <Search size={16} className="BrowseBranches__SearchIcon" />
        <input
          className="BrowseBranches__SearchInput"
          placeholder="Search branches..."
          value={query}
          onChange={(e) => handleSearch(e.target.value)}
        />
      </div>

      {/* 결과 */}
      <div className="BrowseBranches__List">
        {loading && branches.length === 0 && (
          <div className="BrowseBranches__Empty">Loading...</div>
        )}
        {!loading && branches.length === 0 && (
          <div className="BrowseBranches__Empty">
            {query ? 'No branches found.' : 'No public branches available.'}
          </div>
        )}
        {branches.map((branch) => (
          <div key={branch.branch_id} className="BrowseBranches__Card">
            <div className="BrowseBranches__CardMain">
              <div className="BrowseBranches__CardHeader">
                <span
                  className="BrowseBranches__CardDot"
                  style={{ backgroundColor: branch.color || '#5E6AD2' }}
                />
                <span className="BrowseBranches__CardName">{branch.branch_name}</span>
                <span className="BrowseBranches__CardKey">{branch.key}</span>
              </div>
              {branch.description && (
                <p className="BrowseBranches__CardDesc">{branch.description}</p>
              )}
              <div className="BrowseBranches__CardMeta">
                <Users size={13} />
                <span>{branch.member_count || 0} members</span>
              </div>
            </div>
            <button
              className="BrowseBranches__JoinBtn"
              onClick={() => handleJoin(branch.branch_id)}
            >
              Join
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
