from fastapi import APIRouter, Request, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from .schema import task_dependency as dep_schema
from core.controller import task_dependency as dep_controller
from library.validator import require_login
import db_engine as db

router = APIRouter()


@router.post("", summary="의존관계 생성", dependencies=[Depends(require_login)])
async def create_dependency(branch_id: int, body: dep_schema.DependencyCreate,
                            request: Request, session: AsyncSession = Depends(db.session)):
    return await dep_controller.create(body, branch_id, request, session)


@router.get("/epic/{epic_id}", summary="에픽의 의존관계 목록", dependencies=[Depends(require_login)])
async def get_epic_dependencies(branch_id: int, epic_id: int,
                                request: Request, session: AsyncSession = Depends(db.session)):
    return await dep_controller.get_by_epic(epic_id, branch_id, request, session)


@router.delete("/{dependency_id}", summary="의존관계 삭제", dependencies=[Depends(require_login)])
async def delete_dependency(branch_id: int, dependency_id: int,
                            request: Request, session: AsyncSession = Depends(db.session)):
    return await dep_controller.delete(dependency_id, branch_id, request, session)
