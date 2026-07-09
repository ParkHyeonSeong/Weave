// 칩(taskRef/issueRef/docRef) ↔ 내부 URL 링크 md 변환 공용 헬퍼 (스펙 §3.2)
// 내부 경로 판별은 BookmarkPastePlugin의 단일 정규식을 재사용한다 (중복 정의 금지).
import { ISSUE_PATH, TASK_PATH, DOC_PATH } from './BookmarkPastePlugin';

export { ISSUE_PATH, TASK_PATH, DOC_PATH };

// SSR/headless(node 테스트)에서는 상대경로로 직렬화된다
export function internalOrigin() {
  return typeof window !== 'undefined' ? window.location.origin : '';
}

// md 링크 텍스트 문법을 깨는 문자 이스케이프
export function escapeLinkText(text) {
  return String(text ?? '').replace(/([\\[\]])/g, '\\$1');
}

function unescapeLinkText(text) {
  return String(text ?? '').replace(/\\([\\[\]])/g, '$1');
}

// src 선두의 md 링크가 내부 경로면 { raw, text, pathname } 반환, 아니면 null.
// 상대경로(/시작)는 그대로, 절대 URL은 same-origin일 때만 내부로 취급.
export function matchInternalLink(src) {
  const m = /^\[((?:\\.|[^\]\\])*)\]\(([^)\s]+)\)/.exec(src);
  if (!m) return null;
  const [raw, rawText, href] = m;
  let pathname = null;
  if (href.startsWith('/')) {
    pathname = href;
  } else {
    try {
      const url = new URL(href);
      const origin = internalOrigin();
      if (origin && url.origin === origin) pathname = url.pathname;
    } catch {
      return null;
    }
  }
  if (!pathname) return null;
  return { raw, text: unescapeLinkText(rawText), pathname };
}

// 'WV-12 로그인 버그' → { displayId: 'WV-12', title: '로그인 버그' } — 접두 없으면 displayId ''.
// task/issue 공통 display_id 형식은 `{branch_key}-{number}` (backend task_issue.py:82 실측).
export function splitRefLinkText(text) {
  const m = /^([A-Za-z][A-Za-z0-9_]*-\d+)\s+([\s\S]+)$/.exec(text);
  if (m) return { displayId: m[1], title: m[2] };
  return { displayId: '', title: text };
}
