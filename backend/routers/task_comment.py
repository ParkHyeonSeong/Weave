from typing import Literal

from fastapi import APIRouter, Request, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from .schema import task_comment as comment_schema
from core.controller import task_comment as comment_controller
from library.validator import require_login
import db_engine as db

router = APIRouter()


@router.get("", summary="댓글 목록", dependencies=[Depends(require_login)])
async def list_comments(branch_id: int, task_id: int, request: Request,
                         order: Literal['asc', 'desc'] = 'asc',
                         format: Literal['html', 'markdown'] = 'html',
                         session: AsyncSession = Depends(db.session)):
    return await comment_controller.list_comments(branch_id, task_id, request, session,
                                                   order=order, fmt=format)


@router.post("", summary="댓글 작성", dependencies=[Depends(require_login)])
async def create_comment(branch_id: int, task_id: int,
                          body: comment_schema.CommentCreate,
                          request: Request,
                          session: AsyncSession = Depends(db.session)):
    return await comment_controller.create_comment(body, branch_id, task_id, request, session)


@router.patch("/{comment_id}", summary="댓글 수정 (본인)",
              dependencies=[Depends(require_login)])
async def update_comment(branch_id: int, task_id: int, comment_id: int,
                          body: comment_schema.CommentUpdate,
                          request: Request,
                          session: AsyncSession = Depends(db.session)):
    return await comment_controller.update_comment(
        body, branch_id, task_id, comment_id, request, session)


@router.delete("/{comment_id}", summary="댓글 삭제 (본인, soft)",
               dependencies=[Depends(require_login)])
async def delete_comment(branch_id: int, task_id: int, comment_id: int,
                          request: Request,
                          session: AsyncSession = Depends(db.session)):
    return await comment_controller.delete_comment(
        branch_id, task_id, comment_id, request, session)
