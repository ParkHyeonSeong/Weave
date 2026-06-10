import {
  ArrowRight, ExternalLink, Settings, Pencil, Users, Eye, EyeOff, Archive, LogOut,
  FileText, FileCode, FolderPlus,
} from 'lucide-react';

// space: { appType:'branch'|'canvas'|'track'|'scrum', id, name, role, isHidden }
// h: { open, openNewTab, settings, rename, members, toggleHide, archive, leave, addDoc, addTypst, addFolder }
export function buildSpaceMenu(space, h) {
  const isAdmin = space.role === 'admin' || space.role === 'owner';
  const items = [];

  items.push({ id: 'open', group: 'open', icon: ArrowRight, label: '열기', onSelect: h.open });
  items.push({ id: 'open-new', group: 'open', icon: ExternalLink, label: '새 탭에서 열기', onSelect: h.openNewTab });

  if (space.appType === 'canvas') {
    items.push({ id: 'add-doc', group: 'create', icon: FileText, label: 'Document 추가', onSelect: h.addDoc });
    items.push({ id: 'add-typst', group: 'create', icon: FileCode, label: 'Typst 문서 추가', onSelect: h.addTypst });
    items.push({ id: 'add-folder', group: 'create', icon: FolderPlus, label: '폴더 추가', onSelect: h.addFolder });
  }

  items.push({ id: 'settings', group: 'edit', icon: Settings, label: '설정', onSelect: h.settings });
  // 숨긴 행은 인라인 rename 입력칸을 렌더하지 않으므로 rename 항목을 노출하지 않음.
  if (isAdmin && !space.isHidden) {
    items.push({ id: 'rename', group: 'edit', icon: Pencil, label: '이름 변경', onSelect: h.rename });
  }

  items.push({ id: 'members', group: 'share', icon: Users, label: '멤버 관리', onSelect: h.members });

  items.push({
    id: 'hide', group: 'organize', icon: space.isHidden ? Eye : EyeOff,
    label: space.isHidden ? '숨김 해제' : '숨기기', onSelect: h.toggleHide,
  });

  if (isAdmin) {
    items.push({ id: 'archive', group: 'danger', icon: Archive, variant: 'danger', label: '아카이브', onSelect: h.archive });
  }
  items.push({ id: 'leave', group: 'danger', icon: LogOut, variant: 'danger', label: '나가기', onSelect: h.leave });

  return items;
}
