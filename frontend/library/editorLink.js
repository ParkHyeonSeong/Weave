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

// 입력을 클릭 가능한 href로 정규화(스킴/경로 보존, bare domain만 https).
// 안전성(javascript: 차단 등)은 여기서 판단하지 않고 isSafeLinkHref가 담당한다.
export function normalizeLinkHref(raw) {
  const v = (raw || '').trim();
  if (!v) return '';
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return v;            // 스킴 존재(http: ftp: mailto: tel: sms: callto: …)
  if (/^(\/\/|\/|\.\/|\.\.\/|#|\?)/.test(v)) return v;     // 프로토콜상대·루트/상대경로·앵커·쿼리 보존
  if (/^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/.test(v)) return `mailto:${v}`;  // 이메일(TLD는 문자, host:port 오분류 방지)
  return `https://${v}`;                                   // bare domain → https
}

// prompt/팝오버 등에서 받은 입력을 에디터에 적용한다.
//  - 빈 입력 → 현재 링크 해제
//  - 위험 href → no-op (setLink의 기존 무음-false 동작과 일치)
//  - 빈 선택 & 기존 링크 아님 → URL을 클릭 가능한 텍스트로 삽입(+ stored mark 제거로 연속 입력 차단)
//  - 그 외(선택 있음/기존 링크 위) → 링크 mark 적용·갱신
export function applyLinkValue(editor, raw) {
  if (!editor) return;
  const v = (raw || '').trim();
  if (v === '') { editor.chain().focus().extendMarkRange('link').unsetLink().run(); return; }
  const href = normalizeLinkHref(v);
  if (!isSafeLinkHref(href)) return;
  const { empty } = editor.state.selection;
  if (empty && !editor.isActive('link')) {
    editor.chain().focus()
      .insertContent({ type: 'text', text: v, marks: [{ type: 'link', attrs: { href } }] })
      .unsetMark('link')   // collapsed 커서의 link mark 제거 → inclusive(autolink) 설정과 무관하게 연속 입력 차단
      .run();
  } else {
    editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
  }
}

// 링크 버튼/팝오버 편집용 prompt 래퍼.
export function promptSetLink(editor) {
  if (!editor) return;
  const prev = editor.getAttributes('link').href || '';
  const url = window.prompt('링크 URL', prev);
  if (url === null) return;   // 취소
  applyLinkValue(editor, url);
}
