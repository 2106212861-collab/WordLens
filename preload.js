const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('wordlens', {
  // 窗口控制
  window: {
    minimize: () => ipcRenderer.send('window:minimize'),
    maximize: () => ipcRenderer.send('window:maximize'),
    close: () => ipcRenderer.send('window:close'),
    isMaximized: () => ipcRenderer.sendSync('window:isMaximized'),
    onMaximizeChange: (cb) => ipcRenderer.on('window:maximize-changed', (_e, v) => cb(v)),
    setTitleBarOverlay: (theme) => ipcRenderer.send('theme:set', theme)
  },
  // 拖拽导入：取拖入 File 的绝对路径
  getPathForFile: (file) => {
    try { return webUtils.getPathForFile(file); } catch { return file && file.path ? file.path : null; }
  },
  // 导入文章
  openFiles: () => ipcRenderer.invoke('dialog:openFiles'),
  // Codex 目录扫描
  scanCodex: (dir) => ipcRenderer.invoke('codex:scan', dir),
  readFile: (p) => ipcRenderer.invoke('fs:readFile', p),
  defaultCodexDir: () => ipcRenderer.invoke('app:defaultCodexDir'),
  // 词典 / 模型
  offlineLookup: (word) => ipcRenderer.invoke('dict:offline', word),
  dictionaryLookup: (word) => ipcRenderer.invoke('dictionary:lookup', word),
  llmLookup: (word, context, config) => ipcRenderer.invoke('llm:lookup', word, context, config),
  llmLookupBatch: (words, config) => ipcRenderer.invoke('llm:lookupBatch', words, config),
  // 本机 Codex CLI
  codexLookup: (word, context) => ipcRenderer.invoke('codex:lookup', word, context),
  codexStatus: () => ipcRenderer.invoke('codex:status'),
  onCodexNewFiles: (cb) => ipcRenderer.on('codex:new-files', (_e, files) => cb(files)),
  // 导出单词本
  exportWordbook: (payload) => ipcRenderer.invoke('wordbook:export', payload)
});
