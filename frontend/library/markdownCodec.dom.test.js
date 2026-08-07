// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { Editor, generateJSON } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import {
  buildMarkdownExtensions, docToMarkdown, sliceToMarkdown,
  htmlToMarkdown, markdownToEditorHtml, findUnsupportedFormatting,
} from './markdownCodec';
import { markdownToHtml } from './markdownMath'; // direct 경로 비교(16·17차 P1)
import WeaveLink from '@/components/Canvas/extensions/WeaveLink';
import { createWeaveMarked } from './markedFactory';
import { WEAVE_CORE_EXTENSION_OPTIONS } from './editorCoreOptions';
import { buildCanvasEditorExtensions } from '@/components/Canvas/canvasEditorExtensions';

const BASE = [StarterKit];
// 프로덕션 표면 구성(StarterKit link:false + WeaveLink) — stock Link인 BASE로는
// WeaveLink의 renderMarkdown 오버라이드가 테스트되지 않는다(2026-07-15 리뷰).
const LINK_EXT = [StarterKit.configure({ link: false }), WeaveLink.configure({ openOnClick: false })];

let editor;
afterEach(() => { editor?.destroy(); editor = undefined; });

describe('docToMarkdown', () => {
  it('에디터 문서 전체를 markdown으로 직렬화한다', () => {
    editor = new Editor({ extensions: BASE, content: '<h1>제목</h1><p><strong>본문</strong></p>' });
    expect(docToMarkdown(editor).trim()).toBe('# 제목\n\n**본문**');
  });
  it('buildMarkdownExtensions 장착 에디터에서도 동일 + getMarkdown 배선', () => {
    editor = new Editor({ extensions: buildMarkdownExtensions(BASE), content: '<p>hi</p>' });
    expect(docToMarkdown(editor).trim()).toBe('hi');
    expect(editor.getMarkdown().trim()).toBe('hi');
  });
});

describe('sliceToMarkdown', () => {
  it('블록 단위 선택을 직렬화한다', () => {
    editor = new Editor({ extensions: BASE, content: '<p>one</p><p>two</p>' });
    const slice = editor.state.doc.slice(0, editor.state.doc.content.size);
    expect(sliceToMarkdown(editor, slice).trim()).toBe('one\n\ntwo');
  });
  it('문단 중간 인라인 선택은 문단으로 감싸 직렬화한다', () => {
    editor = new Editor({ extensions: BASE, content: '<p>hello <strong>world</strong></p>' });
    // pos 3은 "hello " 세번째 문자 앞이 아니라 두번째 문자(index 2) 앞이다(ProseMirror
    // 위치는 문단 콘텐츠 시작을 pos 1로 잡으므로 0-based 문자열 인덱스와 1 어긋난다).
    // 실측(slice.content.toJSON()): [{text:'llo '}, {text:'wor', marks:[bold]}].
    const slice = editor.state.doc.slice(3, 10); // 'llo ' + 굵은 'wor'
    expect(sliceToMarkdown(editor, slice).trim()).toBe('llo **wor**');
  });
  it('빈 조각은 빈 문자열', () => {
    editor = new Editor({ extensions: BASE, content: '<p></p>' });
    expect(sliceToMarkdown(editor, editor.state.doc.slice(1, 1))).toBe('');
  });
});

describe('htmlToMarkdown / markdownToEditorHtml', () => {
  it('HTML → md headless 변환', () => {
    expect(htmlToMarkdown('<h2>부제</h2><p>본문 <code>x</code></p>', BASE).trim()).toBe('## 부제\n\n본문 `x`');
  });
  it('빈 입력은 빈 문자열', () => {
    expect(htmlToMarkdown('', BASE)).toBe('');
    expect(markdownToEditorHtml('', BASE)).toBe('');
  });
  it('md → HTML → md 정착 왕복(dialect 무관 멱등성)', () => {
    const md1 = htmlToMarkdown(markdownToEditorHtml('- 하나\n- 둘\n\n> 인용', BASE), BASE);
    const md2 = htmlToMarkdown(markdownToEditorHtml(md1, BASE), BASE);
    expect(md2).toBe(md1);
    expect(md1).toContain('하나');
    expect(md1).toContain('> 인용');
  });
});

describe('findUnsupportedFormatting', () => {
  it('md 미표현 서식을 수집한다 (underline은 ++text++로 무손실 왕복하므로 제외)', () => {
    const doc = {
      type: 'doc',
      content: [
        { type: 'paragraph', attrs: { textAlign: 'center' }, content: [
          { type: 'text', text: 'a', marks: [{ type: 'underline' }] },
          { type: 'text', text: 'b', marks: [{ type: 'textStyle', attrs: { color: '#ff0000' } }] },
          { type: 'text', text: 'c', marks: [{ type: 'highlight', attrs: { color: '#fef08a' } }] },
        ] },
        { type: 'image', attrs: { src: 'x.png', width: 300 } },
        { type: 'tableCell', attrs: { backgroundColor: '#eee' }, content: [] },
      ],
    };
    expect(findUnsupportedFormatting(doc).sort()).toEqual(
      ['cellBackground', 'color', 'highlightColor', 'imageWidth', 'textAlign'],
    );
  });
  it('지원 서식만 있으면 빈 배열', () => {
    expect(findUnsupportedFormatting({ type: 'doc', content: [{ type: 'paragraph' }] })).toEqual([]);
  });
});

