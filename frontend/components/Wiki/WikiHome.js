import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { Plus, Users } from 'lucide-react';
import { axios } from '@/library/_axios';

export default function WikiHome() {
  const router = useRouter();
  const [canvases, setCanvases] = useState([]);

  const fetchCanvases = async () => {
    try {
      const res = await axios.get('/wiki/canvases');
      if (res.data.status) {
        setCanvases(res.data.canvases);
      }
    } catch {}
  };

  useEffect(() => {
    fetchCanvases();
  }, []);

  useEffect(() => {
    const handleRefresh = () => fetchCanvases();
    window.addEventListener('canvas:created', handleRefresh);
    return () => window.removeEventListener('canvas:created', handleRefresh);
  }, []);

  return (
    <div className="WikiHome">
      <div className="WikiHome__Header">
        <h2 className="WikiHome__Title">Wiki</h2>
        <button
          className="WikiHome__CreateBtn"
          onClick={() => window.dispatchEvent(new CustomEvent('layout:create-canvas'))}
        >
          <Plus size={16} />
          New Canvas
        </button>
      </div>

      {canvases.length === 0 ? (
        <div className="WikiHome__Empty">
          <p>No canvases yet.</p>
          <p>Create a canvas to start documenting.</p>
        </div>
      ) : (
        <div className="WikiHome__Grid">
          {canvases.map((canvas) => (
            <button
              key={canvas.canvas_id}
              className="WikiHome__Card"
              onClick={() => router.push(`/wiki/${canvas.canvas_id}`)}
            >
              <div className="WikiHome__CardHeader">
                <span
                  className="WikiHome__CardDot"
                  style={{ backgroundColor: canvas.color || '#16A34A' }}
                />
                <span className="WikiHome__CardName">{canvas.canvas_name}</span>
                <span className="WikiHome__CardKey">{canvas.key}</span>
              </div>
              {canvas.description && (
                <p className="WikiHome__CardDesc">{canvas.description}</p>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
