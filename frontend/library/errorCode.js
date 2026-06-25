// 백엔드 실패 응답에서 에러 코드를 꺼내는 단일 진입점.
//
// 백엔드 실패 본문은 HTTP-200 dict이다:
//   마이그레이션된 컨트롤러: { status:false, message:CODE, code:CODE, category, retryable }
//   아직 마이그레이션 안 된/deferred 컨트롤러: { status:false, message:CODE }  // code/category 없음
// 두 경우 모두 CODE가 message에 들어 있고, 새 응답은 code에도 들어 있다(dual-emit).
// 따라서 code를 우선 읽고 없으면 message로 폴백하면 양쪽 모두에서 동작한다.
//
// 주의: 이 함수는 HTTP "응답 본문"(res.data)만 받는다. JS Error 객체의 e.message(네트워크/throw)나
//       WebSocket 페이로드의 message 필드와는 무관하다 — 그런 값에는 쓰지 말 것.

export function getErrorCode(data) {
  if (!data || typeof data !== 'object') return null;
  return data.code ?? data.message ?? null;
}

// 코드 + 분류 + 재시도 가능성까지 필요한 호출부를 위한 구조화 버전.
// category/retryable은 마이그레이션된 컨트롤러 응답에만 존재(아니면 null/false).
export function getError(data) {
  if (!data || typeof data !== 'object') {
    return { code: null, category: null, retryable: false, message: null };
  }
  return {
    code: getErrorCode(data),
    category: data.category ?? null,
    retryable: data.retryable ?? false,
    message: data.message ?? null,
  };
}
