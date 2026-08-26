// mermaid 렌더 직렬화 큐 — mermaid를 import하지 않는 순수 모듈(node 환경 테스트 가능).
//
// mermaid.render(id, text)는 테마를 인자로 받지 않고(mermaidAPI.d.ts:82) 렌더 시점의
// 전역 config를 읽는다. 테마를 세팅하는 initialize는 반환값 없는 전역 뮤테이션이다
// (mermaid.d.ts:64). 따라서 "initialize(theme) → render()"는 원자적으로 실행돼야 한다 —
// 한 문서의 N개 MermaidView가 동시에 이 쌍에 진입하면 블록마다 테마가 갈린다.
//
// 의미론은 하나다 — **실행 시점 최신 테마**. 테마를 값이 아니라 함수로 받아 태스크가
// 실행되는 순간 호출한다. 큐에 들어간 뒤 테마가 또 바뀌면 최신 테마로 그리므로
// rapid toggle 후 N개 블록이 같은 최종 테마로 수렴한다(enqueue 시점 값을 캡처하지 않는다).
//
// 취소는 이 큐의 책임이 아니다. 늦게 도착한 결과를 버리는 것은 소비처(effect)가
// per-run 지역 플래그로 한다 — 공유 ref를 쓰면 cleanup이 세운 플래그를 다음 effect가
// 즉시 되돌려 옛 결과가 통과한다.

export function createMermaidRenderQueue({ initialize, render }) {
  let chain = Promise.resolve();
  let appliedTheme = null;

  function enqueue(getTheme, id, text) {
    const task = chain.then(async () => {
      const theme = getTheme();
      if (theme !== appliedTheme) {
        await initialize(theme);
        // initialize가 던지면 여기 도달하지 않는다 → 다음 요청이 재시도한다.
        appliedTheme = theme;
      }
      return render(id, text);
    });
    // 한 건의 실패가 큐를 영구히 막지 않게 한다. 거부는 호출자에게만 전달된다.
    chain = task.then(() => undefined, () => undefined);
    return task;
  }

  return { enqueue, appliedTheme: () => appliedTheme };
}
