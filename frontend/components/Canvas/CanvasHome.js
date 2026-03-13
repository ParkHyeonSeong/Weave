import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/router';
import { Plus, Clock, Star, FileText, Search } from 'lucide-react';
import { axios } from '@/library/_axios';

const getRelativeTime = (dateStr) => {
  const now = new Date();
  const date = new Date(dateStr);
  const diff = Math.floor((now - date) / 1000);
  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 172800) return 'yesterday';
  return `${Math.floor(diff / 86400)}d ago`;
};

export default function CanvasHome() {
  const router = useRouter();
  const [canvases, setCanvases] = useState([]);
  const [recentDocs, setRecentDocs] = useState([]);
  const [starredDocs, setStarredDocs] = useState([]);
  const [query, setQuery] = useState('');

  const fetchCanvases = async () => {
    try {
      const res = await axios.get('/canvases');
      if (res.data.status) setCanvases(res.data.canvases);
    } catch {}
  };

  const fetchWidgetData = async () => {
    try {
      const [recentRes, starRes] = await Promise.all([
        axios.get('/recent-views', { params: { type: 'doc', limit: 8 } }),
        axios.get('/stars', { params: { type: 'doc', limit: 8 } }),
      ]);
      if (recentRes.data.status) setRecentDocs(recentRes.data.items);
      if (starRes.data.status) setStarredDocs(starRes.data.items);
    } catch {}
  };

  useEffect(() => {
    fetchCanvases();
    fetchWidgetData();
  }, []);

  useEffect(() => {
    const handleRefresh = () => fetchCanvases();
    window.addEventListener('canvas:created', handleRefresh);
    return () => window.removeEventListener('canvas:created', handleRefresh);
  }, []);

  const filteredCanvases = useMemo(() => {
    if (!query.trim()) return canvases;
    const q = query.toLowerCase();
    return canvases.filter((c) => c.canvas_name.toLowerCase().includes(q));
  }, [canvases, query]);

  const handleDocClick = (item) => {
    router.push(`/canvas/${item.canvas_id}/${item.page_id}`);
  };

  return (
    <div className="CanvasHome">
      <div className="CanvasHome__Header">
        <h2 className="CanvasHome__Title">Canvas</h2>
        <button
          className="CanvasHome__CreateBtn"
          onClick={() => window.dispatchEvent(new CustomEvent('layout:create-canvas'))}
        >
          <Plus size={16} />
          New Canvas
        </button>
      </div>

      {/* 위젯 영역 */}
      <div className="CanvasHome__WidgetGrid">
        {/* 최근 문서 */}
        <div className="Widget">
          <div className="Widget__Header">
            <Clock size={16} />
            <span className="Widget__Title">Recent Docs</span>
          </div>
          <div className="Widget__Body">
            {recentDocs.length === 0 ? (
              <div className="Widget__Empty">No recent docs</div>
            ) : (
              <div className="CanvasHome__DocList">
                {recentDocs.map((item) => (
                  <div
                    key={item.page_id}
                    className="CanvasHome__DocItem"
                    onClick={() => handleDocClick(item)}
                  >
                    <FileText size={12} className="CanvasHome__DocIcon" />
                    <span className="CanvasHome__DocCanvas">{item.canvas_name}</span>
                    <span className="CanvasHome__DocTitle">{item.title}</span>
                    <span className="CanvasHome__DocTime">{getRelativeTime(item.viewed_at)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* 즐겨찾기 문서 */}
        <div className="Widget">
          <div className="Widget__Header">
            <Star size={16} />
            <span className="Widget__Title">Starred Docs</span>
          </div>
          <div className="Widget__Body">
            {starredDocs.length === 0 ? (
              <div className="Widget__Empty">No starred docs</div>
            ) : (
              <div className="CanvasHome__DocList">
                {starredDocs.map((item) => (
                  <div
                    key={item.page_id}
                    className="CanvasHome__DocItem"
                    onClick={() => handleDocClick(item)}
                  >
                    <FileText size={12} className="CanvasHome__DocIcon" />
                    <span className="CanvasHome__DocCanvas">{item.canvas_name}</span>
                    <span className="CanvasHome__DocTitle">{item.title}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 구분선 + 전체 캔버스 목록 */}
      <div className="CanvasHome__Divider" />

      <div className="CanvasHome__ListSection">
        <div className="CanvasHome__SearchWrap">
          <Search size={16} />
          <input
            className="CanvasHome__SearchInput"
            type="text"
            placeholder="Search canvases..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {filteredCanvases.length === 0 ? (
          <div className="CanvasHome__Empty">
            {canvases.length === 0 ? (
              <>
                <p>No canvases yet.</p>
                <p>Create a canvas to start documenting.</p>
              </>
            ) : (
              <p>No canvases matching &quot;{query}&quot;</p>
            )}
          </div>
        ) : (
          <div className="CanvasHome__Grid">
            {filteredCanvases.map((canvas) => (
              <button
                key={canvas.canvas_id}
                className="CanvasHome__Card"
                onClick={() => router.push(`/canvas/${canvas.canvas_id}`)}
              >
                <div className="CanvasHome__CardHeader">
                  <span
                    className="CanvasHome__CardDot"
                    style={{ backgroundColor: canvas.color || '#16A34A' }}
                  />
                  <span className="CanvasHome__CardName">{canvas.canvas_name}</span>
                </div>
                {canvas.description && (
                  <p className="CanvasHome__CardDesc">{canvas.description}</p>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
