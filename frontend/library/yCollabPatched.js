/**
 * y-codemirror.next@0.3.5의 한글 IME composition 버그 패치
 *
 * 원인: ySync의 _observer가 ytext 변경 시 view.dispatch()를 동기 호출하여
 *       IME composition 중 changeset 길이 불일치 발생
 * ref: https://github.com/yjs/y-codemirror.next/pull/39
 *
 * 수정: EditorView 생성 후 ySync 플러그인의 observer를 찾아 래핑.
 *       composition 중에는 dispatch를 건너뛰고 compositionend 후 전체 재동기화.
 */
import { yCollab } from 'y-codemirror.next';

/**
 * EditorView 생성 후 호출하여 ySync의 observer를 패치
 */
export function patchYSync(view, ytext) {
  // EditorView 내부 plugins 배열에서 ySync 플러그인 찾기
  // ySync는 _ytext와 _observer 속성을 가진 ViewPlugin
  let ySyncValue = null;
  // CodeMirror 6의 view.plugins는 PluginInstance[] 형태
  // 각 인스턴스의 .value가 실제 플러그인 객체
  for (const p of view.plugins || []) {
    try {
      const val = p?.value;
      if (val && typeof val._observer === 'function' && val._ytext === ytext) {
        ySyncValue = val;
        break;
      }
    } catch (_) { /* 접근 불가 시 무시 */ }
  }

  if (!ySyncValue) return;

  const origObserver = ySyncValue._observer;
  ytext.unobserve(origObserver);

  const patchedObserver = (event, tr) => {
    if (view.composing) {
      // composition 중에는 dispatch 건너뜀
      // compositionend 후 재동기화 예약
      const syncAfterCompose = () => {
        view.contentDOM.removeEventListener('compositionend', syncAfterCompose);
        queueMicrotask(() => {
          const ytextStr = ytext.toString();
          const docStr = view.state.doc.toString();
          if (ytextStr !== docStr) {
            view.dispatch({
              changes: { from: 0, to: docStr.length, insert: ytextStr },
            });
          }
        });
      };
      view.contentDOM.addEventListener('compositionend', syncAfterCompose, { once: true });
      return;
    }
    // composition이 아니면 원본 observer 실행
    origObserver(event, tr);
  };

  ySyncValue._observer = patchedObserver;
  ytext.observe(patchedObserver);
}

export { yCollab };
