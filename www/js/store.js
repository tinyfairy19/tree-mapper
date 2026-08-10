// store.js — IndexedDB 封装

const Store = (() => {
  const DB_NAME = 'TreeMapper';
  const DB_VERSION = 1;
  const STORE_TREES = 'trees';
  const STORE_SETTINGS = 'settings';

  let db = null;

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = (e) => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains(STORE_TREES)) {
          d.createObjectStore(STORE_TREES, { keyPath: 'id' });
        }
        if (!d.objectStoreNames.contains(STORE_SETTINGS)) {
          d.createObjectStore(STORE_SETTINGS, { keyPath: 'key' });
        }
      };
      req.onsuccess = (e) => {
        db = e.target.result;
        resolve(db);
      };
      req.onerror = () => reject(req.error);
    });
  }

  async function ensureDB() {
    if (db) return db;
    return openDB();
  }

  /** 保存全部树木（清空旧数据后写入） */
  async function saveAllTrees(trees) {
    await ensureDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_TREES, 'readwrite');
      const store = tx.objectStore(STORE_TREES);
      // 清空
      store.clear();
      // 写入
      for (const t of trees) {
        store.put({
          id: t.id,
          x: t.x,
          y: t.y,
          dbh: t.dbh ?? null,
          height: t.height ?? null,
          branch_height: t.branch_height ?? null,
          window: t.window || '',
          real_id: t.real_id || '',
          notes: t.notes || '',
          _origin: t._origin || 'imported'
        });
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /** 加载全部树木 */
  async function loadAllTrees() {
    await ensureDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_TREES, 'readonly');
      const store = tx.objectStore(STORE_TREES);
      const req = store.getAll();
      req.onsuccess = () => {
        const rows = req.result || [];
        resolve(rows.map(r => ({
          id: r.id,
          x: r.x,
          y: r.y,
          dbh: r.dbh ?? null,
          height: r.height ?? null,
          branch_height: r.branch_height ?? null,
          window: r.window || '',
          real_id: r.real_id || '',
          notes: r.notes || '',
          _origin: r._origin || 'imported'
        })));
      };
      req.onerror = () => reject(req.error);
    });
  }

  /** 保存/更新单棵树 */
  async function saveTree(tree) {
    await ensureDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_TREES, 'readwrite');
      const store = tx.objectStore(STORE_TREES);
      store.put({
        id: tree.id,
        x: tree.x,
        y: tree.y,
        dbh: tree.dbh ?? null,
        height: tree.height ?? null,
        real_id: tree.real_id || '',
        notes: tree.notes || '',
        _origin: tree._origin || 'imported'
      });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /** 删除单棵树 */
  async function deleteTree(id) {
    await ensureDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_TREES, 'readwrite');
      const store = tx.objectStore(STORE_TREES);
      store.delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /** 清空全部数据 */
  async function clearAll() {
    await ensureDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_TREES, 'readwrite');
      tx.objectStore(STORE_TREES).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /** 保存设置 */
  async function saveSetting(key, value) {
    await ensureDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_SETTINGS, 'readwrite');
      tx.objectStore(STORE_SETTINGS).put({ key, value });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  /** 读取设置 */
  async function loadSetting(key) {
    await ensureDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_SETTINGS, 'readonly');
      const req = tx.objectStore(STORE_SETTINGS).get(key);
      req.onsuccess = () => resolve(req.result ? req.result.value : null);
      req.onerror = () => reject(req.error);
    });
  }

  return { openDB, saveAllTrees, loadAllTrees, saveTree, deleteTree, clearAll, saveSetting, loadSetting,
    saveBoundary(pts) { return saveSetting('boundaryPoints', JSON.stringify(pts || [])); },
    async loadBoundary() { const v = await loadSetting('boundaryPoints'); return v ? JSON.parse(v) : []; }
  };
})();
