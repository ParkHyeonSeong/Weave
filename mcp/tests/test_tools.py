import json
from unittest.mock import AsyncMock

import pytest
from fastmcp import Client

from weave_mcp import server


@pytest.fixture
def fake_client(monkeypatch):
    fake = AsyncMock()
    monkeypatch.setattr(server, "_client", fake)  # get_client() returns this
    return fake


async def test_list_branches(fake_client):
    fake_client.call_json.return_value = [{"id": 1, "name": "Core"}]
    async with Client(server.mcp) as client:
        result = await client.call_tool("list_branches", {})
    # fastmcp v3 only populates result.data for dict returns (structured_content).
    # For list returns the value is serialised as JSON text in result.content[0].text.
    assert json.loads(result.content[0].text) == [{"id": 1, "name": "Core"}]
    fake_client.call_json.assert_awaited_once_with("GET", "/api/branches")


async def test_list_my_tasks_filters(fake_client):
    fake_client.call_json.return_value = []
    async with Client(server.mcp) as client:
        await client.call_tool("list_my_tasks", {"status": "todo", "branch_id": 2})
    fake_client.call_json.assert_awaited_once_with(
        "GET", "/api/my-tasks", params={"status": "todo", "branch_id": 2}
    )


async def test_get_task(fake_client):
    fake_client.call_json.return_value = {"id": 5, "title": "X"}
    async with Client(server.mcp) as client:
        result = await client.call_tool("get_task", {"branch_id": 3, "task_id": 5})
    assert result.data == {"id": 5, "title": "X"}
    fake_client.call_json.assert_awaited_once_with("GET", "/api/branches/3/tasks/5")


async def test_create_task_sends_body(fake_client):
    fake_client.call_json.return_value = {"id": 10, "title": "New"}
    async with Client(server.mcp) as client:
        await client.call_tool(
            "create_task", {"branch_id": 3, "title": "New", "priority": "high"}
        )
    fake_client.call_json.assert_awaited_once_with(
        "POST", "/api/branches/3/tasks", json={"title": "New", "priority": "high"}
    )


async def test_add_task_comment(fake_client):
    fake_client.call_json.return_value = {"id": 99, "content": "hi"}
    async with Client(server.mcp) as client:
        await client.call_tool(
            "add_task_comment", {"branch_id": 3, "task_id": 5, "content": "hi"}
        )
    fake_client.call_json.assert_awaited_once_with(
        "POST", "/api/branches/3/tasks/5/comments", json={"content": "hi"}
    )
