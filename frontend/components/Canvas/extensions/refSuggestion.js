// ref 제안 팝업(taskRef/docRef/issueRef/mention/슬래시 메뉴) 공용 plugin state 헬퍼.

const OFF = { active: false, keyword: '', from: 0 };

// 활성 토큰(prevFrom에서 시작해 커서까지)을 현재 상태에서 다시 찾는다.
// 저장된 시작 위치는 tr.mapping으로 따라가야 원격 편집에도 안전하다.
export function mapTokenBeforeCursor(prevFrom, tr, newState) {
  const from = tr.mapping.map(prevFrom);
  const $pos = newState.selection.$from;
  const fromIdx = from - $pos.start();
  const toIdx = newState.selection.from - $pos.start();
  if (fromIdx < 0 || toIdx < fromIdx) return null;
  return { from, text: $pos.parent.textBetween(fromIdx, toIdx, null, '￼') };
}

// 활성 중 문서 변경(타이핑·undo·붙여넣기·원격 편집 등) 시 토큰을 동기 재파싱해
// 키워드를 갱신한다. (기존 handleTextInput의 setTimeout 갱신은 삽입 트랜잭션의
// docChanged 리셋과 레이스가 나서 첫 글자 입력 즉시 팝업이 닫혔음)
export function reparseSuggestion(prev, tr, newState, re, off = OFF) {
  const token = mapTokenBeforeCursor(prev.from, tr, newState);
  const m = token && token.text.match(re);
  if (!m) return off;
  if (m[1] === prev.keyword && token.from === prev.from) return prev;
  return { ...prev, keyword: m[1], from: token.from };
}

// 트리거 문자('@'/'/') 입력 시 제안 상태 활성화. handleTextInput은 삽입 트랜잭션
// 이전에 불리므로 활성화는 한 틱 미루고, 콜백 시점 상태에서 트리거 문자 위치와
// 단어 시작(앞이 공백/문단 시작) 조건을 다시 검증한다 — 삽입과 콜백 사이에
// 원격 편집이 끼어들면 캡처해 둔 위치·전제조건이 어긋날 수 있어서다.
export function scheduleTriggerActivation(view, char, pluginKey, meta) {
  setTimeout(() => {
    const s = view.state;
    const pos = s.selection.from - 1;
    if (pos < 1 || s.doc.textBetween(pos, pos + 1, null, '￼') !== char) return;
    const before = s.doc.textBetween(Math.max(0, pos - 1), pos, null, '￼');
    if (before && !/\s/.test(before)) return;
    view.dispatch(s.tr.setMeta(pluginKey, { ...meta, from: pos }));
  }, 0);
}
