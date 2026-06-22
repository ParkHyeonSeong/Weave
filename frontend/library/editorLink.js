import { isAllowedUri } from '@tiptap/extension-link';

// 스크럼 셀 / Canvas 에디터 공용 링크 헬퍼.
// TipTap setLink는 (1) bare domain을 정규화하지 않고 (2) isAllowedUri 실패 시
// 조용히 no-op이며 (3) 빈 선택에서는 stored mark만 저장해 화면에 아무것도 안 남긴다.
// 이 세 가지를 한곳에서 처리해 Scrum·Canvas 두 툴바와 hover 팝오버가 같은 로직을 공유한다.

// href 안전성 판단은 TipTap의 공개 isAllowedUri를 그대로 재사용한다.
// 기본 허용 스킴 = http/https/ftp/ftps/mailto/tel/callto/sms/cid/xmpp + 경로/앵커.
// 에디터가 custom protocols를 쓰지 않으므로 인자 없이 호출해도 렌더 가드와 동일한 정책이다.
export function isSafeLinkHref(href) {
  // isAllowedUri는 falsy uri를 허용(true)하므로 빈 값은 직접 거른다(라이브 검증 재사용 대비).
  return !!href && !!isAllowedUri(href);
}

// '//' 없이 쓰는 알려진 스킴(mailto:foo 형태). http/https/ftp 등 authority 스킴은 '://'로 따로 처리.
const COLON_SCHEMES = ['mailto', 'tel', 'callto', 'sms', 'cid', 'xmpp'];

// 입력을 클릭 가능한 href로 정규화(스킴/경로 보존, bare domain·host:port만 https).
// 안전성(javascript: 차단 등)은 여기서 판단하지 않고 isSafeLinkHref가 담당한다.
export function normalizeLinkHref(raw) {
  const v = (raw || '').trim();
  if (!v) return '';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) return v;        // scheme://authority… (http/https/ftp…)
  const m = v.match(/^([a-z][a-z0-9+.-]*):(.*)$/i);        // scheme:rest 후보
  if (m) {
    if (COLON_SCHEMES.includes(m[1].toLowerCase())) return v;  // mailto:/tel:/sms: 등 알려진 스킴 보존
    if (/^\d/.test(m[2])) return `https://${v}`;               // host:port[/path] → bare URL(example.com:8080)
    return v;                                                  // 기타 스킴형은 보존(javascript: 등은 isSafeLinkHref가 차단)
  }
  if (/^(\/\/|\/|\.\/|\.\.\/|#|\?)/.test(v)) return v;     // 프로토콜상대·루트/상대경로·앵커·쿼리 보존
  if (/^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/.test(v)) return `mailto:${v}`;  // 이메일(TLD는 문자, host:port 오분류 방지)
  return `https://${v}`;                                   // bare domain → https
}

// prompt/팝오버 등에서 받은 입력을 에디터에 적용한다.
//  - 빈 입력 → 현재 링크 해제
//  - 위험 href → no-op (setLink의 기존 무음-false 동작과 일치)
//  - 빈 선택 & 기존 링크 아님 → URL을 클릭 가능한 텍스트로 삽입(+ stored mark 제거로 연속 입력 차단)
//  - 그 외(선택 있음/기존 링크 위) → 링크 mark 적용·갱신
// 커서/선택이 '기존 링크를 편집하는' 대상인지 판단(오른쪽 inclusive 경계 제외).
//  - 선택 있음 → isActive('link')
//  - 빈 선택 → 커서 오른쪽(nodeAfter)에 link mark가 있을 때만(내부·왼쪽 경계·단일문자 링크).
//    오른쪽 경계(nodeAfter가 비링크/null)는 편집 아님 → 새 링크 삽입/무시.
// 분기·프롬프트 prefill·빈 입력 해제가 모두 이 판단을 공유해 오른쪽 경계에서 이전 링크를
// 잘못 잡는 불일치(prefill에 이전 href, 빈 입력 시 이전 링크 삭제)를 막는다.
export function isEditingLink(editor) {
  if (!editor) return false;
  const linkType = editor.schema.marks.link;
  if (!linkType) return false;
  const sel = editor.state.selection;
  if (!sel.empty) return editor.isActive('link');
  return !!(sel.$from.nodeAfter && linkType.isInSet(sel.$from.nodeAfter.marks));
}

// prompt/팝오버 등에서 받은 입력을 에디터에 적용한다.
//  - 빈 입력 → 편집 대상 링크만 해제(오른쪽 경계의 이전 링크는 건드리지 않음)
//  - 위험 href → no-op
//  - 편집 대상 아님(빈 선택) → URL을 클릭 가능한 텍스트로 삽입(+ stored mark 제거로 연속 입력 차단)
//  - 그 외(편집 대상/선택 있음) → 링크 mark 적용·갱신
export function applyLinkValue(editor, raw) {
  if (!editor) return;
  const v = (raw || '').trim();
  const editing = isEditingLink(editor);
  if (v === '') {
    if (editing) editor.chain().focus().extendMarkRange('link').unsetLink().run();
    return;
  }
  const href = normalizeLinkHref(v);
  if (!isSafeLinkHref(href)) return;
  if (editor.state.selection.empty && !editing) {
    editor.chain().focus()
      .insertContent({ type: 'text', text: v, marks: [{ type: 'link', attrs: { href } }] })
      .unsetMark('link')   // collapsed 커서의 link mark 제거 → inclusive(autolink) 설정과 무관하게 연속 입력 차단
      .run();
  } else {
    editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
  }
}

// 링크 버튼/팝오버 편집용 prompt 래퍼. 편집 대상일 때만 기존 href를 prefill.
export function promptSetLink(editor) {
  if (!editor) return;
  const prev = isEditingLink(editor) ? (editor.getAttributes('link').href || '') : '';
  const url = window.prompt('링크 URL', prev);
  if (url === null) return;   // 취소
  applyLinkValue(editor, url);
}
