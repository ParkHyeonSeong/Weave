from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from core.errors import error_response, ErrorCode
from core.model import scrum_board as board_model
from core.model import scrum_member as member_model
from core.model import scrum_week as week_model
from library.scrum_cells import read_cells, write_cell_into_doc
from library.ws_collab_manager import scrum_week_collab_manager
from routers.schema.scrum_cell import VALID_MODES, VALID_ROWS, WeekCellWrite


async def _require_member(board_id: int, request: Request, db: AsyncSession):
    """보드 존재 + 멤버십 확인. 통과 시 (user_id, None), 실패 시 (None, err_dict)."""
    if not await board_model.find_by_id(board_id, db):
        return None, error_response(ErrorCode.BOARD_NOT_FOUND)
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(board_id, user_id, db):
        return None, error_response(ErrorCode.PERMISSION_DENIED)
    return user_id, None


async def get_week(board_id: int, iso_year: int, iso_week: int,
                   request: Request, db: AsyncSession):
    """주 문서를 보장(get_or_create)하고 메타 반환. 멤버 전용."""
    _, err = await _require_member(board_id, request, db)
    if err:
        return err
    week = await week_model.get_or_create(board_id, iso_year, iso_week, db)
    return {'status': True, 'week': week}


async def get_week_cells(board_id: int, iso_year: int, iso_week: int,
                         request: Request, db: AsyncSession):
    """주간 그리드의 모든 멤버×요일×row 셀 내용을 평문으로 반환. 멤버 전용."""
    _, err = await _require_member(board_id, request, db)
    if err:
        return err
    week = await week_model.get_or_create(board_id, iso_year, iso_week, db)
    members = await member_model.find_by_board(board_id, db)
    keys = [f"{m['user_id']}:{d}:{r}"
            for m in members for d in range(5) for r in VALID_ROWS]
    state = await scrum_week_collab_manager.snapshot_state(week['week_id'], db)
    return {'status': True, 'week': week, 'cells': read_cells(state, keys)}


async def write_week_cell(board_id: int, iso_year: int, iso_week: int,
                          body: WeekCellWrite, request: Request, db: AsyncSession):
    """토큰 주체 본인의 데일리스크럼 셀 1개를 쓴다. 멤버 전용."""
    user_id, err = await _require_member(board_id, request, db)
    if err:
        return err
    if body.row not in VALID_ROWS or body.mode not in VALID_MODES:
        return error_response(ErrorCode.INVALID_CELL)
    week = await week_model.get_or_create(board_id, iso_year, iso_week, db)
    key = f"{user_id}:{body.day}:{body.row}"  # 본인 강제
    await scrum_week_collab_manager.apply_external_mutation(
        week['week_id'],
        lambda doc: write_cell_into_doc(doc, key, body.text, body.mode),
        db)
    return {'status': True, 'week_id': week['week_id'], 'cell': key}
