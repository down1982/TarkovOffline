/**
 * Escape from Tarkov Tactical Offline Assistant
 * Pure Client-Side Google Drive Cloud Sync (GIS OAuth2 + Drive API v3)
 * Zero backend required — works on localhost and static cloud hosting.
 */
(function () {
  'use strict';

  const CLIENT_ID_KEY = 'tarkov_offline_gdrive_client_id';
  const DEFAULT_CLIENT_ID = '';
  const AUTOSYNC_KEY = 'tarkov_offline_gdrive_autosync';
  const SESSION_TOKEN_KEY = 'tarkov_offline_gdrive_token';
  const SAVE_FILENAME = 'tarkov_offline_tactical_save.json';
  const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';

  class GDriveSync {
    constructor() {
      this.clientId = localStorage.getItem(CLIENT_ID_KEY) || DEFAULT_CLIENT_ID;
      this.autoSync = localStorage.getItem(AUTOSYNC_KEY) === 'true';
      this.accessToken = null;
      this.tokenExpiresAt = 0;
      this.tokenClient = null;
      this.gisLoaded = false;
      this.gisLoadingPromise = null;
      this.remoteFile = null;
      this.syncTimer = null;
      this.isBusy = false;

      this.restoreSessionToken();
      this.cacheDOM();
      this.bindEvents();
      this.renderState();

      if (this.accessToken) {
        this.refreshRemoteMeta({ silent: true });
      }
    }

    cacheDOM() {
      this.clientIdInput = document.getElementById('gdrive-client-id-input');
      this.saveClientIdBtn = document.getElementById('gdrive-save-client-btn');
      this.connectBtn = document.getElementById('gdrive-connect-btn');
      this.disconnectBtn = document.getElementById('gdrive-disconnect-btn');
      this.pushBtn = document.getElementById('gdrive-push-btn');
      this.pullBtn = document.getElementById('gdrive-pull-btn');
      this.autoSyncCheckbox = document.getElementById('gdrive-autosync-toggle');
      this.statusBadge = document.getElementById('gdrive-status-badge');
      this.statusText = document.getElementById('gdrive-status-text');
      this.remoteMetaEl = document.getElementById('gdrive-remote-meta');
      this.originHintEl = document.getElementById('gdrive-origin-hint');
      this.copyOriginBtn = document.getElementById('gdrive-copy-origin-btn');
    }

    restoreSessionToken() {
      try {
        const raw = sessionStorage.getItem(SESSION_TOKEN_KEY);
        if (!raw) return;
        const parsed = JSON.parse(raw);
        if (parsed.token && parsed.expiresAt && Date.now() < parsed.expiresAt - 60000) {
          this.accessToken = parsed.token;
          this.tokenExpiresAt = parsed.expiresAt;
        } else {
          sessionStorage.removeItem(SESSION_TOKEN_KEY);
        }
      } catch (_) {
        sessionStorage.removeItem(SESSION_TOKEN_KEY);
      }
    }

    saveSessionToken(token, expiresInSec) {
      const expiresAt = Date.now() + (Number(expiresInSec) || 3600) * 1000;
      this.accessToken = token;
      this.tokenExpiresAt = expiresAt;
      try {
        sessionStorage.setItem(SESSION_TOKEN_KEY, JSON.stringify({ token, expiresAt }));
      } catch (_) {}
    }

    clearSessionToken() {
      this.accessToken = null;
      this.tokenExpiresAt = 0;
      this.remoteFile = null;
      sessionStorage.removeItem(SESSION_TOKEN_KEY);
    }

    bindEvents() {
      if (this.clientIdInput) {
        this.clientIdInput.value = this.clientId;
      }
      if (this.originHintEl) {
        this.originHintEl.textContent = window.location.origin;
      }
      if (this.copyOriginBtn) {
        this.copyOriginBtn.addEventListener('click', () => {
          navigator.clipboard?.writeText(window.location.origin).then(() => {
            this.setStatus(`已复制当前来源地址: ${window.location.origin}`, '#10b981');
          }).catch(() => {});
        });
      }

      if (this.saveClientIdBtn) {
        this.saveClientIdBtn.addEventListener('click', () => {
          const val = (this.clientIdInput?.value || '').trim();
          if (val) {
            this.clientId = val;
            localStorage.setItem(CLIENT_ID_KEY, val);
            this.tokenClient = null;
            this.setStatus('Client ID 已保存至本地浏览器，点击「授权连接 Google Drive」即可开始同步。', '#10b981');
          } else {
            localStorage.removeItem(CLIENT_ID_KEY);
            this.clientId = DEFAULT_CLIENT_ID;
            if (this.clientIdInput) this.clientIdInput.value = DEFAULT_CLIENT_ID;
            this.tokenClient = null;
            this.clearSessionToken();
            this.setStatus(
              DEFAULT_CLIENT_ID ? '已恢复内置默认 Client ID，点击「授权连接 Google Drive」即可同步。' : '已清空 Client ID。',
              '#f59e0b'
            );
          }
          this.renderState();
        });
      }

      if (this.connectBtn) {
        this.connectBtn.addEventListener('click', () => this.connect());
      }
      if (this.disconnectBtn) {
        this.disconnectBtn.addEventListener('click', () => this.disconnect());
      }
      if (this.pushBtn) {
        this.pushBtn.addEventListener('click', () => this.pushToDrive({ silent: false }));
      }
      if (this.pullBtn) {
        this.pullBtn.addEventListener('click', () => this.pullFromDrive());
      }

      if (this.autoSyncCheckbox) {
        this.autoSyncCheckbox.checked = this.autoSync;
        this.autoSyncCheckbox.addEventListener('change', (e) => {
          this.autoSync = !!e.target.checked;
          localStorage.setItem(AUTOSYNC_KEY, this.autoSync ? 'true' : 'false');
          this.setStatus(
            this.autoSync
              ? '已开启自动云同步：每次修改任务/藏身处/留物进度后 3 秒自动备份到 Google Drive。'
              : '已关闭自动云同步，你仍可随时手动点击上传/拉取。',
            '#f59e0b'
          );
        });
      }

      // Listen for local progress changes to trigger debounced auto-sync
      window.addEventListener('tarkov:progress-changed', (e) => {
        if (e.detail && e.detail.source === 'gdrive-pull') return;
        if (!this.autoSync || !this.isConnected()) return;

        clearTimeout(this.syncTimer);
        this.syncTimer = setTimeout(() => {
          this.pushToDrive({ silent: true });
        }, 3000);
      });
    }

    isConnected() {
      return !!(this.accessToken && Date.now() < this.tokenExpiresAt - 15000);
    }

    setStatus(msg, color = '#10b981') {
      if (this.statusText) {
        this.statusText.textContent = msg;
        this.statusText.style.color = color;
      }
    }

    renderState() {
      const connected = this.isConnected();
      const hasClientId = !!this.clientId;

      if (this.statusBadge) {
        if (connected) {
          this.statusBadge.textContent = '已连接 Google Drive';
          this.statusBadge.style.background = 'rgba(16, 185, 129, 0.16)';
          this.statusBadge.style.color = '#10b981';
          this.statusBadge.style.borderColor = 'rgba(16, 185, 129, 0.4)';
        } else if (hasClientId) {
          this.statusBadge.textContent = '待授权登录';
          this.statusBadge.style.background = 'rgba(245, 158, 11, 0.16)';
          this.statusBadge.style.color = '#f59e0b';
          this.statusBadge.style.borderColor = 'rgba(245, 158, 11, 0.4)';
        } else {
          this.statusBadge.textContent = '未配置 Client ID';
          this.statusBadge.style.background = 'rgba(156, 163, 175, 0.14)';
          this.statusBadge.style.color = '#9ca3af';
          this.statusBadge.style.borderColor = 'rgba(156, 163, 175, 0.3)';
        }
      }

      if (this.connectBtn) this.connectBtn.style.display = connected ? 'none' : 'inline-flex';
      if (this.disconnectBtn) this.disconnectBtn.style.display = connected ? 'inline-flex' : 'none';
      if (this.pushBtn) this.pushBtn.disabled = !connected || this.isBusy;
      if (this.pullBtn) this.pullBtn.disabled = !connected || this.isBusy;
      if (this.autoSyncCheckbox) this.autoSyncCheckbox.disabled = !connected;

      if (this.remoteMetaEl) {
        if (!connected) {
          this.remoteMetaEl.textContent = '连接后将自动检测云端存档 tarkov_offline_tactical_save.json 状态。';
        } else if (this.remoteFile) {
          const dt = new Date(this.remoteFile.modifiedTime).toLocaleString();
          const kb = ((Number(this.remoteFile.size) || 0) / 1024).toFixed(1);
          this.remoteMetaEl.textContent = `☁️ 云端存档已就绪 (${SAVE_FILENAME} · ${kb} KB · 最近更新: ${dt})`;
        } else {
          this.remoteMetaEl.textContent = `☁️ 云端尚无存档文件 (${SAVE_FILENAME})，点击「上传备份到云端」即可创建。`;
        }
      }
    }

    loadGISScript() {
      if (window.google && window.google.accounts && window.google.accounts.oauth2) {
        this.gisLoaded = true;
        return Promise.resolve();
      }
      if (this.gisLoadingPromise) return this.gisLoadingPromise;

      this.gisLoadingPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = 'https://accounts.google.com/gsi/client';
        script.async = true;
        script.defer = true;
        script.onload = () => {
          this.gisLoaded = true;
          resolve();
        };
        script.onerror = () => {
          this.gisLoadingPromise = null;
          reject(new Error('无法加载 Google 登录脚本 (https://accounts.google.com/gsi/client)，请检查网络连接或代理。'));
        };
        document.head.appendChild(script);
      });
      return this.gisLoadingPromise;
    }

    async connect() {
      if (!this.clientId) {
        const typed = (this.clientIdInput?.value || '').trim();
        if (typed) {
          this.clientId = typed;
          localStorage.setItem(CLIENT_ID_KEY, typed);
        } else {
          this.setStatus('请先填写并保存你的 Google OAuth Client ID（可展开下方 2 分钟配置指引获取）。', '#ef4444');
          return;
        }
      }

      this.setStatus('正在加载 Google 授权组件...', '#f59e0b');
      try {
        await this.loadGISScript();
        if (!this.tokenClient) {
          this.tokenClient = window.google.accounts.oauth2.initTokenClient({
            client_id: this.clientId,
            scope: DRIVE_SCOPE,
            callback: async (resp) => {
              if (resp.error) {
                this.setStatus(`Google 授权失败: ${resp.error_description || resp.error}`, '#ef4444');
                return;
              }
              this.saveSessionToken(resp.access_token, resp.expires_in);
              this.setStatus('Google Drive 授权成功！正在检查云端存档...', '#10b981');
              this.renderState();
              await this.refreshRemoteMeta({ silent: false });
            }
          });
        }
        this.tokenClient.requestAccessToken({ prompt: 'consent' });
      } catch (err) {
        this.setStatus(err.message, '#ef4444');
      }
    }

    disconnect() {
      const token = this.accessToken;
      this.clearSessionToken();
      if (token && window.google?.accounts?.oauth2?.revoke) {
        try {
          window.google.accounts.oauth2.revoke(token, () => {});
        } catch (_) {}
      }
      this.setStatus('已断开与 Google Drive 的连接（本地战术进度不受影响）。', '#9ca3af');
      this.renderState();
    }

    async driveFetch(url, options = {}) {
      if (!this.isConnected()) {
        throw new Error('Google Drive 授权已过期或未连接，请重新点击「授权连接 Google Drive」。');
      }

      const headers = new Headers(options.headers || {});
      headers.set('Authorization', `Bearer ${this.accessToken}`);

      const res = await fetch(url, { ...options, headers });
      if (res.status === 401) {
        this.clearSessionToken();
        this.renderState();
        throw new Error('Google 登录凭证已过期，请重新点击「授权连接 Google Drive」。');
      }
      if (!res.ok) {
        const errText = await res.text().catch(() => res.statusText);
        throw new Error(`Google Drive API 错误 (${res.status}): ${errText.slice(0, 160)}`);
      }
      return res;
    }

    async refreshRemoteMeta({ silent = true } = {}) {
      try {
        const query = encodeURIComponent(`name='${SAVE_FILENAME}' and trashed=false`);
        const url = `https://www.googleapis.com/drive/v3/files?q=${query}&spaces=drive&fields=files(id,name,modifiedTime,size)&orderBy=modifiedTime desc`;
        const res = await this.driveFetch(url);
        const data = await res.json();
        this.remoteFile = (data.files && data.files[0]) || null;
        this.renderState();
        if (!silent) {
          if (this.remoteFile) {
            this.setStatus('已检测到 Google Drive 云端存档，你可以选择「拉取覆盖本地」或「上传覆盖云端」。', '#10b981');
          } else {
            this.setStatus('已连接 Google Drive，云端暂未创建存档文件。', '#10b981');
          }
        }
      } catch (err) {
        if (!silent) this.setStatus(err.message, '#ef4444');
      }
    }

    async pushToDrive({ silent = false } = {}) {
      if (!window.app?.exportBackupData) {
        this.setStatus('备份模块尚未就绪。', '#ef4444');
        return;
      }

      this.isBusy = true;
      this.renderState();
      if (!silent) this.setStatus('正在上传本地战术进度至 Google Drive...', '#f59e0b');

      try {
        // Ensure we know whether file exists first
        if (!this.remoteFile) {
          await this.refreshRemoteMeta({ silent: true });
        }

        const payload = window.app.exportBackupData();
        const jsonBody = JSON.stringify(payload, null, 2);
        const metadata = {
          name: SAVE_FILENAME,
          mimeType: 'application/json'
        };

        const boundary = '-------tarkov_offline_sync_boundary_' + Date.now();
        const multipartBody =
          `--${boundary}\r\n` +
          `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
          `${JSON.stringify(metadata)}\r\n` +
          `--${boundary}\r\n` +
          `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
          `${jsonBody}\r\n` +
          `--${boundary}--`;

        let url = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,modifiedTime,size';
        let method = 'POST';
        if (this.remoteFile && this.remoteFile.id) {
          url = `https://www.googleapis.com/upload/drive/v3/files/${this.remoteFile.id}?uploadType=multipart&fields=id,name,modifiedTime,size`;
          method = 'PATCH';
        }

        const res = await this.driveFetch(url, {
          method,
          headers: {
            'Content-Type': `multipart/related; boundary=${boundary}`
          },
          body: multipartBody
        });

        this.remoteFile = await res.json();
        const nowStr = new Date().toLocaleTimeString();
        this.setStatus(`[☁️ 同步成功] 已保存至 Google Drive (${SAVE_FILENAME}) - ${nowStr}`, '#10b981');
      } catch (err) {
        this.setStatus(`上传失败: ${err.message}`, '#ef4444');
      } finally {
        this.isBusy = false;
        this.renderState();
      }
    }

    async pullFromDrive() {
      if (!window.app?.applyBackupData) {
        this.setStatus('恢复模块尚未就绪。', '#ef4444');
        return;
      }

      this.isBusy = true;
      this.renderState();
      this.setStatus('正在从 Google Drive 拉取云端存档...', '#f59e0b');

      try {
        await this.refreshRemoteMeta({ silent: true });
        if (!this.remoteFile || !this.remoteFile.id) {
          this.setStatus('Google Drive 中未找到 tarkov_offline_tactical_save.json 存档文件。', '#f59e0b');
          return;
        }

        const res = await this.driveFetch(`https://www.googleapis.com/drive/v3/files/${this.remoteFile.id}?alt=media`);
        const data = await res.json();

        window.app.applyBackupData(data, { source: 'gdrive-pull' });
        const dt = new Date(this.remoteFile.modifiedTime).toLocaleString();
        this.setStatus(`[⬇️ 恢复成功] 已从 Google Drive 同步恢复全部任务、藏身处与留物进度 (存档时间: ${dt})`, '#10b981');
      } catch (err) {
        this.setStatus(`拉取失败: ${err.message}`, '#ef4444');
      } finally {
        this.isBusy = false;
        this.renderState();
      }
    }
  }

  window.GDriveSync = GDriveSync;
})();
