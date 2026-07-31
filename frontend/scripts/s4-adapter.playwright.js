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
  // selector + nth + hasText 를 Playwright locator 문자열로. **대상 선택만** 한다.
  const T = (sel, nth, hasText) => (sel || '')
    + (hasText ? `:has-text("${hasText}")` : '')
    + ' >> nth=' + (nth == null ? 0 : nth);
  const log = [];
  for (let i = 0; i < 2000; i += 1) {
    const cmd = await (await page.request.get(`${BRIDGE}/next`)).json();
    if (cmd.done) { log.push('done'); break; }
    let value = null;
    let error = null;
    try {
      const [a, b, c] = cmd.args;
      if (cmd.method === 'setViewport') await page.setViewportSize({ width: a, height: b });
      else if (cmd.method === 'setStorage') await page.evaluate((p) => { localStorage.setItem(p[0], p[1]); }, [a, b]);
      else if (cmd.method === 'goto') await page.goto(ORIGIN + a, { waitUntil: 'domcontentloaded' });
      else if (cmd.method === 'reload') await page.reload({ waitUntil: 'domcontentloaded' });
      else if (cmd.method === 'settle') await page.locator(a).first().waitFor({ state: b === 'hidden' ? 'hidden' : 'visible', timeout: c || 12000 });
      else if (cmd.method === 'click') { await page.locator(T(a, b, c)).first().click({ timeout: 8000 }); await page.waitForTimeout(300); }
      else if (cmd.method === 'hover') { await page.locator(T(a, b)).first().hover({ timeout: 8000 }); await page.waitForTimeout(200); }
      else if (cmd.method === 'sleep') await page.waitForTimeout(a);
      else if (cmd.method === 'evaluate') value = await page.evaluate(new Function(`return (${a})`)(), b);
      else if (cmd.method === 'addInitScript') {
        // 매 문서에 navigation **이전** 실행. 현재 문서에도 한 번 적용해 첫 화면을 놓치지 않는다.
        await page.addInitScript({ content: `(${a})()` });
        try { await page.evaluate(new Function(`return (${a})`)()); } catch (e) { /* 첫 적용 실패는 다음 navigation이 덮는다 */ }
        value = true;
      } else if (cmd.method === 'screenshot') {
        await page.evaluate(() => document.fonts.ready);
        value = (await page.screenshot({ type: 'png', scale: 'css' })).toString('base64');
      } else error = `unknown method ${cmd.method}`;
    } catch (e) {
      error = String((e && e.message) || e).split('\n')[0].slice(0, 200);
    }
    log.push(cmd.method + (error ? ` ERR:${error}` : ''));
    await page.request.post(`${BRIDGE}/`, {
      data: JSON.stringify({ id: cmd.id, value, error }),
      headers: { 'content-type': 'application/json' },
    });
  }
  return JSON.stringify(log);
}
