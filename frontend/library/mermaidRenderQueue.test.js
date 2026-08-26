import { describe, it, expect } from 'vitest';
import { createMermaidRenderQueue } from './mermaidRenderQueue.js';

const deferred = () => { let r, j; const p = new Promise((res, rej) => { r = res; j = rej; }); return { p, r, j }; };

// initialize/render 호출을 순서대로 기록하는 계측 큐.
// hold를 주면 render가 그 promise가 풀릴 때까지 in-flight로 멈춘다.
function instrument({ holds = {} } = {}) {
  const calls = [];
  const q = createMermaidRenderQueue({
    initialize: async (theme) => { calls.push(`init:${theme}`); },
    render: async (id, text) => {
      calls.push(`render:${id}`);
      if (holds[id]) await holds[id].p;
      return { ok: true, svg: `<svg data-id="${id}" data-text="${text}"/>` };
    },
  });
  return { q, calls };
}

describe('createMermaidRenderQueue — initialize(theme)→render() 원자화', () => {
  it('같은 테마 연속 요청이면 initialize는 1회만 부른다', async () => {
    const { q, calls } = instrument();
    await Promise.all([
      q.enqueue(() => 'dark', 'a', 'graph TD'),
      q.enqueue(() => 'dark', 'b', 'graph TD'),
      q.enqueue(() => 'dark', 'c', 'graph TD'),
    ]);
    expect(calls).toEqual(['init:dark', 'render:a', 'render:b', 'render:c']);
    expect(q.appliedTheme()).toBe('dark');
  });

  it('테마 A 렌더가 in-flight일 때 테마 B 요청이 끼어들지 않는다 (전역 config 경쟁 차단)', async () => {
    const holdA = deferred();
    const { q, calls } = instrument({ holds: { a: holdA } });

    const pa = q.enqueue(() => 'dark', 'a', 'graph TD');
    await Promise.resolve(); await Promise.resolve();   // a 태스크가 render까지 진입
    expect(calls).toEqual(['init:dark', 'render:a']);

    const pb = q.enqueue(() => 'default', 'b', 'graph TD');
    await Promise.resolve(); await Promise.resolve();
    // a가 아직 안 끝났으므로 b는 시작조차 하지 않았다 — init:default가 끼면 실패다
    expect(calls).toEqual(['init:dark', 'render:a']);

    holdA.r();
    await Promise.all([pa, pb]);
    expect(calls).toEqual(['init:dark', 'render:a', 'init:default', 'render:b']);
  });

  it('다중 블록(N=3)이 동시에 들어와도 전부 같은 최종 테마로 수렴한다', async () => {
    const { q, calls } = instrument();
    let theme = 'default';
    // 3개 블록이 같은 틱에 enqueue (아직 어떤 태스크도 실행 전)
    const ps = ['a', 'b', 'c'].map((id) => q.enqueue(() => theme, id, 'graph TD'));
    theme = 'dark';                       // 실행 전에 테마가 바뀌었다
    await Promise.all(ps);
    expect(calls).toEqual(['init:dark', 'render:a', 'render:b', 'render:c']);
    expect(q.appliedTheme()).toBe('dark');
  });

  // 의미론은 하나다 — **실행 시점 최신 테마**. 큐 항목은 테마를 캡처하지 않고 실행 순간
  // thunk를 호출한다. 따라서 A→B→A에서 B로 enqueue된 b도 실행 시점 테마인 A(dark)로 그려지고
  // init:default는 아예 일어나지 않는다. 아래 기대값은 계획의 큐 구현을 그대로 실행해 얻은 것이다.
  // "enqueue 시점 테마 캡처" mutant는 ['init:dark','render:a','init:default','render:b',
  // 'init:dark','render:c'] 를 내므로 이 단정이 RED가 된다 — 두 의미론을 가르는 테스트다.
  it('rapid toggle A→B→A: 실행 시점 테마를 읽어 전부 최종 테마 A로 수렴한다', async () => {
    const holds = { a: deferred(), b: deferred(), c: deferred() };
    const { q, calls } = instrument({ holds });

    let theme = 'dark';                                  // A
    const pa = q.enqueue(() => theme, 'a', 'graph TD');
    await Promise.resolve(); await Promise.resolve();     // a가 render까지 진입해 in-flight

    theme = 'default';                                   // B — b를 enqueue할 때의 값
    const pb = q.enqueue(() => theme, 'b', 'graph TD');
    theme = 'dark';                                      // A again — b가 실행되기 전에 되돌아왔다
    const pc = q.enqueue(() => theme, 'c', 'graph TD');

    holds.a.r(); holds.b.r(); holds.c.r();
    await Promise.all([pa, pb, pc]);
    expect(calls).toEqual(['init:dark', 'render:a', 'render:b', 'render:c']);
    expect(q.appliedTheme()).toBe('dark');
  });

  it('한 건의 실패가 큐를 영구히 막지 않는다 (거부는 호출자에게만 전달)', async () => {
    const calls = [];
    let n = 0;
    const q = createMermaidRenderQueue({
      initialize: async (t) => { calls.push(`init:${t}`); },
      render: async (id) => { calls.push(`render:${id}`); n += 1;
        if (n === 1) throw new Error('boom');
        return { ok: true, svg: '<svg/>' }; },
    });
    await expect(q.enqueue(() => 'dark', 'a', 'x')).rejects.toThrow('boom');
    await expect(q.enqueue(() => 'dark', 'b', 'x')).resolves.toEqual({ ok: true, svg: '<svg/>' });
    expect(calls).toEqual(['init:dark', 'render:a', 'render:b']);
  });

  it('initialize 실패 시 appliedTheme을 갱신하지 않아 다음 요청이 재시도한다', async () => {
    const calls = [];
    let fail = true;
    const q = createMermaidRenderQueue({
      initialize: async (t) => { calls.push(`init:${t}`); if (fail) { fail = false; throw new Error('init boom'); } },
      render: async (id) => { calls.push(`render:${id}`); return { ok: true, svg: '<svg/>' }; },
    });
    await expect(q.enqueue(() => 'dark', 'a', 'x')).rejects.toThrow('init boom');
    expect(q.appliedTheme()).toBe(null);
    await expect(q.enqueue(() => 'dark', 'b', 'x')).resolves.toEqual({ ok: true, svg: '<svg/>' });
    expect(calls).toEqual(['init:dark', 'init:dark', 'render:b']);
    expect(q.appliedTheme()).toBe('dark');
  });
});
