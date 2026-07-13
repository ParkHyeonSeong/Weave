import { describe, it, expect } from 'vitest';
import StarterKit from '@tiptap/starter-kit';
import { getMarkdownManager } from './markdownCodec';
import { matchInternalLink, encodeMarkdownUrl } from '@/components/Canvas/extensions/refMarkdown';
import TaskRefNode from '@/components/Canvas/extensions/TaskRefExtension';
import IssueRefNode from '@/components/Canvas/extensions/IssueRefExtension';
import DocRefNode from '@/components/Canvas/extensions/DocRefExtension';
import MentionNode from '@/components/Canvas/extensions/MentionExtension';
import CalloutExtension from '@/components/Canvas/extensions/CalloutExtension';
import MermaidExtension from '@/components/Canvas/extensions/MermaidExtension';
import BookmarkNode from '@/components/Canvas/extensions/BookmarkExtension';

const FULL = [StarterKit, TaskRefNode, IssueRefNode, DocRefNode, MentionNode, CalloutExtension, MermaidExtension, BookmarkNode];
const NO_MERMAID = [StarterKit, TaskRefNode]; // 댓글류 표면 모사
const mgr = () => getMarkdownManager(FULL);

const para = (...inline) => ({ type: 'doc', content: [{ type: 'paragraph', content: inline }] });
const findNode = (json, type) => {
  const out = [];
  const walk = (n) => { if (n.type === type) out.push(n); (n.content || []).forEach(walk); };
  walk(json);
  return out;
};

describe('taskRef', () => {
  const chip = { type: 'taskRef', attrs: { taskId: 12, branchId: 3, displayId: 'WV-12', title: '로그인 버그' } };
  it('직렬화: 내부 URL 링크 강등 (headless=상대경로)', () => {
    expect(mgr().serialize(para(chip)).trim()).toBe('[WV-12 로그인 버그](/branch/3/task/12)');
  });
  it('파싱: 내부 task 링크 → 칩 복원 (displayId 접두 분리)', () => {
    const json = mgr().parse('[WV-12 로그인 버그](/branch/3/task/12)');
    expect(findNode(json, 'taskRef')[0].attrs).toMatchObject({ taskId: 12, branchId: 3, displayId: 'WV-12', title: '로그인 버그' });
  });
  it('왕복 보존', () => {
    const md = '[WV-12 로그인 버그](/branch/3/task/12)';
    expect(mgr().serialize(mgr().parse(md)).trim()).toBe(md);
  });
  it('외부 링크는 칩이 되지 않는다', () => {
    expect(findNode(mgr().parse('[ext](https://example.com/branch/3/task/12)'), 'taskRef')).toHaveLength(0);
  });
  it('제목의 대괄호는 이스케이프 왕복된다', () => {
    const c = { ...chip, attrs: { ...chip.attrs, title: '[중요] 버그' } };
    const md = mgr().serialize(para(c)).trim();
    expect(md).toBe('[WV-12 \\[중요\\] 버그](/branch/3/task/12)');
    expect(findNode(mgr().parse(md), 'taskRef')[0].attrs.title).toBe('[중요] 버그');
  });
});

describe('issueRef / docRef', () => {
  it('issue 경로는 taskRef가 아니라 issueRef로 복원된다', () => {
    const json = mgr().parse('[WV-7 재현 절차](/branch/3/task/12/issue/7)');
    expect(findNode(json, 'issueRef')[0].attrs).toMatchObject({ branchId: 3, taskId: 12, issueId: 7, displayId: 'WV-7', title: '재현 절차' });
    expect(findNode(json, 'taskRef')).toHaveLength(0);
  });
  it('issueRef 직렬화', () => {
    const chip = { type: 'issueRef', attrs: { issueId: 7, taskId: 12, branchId: 3, displayId: 'WV-7', title: '재현 절차' } };
    expect(mgr().serialize(para(chip)).trim()).toBe('[WV-7 재현 절차](/branch/3/task/12/issue/7)');
  });
  it('docRef 왕복', () => {
    const md = '[설계 문서](/canvas/5/77)';
    const json = mgr().parse(md);
    expect(findNode(json, 'docRef')[0].attrs).toMatchObject({ canvasId: 5, pageId: 77, title: '설계 문서' });
    expect(mgr().serialize(json).trim()).toBe(md);
  });
});

describe('mention / bookmark (강등 전용)', () => {
  it('mention → @username 평문', () => {
    const m = { type: 'mention', attrs: { userId: 7, username: 'alice' } };
    expect(mgr().serialize(para({ type: 'text', text: '안녕 ' }, m)).trim()).toBe('안녕 @alice');
  });
  it('bookmark → URL 링크 한 줄', () => {
    const b = { type: 'doc', content: [{ type: 'bookmark', attrs: { url: 'https://example.com', title: 'Example' } }] };
    expect(mgr().serialize(b).trim()).toBe('[Example](https://example.com)');
  });
  it('bookmark URL의 괄호는 %28/%29로 인코딩된다 (unbalanced 괄호가 링크 문법을 깨는 것 방지)', () => {
    const b = { type: 'doc', content: [{ type: 'bookmark', attrs: { url: 'https://example.com/a)b', title: 't' } }] };
    expect(mgr().serialize(b).trim()).toBe('[t](https://example.com/a%29b)');
  });
});

describe('mermaid', () => {
  it('직렬화: data-source 원문 펜스', () => {
    const d = { type: 'doc', content: [{ type: 'mermaid', attrs: { source: 'graph TD\n  A --> B' } }] };
    expect(mgr().serialize(d).trim()).toBe('```mermaid\ngraph TD\n  A --> B\n```');
  });
  it('파싱: 펜스 → mermaid 노드', () => {
    const json = mgr().parse('```mermaid\ngraph TD\n  A --> B\n```');
    expect(findNode(json, 'mermaid')[0].attrs.source).toBe('graph TD\n  A --> B');
  });
  it('mermaid 노드 없는 표면에선 일반 코드블록으로 강등(무음 드롭 금지)', () => {
    getMarkdownManager(FULL); // mermaid 토크나이저가 등록된 매니저 선생성 — 전역 오염 시 아래가 깨진다
    const json = getMarkdownManager(NO_MERMAID).parse('```mermaid\ngraph TD\n```');
    expect(findNode(json, 'mermaid')).toHaveLength(0);
    const code = findNode(json, 'codeBlock');
    expect(code).toHaveLength(1);
    expect(code[0].content[0].text).toBe('graph TD');
  });
});

describe('callout', () => {
  it(':::callout 블록 디렉티브 왕복', () => {
    const md = ':::callout {type="warning"}\n\n주의하세요\n\n:::';
    const json = mgr().parse(md);
    const callout = findNode(json, 'callout')[0];
    expect(callout.attrs.type).toBe('warning');
    expect(mgr().serialize(json).trim()).toBe(md);
  });
});

describe('encodeMarkdownUrl', () => {
  it('괄호만 percent-encode, 나머지 불변·멱등(이중 인코딩 없음)', () => {
    expect(encodeMarkdownUrl('https://x.com/a(b)c')).toBe('https://x.com/a%28b%29c');
    expect(encodeMarkdownUrl('https://x.com/a%28b%29c')).toBe('https://x.com/a%28b%29c');
    expect(encodeMarkdownUrl('')).toBe('');
  });
  it('percent-encoded 문자가 있어도 내부 링크 매치가 깨지지 않는다', () => {
    const m = matchInternalLink('[t](/branch/3/task/12?q=%28x%29)');
    expect(m).not.toBeNull();
    expect(m.pathname.startsWith('/branch/3/task/12')).toBe(true);
  });
});
