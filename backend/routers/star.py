from fastapi import APIRouter, Depends, Request
from pydantic import BaseModel
from sqlalchemy.ext.asyncio import AsyncSession

import db_engine as db
from library.validator import require_login
from core.model import star as star_model
from core.controller import star as star_controller

router = APIRouter(dependencies=[Depends(require_login)])


class StarToggle(BaseModel):
    item_type: str  # 'task' | 'doc'
    item_id: int


@router.post("", summary="Star 토글")
async def toggle_star(body: StarToggle, request: Request,
                      session: AsyncSession = Depends(db.session)):
    return await star_controller.toggle(body, request, session)


@router.get("", summary="Star 목록")
async def get_starred(request: Request, limit: int = 20,
                      type: str | None = None,
                      session: AsyncSession = Depends(db.session)):
    user_id = request.state.payload.get('user_id')
    items = await star_model.find_starred(user_id, min(limit, 50), session, item_type=type)
    return {'status': True, 'items': items}


@router.get("/check", summary="Star 여부 확인")
async def check_starred(item_type: str, item_id: int, request: Request,
                        session: AsyncSession = Depends(db.session)):
    return await star_controller.is_starred(item_type, item_id, request, session)
