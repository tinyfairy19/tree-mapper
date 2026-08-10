// panel.js — 编辑面板 & 弹框管理

const Panel = (() => {
  let currentTree = null;
  let isNew = false;
  let onSaveCb = null;
  let onDeleteCb = null;
  let onCancelCb = null;

  // DOM refs (延迟绑定)
  let els = {};
  function bind() {
    els = {
      overlay: document.getElementById('edit-overlay'),
      title: document.getElementById('edit-title'),
      idLabel: document.getElementById('edit-id-label'),
      id: document.getElementById('edit-id'),
      realId: document.getElementById('edit-real-id'),
      x: document.getElementById('edit-x'),
      y: document.getElementById('edit-y'),
      dbh: document.getElementById('edit-dbh'),
      height: document.getElementById('edit-height'),
      branchHeight: document.getElementById('edit-branch-height'),
      window: document.getElementById('edit-window'),
      notes: document.getElementById('edit-notes'),
      btnSave: document.getElementById('btn-save'),
      btnCancel: document.getElementById('btn-cancel'),
      btnDelete: document.getElementById('btn-delete'),
    };

    els.btnSave.addEventListener('click', handleSave);
    els.btnCancel.addEventListener('click', handleCancel);
    els.btnDelete.addEventListener('click', handleDeleteClick);

    // 点击遮罩关闭
    els.overlay.addEventListener('click', (e) => {
      if (e.target === els.overlay) handleCancel();
    });
  }

  function show(tree, _isNew, _onSave, _onDelete, _onCancel) {
    if (!els.overlay) bind();

    currentTree = Utils.cloneTree(tree);
    isNew = _isNew;
    onSaveCb = _onSave;
    onDeleteCb = _onDelete;
    onCancelCb = _onCancel;

    const isImported = tree._origin === 'imported';
    const zh = (window.__lang && window.__lang()) === 'zh';
    els.title.textContent = isNew ? (zh ? '新增树木' : 'Add Tree') : (zh ? '编辑树木' : 'Edit Tree');
    // 导入的树显示 Lidar ID，新增的树显示 Tree ID；均可手动编辑
    els.idLabel.textContent = isImported ? 'Lidar ID' : 'Tree ID';
    els.id.value = tree.id || '';
    els.id.disabled = false;
    els.realId.value = tree.real_id || '';
    els.x.value = tree.x != null ? roundVal(tree.x) : '';
    els.y.value = tree.y != null ? roundVal(tree.y) : '';
    els.dbh.value = tree.dbh != null ? tree.dbh : '';
    els.height.value = tree.height != null ? tree.height : '';
    els.branchHeight.value = tree.branch_height != null ? tree.branch_height : '';
    els.window.value = tree.window || '';
    els.notes.value = tree.notes || '';

    els.btnDelete.style.display = isNew ? 'none' : '';
    els.overlay.style.display = 'flex';
    // 用 focusin 捕获首次自动聚焦并立即阻止，消除键盘闪现
    const stopAutoFocus = (e) => {
      e.target.blur();
      els.overlay.removeEventListener('focusin', stopAutoFocus);
    };
    els.overlay.addEventListener('focusin', stopAutoFocus);
  }

  function hide() {
    if (els.overlay) els.overlay.style.display = 'none';
    // 不要在这里清空 currentTree，delete 流程需要它
    isNew = false;
  }

  function readForm() {
    return {
      id: els.id.value.trim(),
      real_id: els.realId.value.trim(),
      x: parseFloat(els.x.value),
      y: parseFloat(els.y.value),
      dbh: parseNullableNum(els.dbh.value),
      height: parseNullableNum(els.height.value),
      branch_height: parseNullableNum(els.branchHeight.value),
      window: els.window.value.trim(),
      notes: els.notes.value.trim()
    };
  }

  function handleSave() {
    const data = readForm();
    const zh = (window.__lang && window.__lang()) === 'zh';
    if (isNaN(data.x) || isNaN(data.y)) {
      alert(zh ? 'X 和 Y 坐标必须为有效数字' : 'X and Y must be valid numbers');
      return;
    }
    if (!data.id) {
      alert(zh ? 'Tree ID 不能为空' : 'Tree ID cannot be empty');
      return;
    }
    hide();
    if (onSaveCb) onSaveCb(data);
  }

  function handleCancel() {
    hide();
    if (onCancelCb) onCancelCb();
  }

  function handleDeleteClick() {
    // 先保存引用，因为 hide() 后可能需要
    const treeToDelete = currentTree;
    const delCb = onDeleteCb;
    hide();
    const zh = (window.__lang && window.__lang()) === 'zh';
    ConfirmDialog.show(
      zh ? '确定要删除这棵树吗？此操作不可恢复。' : 'Delete this tree? This cannot be undone.',
      () => {
        if (delCb && treeToDelete) delCb(treeToDelete);
      }
    );
  }

  function parseNullableNum(val) {
    const s = String(val).trim();
    if (s === '') return null;
    const n = parseFloat(s);
    return isNaN(n) ? null : n;
  }

  function roundVal(v) {
    return Math.round(v * 1000) / 1000;
  }

  return { bind, show, hide };
})();

// ====== 通用确认弹框 ======
const ConfirmDialog = (() => {
  let yesCb = null;

  function bind() {
    document.getElementById('btn-confirm-yes').addEventListener('click', () => {
      const cb = yesCb;
      hide();
      if (cb) cb();
    });
    document.getElementById('btn-confirm-no').addEventListener('click', hide);
  }

  function show(msg, _yesCb) {
    yesCb = _yesCb;
    document.getElementById('confirm-dialog').querySelector('p').textContent = msg;
    document.getElementById('confirm-overlay').style.display = 'flex';
  }

  function hide() {
    document.getElementById('confirm-overlay').style.display = 'none';
    yesCb = null;
  }

  return { bind, show, hide };
})();

// ====== 回退确认弹框 ======
const RevertDialog = (() => {
  let yesCb = null;

  function bind() {
    document.getElementById('btn-revert-yes').addEventListener('click', () => {
      const cb = yesCb;
      hide();
      if (cb) cb();
    });
    document.getElementById('btn-revert-no').addEventListener('click', hide);
  }

  function show(msg, _yesCb) {
    yesCb = _yesCb;
    document.getElementById('revert-msg').textContent = msg;
    document.getElementById('revert-overlay').style.display = 'flex';
  }

  function hide() {
    document.getElementById('revert-overlay').style.display = 'none';
    yesCb = null;
  }

  return { bind, show, hide };
})();
