from fastapi import APIRouter, Request, Depends, Body
from sqlalchemy.ext.asyncio import AsyncSession

from .schema import task_issue as schema
from core.controller import task_issue as controller
from library.validator import require_login
import db_engine as db

router = APIRouter()


# -- 이슈 --

@router.post("", summary="이슈 생성", dependencies=[Depends(require_login)])
async def create_issue(branch_id: int, task_id: int, body: schema.IssueCreate,
                       request: Request, session: AsyncSession = Depends(db.session)):
    return await controller.create_issue(body, branch_id, task_id, request, session)


@router.get("", summary="이슈 목록", dependencies=[Depends(require_login)])
async def list_issues(branch_id: int, task_id: int,
                      request: Request, session: AsyncSession = Depends(db.session)):
    return await controller.list_issues(branch_id, task_id, request, session)


@router.get("/{issue_id}", summary="이슈 상세", dependencies=[Depends(require_login)])
async def get_issue(branch_id: int, task_id: int, issue_id: int,
                    request: Request, session: AsyncSession = Depends(db.session)):
    return await controller.get_issue(branch_id, task_id, issue_id, request, session)


@router.patch("/{issue_id}", summary="이슈 수정", dependencies=[Depends(require_login)])
async def update_issue(branch_id: int, task_id: int, issue_id: int, body: schema.IssueUpdate,
                       request: Request, session: AsyncSession = Depends(db.session)):
    return await controller.update_issue(body, branch_id, task_id, issue_id, request, session)


@router.delete("/{issue_id}", summary="이슈 삭제", dependencies=[Depends(require_login)])
async def delete_issue(branch_id: int, task_id: int, issue_id: int,
                       request: Request, session: AsyncSession = Depends(db.session)):
    return await controller.delete_issue(branch_id, task_id, issue_id, request, session)


@router.post("/{issue_id}/close", summary="이슈 닫기(+선택 댓글)", dependencies=[Depends(require_login)])
async def close_issue(branch_id: int, task_id: int, issue_id: int,
                      request: Request, session: AsyncSession = Depends(db.session),
                      body: schema.IssueTransition = Body(default_factory=schema.IssueTransition)):
    # body는 선택 — 댓글 없이 닫을 땐 빈 body/no-body 모두 허용 (GitHub식)
    return await controller.close_issue(body, branch_id, task_id, issue_id, request, session)


@router.post("/{issue_id}/reopen", summary="이슈 다시 열기(+선택 댓글)", dependencies=[Depends(require_login)])
async def reopen_issue(branch_id: int, task_id: int, issue_id: int,
                       request: Request, session: AsyncSession = Depends(db.session),
                       body: schema.IssueTransition = Body(default_factory=schema.IssueTransition)):
    # body는 선택 — 댓글 없이 다시 열 땐 빈 body/no-body 모두 허용
    return await controller.reopen_issue(body, branch_id, task_id, issue_id, request, session)


# -- 댓글 --

@router.post("/{issue_id}/comments", summary="댓글 추가", dependencies=[Depends(require_login)])
async def create_comment(branch_id: int, task_id: int, issue_id: int, body: schema.CommentCreate,
                         request: Request, session: AsyncSession = Depends(db.session)):
    return await controller.create_comment(body, branch_id, task_id, issue_id, request, session)


@router.patch("/{issue_id}/comments/{comment_id}", summary="댓글 수정", dependencies=[Depends(require_login)])
async def update_comment(branch_id: int, task_id: int, issue_id: int, comment_id: int,
                         body: schema.CommentUpdate,
                         request: Request, session: AsyncSession = Depends(db.session)):
    return await controller.update_comment(body, branch_id, task_id, issue_id, comment_id, request, session)


@router.delete("/{issue_id}/comments/{comment_id}", summary="댓글 삭제", dependencies=[Depends(require_login)])
async def delete_comment(branch_id: int, task_id: int, issue_id: int, comment_id: int,
                         request: Request, session: AsyncSession = Depends(db.session)):
    return await controller.delete_comment(branch_id, task_id, issue_id, comment_id, request, session)
