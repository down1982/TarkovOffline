/**
 * Escape from Tarkov Tactical Offline Assistant
 * Custom Tactical Dropdown Component (Replaces native OS select popups)
 */
(function() {
  'use strict';

  class CustomSelect {
    constructor(selectEl) {
      if (!selectEl || selectEl._customSelect) return;
      this.select = selectEl;
      this.select._customSelect = this;
      this.isOpen = false;
      this.highlightedIndex = -1;

      this.buildDom();
      this.bindEvents();
    }

    buildDom() {
      // Hide native select element
      this.select.style.display = 'none';

      // Wrapper
      this.wrap = document.createElement('div');
      this.wrap.className = 'custom-select-wrap';
      if (this.select.id) {
        this.wrap.id = `custom-select-wrap-${this.select.id}`;
      }

      // Trigger Button
      const selectedOption = this.select.options[this.select.selectedIndex] || this.select.options[0];
      const initialText = selectedOption ? selectedOption.text : '请选择';

      this.trigger = document.createElement('button');
      this.trigger.type = 'button';
      this.trigger.className = 'custom-select-trigger';
      this.trigger.setAttribute('aria-haspopup', 'listbox');
      this.trigger.setAttribute('aria-expanded', 'false');

      this.valueSpan = document.createElement('span');
      this.valueSpan.className = 'custom-select-value';
      this.valueSpan.textContent = initialText;

      const arrowSpan = document.createElement('span');
      arrowSpan.className = 'custom-select-arrow';
      arrowSpan.textContent = '▼';

      this.trigger.appendChild(this.valueSpan);
      this.trigger.appendChild(arrowSpan);
      this.wrap.appendChild(this.trigger);

      // Dropdown Menu
      this.menu = document.createElement('div');
      this.menu.className = 'custom-select-menu';
      this.menu.setAttribute('role', 'listbox');

      this.rebuildOptions();
      this.wrap.appendChild(this.menu);

      // Insert wrap directly after the native select
      this.select.parentNode.insertBefore(this.wrap, this.select.nextSibling);
    }

    rebuildOptions() {
      this.menu.innerHTML = '';
      this.optionEls = [];

      Array.from(this.select.options).forEach((opt, idx) => {
        const item = document.createElement('div');
        item.className = 'custom-select-option';
        item.setAttribute('role', 'option');
        item.dataset.value = opt.value;
        item.dataset.index = idx;
        item.textContent = opt.text;

        if (opt.selected) {
          item.classList.add('is-selected');
        }

        item.addEventListener('click', (e) => {
          e.stopPropagation();
          this.selectOption(idx);
        });

        this.menu.appendChild(item);
        this.optionEls.push(item);
      });
    }

    bindEvents() {
      // Toggle menu on trigger click
      this.trigger.addEventListener('click', (e) => {
        e.stopPropagation();
        this.toggle();
      });

      // Close when clicking outside
      document.addEventListener('click', (e) => {
        if (!this.wrap.contains(e.target) && this.isOpen) {
          this.close();
        }
      });

      // Keyboard navigation
      this.trigger.addEventListener('keydown', (e) => {
        if (!this.isOpen) {
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            this.open();
          }
          return;
        }

        if (e.key === 'Escape') {
          e.preventDefault();
          this.close();
        } else if (e.key === 'ArrowDown') {
          e.preventDefault();
          this.moveHighlight(1);
        } else if (e.key === 'ArrowUp') {
          e.preventDefault();
          this.moveHighlight(-1);
        } else if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (this.highlightedIndex >= 0 && this.highlightedIndex < this.optionEls.length) {
            this.selectOption(this.highlightedIndex);
          }
        }
      });

      // Observe select changes from outside JS
      this.select.addEventListener('change', () => {
        this.syncFromSelect();
      });
    }

    open() {
      // Close all other custom selects first
      document.querySelectorAll('.custom-select-wrap.is-open').forEach(el => {
        if (el !== this.wrap) el.classList.remove('is-open');
      });

      this.isOpen = true;
      this.wrap.classList.add('is-open');
      this.trigger.setAttribute('aria-expanded', 'true');
      this.highlightedIndex = this.select.selectedIndex;
      this.updateHighlight();

      // Scroll selected item into view
      const selectedEl = this.optionEls[this.highlightedIndex];
      if (selectedEl) {
        selectedEl.scrollIntoView({ block: 'nearest' });
      }
    }

    close() {
      this.isOpen = false;
      this.wrap.classList.remove('is-open');
      this.trigger.setAttribute('aria-expanded', 'false');
    }

    toggle() {
      if (this.isOpen) {
        this.close();
      } else {
        this.open();
      }
    }

    selectOption(index) {
      if (index < 0 || index >= this.select.options.length) return;
      const opt = this.select.options[index];
      const prevVal = this.select.value;

      this.select.selectedIndex = index;
      this.valueSpan.textContent = opt.text;

      this.optionEls.forEach((el, idx) => {
        el.classList.toggle('is-selected', idx === index);
      });

      this.close();

      // Dispatch native change event so all app listeners execute smoothly
      if (prevVal !== opt.value) {
        this.select.dispatchEvent(new Event('change', { bubbles: true }));
      }
    }

    syncFromSelect() {
      const idx = this.select.selectedIndex;
      if (idx >= 0 && idx < this.select.options.length) {
        this.valueSpan.textContent = this.select.options[idx].text;
        this.optionEls.forEach((el, i) => {
          el.classList.toggle('is-selected', i === idx);
        });
      }
    }

    moveHighlight(delta) {
      if (this.optionEls.length === 0) return;
      let next = this.highlightedIndex + delta;
      if (next < 0) next = 0;
      if (next >= this.optionEls.length) next = this.optionEls.length - 1;
      this.highlightedIndex = next;
      this.updateHighlight();

      const el = this.optionEls[this.highlightedIndex];
      if (el) el.scrollIntoView({ block: 'nearest' });
    }

    updateHighlight() {
      this.optionEls.forEach((el, i) => {
        if (i === this.highlightedIndex) {
          el.style.background = 'rgba(245, 158, 11, 0.18)';
          el.style.color = '#f59e0b';
        } else {
          el.style.background = '';
          el.style.color = '';
        }
      });
    }
  }

  window.initCustomSelect = function(el) {
    if (typeof el === 'string') el = document.getElementById(el);
    if (el) return new CustomSelect(el);
  };

  window.initAllCustomSelects = function(container = document) {
    const selects = container.querySelectorAll('select.filter-select');
    selects.forEach(s => new CustomSelect(s));
  };
})();
