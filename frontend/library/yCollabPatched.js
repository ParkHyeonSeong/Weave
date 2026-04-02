/**
 * y-codemirror.next@0.3.5의 한글 IME composition 버그 패치
 *
 * 원인: ySync의 _observer가 ytext 변경 시 view.dispatch()를 동기 호출하여
 *       IME composition 중 changeset 길이 불일치 발생
 * ref: https://github.com/yjs/y-codemirror.next/pull/39
 *
 * 수정: ytext._eH.l (Yjs EventHandler 리스너 배열)에서 ySync observer를
 *       래핑. composition 중에는 dispatch를 건너뛰고 compositionend 후
 *       ytext 기준으로 CodeMirror 문서 재동기화.
 */
import { yCollab } from 'y-codemirror.next';

/**
 * EditorView 생성 후 호출하여 ySync observer를 IME-safe하게 래핑
 * @param {import('@codemirror/view').EditorView} view
 * @param {import('yjs').Text} ytext
 */
export function patchYSync(view, ytext) {
  // ytext._eH.l = ytext의 observe 리스너 배열 (Yjs 내부 EventHandler)
  const listeners = ytext._eH?.l;
  if (!listeners || listeners.length === 0) return;

  let compositionSyncScheduled = false;

  for (let i = 0; i < listeners.length; i++) {
    const orig = listeners[i];
    listeners[i] = (event, tr) => {
      if (view.composing) {
        // composition 중에는 ySync의 dispatch를 건너뜀
        // compositionend 후 전체 재동기화 1회 예약
        if (!compositionSyncScheduled) {
          compositionSyncScheduled = true;
          view.contentDOM.addEventListener('compositionend', () => {
            compositionSyncScheduled = false;
            queueMicrotask(() => {
              const ytextStr = ytext.toString();
              const docStr = view.state.doc.toString();
              if (ytextStr !== docStr) {
                view.dispatch({
                  changes: { from: 0, to: docStr.length, insert: ytextStr },
                });
              }
            });
          }, { once: true });
        }
        return;
      }
      orig(event, tr);
    };
  }
}

export { yCollab };
