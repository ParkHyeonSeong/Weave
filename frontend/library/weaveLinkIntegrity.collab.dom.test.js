// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import * as Y from 'yjs';
import { Editor, Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import { ySyncPlugin, yUndoPlugin, yUndoPluginKey } from 'y-prosemirror';
import WeaveLink from '@/components/Canvas/extensions/WeaveLink';
import YUndoRedo from '@/components/Canvas/extensions/YUndoRedo';
import { WEAVE_CORE_EXTENSION_OPTIONS } from '@/library/editorCoreOptions';

// 프로덕션 동일 배선: direct ySyncPlugin + yUndoPlugin + YUndoRedo 어댑터
// (CanvasCollabEditor.js:52-61·ScrumCell.js:23, Task 3). 두 Y.Doc을 업데이트 릴레이로 연결.
const flush = () => new Promise((r) => setTimeout(r, 0)); // 릴레이/마이크로태스크 정착
// (raf 대기는 focus/undo 계약을 다루는 Task 3 파일에만 필요 — 여기선 쓰지 않는다, 15차 P2)

// 실패 안전 teardown: Editor·relay listener·Y.Doc을 **독립 disposer**로 등록하고 하나가 throw해도
// 나머지를 끝까지 정리한다(예: editor.destroy가 던지면 같은 disposer의 ydoc.destroy가 스킵되던 문제).
// document.body는 항상 초기화하고, 오류는 삼키지 않고 전부 정리 후 첫 오류(또는 AggregateError)를
// rethrow한다(assertion 실패에도 afterEach가 동작 — 20차 P2 누수·교차오염 방지).
let disposers = [];
afterEach(() => {
  const errors = [];
  for (const d of disposers) { try { d(); } catch (e) { errors.push(e); } }
  disposers = [];
  document.body.innerHTML = '';
  if (errors.length) throw errors.length === 1 ? errors[0] : new AggregateError(errors, 'teardown 실패');
});

// oneWay: A→B만 relay한다(D5 테스트용 — B의 오염이 A로 역전파돼 기대값까지 오염되는 것 차단, 19차 P1)
function makePair({ oldClient = false, oneWay = false } = {}) {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  // relay 콜백을 변수로 보관해 정확 콜백으로 off한다 — 익명 콜백 등록 후 off('update')를 인자
  // 없이 부르면 Yjs Observable.off는 no-op이라 listener가 누수된다(리뷰 발견).
  const relayA = (u, origin) => { if (origin !== 'relay') Y.applyUpdate(docB, u, 'relay'); };
  docA.on('update', relayA);
  let relayB = null;
  if (!oneWay) {
    relayB = (u, origin) => { if (origin !== 'relay') Y.applyUpdate(docA, u, 'relay'); };
    docB.on('update', relayB);
  }
  const mk = (ydoc, useStockLink) => new Editor({
    coreExtensionOptions: WEAVE_CORE_EXTENSION_OPTIONS, // Task 1 가드 — 프로덕션 동일 배선(15차 P1)
    extensions: [
      StarterKit.configure({ link: false, undoRedo: false }), // v3 옵션명(dist .d.ts:70-72)
      useStockLink ? Link.configure({ openOnClick: false }) : WeaveLink.configure({ openOnClick: false }),
      YUndoRedo,
      Extension.create({
        name: 'ySyncHarness',
        addProseMirrorPlugins() { return [ySyncPlugin(ydoc.getXmlFragment('default')), yUndoPlugin()]; },
      }),
    ],
  });
  const a = mk(docA, oldClient); // oldClient=true → 무결성 플러그인 없는 stock Link(구버전 모사)
  const b = mk(docB, false);
  // DOM mount — 미마운트 상태의 focus()가 지연 트랜잭션으로 undo/redo 스택을 오염시킬 수 있다(11차).
  [a, b].forEach((e) => document.body.appendChild(e.view.dom.parentElement ?? e.view.dom));
  // 독립 disposer(순서: Editor destroy → relay off(정확 콜백) → Y.Doc destroy).
  disposers.push(() => a.destroy());
  disposers.push(() => b.destroy());
  disposers.push(() => docA.off('update', relayA));       // 정확 콜백으로 실제 해제
  if (relayB) disposers.push(() => docB.off('update', relayB)); // oneWay면 등록 안 했으니 off도 안 함
  disposers.push(() => docA.destroy());
  disposers.push(() => docB.destroy());
  return { a, b, docA, docB }; // Y.Doc도 노출 — PM HTML과 Y fragment를 함께 비교(14차 P1)
}

// Y fragment 구조(문단 개수 등) — PM은 비어 보여도 Y fragment에 <paragraph></paragraph>가
// 영속될 수 있어(14차 P1) PM HTML만으론 오염을 못 잡는다.
const yFrag = (ydoc) => ydoc.getXmlFragment('default').toString();

const MIRROR = { type: 'text', text: 'https://example.com', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] };

