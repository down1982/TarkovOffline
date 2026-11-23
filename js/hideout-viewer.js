(function () {
  'use strict';

  const STORAGE_KEY = 'tarkov_offline_hideout_progress';

  class HideoutViewer {
    constructor() {
      this.stations = [];
      this.stationsMap = new Map();
      this.subview = 'stations'; // 'stations' | 'materials'
      this.matFilter = 'all'; // 'all' | 'next'
      this.selectedStationId = null;

      // Card active tab state: { [stationId]: levelNumber }
      this.activeLevelTabs = {};

      // Local progress state:
      // stations: { [stationId]: currentLevelNumber }
      // items: { [itemId]: collectedCount }
      this.progress = {
        stations: {},
        items: {}
      };
    }

    async init() {
      this.loadProgress();
      await this.loadData();
      this.bindEvents();
      this.render();
    }

    loadProgress() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed.stations) this.progress.stations = parsed.stations;
          if (parsed.items) this.progress.items = parsed.items;
        }
      } catch (e) {
        console.warn('Failed to load hideout progress:', e);
      }
    }

    saveProgress() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.progress));
        this.updateStats();
        window.dispatchEvent(new CustomEvent('tarkov:progress-changed', { detail: { module: 'hideout' } }));
      } catch (e) {
        console.warn('Failed to save hideout progress:', e);
      }
    }

    async loadData() {
      try {
        const res = await fetch('./data/hideout.json');
        const data = await res.json();
        this.stations = data.stations || [];
        this.stations.forEach(s => {
          this.stationsMap.set(s.id, s);
          // Default active level tab: current level + 1 (capped at max level)
          const cur = this.progress.stations[s.id] || s.base_level || 0;
          this.activeLevelTabs[s.id] = Math.min(cur + 1, s.max_level);
        });
      } catch (e) {
        console.error('Failed to load hideout.json:', e);
      }
    }

    getStationLevel(stationId) {
      if (this.progress.stations[stationId] !== undefined) {
        return this.progress.stations[stationId];
      }
      const s = this.stationsMap.get(stationId);
      return s ? (s.base_level || 0) : 0;
    }

    setStationLevel(stationId, level) {
      const s = this.stationsMap.get(stationId);
      if (!s) return;
      const target = Math.max(0, Math.min(level, s.max_level));
      this.progress.stations[stationId] = target;

      // Update active tab for this station
      this.activeLevelTabs[stationId] = Math.min(target + 1, s.max_level);

      this.saveProgress();
      this.render();
    }

    getItemCollected(itemId) {
      return this.progress.items[itemId] || 0;
    }

    setItemCollected(itemId, qty) {
      const val = Math.max(0, parseInt(qty, 10) || 0);
      this.progress.items[itemId] = val;
      this.saveProgress();
      this.render();
    }

    bindEvents() {
      // Subview pills (Stations vs Materials)
      document.querySelectorAll('[data-hideout-subview]').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('[data-hideout-subview]').forEach(b => b.classList.remove('is-active'));
          btn.classList.add('is-active');
          this.subview = btn.dataset.hideoutSubview;
          this.render();
        });
      });

      // Material scope filter
      const matFilterSelect = document.getElementById('hideout-mat-filter');
      if (matFilterSelect) {
        matFilterSelect.addEventListener('change', (e) => {
          this.matFilter = e.target.value;
          this.renderMaterials();
        });
      }
    }

    render() {
      const stationsView = document.getElementById('hideout-stations-view');
      const materialsView = document.getElementById('hideout-materials-view');
      const carouselWrap = document.getElementById('hideout-carousel-wrap');

      if (this.subview === 'stations') {
        if (stationsView) stationsView.style.display = 'block';
        if (materialsView) materialsView.style.display = 'none';
        if (carouselWrap) carouselWrap.style.display = 'flex';
        this.renderCarousel();
        this.renderStationsGrid();
      } else {
        if (stationsView) stationsView.style.display = 'none';
        if (materialsView) materialsView.style.display = 'block';
        if (carouselWrap) carouselWrap.style.display = 'none';
        this.renderMaterials();
      }

      this.updateStats();
    }

    renderCarousel() {
      const container = document.getElementById('hideout-carousel-wrap');
      if (!container) return;

      container.innerHTML = this.stations.map(s => {
        const curLevel = this.getStationLevel(s.id);
        const isMax = curLevel >= s.max_level;
        const isSelected = this.selectedStationId === s.id;

        return `
          <button type="button" class="station-pill-btn ${isMax ? 'is-maxed' : ''} ${isSelected ? 'is-selected' : ''}" data-station-jump="${s.id}">
            <span class="station-pill-badge">${curLevel}/${s.max_level}</span>
            <img src="${s.icon}" alt="${s.name}" onerror="this.src='./uploads/hideout/hideout.webp'">
            <span class="station-pill-name">${s.name}</span>
          </button>
        `;
      }).join('');

      container.querySelectorAll('[data-station-jump]').forEach(btn => {
        btn.addEventListener('click', () => {
          const sid = btn.dataset.stationJump;
          this.selectedStationId = sid;
          this.renderCarousel();
          const card = document.getElementById(`station-card-${sid}`);
          if (card) {
            card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            card.style.borderColor = 'var(--primary)';
            setTimeout(() => { card.style.borderColor = ''; }, 1500);
          }
        });
      });
    }

    renderStationsGrid() {
      const container = document.getElementById('stations-grid');
      if (!container) return;

      container.innerHTML = this.stations.map(s => {
        const curLevel = this.getStationLevel(s.id);
        const activeTabLevel = this.activeLevelTabs[s.id] || Math.min(curLevel + 1, s.max_level);
        const isMax = curLevel >= s.max_level;

        // Level tabs buttons
        const levelTabsHtml = (s.levels || []).map(lv => {
          const isDone = curLevel >= lv.level;
          const isActive = activeTabLevel === lv.level;
          return `
            <button type="button" class="station-level-btn ${isActive ? 'is-active' : ''} ${isDone ? 'is-done' : ''}"
                    data-station-id="${s.id}" data-level-tab="${lv.level}">
              Lv.${lv.level} ${isDone ? '✔' : ''}
            </button>
          `;
        }).join('');

        // Find active level requirements
        const curLevelData = (s.levels || []).find(lv => lv.level === activeTabLevel) || (s.levels && s.levels[0]);

        let reqsHtml = '';
        if (curLevelData) {
          // 1. Station prereqs
          let stationPrereqsHtml = '';
          if (curLevelData.stations && curLevelData.stations.length > 0) {
            stationPrereqsHtml = `
              <div>
                <div class="req-section-title">需要其他设施</div>
                <div class="req-prereq-list">
                  ${curLevelData.stations.map(req => {
                    const reqCurLevel = this.getStationLevel(req.id);
                    const met = reqCurLevel >= req.level;
                    return `
                      <div class="req-prereq-item ${met ? 'is-met' : 'is-missing'}">
                        <span>${req.name}</span>
                        <span>需 Lv.${req.level} (当前 Lv.${reqCurLevel}) ${met ? '✔' : '❌'}</span>
                      </div>
                    `;
                  }).join('')}
                </div>
              </div>
            `;
          }

          // 2. Money reqs
          let moneyHtml = '';
          if (curLevelData.money && Object.keys(curLevelData.money).length > 0) {
            moneyHtml = `
              <div>
                <div class="req-section-title">需要资金</div>
                <div class="req-money-list">
                  ${Object.entries(curLevelData.money).map(([curr, val]) => `
                    <div class="req-money-item">
                      <span>💰 ${curr}: ${val.toLocaleString()}</span>
                    </div>
                  `).join('')}
                </div>
              </div>
            `;
          }

          // 3. Items reqs
          let itemsHtml = '';
          if (curLevelData.items && curLevelData.items.length > 0) {
            itemsHtml = `
              <div>
                <div class="req-section-title">需要物品（${curLevelData.items.length} 种）</div>
                <div class="req-item-list">
                  ${curLevelData.items.map(item => {
                    const collected = this.getItemCollected(item.id);
                    const needed = item.count;
                    const diff = Math.max(0, needed - collected);
                    const isAllCollected = collected >= needed;
                    const itemIcon = item.icon || `./uploads/base/${item.id}-base-image.webp`;

                    return `
                      <div class="req-item-row">
                        <div class="req-item-thumb">
                          <img src="${itemIcon}" alt="${item.name}" loading="lazy" onerror="this.src='./favicon.ico'">
                        </div>
                        <span class="req-item-name" title="${item.name}">${item.name}</span>
                        <span style="font-size:12px;color:${isAllCollected ? '#10b981' : '#f59e0b'};">
                          需 ${needed} / 已收
                        </span>
                        <div class="req-item-stepper">
                          <button type="button" class="btn-stepper" data-item-minus="${item.id}" data-current="${collected}">−</button>
                          <input type="number" class="input-have" value="${collected}" data-item-input="${item.id}" min="0">
                          <button type="button" class="btn-stepper" data-item-plus="${item.id}" data-current="${collected}">+</button>
                        </div>
                      </div>
                    `;
                  }).join('')}
                </div>
              </div>
            `;
          }

          reqsHtml = `
            <div class="station-requirements-box">
              ${stationPrereqsHtml}
              ${moneyHtml}
              ${itemsHtml}
            </div>
          `;
        }

        const isCurrentTabDone = curLevel >= activeTabLevel;

        return `
          <div class="station-card ${isMax ? 'is-maxed' : ''}" id="station-card-${s.id}">
            <div>
              <div class="station-card-head">
                <div class="station-card-info">
                  <img src="${s.icon}" alt="${s.name}" onerror="this.src='./uploads/hideout/hideout.webp'">
                  <div>
                    <h3>${s.name}</h3>
                    <div style="font-size:12px;color:var(--text-muted);margin-top:2px;">
                      当前等级: <strong style="color:${isMax ? '#10b981' : 'var(--primary)'};">Lv.${curLevel}</strong> / 最大 Lv.${s.max_level}
                    </div>
                  </div>
                </div>
              </div>

              <div class="station-level-pills">${levelTabsHtml}</div>
              ${reqsHtml}
            </div>

            <button type="button" class="btn-upgrade-station" data-upgrade-station="${s.id}" data-target-level="${activeTabLevel}">
              ${isCurrentTabDone ? `✔ 已达成 Lv.${activeTabLevel} (点击撤销至 Lv.${activeTabLevel - 1})` : `⭐ 升级至 Lv.${activeTabLevel}`}
            </button>
          </div>
        `;
      }).join('');

      // Bind Tab Switchers
      container.querySelectorAll('[data-level-tab]').forEach(btn => {
        btn.addEventListener('click', () => {
          const sid = btn.dataset.stationId;
          const lv = parseInt(btn.dataset.levelTab, 10);
          this.activeLevelTabs[sid] = lv;
          this.renderStationsGrid();
        });
      });

      // Bind Upgrade Button
      container.querySelectorAll('[data-upgrade-station]').forEach(btn => {
        btn.addEventListener('click', () => {
          const sid = btn.dataset.upgradeStation;
          const targetLv = parseInt(btn.dataset.targetLevel, 10);
          const curLv = this.getStationLevel(sid);

          if (curLv >= targetLv) {
            // Revert to level - 1
            this.setStationLevel(sid, targetLv - 1);
          } else {
            // Upgrade to target level
            this.setStationLevel(sid, targetLv);
          }
        });
      });

      // Bind Stepper Buttons
      container.querySelectorAll('[data-item-plus]').forEach(btn => {
        btn.addEventListener('click', () => {
          const iid = btn.dataset.itemPlus;
          const cur = parseInt(btn.dataset.current, 10) || 0;
          this.setItemCollected(iid, cur + 1);
        });
      });

      container.querySelectorAll('[data-item-minus]').forEach(btn => {
        btn.addEventListener('click', () => {
          const iid = btn.dataset.itemMinus;
          const cur = parseInt(btn.dataset.current, 10) || 0;
          this.setItemCollected(iid, Math.max(0, cur - 1));
        });
      });

      container.querySelectorAll('input[data-item-input]').forEach(input => {
        input.addEventListener('change', () => {
          const iid = input.dataset.itemInput;
          this.setItemCollected(iid, input.value);
        });
      });
    }

    renderMaterials() {
      const container = document.getElementById('hideout-materials-view');
      if (!container) return;

      // Aggregate all remaining items and currencies across unfinished stations
      const itemTotals = {}; // { [itemId]: { name: string, total: number, sources: [] } }
      let totalRub = 0;
      let totalUsd = 0;
      let totalEur = 0;

      this.stations.forEach(s => {
        const curLevel = this.getStationLevel(s.id);
        (s.levels || []).forEach(lv => {
          // If 'next' filter: only include level === curLevel + 1
          if (this.matFilter === 'next' && lv.level !== curLevel + 1) return;
          // If 'all' filter: include any level > curLevel
          if (this.matFilter === 'all' && lv.level <= curLevel) return;

          // Currencies
          if (lv.money) {
            totalRub += (lv.money.RUB || 0);
            totalUsd += (lv.money.USD || 0);
            totalEur += (lv.money.EUR || 0);
          }

          // Items
          (lv.items || []).forEach(item => {
            if (!itemTotals[item.id]) {
              itemTotals[item.id] = {
                id: item.id,
                name: item.name,
                icon: item.icon || `./uploads/base/${item.id}-base-image.webp`,
                total: 0,
                sources: []
              };
            }
            itemTotals[item.id].total += item.count;
            itemTotals[item.id].sources.push({
              stationId: s.id,
              stationName: s.name,
              level: lv.level,
              count: item.count
            });
          });
        });
      });

      const itemList = Object.values(itemTotals);
      // Sort by remaining needed count descending
      itemList.sort((a, b) => {
        const remA = Math.max(0, a.total - this.getItemCollected(a.id));
        const remB = Math.max(0, b.total - this.getItemCollected(b.id));
        return remB - remA;
      });

      const totalKinds = itemList.length;
      const totalUnits = itemList.reduce((acc, it) => acc + it.total, 0);

      const rowsHtml = itemList.map(it => {
        const collected = this.getItemCollected(it.id);
        const remaining = Math.max(0, it.total - collected);
        const isCompleted = remaining === 0;

        const sourcesHtml = it.sources.map(src => `
          <span class="mat-source-tag" data-source-jump="${src.stationId}">
            ${src.stationName} Lv.${src.level} ×${src.count}
          </span>
        `).join('');

        return `
          <tr>
            <td class="mat-name-cell">
              <div class="req-item-thumb">
                <img src="${it.icon}" alt="${it.name}" loading="lazy" onerror="this.src='./favicon.ico'">
              </div>
              <strong style="color:#fff;">${it.name}</strong>
            </td>
            <td style="text-align:right;font-weight:700;">${it.total}</td>
            <td style="text-align:right;">
              <div class="req-item-stepper" style="justify-content:flex-end;">
                <button type="button" class="btn-stepper" data-mat-minus="${it.id}" data-current="${collected}">−</button>
                <input type="number" class="input-have" value="${collected}" data-mat-input="${it.id}">
                <button type="button" class="btn-stepper" data-mat-plus="${it.id}" data-current="${collected}">+</button>
              </div>
            </td>
            <td style="text-align:right;font-weight:700;color:${isCompleted ? '#10b981' : '#ef4444'};">
              ${isCompleted ? '已备齐 ✔' : remaining}
            </td>
            <td>
              <div class="mat-source-tags">${sourcesHtml}</div>
            </td>
          </tr>
        `;
      }).join('');

      container.innerHTML = `
        <div class="mat-calculator-wrap">
          <div class="mat-summary-banner">
            <div class="mat-stat-box">
              <div class="title">需收集物品品类</div>
              <div class="val">${totalKinds} 种</div>
            </div>
            <div class="mat-stat-box">
              <div class="title">物品总件数</div>
              <div class="val">${totalUnits.toLocaleString()} 件</div>
            </div>
            <div class="mat-stat-box">
              <div class="title">卢布总需</div>
              <div class="val" style="color:#10b981;">${totalRub.toLocaleString()} ₽</div>
            </div>
            <div class="mat-stat-box">
              <div class="title">美元总需</div>
              <div class="val" style="color:#3b82f6;">${totalUsd.toLocaleString()} $</div>
            </div>
            <div class="mat-stat-box">
              <div class="title">欧元总需</div>
              <div class="val" style="color:#8b5cf6;">${totalEur.toLocaleString()} €</div>
            </div>
          </div>

          <div class="mat-table-container">
            <table class="mat-table">
              <thead>
                <tr>
                  <th style="min-width: 200px;">物品名称</th>
                  <th style="text-align:right; width:90px;">总需件数</th>
                  <th style="text-align:right; width:130px;">已收集</th>
                  <th style="text-align:right; width:110px;">还差件数</th>
                  <th>升级用途来源 (设施 & 等级)</th>
                </tr>
              </thead>
              <tbody>
                ${rowsHtml || '<tr><td colspan="5" style="text-align:center;padding:30px;color:var(--text-muted);">藏身处所有设施已全部升满，无多余材料需求！🎉</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>
      `;

      // Bind Mat Table Events
      container.querySelectorAll('[data-mat-plus]').forEach(btn => {
        btn.addEventListener('click', () => {
          const iid = btn.dataset.matPlus;
          const cur = parseInt(btn.dataset.current, 10) || 0;
          this.setItemCollected(iid, cur + 1);
        });
      });

      container.querySelectorAll('[data-mat-minus]').forEach(btn => {
        btn.addEventListener('click', () => {
          const iid = btn.dataset.matMinus;
          const cur = parseInt(btn.dataset.current, 10) || 0;
          this.setItemCollected(iid, Math.max(0, cur - 1));
        });
      });

      container.querySelectorAll('input[data-mat-input]').forEach(input => {
        input.addEventListener('change', () => {
          const iid = input.dataset.matInput;
          this.setItemCollected(iid, input.value);
        });
      });

      container.querySelectorAll('[data-source-jump]').forEach(tag => {
        tag.addEventListener('click', () => {
          const sid = tag.dataset.sourceJump;
          this.subview = 'stations';
          document.querySelectorAll('[data-hideout-subview]').forEach(b => {
            b.classList.toggle('is-active', b.dataset.hideoutSubview === 'stations');
          });
          this.render();
          setTimeout(() => {
            const card = document.getElementById(`station-card-${sid}`);
            if (card) {
              card.scrollIntoView({ behavior: 'smooth', block: 'center' });
              card.style.borderColor = 'var(--primary)';
              setTimeout(() => { card.style.borderColor = ''; }, 1500);
            }
          }, 100);
        });
      });
    }

    updateStats() {
      let currentLevelsSum = 0;
      let maxLevelsSum = 0;

      this.stations.forEach(s => {
        currentLevelsSum += this.getStationLevel(s.id);
        maxLevelsSum += s.max_level;
      });

      const percent = maxLevelsSum > 0 ? ((currentLevelsSum / maxLevelsSum) * 100).toFixed(1) : '0.0';
      const label = document.getElementById('hideout-progress-label');
      const fill = document.getElementById('hideout-progress-fill');

      if (label) {
        label.textContent = `设施升级进度: ${currentLevelsSum} / ${maxLevelsSum} 级 (${percent}%)`;
      }
      if (fill) {
        fill.style.width = `${percent}%`;
      }
    }
  }

  window.HideoutViewer = HideoutViewer;
})();
