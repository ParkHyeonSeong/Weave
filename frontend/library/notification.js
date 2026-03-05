/**
 * 브라우저 알림 요청 및 발송
 */
export function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

export function showNotification(senderName, content) {
  if ('Notification' in window && Notification.permission === 'granted') {
    // 탭이 포커스되어 있으면 알림 안 보냄
    if (document.hasFocus()) return;

    const notification = new Notification('Weave', {
      body: `${senderName}: ${content}`,
      icon: '/icons/weave_square.svg',
      tag: `weave-chat-${Date.now()}`,
    });

    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  }
}