describe('WeaveLink 무결성 — Yjs collab(로컬 전용, D5=A)', () => {
  it('collab 표면에서도 로컬 부분삭제 후 재타이핑이 링크로 부활하지 않고 상대 탭으로 동기화된다', async () => {
    const { a, b } = makePair();                 // 둘 다 신버전
    a.commands.insertContent(MIRROR);
    await flush();
    a.commands.setTextSelection({ from: 9, to: 16 });
    a.commands.deleteSelection();                // 미러 훼손 → 로컬 Rule B가 같은 디스패치에서 해제
    await flush();
    a.commands.insertContent('NEW');             // **재타이핑**(R1 핵심 제스처 — 이름과 동작 일치, 15차 P2)
    await flush();
    for (const [ed, label] of [[a, 'A'], [b, 'B']]) {
      expect(ed.getHTML(), label).not.toContain('<a ');                          // anchor 0개
      expect(JSON.stringify(ed.getJSON()), label).not.toContain('"type":"link"'); // link mark 0개
      // 삽입 **위치**까지 고정(16차 P1: toContain('NEW')는 문단 끝 오삽입 'https://.comNEW'도 통과)
      expect(ed.getText(), label).toBe('https://NEW.com');
    }
  });

  it('로컬 정리는 undo와 함께 묶인다 — 사용자 편집 undo 시 PM·Y가 정확히 복원(A·B 양쪽)', async () => {
    const { a, b, docA, docB } = makePair();
    const um = yUndoPluginKey.getState(a.state).undoManager;
    a.commands.insertContent(MIRROR);
    await flush();
    um.stopCapturing(); // 삽입·삭제가 500ms 병합 창에서 한 덩어리로 묶이는 것 차단(8차 P1)
    // 구조 추정·부분 문자열 금지(15차 P1) — 삭제 전/후 스냅샷을 캡처해 exact 비교한다.
    const initialPm = a.getHTML();
    const initialY = yFrag(docA);
    a.commands.deleteRange({ from: 9, to: 16 }); // 훼손+정리가 한 디스패치(로컬)
    await flush();
    const changedPm = a.getHTML();
    const changedY = yFrag(docA);
    expect(changedPm).not.toContain('<a ');       // 정리됨
    expect(b.getHTML()).toBe(changedPm);          // 삭제 직후에도 B 동기화(16차 P1)
    expect(yFrag(docB)).toBe(changedY);
    a.commands.undo();                            // YUndoRedo → y-prosemirror undoCommand
    await flush();
    expect(a.getHTML()).toBe(initialPm);          // 사용자 삭제+정리가 하나의 undo item으로 묶임
    expect(yFrag(docA)).toBe(initialY);
    expect(b.getHTML()).toBe(initialPm);          // 상대 탭도 동일
    expect(yFrag(docB)).toBe(initialY);
    a.commands.redo();
    await flush();
    expect(a.getHTML()).toBe(changedPm);
    expect(yFrag(docA)).toBe(changedY);
    expect(b.getHTML()).toBe(changedPm);          // redo 동기화까지 exact 비교(16차 P1)
    expect(yFrag(docB)).toBe(changedY);
  });

  it('relay 양방향: B에서 편집해도 A로 도착하고 매 단계 PM·Y가 정확히 일치한다 (14차 P2)', async () => {
    const { a, b, docA, docB } = makePair();
    a.commands.insertContent({ type: 'text', text: 'from-A ' });
    await flush();
    expect(b.getHTML()).toBe(a.getHTML());
    expect(yFrag(docB)).toBe(yFrag(docA));
    b.commands.insertContent({ type: 'text', text: 'from-B' }); // B→A 방향(리스너 삭제 시 여기서 실패)
    await flush();
    expect(a.getHTML()).toBe(b.getHTML());
    expect(yFrag(docA)).toBe(yFrag(docB));
    expect(a.getText()).toContain('from-B');
  });

  // ⚠️ D5 계약은 "**아무것도 바꾸지 않는다**"이므로 부분 청소도 실패로 잡아야 한다(19차 P1:
  //    링크가 일부라도 남으면 통과하는 어서션은 '절반만 청소 후 역전파'하는 오구현도 green).
  //    → **A→B 단방향 relay**로 만들어 B의 변경이 A로 되돌아오지 못하게 하고(오염 격리),
  //      A의 PM JSON·Y fragment를 기대값으로 잡아 B 전체와 toEqual 비교한다.
  const linkMarkOf = (ed, text) => {
    let m = null;
    (function walk(n) { if (m) return; if (n.type === 'text' && n.text === text) { m = n.marks?.find((k) => k.type === 'link'); return; } (n.content || []).forEach(walk); })(ed.getJSON());
    return m;
  };
  it.each([
    ['미러 훼손',
      (a) => { a.commands.insertContent(MIRROR); a.commands.deleteRange({ from: 9, to: 16 }); },
      (a) => { // A는 훼손된 채 **링크가 살아있는** 구버전 상태여야 한다
        expect(a.getText()).toBe('https://.com');
        expect(linkMarkOf(a, 'https://.com')?.attrs.href).toBe('https://example.com');
      }],
    ['공백-only 링크',
      (a) => a.commands.setContent({
      type: 'doc',
      content: [{ type: 'paragraph', content: [
        // HTML '<a>  </a>'는 PM DOM 파서가 <p>y</p>로 정규화하므로 JSON으로 직접 주입(9차 P1)
        { type: 'text', text: '  ', marks: [{ type: 'link', attrs: { href: 'https://x.com' } }] },
        { type: 'text', text: 'y' },
      ] }],
      }),
      (a) => { // A는 공백-only 링크가 **살아있는** 구버전 상태여야 한다
        expect(a.getText()).toBe('  y');
        expect(linkMarkOf(a, '  ')?.attrs.href).toBe('https://x.com');
      }],
  ])('D5=A: 원격(구버전 탭)의 %s를 신버전 수신 측이 전혀 건드리지 않는다 (exact)', async (_label, mutate, expectA) => {
    const { a, b, docA, docB } = makePair({ oldClient: true, oneWay: true }); // A→B 단방향
    mutate(a);
    await flush();
    // ⚠️ **A가 실제로 '구버전 훼손 원본'인지 먼저 고정**한다(20차 P1: A/B 동일만 보면 A를
    //    신버전으로 바꿔 A가 먼저 청소해도 두 케이스가 통과한다 — 전제가 무너져도 green).
    expectA(a);
    // B에 무결성 플러그인이 실제로 설치돼 있어야 "안 건드림"이 의미를 갖는다.
    expect(b.state.plugins.some((pl) => pl.key?.startsWith('weaveLinkIntegrity'))).toBe(true);
    // B는 A가 보낸 상태를 **그대로** 가져야 한다 — 부분 청소·재배치 전부 실패로 잡힌다.
    expect(b.getJSON()).toEqual(a.getJSON());
    expect(yFrag(docB)).toBe(yFrag(docA));
  });
});

