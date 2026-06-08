import { useState, useEffect, useMemo } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { getWsBaseURL } from '@/library/_axios';

export default function useScrumWeekCollab(boardId, weekId, user) {
  const [status, setStatus] = useState('connecting');
  const [connectedUsers, setConnectedUsers] = useState([]);
  const [ydoc, setYdoc] = useState(null);
  const [provider, setProvider] = useState(null);

  const userColor = useMemo(() => {
    const colors = ['#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F', '#BB8FCE', '#85C1E9', '#F1948A', '#82E0AA'];
    return colors[(user?.user_id || 0) % colors.length];
  }, [user?.user_id]);

  useEffect(() => {
    if (!boardId || !weekId || !user) return;
    const doc = new Y.Doc();
    const serverUrl = `${getWsBaseURL()}/api/ws/scrum/${boardId}/weeks`;
    const prov = new WebsocketProvider(serverUrl, String(weekId), doc, { connect: true });
    prov.awareness.setLocalStateField('user', { name: user.username, color: userColor, userId: user.user_id });
    prov.on('status', ({ status: s }) => setStatus(s));
    const update = () => {
      const arr = [];
      prov.awareness.getStates().forEach((st, clientId) => { if (st.user) arr.push({ clientId, ...st.user }); });
      setConnectedUsers(arr);
    };
    prov.awareness.on('change', update); update();
    setYdoc(doc); setProvider(prov);
    return () => {
      prov.awareness.off('change', update);
      prov.disconnect(); prov.destroy(); doc.destroy();
      setYdoc(null); setProvider(null);
    };
  }, [boardId, weekId, user?.user_id]);

  return { ydoc, provider, status, connectedUsers };
}