describe('WEAVE-37 dialect — bare URL/email 비링크화 (backend commonmark 정렬)', () => {
  it('bare email 평문은 링크로 승격되지 않는다 (RED manifest 정합 — 20차 P2)', () => {
    const html = markdownToEditorHtml('문의 user@example.com 로', BASE);
    expect(html).not.toContain('<a ');
    expect(html).toContain('user@example.com');
  });

  it('bare URL 평문은 링크로 승격되지 않는다 (backend commonmark dialect 정렬)', () => {
    const html = markdownToEditorHtml('보러가기 https://example.com 끝', BASE);
    expect(html).not.toContain('<a ');
    expect(html).toContain('https://example.com');
  });

  it('꺾쇠 autolink <url>은 계속 링크다 (commonmark 표준 — positive control)', () => {
    const html = markdownToEditorHtml('<https://example.com>', BASE);
    expect(html).toContain('href="https://example.com"');
  });

  it('(url) 괄호 잔존물은 링크로 부활하지 않는다 (WEAVE-37 R4-①)', () => {
    const html = markdownToEditorHtml('앞 (https://example.com) 뒤', BASE);
    expect(html).not.toContain('<a ');
    expect(html).toContain('https://example.com'); // URL 텍스트는 보존(통째 삭제 오구현 배제)
  });
});

describe('WEAVE-37 링크 직렬화 계약 (WeaveLink renderMarkdown + 빈 라벨 폴백)', () => {
  it('[](url) 빈 라벨 링크는 URL을 라벨로 폴백한다 — 무음 소실 방지', () => {
    const html = markdownToEditorHtml('a [](https://example.com) b', LINK_EXT);
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('>https://example.com</a>');
  });

  it('[]()·[](<>) 같은 href까지 빈 링크는 크래시 없이 무시된다', () => {
    // 빈 text 노드는 PM에서 금지(RangeError: Empty text nodes are not allowed) —
    // href 폴백은 href가 있을 때만, 둘 다 비면 빈 content 반환이 계약(2026-07-15 리뷰 실측).
    expect(() => markdownToEditorHtml('a []() b', LINK_EXT)).not.toThrow();
    expect(() => markdownToEditorHtml('a [](<>) b', LINK_EXT)).not.toThrow();
    expect(markdownToEditorHtml('a []() b', LINK_EXT)).not.toContain('<a ');
  });

  it('일반 링크 href의 괄호는 egress에서 percent-encode된다 (F1.3 계약을 WeaveLink로 확장)', () => {
    const md = htmlToMarkdown('<p><a href="https://example.com/a)b">t</a></p>', LINK_EXT);
    expect(md).toContain('(https://example.com/a%29b)');
  });

  it('[]() 계약 exact: frontend는 리터럴 유지 — Manager (16차 P2)', () => {
    // 실측 출력 형태: Manager는 개행 없음.
    expect(markdownToEditorHtml('a []() b', LINK_EXT)).toBe('<p>a []() b</p>');
  });

  it('[]() 계약 exact: direct 경로 (별도 it — 선행 실패에 가리지 않게, 20차 P2)', () => {
    expect(markdownToHtml('a []() b')).toBe('<p>a []() b</p>\n');
  });

  it('title serialize→parse 왕복에서 attrs.title이 원문과 정확히 같다 (15차 P2)', () => {
    const src = '<p><a href="https://x.com" title=\'say "hi"\'>t</a></p>';
    const md = htmlToMarkdown(src, LINK_EXT);
    const back = markdownToEditorHtml(md, LINK_EXT);
    expect(back).toContain('title="say &quot;hi&quot;"'); // 재파싱 attrs가 원문 title과 동일
  });

  it('title은 backslash-먼저 escape로 왕복 안정 (attrs 기반; 라벨 escape는 D3 계열 한계)', () => {
    expect(htmlToMarkdown('<p><a href="https://x.com" title=\'say "hi"\'>t</a></p>', LINK_EXT))
      .toContain('"say \\"hi\\""');
    // trailing backslash: 소스 리터럴은 런타임에 backslash 2개가 아니라 **1개**여야 한다(17차 P1).
    // 변수로 만들어 serialize→parse 후 attrs.title이 원문과 정확히 같은지 구조 비교한다.
    const title = 'end\\';                       // 런타임 값: end + backslash 1개
    const src2 = `<p><a href="https://x.com" title="${title}">t</a></p>`;
    const md2 = htmlToMarkdown(src2, LINK_EXT);
    // ① 직렬화된 markdown에 escape가 실제로 들어갔는지(19차 P2: escape를 삭제해도 아래 왕복
    //    비교만으론 통과했다 — 파서가 관대해서다). backslash는 `\\`로 이스케이프돼야 한다.
    expect(md2).toContain('"end\\\\"');
    // ② JSON regex가 아니라 **실제 link mark의 attrs.title**을 직접 비교
    const json = generateJSON(markdownToEditorHtml(md2, LINK_EXT), LINK_EXT);
    const findMark = (n) => n?.marks?.find((m) => m.type === 'link')
      ?? (n?.content || []).reduce((acc, c) => acc ?? findMark(c), null);
    expect(findMark(json).attrs.title).toBe(title);   // 재파싱 attrs.title === 원문(정확 비교)
  });
});

