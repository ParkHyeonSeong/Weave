// 에디터/메신저 공용 슬래시 커맨드 단일 소스.
export const SLASH_COMMANDS = [
  { cmd: '/t',  label: 'Search my tasks',  kind: 'task',  mode: 'my'  },
  { cmd: '/ta', label: 'Search all tasks', kind: 'task',  mode: 'all' },
  { cmd: '/d',  label: 'Search documents', kind: 'doc'  },
  { cmd: '/i',  label: 'Search issues',    kind: 'issue' },
];

function pool(enabled) {
  return enabled ? SLASH_COMMANDS.filter((c) => enabled.includes(c.cmd)) : SLASH_COMMANDS;
}

// query(예: '/t')로 시작하는 커맨드. '' 또는 '/'면 전체. enabled로 호스트별 노출 제한.
export function filterSlashCommands(query, enabled = null) {
  const list = pool(enabled);
  if (!query || query === '/') return list;
  return list.filter((c) => c.cmd.startsWith(query));
}

// query와 정확히 일치하는 커맨드(스페이스 즉시 확정용). 없으면 null.
export function exactSlashCommand(query, enabled = null) {
  return pool(enabled).find((c) => c.cmd === query) || null;
}
