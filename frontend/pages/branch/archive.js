import Head from 'next/head';
import { axios } from '@/library/_axios';
import ArchiveView from '@/components/Home/shared/ArchiveView';

export default function BranchArchive() {
  return (
    <>
      <Head><title>보관함 · Branch</title></Head>
      <ArchiveView
        title="Branch 보관함"
        backHref="/branch"
        fetchItems={async () => {
          const res = await axios.get('/branches/archived');
          return res.data.status
            ? res.data.branches.map((b) => ({ id: b.branch_id, name: b.branch_name, sub: b.key, color: b.color }))
            : [];
        }}
        onRestore={async (id) => (await axios.post(`/branches/${id}/restore`)).data.status === true}
        onPermanentDelete={async (id) => (await axios.delete(`/branches/${id}/permanent`)).data.status === true}
      />
    </>
  );
}
