import { refreshAccessToken } from '@/library/_axios';

/**
 * y-websocket은 토큰을 다시 받지 않고 ~100ms 뒤 자동 재연결한다. 서버가 토큰 만료로
 * 끊으면 그 재연결이 만료 쿠키로 4001을 맞을 수 있어, 재연결을 refresh 완료 뒤로 미룬다:
 * shouldConnect=false로 예약된 setupWS를 무력화 → refresh(크로스탭 single-flight) → connect().
 * (connection-close 핸들러 안에서 disconnect()를 부르면 동기 재귀 close가 나므로 shouldConnect만 끈다.)
 * detach()를 provider.destroy() 전에 호출해 리스너 누수/언마운트 후 재연결을 막는다.
 */
export function attachWsTokenRefresh(provider) {
  let healing = false;
  let detached = false;
  const heal = async () => {
    if (healing || detached) return;
    healing = true;
    try {
      provider.shouldConnect = false;  // 예약된 자동재연결 no-op화
      await refreshAccessToken();        // #2a: 브라우저당 1회 직렬화
    } catch {
      // refresh 실패해도 finally에서 재연결 시도(다음 close 때 다시 갱신)
    } finally {
      try {
        if (!detached) provider.connect(); // 새 쿠키로 재연결(shouldConnect=true)
      } finally {
        healing = false;                   // connect()가 던져도 항상 해제(영구 healing 방지)
      }
    }
  };
  provider.on('connection-close', heal);
  provider.on('connection-error', heal);
  return () => {
    detached = true;
    provider.off('connection-close', heal);
    provider.off('connection-error', heal);
  };
}
