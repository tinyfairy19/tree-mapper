// utils.js — 通用工具函数

const Utils = {

  /** 格式化时间为 HH:MM:SS */
  timeNow() {
    const d = new Date();
    return d.toLocaleTimeString('zh-CN', { hour12: false });
  },

  /** 生成 Add 前缀的新 ID，基于已有最大编号 */
  generateAddId(existingIds) {
    let max = 0;
    for (const id of existingIds) {
      const m = id.match(/^Add_(\d+)$/i);
      if (m) {
        const n = parseInt(m[1], 10);
        if (n > max) max = n;
      }
    }
    return 'Add_' + String(max + 1).padStart(3, '0');
  },

  /** 深拷贝树对象 */
  cloneTree(tree) {
    return {
      id: tree.id,
      x: tree.x,
      y: tree.y,
      dbh: tree.dbh,
      height: tree.height,
      branch_height: tree.branch_height,
      window: tree.window || '',
      real_id: tree.real_id || '',
      notes: tree.notes || '',
      _origin: tree._origin || 'imported'
    };
  },

  /** 判断两棵树属性是否相同（不含 id, x, y） */
  treeAttrsEqual(a, b) {
    return a.dbh === b.dbh && a.height === b.height && (a.notes || '') === (b.notes || '');
  },

  /** 构建属性变更描述文本 */
  diffAttrs(oldTree, newTree) {
    const zh = (typeof window !== 'undefined' && window.__lang && window.__lang()) === 'zh';
    const changes = [];
    if (oldTree.x !== newTree.x) changes.push(`X: ${oldTree.x} → ${newTree.x}`);
    if (oldTree.y !== newTree.y) changes.push(`Y: ${oldTree.y} → ${newTree.y}`);
    if (oldTree.dbh !== newTree.dbh) changes.push(`DBH: ${oldTree.dbh ?? '-'} → ${newTree.dbh ?? '-'}`);
    if (oldTree.height !== newTree.height) changes.push(`Height: ${oldTree.height ?? '-'} → ${newTree.height ?? '-'}`);
    if ((oldTree.branch_height ?? null) !== (newTree.branch_height ?? null)) changes.push(`${zh ? '枝下高' : 'Branch Ht'}: ${oldTree.branch_height ?? '-'} → ${newTree.branch_height ?? '-'}`);
    if ((oldTree.window || '') !== (newTree.window || '')) changes.push(`${zh ? '生长窗口' : 'Window'}: ${oldTree.window || '-'} → ${newTree.window || '-'}`);
    if ((oldTree.real_id || '') !== (newTree.real_id || '')) changes.push(`Real ID: ${oldTree.real_id || '-'} → ${newTree.real_id || '-'}`);
    if ((oldTree.notes || '') !== (newTree.notes || '')) changes.push(zh ? 'Notes: 已修改' : 'Notes: modified');
    return changes.length > 0 ? changes.join('\n') : (zh ? '无属性变化' : 'No changes');
  },

  /** 防抖 */
  debounce(fn, delay) {
    let timer;
    return function (...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn.apply(this, args), delay);
    };
  },

  /** 绕 (cx,cy) 旋转点 (x,y)，angle 为度数 */
  rotatePoint(x, y, cx, cy, angleDeg) {
    if (!angleDeg) return { x, y };
    const rad = angleDeg * Math.PI / 180;
    const cos = Math.cos(rad), sin = Math.sin(rad);
    const dx = x - cx, dy = y - cy;
    return {
      x: cx + dx * cos - dy * sin,
      y: cy + dx * sin + dy * cos
    };
  },

  /** 计算点集中心 */
  centroid(trees) {
    if (!trees || trees.length === 0) return { cx: 0, cy: 0 };
    let sx = 0, sy = 0;
    for (const t of trees) { sx += t.x; sy += t.y; }
    return { cx: sx / trees.length, cy: sy / trees.length };
  }
};
