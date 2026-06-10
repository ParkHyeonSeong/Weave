import { useState, useEffect, useMemo } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { getWsBaseURL } from '@/library/_axios';
import { userColor as avatarColor } from '@/library/userAvatar';

export default function useScrumRetroCollab(boardId, retroId, user) {
  const [status, setStatus] = useState('connecting');
  const [connectedUsers, setConnectedUsers] = useState([]);
  const [ydoc, setYdoc] = useState(null);
  const [provider, setProvider] = useState(null);

  // 색상: 공용 아바타 팔레트와 동일 (사용자 지정색 우선)
  const userColor = useMemo(
    () => avatarColor(user?.user_id, user?.avatar_color),
    [user?.user_id, user?.avatar_color],
  );

  useEffect(() => {
    if (!boardId || !retroId || !user) return;
    const doc = new Y.Doc();
    const serverUrl = `${getWsBaseURL()}/api/ws/scrum/${boardId}/retros`;
    const prov = new WebsocketProvider(serverUrl, String(retroId), doc, { connect: true });
    // 구버전 세션은 profile에 avatar_url이 없을 수 있어 별도 키로 폴백
    const avatarUrl = user.avatar_url ?? sessionStorage.getItem('avatar_url') ?? null;
    prov.awareness.setLocalStateField('user', {
      name: user.username,
      color: userColor,
      userId: user.user_id,
      avatar_url: avatarUrl || null,
      avatar_color: user.avatar_color ?? null,
    });
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
  }, [boardId, retroId, user?.user_id, user?.avatar_color, user?.avatar_url]);

  return { ydoc, provider, status, connectedUsers };
}
