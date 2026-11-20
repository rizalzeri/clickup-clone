import { useState, useMemo } from 'react';
import {
  getParentTasksUpdatedSince,
  getTaskTimeInStatus,
  getDefaultDateRange,
  dateToTimestamp,
  dateToEndTimestamp,
} from './clickupApi';

const isOnreleaseStatus = (s) => {
  const n = (s || '').toLowerCase().replace(/[\s\-_]+/g, '');
  return n.includes('onrelease');
};

const fmtDateTime = (ts) =>
  ts
    ? new Date(ts).toLocaleString('id-ID', {
        day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
      })
    : '-';

// Waktu card MASUK ke status onrelease, dibaca dari riwayat status (time_in_status)
const getOnreleaseTime = (history) => {
  if (!history) return null;
  let found = null;
  const check = (st) => {
    if (!st || !isOnreleaseStatus(st.status)) return;
    const since = st.total_time?.since ? parseInt(st.total_time.since, 10) : null;
    if (since && (!found || since > found)) found = since;
  };
  (history.status_history || []).forEach(check);
  check(history.current_status);
  return found;
};

export default function ReleaseTracker({ apiToken, selectedTeam, addToast }) {
  const def = getDefaultDateRange();
  const [startDate, setStartDate] = useState(def.startDate);
  const [endDate, setEndDate] = useState(def.endDate);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState('');
  const [rows, setRows] = useState(null);
  const [diag, setDiag] = useState(null);
  const [search, setSearch] = useState('');

  const handleSearch = async () => {
    if (!selectedTeam || !apiToken) {
      addToast?.('Workspace / token belum siap', 'warning');
      return;
    }
    setLoading(true);
    setRows(null);
    setDiag(null);
    try {
      const startTs = dateToTimestamp(startDate);
      const endTs = dateToEndTimestamp(endDate);

      // Card yang pernah pindah ke onrelease di range pasti ter-update >= start
      // (walau sekarang sudah pindah ke status lain), jadi ambil semua yang updated >= start.
      const tasks = await getParentTasksUpdatedSince(selectedTeam.id, startTs, apiToken);
      const brds = tasks.filter(t => !t.parent && (t.name || '').toLowerCase().includes('brd'));

      // Baca history aktivitas status tiap card
      const histories = {};
      let failed = 0;
      const chunkSize = 8;
      for (let i = 0; i < brds.length; i += chunkSize) {
        setProgress(`${Math.min(i + chunkSize, brds.length)}/${brds.length}`);
        await Promise.all(
          brds.slice(i, i + chunkSize).map(async (t) => {
            const h = await getTaskTimeInStatus(t.id, apiToken);
            if (h) histories[t.id] = h; else failed++;
          })
        );
      }
      setProgress('');

      const result = [];
      let neverOnrelease = 0;
      for (const t of brds) {
        const movedAt = getOnreleaseTime(histories[t.id]);
        if (!movedAt) { neverOnrelease++; continue; }
        if (movedAt < startTs || movedAt > endTs) continue;
        result.push({
          id: t.id,
          name: t.name,
          url: t.url,
          status: t.status?.status || '-',
          statusColor: t.status?.color || '#94a3b8',
          listName: t.list?.name || '-',
          assignees: (t.assignees || []).map(a => a.username || a.email).filter(Boolean),
          movedAt,
        });
      }
      result.sort((a, b) => b.movedAt - a.movedAt);
      setDiag({ candidates: brds.length, withHistory: brds.length - failed, failed, neverOnrelease });
      setRows(result);
      addToast?.(`${result.length} card BRD ditemukan`, 'success');
    } catch (err) {
      addToast?.(`Gagal memuat data: ${err.message}`, 'error');
    } finally {
      setLoading(false);
      setProgress('');
    }
  };

  const shown = useMemo(() => {
    if (!rows) return [];
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter(r =>
      r.name.toLowerCase().includes(q) || r.assignees.some(a => a.toLowerCase().includes(q))
    );
  }, [rows, search]);

  return (
    <div style={{ animation: 'fadeInUp 0.4s ease' }}>
      <div className="filter-section">
        <div className="filter-title">🚀 BRD Dipindah ke Onrelease (berdasarkan history status)</div>
        <div className="filter-grid">
          <div className="form-group">
            <label className="form-label">Tanggal Mulai</label>
            <input type="date" className="form-control" value={startDate}
              max={endDate} onChange={e => setStartDate(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Tanggal Akhir</label>
            <input type="date" className="form-control" value={endDate}
              min={startDate} onChange={e => setEndDate(e.target.value)} />
          </div>
          <div className="form-group">
            <label className="form-label">Cari (nama / assignee)</label>
            <input type="text" className="form-control" value={search}
              placeholder="Cari..." onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="form-group filter-actions">
            <button className="btn btn-primary" style={{ width: '100%' }}
              onClick={handleSearch} disabled={loading || !apiToken}>
              {loading ? `⏳ Membaca history ${progress}` : '🔍 Tampilkan'}
            </button>
          </div>
        </div>
        {diag && (
          <div style={{ fontSize: 12, color: 'var(--color-text-muted)', marginTop: 8 }}>
            Diperiksa {diag.candidates} card BRD · history terbaca {diag.withHistory}
            {diag.failed > 0 && <> · <b style={{ color: '#f59e0b' }}>{diag.failed} gagal dibaca</b> (rate limit / plan ClickUp tanpa time-in-status)</>}
            {' '}· tidak pernah onrelease {diag.neverOnrelease}
          </div>
        )}
      </div>

      <div className="task-list-card" style={{ marginTop: 'var(--space-md)' }}>
        <div className="section-header">
          <span className="section-title" style={{ fontSize: 15 }}>📋 Daftar Card BRD</span>
          <span className="section-badge">{shown.length}</span>
        </div>
        <div className="task-list-body">
          {rows === null ? (
            <div className="empty-state" style={{ padding: 'var(--space-xl)' }}>
              <div className="empty-icon">👆</div>
              <div className="empty-title">Pilih rentang tanggal lalu klik Tampilkan</div>
            </div>
          ) : shown.length === 0 ? (
            <div className="empty-state" style={{ padding: 'var(--space-xl)' }}>
              <div className="empty-icon">📭</div>
              <div className="empty-title">Tidak ada card BRD yang dipindah ke onrelease pada rentang ini</div>
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ textAlign: 'left', color: 'var(--color-text-muted)' }}>
                    <th style={{ padding: 10 }}>#</th>
                    <th style={{ padding: 10 }}>Card BRD</th>
                    <th style={{ padding: 10 }}>List</th>
                    <th style={{ padding: 10 }}>Assignee</th>
                    <th style={{ padding: 10 }}>Status Sekarang</th>
                    <th style={{ padding: 10 }}>Dipindah ke Onrelease</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r, i) => (
                    <tr key={r.id} style={{ borderTop: '1px solid var(--color-border-light)' }}>
                      <td style={{ padding: 10 }}>{i + 1}</td>
                      <td style={{ padding: 10 }}>
                        <a href={r.url} target="_blank" rel="noreferrer"
                          style={{ color: 'var(--color-purple-light)', textDecoration: 'none', fontWeight: 600 }}>
                          {r.name}
                        </a>
                      </td>
                      <td style={{ padding: 10 }}>{r.listName}</td>
                      <td style={{ padding: 10 }}>{r.assignees.join(', ') || '-'}</td>
                      <td style={{ padding: 10 }}>
                        <span style={{ color: r.statusColor, fontWeight: 600 }}>{r.status}</span>
                      </td>
                      <td style={{ padding: 10 }}>{fmtDateTime(r.movedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
