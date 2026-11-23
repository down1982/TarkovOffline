/**
 * Escape from Tarkov Tactical Offline Assistant
 * AI Tactical Screen Scanner Controller (OCR-based Safe Game Progress Acquisition)
 */
(function() {
  'use strict';

  class ScannerController {
    constructor() {
      this.modal = document.getElementById('scanner-modal-overlay');
      this.closeBtn = document.getElementById('scanner-modal-close');
      this.triggerBtn = document.getElementById('header-scanner-btn');
      this.dropzone = document.getElementById('scanner-dropzone');
      this.fileInput = document.getElementById('scanner-file-input');
      this.browseBtn = document.getElementById('scanner-browse-btn');
      this.loadingEl = document.getElementById('scanner-loading');
      this.resultsEl = document.getElementById('scanner-results');

      this.currentMatches = null;
      this.bindEvents();
    }

    bindEvents() {
      // Header button click
      if (this.triggerBtn) {
        this.triggerBtn.addEventListener('click', () => this.open());
      }

      // Close modal
      if (this.closeBtn) {
        this.closeBtn.addEventListener('click', () => this.close());
      }
      if (this.modal) {
        this.modal.addEventListener('click', (e) => {
          if (e.target === this.modal) this.close();
        });
      }

      // File browse
      if (this.browseBtn && this.fileInput) {
        this.browseBtn.addEventListener('click', () => this.fileInput.click());
        this.fileInput.addEventListener('change', (e) => {
          const file = e.target.files && e.target.files[0];
          if (file) this.processFile(file);
        });
      }

      // Drag and drop
      if (this.dropzone) {
        this.dropzone.addEventListener('dragover', (e) => {
          e.preventDefault();
          this.dropzone.classList.add('is-dragover');
        });
        this.dropzone.addEventListener('dragleave', () => {
          this.dropzone.classList.remove('is-dragover');
        });
        this.dropzone.addEventListener('drop', (e) => {
          e.preventDefault();
          this.dropzone.classList.remove('is-dragover');
          const file = e.dataTransfer.files && e.dataTransfer.files[0];
          if (file && file.type.startsWith('image/')) {
            this.processFile(file);
          }
        });
      }

      // Global Clipboard Paste (Ctrl + V)
      window.addEventListener('paste', (e) => {
        const items = e.clipboardData && e.clipboardData.items;
        if (!items) return;

        for (let i = 0; i < items.length; i++) {
          if (items[i].type.indexOf('image') !== -1) {
            e.preventDefault();
            const file = items[i].getAsFile();
            if (file) {
              this.open();
              this.processFile(file);
              break;
            }
          }
        }
      });

      // ESC to close
      window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && this.modal && this.modal.style.display !== 'none') {
          this.close();
        }
      });
    }

    open() {
      if (this.modal) {
        this.modal.classList.add('is-open');
        this.modal.style.display = 'flex';
      }
    }

    close() {
      if (this.modal) {
        this.modal.classList.remove('is-open');
        this.modal.style.display = 'none';
      }
    }

    processFile(file) {
      const reader = new FileReader();
      reader.onload = (e) => {
        const base64 = e.target.result;
        this.sendToOCR(base64);
      };
      reader.readAsDataURL(file);
    }

    async sendToOCR(base64Image) {
      if (!this.loadingEl || !this.resultsEl) return;
      this.loadingEl.style.display = 'block';
      this.resultsEl.style.display = 'none';
      this.resultsEl.innerHTML = '';

      try {
        const res = await fetch('./api/scanner/recognize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ image: base64Image })
        });

        const json = await res.json();
        this.loadingEl.style.display = 'none';

        if (json.code === 0 && json.data) {
          this.currentMatches = json.data;
          this.renderResults(json.data, base64Image);
        } else {
          this.resultsEl.style.display = 'block';
          this.resultsEl.innerHTML = `
            <div style="color:#ef4444;text-align:center;padding:16px;">
              识别失败: ${json.error || '未识别到有效文字'}
            </div>
          `;
        }
      } catch (err) {
        this.loadingEl.style.display = 'none';
        this.resultsEl.style.display = 'block';
        this.resultsEl.innerHTML = `
          <div style="color:#ef4444;text-align:center;padding:16px;line-height:1.6;">
            <div>请求本地 OCR 扫描服务失败 (${err.message})</div>
            <div style="font-size:12px;color:#9ca3af;margin-top:6px;">提示：GitHub Pages 等纯静态托管环境下不支持后端识图，如需使用请在本机运行 <code>py server.py</code> 后访问本地地址。</div>
          </div>
        `;
      }
    }

    renderResults(data, previewSrc) {
      const { full_text, matched_items, matched_tasks } = data;
      this.resultsEl.style.display = 'block';

      let tasksHtml = '';
      if (matched_tasks && matched_tasks.length > 0) {
        const taskCards = matched_tasks.map(t => {
          const isDone = window.app?.taskViewer?.isTaskCompleted(t.id);
          return `
            <div class="scanner-match-card" style="border-left: 3px solid ${isDone ? '#10b981' : '#f59e0b'};">
              <div style="display:flex;align-items:center;justify-content:space-between;">
                <div style="display:flex;align-items:center;gap:8px;">
                  <img src="${t.trader_avatar}" style="width:24px;height:24px;border-radius:50%;" onerror="this.style.display='none'">
                  <strong style="color:#fff;font-size:14px;">${t.title}</strong>
                  <span class="badge-tag">${t.trader}</span>
                  <span class="badge-tag badge-level">${t.level || 'Lv.1'}</span>
                  ${t.is_kappa ? '<span class="badge-tag badge-kappa">🏆 Kappa</span>' : ''}
                </div>
                <label style="display:flex;align-items:center;gap:6px;font-size:13px;cursor:pointer;color:${isDone ? '#10b981' : '#f59e0b'};">
                  <input type="checkbox" class="scanner-task-check" data-task-id="${t.id}" ${isDone ? 'checked' : ''}>
                  ${isDone ? '已完成' : '勾选完成'}
                </label>
              </div>
              <div style="font-size:12px;color:#8b949e;margin-top:4px;">
                ${t.objectives?.[0] || '目标已定位'}
              </div>
            </div>
          `;
        }).join('');

        tasksHtml = `
          <div style="margin-top:16px;">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
              <div style="font-weight:700;color:#f59e0b;font-size:14px;">
                🎯 匹配到相关任务 (${matched_tasks.length} 项)
              </div>
              <button type="button" id="scanner-batch-complete-btn" class="btn-primary" style="padding:4px 12px;font-size:12px;">
                ✔ 一键批量勾选上述任务
              </button>
            </div>
            <div style="display:flex;flex-direction:column;gap:8px;">
              ${taskCards}
            </div>
          </div>
        `;
      }

      let itemsHtml = '';
      if (matched_items && matched_items.length > 0) {
        const itemCards = matched_items.map(it => {
          const sourcesHtml = (it.sources || []).map(s => `
            <span class="mat-source-tag">
              ${s.title} ${s.sub || ''} ×${s.needed}
            </span>
          `).join('');

          return `
            <div class="scanner-match-card" style="border-left: 3px solid #f59e0b;">
              <div style="display:flex;align-items:center;gap:12px;">
                <div class="req-item-thumb">
                  <img src="${it.icon}" alt="${it.name}" onerror="this.src='./favicon.ico'">
                </div>
                <div style="flex:1;">
                  <div style="display:flex;align-items:center;gap:8px;">
                    <strong style="color:#fff;font-size:14px;">${it.name}</strong>
                    <span style="font-size:12px;font-weight:700;color:${it.requires_fir ? '#ef4444' : '#10b981'};">
                      ${it.requires_fir ? '🔥 需战局带出 (FIR)' : '✔ 可跳蚤购买'}
                    </span>
                    <span style="font-size:12px;color:#8b949e;">共需: ${it.total_need} 件</span>
                  </div>
                  <div class="mat-source-tags" style="margin-top:6px;">
                    ${sourcesHtml}
                  </div>
                </div>
              </div>
            </div>
          `;
        }).join('');

        itemsHtml = `
          <div style="margin-top:16px;">
            <div style="font-weight:700;color:#f59e0b;font-size:14px;margin-bottom:8px;">
              📦 匹配到战局必留物品 (${matched_items.length} 种)
            </div>
            <div style="display:flex;flex-direction:column;gap:8px;">
              ${itemCards}
            </div>
          </div>
        `;
      }

      let emptyHtml = '';
      if ((!matched_tasks || matched_tasks.length === 0) && (!matched_items || matched_items.length === 0)) {
        emptyHtml = `
          <div style="text-align:center;padding:16px;color:#8b949e;background:#14171a;border-radius:8px;margin-top:16px;">
            <div>已识别画面文字，但未匹配到特定任务或 282 种必留物品名称。</div>
            <div style="font-size:12px;color:#6b7280;margin-top:6px;word-break:break-all;">
              识别文字: "${full_text || '无'}"
            </div>
          </div>
        `;
      }

      this.resultsEl.innerHTML = `
        <div style="display:flex;gap:12px;align-items:flex-start;background:#101214;padding:10px;border-radius:8px;border:1px solid #272d36;">
          <img src="${previewSrc}" style="max-width:140px;max-height:90px;object-fit:contain;border-radius:4px;border:1px solid #374151;">
          <div style="flex:1;font-size:12px;color:#8b949e;">
            <div style="color:#10b981;font-weight:700;margin-bottom:4px;">✔ 截图解析完成</div>
            <div>已提取文字：<span style="color:#c9d1d9;">${full_text.slice(0, 100)}${full_text.length > 100 ? '...' : ''}</span></div>
          </div>
        </div>
        ${tasksHtml}
        ${itemsHtml}
        ${emptyHtml}
      `;

      // Bind batch complete button
      const batchBtn = document.getElementById('scanner-batch-complete-btn');
      if (batchBtn && matched_tasks && matched_tasks.length > 0) {
        batchBtn.addEventListener('click', () => {
          const checks = this.resultsEl.querySelectorAll('.scanner-task-check');
          let count = 0;
          checks.forEach(chk => {
            const taskId = chk.dataset.taskId;
            if (taskId && window.app?.taskViewer) {
              window.app.taskViewer.progress.completed[taskId] = true;
              chk.checked = true;
              count++;
            }
          });

          if (window.app?.taskViewer) {
            window.app.taskViewer.saveProgress();
            window.app.taskViewer.render();
          }
          if (window.app?.collectionViewer) {
            window.app.collectionViewer.refresh();
          }

          batchBtn.textContent = `✔ 已成功同步勾选 ${count} 个任务！`;
          batchBtn.style.background = '#10b981';
          batchBtn.style.borderColor = '#10b981';
        });
      }

      // Bind individual task checkboxes
      this.resultsEl.querySelectorAll('.scanner-task-check').forEach(chk => {
        chk.addEventListener('change', () => {
          const taskId = chk.dataset.taskId;
          if (taskId && window.app?.taskViewer) {
            window.app.taskViewer.progress.completed[taskId] = chk.checked;
            window.app.taskViewer.saveProgress();
            window.app.taskViewer.render();
            if (window.app?.collectionViewer) window.app.collectionViewer.refresh();
          }
        });
      });
    }
  }

  window.ScannerController = ScannerController;
})();
