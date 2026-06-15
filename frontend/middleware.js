import { NextResponse } from 'next/server';

// SEC-22: per-request nonce 기반 CSP. script-src에서 'unsafe-inline'을 제거해, 인라인
// <script>·이벤트 핸들러가 DOMPurify/nh3를 뚫더라도 브라우저가 실행 자체를 거부하게 한다.
// Next.js는 요청 Content-Security-Policy 헤더의 nonce를 자기 스크립트(__NEXT_DATA__·청크 등)에
// 자동 부여하므로, 우리 쪽 인라인 <script>가 없는 한 별도 배선 없이 동작한다.
//
// style-src의 'unsafe-inline'은 유지한다 — TipTap Color/Highlight가 사용자 선택 색상을
// <span style="color:#..."> 인라인 *속성*으로 렌더하는데, CSP nonce는 <style> 엘리먼트에만
// 적용되고 style 속성엔 적용 불가하기 때문이다(저장형 XSS는 DOMPurify+nh3가 정화로 방어).
//
// CSP를 정적 헤더가 아닌 여기서 주는 이유: nonce는 요청마다 달라야 하므로 nginx 정적
// add_header로는 불가능하다. nginx의 CSP add_header는 제거했고 나머지 보안 헤더는 유지한다.
export function middleware(request) {
  const nonce = btoa(crypto.randomUUID());
  const isProd = process.env.NODE_ENV === 'production';

  // dev는 Next HMR(fast refresh)이 eval과 ws를 쓰고 프론트(:port)↔API(:다른 port) 교차
  // 요청이 있으므로 그만큼만 완화한다. 'unsafe-inline'은 dev에서도 제거(여기서 검증 가능).
  // script-src: 외부 청크(/_next/static/*)는 'self'로 허용, 인라인 스크립트는 nonce로만 허용
  // (unsafe-inline 제거). 'strict-dynamic'은 쓰지 않는다 — 이 앱은 청크를 <script src>로
  // 로드하는데 strict-dynamic이 'self'를 무력화해 청크 로딩이 깨지기 때문(라이브 확인).
  const scriptSrc = isProd
    ? `script-src 'self' 'nonce-${nonce}' 'wasm-unsafe-eval'`
    : `script-src 'self' 'nonce-${nonce}' 'unsafe-eval' 'wasm-unsafe-eval'`;
  // prod는 동일 출처(nginx 뒤)라 'self'가 same-origin wss를 커버 — bare 'wss:'(임의 호스트
  // 와일드카드)는 제거해 데이터 유출 경로를 막는다. dev는 프론트↔API 교차 포트+HMR ws 허용.
  const connectSrc = isProd
    ? `connect-src 'self'`
    : `connect-src 'self' ws: wss: http://localhost:* http://127.0.0.1:* https://localhost:*`;

  const csp = [
    `default-src 'self'`,
    scriptSrc,
    `style-src 'self' 'unsafe-inline'`,
    `img-src 'self' data: blob: https:`,
    connectSrc,
    `font-src 'self' data:`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
  ].join('; ');

  // 요청 헤더에 실어 Next가 nonce를 자기 스크립트에 적용하게 하고, 응답 헤더로 브라우저에 전달.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('content-security-policy', csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('content-security-policy', csp);
  return response;
}

export const config = {
  // 정적 자원(외부 src 스크립트라 nonce 불필요)·이미지·매니페스트는 제외, 나머지 문서 경로에 적용
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|icons|manifest.json|sw.js).*)'],
};
