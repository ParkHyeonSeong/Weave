from fastapi import APIRouter, Request, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from .schema import github as github_schema
from core.controller import github_integration as int_controller
from core.controller import github_ref as ref_controller
from library.validator import require_login
import db_engine as db

# /api/branches/{branch_id}/github
admin_router = APIRouter()

# /api/branches/{branch_id}/tasks/{task_id}/github-refs
ref_router = APIRouter()


@admin_router.get("", summary="GitHub 연결 목록", dependencies=[Depends(require_login)])
async def list_integrations(branch_id: int, request: Request,
                            session: AsyncSession = Depends(db.session)):
    return await int_controller.list_integrations(branch_id, request, session)


@admin_router.post("", summary="GitHub 연결 생성", dependencies=[Depends(require_login)])
async def create_integration(branch_id: int, body: github_schema.IntegrationCreate,
                             request: Request, session: AsyncSession = Depends(db.session)):
    return await int_controller.create_integration(body, branch_id, request, session)


@admin_router.patch("/{integration_id}", summary="GitHub 연결 활성 토글",
                    dependencies=[Depends(require_login)])
async def toggle_integration(branch_id: int, integration_id: int,
                             body: github_schema.IntegrationToggle,
                             request: Request, session: AsyncSession = Depends(db.session)):
    return await int_controller.set_enabled(branch_id, integration_id, body, request, session)


@admin_router.delete("/{integration_id}", summary="GitHub 연결 삭제",
                     dependencies=[Depends(require_login)])
async def delete_integration(branch_id: int, integration_id: int,
                             request: Request, session: AsyncSession = Depends(db.session)):
    return await int_controller.delete_integration(branch_id, integration_id, request, session)


@ref_router.get("", summary="태스크 GitHub ref 목록", dependencies=[Depends(require_login)])
async def list_refs(branch_id: int, task_id: int, request: Request,
                    session: AsyncSession = Depends(db.session)):
    return await ref_controller.list_refs(branch_id, task_id, request, session)


@ref_router.post("", summary="태스크에 PR 수동 연결", dependencies=[Depends(require_login)])
async def link_ref(branch_id: int, task_id: int, body: github_schema.RefLinkCreate,
                   request: Request, session: AsyncSession = Depends(db.session)):
    return await ref_controller.link_ref(body, branch_id, task_id, request, session)


@ref_router.delete("/{ref_id}", summary="태스크 GitHub ref 해제",
                   dependencies=[Depends(require_login)])
async def unlink_ref(branch_id: int, task_id: int, ref_id: int, request: Request,
                     session: AsyncSession = Depends(db.session)):
    return await ref_controller.unlink_ref(branch_id, task_id, ref_id, request, session)
