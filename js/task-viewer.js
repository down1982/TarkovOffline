(function () {
  'use strict';

  const STORAGE_KEY = 'tarkov_offline_task_progress_v2';

  class TaskViewer {
    constructor() {
      this.tasks = [];
      this.tasksMap = new Map();
      this.edges = [];
      this.precomputedEdges = [];
      this.tradersList = [];
      this.tradersMap = new Map();
      this.sectionsList = [];
      this.sectionsMap = new Map();
      this.subview = 'tree'; // 'tree' | 'list'

      // DOM Node references cache: { [id]: HTMLElement }
      this.nodeElements = new Map();
      this.sectionElements = new Map();
      this.traderElements = new Map();

      // Progress State
      this.progress = {
        completed: {},
        objectives: {},
        mode: 'pvp',
        faction: 'all'
      };

      // Canvas / Pan-Zoom State
      this.scale = 0.55;
      this.tx = 120;
      this.ty = 80;
      this.isPanning = false;
      this.startX = 0;
      this.startY = 0;
      this.rafId = null;

      // Filter State
      this.filterTrader = 'all';
      this.filterStatus = 'all'; // 'all' | 'available' | 'locked' | 'completed'
      this.searchQuery = '';

      // Canvas 2D
      this.canvas = null;
      this.ctx = null;
      this.dpr = window.devicePixelRatio || 1;
      this.viewW = 0;
      this.viewH = 0;
    }

    async init() {
      this.loadProgress();
      await this.loadData();
      this.initCanvas();
      this.bindEvents();
      this.render();
    }

    loadProgress() {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed.completed) this.progress.completed = parsed.completed;
          if (parsed.objectives) this.progress.objectives = parsed.objectives;
          if (parsed.mode) this.progress.mode = parsed.mode;
          if (parsed.faction) this.progress.faction = parsed.faction;
        }
      } catch (e) {
        console.warn('Failed to load task progress from storage:', e);
      }
    }

    saveProgress() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(this.progress));
        this.updateStats();
        window.dispatchEvent(new CustomEvent('tarkov:progress-changed', { detail: { module: 'tasks' } }));
      } catch (e) {
        console.warn('Failed to save task progress:', e);
      }
    }

    async loadData() {
      try {
        const [resTasks, resTraders, resSections] = await Promise.all([
          fetch('./data/tasks.json'),
          fetch('./data/traders.json').catch(() => ({ ok: false })),
          fetch('./data/sections.json').catch(() => ({ ok: false }))
        ]);

        const data = await resTasks.json();
        this.tasks = data.tasks || [];
        this.edges = data.edges || [];
        this.tradersList = resTraders.ok ? ((await resTraders.json()) || []) : [];
        this.sectionsList = resSections.ok ? ((await resSections.json()) || []) : [];
        this.taskMapLinks = {};

        // Build Maps
        this.tasks.forEach(t => this.tasksMap.set(String(t.id), t));
        this.tradersList.forEach(t => this.tradersMap.set(String(t.key), t));
        this.sectionsList.forEach(s => this.sectionsMap.set(String(s.key), s));

        // Precompute Edge Coordinates for zero-overhead canvas rendering
        this.precomputeEdgeCoordinates();
      } catch (e) {
        console.error('Failed to load task data:', e);
      }
    }

    precomputeEdgeCoordinates() {
      this.precomputedEdges = [];

      this.edges.forEach(edge => {
        const fromId = String(edge.from_task_id);
        const toId = String(edge.to_task_id);

        let x1 = 0, y1 = 0, x2 = 0, y2 = 0;

        // Resolve From Node
        if (this.tasksMap.has(fromId)) {
          const t = this.tasksMap.get(fromId);
          x1 = t.base_x + 130;
          y1 = t.base_y + 160;
        } else if (this.tradersMap.has(fromId)) {
          const tr = this.tradersMap.get(fromId);
          x1 = tr.x + 90;
          y1 = tr.y + 60;
        } else if (this.sectionsMap.has(fromId)) {
          const s = this.sectionsMap.get(fromId);
          x1 = s.x + 75;
          y1 = s.y + 35;
        } else {
          return;
        }

        // Resolve To Node
        if (this.tasksMap.has(toId)) {
          const t = this.tasksMap.get(toId);
          x2 = t.base_x + 130;
          y2 = t.base_y;
        } else if (this.sectionsMap.has(toId)) {
          const s = this.sectionsMap.get(toId);
          x2 = s.x + 75;
          y2 = s.y;
        } else if (this.tradersMap.has(toId)) {
          const tr = this.tradersMap.get(toId);
          x2 = tr.x + 90;
          y2 = tr.y;
        } else {
          return;
        }

        const my = y1 + (y2 - y1) / 2;

        this.precomputedEdges.push({
          fromId,
          toId,
          x1,
          y1,
          x2,
          y2,
          my,
          minX: Math.min(x1, x2) - 10,
          maxX: Math.max(x1, x2) + 10,
          minY: Math.min(y1, y2) - 10,
          maxY: Math.max(y1, y2) + 10
        });
      });
    }

    initCanvas() {
      this.canvas = document.getElementById('task-tree-canvas');
      if (!this.canvas) return;
      this.ctx = this.canvas.getContext('2d', { alpha: true });
      this.resizeCanvas();

      window.addEventListener('resize', () => {
        this.resizeCanvas();
        this.scheduleRender();
      });
    }

    resizeCanvas() {
      const viewport = document.getElementById('task-tree-viewport');
      if (!viewport || !this.canvas) return;

      this.viewW = viewport.clientWidth;
      this.viewH = viewport.clientHeight;
      this.dpr = window.devicePixelRatio || 1;

      this.canvas.width = Math.round(this.viewW * this.dpr);
      this.canvas.height = Math.round(this.viewH * this.dpr);
      this.canvas.style.width = `${this.viewW}px`;
      this.canvas.style.height = `${this.viewH}px`;
    }

    isTaskCompleted(taskId) {
      return !!this.progress.completed[taskId];
    }

    isTaskAvailable(taskId) {
      if (this.isTaskCompleted(taskId)) return false;
      const parentEdges = this.edges.filter(e => String(e.to_task_id) === String(taskId));
      if (parentEdges.length === 0) return true;

      return parentEdges.every(e => {
        const fromId = String(e.from_task_id);
        if (fromId.startsWith('trader:') || fromId.startsWith('section:')) {
          return true;
        }
        return !!this.progress.completed[fromId];
      });
    }

    toggleTaskCompleted(taskId) {
      if (this.progress.completed[taskId]) {
        delete this.progress.completed[taskId];
        if (this.progress.objectives[taskId]) {
          delete this.progress.objectives[taskId];
        }
      } else {
        this.progress.completed[taskId] = true;
        const task = this.tasksMap.get(taskId);
        if (task && task.objectives) {
          if (!this.progress.objectives[taskId]) this.progress.objectives[taskId] = {};
          task.objectives.forEach((_, idx) => {
            this.progress.objectives[taskId][idx] = true;
          });
        }
      }
      this.saveProgress();
      this.updateViewNodes();
      this.scheduleRender();
    }

    toggleObjective(taskId, objIdx) {
      if (!this.progress.objectives[taskId]) {
        this.progress.objectives[taskId] = {};
      }
      const current = !!this.progress.objectives[taskId][objIdx];
      this.progress.objectives[taskId][objIdx] = !current;

      const task = this.tasksMap.get(taskId);
      if (task && task.objectives) {
        const allDone = task.objectives.every((_, idx) => !!this.progress.objectives[taskId][idx]);
        if (allDone) {
          this.progress.completed[taskId] = true;
        } else {
          delete this.progress.completed[taskId];
        }
      }
      this.saveProgress();
      this.updateViewNodes();
      this.scheduleRender();
    }

    bindEvents() {
      // Subview toggles (Tree vs List)
      document.querySelectorAll('[data-task-subview]').forEach(btn => {
        btn.addEventListener('click', () => {
          document.querySelectorAll('[data-task-subview]').forEach(b => b.classList.remove('is-active'));
          btn.classList.add('is-active');
          this.subview = btn.dataset.taskSubview;
          this.render();
        });
      });

      // Filter Trader
      const traderSelect = document.getElementById('task-filter-trader');
      if (traderSelect) {
        traderSelect.addEventListener('change', (e) => {
          this.filterTrader = e.target.value;
          if (this.subview === 'tree') {
            this.applyTraderFilterToTree(this.filterTrader);
          } else {
            this.renderList();
          }
        });
      }

      // Filter Status
      const statusSelect = document.getElementById('task-filter-status');
      if (statusSelect) {
        statusSelect.addEventListener('change', (e) => {
          this.filterStatus = e.target.value;
          this.render();
        });
      }

      // Search Box
      const searchInput = document.getElementById('task-search-input');
      if (searchInput) {
        searchInput.addEventListener('input', (e) => {
          this.searchQuery = e.target.value.trim().toLowerCase();
          if (this.subview === 'tree') {
            this.highlightSearchTree(this.searchQuery);
          } else {
            this.renderList();
          }
        });
      }

      // Reset Viewport Button
      const resetBtn = document.getElementById('task-tree-reset-btn');
      if (resetBtn) {
        resetBtn.addEventListener('click', () => {
          this.scale = 0.55;
          this.tx = 120;
          this.ty = 80;
          this.scheduleRender();
        });
      }

      // Zoom Controls
      const zoomIn = document.getElementById('task-zoom-in');
      const zoomOut = document.getElementById('task-zoom-out');
      if (zoomIn) zoomIn.addEventListener('click', () => this.zoom(1.25));
      if (zoomOut) zoomOut.addEventListener('click', () => this.zoom(0.8));

      // Pan & Zoom on Viewport
      const viewport = document.getElementById('task-tree-viewport');
      if (viewport) {
        viewport.addEventListener('mousedown', (e) => {
          if (e.target.closest('.task-tree-node-task') || e.target.closest('button')) return;
          this.isPanning = true;
          viewport.classList.add('is-panning');
          this.startX = e.clientX - this.tx;
          this.startY = e.clientY - this.ty;
        });

        window.addEventListener('mousemove', (e) => {
          if (!this.isPanning) return;
          this.tx = e.clientX - this.startX;
          this.ty = e.clientY - this.startY;
          this.scheduleRender();
        });

        window.addEventListener('mouseup', () => {
          if (this.isPanning) {
            this.isPanning = false;
            viewport.classList.remove('is-panning');
            this.scheduleRender();
          }
        });

        // Wheel Zoom centered on cursor
        viewport.addEventListener('wheel', (e) => {
          e.preventDefault();
          const zoomFactor = e.deltaY < 0 ? 1.15 : 0.87;
          const rect = viewport.getBoundingClientRect();
          const mouseX = e.clientX - rect.left;
          const mouseY = e.clientY - rect.top;

          const newScale = Math.min(Math.max(this.scale * zoomFactor, 0.12), 2.0);
          this.tx = mouseX - (mouseX - this.tx) * (newScale / this.scale);
          this.ty = mouseY - (mouseY - this.ty) * (newScale / this.scale);
          this.scale = newScale;
          this.scheduleRender();
        }, { passive: false });
      }
    }

    zoom(factor) {
      const vw = this.viewW || 1200;
      const vh = this.viewH || 800;
      const cx = vw / 2;
      const cy = vh / 2;
      const newScale = Math.min(Math.max(this.scale * factor, 0.12), 2.0);
      this.tx = cx - (cx - this.tx) * (newScale / this.scale);
      this.ty = cy - (cy - this.ty) * (newScale / this.scale);
      this.scale = newScale;
      this.scheduleRender();
    }

    scheduleRender() {
      if (this.rafId) return;
      this.rafId = requestAnimationFrame(() => {
        this.rafId = null;
        this.applyTransform();
        this.drawCanvasEdges();
        this.cullNodes();
      });
    }

    applyTransform() {
      const world = document.getElementById('task-tree-world');
      if (world) {
        world.style.transform = `translate3d(${this.tx}px, ${this.ty}px, 0) scale(${this.scale})`;
      }
    }

    drawCanvasEdges() {
      if (!this.ctx || !this.canvas) return;

      const ctx = this.ctx;
      const w = this.canvas.width;
      const h = this.canvas.height;
      ctx.clearRect(0, 0, w, h);

      ctx.save();
      ctx.scale(this.dpr, this.dpr);
      ctx.translate(this.tx, this.ty);
      ctx.scale(this.scale, this.scale);

      // Visible Bounding Box in World Coordinates
      const margin = 200;
      const vx1 = (-this.tx) / this.scale - margin;
      const vy1 = (-this.ty) / this.scale - margin;
      const vx2 = (this.viewW - this.tx) / this.scale + margin;
      const vy2 = (this.viewH - this.ty) / this.scale + margin;

      // Group paths by stroke style for single-draw-call performance
      const pathsCompleted = [];
      const pathsActive = [];
      const pathsLocked = [];

      const currentFilter = this.filterTrader;

      for (let i = 0; i < this.precomputedEdges.length; i++) {
        const edge = this.precomputedEdges[i];

        // Viewport culling for edge
        if (edge.maxX < vx1 || edge.minX > vx2 || edge.maxY < vy1 || edge.minY > vy2) {
          continue;
        }

        // Trader filter culling
        if (currentFilter !== 'all') {
          const fromTask = this.tasksMap.get(edge.fromId);
          const toTask = this.tasksMap.get(edge.toId);
          if ((fromTask && fromTask.trader !== currentFilter) && (toTask && toTask.trader !== currentFilter)) {
            continue;
          }
        }

        const fromDone = this.isTaskCompleted(edge.fromId);
        const toDone = this.isTaskCompleted(edge.toId);

        if (fromDone && toDone) {
          pathsCompleted.push(edge);
        } else if (fromDone && !toDone) {
          pathsActive.push(edge);
        } else {
          pathsLocked.push(edge);
        }
      }

      // 1. Draw Locked Paths (Dark Charcoal Gray)
      if (pathsLocked.length > 0) {
        ctx.beginPath();
        ctx.strokeStyle = '#272a2e';
        ctx.lineWidth = 1.8;
        for (let i = 0; i < pathsLocked.length; i++) {
          const e = pathsLocked[i];
          ctx.moveTo(e.x1, e.y1);
          ctx.lineTo(e.x1, e.my);
          ctx.lineTo(e.x2, e.my);
          ctx.lineTo(e.x2, e.y2);
        }
        ctx.stroke();
      }

      // 2. Draw Active/Available Paths (Warm Amber Gold)
      if (pathsActive.length > 0) {
        ctx.beginPath();
        ctx.strokeStyle = '#d97706';
        ctx.lineWidth = 2.4;
        for (let i = 0; i < pathsActive.length; i++) {
          const e = pathsActive[i];
          ctx.moveTo(e.x1, e.y1);
          ctx.lineTo(e.x1, e.my);
          ctx.lineTo(e.x2, e.my);
          ctx.lineTo(e.x2, e.y2);
        }
        ctx.stroke();
      }

      // 3. Draw Completed Paths (Emerald Green)
      if (pathsCompleted.length > 0) {
        ctx.beginPath();
        ctx.strokeStyle = '#10b981';
        ctx.lineWidth = 2.0;
        for (let i = 0; i < pathsCompleted.length; i++) {
          const e = pathsCompleted[i];
          ctx.moveTo(e.x1, e.y1);
          ctx.lineTo(e.x1, e.my);
          ctx.lineTo(e.x2, e.my);
          ctx.lineTo(e.x2, e.y2);
        }
        ctx.stroke();
      }

      ctx.restore();
    }

    cullNodes() {
      // Visible World Coordinates Bounding Box
      const margin = 350;
      const vx1 = (-this.tx) / this.scale - margin;
      const vy1 = (-this.ty) / this.scale - margin;
      const vx2 = (this.viewW - this.tx) / this.scale + margin;
      const vy2 = (this.viewH - this.ty) / this.scale + margin;

      const currentTrader = this.filterTrader;
      const currentStatus = this.filterStatus;

      // 1. Cull Task Nodes
      for (let i = 0; i < this.tasks.length; i++) {
        const task = this.tasks[i];
        const el = this.nodeElements.get(task.id);
        if (!el) continue;

        // Trader Filter
        if (currentTrader !== 'all' && task.trader !== currentTrader) {
          el.classList.add('is-filtered-out');
          continue;
        } else {
          el.classList.remove('is-filtered-out');
        }

        // Status Filter
        if (currentStatus !== 'all') {
          const isDone = this.isTaskCompleted(task.id);
          const isAvail = this.isTaskAvailable(task.id);
          if (currentStatus === 'available' && !isAvail) {
            el.classList.add('is-filtered-out');
            continue;
          }
          if (currentStatus === 'completed' && !isDone) {
            el.classList.add('is-filtered-out');
            continue;
          }
          if (currentStatus === 'locked' && (isDone || isAvail)) {
            el.classList.add('is-filtered-out');
            continue;
          }
        }

        // Viewport Intersection Check
        const x = task.base_x;
        const y = task.base_y;
        const isOffscreen = (x + 260 < vx1 || x > vx2 || y + 180 < vy1 || y > vy2);

        el.classList.toggle('is-culled', isOffscreen);
      }

      // 2. Cull Section Nodes
      for (let i = 0; i < this.sectionsList.length; i++) {
        const s = this.sectionsList[i];
        const el = this.sectionElements.get(s.key);
        if (!el) continue;
        const isOffscreen = (s.x + 150 < vx1 || s.x > vx2 || s.y + 40 < vy1 || s.y > vy2);
        el.classList.toggle('is-culled', isOffscreen);
      }

      // 3. Cull Trader Nodes
      for (let i = 0; i < this.tradersList.length; i++) {
        const tr = this.tradersList[i];
        const el = this.traderElements.get(tr.key);
        if (!el) continue;
        const isOffscreen = (tr.x + 200 < vx1 || tr.x > vx2 || tr.y + 70 < vy1 || tr.y > vy2);
        el.classList.toggle('is-culled', isOffscreen);
      }
    }

    applyTraderFilterToTree(traderName) {
      if (traderName === 'all') {
        this.scheduleRender();
        return;
      }

      // Find first task or trader node of this trader to jump to
      const trader = this.tradersList.find(t => t.name.includes(traderName) || t.name === traderName);
      if (trader) {
        this.focusCoordinates(trader.x, trader.y + 150);
      } else {
        const task = this.tasks.find(t => t.trader === traderName);
        if (task) {
          this.focusCoordinates(task.base_x, task.base_y);
        }
      }
    }

    highlightSearchTree(query) {
      if (!query) {
        document.querySelectorAll('.task-tree-node-task').forEach(n => n.classList.remove('is-highlighted'));
        this.scheduleRender();
        return;
      }

      let firstMatch = null;
      for (let i = 0; i < this.tasks.length; i++) {
        const task = this.tasks[i];
        const el = this.nodeElements.get(task.id);
        const match = (task.title || '').toLowerCase().includes(query);

        if (el) {
          el.classList.toggle('is-highlighted', match);
        }
        if (match && !firstMatch) {
          firstMatch = task;
        }
      }

      if (firstMatch) {
        this.focusCoordinates(firstMatch.base_x, firstMatch.base_y);
      }
    }

    focusCoordinates(x, y) {
      const vw = this.viewW || 1200;
      const vh = this.viewH || 800;
      this.scale = 0.65;
      this.tx = vw / 2 - (x + 130) * this.scale;
      this.ty = vh / 2 - (y + 80) * this.scale;
      this.scheduleRender();
    }

    render() {
      const treeView = document.getElementById('task-tree-shell');
      const listView = document.getElementById('task-list-view');

      if (this.subview === 'tree') {
        if (treeView) treeView.style.display = 'block';
        if (listView) listView.style.display = 'none';
        this.renderTree();
      } else {
        if (treeView) treeView.style.display = 'none';
        if (listView) listView.style.display = 'block';
        this.renderList();
      }
      this.updateStats();
    }

    renderTree() {
      const world = document.getElementById('task-tree-world');
      if (!world) return;

      this.resizeCanvas();

      if (!this.treeBuilt) {
        this.buildTreeDOM(world);
        this.buildTraderJumpBar();
        this.treeBuilt = true;
      }

      this.updateViewNodes();
      this.scheduleRender();
    }

    buildTraderJumpBar() {
      const bar = document.getElementById('task-tree-trader-jump');
      if (!bar) return;
      bar.innerHTML = '';

      this.tradersList.forEach(trader => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'trader-jump-btn';
        const displayName = trader.name.split(' ')[0];
        btn.innerHTML = `<img src="${trader.avatar}" onerror="this.style.display='none'"><span>${displayName}</span>`;
        btn.title = trader.name;
        btn.addEventListener('click', () => {
          this.focusCoordinates(trader.x, trader.y + 150);
        });
        bar.appendChild(btn);
      });
    }

    buildTreeDOM(world) {
      world.innerHTML = '';
      this.nodeElements.clear();
      this.sectionElements.clear();
      this.traderElements.clear();

      const frag = document.createDocumentFragment();

      // 1. Trader Header Nodes
      this.tradersList.forEach(trader => {
        const el = document.createElement('div');
        el.className = 'task-tree-node task-tree-node-trader';
        el.style.left = `${trader.x}px`;
        el.style.top = `${trader.y}px`;
        el.innerHTML = `
          <img src="${trader.avatar}" alt="${trader.name}" onerror="this.style.display='none'">
          <strong>${trader.name}</strong>
        `;
        frag.appendChild(el);
        this.traderElements.set(trader.key, el);
      });

      // 2. Section Nodes (LL1, LL2, Core)
      this.sectionsList.forEach(sec => {
        const el = document.createElement('div');
        el.className = 'task-tree-node task-tree-node-section';
        el.style.left = `${sec.x}px`;
        el.style.top = `${sec.y}px`;
        el.innerHTML = `<span>${sec.label}</span>`;
        frag.appendChild(el);
        this.sectionElements.set(sec.key, el);
      });

      // 3. Task Nodes (602 cards)
      this.tasks.forEach(task => {
        const el = document.createElement('div');
        el.className = 'task-tree-node task-tree-node-task';
        el.id = `tree-node-${task.id}`;
        el.dataset.taskId = task.id;
        el.dataset.title = task.title;
        el.style.left = `${task.base_x}px`;
        el.style.top = `${task.base_y}px`;
        el.style.width = '260px';

        const objectivesHtml = (task.objectives || [])
          .map((obj, idx) => `<div class="task-tree-objective" data-obj-idx="${idx}">${obj}</div>`)
          .join('');

        const mapBtnHtml = '';

        el.innerHTML = `
          <div class="task-tree-card-top">
            <strong class="task-tree-title" title="${task.title}">${task.title}</strong>
            <div class="task-tree-meta">
              ${task.is_kappa ? '<span class="task-tree-kappa-tag" title="3x4 Kappa必需任务">🏆 Kappa</span>' : ''}
              <span class="task-tree-level">${task.level || 'Lv.1'}</span>
              <img class="task-tree-trader-avatar" src="${task.trader_avatar}" alt="${task.trader}" onerror="this.style.display='none'">
            </div>
          </div>
          <div class="task-tree-objectives">${objectivesHtml}</div>
          <div class="task-tree-card-footer">
            <button type="button" class="task-tree-complete-btn" data-complete-btn="${task.id}">标记完成</button>
            
          </div>
        `;

        frag.appendChild(el);
        this.nodeElements.set(task.id, el);
      });

      world.appendChild(frag);

      // Event delegation for complete & map button clicks
      world.addEventListener('click', (e) => {
        const btn = e.target.closest('[data-complete-btn]');
        if (btn) {
          e.stopPropagation();
          this.toggleTaskCompleted(btn.dataset.completeBtn);
          return;
        }

        const mapBtn = e.target.closest('[data-task-map-btn]');
        if (mapBtn) {
          e.stopPropagation();
          const tid = mapBtn.dataset.taskMapBtn;
          const links = this.taskMapLinks[tid];
          if (links && links.length > 0) {
            const first = links[0];
            if (window.app && window.app.switchTab) {
              window.app.switchTab('view-map');
              if (window.app.mapViewer) {
                window.app.mapViewer.focusMarker(first.mapId, first.floor, first.markerId, first.x, first.y);
              }
            }
          }
        }
      });
    }

    selectTask(taskId) {
      const task = this.tasks.find(t => String(t.id) === String(taskId));
      if (!task) return;

      if (this.subview !== 'tree') {
        this.subview = 'tree';
        const pills = document.querySelectorAll('[data-task-subview]');
        pills.forEach(p => p.classList.toggle('is-active', p.dataset.taskSubview === 'tree'));
        this.render();
      }

      this.focusCoordinates(task.base_x, task.base_y);

      setTimeout(() => {
        const node = this.nodeElements.get(String(taskId));
        if (node) {
          node.classList.add('is-target-focused');
          setTimeout(() => node.classList.remove('is-target-focused'), 3500);
        }
      }, 150);
    }

    updateViewNodes() {
      for (let i = 0; i < this.tasks.length; i++) {
        const task = this.tasks[i];
        const node = this.nodeElements.get(task.id);
        if (!node) continue;

        const isDone = this.isTaskCompleted(task.id);
        const isAvail = this.isTaskAvailable(task.id);

        node.classList.toggle('is-completed', isDone);
        node.classList.toggle('is-available', isAvail);
        node.classList.toggle('is-locked', !isDone && !isAvail);

        const btn = node.querySelector('.task-tree-complete-btn');
        if (btn) {
          btn.textContent = isDone ? '✔ 已完成 (撤销)' : '标记完成';
        }
      }

      if (this.subview === 'list') {
        this.renderList();
      }

      this.updateStats();
    }

    renderList() {
      const container = document.getElementById('task-list-grid');
      if (!container) return;

      const filtered = this.tasks.filter(t => {
        if (this.filterTrader !== 'all' && t.trader !== this.filterTrader) return false;

        const isDone = this.isTaskCompleted(t.id);
        const isAvail = this.isTaskAvailable(t.id);

        if (this.filterStatus === 'available' && !isAvail) return false;
        if (this.filterStatus === 'completed' && !isDone) return false;
        if (this.filterStatus === 'locked' && (isDone || isAvail)) return false;

        if (this.searchQuery) {
          const matchTitle = (t.title || '').toLowerCase().includes(this.searchQuery);
          const matchObj = (t.objectives || []).some(o => o.toLowerCase().includes(this.searchQuery));
          if (!matchTitle && !matchObj) return false;
        }

        return true;
      });

      if (filtered.length === 0) {
        container.innerHTML = `<div style="grid-column: 1/-1; text-align:center; padding:40px; color:var(--text-muted);">
          未找到符合筛选条件的任务
        </div>`;
        return;
      }

      container.innerHTML = filtered.map(t => {
        const isDone = this.isTaskCompleted(t.id);
        const isAvail = this.isTaskAvailable(t.id);
        const objProgress = this.progress.objectives[t.id] || {};

        const objectivesHtml = (t.objectives || []).map((obj, idx) => {
          const checked = isDone || !!objProgress[idx];
          return `
            <label class="objective-item ${checked ? 'is-done' : ''}">
              <input type="checkbox" data-task-id="${t.id}" data-obj-idx="${idx}" ${checked ? 'checked' : ''}>
              <span>${obj}</span>
            </label>
          `;
        }).join('');

        const mapBtnHtml = '';

        return `
          <div class="task-card ${isDone ? 'is-completed' : ''}" id="list-card-${t.id}">
            <div class="task-card-header">
              <div class="task-card-trader">
                <img src="${t.trader_avatar}" alt="${t.trader}" onerror="this.style.display='none'">
                <div class="task-card-title-wrap">
                  <h3>${t.title}</h3>
                  <div class="task-card-badges">
                    <span class="badge-tag badge-level">${t.level || 'Lv.1'}</span>
                    <span class="badge-tag" style="background:#1f2327;color:var(--text-muted);">${t.trader}</span>
                    ${t.is_kappa ? '<span class="badge-tag badge-kappa">3x4 Kappa必需</span>' : ''}
                  </div>
                </div>
              </div>
              <span class="badge-tag" style="background:${isDone ? 'rgba(16,185,129,0.2)' : isAvail ? 'rgba(217,119,6,0.2)' : '#272a2e'}; color:${isDone ? '#10b981' : isAvail ? '#f59e0b' : '#8b929c'};">
                ${isDone ? '已完成' : isAvail ? '可接取' : '前置锁定'}
              </span>
            </div>

            <div class="task-card-objectives">${objectivesHtml}</div>

            <div class="task-card-actions">
              <div style="display:flex;align-items:center;gap:8px;">
                <span style="font-size:12px;color:var(--text-muted);">
                  ${t.objectives ? `${Object.keys(objProgress).filter(k => objProgress[k]).length} / ${t.objectives.length} 目标` : ''}
                </span>
                
              </div>
              <button type="button" class="btn-toggle-task" data-list-toggle="${t.id}">
                ${isDone ? '✔ 取消完成' : '一键完成任务'}
              </button>
            </div>
          </div>
        `;
      }).join('');

      // Bind card interactions
      container.querySelectorAll('[data-list-toggle]').forEach(btn => {
        btn.addEventListener('click', () => {
          this.toggleTaskCompleted(btn.dataset.listToggle);
        });
      });

      container.querySelectorAll('[data-list-map]').forEach(btn => {
        btn.addEventListener('click', () => {
          const tid = btn.dataset.listMap;
          const links = this.taskMapLinks[tid];
          if (links && links.length > 0) {
            const first = links[0];
            if (window.app && window.app.switchTab) {
              window.app.switchTab('view-map');
              if (window.app.mapViewer) {
                window.app.mapViewer.focusMarker(first.mapId, first.floor, first.markerId, first.x, first.y);
              }
            }
          }
        });
      });

      container.querySelectorAll('input[data-obj-idx]').forEach(chk => {
        chk.addEventListener('change', () => {
          this.toggleObjective(chk.dataset.taskId, parseInt(chk.dataset.objIdx, 10));
        });
      });
    }

    updateStats() {
      const completedCount = Object.keys(this.progress.completed).filter(k => this.progress.completed[k]).length;
      const totalCount = this.tasks.length || 602;
      const percent = totalCount > 0 ? ((completedCount / totalCount) * 100).toFixed(1) : '0.0';

      const label = document.getElementById('task-progress-label');
      const fill = document.getElementById('task-progress-fill');
      if (label) {
        label.textContent = `任务完成进度: ${completedCount} / ${totalCount} (${percent}%)`;
      }
      if (fill) {
        fill.style.width = `${percent}%`;
      }
    }
  }

  window.TaskViewer = TaskViewer;
})();
