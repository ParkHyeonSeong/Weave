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
  const PROTOCOL = 's4-bridge/1';        // CLI의 BRIDGE_PROTOCOL과 일치해야 한다
  // selector + nth + hasText 를 Playwright locator 문자열로. **대상 선택만** 한다.
  const T = (sel, nth, hasText) => (sel || '')
    + (hasText ? `:has-text("${hasText}")` : '')
    + ' >> nth=' + (nth == null ? 0 : nth);

  // ── disposable context ─────────────────────────────────────────────────────
  // 전달받은 page를 직접 몰면 URL·viewport·localStorage·init script가 누적되고 복원되지
  // 않는다. 특히 23개 중 19개가 `setStorage → goto` 순서라, 시작 탭이 앱 origin이 아니면
  // 엉뚱한 origin에 기록된다. 인증 상태만 복사한 일회용 context에서 돌고 finally에서 닫는다.
  const browser = page.context().browser();
  if (!browser) {
    return JSON.stringify({ fatal: 'NO_BROWSER — persistent context에서는 disposable context를 만들 수 없다' });
  }
  const storageState = await page.context().storageState();
  const ctx = await browser.newContext({ storageState });
  const p = await ctx.newPage();
  const log = [];
  try {
    // 앱 origin으로 prime — 첫 setStorage가 about:blank에 기록되지 않게 한다.
    await p.goto(ORIGIN, { waitUntil: 'domcontentloaded' });
    for (let i = 0; i < 2000; i += 1) {
      const cmd = await (await p.request.get(`${BRIDGE}/next`)).json();
      if (cmd.done) { log.push('done'); break; }
      let value = null;
      let error = null;
      try {
        const [a, b, c] = cmd.args;
        if (cmd.method === 'hello') value = { protocol: PROTOCOL, echo: a };
        else if (cmd.method === 'setViewport') await p.setViewportSize({ width: a, height: b });
        else if (cmd.method === 'setStorage') {
          // origin이 앱이 아닌 상태에서 쓰면 그 기록은 다음 goto에서 사라진다 — 명시적으로 막는다.
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
          // 매 문서에 navigation **이전** 실행으로 등록하고, 현재 문서에도 한 번 적용한다.
          // ACK는 그 적용 결과를 그대로 돌려준다 — 예외를 삼키고 true를 주면 검증이 무의미하다.
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
      await p.request.post(`${BRIDGE}/`, {
        data: JSON.stringify({ id: cmd.id, value, error }),
        headers: { 'content-type': 'application/json' },
      });
    }
  } finally {
    // 일회용 context를 닫는다 — 두 번의 반복 실행이 서로 독립 증거가 되려면 필수다.
    await ctx.close();
  }
  return JSON.stringify(log);
}
