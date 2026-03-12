import { axios } from '@/library/_axios';

/**
 * Base64 URL 문자열을 Uint8Array로 변환
 */
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) {
    arr[i] = raw.charCodeAt(i);
  }
  return arr;
}

/**
 * ArrayBuffer를 Base64 문자열로 변환
 */
function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Push 알림 구독 등록
 * - VAPID 공개키를 서버에서 가져오고
 * - PushManager로 구독 생성 후
 * - 서버에 구독 정보 전송
 */
export async function subscribeToPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  if (Notification.permission !== 'granted') return;

  try {
    const registration = await navigator.serviceWorker.ready;

    // VAPID 공개키 가져오기
    const res = await axios.get('/push/vapid-key');
    if (!res.data.status || !res.data.vapid_key) return;

    const applicationServerKey = urlBase64ToUint8Array(res.data.vapid_key);

    // 기존 구독 확인 또는 새로 구독
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey,
      });
    }

    // 서버에 구독 정보 전송
    const p256dh = arrayBufferToBase64(subscription.getKey('p256dh'));
    const auth = arrayBufferToBase64(subscription.getKey('auth'));

    await axios.post('/push/subscribe', {
      endpoint: subscription.endpoint,
      p256dh,
      auth,
    });
  } catch (e) {
    // Push 구독 실패 시 서비스 중단 없이 무시
    console.warn('Push subscription failed:', e);
  }
}

/**
 * Push 알림 구독 해제 (로그아웃 시 호출)
 */
export async function unsubscribeFromPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;

  try {
    const registration = await navigator.serviceWorker.ready;
    const subscription = await registration.pushManager.getSubscription();
    if (subscription) {
      await axios.delete('/push/unsubscribe', {
        data: { endpoint: subscription.endpoint },
      });
      await subscription.unsubscribe();
    }
  } catch (e) {
    console.warn('Push unsubscribe failed:', e);
  }
}
