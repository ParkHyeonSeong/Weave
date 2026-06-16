import { useState, useEffect, useRef } from 'react';
import { Plus, FileText, X } from 'lucide-react';
import { axios } from '@/library/_axios';
import NavLink from '@/components/common/NavLink';

export default function TaskPageLinkSection({ branchId, taskId }) {
  const [links, setLinks] = useState([]);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const searchRef = useRef(null);
  const debounceRef = useRef(null);

  const fetchLinks = async () => {
    if (!branchId || !taskId) return;
    try {
      const res = await axios.get(`/branches/${branchId}/tasks/${taskId}/pages`);
      if (res.data.status) setLinks(res.data.pages);
    } catch {}
  };

  useEffect(() => {
    fetchLinks();
  }, [branchId, taskId]);

  // 외부 클릭으로 검색 닫기
  useEffect(() => {
    const handleClick = (e) => {
      if (searchRef.current && !searchRef.current.contains(e.target)) {
        setShowSearch(false);
        setSearchQuery('');
        setSearchResults([]);
      }
    };
    if (showSearch) document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showSearch]);

  // 검색 debounce
  useEffect(() => {
    if (!searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await axios.get(
          `/branches/${branchId}/tasks/${taskId}/pages/search`,
          { params: { q: searchQuery } }
        );
        if (res.data.status) setSearchResults(res.data.pages);
      } catch {}
      setSearching(false);
    }, 300);
    return () => clearTimeout(debounceRef.current);
  }, [searchQuery]);

  const handleLink = async (pageId) => {
    try {
      await axios.post(`/branches/${branchId}/tasks/${taskId}/pages`, { page_id: pageId });
      await fetchLinks();
      setShowSearch(false);
      setSearchQuery('');
      setSearchResults([]);
    } catch {}
  };

  const handleUnlink = async (e, linkId) => {
    e.preventDefault(); // 행이 NavLink라 앵커 기본 네비를 막아야 한다(X 클릭 시 페이지 이동 방지)
    e.stopPropagation();
    try {
      await axios.delete(`/branches/${branchId}/tasks/${taskId}/pages/${linkId}`);
      await fetchLinks();
    } catch {}
  };

  return (
    <div className="TaskPageLinkSection">
      <div className="TaskPageLinkSection__Header">
        <span className="TaskPageLinkSection__Label">Linked Pages</span>
        <button
          className="TaskPageLinkSection__AddBtn"
          onClick={() => setShowSearch(!showSearch)}
        >
          <Plus size={14} />
        </button>
      </div>

      {showSearch && (
        <div className="TaskPageLinkSection__SearchWrap" ref={searchRef}>
          <input
            className="TaskPageLinkSection__SearchInput"
            type="text"
            placeholder="Search pages..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            autoFocus
          />
          {(searchResults.length > 0 || searching) && (
            <div className="TaskPageLinkSection__SearchDropdown">
              {searching && searchResults.length === 0 ? (
                <div className="TaskPageLinkSection__SearchEmpty">Searching...</div>
              ) : (
                searchResults.map((page) => (
                  <button
                    key={page.page_id}
                    className="TaskPageLinkSection__SearchItem"
                    onClick={() => handleLink(page.page_id)}
                  >
                    <FileText size={14} className="TaskPageLinkSection__Icon" />
                    <span className="TaskPageLinkSection__PageTitle">{page.title || 'Untitled'}</span>
                    <span className="TaskPageLinkSection__CanvasName">{page.canvas_name}</span>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      )}

      {links.length === 0 && !showSearch ? (
        <div className="TaskPageLinkSection__Empty">No linked pages</div>
      ) : (
        <div className="TaskPageLinkSection__List">
          {links.map((link) => (
            <NavLink
              key={link.link_id}
              href={`/canvas/${link.canvas_id}/${link.page_id}`}
              className="TaskPageLinkSection__Item"
            >
              <FileText size={14} className="TaskPageLinkSection__Icon" />
              <span className="TaskPageLinkSection__PageTitle">{link.title || 'Untitled'}</span>
              <span className="TaskPageLinkSection__CanvasName">{link.canvas_name}</span>
              <button
                className="TaskPageLinkSection__UnlinkBtn"
                onClick={(e) => handleUnlink(e, link.link_id)}
              >
                <X size={12} />
              </button>
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}
