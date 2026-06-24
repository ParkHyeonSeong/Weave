import { useEffect, useRef } from 'react';

/**
 * 탭이 다시 보일 때(+선택한 window 이벤트 발생 시) callback을 호출한다.
 * 백그라운드/오프라인 동안 놓친 데이터를 재동기화하는 용도(공용).
 * callback은 매 렌더 새로 와도 무방 — cbRef로 최신값을 잡는다.
 * @param {() => void} callback
 * @param {string[]} windowEvents 추가로 구독할 window 이벤트명 목록
 */
export default function useResyncOnVisible(callback, windowEvents = []) {
  const cbRef = useRef(callback);
  cbRef.current = callback;

  const eventsKey = windowEvents.join('|');  // 배열 리터럴을 매 렌더 넘겨도 재구독 안 되게 문자열 키로 비교
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') cbRef.current(); };
    const onEvent = () => cbRef.current();
    document.addEventListener('visibilitychange', onVisible);
    const evs = eventsKey ? eventsKey.split('|') : [];
    evs.forEach((e) => window.addEventListener(e, onEvent));
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      evs.forEach((e) => window.removeEventListener(e, onEvent));
    };
  }, [eventsKey]);
}
