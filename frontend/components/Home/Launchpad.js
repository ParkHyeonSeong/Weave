import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import {
  SortableContext, rectSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GitBranch, FileEdit, Workflow, Compass, CalendarCheck } from 'lucide-react';
import { APP_HOME } from '@/library/appContext';
import { DEFAULT_COLORS } from '@/library/entityAppearance';

// key 기반 앱 레지스트리. 정렬 가능한 앱 타일만 여기에 둔다(browse 제외).
const APP_REGISTRY = {
  scrum:  { key: 'scrum',  label: 'Scrum',  sub: '데일리·회고',   Icon: CalendarCheck, color: DEFAULT_COLORS.scrum,  path: APP_HOME.scrum },
  track:  { key: 'track',  label: 'Track',  sub: '워크플로우',     Icon: Workflow,      color: DEFAULT_COLORS.track,  path: APP_HOME.track },
  branch: { key: 'branch', label: 'Branch', sub: '프로젝트·작업', Icon: GitBranch,     color: DEFAULT_COLORS.branch, path: APP_HOME.branch },
  canvas: { key: 'canvas', label: 'Canvas', sub: '문서',          Icon: FileEdit,      color: DEFAULT_COLORS.canvas, path: APP_HOME.canvas },
};

// 기본 순서: daily(scrum) → track → branch → canvas
const DEFAULT_ORDER = ['scrum', 'track', 'branch', 'canvas'];

// browse는 앱이 아닌 부가 진입점 → 정렬 대상에서 제외하고 항상 마지막 고정.
const BROWSE_TILE = { key: 'browse', label: '둘러보기', sub: '공개 브랜치', Icon: Compass, color: '#F59E0B', path: '/browse' };

const STORAGE_KEY = 'home_launchpad_order';

// 저장된 순서를 읽되: 알 수 없는 key는 버리고, 기본 순서에 있는데 저장본에 없는 key는
// 뒤에 자동 추가(향후 새 앱 추가 시 자동 노출). 실패 시 기본 순서.
function loadOrder() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const known = parsed.filter((k) => APP_REGISTRY[k]);
        const missing = DEFAULT_ORDER.filter((k) => !known.includes(k));
        return [...known, ...missing];
      }
    }
  } catch {}
  return [...DEFAULT_ORDER];
}

function saveOrder(keys) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(keys)); } catch {}
}

function TileBody({ app }) {
  const Icon = app.Icon;
  return (
    <>
      <span className="Launchpad__Icon" style={{ background: app.color }}>
        {/* 배지 슬롯(향후): <span className="Launchpad__Badge" /> */}
        <Icon size={30} color="#fff" strokeWidth={2} />
      </span>
      <span className="Launchpad__Name">{app.label}</span>
      <span className="Launchpad__Sub">{app.sub}</span>
    </>
  );
}

function SortableTile({ app, onOpen }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id: app.key });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  return (
    <button
      ref={setNodeRef}
      style={style}
      className="Launchpad__Tile Launchpad__Tile--sortable"
      onClick={onOpen}
      {...attributes}
      {...listeners}
    >
      <TileBody app={app} />
    </button>
  );
}

export default function Launchpad() {
  const router = useRouter();
  const [order, setOrder] = useState(() => [...DEFAULT_ORDER]);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  // 마운트 후 localStorage 로드(SSR 하이드레이션 불일치 방지 위해 effect에서)
  useEffect(() => { setOrder(loadOrder()); }, []);

  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = order.indexOf(active.id);
    const newIndex = order.indexOf(over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const next = arrayMove(order, oldIndex, newIndex);
    setOrder(next);
    saveOrder(next);
  };

  return (
    <div className="Launchpad">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={order} strategy={rectSortingStrategy}>
          {order.map((key) => {
            const app = APP_REGISTRY[key];
            return (
              <SortableTile key={app.key} app={app} onOpen={() => router.push(app.path)} />
            );
          })}
        </SortableContext>
      </DndContext>
      <button className="Launchpad__Tile" onClick={() => router.push(BROWSE_TILE.path)}>
        <TileBody app={BROWSE_TILE} />
      </button>
    </div>
  );
}
