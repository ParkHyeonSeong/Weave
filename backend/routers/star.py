from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

import db_engine as db
from library.validator import require_login
from core.model import star as star_model

router = APIRouter(dependencies=[Depends(require_login)])


class StarToggle(BaseModel):
    item_type: str  # 'task' | 'doc'
    item_id: int


@router.post("", summary="Star 토글")
async def toggle_star(body: StarToggle, request: Request,
                      session: AsyncSession = Depends(db.session)):
    if body.item_type not in ('task', 'doc'):
        return {'status': False, 'message': 'INVALID_ITEM_TYPE'}
    user_id = request.state.payload.get('user_id')
    result = await star_model.toggle(user_id, body.item_type, body.item_id, session)
    return {'status': True, 'starred': result['starred']}


@router.get("", summary="Star 목록")
async def get_starred(request: Request, limit: int = 20,
                      session: AsyncSession = Depends(db.session)):
    user_id = request.state.payload.get('user_id')
    items = await star_model.find_starred(user_id, min(limit, 50), session)
    return {'status': True, 'items': items}


@router.get("/check", summary="Star 여부 확인")
async def check_starred(item_type: str, item_id: int, request: Request,
                        session: AsyncSession = Depends(db.session)):
    user_id = request.state.payload.get('user_id')
    starred = await star_model.is_starred(user_id, item_type, item_id, session)
    return {'status': True, 'starred': starred}
