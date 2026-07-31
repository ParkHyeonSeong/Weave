// frontend/scripts/s4-adapter.playwright.js
// **커밋된 브라우저 어댑터.** s4-capture.mjs의 브리지에 붙어 원시 동작만 수행한다.
//
// 왜 tracked인가: 이전에는 .playwright-mcp/ 아래 ignored 파일이 어댑터였다. 그러면
// "어떤 코드가 브라우저를 몰았나"가 리뷰 diff에 남지 않고, HEAD 결속으로 잠글 수도 없다.
// 이 파일은 DISCOVERY_HASHED_MODULES에 들어가고 캡처/discovery 시작 전에 HEAD와 대조된다.
//
// 계약:
//  - 브리지가 주는 11개 method만 수행한다. selector 술어·대기 판정·postcondition은
//    전부 커밋된 러너의 몫이고 여기서는 하지 않는다.
//  - evaluate는 준 소스를 그대로 실행해 반환값을 그대로 돌려준다.
//  - addInitScript는 **navigation 이전**에 실행되도록 등록한다. 이게 없으면 페이지 로드 중
//    발생한 요청을 놓친다(discovery의 존재 이유가 사라진다).
//  - 어떤 파일도 쓰지 않는다.
//
// ⚠️ evaluate/addInitScript는 브리지가 준 **문자열을 코드로 실행**한다. 이건 설계상
// 불가피한 신뢰 채널이고(러너의 측정·판정 소스를 페이지에서 돌려야 한다), 다음 두 가지로
// 범위를 좁힌다:
//   1) 소스는 커밋된 상수(PROBE/ASSERT/THEME/RASTER/PSEUDO/NETWORK_*)뿐이고 그 바이트는
//      specFingerprint 입력이며 캡처 시작 전에 HEAD와 대조된다.
//   2) 브리지는 127.0.0.1 loopback이고 이 어댑터가 먼저 붙는다.
// 임의 입력을 여기에 흘리면 그 순간 이 전제가 깨진다 — 브리지 상대는 커밋된 CLI뿐이어야 한다.
//
// 사용: Playwright MCP의 코드 실행 도구에 이 파일 경로를 준다.
//   1) 터미널에서  node scripts/s4-capture.mjs --discover
//   2) 브라우저 도구로 이 파일 실행
async (page) => {
  const BRIDGE = 'http://127.0.0.1:10098';
  const ORIGIN = 'http://localhost:10000';
  const PROTOCOL = 's4-bridge/2';        // CLI의 BRIDGE_PROTOCOL과 일치해야 한다
  const REFRESH_COOKIE = 'weave_refresh';
  const T = (sel, nth, hasText) => (sel || '')
    + (hasText ? `:has-text("${hasText}")` : '')
    + ' >> nth=' + (nth == null ? 0 : nth);

  const browser = page.context().browser();
  if (!browser) {
    return JSON.stringify({ fatal: 'NO_BROWSER — persistent context에서는 disposable context를 만들 수 없다' });
  }
  // ── 회전 refresh token을 복제하지 않는다 ───────────────────────────────────
  // 서버는 refresh를 **단일사용**으로 회전시킨다. child가 /auth/refresh를 호출하면 원본
  // 토큰이 소비되고 새 토큰은 child에만 생긴다 — child를 닫으면 원본 브라우저는 폐기된
  // 토큰만 남아 다음 갱신에서 로그아웃된다. access가 만료됐다면 카나리가 실패해야 하지,
  // 원본 세션을 태워선 안 된다.
  const baseState = await page.context().storageState();
  const childState = { ...baseState, cookies: (baseState.cookies || []).filter((c) => c.name !== REFRESH_COOKIE) };

  let ctx = null;
  let p = null;
  const log = [];
  const closeChild = async () => { if (ctx) { await ctx.close(); ctx = null; p = null; } };
  try {
    for (let i = 0; i < 5000; i += 1) {
      const cmd = await (await page.request.get(`${BRIDGE}/next`)).json();
      if (cmd.done) { log.push('done'); break; }
      let value = null;
      let error = null;
      try {
        const [a, b, c] = cmd.args;
        if (cmd.method === 'hello') value = { protocol: PROTOCOL, echo: a };
        else if (cmd.method === 'shutdown') { await closeChild(); value = { ok: true }; log.push('shutdown'); }
        else if (cmd.method === 'beginAttempt') {
          // attempt마다 **새 child context** — 두 실행이 독립 증거가 되려면 필수다.
          await closeChild();
          ctx = await browser.newContext({ storageState: childState });
          p = await ctx.newPage();
          await p.goto(ORIGIN, { waitUntil: 'domcontentloaded' });
          const path = await p.evaluate(() => location.pathname);
          // refresh 쿠키가 없으니 access가 만료됐으면 로그인으로 튕긴다 — 그때는 명시적으로 실패한다.
          if (path.startsWith('/auth/')) throw new Error(`CANARY_AUTH_EXPIRED ${path} (원본 세션은 건드리지 않았다)`);
          value = { ok: true, attempt: a };
        } else if (cmd.method === 'endAttempt') { await closeChild(); value = { ok: true, attempt: a }; }
        else if (!p) error = 'NO_ACTIVE_ATTEMPT';
        else if (cmd.method === 'setViewport') await p.setViewportSize({ width: a, height: b });
        else if (cmd.method === 'setStorage') {
          const origin = await p.evaluate(() => location.origin);
          if (origin !== ORIGIN) throw new Error(`WRONG_ORIGIN_FOR_STORAGE ${origin}`);
          await p.evaluate((q) => { localStorage.setItem(q[0], q[1]); }, [a, b]);
        } else if (cmd.method === 'goto') await p.goto(ORIGIN + a, { waitUntil: 'domcontentloaded' });
        else if (cmd.method === 'reload') await p.reload({ waitUntil: 'domcontentloaded' });
        else if (cmd.method === 'settle') await p.locator(a).first().waitFor({ state: b === 'hidden' ? 'hidden' : 'visible', timeout: c || 12000 });
        else if (cmd.method === 'click') { await p.locator(T(a, b, c)).first().click({ timeout: 8000 }); await p.waitForTimeout(300); }
        else if (cmd.method === 'hover') { await p.locator(T(a, b)).first().hover({ timeout: 8000 }); await p.waitForTimeout(200); }
        else if (cmd.method === 'sleep') await p.waitForTimeout(a);
        else if (cmd.method === 'evaluate') value = await p.evaluate(new Function(`return (${a})`)(), b);
        else if (cmd.method === 'addInitScript') {
          await p.addInitScript({ content: `(${a})()` });
          value = await p.evaluate(new Function(`return (${a})`)());
        } else if (cmd.method === 'screenshot') {
          await p.evaluate(() => document.fonts.ready);
          value = (await p.screenshot({ type: 'png', scale: 'css' })).toString('base64');
        } else error = `unknown method ${cmd.method}`;
      } catch (e) {
        error = String((e && e.message) || e).split('\n')[0].slice(0, 200);
      }
      log.push(cmd.method + (error ? ` ERR:${error}` : ''));
      await page.request.post(`${BRIDGE}/`, {
        data: JSON.stringify({ id: cmd.id, value, error }),
        headers: { 'content-type': 'application/json' },
      });
      // shutdown 응답을 **보낸 직후** 끝낸다. 여기서 다시 /next를 폴링하면 CLI가 이미 닫은
      // 서버에 붙어 fetch failed로 죽는다(실증: CLI는 0인데 어댑터는 오류 종료).
      if (cmd.method === 'shutdown') { log.push('clean-exit'); break; }
    }
  } finally {
    await closeChild();
  }
  return JSON.stringify(log);
}
