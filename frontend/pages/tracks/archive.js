import Head from 'next/head';
import { axios } from '@/library/_axios';
import ArchiveView from '@/components/Home/shared/ArchiveView';

export default function TrackArchive() {
  return (
    <>
      <Head><title>보관함 · Track</title></Head>
      <ArchiveView
        title="Track 보관함"
        backHref="/tracks"
        fetchItems={async () => {
          const res = await axios.get('/tracks/archived');
          return res.data.status
            ? res.data.tracks.map((t) => ({ id: t.track_id, name: t.track_name, sub: '', color: t.color }))
            : [];
        }}
        onRestore={async (id) => (await axios.post(`/tracks/${id}/restore`)).data.status === true}
        onPermanentDelete={async (id) => (await axios.delete(`/tracks/${id}/permanent`)).data.status === true}
      />
    </>
  );
}
