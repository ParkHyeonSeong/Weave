// 에러 코드 → 사용자 노출 문구(한국어)의 단일 출처.
//
// 기존엔 컴포넌트마다 인라인 ternary/객체로 code→문구를 흩어 매핑했고, 같은 코드에
// 영어/한국어가 뒤섞이고 문구도 제각각이었다(예: NOT_BRANCH_MEMBER 4종, FILE_TOO_LARGE 3종).
// 여기로 통합해 한 곳에서 일관된 한국어 문구를 제공한다.
//
// errorText(code) → 매핑된 문구. 없으면 category 폴백, 그것도 없으면 null(호출부가 자체 폴백 사용).
// 문구에 컨텍스트별 수치(예: 파일 2MB vs 10MB)가 필요한 호출부는 인라인으로 직접 처리한다(여긴 일반형).

const ERROR_TEXT = {
  // --- 권한/멤버십 (forbidden) ---
  NOT_BRANCH_MEMBER: '이 브랜치의 멤버가 아니에요.',
  NOT_CANVAS_MEMBER: '이 캔버스의 멤버가 아니에요.',
  NOT_A_MEMBER: '멤버가 아니에요.',
  CANNOT_CHANGE_OWN_ROLE: '자신의 역할은 변경할 수 없어요.',
  CANNOT_RESET_OWN_PASSWORD: '자신의 비밀번호는 초기화할 수 없어요.',

  // --- 없음 (not_found) ---
  NOT_FOUND: '대상을 찾을 수 없어요.',
  USER_NOT_FOUND: '사용자를 찾을 수 없어요.',

  // --- 입력 검증 (validation) ---
  INVALID_TASK_TYPE: '이 브랜치에 없는 작업 유형이에요. 유형을 다시 선택해 주세요.',
  INVALID_STATUS: '이 브랜치에 없는 상태예요.',
  INVALID_ASSIGNEE: '담당자가 이 브랜치의 멤버가 아니에요.',
  INVALID_CURRENT_PASSWORD: '현재 비밀번호가 올바르지 않아요.',
  PASSWORD_MISMATCH: '새 비밀번호가 일치하지 않아요.',
  NO_FILE: '첨부할 파일을 찾을 수 없어요.',
  FILE_TOO_LARGE: '파일 용량 제한을 초과했어요.',
  INVALID_FILE_TYPE: '지원하지 않는 파일 형식이에요.',
  INVALID_FILE_CONTENT: '파일 내용이 지원하지 않는 형식이에요.',
  SELF_LINK: '자기 자신과 연결할 수 없어요.',
  CSV_PARSE_ERROR: 'CSV를 파싱할 수 없어요. Jira에서 내보낸 CSV인지 확인해 주세요.',

  // --- 인증/계정 (auth) — login/reset/setup 흐름 ---
  INVALID_CREDENTIALS: '이메일 또는 비밀번호가 올바르지 않아요.',
  ACCOUNT_PENDING: '관리자 승인을 기다리는 계정이에요.',
  ACCOUNT_INACTIVE: '비활성화된 계정이에요. 관리자에게 문의해 주세요.',
  ACCOUNT_REJECTED: '가입이 거절된 계정이에요. 관리자에게 문의해 주세요.',
  INVALID_OR_EXPIRED_TOKEN: '만료됐거나 유효하지 않은 링크예요. 비밀번호 재설정을 다시 요청해 주세요.',
  PASSWORD_TOO_SHORT: '비밀번호는 8자 이상이어야 해요.',
  ALREADY_INITIALIZED: '이미 초기 설정이 완료됐어요.',
  NOT_INITIALIZED: '먼저 시스템 초기 설정이 필요해요.',
  NOT_ALLOWED: '허용되지 않는 작업이에요.',

  // --- 충돌 (conflict) ---
  KEY_ALREADY_EXISTS: '이미 사용 중인 키예요.',
  EMAIL_ALREADY_EXISTS: '이미 가입된 이메일이에요.',
  CIRCULAR_DEPENDENCY: '순환 의존이 생겨 만들 수 없어요.',
  STATUS_IN_USE: '사용 중인 상태라 삭제할 수 없어요.',

  // --- 비즈니스 규칙 (business) ---
  LAST_ADMIN: '마지막 관리자는 제거·변경할 수 없어요. 다른 관리자를 먼저 지정해 주세요.',
  LAST_OWNER: '마지막 소유자는 나가거나 변경할 수 없어요. 다른 소유자를 먼저 지정해 주세요.',
  SPRINT_NOT_FUTURE: '시작 예정인 스프린트만 시작할 수 있어요.',
  SPRINT_EMPTY: '태스크가 없는 스프린트는 시작할 수 없어요.',
  PARENT_NOT_TOP_LEVEL: '하위 태스크는 부모가 될 수 없어요.',
  TARGET_HAS_SUBTASKS: '하위를 가진 태스크는 다른 태스크의 하위가 될 수 없어요.',
  MIGRATION_EXPIRED: '세션이 만료됐어요. CSV를 다시 업로드해 주세요.',
};

// 코드 매핑이 없을 때 category(마이그레이션된 응답에만 존재)로 주는 일반 폴백.
const CATEGORY_TEXT = {
  auth: '다시 로그인해 주세요.',
  forbidden: '권한이 없어요.',
  not_found: '대상을 찾을 수 없어요.',
  validation: '입력값을 확인해 주세요.',
  conflict: '이미 처리됐거나 충돌이 있어요.',
  rate_limited: '요청이 많아요. 잠시 후 다시 시도해 주세요.',
  server: '일시적인 오류예요. 잠시 후 다시 시도해 주세요.',
};

export function errorText(code, category = null) {
  if (code && ERROR_TEXT[code]) return ERROR_TEXT[code];
  if (category && CATEGORY_TEXT[category]) return CATEGORY_TEXT[category];
  return null;
}
