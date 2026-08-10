// app.js — 主入口，串联所有模块

(async function () {
  // ====== 初始化存储 ======
  await Store.openDB();
  await History.restore();

  // ====== DOM 引用 ======
  const $ = (id) => document.getElementById(id);

  const dom = {
    canvas: $('main-canvas'),
    btnImport: $('btn-import'),
    btnBoundary: $('btn-boundary'),
    btnExport: $('btn-export'),
    btnUndo: $('btn-undo'),
    btnRedo: $('btn-redo'),
    btnClear: $('btn-clear'),
    treeCount: $('tree-count'),
    dbhSlider: $('dbh-slider'),
    dbhLabel: $('dbh-scale-label'),
    fileInput: $('file-input'),
    boundaryInput: $('boundary-input'),
    logList: $('log-list'),
    logPanel: $('log-panel'),
    btnToggleLog: $('btn-toggle-log'),
    toggleLabels: $('toggle-labels'),
    toggleDbhLabels: $('toggle-dbh-labels'),
    toggleRealId: $('toggle-real-id'),
    btnLang: $('btn-lang'),
    tableOverlay: $('table-overlay'),
    tableBody: $('table-body'),
    tableCount: $('table-count'),
    btnTableClose: $('btn-table-close'),
    plotName: $('plot-name'),
    rotateSlider: $('rotate-slider'),
    rotateLabel: $('rotate-label'),
    btnLockRotate: $('btn-lock-rotate'),
  };

  // ====== 初始化弹框 ======
  ConfirmDialog.bind();
  RevertDialog.bind();

  // ====== 应用状态 ======
  let trees = []; // 当前树数组（主数据源）
  let tableSortKey = null;   // 表格排序列
  let tableSortDir = 'asc';  // asc | desc | null（默认）

  // ====== 初始化画布 ======
  Canvas.init(dom.canvas);

  // ====== 恢复边界点（Canvas.init 之后才能渲染） ======
  try {
    const savedBoundary = await Store.loadBoundary();
    if (savedBoundary && savedBoundary.length > 0) Canvas.setBoundary(savedBoundary);
  } catch (e) { console.warn('恢复边界点失败:', e); }

  // ====== 画布回调 ======
  Canvas.onTreeClick = (tree) => {
    openEditPanel(tree, false);
  };

  Canvas.onTreeAdd = (x, y) => {
    // 将旋转后的屏幕坐标还原为原始坐标
    const orig = Canvas.getOriginalPosition(x, y);
    const existingIds = trees.map(t => t.id);
    const newId = Utils.generateAddId(existingIds);
    const newTree = {
      id: newId,
      x: Math.round(orig.x * 100) / 100,
      y: Math.round(orig.y * 100) / 100,
      dbh: null,
      height: null,
      branch_height: null,
      window: '',
      real_id: '',
      notes: '',
      _origin: 'added'
    };

    Panel.show(newTree, true,
      // save
      (data) => {
        const tree = {
          id: data.id,
          x: data.x,
          y: data.y,
          dbh: data.dbh,
          height: data.height,
          branch_height: data.branch_height,
          window: data.window || '',
          real_id: data.real_id || '',
          notes: data.notes,
          _origin: 'added'
        };
        addTree(tree);
        Canvas.clearSelection();
      },
      null, // new trees don't need delete
      // cancel
      () => {
        Canvas.clearSelection();
      }
    );
  };

  // ====== 编辑面板回调 ======
  function openEditPanel(tree, isNew) {
    Panel.show(tree, isNew,
      // save
      (data) => {
        if (isNew) {
          addTree({
            id: data.id,
            x: data.x,
            y: data.y,
            dbh: data.dbh,
            height: data.height,
            branch_height: data.branch_height,
            window: data.window || '',
            real_id: data.real_id || '',
            notes: data.notes,
            _origin: 'added'
          });
        } else {
          editTree(tree.id, {
            id: data.id,
            x: data.x,
            y: data.y,
            dbh: data.dbh,
            height: data.height,
            branch_height: data.branch_height,
            window: data.window || '',
            real_id: data.real_id || '',
            notes: data.notes
          });
        }
        Canvas.clearSelection();
        Canvas.render();
      },
      // delete
      (oldTree) => {
        deleteTree(oldTree.id);
        Canvas.clearSelection();
        Canvas.render();
      },
      // cancel
      () => {
        Canvas.clearSelection();
      }
    );
  }

  // ====== 数据操作（含历史记录） ======

  function addTree(tree) {
    const wasEmpty = trees.length === 0;
    trees.push(tree);
    History.record('add',
      { type: 'remove', treeId: tree.id },
      { type: 'add', tree },
      `${lang==='zh'?'新增':'Add'}: ${tree.id}`,
      `${lang==='zh'?'坐标':'Pos'}: (${tree.x}, ${tree.y})`
    );
    updateAll();
    if (wasEmpty) Canvas.autoFitView();
    renderLogList();
  }

  function editTree(oldId, newData) {
    const oldTree = trees.find(t => t.id === oldId);
    if (!oldTree) return;

    const oldSnapshot = Utils.cloneTree(oldTree);
    const idx = trees.indexOf(oldTree);

    if (newData.id !== oldId) {
      if (trees.some(t => t.id === newData.id)) {
        alert(lang==='zh' ? `ID "${newData.id}" 已存在，请使用其他 ID` : `ID "${newData.id}" already exists`);
        return;
      }
    }

    const newTree = {
      id: newData.id,
      x: newData.x,
      y: newData.y,
      dbh: newData.dbh,
      height: newData.height,
      branch_height: newData.branch_height,
      window: newData.window || '',
      real_id: newData.real_id || '',
      notes: newData.notes,
      _origin: oldTree._origin || 'imported'
    };

    trees[idx] = newTree;

    const diff = Utils.diffAttrs(oldSnapshot, newTree);
    History.record('edit',
      { type: 'edit', treeId: newTree.id, oldData: oldSnapshot },
      { type: 'edit', treeId: oldId, oldData: Utils.cloneTree(newTree) },
      `${lang==='zh'?'编辑':'Edit'}: ${newTree.id}`,
      diff
    );

    updateAll();
    renderLogList();
  }

  function deleteTree(id) {
    const tree = trees.find(t => t.id === id);
    if (!tree) return;

    const snapshot = Utils.cloneTree(tree);
    trees = trees.filter(t => t.id !== id);

    History.record('delete',
      { type: 'add', tree: snapshot },
      { type: 'remove', treeId: id },
      `${lang==='zh'?'删除':'Delete'}: ${id}`,
      `${lang==='zh'?'坐标':'Pos'}: (${snapshot.x}, ${snapshot.y})`
    );

    updateAll();
    renderLogList();
  }

  // ====== 撤销/重做执行 ======

  async function executeUndo() {
    const action = History.undo();
    if (!action) return;

    switch (action.type) {
      case 'add': {
        // 撤销删除 → 加回来
        trees.push(action.tree);
        break;
      }
      case 'remove': {
        // 撤销新增 → 删掉
        trees = trees.filter(t => t.id !== action.treeId);
        break;
      }
      case 'edit': {
        // 撤销编辑 → 恢复旧数据
        const idx = trees.findIndex(t => t.id === action.treeId);
        if (idx >= 0 && action.oldData) {
          trees[idx] = Utils.cloneTree(action.oldData);
        }
        break;
      }
    }
    updateAll();
    if (trees.length > 0) Canvas.autoFitView();
    Canvas.clearSelection();
    Canvas.render();
  }

  async function executeRedo() {
    const action = History.redo();
    if (!action) return;

    switch (action.type) {
      case 'add': {
        trees.push(action.tree);
        break;
      }
      case 'remove': {
        trees = trees.filter(t => t.id !== action.treeId);
        break;
      }
      case 'edit': {
        const idx = trees.findIndex(t => t.id === action.treeId);
        if (idx >= 0 && action.oldData) {
          trees[idx] = Utils.cloneTree(action.oldData);
        }
        break;
      }
    }
    updateAll();
    if (trees.length > 0) Canvas.autoFitView();
    Canvas.clearSelection();
    Canvas.render();
  }

  // ====== UI 更新 ======

  function updateAll() {
    Canvas.setData(trees);
    updateCount();
    updateUndoRedoButtons();
    saveData();
    // 如果数据表已打开，同步刷新
    if (dom.tableOverlay.style.display === 'flex') { renderDataTable(); bindSortHeaders(); }
  }

  function updateCount() {
    dom.treeCount.textContent = I18N[lang].trees(trees.length);
  }

  function updateUndoRedoButtons() {
    dom.btnUndo.disabled = !History.canUndo();
    dom.btnRedo.disabled = !History.canRedo();
  }

  async function saveData() {
    try {
      await Store.saveAllTrees(trees);
    } catch (e) {
      console.error('保存数据失败:', e);
    }
  }

  // ====== 操作日志 GUI ======

  function renderLogList() {
    const entries = History.getLog();
    dom.logList.innerHTML = '';

    for (const entry of entries) {
      const div = document.createElement('div');
      div.className = 'log-entry';
      div.innerHTML = `
        <div class="log-summary">
          <span class="log-badge ${entry.type}">${typeLabel(entry.type)}</span>
          <span>${entry.summary}</span>
          <span class="log-time">${entry.time}</span>
          ${entry.action ? `<button class="log-revert-btn" title="${lang==='zh'?'回退到此操作':'Revert to here'}">↩</button>` : ''}
        </div>
        <div class="log-detail">${entry.detail || (lang==='zh'?'无详细变更':'No details')}</div>
      `;

      // 点击展开/折叠详情
      div.querySelector('.log-summary').addEventListener('click', (e) => {
        // 如果点的是回退按钮，不展开
        if (e.target.classList.contains('log-revert-btn')) return;
        div.classList.toggle('expanded');
      });

      // 回退按钮
      const revertBtn = div.querySelector('.log-revert-btn');
      if (revertBtn) {
        revertBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          RevertDialog.show(
            lang==='zh' ? `是否回到此次操作？\n\n${entry.summary}` : `Revert to this state?\n\n${entry.summary}`,
            () => revertToEntry(entry)
          );
        });
      }

      dom.logList.appendChild(div);
    }
  }

  function typeLabel(type) {
    const map = lang === 'zh'
      ? { add: '新增', edit: '修改', delete: '删除' }
      : { add: 'Add', edit: 'Edit', delete: 'Delete' };
    return map[type] || type;
  }

  async function revertToEntry(targetEntry) {
    // 持续撤销直到找到目标操作
    let safety = 0;
    while (History.canUndo() && safety < 500) {
      safety++;
      const action = History.undo();
      if (!action) break;

      // 执行撤销
      switch (action.type) {
        case 'add': trees.push(action.tree); break;
        case 'remove': trees = trees.filter(t => t.id !== action.treeId); break;
        case 'edit': {
          const idx = trees.findIndex(t => t.id === action.treeId);
          if (idx >= 0 && action.oldData) trees[idx] = Utils.cloneTree(action.oldData);
          break;
        }
      }

      // 检查是否到达目标
      const currentTop = History.getLog()[0];
      if (currentTop && currentTop.id <= targetEntry.id) {
        break;
      }
    }
    updateAll();
    Canvas.clearSelection();
    Canvas.render();
  }

  // ====== 按钮事件 ======

  dom.btnImport.addEventListener('click', () => {
    // Android APK: 使用原生文件选择器
    if (typeof ImportHelper !== 'undefined' && ImportHelper.pickCSV) {
      importCSVNative();
      return;
    }
    // 浏览器: 使用隐藏的 file input
    dom.fileInput.value = '';
    dom.fileInput.click();
  });

  // ====== 样地边界导入 ======
  dom.btnBoundary.addEventListener('click', () => {
    if (typeof ImportHelper !== 'undefined' && ImportHelper.pickCSV) {
      importBoundaryNative();
      return;
    }
    dom.boundaryInput.value = '';
    dom.boundaryInput.click();
  });

  dom.boundaryInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const pts = await parseBoundaryFile(file);
      Canvas.setBoundary(pts);
      Store.saveBoundary(pts);
      History.addLog('edit', `${lang==='zh'?'导入边界':'Import Boundary'}: ${file.name}`, `${pts.length} ${lang==='zh'?'个边界点':'boundary pts'}`);
      renderLogList();
    } catch (err) {
      console.error('边界导入失败:', err);
      alert('边界导入失败: ' + err.message);
    } finally {
      dom.boundaryInput.value = '';
    }
  });

  async function importBoundaryNative() {
    window._onCSVFilePicked = (fileName, base64Content) => {
      delete window._onCSVFilePicked;
      delete window._onCSVFilePickedError;
      try {
        const text = CSV.readBase64AsText(base64Content, 'utf-8');
        parseBoundaryText(text).then(pts => {
          Canvas.setBoundary(pts);
          Store.saveBoundary(pts);
          History.addLog('edit', `${lang==='zh'?'导入边界':'Import Boundary'}: ${fileName}`, `${pts.length} ${lang==='zh'?'个边界点':'boundary pts'}`);
          renderLogList();
        }).catch(err => {
          console.error(`${lang==='zh'?'边界导入失败':'Boundary import failed'}:`, err);
          alert(`${lang==='zh'?'边界导入失败':'Boundary import failed'}: ` + err.message);
        });
      } catch (err) {
        console.error('边界导入失败:', err);
        alert('边界导入失败: ' + err.message);
      }
    };
    window._onCSVFilePickedError = (errMsg) => {
      delete window._onCSVFilePicked;
      delete window._onCSVFilePickedError;
      alert('边界导入失败: ' + errMsg);
    };
    ImportHelper.pickCSV();
  }

  /** 解析边界文件（浏览器端） */
  async function parseBoundaryFile(file) {
    const text = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error(lang==='zh'?'文件读取失败':'File read failed'));
      reader.readAsText(file, 'utf-8');
    });
    return parseBoundaryText(text);
  }

  /** 从文本解析边界点（提取 X,Y 列） */
  function parseBoundaryText(text) {
    return new Promise((resolve, reject) => {
      Papa.parse(text, {
        header: true,
        skipEmptyLines: true,
        complete(results) {
          const headers = (results.meta.fields || []).map(h => String(h).toLowerCase().trim());
          const xIdx = headers.indexOf('x');
          const yIdx = headers.indexOf('y');
          if (xIdx < 0 || yIdx < 0) return reject(new Error(lang==='zh'?'边界文件需包含 X,Y 列':'Boundary file must have X,Y columns'));
          const pts = [];
          for (const row of results.data) {
            const x = parseFloat(row[Object.keys(row)[xIdx]]);
            const y = parseFloat(row[Object.keys(row)[yIdx]]);
            if (!isNaN(x) && !isNaN(y)) pts.push({ x, y });
          }
          if (pts.length === 0) return reject(new Error(lang==='zh'?'未找到有效的 X,Y 数据':'No valid X,Y data found'));
          resolve(pts);
        },
        error(err) { reject(new Error(`${lang==='zh'?'边界文件解析失败':'Boundary parse failed'}: ` + err.message)); }
      });
    });
  }

  /** 原生 APK 导入流程 */
  async function importCSVNative() {
    try {
      const newTrees = await CSV.importFileNative();
      // 标记所有导入树
      newTrees.forEach(t => t._origin = 'imported');
      // 清空旧数据 + 历史 + 视图状态
      await Store.clearAll();
      await Store.saveSetting('viewState', null);
      History.clearAll();
      trees = newTrees;
      updateAll();
      Canvas.autoFitView();
      History.addLog('add', lang==='zh'?'导入 CSV':'Import CSV', `${lang==='zh'?'共导入':'Imported'} ${newTrees.length} ${lang==='zh'?'棵树木':'trees'}`);
      renderLogList();
    } catch (err) {
      console.error('CSV 导入失败:', err);
      if (err.message !== (lang==='zh'?'用户取消导入':'User cancelled')) {
        alert(`${lang==='zh'?'导入失败':'Import failed'}: ` + err.message);
      }
    }
  }

  dom.fileInput.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const newTrees = await CSV.importFile(file);
      // 标记所有导入树
      newTrees.forEach(t => t._origin = 'imported');
      // 清空旧数据 + 历史 + 视图状态
      await Store.clearAll();
      await Store.saveSetting('viewState', null);
      History.clearAll();
      trees = newTrees;
      updateAll();
      Canvas.autoFitView();
      History.addLog('add', `${lang==='zh'?'导入 CSV':'Import CSV'}: ${file.name}`, `${lang==='zh'?'共导入':'Imported'} ${newTrees.length} ${lang==='zh'?'棵树木':'trees'}`);
      renderLogList();
    } catch (err) {
      console.error('CSV 导入失败:', err);
      if (err.message !== (lang==='zh'?'用户取消导入':'User cancelled')) {
        alert(`${lang==='zh'?'导入失败':'Import failed'}: ` + err.message);
      }
    } finally {
      dom.fileInput.value = '';
    }
  });

  dom.btnExport.addEventListener('click', () => {
    if (trees.length === 0) {
      alert(lang==='zh'?'暂无数据可导出':'No data to export');
      return;
    }
    const plot = dom.plotName.value.trim() || 'plot';
    const filename = `${plot}_field_match.csv`;
    // 导出：保留原始 xy，附加旋转后的 x_shifted / y_shifted
    const exportTrees = trees.map(t => {
      const rp = Canvas.getRotatedPosition(t.x, t.y);
      return { ...t, x_shifted: rp.x, y_shifted: rp.y };
    });
    CSV.downloadCSV(exportTrees, filename);
    History.addLog('edit', `${lang==='zh'?'导出 CSV':'Export CSV'}: ${filename}`, `${lang==='zh'?'共导出':'Exported'} ${trees.length} ${lang==='zh'?'棵树木':'trees'}`);
    renderLogList();
  });

  dom.btnUndo.addEventListener('click', async () => {
    await executeUndo();
    renderLogList();
  });

  dom.btnRedo.addEventListener('click', async () => {
    await executeRedo();
    renderLogList();
  });

  // ====== 清除所有点 ======
  dom.btnClear.addEventListener('click', () => {
    if (trees.length >= 1) {
      ConfirmDialog.show(t('clearConfirm'), () => {
        doClearAll();
      });
    } else {
      doClearAll();
    }
  });

  async function doClearAll() {
    trees = [];
    Canvas.setData([]);
    Canvas.clearBoundary();
    Store.saveBoundary([]);
    await Store.clearAll();
    History.clearAll();
    updateAll();
    renderLogList();
  }

  // ====== 旋转滑块 ======
  let rotationLocked = false;
  dom.rotateSlider.addEventListener('input', () => {
    if (rotationLocked) return;
    const val = parseInt(dom.rotateSlider.value);
    dom.rotateLabel.textContent = val + '°';
    Canvas.rotationAngle = val;
    Store.saveSetting('rotationAngle', val);
  });

  dom.btnLockRotate.addEventListener('click', () => {
    rotationLocked = !rotationLocked;
    dom.rotateSlider.disabled = rotationLocked;
    dom.btnLockRotate.textContent = rotationLocked ? '🔒' : '🔓';
    dom.btnLockRotate.classList.toggle('locked', rotationLocked);
    Store.saveSetting('rotationLocked', rotationLocked);
  });

  // ====== DBH 滑块 ======
  dom.dbhSlider.addEventListener('input', () => {
    const val = parseFloat(dom.dbhSlider.value);
    dom.dbhLabel.textContent = val.toFixed(2);
    Canvas.setDbhScale(val);
    Store.saveSetting('dbhScale', val);
  });

  // ====== 显示开关 ======
  dom.toggleLabels.addEventListener('change', () => {
    Canvas.showTreeLabels = dom.toggleLabels.checked;
  });
  dom.toggleDbhLabels.addEventListener('change', () => {
    Canvas.showDbhLabels = dom.toggleDbhLabels.checked;
  });
  dom.toggleRealId.addEventListener('change', () => {
    Canvas.showRealIdLabels = dom.toggleRealId.checked;
  });

  // ====== 数据表（点击 "共 x 棵" 打开） ======
  dom.treeCount.addEventListener('click', () => {
    renderDataTable();
    bindSortHeaders();
    dom.tableOverlay.style.display = 'flex';
  });

  // ====== 中英文切换 ======
  let lang = 'zh'; // zh | en
  window.__lang = () => lang; // 供其他模块读取
  const I18N = {
    zh: { trees: (n) => `共 ${n} 棵`, import: '导入 CSV', boundary: '导入样地边界', export: '导出 CSV',
      plot: '样地', placeholder: '请输入...', rotate: '旋转', lock: '锁定旋转', unlock: '解锁旋转',
      dbhScale: 'DBH 比例', show: '显示', log: '📋 操作日志', editTree: '编辑树木', addTree: '新增树木',
      lidarId: 'Lidar ID', treeId: 'Tree ID', realId: 'Real ID', realIdPlaceholder: '实地调查编号',
      branchHt: '枝下高 (m)', window: '生长窗口', optional: '可选', notes: '备注...',
      save: '💾 保存', cancel: '取消', delete: '🗑 删除', confirmDelete: '确定要删除这棵树吗？此操作不可恢复。',
      confirmDeleteYes: '确认删除', confirmRevert: '确认回退',
      mapping: '📋 字段映射', encoding: '编码:', preview: '预览 (前 5 行):', confirmImport: '确认导入',
      noMapping: '-- 不映射 --', tableTitle: '📊 数据表', treesUnit: '棵',
      clearConfirm: '确定要清除所有树木和边界点吗？此操作不可恢复。' },
    en: { trees: (n) => `${n} trees`, import: 'Import', boundary: 'Boundary', export: 'Export',
      plot: 'Plot', placeholder: 'Enter...', rotate: 'Rotate', lock: 'Lock Rotation', unlock: 'Unlock Rotation',
      dbhScale: 'DBH Scale', show: 'Show', log: '📋 Log', editTree: 'Edit Tree', addTree: 'Add Tree',
      lidarId: 'Lidar ID', treeId: 'Tree ID', realId: 'Real ID', realIdPlaceholder: 'Field survey ID',
      branchHt: 'Branch Ht (m)', window: 'Window', optional: 'optional', notes: 'Notes...',
      save: '💾 Save', cancel: 'Cancel', delete: '🗑 Delete', confirmDelete: 'Delete this tree? This cannot be undone.',
      confirmDeleteYes: 'Confirm Delete', confirmRevert: 'Confirm Revert',
      mapping: '📋 Field Mapping', encoding: 'Encoding:', preview: 'Preview (first 5 rows):', confirmImport: 'Confirm Import',
      noMapping: '-- None --', tableTitle: '📊 Data Table', treesUnit: 'trees',
      clearConfirm: 'Clear all trees and boundary points? This cannot be undone.' }
  };
  function t(key) { return I18N[lang][key] || key; }

  dom.btnLang.addEventListener('click', () => {
    lang = lang === 'zh' ? 'en' : 'zh';
    dom.btnLang.textContent = lang === 'zh' ? '中' : 'EN';
    applyI18N();
    updateCount();
    renderLogList();
    if (dom.tableOverlay.style.display === 'flex') renderDataTable();
  });

  function applyI18N() {
    document.querySelectorAll('[data-zh]').forEach(el => {
      if (el.children.length > 0 && el.tagName !== 'BUTTON') return; // skip containers with children
      const zh = el.getAttribute('data-zh');
      const en = el.getAttribute('data-en');
      if (zh && en) {
        if (el.tagName === 'INPUT') el.placeholder = lang === 'zh' ? zh : en;
        else if (el.tagName === 'TEXTAREA') el.placeholder = lang === 'zh' ? zh : en;
        else el.textContent = lang === 'zh' ? zh : en;
      }
    });
    // 按钮文字特殊处理（有些按钮只有 emoji）
    document.getElementById('btn-lang').textContent = lang === 'zh' ? '中' : 'EN';
    document.getElementById('btn-undo').textContent = '↩';
    document.getElementById('btn-redo').textContent = '↪';
    document.getElementById('btn-clear').textContent = '🗑';
    // 更新标题
    const titleEl = document.getElementById('edit-title');
    if (titleEl) titleEl.textContent = lang === 'zh' ? '编辑树木' : 'Edit Tree';
    // 更新数据表标题（有子元素，需单独处理）
    const tableTitle = document.querySelector('#table-dialog h3');
    if (tableTitle) {
      const count = document.getElementById('table-count');
      const countVal = count ? count.textContent : '0';
      const unit = lang === 'zh' ? '棵' : 'trees';
      tableTitle.innerHTML = `${lang==='zh'?'📊 数据表':'📊 Data Table'} (<span id="table-count">${countVal}</span> ${unit})`;
    }
  }

  dom.btnTableClose.addEventListener('click', () => {
    dom.tableOverlay.style.display = 'none';
  });

  dom.tableOverlay.addEventListener('click', (e) => {
    if (e.target === dom.tableOverlay) dom.tableOverlay.style.display = 'none';
  });

  function renderDataTable() {
    dom.tableCount.textContent = trees.length;
    const body = dom.tableBody;
    body.innerHTML = '';

    // 排序（tableSortDir 为 null 时不排序，恢复默认顺序）
    const sorted = (tableSortKey && tableSortDir) ? [...trees].sort((a, b) => {
      let va = getSortVal(a, tableSortKey), vb = getSortVal(b, tableSortKey);
      if (va == null) va = '';
      if (vb == null) vb = '';
      if (typeof va === 'number' && typeof vb === 'number') {
        return tableSortDir === 'asc' ? va - vb : vb - va;
      }
      const cmp = String(va).localeCompare(String(vb), undefined, { numeric: true });
      return tableSortDir === 'asc' ? cmp : -cmp;
    }) : trees;

    for (const t of sorted) {
      const tr = document.createElement('tr');

      // 定位按钮
      const tdLoc = document.createElement('td');
      const btnLoc = document.createElement('button');
      btnLoc.className = 'btn-locate';
      btnLoc.textContent = '⊕';
      btnLoc.title = lang==='zh'?'定位到画布中心':'Center on canvas';
      btnLoc.addEventListener('click', (e) => {
        e.stopPropagation();
        dom.tableOverlay.style.display = 'none';
        Canvas.jumpToTree(t.id);
      });
      tdLoc.appendChild(btnLoc);
      tr.appendChild(tdLoc);

      // 数据列（使用旋转后的坐标，与导出保持一致）
      const rp = Canvas.getRotatedPosition(t.x, t.y);
      const rx = Math.round(rp.x * 100) / 100;
      const ry = Math.round(rp.y * 100) / 100;
      const cols = [t.id, t.real_id || '', rx, ry,
                    t.dbh != null ? t.dbh : '', t.height != null ? t.height : '',
                    t.branch_height != null ? t.branch_height : '', t.window || '',
                    t.notes || ''];
      for (const c of cols) {
        const td = document.createElement('td');
        td.textContent = String(c);
        tr.appendChild(td);
      }

      // 单击行 → 编辑
      tr.addEventListener('click', () => {
        dom.tableOverlay.style.display = 'none';
        Canvas.setSelected(t.id);
        Canvas.render();
        openEditPanel(t, false);
      });

      body.appendChild(tr);
    }
  }

  function roundD(v) {
    return Math.round(v * 100) / 100;
  }

  /** 获取排序用的值（x,y 使用旋转后坐标） */
  function getSortVal(t, key) {
    if (key === 'x' || key === 'y') {
      const rp = Canvas.getRotatedPosition(t.x, t.y);
      return key === 'x' ? Math.round(rp.x * 100) / 100 : Math.round(rp.y * 100) / 100;
    }
    if (key === 'dbh' || key === 'height' || key === 'branch_height') {
      return t[key] != null ? t[key] : -Infinity;
    }
    return t[key] != null ? t[key] : '';
  }

  /** 绑定表头排序事件 */
  function bindSortHeaders() {
    const headers = document.querySelectorAll('.th-sort');
    headers.forEach(th => {
      th.onclick = () => {
        const key = th.dataset.key;
        if (tableSortKey === key) {
          // 三态切换: asc → desc → 默认(取消排序)
          if (tableSortDir === 'asc') tableSortDir = 'desc';
          else if (tableSortDir === 'desc') { tableSortDir = null; tableSortKey = null; }
        } else {
          tableSortKey = key;
          tableSortDir = 'asc';
        }
        // 更新样式
        headers.forEach(h => h.classList.remove('asc', 'desc'));
        if (tableSortKey && tableSortDir) {
          const active = document.querySelector(`.th-sort[data-key="${tableSortKey}"]`);
          if (active) active.classList.add(tableSortDir);
        }
        renderDataTable();
      };
    });
    // 恢复当前排序状态样式
    if (tableSortKey && tableSortDir) {
      const active = document.querySelector(`.th-sort[data-key="${tableSortKey}"]`);
      if (active) active.classList.add(tableSortDir);
    }
  }

  // ====== 日志折叠 ======
  dom.btnToggleLog.addEventListener('click', () => {
    dom.logPanel.classList.toggle('collapsed');
    dom.btnToggleLog.textContent = dom.logPanel.classList.contains('collapsed') ? '▼' : '▲';
  });

  // ====== 键盘快捷键 ======
  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
    if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
      e.preventDefault();
      if (e.shiftKey) {
        executeRedo().then(() => renderLogList());
      } else {
        executeUndo().then(() => renderLogList());
      }
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'y') {
      e.preventDefault();
      executeRedo().then(() => renderLogList());
    }
  });

  // ====== 启动: 恢复上次数据 ======
  // 恢复 DBH 比例设置
  let savedDbhScale = null;
  try {
    savedDbhScale = await Store.loadSetting('dbhScale');
  } catch (e) { /* ignore */ }

  if (savedDbhScale != null) {
    dom.dbhSlider.value = savedDbhScale;
    dom.dbhLabel.textContent = String(savedDbhScale);
    Canvas.setDbhScale(savedDbhScale);
  }

  // 恢复样地名称
  try {
    const plot = await Store.loadSetting('plotName');
    if (plot) dom.plotName.value = plot;
  } catch (e) { /* ignore */ }

  // 恢复旋转设置
  try {
    const rot = await Store.loadSetting('rotationAngle');
    if (rot != null) {
      dom.rotateSlider.value = rot;
      dom.rotateLabel.textContent = rot + '°';
      Canvas.rotationAngle = rot;
    }
    const locked = await Store.loadSetting('rotationLocked');
    if (locked) {
      rotationLocked = true;
      dom.rotateSlider.disabled = true;
      dom.btnLockRotate.textContent = '🔒';
      dom.btnLockRotate.classList.add('locked');
    }
  } catch (e) { /* ignore */ }

  try {
    const savedTrees = await Store.loadAllTrees();
    if (savedTrees.length > 0) {
      trees = savedTrees;
      Canvas.setData(trees); // 自动适配视口
      updateCount();
      updateUndoRedoButtons();
      History.addLog('add', lang==='zh'?'已恢复上次数据':'Restored data', `${lang==='zh'?'共':'Total'} ${trees.length} ${lang==='zh'?'棵树木':'trees'}`);
      renderLogList();
    } else {
      updateAll();
    }
  } catch (e) {
    console.error('加载数据失败:', e);
    updateAll();
  }

  // 退出前保存设置
  window.addEventListener('beforeunload', () => {
    Store.saveSetting('dbhScale', parseFloat(dom.dbhSlider.value));
    Store.saveSetting('plotName', dom.plotName.value.trim());
    Store.saveSetting('rotationAngle', Canvas.rotationAngle);
    Store.saveSetting('rotationLocked', rotationLocked);
  });

  // 页面隐藏时也保存（App 切后台 / 关闭）
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      Store.saveSetting('dbhScale', parseFloat(dom.dbhSlider.value));
      Store.saveSetting('plotName', dom.plotName.value.trim());
      Store.saveSetting('rotationAngle', Canvas.rotationAngle);
      Store.saveSetting('rotationLocked', rotationLocked);
    }
  });

  console.log('🌲 Tree Mapper 已就绪');
  applyI18N();
})();
