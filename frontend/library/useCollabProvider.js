import { useState, useEffect, useMemo } from 'react';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import { getWsBaseURL } from '@/library/_axios';

/**
 * Yjs collaboration provider 관리 훅
 * @param {number} canvasId
 * @param {number} pageId
 * @param {object} user - { user_id, username }
 * @returns {{ ydoc, provider, status, connectedUsers }}
 */
export default function useCollabProvider(canvasId, pageId, user) {
  const [status, setStatus] = useState('connecting');
  const [connectedUsers, setConnectedUsers] = useState([]);
  const [ydoc, setYdoc] = useState(null);
  const [provider, setProvider] = useState(null);

  // 색상 생성 (user_id 기반 일관된 색상)
  const userColor = useMemo(() => {
    const colors = [
      '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4',
      '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F',
      '#BB8FCE', '#85C1E9', '#F1948A', '#82E0AA',
    ];
    return colors[(user?.user_id || 0) % colors.length];
  }, [user?.user_id]);

  useEffect(() => {
    if (!canvasId || !pageId || !user) return;

    const doc = new Y.Doc();

    // WebSocket URL 구성: axios base URL 기반
    // y-websocket은 `${serverUrl}/${roomname}` 형태로 연결
    const serverUrl = `${getWsBaseURL()}/api/ws/canvas/${canvasId}/pages`;

    // 쿠키가 cross-port에서 안 붙을 수 있으므로 token을 query param으로도 전달
    const token = document.cookie
      .split('; ')
      .find((c) => c.startsWith('weave_token='))
      ?.split('=')[1] || '';

    const prov = new WebsocketProvider(
      serverUrl,
      String(pageId),
      doc,
      { connect: true, params: { token } }
    );

    // Awareness에 사용자 정보 설정
    prov.awareness.setLocalStateField('user', {
      name: user.username,
      color: userColor,
      userId: user.user_id,
    });

    // 연결 상태 이벤트
    prov.on('status', ({ status: s }) => {
      setStatus(s);
    });

    // Awareness 변경 이벤트 (접속자 목록)
    const updateConnectedUsers = () => {
      const states = prov.awareness.getStates();
      const users = [];
      states.forEach((state, clientId) => {
        if (state.user) {
          users.push({ clientId, ...state.user });
        }
      });
      setConnectedUsers(users);
    };

    prov.awareness.on('change', updateConnectedUsers);
    updateConnectedUsers();

    setYdoc(doc);
    setProvider(prov);

    return () => {
      prov.awareness.off('change', updateConnectedUsers);
      prov.disconnect();
      prov.destroy();
      doc.destroy();
      setYdoc(null);
      setProvider(null);
    };
  }, [canvasId, pageId, user?.user_id]);

  return {
    ydoc,
    provider,
    status,
    connectedUsers,
    userColor,
  };
}
