# 逃离塔科夫 离线战术助手 (TarkovOffline)

专为《逃离塔科夫》玩家打造的轻量级离线网页与本地战术辅助工具，支持 **GitHub Pages 纯静态托管**、**PWA 桌面端安装**、**Google Drive 零后端云端同步** 以及 **本地安全 OCR 截图识别**。

---

## 🌟 核心功能

1. **🌳 任务管理 (DAG 拓扑树 + 全列表)**
   - 收录 602 个任务与 347 条前置依赖连线，采用高性能 Canvas 2D + 视口裁剪渲染。
   - 支持 PvP / PvE 与阵营过滤、商人快捷定位、Kappa 必需标记、分支子目标独立勾选与前置自动解锁联动。
2. **🏠 藏身处升级计算器 (Hideout Planner)**
   - 覆盖 26 个设施（Lv.0 至满级），前置依赖自检、卢布/美元/欧元资金统计、材料收集步进器。
   - 支持一键汇总所有剩余未满级所需材料与用途跳转。
3. **📦 战局必留物品速查 (FIR Collection Tracker)**
   - 收录 282 种任务、藏身处与 Collector 所需核心物品。
   - 与任务完成状态和藏身处升级进度**实时联动动态扣减**剩余所需数量，快速区分「🔥 战局带出 (FIR)」与「✔ 可跳蚤购买」。
4. **☁️ 跨设备云同步与本地备份 (零自建后端)**
   - **本地 JSON 导入导出**：随时导出/导入完整进度备份文件，完全离线保存于浏览器 `localStorage`。
   - **Google Drive 直连同步**：通过浏览器端 Google Identity Services + Drive API v3（仅申请 `drive.file` 最小权限）直接将存档同步至您自己的 Google Drive，无需任何自建后端数据库。
5. **📸 本地安全 OCR 识图取数（本地运行模式专享）**
   - 仅在本地启动 `server.py` 时激活，基于 RapidOCR 本地 CPU 推理（零网络传输、不读取游戏内存、不触碰 BattlEye 反作弊），支持游戏内截图后直接在网页按 `Ctrl+V` 识别任务与必留物并一键勾选进度。

---

## 🚀 使用方式

### 方式一：部署到 GitHub Pages（纯静态免维护，推荐）
1. 将本仓库代码推送到你的 GitHub（仓库设为 Public）。
2. 将 `public/` 子目录发布到 `gh-pages` 分支：
   ```bash
   git subtree push --prefix public origin gh-pages
   ```
3. 在仓库 **Settings -> Pages -> Build and deployment** 中，选择 `Deploy from a branch`，分支选 **`gh-pages` / `(root)`** 保存即可自动上线。
4. 打开你的 GitHub Pages 网址，在 **「💾 进度与备份」** 中配置你自己的 Google OAuth Client ID，即可在电脑、平板、手机之间通过 Google Drive 免费同步进度。
   > 注：纯静态托管模式下不包含后端 OCR 识图（`📸 识图取数` 需配合本地 Python 服务使用）。

### 方式二：本地完整运行（支持 OCR 截图识图）
确保已安装 Python 3.10+（如需本地 OCR 识图需安装 `pillow`、`numpy`、`rapidocr_onnxruntime`）：

```bash
# 1. 安装依赖（仅本地 OCR 需要）
pip install pillow numpy rapidocr_onnxruntime

# 2. 启动本地服务
py server.py
```

随后在浏览器访问：`http://localhost:8080`

（可选）在游戏内使用本地截屏速查伴侣：
```bash
py scripts/screen_hotkey_scanner.py
```

---

## 📁 目录结构

```text
TarkovOffline/
├── public/                             # 纯静态前端站点（约 7.5 MB，可发布至 gh-pages）
│   ├── css/                            # 暗黑战术主题样式
│   ├── data/                           # 任务、藏身处、留物预置 JSON 数据库
│   ├── js/                             # 任务拓扑、藏身处、留物、云同步与搜索模块
│   ├── uploads/                        # 离线图标素材
│   ├── index.html                      # 应用主入口
│   ├── manifest.json                   # PWA 清单
│   └── sw.js                           # Service Worker 离线缓存
├── scripts/
│   ├── scanner_engine.py               # RapidOCR 本地识别与模糊匹配引擎
│   ├── screen_hotkey_scanner.py        # 游戏内截屏伴侣脚本
│   └── sync_tarkov_dev.py              # tarkov.dev GraphQL 同步与拓扑自动布局生成器
├── server.py                           # 本地静态托管 + OCR API 服务
├── LICENSE                             # MIT License
└── README.md
```

---

## 🙏 数据来源与版权声明

- 本项目源码以 **MIT License** 开源发布，仅作玩家社区学习与非商业辅助用途。
- 游戏机制数据同步脚本对接开源社区 API **[tarkov.dev](https://tarkov.dev/)**（`the-hideout/tarkov-api`）。
- 《Escape from Tarkov》（逃离塔科夫）相关的游戏名称、商人、任务文案与物品图标资源知识产权均归 **Battlestate Games** 所有。
