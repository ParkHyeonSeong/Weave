// 사용자 아바타 표현 헬퍼.
// - userInitial: 이름의 첫 글자(대문자)
// - userColor: user_id를 안정적으로 같은 색에 매핑
// 여러 컴포넌트에서 반복되던 패턴을 한 군데로 모았음.

// 모든 색이 흰 텍스트와 WCAG AA(4.5:1) 이상 대비를 갖도록 어두운 톤으로 선정.
// 7 -> 12색 확대로 userId 해시 충돌 빈도를 낮춤.
export const AVATAR_COLORS = [
  '#5E6AD2', // indigo
  '#059669', // emerald-600
  '#B45309', // amber-700
  '#9333EA', // purple
  '#BE185D', // pink-700
  '#0369A1', // sky-700
  '#DC2626', // red
  '#0D9488', // teal-600
  '#A16207', // yellow-800 (흰 텍스트 4.5:1 확보 위해 700 대신 800)
  '#7C3AED', // violet-600
  '#DB2777', // pink-600
  '#475569', // slate-600
];

// 2글자 복성 집합 — 성 길이 판별용.
const COMPOUND_SURNAMES = new Set(['남궁', '황보', '제갈', '사공', '선우', '서문', '독고', '동방']);
const HANGUL_RE = /[가-힣]/;
const CJK_RE = /[぀-ヿ㐀-鿿]/; // 가나 + 한자

// 어떤 free-form username이 와도 1~2글자 이니셜을 만든다.
// 사진(avatar_url)이 있으면 호출부에서 사진을 우선하므로 여기선 이니셜만 담당.
export function avatarInitials(name) {
  let s = (name ?? '').trim();
  if (!s) return '';
  if (s.includes('@')) s = s.split('@')[0].trim();
  if (!s) return '';

  const firstLetter = (s.match(/\p{L}/u) || [])[0];
  if (!firstLetter) {
    // letter 없음(숫자/기호만) -> 정제 문자열 앞 2자
    return s.replace(/\s+/g, '').slice(0, 2).toUpperCase();
  }

  // 한글: 성 제외 이름(최대 2자), 2자 이하 이름은 통째.
  if (HANGUL_RE.test(firstLetter)) {
    const compact = s.replace(/\s+/g, '');
    if (compact.length <= 2) return compact.slice(0, 2);
    const surLen = COMPOUND_SURNAMES.has(compact.slice(0, 2)) ? 2 : 1;
    const given = compact.slice(surLen) || compact;
    return given.slice(0, 2);
  }

  // 기타 CJK(한자/가나): 신뢰 가능한 성 파싱 불가 -> 앞 2글자.
  if (CJK_RE.test(firstLetter)) {
    return s.replace(/\s+/g, '').slice(0, 2);
  }

  // 라틴/일반: 공백 및 . _ - 로 토큰 분리.
  const tokens = s.split(/[\s._-]+/).filter((t) => /\p{L}/u.test(t));
  if (tokens.length >= 2) {
    const a = (tokens[0].match(/\p{L}/u) || [''])[0];
    const b = (tokens[tokens.length - 1].match(/\p{L}/u) || [''])[0];
    return (a + b).toUpperCase();
  }
  const letters = ((tokens[0] || s).match(/\p{L}/gu) || []);
  return letters.slice(0, 2).join('').toUpperCase();
}

export function userInitial(username) {
  return (username || '?').charAt(0).toUpperCase();
}

export function userColor(userId, override) {
  if (override && AVATAR_COLORS.includes(override)) return override;
  if (userId == null) return '#9CA3AF';
  return AVATAR_COLORS[Math.abs(Number(userId)) % AVATAR_COLORS.length];
}

// user 객체(필드명이 화면마다 제각각)를 아바타 렌더에 필요한 표준 형태로 환원.
export function avatarMarkup(user, baseUrl = '') {
  const u = user || {};
  const name = u.username ?? u.name ?? u.display_name ?? u.author_name ?? '';
  const id = u.user_id ?? u.id ?? u.author_id ?? null;
  const url = u.avatar_url ?? u.avatarUrl ?? null;
  const override = u.avatar_color ?? u.color ?? null;
  return {
    name,
    title: name || 'Unknown',
    initials: avatarInitials(name),
    color: userColor(id, override),
    src: url ? `${baseUrl}${url}` : null,
  };
}

// JSX를 쓸 수 없는 곳(예: Canvas Y.js 협업 커서)을 위한 임퍼러티브 빌더.
// <Avatar>와 동일한 마크업(사진/이니셜/색/title)을 가진 HTMLElement 반환.
export function buildAvatarDOM(user, baseUrl = '') {
  const m = avatarMarkup(user, baseUrl);
  const el = document.createElement('span');
  el.className = 'Avatar Avatar--xs';
  el.setAttribute('title', m.title);
  if (m.src) {
    const img = document.createElement('img');
    img.className = 'Avatar__Img';
    img.src = m.src;
    img.alt = m.title;
    el.appendChild(img);
  } else {
    el.style.background = m.color;
    el.textContent = m.initials;
  }
  return el;
}
