import { useState, useMemo } from 'react';
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors,
} from '@dnd-kit/core';
import {
  SortableContext, rectSortingStrategy, useSortable, arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Pencil, Check, X, GripVertical, Plus } from 'lucide-react';
import { WIDGET_REGISTRY, WIDGET_ORDER, DEFAULT_ENABLED } from './widgetRegistry';
import { useUiPrefs } from '@/library/UiPrefsContext';

// 저장본에서 알 수 없는 위젯 key 제거. 값 없으면 기본 활성 세트.
function normalizeEnabled(saved) {
  if (Array.isArray(saved)) return saved.filter((k) => WIDGET_REGISTRY[k]);
  return [...DEFAULT_ENABLED];
}

function SortableWidget({ id, editing, onRemove }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } =
    useSortable({ id, disabled: !editing });
  const entry = WIDGET_REGISTRY[id];
  const Component = entry.Component;
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
  };
  return (
    <div ref={setNodeRef} style={style} className="WidgetZone__Cell">
      {editing && (
        <div className="WidgetZone__CellBar">
          <span className="WidgetZone__Grip" {...attributes} {...listeners}>
            <GripVertical size={14} />
          </span>
          <span className="WidgetZone__CellLabel">{entry.label}</span>
          <button className="WidgetZone__Remove" onClick={() => onRemove(id)} title="숨기기">
            <X size={14} />
          </button>
        </div>
      )}
      <Component />
    </div>
  );
}

export default function WidgetZone() {
  const { prefs, setNamespace } = useUiPrefs();
  const enabled = useMemo(() => normalizeEnabled(prefs.widget_layout), [prefs.widget_layout]);
  const [editing, setEditing] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
  );

  // 변경 시 즉시 저장(네임스페이스 교체 → 낙관적 업데이트 + 서버 저장)
  const update = (next) => setNamespace('widget_layout', next);

  const handleDragEnd = (event) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = enabled.indexOf(active.id);
    const newIndex = enabled.indexOf(over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    update(arrayMove(enabled, oldIndex, newIndex));
  };

  const removeWidget = (key) => update(enabled.filter((k) => k !== key));
  const addWidget = (key) => { if (!enabled.includes(key)) update([...enabled, key]); };

  return (
    <div className="WidgetZone">
      <div className="WidgetZone__Header">
        <span className="WidgetZone__Title">내 워크스페이스</span>
        <button className="WidgetZone__EditBtn" onClick={() => setEditing((p) => !p)}>
          {editing ? <><Check size={14} /> 완료</> : <><Pencil size={14} /> 편집</>}
        </button>
      </div>

      {editing && (
        <div className="WidgetZone__Catalog">
          {WIDGET_ORDER.map((key) => {
            const on = enabled.includes(key);
            return (
              <button
                key={key}
                className={`WidgetZone__Chip ${on ? 'WidgetZone__Chip--on' : ''}`}
                onClick={() => (on ? removeWidget(key) : addWidget(key))}
              >
                {on ? <Check size={12} /> : <Plus size={12} />} {WIDGET_REGISTRY[key].label}
              </button>
            );
          })}
        </div>
      )}

      {enabled.length === 0 ? (
        <div className="WidgetZone__Empty">표시할 위젯이 없어요. 편집에서 위젯을 추가하세요.</div>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={enabled} strategy={rectSortingStrategy}>
            <div className="WidgetZone__Grid">
              {enabled.map((key) => (
                <SortableWidget key={key} id={key} editing={editing} onRemove={removeWidget} />
              ))}
            </div>
          </SortableContext>
        </DndContext>
      )}
    </div>
  );
}
