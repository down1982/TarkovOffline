(function() {
  'use strict';

  class CommandPalette {
    constructor() {
      this.isOpen = false;
      this.tasks = [];
      this.hideoutStations = [];
      this.collectionItems = [];
      this.results = [];
      this.selectedIndex = 0;

      this.createDom();
      this.bindEvents();
      this.loadIndexData();
    }

    createDom() {
      const overlay = document.createElement('div');
      overlay.id = 'cmd-palette-overlay';
      overlay.className = 'cmd-palette-overlay';
      overlay.style.display = 'none';

      overlay.innerHTML = `
        <div class="cmd-palette-box">
          <div class="cmd-search-header">
            <span class="cmd-search-icon">🔍</span>
            <input type="text" id="cmd-palette-input" class="cmd-palette-input" placeholder="全局搜索任务、藏身处设施、战局留物 (支持拼音/英文检索)..." autocomplete="off">
            <span class="cmd-shortcut-tip">ESC 关闭</span>
          </div>
          <div id="cmd-palette-results" class="cmd-palette-results"></div>
          <div class="cmd-palette-footer">
            <div class="cmd-footer-hints">
              <span><kbd>↑</kbd><kbd>↓</kbd> 选择</span>
              <span><kbd>ENTER</kbd> 跳转</span>
              <span><kbd>1~4</kbd> 快捷切换页面</span>
            </div>
            <div class="cmd-footer-tag">EFT Tactical HUD</div>
          </div>
        </div>
      `;

      document.body.appendChild(overlay);
      this.overlay = overlay;
      this.inputEl = overlay.querySelector('#cmd-palette-input');
      this.resultsEl = overlay.querySelector('#cmd-palette-results');
    }

    async loadIndexData() {
      try {
        const [tasksRes, hideoutRes, collRes] = await Promise.all([
          fetch('./data/tasks.json').then(r => r.json()).catch(() => ({ tasks: [] })),
          fetch('./data/hideout.json').then(r => r.json()).catch(() => ({ stations: [] })),
          fetch('./data/collection.json').then(r => r.json()).catch(() => ({ items: [] }))
        ]);

        this.tasks = tasksRes.tasks || [];
        this.hideoutStations = hideoutRes.stations || [];
        this.collectionItems = collRes.items || [];
      } catch (e) {
        console.warn('Failed to load command palette index data:', e);
      }
    }

    bindEvents() {
      // Global shortcut listener
      window.addEventListener('keydown', (e) => {
        const activeTag = document.activeElement ? document.activeElement.tagName.toLowerCase() : '';
        const isInput = activeTag === 'input' || activeTag === 'textarea' || activeTag === 'select';

        // Ctrl+K or Cmd+K
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
          e.preventDefault();
          this.toggle();
          return;
        }

        // Open with '/' if not in an input
        if (e.key === '/' && !isInput && !this.isOpen) {
          e.preventDefault();
          this.open();
          return;
        }

        // Hotkeys 1-4 when not typing in any input
        if (!isInput && !this.isOpen && e.key >= '1' && e.key <= '4') {
          const tabMap = {
            '1': 'view-tasks',
            '2': 'view-hideout',
            '3': 'view-collection',
            '4': 'view-sync'
          };
          const target = tabMap[e.key];
          if (target && window.app && window.app.switchTab) {
            e.preventDefault();
            window.app.switchTab(target);
          }
          return;
        }

        // When palette is open
        if (this.isOpen) {
          if (e.key === 'Escape') {
            e.preventDefault();
            this.close();
          } else if (e.key === 'ArrowDown') {
            e.preventDefault();
            this.navigate(1);
          } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            this.navigate(-1);
          } else if (e.key === 'Enter') {
            e.preventDefault();
            this.executeSelected();
          }
        }
      });

      // Overlay background click to close
      this.overlay.addEventListener('click', (e) => {
        if (e.target === this.overlay) {
          this.close();
        }
      });

      // Realtime input search
      this.inputEl.addEventListener('input', () => {
        this.search(this.inputEl.value.trim().toLowerCase());
      });
    }

    toggle() {
      if (this.isOpen) this.close();
      else this.open();
    }

    open() {
      this.isOpen = true;
      this.overlay.style.display = 'flex';
      this.inputEl.value = '';
      this.inputEl.focus();
      this.search('');
    }

    close() {
      this.isOpen = false;
      this.overlay.style.display = 'none';
    }

    search(query) {
      this.results = [];
      this.selectedIndex = 0;

      if (!query) {
        // Show default popular quick links
        this.results = [
          { type: 'view', title: '🌳 任务管理', sub: '602 项任务拓扑关系图与全列表管理', action: () => window.app.switchTab('view-tasks') },
          { type: 'view', title: '🏠 藏身处管理', sub: '26 处设施升级与 116 种材料清单汇总', action: () => window.app.switchTab('view-hideout') },
          { type: 'view', title: '📦 留物速查器', sub: '282 项战局带出 (FIR) 与动态库存统计', action: () => window.app.switchTab('view-collection') },
          { type: 'view', title: '💾 进度与备份', sub: '本地离线永久保存 · 进度导入与导出', action: () => window.app.switchTab('view-sync') }
        ];
        this.renderResults();
        return;
      }

      // 1. Search Tasks (max 5)
      let taskMatches = 0;
      for (const t of this.tasks) {
        if (taskMatches >= 5) break;
        if (t.title && t.title.toLowerCase().includes(query)) {
          this.results.push({
            type: 'task',
            title: `📋 ${t.title}`,
            sub: `${t.trader} | ${t.level || ''} | ${t.objectives?.[0] || ''}`,
            action: () => {
              window.app.switchTab('view-tasks');
              if (window.app.taskViewer) window.app.taskViewer.selectTask(t.id);
            }
          });
          taskMatches++;
        }
      }

      // 2. Search Collection Items (max 5)
      let collMatches = 0;
      for (const it of this.collectionItems) {
        if (collMatches >= 5) break;
        if (it.name.toLowerCase().includes(query)) {
          this.results.push({
            type: 'collection',
            title: `📦 ${it.name}`,
            sub: `共需 ${it.total_need} 件 ${it.requires_fir ? '(需战局带出)' : ''} | ${it.sources?.length || 0} 处使用`,
            action: () => {
              window.app.switchTab('view-collection');
              if (window.app.collectionViewer) {
                window.app.collectionViewer.searchInput.value = it.name;
                window.app.collectionViewer.searchQuery = it.name.toLowerCase();
                window.app.collectionViewer.render();
              }
            }
          });
          collMatches++;
        }
      }

      // 3. Search Hideout Stations (max 5)
      let hideoutMatches = 0;
      for (const s of this.hideoutStations) {
        if (hideoutMatches >= 5) break;
        if (s.name.toLowerCase().includes(query)) {
          this.results.push({
            type: 'hideout',
            title: `🏠 藏身处: ${s.name}`,
            sub: `最高等级: ${s.max_level} 级`,
            action: () => {
              window.app.switchTab('view-hideout');
            }
          });
          hideoutMatches++;
        }
      }

      this.renderResults();
    }

    renderResults() {
      this.resultsEl.innerHTML = '';
      if (this.results.length === 0) {
        this.resultsEl.innerHTML = `
          <div style="text-align:center;padding:32px;color:#8b929c;">
            <div>没有找到匹配结果</div>
            <div style="font-size:12px;margin-top:6px;">可尝试搜索拼音或其它关键词</div>
          </div>
        `;
        return;
      }

      this.results.forEach((res, idx) => {
        const item = document.createElement('div');
        item.className = `cmd-result-item ${idx === this.selectedIndex ? 'is-selected' : ''}`;
        item.innerHTML = `
          <div class="cmd-result-title">${res.title}</div>
          <div class="cmd-result-sub">${res.sub}</div>
        `;

        item.addEventListener('mouseenter', () => {
          this.selectedIndex = idx;
          this.updateSelection();
        });

        item.addEventListener('click', () => {
          this.close();
          if (res.action) res.action();
        });

        this.resultsEl.appendChild(item);
      });
    }

    navigate(delta) {
      if (this.results.length === 0) return;
      this.selectedIndex = (this.selectedIndex + delta + this.results.length) % this.results.length;
      this.updateSelection();
    }

    updateSelection() {
      const items = this.resultsEl.querySelectorAll('.cmd-result-item');
      items.forEach((item, idx) => {
        item.classList.toggle('is-selected', idx === this.selectedIndex);
        if (idx === this.selectedIndex) {
          item.scrollIntoView({ block: 'nearest' });
        }
      });
    }

    executeSelected() {
      if (this.selectedIndex >= 0 && this.selectedIndex < this.results.length) {
        const sel = this.results[this.selectedIndex];
        this.close();
        if (sel && sel.action) sel.action();
      }
    }
  }

  window.CommandPalette = CommandPalette;
})();
