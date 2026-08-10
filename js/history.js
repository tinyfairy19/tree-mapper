// history.js — 撤销/重做 + 操作日志

const History = (() => {
  let undoStack = [];
  let redoStack = [];
  let logEntries = [];

  const MAX_LOG = 200;

  /**
   * 记录一次操作
   * @param {string} type - 'add' | 'edit' | 'delete'
   * @param {object} undoAction - { type, tree, oldTree? }
   * @param {object} redoAction - { type, tree, oldTree? }
   * @param {string} summary - 简短描述
   * @param {string} detail - 详细变更
   */
  function record(type, undoAction, redoAction, summary, detail) {
    undoStack.push({ type, undoAction, redoAction });
    redoStack = []; // 新操作清空重做栈

    const entry = {
      id: Date.now(),
      time: Utils.timeNow(),
      type,
      summary,
      detail,
      action: undoAction
    };

    logEntries.unshift(entry);
    if (logEntries.length > MAX_LOG) logEntries.pop();

    // 持久化
    persist();

    return entry;
  }

  function undo() {
    if (undoStack.length === 0) return null;
    const item = undoStack.pop();
    redoStack.push(item);
    persist();
    return item.undoAction;
  }

  function redo() {
    if (redoStack.length === 0) return null;
    const item = redoStack.pop();
    undoStack.push(item);
    persist();
    return item.redoAction;
  }

  function canUndo() { return undoStack.length > 0; }
  function canRedo() { return redoStack.length > 0; }

  function getLog() { return logEntries; }

  function clearAll() {
    undoStack = [];
    redoStack = [];
    logEntries = [];
    persist();
  }

  /** 添加纯日志条目（不影响撤销栈） */
  function addLog(type, summary, detail) {
    const entry = {
      id: Date.now(),
      time: Utils.timeNow(),
      type,
      summary,
      detail: detail || '',
      action: null
    };
    logEntries.unshift(entry);
    if (logEntries.length > MAX_LOG) logEntries.pop();
    persist();
    return entry;
  }

  async function persist() {
    try {
      await Store.saveSetting('undoStack', undoStack);
      await Store.saveSetting('redoStack', redoStack);
      await Store.saveSetting('logEntries', logEntries);
    } catch (e) { /* 忽略持久化失败 */ }
  }

  async function restore() {
    try {
      undoStack = (await Store.loadSetting('undoStack')) || [];
      redoStack = (await Store.loadSetting('redoStack')) || [];
      logEntries = (await Store.loadSetting('logEntries')) || [];
    } catch (e) {
      undoStack = [];
      redoStack = [];
      logEntries = [];
    }
  }

  return { record, undo, redo, canUndo, canRedo, getLog, clearAll, addLog, restore };
})();
