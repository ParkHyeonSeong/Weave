# Task Drag & Drop + Inline Type Selection Design

## Context
Task 탭에서 스프린트/백로그 간 태스크 이동, 순서 조절, 스프린트 순서 조절이 불가능함.
인라인 태스크 생성 시 타입 선택도 불가. dnd-kit 패키지는 설치되어 있으나 미사용 상태.

## Features

### 1. 스프린트 간 순서 조절 (DnD)
- TaskList.js에 dnd-kit `DndContext` + `SortableContext` 적용
- 각 TaskListSprint 헤더 왼쪽에 `GripVertical` 드래그 핸들 추가
- 백로그는 항상 맨 아래 고정 (sortable에서 제외)
- 드래그 종료 시 `POST /branches/{bid}/sprints/reorder` 호출

### 2. 태스크 DnD (스프린트/백로그 간 이동 + 순서 조절)
- 각 TaskListRow 왼쪽에 `GripVertical` 드래그 핸들
- 스프린트/백로그 본문이 droppable 컨테이너
- 같은 컨테이너 내 드래그 = 순서 변경, 다른 컨테이너로 드래그 = 이동 + 순서 변경
- **다중 선택**: 클릭으로 선택(하이라이트), Cmd+Click으로 다중 선택, 선택된 태스크 중 하나를 드래그하면 전부 이동
- 드래그 종료 시 `POST /branches/{bid}/tasks/reorder` 호출

### 3. 백로그 내 순서 조절
- 2번에 자연스럽게 포함됨 (백로그 = sprint_id가 null인 droppable 컨테이너)

### 4. 인라인 태스크 생성 시 타입 선택
- 인라인 폼의 `<Plus>` 아이콘 → 현재 타입의 `TaskTypeIcon`으로 교체
- 클릭하면 타입 드롭다운 (taskTypes 목록)
- 기본값: `'task'`
- POST 시 `task_type` 필드 추가

---

## Backend API

### `POST /branches/{branch_id}/sprints/reorder`
스프린트 순서 일괄 변경.
```json
// Request
{ "sprint_ids": [3, 1, 2] }
// Response
{ "status": true }
```
- sprint_ids 배열 순서대로 sort_order = 0, 1, 2... 갱신
- 해당 branch의 스프린트만 허용 (검증)

### `POST /branches/{branch_id}/tasks/reorder`
태스크 이동 + 순서 변경 (다중 지원).
```json
// Request
{
  "task_ids": [42, 15, 7],
  "sprint_id": 3,        // null = backlog
  "after_task_id": 10    // null = 맨 위에 삽입
}
// Response
{ "status": true }
```
- task_ids의 태스크들을 대상 sprint_id로 이동
- after_task_id 뒤에 삽입 (null이면 맨 위)
- 해당 컨테이너 내 다른 태스크들의 sort_order 재정렬

---

## Frontend Architecture

### DnD 구조 (dnd-kit)
```
TaskList.js
├── DndContext (collision: closestCorner, sensors: pointer+keyboard)
│   ├── SortableContext (sprints - vertical)
│   │   ├── SortableSprintWrapper (sprint 1)
│   │   │   └── TaskListSprint
│   │   │       └── SortableContext (tasks - vertical)
│   │   │           ├── DroppableContainer (sprint body)
│   │   │           ├── SortableTaskRow (task A)
│   │   │           └── SortableTaskRow (task B)
│   │   ├── SortableSprintWrapper (sprint 2)
│   │   │   └── ...
│   │   └── (backlog은 SortableContext 밖 - 고정 위치)
│   └── TaskListSprint (backlog - not sortable, but droppable)
│       └── SortableContext (backlog tasks)
│           ├── SortableTaskRow (task C)
│           └── SortableTaskRow (task D)
└── DragOverlay (드래그 중 표시되는 프리뷰)
```

### 다중 선택 상태관리
- TaskList.js에 `selectedTaskIds: Set<number>` state 추가
- 클릭: 해당 태스크만 선택 (+ 디테일 패널 열기)
- Cmd/Ctrl + Click: 선택 토글 (디테일 패널은 열지 않음)
- 드래그 시작: 드래그 대상이 selectedTaskIds에 포함되면 전부 이동, 아니면 해당 태스크만 이동
- DragOverlay: 다중 선택 시 "3 tasks" 같은 카운트 배지 표시

### 인라인 타입 선택 UI
```
[TaskTypeIcon ▾] [_________________input________________]
  └── 클릭 시 드롭다운
      ├── ✓ Task (CheckSquare)
      ├── Bug (Bug)
      └── Story (BookOpen)
```
- TaskListSprint의 inlineCreate 상태에 `inlineType: 'task'` 추가
- TaskTypeIcon을 버튼으로 감싸고, 클릭 시 타입 드롭다운 토글

---

## Files to Modify

### Backend
| File | Change |
|------|--------|
| `backend/routers/sprint.py` | `reorder` endpoint 추가 |
| `backend/routers/schema/sprint.py` | `SprintReorder` schema 추가 |
| `backend/core/controller/sprint.py` | `reorder()` 함수 추가 |
| `backend/core/model/sprint.py` | `reorder()` SQL 추가 |
| `backend/routers/task.py` | `reorder` endpoint 추가 |
| `backend/routers/schema/task.py` | `TaskReorder` schema 추가 |
| `backend/core/controller/task.py` | `reorder()` 함수 추가 |
| `backend/core/model/task.py` | `reorder()` SQL 추가 |

### Frontend
| File | Change |
|------|--------|
| `frontend/components/Branch/Tasks/TaskList.js` | DndContext, 다중 선택 상태, onDragEnd 핸들러 |
| `frontend/components/Branch/Tasks/TaskListSprint.js` | SortableContext, droppable, 드래그 핸들, 인라인 타입 선택 |
| `frontend/components/Branch/Tasks/TaskListRow.js` | useSortable, 드래그 핸들, 선택 상태 스타일 |
| `frontend/styles/components/branch/taskList.scss` | 드래그 핸들, 선택 하이라이트, 드롭 영역 스타일 |

---

## Verification
1. 스프린트 2개 이상 생성 → 드래그 핸들로 순서 변경 → 새로고침 후 순서 유지 확인
2. 태스크를 스프린트 → 백로그로 드래그 → sprint_id가 null로 변경 확인
3. 태스크를 백로그 → 스프린트로 드래그 → sprint_id 변경 확인
4. 같은 스프린트 내 태스크 순서 변경 → sort_order 변경 확인
5. Cmd+Click으로 3개 태스크 다중 선택 → 드래그로 다른 스프린트 이동 → 전부 이동 확인
6. 인라인 생성 시 타입 아이콘 클릭 → 드롭다운에서 Bug 선택 → 생성된 태스크 타입 확인
