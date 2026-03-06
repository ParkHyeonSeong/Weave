import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { Settings, Users } from 'lucide-react';
import { axios } from '@/library/_axios';
import SettingsGeneral from './SettingsGeneral';
import SettingsMembers from './SettingsMembers';

const SUB_TABS = [
  { key: 'general', label: 'General', icon: Settings },
  { key: 'members', label: 'Members', icon: Users },
];

export default function CanvasSettings() {
  const router = useRouter();
  const { canvasId } = router.query;
  const [canvas, setCanvas] = useState(null);
  const [activeSubTab, setActiveSubTab] = useState('general');

  useEffect(() => {
    if (!canvasId) return;
    fetchCanvas();
  }, [canvasId]);

  const fetchCanvas = async () => {
    try {
      const res = await axios.get(`/canvases/${canvasId}`);
      if (res.data.status) setCanvas(res.data.canvas);
      else router.replace('/canvas');
    } catch {
      router.replace('/canvas');
    }
  };

  if (!canvas) return null;

  const isAdmin = canvas.my_role === 'admin';

  return (
    <div className="CanvasSettings">
      <div className="CanvasSettings__Header">
        <span
          className="CanvasSettings__Dot"
          style={{ backgroundColor: canvas.color || '#16A34A' }}
        />
        <h1 className="CanvasSettings__Name">{canvas.canvas_name}</h1>
      </div>

      <div className="CanvasSettings__SubTabs">
        {SUB_TABS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            className={`CanvasSettings__SubTab ${activeSubTab === key ? 'CanvasSettings__SubTab--active' : ''}`}
            onClick={() => setActiveSubTab(key)}
          >
            <Icon size={14} />
            {label}
          </button>
        ))}
      </div>

      <div className="CanvasSettings__Content">
        {activeSubTab === 'general' && (
          <SettingsGeneral
            canvasId={canvasId}
            canvas={canvas}
            isAdmin={isAdmin}
            onUpdated={fetchCanvas}
          />
        )}
        {activeSubTab === 'members' && (
          <SettingsMembers canvasId={canvasId} isAdmin={isAdmin} />
        )}
      </div>
    </div>
  );
}
