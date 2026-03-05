from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from core.model import label as label_model
from core.model import branch_member as member_model


async def create(body, branch_id: int, request: Request, db: AsyncSession):
    """Label 생성"""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(branch_id, user_id, db):
        return {'status': False, 'message': 'NOT_BRANCH_MEMBER'}

    try:
        label_id = await label_model.create(
            branch_id=branch_id,
            label_name=body.label_name,
            color=body.color,
            db=db,
        )
    except Exception:
        return {'status': False, 'message': 'LABEL_ALREADY_EXISTS'}

    return {'status': True, 'label_id': label_id}


async def get_list(branch_id: int, request: Request, db: AsyncSession):
    """Label 목록"""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(branch_id, user_id, db):
        return {'status': False, 'message': 'NOT_BRANCH_MEMBER'}

    labels = await label_model.find_by_branch(branch_id, db)
    return {'status': True, 'labels': labels}


async def update(label_id: int, body, branch_id: int, request: Request, db: AsyncSession):
    """Label 수정"""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(branch_id, user_id, db):
        return {'status': False, 'message': 'NOT_BRANCH_MEMBER'}

    label = await label_model.find_by_id(label_id, db)
    if not label or label['branch_id'] != branch_id:
        return {'status': False, 'message': 'LABEL_NOT_FOUND'}

    await label_model.update(
        label_id,
        body.label_name or label['label_name'],
        body.color or label['color'],
        db,
    )
    return {'status': True}


async def delete(label_id: int, branch_id: int, request: Request, db: AsyncSession):
    """Label 삭제"""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(branch_id, user_id, db):
        return {'status': False, 'message': 'NOT_BRANCH_MEMBER'}

    label = await label_model.find_by_id(label_id, db)
    if not label or label['branch_id'] != branch_id:
        return {'status': False, 'message': 'LABEL_NOT_FOUND'}

    await label_model.delete(label_id, db)
    return {'status': True}
