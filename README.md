# 词镜 WordLens

苹果风格（macOS/iPhone 质感）的英语学习桌面应用。导入英文文章，**点哪个单词就弹哪个单词的释义**，一键生成单词本。

## 功能

- **点词即查**：阅读英文文章时，点击任意单词弹出释义气泡（音标 + 词性 + 中英释义 + 考试标签徽章）。
- **三级数据源**（按优先级，自动降级）：
  1. 离线词典（ECDICT 精简版，约 6.6 万词条，秒回、零网络依赖）
  2. 在线词典（Free Dictionary API，增量补充）
  3. AI 释义（本机 Codex CLI 或 OpenAI 兼容接口，语境化释义 + 例句 + 记忆技巧）
- **单词本**：点过的词一键收录，支持导出 Markdown / JSON / CSV。
- **Codex 文章自动同步**：定时扫描 `Documents\Codex` 目录，发现新文章自动推送阅读。
- **拖拽导入**：把桌面上的文本文件直接拖进窗口即导入。
- **原生窗口控制**：右上角 ─ □ ✕ 按钮（无边框 + 渲染层自绘）。

## 技术栈

- Electron 44（`main.js` 主进程 + `preload.js` 预加载 + `src/` 渲染层）
- 内置词典：`resources/dict-mini.tsv`（ECDICT 精简，TSV 六列）

## 运行

```bash
npm install
npm start
```

## 打包

```bash
npm run dist   # 输出 portable + nsis 两种 Windows 安装包
```

> 打包需要 `build/icon.ico`，已在仓库中。

## 数据源配置

- **离线词典**：内置，无需配置。
- **本机 Codex CLI**（推荐）：应用会自动探测 `%LOCALAPPDATA%\Programs\OpenAI\Codex\bin\codex.exe`，走你本机的 Codex 订阅，无需额外 API Key。在「设置」里把释义引擎切到「本机 Codex」即可。
- **OpenAI 兼容接口**：在「设置」里填入 Base URL、模型名、API Key。

## 词典重建（可选）

`resources/dict-mini.tsv` 已内置，正常运行无需重建。若需重新生成：

1. 下载 ECDICT 完整词典 `ecdict.csv`，重命名为 `ecdict_full.csv` 放到项目根目录；
2. 运行 `python build/make_dict.py`。

## 目录结构

```
WordLens/
├── main.js            # 主进程：窗口、IPC、离线词典、Codex 接入、目录同步
├── preload.js         # contextBridge 安全桥接
├── src/               # 渲染层（index.html / styles.css / app.js）
├── resources/         # 内置离线词典 dict-mini.tsv
├── build/             # 图标 + 词典/图标生成脚本
├── samples/           # 示例英文文章
└── test/              # CDP 端到端测试脚本
```

## License

MIT
