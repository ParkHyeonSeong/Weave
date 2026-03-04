import re
from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from core.model import branch as branch_model
from core.model import branch_member as member_model


def _slugify(name: str) -> str:
    """Branch 이름을 URL-safe slug로 변환"""
    slug = name.lower().strip()
    slug = re.sub(r'[^a-z0-9가-힣\s-]', '', slug)
    slug = re.sub(r'[\s]+', '-', slug)
    slug = re.sub(r'-+', '-', slug).strip('-')
    return slug or 'branch'


async def create(body, request: Request, db: AsyncSession):
    """Branch 생성"""
    user_id = request.state.payload.get('user_id')

    # slug 생성 + 중복 체크
    slug = _slugify(body.branch_name)
    base_slug = slug
    counter = 1
    while await branch_model.find_by_slug(slug, db):
        slug = f'{base_slug}-{counter}'
        counter += 1

    branch_id = await branch_model.create(
        branch_name=body.branch_name,
        slug=slug,
        description=body.description or '',
        visibility=body.visibility,
        created_by=user_id,
        db=db,
    )

    # 생성자를 admin으로 자동 추가
    await member_model.add(branch_id, user_id, 'admin', db)

    return {
        'status': True,
        'branch_id': branch_id,
        'slug': slug,
    }


async def get_list(request: Request, db: AsyncSession):
    """내가 접근 가능한 Branch 목록"""
    user_id = request.state.payload.get('user_id')
    branches = await branch_model.find_accessible(user_id, db)
    return {'status': True, 'branches': branches}


async def get_detail(branch_id: int, request: Request, db: AsyncSession):
    """Branch 상세"""
    branch = await branch_model.find_by_id(branch_id, db)
    if not branch:
        return {'status': False, 'message': 'BRANCH_NOT_FOUND'}
    return {'status': True, 'branch': branch}
