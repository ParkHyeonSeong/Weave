/**
 * taskFilters.js — TaskList·BoardView 공유 필터 predicate.
 * FilterSpec 평가기(filterSpec.js)에 단일 경로로 위임한다. ctx.spec(prebuilt
 * effectiveSpec)이 있으면 그것을, 없으면 레거시 ctx를 toFilterSpec으로 변환해 평가한다.
 * 이 ctx.spec 분기 덕분에 prebuilt spec을 넘겨도 filters.priorities 접근으로 터지지 않는다.
 */
import { evaluate } from './filterSpec';
import { toFilterSpec } from './filterSpecAdapter';

export function matchesFilters(task, ctx) {
  const spec = ctx.spec || toFilterSpec(ctx);
  return evaluate(task, spec, { userId: ctx.userId, today: ctx.today });
}

/**
 * filterTaskTree — 필터 활성 시 부모/하위 트리에 필터를 적용한다.
 * 부모가 불일치여도 하위가 하나라도 일치하면 부모를 "컨텍스트 행"으로 남기고
 * (isContextOnly=true) 일치한 하위만 visibleSubtasks 에 담는다.
 * 부모·하위 모두 불일치면 행 전체를 제거한다.
 * 호출 측에서 필터 비활성 시에는 호출하지 않는다(원본 배열 그대로 사용).
 * 주의: task.subtasks 원본은 보존하고 visibleSubtasks 파생 필드만 추가한다.
 */
export function filterTaskTree(tasks, ctx) {
  return (tasks || []).reduce((acc, task) => {
    const parentMatch = matchesFilters(task, ctx);
    const matchedSubs = (task.subtasks || []).filter((sub) => matchesFilters(sub, ctx));
    if (!parentMatch && matchedSubs.length === 0) return acc;
    acc.push({ ...task, visibleSubtasks: matchedSubs, isContextOnly: !parentMatch });
    return acc;
  }, []);
}

/**
 * countMatchedTasks — 섹션 배지에 표시할 "자동으로 화면에 드러나는 매칭 항목 수".
 * autoExpandedParents 가 컨텍스트 부모(직접 불일치)만 자동 펼치는 동작에 정확히 맞춘다:
 *   - 직접 매칭 부모(isContextOnly=false): 그 자체가 결과이므로 1.
 *     (하위는 autoExpand 대상이 아니라 접혀 있으므로 세지 않음 — 기존 "부모 행 수" 모델 유지)
 *   - 컨텍스트 부모(isContextOnly=true): 자기 자신은 결과가 아니고, autoExpand 로 펼쳐진
 *     매칭 하위(visibleSubtasks)가 결과이므로 그 수만큼.
 * 따라서 배지는 "자동으로 드러나는 매칭 행 수"와 일치한다(예: 부모 done + done 하위가
 * 접혀 있으면 배지 1 = 화면 1). 단 사용자가 직접 매칭 부모를 수동으로 펼치면 그 매칭
 * 하위까지 렌더되어 화면 행 수가 배지보다 많을 수 있다(배지는 보수적으로 작게 셈 — 의도).
 * 필터 비활성 원본 배열(플래그 미부여)에서는 각 항목이 1 → length 와 동일(기존 동작 보존).
 */
export function countMatchedTasks(filteredTasks) {
  return (filteredTasks || []).reduce(
    (n, t) => n + (t.isContextOnly ? (t.visibleSubtasks?.length || 0) : 1),
    0,
  );
}
