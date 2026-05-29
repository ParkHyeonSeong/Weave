import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { Workflow, Plus, Users, Layers } from 'lucide-react';
import { axios } from '@/library/_axios';
import { formatRelative } from '@/library/formatTime';
import CreateTrack from '@/components/modal/CreateTrack';

export default function TracksIndex() {
  const router = useRouter();
  const [tracks, setTracks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);

  const fetchTracks = useCallback(async () => {
    try {
      const res = await axios.get('/tracks');
      if (res.data.status) setTracks(res.data.tracks);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchTracks();
  }, [fetchTracks]);

  const handleCreated = useCallback((trackId) => {
    setShowCreate(false);
    if (trackId) router.push(`/tracks/${trackId}`);
  }, [router]);

  return (
    <>
      <Head><title>Tracks · Weave</title></Head>
      <div className="TracksIndex">
        <header className="TracksIndex__Header">
          <div className="TracksIndex__HeaderLeft">
            <Workflow size={20} className="TracksIndex__HeaderIcon" />
            <h1 className="TracksIndex__Title">Tracks</h1>
            {!loading && <span className="TracksIndex__Count">{tracks.length}</span>}
          </div>
          <button
            className="TracksIndex__CreateBtn"
            onClick={() => setShowCreate(true)}
          >
            <Plus size={14} />
            <span>New Track</span>
          </button>
        </header>

        <p className="TracksIndex__Intro">
          여러 Branch를 가로지르는 작업의 흐름을 한 그림으로 설계하고 조망해요.
        </p>

        {loading ? (
          <div className="TracksIndex__Loading">Loading…</div>
        ) : tracks.length === 0 ? (
          <div className="TracksIndex__Empty">
            <div className="TracksIndex__EmptyIcon">
              <Workflow size={32} />
            </div>
            <div className="TracksIndex__EmptyTitle">No tracks yet</div>
            <div className="TracksIndex__EmptyHint">
              첫 Track을 만들고 여러 branch의 task를 모아 흐름을 그려보세요.
            </div>
            <button
              className="TracksIndex__EmptyBtn"
              onClick={() => setShowCreate(true)}
            >
              <Plus size={14} />
              <span>Create your first track</span>
            </button>
          </div>
        ) : (
          <ul className="TracksIndex__List">
            {tracks.map((t) => (
              <li key={t.track_id}>
                <button
                  className="TracksIndex__Card"
                  onClick={() => router.push(`/tracks/${t.track_id}`)}
                  style={{ '--track-color': t.color }}
                >
                  <span className="TracksIndex__CardAccent" />
                  <div className="TracksIndex__CardMain">
                    <div className="TracksIndex__CardTitleRow">
                      <span className="TracksIndex__CardTitle">{t.track_name}</span>
                      {t.visibility === 'public' && (
                        <span className="TracksIndex__CardVisibility">public</span>
                      )}
                    </div>
                    {t.description && (
                      <div className="TracksIndex__CardDesc">{t.description}</div>
                    )}
                  </div>
                  <div className="TracksIndex__CardStats">
                    <span className="TracksIndex__CardStat" title="Items">
                      <Layers size={11} />
                      {t.item_count || 0}
                    </span>
                    <span className="TracksIndex__CardStat" title="Branches">
                      <Workflow size={11} />
                      {t.branch_count || 0}
                    </span>
                    <span className="TracksIndex__CardStat" title="Members">
                      <Users size={11} />
                      {t.member_count || 0}
                    </span>
                    <span className="TracksIndex__CardDate">
                      {formatRelative(t.updated_at || t.created_at)}
                    </span>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        )}

        {showCreate && (
          <CreateTrack
            onClose={() => setShowCreate(false)}
            onCreated={handleCreated}
          />
        )}
      </div>
    </>
  );
}
