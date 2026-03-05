from fastapi import APIRouter, Request, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from .schema import branch as branch_schema
from core.controller import branch as branch_controller
from core.model import branch_member as member_model
from library.validator import require_login
import db_engine as db

router = APIRouter()


@router.post("", summary="Branch 생성", dependencies=[Depends(require_login)])
async def create_branch(request: Request, body: branch_schema.BranchCreate,
                        session: AsyncSession = Depends(db.session)):
    return await branch_controller.create(body, request, session)


@router.get("", summary="Branch 목록", dependencies=[Depends(require_login)])
async def list_branches(request: Request, session: AsyncSession = Depends(db.session)):
    return await branch_controller.get_list(request, session)


@router.get("/{branch_id}", summary="Branch 상세", dependencies=[Depends(require_login)])
async def get_branch(branch_id: int, request: Request,
                     session: AsyncSession = Depends(db.session)):
    return await branch_controller.get_detail(branch_id, request, session)


@router.get("/{branch_id}/members", summary="Branch 멤버 목록", dependencies=[Depends(require_login)])
async def list_branch_members(branch_id: int, request: Request,
                              session: AsyncSession = Depends(db.session)):
    members = await member_model.find_by_branch(branch_id, session)
    return {'status': True, 'members': members}
