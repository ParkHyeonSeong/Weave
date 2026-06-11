// ref 제안 팝업(taskRef/docRef/issueRef/mention/슬래시 메뉴) 공용 plugin state 헬퍼.

import { PluginKey, TextSelection } from '@tiptap/pm/state';
import { ReactRenderer } from '@tiptap/react';

const OFF = { active: false, keyword: '', from: 0 };

// 슬래시 메뉴 plugin key — ref 확장들의 onBack(커맨드 메뉴 복귀)과
// SlashCommandsExtension이 함께 쓰므로 순환 import를 피해 여기에 둔다.
export const slashCommandPluginKey = new PluginKey('slashCommandMenu');

// 검색 input 모드: 검색어가 문서에 없으므로 active 동안은 칩이 삽입될
// 앵커 위치만 원격 편집을 따라가면 된다. 앵커가 지워지면 닫는다.
export function mapAnchor(tr, prev, off) {
  const r = tr.mapping.mapResult(prev.from);
  if (r.deleted) return off;
  return r.pos === prev.from ? prev : { ...prev, from: r.pos };
}

// ref 검색 팝업(taskRef/docRef/issueRef 공용) plugin view 팩토리.
// 팝업 생명주기·앵커 좌표·포커스 복원·커맨드 메뉴 복귀(onBack)를 담당하고,
// 종류별 차이(검색 컴포넌트·칩 attrs)는 buildProps로 주입받는다.
export function createSuggestionPopupView({ editor, pluginKey, off, Popup, buildProps }) {
  return (editorView) => {
    let popup = null;
    let renderer = null;
    let lastState = null; // 상태 불변 시 updateProps 리렌더 스킵용

    function focusEditorAt(pos) {
      const { state } = editorView;
      const clamped = Math.min(pos, state.doc.content.size);
      editorView.dispatch(state.tr.setSelection(TextSelection.create(state.doc, clamped)));
      editorView.focus();
    }

    // Esc·외부클릭: 문서 무변경으로 닫고 앵커로 커서 복원
    function close() {
      const st = pluginKey.getState(editorView.state);
      if (!st.active) return;
      editorView.dispatch(editorView.state.tr.setMeta(pluginKey, off));
      focusEditorAt(st.from);
    }

    // 빈 input Backspace: 앵커에 '/'를 되살려 커맨드 메뉴를 같은 자리에서 다시 연다
    function backToMenu() {
      const st = pluginKey.getState(editorView.state);
      if (!st.active) return;
      let tr = editorView.state.tr.insertText('/', st.from);
      tr = tr.setSelection(TextSelection.create(tr.doc, st.from + 1));
      tr = tr.setMeta(pluginKey, off);
      tr = tr.setMeta(slashCommandPluginKey, { active: true, query: '/', from: st.from, index: 0 });
      editorView.dispatch(tr);
      editorView.focus();
    }

    // 선택 확정: 앵커에 칩 삽입 + 커서를 칩 뒤로
    function insertRefNode(typeName, attrs) {
      const st = pluginKey.getState(editorView.state);
      if (!st.active) return;
      const node = editorView.state.schema.nodes[typeName].create(attrs);
      let tr = editorView.state.tr.replaceWith(st.from, st.from, node);
      tr = tr.setSelection(TextSelection.create(tr.doc, st.from + node.nodeSize));
      tr = tr.setMeta(pluginKey, off);
      editorView.dispatch(tr);
      editorView.focus();
    }

    function destroyPopup() {
      if (renderer) { renderer.destroy(); renderer = null; }
      if (popup) { popup.remove(); popup = null; }
    }

    function createPopup(pluginState) {
      destroyPopup();
      // viewport 기준 fixed + body append → 컨테이너 종류/클리핑 무관하게 정확히 뜸
      const coords = editorView.coordsAtPos(
        Math.min(pluginState.from, editorView.state.doc.content.size),
      );
      popup = document.createElement('div');
      popup.style.position = 'fixed';
      // 우측 가장자리에서 화면 밖으로 넘치지 않게 left 클램프
      popup.style.left = `${Math.min(coords.left, window.innerWidth - 360)}px`;
      popup.style.top = `${coords.bottom + 4}px`;
      popup.style.zIndex = '500';
      // 리스트 클릭 등 내부 인터랙션이 검색 input의 blur를 일으키지 않게 한다
      popup.addEventListener('mousedown', (e) => {
        if (e.target.tagName !== 'INPUT') e.preventDefault();
      });
      document.body.appendChild(popup);
      // 화면 아래로 넘치면 커서 위로 뒤집어 띄움
      requestAnimationFrame(() => {
        if (!popup) return;
        const h = popup.offsetHeight;
        if (h && coords.bottom + h + 8 > window.innerHeight) {
          popup.style.top = `${Math.max(8, coords.top - h - 4)}px`;
        }
      });
      renderer = new ReactRenderer(Popup, {
        editor,
        props: buildProps(pluginState, { close, backToMenu, insertRefNode }),
      });
      popup.appendChild(renderer.element);
    }

    return {
      update(view) {
        const st = pluginKey.getState(view.state);
        if (st === lastState) return;
        lastState = st;
        if (st.active) {
          if (renderer) renderer.updateProps(buildProps(st, { close, backToMenu, insertRefNode }));
          else createPopup(st);
        } else {
          destroyPopup();
        }
      },
      destroy() { destroyPopup(); },
    };
  };
}

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
