/**
 * 브라우저 알림 요청 및 발송
 */
export function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

export function showNotification(senderName, content, message) {
  if ('Notification' in window && Notification.permission === 'granted') {
    // 탭이 포커스되어 있으면 알림 안 보냄
    if (document.hasFocus()) return;

    const displayContent = content
      || (message?.task_ref ? 'Shared a task' : null)
      || (message?.doc_ref ? 'Shared a document' : null)
      || '';

    const notification = new Notification('Weave', {
      body: `${senderName}: ${displayContent}`,
      icon: '/icons/weave_square.svg',
      tag: `weave-chat-${Date.now()}`,
    });

    notification.onclick = () => {
      window.focus();
      notification.close();
    };
  }
}
