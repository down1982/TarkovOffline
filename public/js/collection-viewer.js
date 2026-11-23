(function() {
  'use strict';

  const TASK_STORAGE_KEY = 'tarkov_offline_task_progress_v2';
  const HIDEOUT_STORAGE_KEY = 'tarkov_offline_hideout_progress';
  const STASH_STORAGE_KEY = 'tarkov_offline_collection_stash';

  class CollectionViewer {
    constructor() {
      this.items = [];
      this.taskProgress = { completed: {} };
      this.hideoutProgress = { stations: {} };
      this.stashCounts = {}; // { [itemId]: number }
      
      this.activeFilter = 'all'; // 'all' | 'fir' | 'missing' | 'task' | 'hideout' | 'collector' | 'ready'
      this.searchQuery = '';

      this.initElements();
      this.loadStorage();
      this.bindEvents();
    }

    initElements() {
      this.container = document.getElementById('view-collection');
      this.gridEl = document.getElementById('collection-grid');
      this.searchInput = document.getElementById('collection-search-input');
      this.filterButtons = document.querySelectorAll('[data-collection-filter]');
      
      // Stat labels
      this.statTotalEl = document.getElementById('col-stat-total');
      this.statFirEl = document.getElementById('col-stat-fir');
      this.statMissingEl = document.getElementById('col-stat-missing');
      this.statStashEl = document.getElementById('col-stat-stash');
      this.statKappaEl = document.getElementById('col-stat-kappa');
    }

    loadStorage() {
      try {
        const rawTask = localStorage.getItem(TASK_STORAGE_KEY);
        if (rawTask) {
          const parsed = JSON.parse(rawTask);
          if (parsed.completed) this.taskProgress.completed = parsed.completed;
        }
      } catch (e) {
        console.warn('Failed to load task progress:', e);
      }

      try {
        const rawHideout = localStorage.getItem(HIDEOUT_STORAGE_KEY);
        if (rawHideout) {
          const parsed = JSON.parse(rawHideout);
          if (parsed.stations) this.hideoutProgress.stations = parsed.stations;
        }
      } catch (e) {
        console.warn('Failed to load hideout progress:', e);
      }

      try {
        const rawStash = localStorage.getItem(STASH_STORAGE_KEY);
        if (rawStash) {
          this.stashCounts = JSON.parse(rawStash);
        }
      } catch (e) {
        console.warn('Failed to load stash counts:', e);
      }
    }

    saveStash() {
      try {
        localStorage.setItem(STASH_STORAGE_KEY, JSON.stringify(this.stashCounts));
        this.updateStats();
        window.dispatchEvent(new CustomEvent('tarkov:progress-changed', { detail: { module: 'stash' } }));
      } catch (e) {
        console.warn('Failed to save stash counts:', e);
      }
    }

    bindEvents() {
      if (this.searchInput) {
        this.searchInput.addEventListener('input', (e) => {
          this.searchQuery = e.target.value.trim().toLowerCase();
          this.render();
        });
      }

      if (this.filterButtons) {
        this.filterButtons.forEach(btn => {
          btn.addEventListener('click', () => {
            this.filterButtons.forEach(b => b.classList.remove('is-active'));
            btn.classList.add('is-active');
            this.activeFilter = btn.dataset.collectionFilter;
            this.render();
          });
        });
      }

      // Re-read storage whenever window regains focus or storage event triggers
      window.addEventListener('storage', () => {
        this.loadStorage();
        this.render();
      });
    }

    async init() {
      try {
        const res = await fetch('./data/collection.json');
        const data = await res.json();
        this.items = data.items || [];
        this.render();
      } catch (err) {
        console.error('Failed to load collection.json:', err);
      }
    }

    // Refresh state when tab is activated
    refresh() {
      this.loadStorage();
      this.render();
    }

    // Compute remaining requirement for a single item after deducting completed tasks & hideout levels
    getItemCalculations(item) {
      let remainingTaskFir = 0;
      let remainingTaskNormal = 0;
      let remainingHideout = 0;
      let remainingCollector = 0;
      let remainingStoryline = 0;

      const sourcesWithStatus = (item.sources || []).map(src => {
        let isDone = false;
        if (src.type === 'task') {
          if (src.taskId && this.taskProgress.completed[src.taskId]) {
            isDone = true;
          }
        } else if (src.type === 'hideout') {
          const reqLevel = parseInt(src.sub.replace(/[^0-9]/g, '')) || 1;
          const currentLevel = this.hideoutProgress.stations[src.moduleId] || 0;
          if (currentLevel >= reqLevel) {
            isDone = true;
          }
        }

        if (!isDone) {
          if (src.collector) {
            remainingCollector += src.needed;
          } else if (src.type === 'task') {
            if (src.fir) remainingTaskFir += src.needed;
            else remainingTaskNormal += src.needed;
          } else if (src.type === 'hideout') {
            remainingHideout += src.needed;
          } else if (src.type === 'storyline') {
            remainingStoryline += src.needed;
          }
        }

        return { ...src, isDone };
      });

      const dynamicTotalNeeded = remainingTaskFir + remainingTaskNormal + remainingHideout + remainingCollector + remainingStoryline;
      const stash = this.stashCounts[item.id] || 0;
      const missing = Math.max(0, dynamicTotalNeeded - stash);
      const isAllDone = dynamicTotalNeeded === 0;
      const isStashReady = !isAllDone && stash >= dynamicTotalNeeded;

      return {
        sourcesWithStatus,
        dynamicTotalNeeded,
        remainingTaskFir,
        remainingTaskNormal,
        remainingHideout,
        remainingCollector,
        remainingStoryline,
        stash,
        missing,
        isAllDone,
        isStashReady
      };
    }

    updateStats() {
      if (!this.statTotalEl) return;
      let totalCount = this.items.length;
      let firCount = 0;
      let missingCount = 0;
      let totalStashUnits = 0;
      let kappaTotal = 0;
      let kappaReady = 0;

      this.items.forEach(item => {
        const calc = this.getItemCalculations(item);
        if (item.requires_fir) firCount++;
        if (calc.missing > 0) missingCount++;
        totalStashUnits += calc.stash;

        if (item.collector_need > 0) {
          kappaTotal += item.collector_need;
          if (calc.isAllDone || calc.stash >= item.collector_need) {
            kappaReady += item.collector_need;
          } else {
            kappaReady += Math.min(item.collector_need, calc.stash);
          }
        }
      });

      this.statTotalEl.textContent = totalCount;
      if (this.statFirEl) this.statFirEl.textContent = firCount;
      if (this.statMissingEl) this.statMissingEl.textContent = missingCount;
      if (this.statStashEl) this.statStashEl.textContent = totalStashUnits;
      if (this.statKappaEl) this.statKappaEl.textContent = `${kappaReady} / ${kappaTotal}`;
    }

    render() {
      this.updateStats();
      if (!this.gridEl) return;

      const scrollParent = this.container?.querySelector('.col-view-container') || this.container;
      const prevScroll = scrollParent ? scrollParent.scrollTop : 0;

      const q = this.searchQuery;
      const filter = this.activeFilter;

      const filtered = this.items.filter(item => {
        const calc = this.getItemCalculations(item);

        // Filter check
        if (filter === 'fir' && !item.requires_fir) return false;
        if (filter === 'missing' && calc.missing === 0) return false;
        if (filter === 'ready' && !calc.isAllDone && !calc.isStashReady) return false;
        if (filter === 'task' && item.task_fir_need === 0 && item.task_normal_need === 0) return false;
        if (filter === 'hideout' && item.hideout_need === 0) return false;
        if (filter === 'collector' && item.collector_need === 0) return false;

        // Search check
        if (q) {
          const matchName = item.name.toLowerCase().includes(q);
          const matchSources = (item.sources || []).some(s => s.title && s.title.toLowerCase().includes(q));
          if (!matchName && !matchSources) return false;
        }

        return true;
      });

      this.gridEl.innerHTML = '';

      if (filtered.length === 0) {
        this.gridEl.innerHTML = `
          <div style="grid-column: 1 / -1; text-align: center; padding: 48px; color: #8b929c;">
            <div style="font-size: 32px; margin-bottom: 8px;">📦</div>
            <div>没有找到符合筛选条件的必留物品</div>
          </div>
        `;
        return;
      }

      filtered.forEach(item => {
        const calc = this.getItemCalculations(item);
        const card = document.createElement('div');
        card.className = `collection-card ${calc.isAllDone ? 'is-complete' : calc.isStashReady ? 'is-ready' : 'is-missing'}`;

        const formatUnit = (count) => {
          const numStr = (count || 0).toLocaleString();
          if (item.name === '卢布') return `${numStr} ₽`;
          if (item.name === '美元') return `${numStr} $`;
          if (item.name === '欧元') return `${numStr} €`;
          if (item.name.includes('发') || item.name.includes('弹')) return `${numStr} 发`;
          return `${numStr} 件`;
        };

        // Status badge
        let badgeHtml = '';
        if (calc.isAllDone) {
          badgeHtml = '<span class="col-status-badge badge-done">✓ 任务已交齐</span>';
        } else if (calc.isStashReady) {
          badgeHtml = `<span class="col-status-badge badge-ready">★ 仓库已备齐 (${formatUnit(calc.stash)} / ${formatUnit(calc.dynamicTotalNeeded)})</span>`;
        } else {
          badgeHtml = `<span class="col-status-badge badge-need">还缺 ${formatUnit(calc.missing)}</span>`;
        }

        // Tags
        let tagsHtml = '';
        if (item.requires_fir) {
          tagsHtml += '<span class="col-tag tag-fir">🔥 战局带出</span>';
        }
        if (item.collector_need > 0) {
          tagsHtml += '<span class="col-tag tag-kappa">🏆 Kappa</span>';
        }
        if (calc.remainingTaskFir > 0 || calc.remainingTaskNormal > 0) {
          tagsHtml += '<span class="col-tag tag-task">📋 任务</span>';
        }
        if (calc.remainingHideout > 0) {
          tagsHtml += '<span class="col-tag tag-hideout">🏠 藏身处</span>';
        }

        // Progress percentage
        const pct = calc.dynamicTotalNeeded > 0 ? Math.min(100, Math.round((calc.stash / calc.dynamicTotalNeeded) * 100)) : 100;

        card.innerHTML = `
          <div class="col-card-head">
            <div class="col-item-thumb">
              <img src="${item.icon}" alt="${item.name}" loading="lazy" onerror="this.src='./favicon.ico'">
            </div>
            <div class="col-item-info">
              <div class="col-item-name" title="${item.name}">${item.name}</div>
              <div class="col-item-tags">${tagsHtml}</div>
            </div>
          </div>

          <div class="col-card-body">
            <div class="col-need-row">
              <div class="col-need-label">动态总需求: <strong>${formatUnit(calc.dynamicTotalNeeded)}</strong></div>
              <div class="col-need-status">${badgeHtml}</div>
            </div>

            <div class="col-progress-bar">
              <div class="col-progress-fill" style="width: ${pct}%;"></div>
            </div>

            <!-- In Stash Counter Control -->
            <div class="col-stash-ctrl">
              <span class="col-stash-label">仓库库存:</span>
              <div class="col-counter-btns">
                <button type="button" class="btn-stash-step btn-minus" data-action="minus">-</button>
                <input type="number" class="stash-input" min="0" max="99999" value="${calc.stash}">
                <button type="button" class="btn-stash-step btn-plus" data-action="plus">+</button>
              </div>
              <button type="button" class="btn-stash-fill" data-action="fill" title="将库存直接填满当前所需数量">标满</button>
            </div>
          </div>

          <!-- Expandable Sources List -->
          <div class="col-sources-toggle" data-action="toggle-sources">
            <span>📋 查看 ${item.sources.length} 处具体需求明细</span>
            <span class="toggle-arrow">▼</span>
          </div>

          <div class="col-sources-list" style="display: none;">
            ${calc.sourcesWithStatus.map(s => {
              const typeIcon = s.type === 'task' ? '📜' : s.type === 'hideout' ? '🏠' : '📖';
              const firBadge = s.fir ? '<span class="src-fir">FIR</span>' : '';
              const doneBadge = s.isDone ? '<span class="src-done">✓ 已完成</span>' : `<span class="src-qty">需 ${formatUnit(s.needed)}</span>`;
              return `
                <div class="col-source-row ${s.isDone ? 'is-fulfilled' : ''}">
                  <div class="col-source-title">
                    <span class="src-icon">${typeIcon}</span>
                    <span class="src-name">${s.title}</span>
                    <span class="src-sub">${s.sub || ''}</span>
                    ${firBadge}
                  </div>
                  <div class="col-source-status">
                    ${doneBadge}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
        `;

        // Bind interactive events for this card
        const inputEl = card.querySelector('.stash-input');
        const minusBtn = card.querySelector('.btn-minus');
        const plusBtn = card.querySelector('.btn-plus');
        const fillBtn = card.querySelector('.btn-stash-fill');
        const toggleSources = card.querySelector('[data-action="toggle-sources"]');
        const sourcesList = card.querySelector('.col-sources-list');

        const updateCount = (newCount) => {
          newCount = Math.max(0, parseInt(newCount, 10) || 0);
          this.stashCounts[item.id] = newCount;
          this.saveStash();
          this.render();
        };

        minusBtn.addEventListener('click', () => updateCount(calc.stash - 1));
        plusBtn.addEventListener('click', () => updateCount(calc.stash + 1));
        inputEl.addEventListener('change', (e) => updateCount(e.target.value));
        inputEl.addEventListener('keydown', (e) => {
          if (e.key === 'Enter') updateCount(e.target.value);
        });

        fillBtn.addEventListener('click', () => updateCount(calc.dynamicTotalNeeded));

        toggleSources.addEventListener('click', () => {
          const isHidden = sourcesList.style.display === 'none';
          sourcesList.style.display = isHidden ? 'block' : 'none';
          toggleSources.querySelector('.toggle-arrow').textContent = isHidden ? '▲' : '▼';
        });

        this.gridEl.appendChild(card);
      });

      if (scrollParent && prevScroll > 0) {
        scrollParent.scrollTop = prevScroll;
      }
    }
  }

  window.CollectionViewer = CollectionViewer;
})();