describe('relay listener 정확 해제 + disposer 독립성 (fix 3 회귀 증거)', () => {
  it('relay listener는 정확 콜백으로만 해제된다 — 인자 없는 off(\'update\')는 no-op', () => {
    const docA = new Y.Doc();
    disposers.push(() => docA.destroy()); // 실패해도 afterEach가 정리
    let relayed = 0;
    const relayA = (u, origin) => { if (origin !== 'relay') relayed += 1; };
    docA.on('update', relayA);
    docA.getText('t').insert(0, 'x');
    expect(relayed).toBe(1);              // 등록 후 update → counter 증가
    docA.off('update');                   // 콜백 없이 off → Yjs Observable.off는 no-op(버그 재현)
    docA.getText('t').insert(0, 'y');
    expect(relayed).toBe(2);              // 여전히 살아있음 — 인자 없는 off는 해제 못 함
    docA.off('update', relayA);           // 정확 콜백으로 off
    docA.getText('t').insert(0, 'z');
    expect(relayed).toBe(2);              // exact off 후 update → counter 불변(실제 해제됨)
  });

  it('앞 disposer가 throw해도 relay off disposer가 실행되고 오류는 보관(rethrow용)된다', () => {
    const docA = new Y.Doc();
    disposers.push(() => docA.destroy());
    let relayed = 0;
    const relayA = (u, origin) => { if (origin !== 'relay') relayed += 1; };
    docA.on('update', relayA);
    const order = [];
    const local = [
      () => { order.push('boom'); throw new Error('boom'); },
      () => { order.push('relayoff'); docA.off('update', relayA); },
    ];
    const errors = [];
    for (const d of local) { try { d(); } catch (e) { errors.push(e); } } // afterEach 러너와 동일 패턴
    expect(order).toEqual(['boom', 'relayoff']); // 앞 disposer throw에도 relay off 실행
    expect(errors).toHaveLength(1);              // 오류는 삼키지 않고 보관 → 러너가 rethrow
    docA.getText('t').insert(0, 'x');
    expect(relayed).toBe(0);                     // off 됐으므로 update가 counter를 안 올림
  });
});
