(function () {
  'use strict';

  document.addEventListener('DOMContentLoaded', async () => {
    // 1. Navigation tabs & View containers
    const navTabs = document.querySelectorAll('.nav-tab');
    const viewContainers = document.querySelectorAll('.view-container');

    let currentView = 'view-tasks';

    // 2. Initialize Core Viewers (Tasks, Hideout, Collection, Scanner, GDrive)
    const taskViewer = new window.TaskViewer();
    const hideoutViewer = new window.HideoutViewer();
    const collectionViewer = new window.CollectionViewer();
    const commandPalette = new window.CommandPalette();
    const scannerController = new window.ScannerController();
    const gdriveSync = window.GDriveSync ? new window.GDriveSync() : null;

    function exportBackupData() {
      return {
        version: '2.0',
        exportedAt: new Date().toISOString(),
        tasks: JSON.parse(localStorage.getItem('tarkov_offline_task_progress_v2') || '{}'),
        hideout: JSON.parse(localStorage.getItem('tarkov_offline_hideout_progress') || '{}'),
        stash: JSON.parse(localStorage.getItem('tarkov_offline_collection_stash') || '{}')
      };
    }

    /**
     * Normalize either native v2.0 backup or standard `tarkov_progress_v1` JSON.
     */
    function normalizeBackupData(rawData) {
      if (!rawData || typeof rawData !== 'object') {
        throw new Error('备份内容不是有效的 JSON 对象');
      }

      // Detect tarkov_progress_v1 structure
      const looksLikeWebExport = !rawData.version && (rawData.mode || rawData.items) && !rawData.stash;
      if (looksLikeWebExport) {
        const completed = {};
        const objectives = {};
        if (rawData.tasks && typeof rawData.tasks === 'object') {
          Object.entries(rawData.tasks).forEach(([tid, tVal]) => {
            if (tVal && tVal.status === 'completed') completed[tid] = true;
            if (tVal && tVal.objectives) objectives[tid] = tVal.objectives;
          });
        }
        const stations = {};
        if (rawData.hideout && typeof rawData.hideout === 'object') {
          Object.entries(rawData.hideout).forEach(([hid, hVal]) => {
            if (hVal && typeof hVal.level === 'number') stations[hid] = hVal.level;
          });
        }
        const stash = {};
        if (rawData.items && typeof rawData.items === 'object') {
          Object.entries(rawData.items).forEach(([iid, iVal]) => {
            if (iVal && typeof iVal.qty === 'number' && iVal.qty > 0) stash[iid] = iVal.qty;
          });
        }
        return {
          tasks: { completed, objectives, mode: rawData.mode || 'pvp', faction: 'all' },
          hideout: { stations, items: stash },
          stash
        };
      }

      return {
        tasks: rawData.tasks,
        hideout: rawData.hideout,
        stash: rawData.stash
      };
    }

    function applyBackupData(rawData, options = {}) {
      const normalized = normalizeBackupData(rawData);
      if (normalized.tasks) {
        localStorage.setItem('tarkov_offline_task_progress_v2', JSON.stringify(normalized.tasks));
      }
      if (normalized.hideout) {
        localStorage.setItem('tarkov_offline_hideout_progress', JSON.stringify(normalized.hideout));
      }
      if (normalized.stash) {
        localStorage.setItem('tarkov_offline_collection_stash', JSON.stringify(normalized.stash));
      }

      taskViewer.loadProgress();
      taskViewer.render();
      hideoutViewer.loadProgress();
      hideoutViewer.render();
      collectionViewer.loadStash();
      collectionViewer.refresh();

      window.dispatchEvent(new CustomEvent('tarkov:progress-changed', {
        detail: { module: 'backup', source: options.source || 'manual-import' }
      }));
    }

    // Export global app context for cross-navigation & cloud sync
    window.app = {
      switchTab: switchView,
      taskViewer,
      hideoutViewer,
      collectionViewer,
      commandPalette,
      scannerController,
      gdriveSync,
      exportBackupData,
      applyBackupData
    };

    // Async init core modules in parallel
    await Promise.all([
      taskViewer.init(),
      hideoutViewer.init(),
      collectionViewer.init()
    ]);

    // Initialize custom tactical dropdowns
    if (window.initAllCustomSelects) {
      window.initAllCustomSelects();
    }

    function switchView(targetViewId) {
      currentView = targetViewId;
      navTabs.forEach(tab => {
        tab.classList.toggle('is-active', tab.dataset.target === targetViewId);
      });
      viewContainers.forEach(view => {
        view.classList.toggle('is-active', view.id === targetViewId);
      });

      // Refresh view state when activated
      if (targetViewId === 'view-tasks') {
        taskViewer.render();
      } else if (targetViewId === 'view-hideout') {
        hideoutViewer.render();
      } else if (targetViewId === 'view-collection') {
        collectionViewer.refresh();
      }
    }

    navTabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const target = tab.dataset.target;
        if (target) switchView(target);
      });
    });

    // Make sure default view is active
    switchView('view-tasks');

    // Spotlight search trigger button in header
    const spotlightBtn = document.getElementById('header-spotlight-btn');
    if (spotlightBtn) {
      spotlightBtn.addEventListener('click', () => {
        commandPalette.open();
      });
    }

    // 3. Register Service Worker for PWA Offline Desktop App Support
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').then((reg) => {
        console.log('[EFT Tactical] Service Worker registered successfully, scope:', reg.scope);
      }).catch((err) => {
        console.warn('[EFT Tactical] Service Worker registration failed:', err);
      });
    }

    // 4. Backup, Export & Restore Logic (100% Offline & Free Persistence)
    const exportBtn = document.getElementById('export-backup-btn');
    const importBtn = document.getElementById('import-backup-btn');
    const fileInput = document.getElementById('backup-file-input');
    const resetAllBtn = document.getElementById('reset-all-btn');
    const backupStatus = document.getElementById('backup-status-text');

    if (exportBtn) {
      exportBtn.addEventListener('click', () => {
        const backupData = exportBackupData();
        const jsonStr = JSON.stringify(backupData, null, 2);
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `tarkov_offline_tactical_save_${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        if (backupStatus) {
          backupStatus.textContent = `[OK] 完整进度备份文件已生成下载 (包含任务、藏身处与留物仓库清单) - ${new Date().toLocaleTimeString()}`;
          backupStatus.style.color = '#10b981';
        }
      });
    }

    if (importBtn && fileInput) {
      importBtn.addEventListener('click', () => {
        fileInput.click();
      });

      fileInput.addEventListener('change', (e) => {
        const file = e.target.files && e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
          try {
            const data = JSON.parse(event.target.result);
            applyBackupData(data, { source: 'manual-import' });

            if (backupStatus) {
              backupStatus.textContent = `[OK] 本地战术进度恢复成功！已同步任务、藏身处与留物仓库状态。`;
              backupStatus.style.color = '#10b981';
            }
          } catch (err) {
            if (backupStatus) {
              backupStatus.textContent = `[错误] 导入失败，备份文件 JSON 格式有误: ${err.message}`;
              backupStatus.style.color = '#ef4444';
            }
          }
        };
        reader.readAsText(file);
      });
    }

    if (resetAllBtn) {
      resetAllBtn.addEventListener('click', () => {
        if (!confirm('确定要清空本地所有任务、藏身处与留物仓库记录吗？此操作不可逆，建议先点击导出备份。')) {
          return;
        }

        localStorage.removeItem('tarkov_offline_task_progress_v2');
        localStorage.removeItem('tarkov_offline_hideout_progress');
        localStorage.removeItem('tarkov_offline_collection_stash');

        taskViewer.progress = { completed: {}, objectives: {}, mode: 'pvp', faction: 'all' };
        taskViewer.render();

        hideoutViewer.progress = { stations: {}, items: {} };
        hideoutViewer.render();

        collectionViewer.stashCounts = {};
        collectionViewer.refresh();

        if (backupStatus) {
          backupStatus.textContent = `[提示] 本地战术助手数据已全部清空初始化。`;
          backupStatus.style.color = '#f59e0b';
        }
      });
    }
  });
})();
