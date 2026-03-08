/**
 * 알림 사운드 재생 (Web Audio API)
 */
let audioCtx = null;

export function playNotificationSound() {
  try {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, audioCtx.currentTime);
    osc.frequency.setValueAtTime(1046, audioCtx.currentTime + 0.08);

    gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.25);

    osc.start(audioCtx.currentTime);
    osc.stop(audioCtx.currentTime + 0.25);
  } catch (e) {
    // AudioContext not supported or user hasn't interacted yet
  }
}

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
