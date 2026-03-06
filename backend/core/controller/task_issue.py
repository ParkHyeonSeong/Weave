from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from core.model import task_issue as issue_model
from core.model import branch_member as member_model
from core.model import task as task_model


async def _check_member(branch_id: int, request: Request, db: AsyncSession):
    """Branch 멤버 확인"""
    user_id = request.state.payload.get('user_id')
    if not await member_model.is_member(branch_id, user_id, db):
        return None, {'status': False, 'message': 'NOT_BRANCH_MEMBER'}
    return user_id, None


async def _check_task(task_id: int, branch_id: int, db: AsyncSession):
    """Task 존재 및 소속 확인"""
    task = await task_model.find_by_id(task_id, db)
    if not task or task['branch_id'] != branch_id:
        return {'status': False, 'message': 'TASK_NOT_FOUND'}
    return None


# -- 이슈 CRUD --

async def create_issue(body, branch_id: int, task_id: int, request: Request, db: AsyncSession):
    """이슈 생성"""
    user_id, err = await _check_member(branch_id, request, db)
    if err:
        return err

    task_err = await _check_task(task_id, branch_id, db)
    if task_err:
        return task_err

    issue_id = await issue_model.create_issue(task_id, body.title, body.body, user_id, db)
    return {'status': True, 'issue_id': issue_id}


async def list_issues(branch_id: int, task_id: int, request: Request, db: AsyncSession):
    """이슈 목록"""
    _, err = await _check_member(branch_id, request, db)
    if err:
        return err

    task_err = await _check_task(task_id, branch_id, db)
    if task_err:
        return task_err

    issues = await issue_model.find_by_task(task_id, db)
    return {'status': True, 'issues': issues}


async def get_issue(branch_id: int, task_id: int, issue_id: int, request: Request, db: AsyncSession):
    """이슈 상세 + 댓글"""
    _, err = await _check_member(branch_id, request, db)
    if err:
        return err

    task_err = await _check_task(task_id, branch_id, db)
    if task_err:
        return task_err

    issue = await issue_model.find_by_id(issue_id, db)
    if not issue or issue['task_id'] != task_id:
        return {'status': False, 'message': 'ISSUE_NOT_FOUND'}

    comments = await issue_model.find_comments(issue_id, db)
    return {'status': True, 'issue': issue, 'comments': comments}


async def update_issue(body, branch_id: int, task_id: int, issue_id: int, request: Request, db: AsyncSession):
    """이슈 수정 (title/body는 작성자만, status는 모든 멤버)"""
    user_id, err = await _check_member(branch_id, request, db)
    if err:
        return err

    task_err = await _check_task(task_id, branch_id, db)
    if task_err:
        return task_err

    issue = await issue_model.find_by_id(issue_id, db)
    if not issue or issue['task_id'] != task_id:
        return {'status': False, 'message': 'ISSUE_NOT_FOUND'}

    fields = body.model_dump(exclude_unset=True)

    # title/body 변경은 작성자만
    if ('title' in fields or 'body' in fields) and issue['created_by'] != user_id:
        return {'status': False, 'message': 'NOT_ISSUE_AUTHOR'}

    if fields:
        await issue_model.update_issue(issue_id, fields, db)

    return {'status': True}


async def delete_issue(branch_id: int, task_id: int, issue_id: int, request: Request, db: AsyncSession):
    """이슈 삭제 (작성자만)"""
    user_id, err = await _check_member(branch_id, request, db)
    if err:
        return err

    task_err = await _check_task(task_id, branch_id, db)
    if task_err:
        return task_err

    issue = await issue_model.find_by_id(issue_id, db)
    if not issue or issue['task_id'] != task_id:
        return {'status': False, 'message': 'ISSUE_NOT_FOUND'}

    if issue['created_by'] != user_id:
        return {'status': False, 'message': 'NOT_ISSUE_AUTHOR'}

    await issue_model.delete_issue(issue_id, db)
    return {'status': True}


# -- 댓글 CRUD --

async def create_comment(body, branch_id: int, task_id: int, issue_id: int, request: Request, db: AsyncSession):
    """댓글 추가"""
    user_id, err = await _check_member(branch_id, request, db)
    if err:
        return err

    task_err = await _check_task(task_id, branch_id, db)
    if task_err:
        return task_err

    issue = await issue_model.find_by_id(issue_id, db)
    if not issue or issue['task_id'] != task_id:
        return {'status': False, 'message': 'ISSUE_NOT_FOUND'}

    comment_id = await issue_model.create_comment(issue_id, user_id, body.content, db)
    return {'status': True, 'comment_id': comment_id}


async def update_comment(body, branch_id: int, task_id: int, issue_id: int, comment_id: int,
                         request: Request, db: AsyncSession):
    """댓글 수정 (작성자만)"""
    user_id, err = await _check_member(branch_id, request, db)
    if err:
        return err

    task_err = await _check_task(task_id, branch_id, db)
    if task_err:
        return task_err

    comment = await issue_model.find_comment_by_id(comment_id, db)
    if not comment or comment['issue_id'] != issue_id:
        return {'status': False, 'message': 'COMMENT_NOT_FOUND'}

    if comment['author_id'] != user_id:
        return {'status': False, 'message': 'NOT_COMMENT_AUTHOR'}

    await issue_model.update_comment(comment_id, body.content, db)
    return {'status': True}


async def delete_comment(branch_id: int, task_id: int, issue_id: int, comment_id: int,
                         request: Request, db: AsyncSession):
    """댓글 삭제 (작성자만)"""
    user_id, err = await _check_member(branch_id, request, db)
    if err:
        return err

    task_err = await _check_task(task_id, branch_id, db)
    if task_err:
        return task_err

    comment = await issue_model.find_comment_by_id(comment_id, db)
    if not comment or comment['issue_id'] != issue_id:
        return {'status': False, 'message': 'COMMENT_NOT_FOUND'}

    if comment['author_id'] != user_id:
        return {'status': False, 'message': 'NOT_COMMENT_AUTHOR'}

    await issue_model.delete_comment(comment_id, db)
    return {'status': True}
