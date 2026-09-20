import React, { useState, useEffect, useMemo } from 'react';
import { getCompleteHotfixTasks } from './clickupApi';
import { exportCompleteHotfixToExcel, isCompleteHotfixTask, categorizeHotfixTask } from './utils/excelExport';

export default function ExportHotfixModal({
  isOpen,
  onClose,
  currentTasks = [],
  selectedTeam,
  apiToken,
  startDate,
  endDate,
  addToast
}) {
  const [exportScope, setExportScope] = useState('all'); // default to 'all' as requested
  const [allWorkspaceTasks, setAllWorkspaceTasks] = useState(null);
  const [loadingAll, setLoadingAll] = useState(false);
  const [downloading, setDownloading] = useState(false);

  // Filter tasks with COMPLETE HOTFIX from current loaded tasks
  const currentHotfixTasks = useMemo(() => {
    return (currentTasks || []).filter(isCompleteHotfixTask);
  }, [currentTasks]);

  // Load all COMPLETE HOTFIX tasks from workspace as soon as modal opens
  useEffect(() => {
    if (isOpen && !allWorkspaceTasks && !loadingAll && selectedTeam?.id && apiToken) {
      setLoadingAll(true);
      getCompleteHotfixTasks(selectedTeam.id, apiToken)
        .then(tasks => {
          setAllWorkspaceTasks(tasks || []);
        })
        .catch(err => {
          console.error('Failed to fetch all hotfix tasks for export:', err);
          if (addToast) addToast(`Gagal memuat seluruh data: ${err.message}`, 'error');
        })
        .finally(() => {
          setLoadingAll(false);
        });
    }
  }, [isOpen, allWorkspaceTasks, loadingAll, selectedTeam, apiToken, addToast]);

  if (!isOpen) return null;

  const targetTasks = exportScope === 'all' ? (allWorkspaceTasks || []) : currentHotfixTasks;

  // Breakdown statistics
  const stats = targetTasks.reduce((acc, t) => {
    const cat = categorizeHotfixTask(t.name);
    acc[cat] = (acc[cat] || 0) + 1;
    return acc;
  }, { 'Hotfix': 0, 'OOS': 0, 'Need Check': 0, 'No Category': 0 });

  const handleExport = async () => {
    try {
      setDownloading(true);
      if (targetTasks.length === 0) {
        if (addToast) addToast('Tidak ada task COMPLETE HOTFIX untuk diekspor.', 'warning');
        return;
      }

      const scopeLabel = exportScope === 'all' ? 'Semua_Waktu' : `${startDate}_sd_${endDate}`;
      const result = await exportCompleteHotfixToExcel(targetTasks, {
        customFilename: `Export_COMPLETE_HOTFIX_${scopeLabel}`,
        apiToken
      });

      if (addToast) {
        addToast(`✅ Berhasil mengekspor ${result.count} card COMPLETE HOTFIX ke Excel!`, 'success');
      }
      onClose();
    } catch (err) {
      console.error('Export error:', err);
      if (addToast) addToast(`❌ Gagal mengekspor: ${err.message}`, 'error');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0, 0, 0, 0.78)',
      backdropFilter: 'blur(5px)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 99999,
      animation: 'fadeIn 0.2s ease'
    }}>
      <div style={{
        background: 'var(--color-bg-card, #1c2130)',
        border: '1px solid var(--color-border, #2e384d)',
        borderRadius: '16px',
        padding: '26px',
        maxWidth: '560px',
        width: '92%',
        boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.65)',
        color: 'var(--color-text-primary, #f1f5f9)'
      }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ fontSize: 24 }}>📑</span>
            <div>
              <div style={{ fontWeight: 700, fontSize: '1.15rem' }}>
                Export Excel Card "COMPLETE HOTFIX"
              </div>
              <div style={{ fontSize: '0.8rem', color: 'var(--color-text-muted, #94a3b8)' }}>
                Workspace: {selectedTeam?.name || 'MOSTRANS-IT'}
              </div>
            </div>
          </div>
          <button
            onClick={onClose}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--color-text-muted, #94a3b8)',
              cursor: 'pointer',
              fontSize: 20,
              padding: '4px 8px',
              borderRadius: '6px'
            }}
          >
            ✕
          </button>
        </div>

        {/* Scope Selector */}
        <div style={{ marginBottom: 18 }}>
          <label style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-text-secondary, #cbd5e1)', display: 'block', marginBottom: 8 }}>
            Pilih Cakupan Data:
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <div
              onClick={() => setExportScope('current')}
              style={{
                border: exportScope === 'current' ? '2px solid var(--color-purple-light, #8b5cf6)' : '1px solid var(--color-border, #334155)',
                background: exportScope === 'current' ? 'rgba(139, 92, 246, 0.15)' : 'var(--color-bg-input, #131722)',
                borderRadius: '10px',
                padding: '12px 14px',
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
            >
              <div style={{ fontWeight: 600, fontSize: '0.88rem', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>📅 Filter Aktif</span>
                {exportScope === 'current' && <span style={{ color: '#8b5cf6' }}>●</span>}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted, #94a3b8)', marginTop: 4 }}>
                {startDate} s/d {endDate}
              </div>
              <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#10b981', marginTop: 6 }}>
                {currentHotfixTasks.length} Card
              </div>
            </div>

            <div
              onClick={() => setExportScope('all')}
              style={{
                border: exportScope === 'all' ? '2px solid var(--color-purple-light, #8b5cf6)' : '1px solid var(--color-border, #334155)',
                background: exportScope === 'all' ? 'rgba(139, 92, 246, 0.15)' : 'var(--color-bg-input, #131722)',
                borderRadius: '10px',
                padding: '12px 14px',
                cursor: 'pointer',
                transition: 'all 0.15s ease'
              }}
            >
              <div style={{ fontWeight: 600, fontSize: '0.88rem', display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>🌐 Seluruh Waktu</span>
                {exportScope === 'all' && <span style={{ color: '#8b5cf6' }}>●</span>}
              </div>
              <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted, #94a3b8)', marginTop: 4 }}>
                Semua histori di workspace
              </div>
              <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#38bdf8', marginTop: 6 }}>
                {loadingAll ? 'Memuat...' : `${allWorkspaceTasks ? allWorkspaceTasks.length : '86'} Card`}
              </div>
            </div>
          </div>
        </div>

        {/* Breakdown Card */}
        <div style={{
          background: 'var(--color-bg-input, #131722)',
          borderRadius: '10px',
          padding: '14px 16px',
          marginBottom: 18,
          border: '1px solid var(--color-border, #334155)'
        }}>
          <div style={{ fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-text-muted, #94a3b8)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: 0.5 }}>
            Klasifikasi Kategori (Kolom 1 Excel)
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, textAlign: 'center' }}>
            <div style={{ background: 'rgba(239, 68, 68, 0.12)', padding: '8px 4px', borderRadius: '8px', border: '1px solid rgba(239, 68, 68, 0.25)' }}>
              <div style={{ fontSize: '0.7rem', color: '#f87171', fontWeight: 600 }}>HOTFIX</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#f87171', marginTop: 2 }}>{stats['Hotfix']}</div>
            </div>
            <div style={{ background: 'rgba(245, 158, 11, 0.12)', padding: '8px 4px', borderRadius: '8px', border: '1px solid rgba(245, 158, 11, 0.25)' }}>
              <div style={{ fontSize: '0.7rem', color: '#fbbf24', fontWeight: 600 }}>OOS</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#fbbf24', marginTop: 2 }}>{stats['OOS']}</div>
            </div>
            <div style={{ background: 'rgba(59, 130, 246, 0.12)', padding: '8px 4px', borderRadius: '8px', border: '1px solid rgba(59, 130, 246, 0.25)' }}>
              <div style={{ fontSize: '0.7rem', color: '#60a5fa', fontWeight: 600 }}>NEED CHECK</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#60a5fa', marginTop: 2 }}>{stats['Need Check']}</div>
            </div>
            <div style={{ background: 'rgba(148, 163, 184, 0.12)', padding: '8px 4px', borderRadius: '8px', border: '1px solid rgba(148, 163, 184, 0.25)' }}>
              <div style={{ fontSize: '0.7rem', color: '#94a3b8', fontWeight: 600 }}>NO CATEGORY</div>
              <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#cbd5e1', marginTop: 2 }}>{stats['No Category']}</div>
            </div>
          </div>
        </div>

        {/* Columns Preview Info */}
        <div style={{
          fontSize: '0.78rem',
          color: 'var(--color-text-muted, #94a3b8)',
          marginBottom: 22,
          lineHeight: 1.5,
          background: 'rgba(59, 130, 246, 0.06)',
          padding: '10px 14px',
          borderRadius: '8px',
          border: '1px solid rgba(59, 130, 246, 0.2)'
        }}>
          <strong style={{ color: 'var(--color-text-primary, #f1f5f9)' }}>📋 Format Kolom File Excel:</strong>
          <div style={{ marginTop: 4 }}>
            1. <strong>Kategori</strong> &bull; 2. <strong>Nama Task</strong> &bull; 3. <strong>Status</strong> (COMPLETE HOTFIX) &bull; 4. <strong>Tanggal Dibuat</strong> &bull; 5. <strong>Tanggal Selesai</strong> &bull; 6. <strong>Assignee</strong> &bull; 7. <strong>List</strong> &bull; 8. <strong>Link ClickUp</strong>
          </div>
        </div>

        {/* Action Buttons */}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onClose}
            disabled={downloading}
            style={{ padding: '8px 16px' }}
          >
            Batal
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleExport}
            disabled={downloading || loadingAll || targetTasks.length === 0}
            style={{
              padding: '8px 20px',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              background: 'linear-gradient(135deg, #10b981, #059669)',
              borderColor: '#059669',
              fontWeight: 600
            }}
          >
            {downloading ? '⏳ Mengekspor...' : loadingAll ? '⏳ Memuat Data...' : `📥 Download Excel (${targetTasks.length} Card)`}
          </button>
        </div>
      </div>
    </div>
  );
}
