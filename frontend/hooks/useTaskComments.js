import { useState, useEffect, useCallback } from 'react';
import { axios } from '@/library/_axios';

/**
 * Task 댓글 데이터 hook.
 * - 마운트 시 자동 fetch (unmount race guard 포함)
 * - create/update/delete 후 단순 refetch (optimistic 아님)
 */
export default function useTaskComments(branchId, taskId) {
  const [comments, setComments] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const base = branchId && taskId
    ? `/branches/${branchId}/tasks/${taskId}/comments`
    : null;

  // mount-time auto-fetch with unmount cancel guard
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!base) return;
      setLoading(true);
      try {
        const res = await axios.get(base);
        if (cancelled) return;
        if (res.data?.status) {
          setComments(res.data.comments || []);
          setError(null);
        } else {
          setError(res.data?.message || 'FETCH_FAILED');
        }
      } catch (e) {
        if (cancelled) return;
        setError(e?.message || 'FETCH_ERROR');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [base]);

  // explicit refetch — callers can call this after external changes
  const fetchComments = useCallback(async () => {
    if (!base) return;
    setLoading(true);
    try {
      const res = await axios.get(base);
      if (res.data?.status) {
        setComments(res.data.comments || []);
        setError(null);
      } else {
        setError(res.data?.message || 'FETCH_FAILED');
      }
    } catch (e) {
      setError(e?.message || 'FETCH_ERROR');
    } finally {
      setLoading(false);
    }
  }, [base]);

  // private helper: run a mutator fn, validate response, then refetch
  const _mutate = useCallback(async (fn, fallback) => {
    if (!base) throw new Error('NO_TASK');
    const res = await fn();
    if (!res.data?.status) throw new Error(res.data?.message || fallback);
    await fetchComments();
    return res.data;
  }, [base, fetchComments]);

  const createComment = useCallback(
    (content, parentCommentId = null) =>
      _mutate(
        () => axios.post(base, { content, parent_comment_id: parentCommentId }),
        'CREATE_FAILED',
      ).then((d) => d.comment),
    [_mutate, base],
  );

  const updateComment = useCallback(
    (commentId, content) =>
      _mutate(
        () => axios.patch(`${base}/${commentId}`, { content }),
        'UPDATE_FAILED',
      ).then((d) => d.comment),
    [_mutate, base],
  );

  const deleteComment = useCallback(
    (commentId) =>
      _mutate(
        () => axios.delete(`${base}/${commentId}`),
        'DELETE_FAILED',
      ).then(() => true),
    [_mutate, base],
  );

  return {
    comments,
    loading,
    error,
    refetch: fetchComments,
    createComment,
    updateComment,
    deleteComment,
  };
}
