from fastapi import Request
from sqlalchemy.ext.asyncio import AsyncSession

from core.model import task_issue as issue_model
from core.model import branch_member as member_model
from core.model import task as task_model
from library import notification_service
from library.mention_parser import extract_mention_user_ids


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

    # 태스크 담당자에게 이슈 생성 알림
    task = await task_model.find_by_id(task_id, db)
    if task:
        assignee_ids = [a['user_id'] for a in (task.get('assignees') or [])]
        if assignee_ids:
            display_id = task.get('display_id', '')
            username = request.state.payload.get('username', '')
            link = f'/branch/{branch_id}/task/{task_id}/issue/{issue_id}'
            await notification_service.notify_bulk(
                assignee_ids, 'issue_created', user_id,
                f'{username}님이 {display_id}에 이슈 "{body.title}"를 생성했습니다',
                link, 'issue', issue_id, db,
            )

    # 이슈 body 멘션 알림
    mentioned = extract_mention_user_ids(body.body)
    if mentioned:
        username = request.state.payload.get('username', '')
        link = f'/branch/{branch_id}/task/{task_id}/issue/{issue_id}'
        await notification_service.notify_bulk(
            mentioned, 'mention', user_id,
            f'{username}님이 이슈 "{body.title}"에서 회원님을 멘션했습니다',
            link, 'issue', issue_id, db,
        )

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

    # body 멘션 알림 (새로 추가된 멘션만)
    if 'body' in fields and fields['body']:
        old_mentions = set(extract_mention_user_ids(issue.get('body') or ''))
        new_mentions = set(extract_mention_user_ids(fields['body']))
        added_mentions = new_mentions - old_mentions
        if added_mentions:
            username = request.state.payload.get('username', '')
            link = f'/branch/{branch_id}/task/{task_id}/issue/{issue_id}'
            await notification_service.notify_bulk(
                list(added_mentions), 'mention', user_id,
                f'{username}님이 이슈 "{issue.get("title", "")}"에서 회원님을 멘션했습니다',
                link, 'issue', issue_id, db,
            )

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

    # 이슈 작성자 + 기존 코멘터에게 알림 (중복 제거, 본인 제외)
    recipients = set()
    recipients.add(issue['created_by'])
    commenter_ids = await issue_model.find_commenter_ids(issue_id, db)
    recipients.update(commenter_ids)
    recipients.discard(user_id)

    if recipients:
        username = request.state.payload.get('username', '')
        issue_title = issue.get('title', '')
        link = f'/branch/{branch_id}/task/{task_id}/issue/{issue_id}'
        await notification_service.notify_bulk(
            list(recipients), 'issue_comment', user_id,
            f'{username}님이 "{issue_title}"에 댓글을 남겼습니다',
            link, 'issue', issue_id, db,
        )

    # 댓글 content 멘션 알림 (issue_comment 알림과 별도로)
    mentioned = extract_mention_user_ids(body.content)
    if mentioned:
        username = request.state.payload.get('username', '')
        issue_title = issue.get('title', '')
        link = f'/branch/{branch_id}/task/{task_id}/issue/{issue_id}'
        await notification_service.notify_bulk(
            mentioned, 'mention', user_id,
            f'{username}님이 "{issue_title}" 댓글에서 회원님을 멘션했습니다',
            link, 'issue', issue_id, db,
        )

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
