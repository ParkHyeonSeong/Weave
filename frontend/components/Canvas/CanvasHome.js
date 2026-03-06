import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { Plus, Users } from 'lucide-react';
import { axios } from '@/library/_axios';

export default function CanvasHome() {
  const router = useRouter();
  const [canvases, setCanvases] = useState([]);

  const fetchCanvases = async () => {
    try {
      const res = await axios.get('/canvases');
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

      {canvases.length === 0 ? (
        <div className="CanvasHome__Empty">
          <p>No canvases yet.</p>
          <p>Create a canvas to start documenting.</p>
        </div>
      ) : (
        <div className="CanvasHome__Grid">
          {canvases.map((canvas) => (
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
  );
}