describe('createWeaveMarked 팩토리 — Lexer 래핑·no-arg 정규화 (13차 P2)', () => {
  it('Lexer 래핑이 accumulator/rest 인자를 보존한다 (14차 P2 — ...args 삭제 mutation 검출)', () => {
    const md = createWeaveMarked();
    const lx = new md.Lexer(md.defaults);
    // inlineTokens(src, tokens=[]) — seed accumulator에 push되고 **같은 배열**이 반환돼야 한다.
    const seed = [];
    const out = lx.inlineTokens('hello', seed);
    expect(out).toBe(seed);                       // identity 보존(rest 인자 누락 시 새 배열 반환)
    expect(seed.length).toBeGreaterThan(0);
    // bare URL 정규화가 inlineTokens 경로에서 실제로 일어나는지도 함께 고정(override 삭제 검출)
    const links = lx.inlineTokens('보기 https://x.com 끝', []).filter((t) => t.type === 'link');
    expect(links).toHaveLength(0);
  });

  it('editor.markdown(no-arg Lexer) 경로도 정규화된다 + 인스턴스 defaults·custom token 유지', () => {
    // editor.markdown은 Markdown 확장이 있어야 존재한다 — buildMarkdownExtensions로 감싼다.
    editor = new Editor({
      coreExtensionOptions: WEAVE_CORE_EXTENSION_OPTIONS,   // 하네스 규칙 통일(17차 P2)
      extensions: buildMarkdownExtensions(buildCanvasEditorExtensions({})),
      content: '<p></p>',
    });
    // no-arg `new markedInstance.Lexer()`(dist:111) 경로 + parseListToken의 this.lexer.inlineTokens(dist:392):
    // mixed list라야 inlineTokens 재토큰화 경로를 실제로 탄다. JSON 구조로 단언(17차 P1).
    // ⚠️ URL text·link type·href를 같은 노드에 결속해 비교한다(19차 P1) + URL 등장 1회(20차 P1).
    const countUrl = (json) => (JSON.stringify(json).match(/https:\/\/x\.com/g) || []).length;
    // 실측 구조(TipTap): bulletList("a")와 taskList는 doc 최상위 **형제**다(중첩 아님).
    // taskList → taskItem → paragraph → text(URL) 경로만 인정 — URL이 앞 bullet('a')로
    // 이동/복제되면 여기서 못 찾으므로 그런 오구현을 걸러낸다(19·20차 P1).
    const taskItemParaContent = (json) => {
      const taskList = json.content?.find((n) => n.type === 'taskList');
      const taskItem = (taskList?.content || []).find((it) => it.type === 'taskItem');
      const para = taskItem?.content?.find((n) => n.type === 'paragraph');
      return para?.content || [];
    };
    const urlNode = (json) => taskItemParaContent(json).find((n) => n.type === 'text' && n.text === 'https://x.com') ?? null;
    const deLink = editor.markdown.parse('- a\n- [ ] https://x.com');
    const n1 = urlNode(deLink);
    expect(countUrl(deLink)).toBe(1);                                 // 복제·이동 배제(20차 P1)
    expect(n1).toBeTruthy();                                          // **task item 안**에 URL 존재
    expect(n1.marks ?? []).toEqual([]);                              // **그 노드에** link mark 없음
    expect(JSON.stringify(deLink)).not.toContain('"type":"link"');    // 문서 어디에도 link mark 없음
    const empty = editor.markdown.parse('- a\n- [ ] [](https://x.com)');
    const n2 = urlNode(empty);
    // 빈 라벨 폴백은 URL이 **라벨 텍스트 + href** 양쪽에 나타나므로 등장 2회가 정상(de-link는
    // text만이라 1회). 노드 경로 결속(n2 truthy + n2.marks href)이 위치·복제를 이미 막고,
    // 이 count는 stray 복제(첫 bullet으로 유출 등)를 3회+로 잡아낸다.
    expect(countUrl(empty)).toBe(2);
    expect(n2).toBeTruthy();
    expect(n2.marks).toEqual([{ type: 'link', attrs: expect.objectContaining({ href: 'https://x.com' }) }]);
    // 인스턴스 custom tokenizer(taskRef 칩)가 no-arg Lexer + 체크리스트 안에서도 실제 노드로 파싱:
    const chip = editor.markdown.parse('- a\n- [ ] [WV-1 제목](/branch/1/task/1)');
    const chipNode = taskItemParaContent(chip).find((n) => n.type === 'taskRef') ?? null;
    expect(chipNode).toBeTruthy();                                   // task item 안 taskRef 노드
    expect(chipNode.attrs).toMatchObject({ taskId: 1 });             // 실제 refMarkdown 규약 키로 확정
  });
});
