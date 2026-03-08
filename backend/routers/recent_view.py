from fastapi import APIRouter, Depends, Request
from sqlalchemy.ext.asyncio import AsyncSession

import db_engine as db
from library.validator import require_login
from core.model import recent_view as rv_model

router = APIRouter(dependencies=[Depends(require_login)])


@router.get("", summary="최근 조회 항목")
async def get_recent_views(request: Request, limit: int = 10,
                           session: AsyncSession = Depends(db.session)):
    user_id = request.state.payload.get('user_id')
    items = await rv_model.find_recent(user_id, min(limit, 30), session)
    return {'status': True, 'items': items}
