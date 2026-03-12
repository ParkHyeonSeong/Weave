import { useState, useEffect, useCallback } from 'react';
import { axios } from '@/library/_axios';

export default function useStar(itemType, itemId) {
  const [starred, setStarred] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!itemType || !itemId) { setLoading(false); return; }
    let cancelled = false;
    axios.get('/stars/check', { params: { item_type: itemType, item_id: itemId } })
      .then((res) => { if (!cancelled && res.data.status) setStarred(res.data.starred); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [itemType, itemId]);

  const toggle = useCallback(async () => {
    if (!itemType || !itemId) return;
    setStarred((prev) => !prev);
    try {
      const res = await axios.post('/stars', { item_type: itemType, item_id: itemId });
      if (res.data.status) setStarred(res.data.starred);
    } catch {
      setStarred((prev) => !prev);
    }
  }, [itemType, itemId]);

  return { starred, loading, toggle };
}
