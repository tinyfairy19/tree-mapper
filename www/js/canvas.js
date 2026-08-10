// canvas.js — Canvas 渲染引擎 + 交互

const Canvas = (() => {
  let canvas, ctx;
  let trees = [];
  let viewCenterX = 50, viewCenterY = 50;  // 世界坐标中心
  let viewScale = 5;   // px/m
  let dbhScale = 0.05; // m/cm (DBH → 世界半径)
  let defaultDbh = 20; // cm，无 DBH 时默认
  let selectedId = null;
  let highlightedId = null; // 临时高亮（跳转用）
  let highlightedClickId = null; // 单击高亮（红色，再次点击打开编辑）
  let boundaryPoints = [];       // 样地边界点 [{x, y}, ...]
  let showTreeLabels = true;  // 是否显示 Tree ID 标签
  let showDbhLabels = true;   // 是否显示 DBH 标签
  let showRealIdLabels = true; // 是否显示 Real ID 标签
  let dpr = 1;                // device pixel ratio
  let rotationAngle = 0;      // 旋转角度 (0-360)

  // 交互状态
  let dragging = false;
  let dragStartX, dragStartY;
  let dragCenterStartX, dragCenterStartY;
  let lastPinchDist = 0;
  let pinchAnchorSX, pinchAnchorSY;  // 捏合起始锚点（屏幕坐标，固定不变）
  let pinchWorldX, pinchWorldY;      // 锚点对应的世界坐标
  let pinchScaleStart;
  let pinchActive = false;     // 是否正在进行捏合
  let gestureCooldown = false; // 手势冷却中，忽略新操作
  let longPressTimer = null;
  let isLongPress = false;
  let longPressPos = null;
  let crosshairVisible = false;
  let crosshairWorld = null;
  let activePointers = {}; // 追踪多指

  // 回调
  let onTreeClick = null;
  let onTreeAdd = null;

  const MIN_SCALE = 0.5;
  const MAX_SCALE = 50;

  function init(canvasEl) {
    canvas = canvasEl;
    ctx = canvas.getContext('2d');
    resize();
    window.addEventListener('resize', Utils.debounce(resize, 150));
    bindEvents();
  }

  function resize() {
    const container = canvas.parentElement;
    const w = container.clientWidth;
    const h = container.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    render();
  }

  function setData(newTrees) {
    trees = newTrees;
    selectedId = null;
    highlightedId = null;
    highlightedClickId = null;
    render();
  }

  function autoFitView() {
    const bp = Array.isArray(boundaryPoints) ? boundaryPoints : [];
    const allPts = [...trees.map(t => ({ x: t.x, y: t.y })), ...bp];
    if (allPts.length === 0) return;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const p of allPts) {
      if (p.x < minX) minX = p.x;
      if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) maxY = p.y;
    }
    const pad = Math.max((maxX - minX), (maxY - minY), 10) * 0.15;
    const dataW = (maxX - minX) + pad * 2;
    const dataH = (maxY - minY) + pad * 2;
    viewCenterX = (minX + maxX) / 2;
    viewCenterY = (minY + maxY) / 2;
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    viewScale = Math.min(cw / dataW, ch / dataH);
    viewScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, viewScale));
  }

  // ========== 坐标变换 ==========

  function screenToWorld(sx, sy) {
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    return {
      x: (sx - cw / 2) / viewScale + viewCenterX,
      y: -(sy - ch / 2) / viewScale + viewCenterY
    };
  }

  function worldToScreen(wx, wy) {
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;
    return {
      x: (wx - viewCenterX) * viewScale + cw / 2,
      y: -(wy - viewCenterY) * viewScale + ch / 2
    };
  }

  // ========== 命中检测 ==========

  function findTreeAt(sx, sy) {
    if (trees.length === 0) return null;
    const wp = screenToWorld(sx, sy);
    const hitRadius = 15 / viewScale;
    const { cx: rotCx, cy: rotCy } = Utils.centroid(trees);
    let best = null;
    let bestDist = Infinity;
    for (const t of trees) {
      const rp = Utils.rotatePoint(t.x, t.y, rotCx, rotCy, rotationAngle);
      const dx = rp.x - wp.x;
      const dy = rp.y - wp.y;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const r = treeWorldRadius(t);
      if (dist < Math.max(r, hitRadius) && dist < bestDist) {
        best = t;
        bestDist = dist;
      }
    }
    return best;
  }

  function treeWorldRadius(tree) {
    return ((tree.dbh != null ? tree.dbh : defaultDbh) * dbhScale);
  }

  // ========== 渲染 ==========

  function render() {
    if (!ctx || !canvas) return;
    const cw = canvas.clientWidth;
    const ch = canvas.clientHeight;

    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 设置变换: 原点在画布中心，Y 轴向上
    ctx.translate(cw / 2, ch / 2);
    ctx.scale(viewScale, -viewScale);
    ctx.translate(-viewCenterX, -viewCenterY);

    // 计算可视范围（世界坐标）
    const margin = 0.5;
    const vMinX = viewCenterX - (cw / 2) / viewScale - margin;
    const vMaxX = viewCenterX + (cw / 2) / viewScale + margin;
    const vMinY = viewCenterY - (ch / 2) / viewScale - margin;
    const vMaxY = viewCenterY + (ch / 2) / viewScale + margin;

    // 网格线
    drawGrid(vMinX, vMaxX, vMinY, vMaxY);

    // 旋转中心：树木 + 边界点合并计算
    const bp = Array.isArray(boundaryPoints) ? boundaryPoints : [];
    const allPts = [...trees.map(t => ({ x: t.x, y: t.y })), ...bp];
    const { cx: rotCx, cy: rotCy } = Utils.centroid(allPts.length > 0 ? allPts : [{ id: 'dummy', x: 0, y: 0 }]);

    // 树木（应用旋转坐标）
    for (const t of trees) {
      const pos = Utils.rotatePoint(t.x, t.y, rotCx, rotCy, rotationAngle);
      const r = treeWorldRadius(t);
      if (pos.x + r < vMinX || pos.x - r > vMaxX || pos.y + r < vMinY || pos.y - r > vMaxY) continue;
      const isSelected = t.id === selectedId || t.id === highlightedId;
      const isClickHighlighted = t.id === highlightedClickId;
      drawTreeAt(t, pos.x, pos.y, r, isSelected, isClickHighlighted);
    }

    // 样地边界点（黑点，也随旋转）
    if (boundaryPoints.length > 0) {
      drawBoundaryPoints(vMinX, vMaxX, vMinY, vMaxY, rotCx, rotCy);
    }

    ctx.restore();
  }

  function drawGrid(minX, maxX, minY, maxY) {
    // 5m 网格
    drawGridLines(minX, maxX, minY, maxY, 5, 'rgba(180,180,180,0.4)', 1 / viewScale);
    // 1m 网格
    drawGridLines(minX, maxX, minY, maxY, 1, 'rgba(210,210,210,0.25)', 1 / viewScale);
  }

  function drawGridLines(minX, maxX, minY, maxY, step, color, lineWidth) {
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.beginPath();

    const startX = Math.floor(minX / step) * step;
    const startY = Math.floor(minY / step) * step;

    for (let x = startX; x <= maxX; x += step) {
      ctx.moveTo(x, minY);
      ctx.lineTo(x, maxY);
    }
    for (let y = startY; y <= maxY; y += step) {
      ctx.moveTo(minX, y);
      ctx.lineTo(maxX, y);
    }
    ctx.stroke();
  }

  function drawTreeAt(tree, wx, wy, r, isHighlighted, isClickHighlighted) {
    const isImported = tree._origin === 'imported';
    const isAdded = tree._origin === 'added';

    // 填充颜色
    ctx.beginPath();
    ctx.arc(wx, wy, r, 0, Math.PI * 2);

    if (isClickHighlighted) {
      // 单击红色高亮
      ctx.fillStyle = 'rgba(231, 76, 60, 0.6)';
    } else if (isHighlighted) {
      ctx.fillStyle = 'rgba(231, 76, 60, 0.6)';
    } else if (isImported) {
      ctx.fillStyle = 'rgba(39, 174, 96, 0.5)';
    } else if (isAdded) {
      ctx.fillStyle = 'rgba(241, 196, 15, 0.55)';
    } else {
      ctx.fillStyle = 'rgba(52, 152, 219, 0.55)';
    }
    ctx.fill();

    // 边框
    if (isClickHighlighted || isHighlighted) {
      ctx.strokeStyle = 'rgba(192, 57, 43, 0.9)';
      ctx.lineWidth = 3 / viewScale;
    } else if (isImported) {
      ctx.strokeStyle = 'rgba(30, 132, 73, 0.7)';
      ctx.lineWidth = 2 / viewScale;
    } else if (isAdded) {
      ctx.strokeStyle = 'rgba(200, 160, 10, 0.7)';
      ctx.lineWidth = 2 / viewScale;
    } else {
      ctx.strokeStyle = 'rgba(41, 128, 185, 0.7)';
      ctx.lineWidth = 2 / viewScale;
    }
    ctx.stroke();

    // ====== 标签：在世界坐标中定位 ======
    if (showTreeLabels) {
      ctx.save();
      ctx.translate(wx, wy + r + 3 / viewScale);
      ctx.scale(1 / viewScale, -1 / viewScale);
      ctx.font = 'bold 11px sans-serif';
      ctx.fillStyle = (isHighlighted || isClickHighlighted) ? '#c0392b' : '#2c3e50';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(tree.id, 0, 0);
      ctx.restore();
    }

    if (showRealIdLabels && tree.real_id) {
      ctx.save();
      const offset = showTreeLabels ? 16 / viewScale : 3 / viewScale;
      ctx.translate(wx, wy + r + offset);
      ctx.scale(1 / viewScale, -1 / viewScale);
      ctx.font = 'italic 10px sans-serif';
      ctx.fillStyle = '#8e44ad';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(tree.real_id, 0, 0);
      ctx.restore();
    }

    if (showDbhLabels && tree.dbh != null) {
      ctx.save();
      ctx.translate(wx, wy - r - 1 / viewScale);
      ctx.scale(1 / viewScale, -1 / viewScale);
      ctx.font = '9px sans-serif';
      ctx.fillStyle = '#7f8c8d';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText((Math.round(tree.dbh * 100) / 100) + 'cm', 0, 0);
      ctx.restore();
    }
  }

  // ========== 交互事件 ==========

  function bindEvents() {
    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointerleave', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
  }

  function getEventPos(e) {
    const rect = canvas.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  function onPointerDown(e) {
    // 手势冷却中，忽略新触摸
    if (gestureCooldown) return;

    activePointers[e.pointerId] = { x: e.clientX, y: e.clientY };
    const count = Object.keys(activePointers).length;

    if (count === 2) {
      // 双指开始 — 锁定锚点（屏幕位置 + 世界坐标），缩放期间不可平移
      clearLongPress();
      dragging = false;
      pinchActive = true;
      crosshairVisible = false;
      document.getElementById('crosshair').style.display = 'none';
      const pts = Object.values(activePointers);
      const rect = canvas.getBoundingClientRect();
      pinchAnchorSX = (pts[0].x + pts[1].x) / 2 - rect.left;
      pinchAnchorSY = (pts[0].y + pts[1].y) / 2 - rect.top;
      const cw = canvas.clientWidth;
      const ch = canvas.clientHeight;
      pinchWorldX = (pinchAnchorSX - cw / 2) / viewScale + viewCenterX;
      pinchWorldY = -(pinchAnchorSY - ch / 2) / viewScale + viewCenterY;
      lastPinchDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      pinchScaleStart = viewScale;
      return;
    }

    if (count > 2) return;

    // 单指
    const pos = getEventPos(e);
    dragging = false;
    isLongPress = false;
    dragStartX = pos.x;
    dragStartY = pos.y;
    dragCenterStartX = viewCenterX;
    dragCenterStartY = viewCenterY;

    clearLongPress();
    longPressPos = pos;
    longPressTimer = setTimeout(() => {
      isLongPress = true;
      const wp = screenToWorld(longPressPos.x, longPressPos.y);
      const hit = findTreeAt(longPressPos.x, longPressPos.y);
      if (!hit && onTreeAdd) {
        crosshairVisible = true;
        crosshairWorld = wp;
        updateCrosshair(longPressPos.x, longPressPos.y);
        document.getElementById('crosshair').style.display = 'block';
      }
    }, 500);
  }

  function onPointerMove(e) {
    // 手势冷却中，忽略所有移动（防止缩放结束后残留的 pointermove 造成漂移）
    if (gestureCooldown) return;

    // 更新活跃指针位置
    if (activePointers[e.pointerId]) {
      activePointers[e.pointerId] = { x: e.clientX, y: e.clientY };
    }
    const count = Object.keys(activePointers).length;

    // 双指捏合缩放（锁定锚点，不可平移）
    if (count === 2 && lastPinchDist > 0) {
      const pts = Object.values(activePointers);
      const newDist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      if (Math.abs(newDist - lastPinchDist) < 1) return;

      const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, pinchScaleStart * (newDist / lastPinchDist)));

      // 始终以初始锚点为基准，缩放期间不可平移
      const cw = canvas.clientWidth;
      const ch = canvas.clientHeight;
      viewScale = newScale;
      viewCenterX = pinchWorldX - (pinchAnchorSX - cw / 2) / viewScale;
      viewCenterY = pinchWorldY + (pinchAnchorSY - ch / 2) / viewScale;
      render();
      return;
    }

    // 捏合已结束或指头数异常 → 跳过单指拖拽，防止状态不一致
    if (pinchActive || count > 2) return;

    if (count !== 1) return;

    const pos = getEventPos(e);
    if (crosshairVisible) {
      crosshairWorld = screenToWorld(pos.x, pos.y);
      updateCrosshair(pos.x, pos.y);
      return;
    }

    if (!dragging && !isLongPress) {
      const dx = pos.x - dragStartX;
      const dy = pos.y - dragStartY;
      if (Math.sqrt(dx * dx + dy * dy) > 10) {
        dragging = true;
        clearLongPress();
      }
    }

    if (dragging) {
      viewCenterX = dragCenterStartX - (pos.x - dragStartX) / viewScale;
      viewCenterY = dragCenterStartY + (pos.y - dragStartY) / viewScale;
      render();
    }
  }

  function onPointerUp(e) {
    delete activePointers[e.pointerId];
    const remaining = Object.keys(activePointers).length;

    // 捏合中一根手指抬起 → 立即取消捏合，防止后续单指拖拽造成漂移
    if (pinchActive && remaining > 0) {
      pinchActive = false;
      lastPinchDist = 0;
      gestureCooldown = true;
      setTimeout(() => { gestureCooldown = false; }, 300);
      return;
    }

    if (remaining > 0) return;

    const wasPinch = pinchActive;
    lastPinchDist = 0;
    pinchActive = false;
    clearLongPress();

    // 捏合结束后进入 0.3s 冷却，防止误触
    if (wasPinch) {
      gestureCooldown = true;
      setTimeout(() => { gestureCooldown = false; }, 300);
      return;
    }

    if (crosshairVisible) {
      crosshairVisible = false;
      document.getElementById('crosshair').style.display = 'none';
      if (onTreeAdd && crosshairWorld) {
        onTreeAdd(crosshairWorld.x, crosshairWorld.y);
      }
      crosshairWorld = null;
      return;
    }

    // 单击检测仅在真正的 pointerup 中执行，避免 pointerleave 重复触发
    if (e.type === 'pointerup' && !dragging && !isLongPress) {
      const pos = getEventPos(e);
      const hit = findTreeAt(pos.x, pos.y);
      if (hit) {
        if (highlightedClickId === hit.id) {
          // 第二次点击同一棵树 → 打开编辑
          highlightedClickId = null;
          setSelected(hit.id);
          if (onTreeClick) onTreeClick(hit);
        } else {
          // 第一次点击 → 红色高亮
          highlightedClickId = hit.id;
          selectedId = null;
          render();
        }
      } else {
        // 点击空白 → 取消高亮
        highlightedClickId = null;
        selectedId = null;
        render();
      }
    }

    dragging = false;
    isLongPress = false;
  }

  function onWheel(e) {
    e.preventDefault();
    const pos = getEventPos(e);
    const worldBefore = screenToWorld(pos.x, pos.y);

    const zoomFactor = 1.08;
    if (e.deltaY < 0) {
      viewScale = Math.min(MAX_SCALE, viewScale * zoomFactor);
    } else {
      viewScale = Math.max(MIN_SCALE, viewScale / zoomFactor);
    }

    // 以鼠标位置为中心缩放
    const worldAfter = screenToWorld(pos.x, pos.y);
    viewCenterX += worldBefore.x - worldAfter.x;
    viewCenterY += worldBefore.y - worldAfter.y;

    render();
  }

  function clearLongPress() {
    if (longPressTimer) {
      clearTimeout(longPressTimer);
      longPressTimer = null;
    }
  }

  /** 绘制样地边界点（小黑圆点） */
  function drawBoundaryPoints(vMinX, vMaxX, vMinY, vMaxY, rotCx, rotCy) {
    const bp = Array.isArray(boundaryPoints) ? boundaryPoints : [];
    if (bp.length === 0) return;
    const r = 2.5 / viewScale;
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.lineWidth = 0.8 / viewScale;
    for (const bpPt of bp) {
      const pos = Utils.rotatePoint(bpPt.x, bpPt.y, rotCx, rotCy, rotationAngle);
      if (pos.x + r < vMinX || pos.x - r > vMaxX || pos.y + r < vMinY || pos.y - r > vMaxY) continue;
      ctx.beginPath();
      ctx.arc(pos.x, pos.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  function updateCrosshair(sx, sy) {
    const el = document.getElementById('crosshair');
    const container = canvas.parentElement;
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    // 全画布十字线：水平线 + 垂直线
    el.innerHTML = `
      <div class="cross-h" style="top:${sy}px;left:0;width:${cw}px;height:2px;"></div>
      <div class="cross-v" style="left:${sx}px;top:0;width:2px;height:${ch}px;"></div>
    `;
  }

  // ========== 公开接口 ==========

  function setSelected(id) {
    selectedId = id;
    highlightedId = null;
    render();
  }

  function clearSelection() {
    selectedId = null;
    highlightedId = null;
    highlightedClickId = null;
    render();
  }

  /** 跳转到指定 ID 的树并高亮（使用旋转后坐标） */
  function jumpToTree(id) {
    const tree = trees.find(t => t.id === id);
    if (!tree) return;
    const { cx, cy } = Utils.centroid(trees);
    const rp = Utils.rotatePoint(tree.x, tree.y, cx, cy, rotationAngle);
    viewCenterX = rp.x;
    viewCenterY = rp.y;
    highlightedId = id;
    selectedId = id;
    render();
    // 2 秒后取消高亮
    setTimeout(() => {
      if (highlightedId === id) {
        highlightedId = null;
        render();
      }
    }, 2000);
  }

  function setDbhScale(s) {
    dbhScale = s;
    render();
  }

  function getViewState() {
    return { viewCenterX, viewCenterY, viewScale, dbhScale };
  }

  function setViewState(state) {
    if (state.viewCenterX != null) viewCenterX = state.viewCenterX;
    if (state.viewCenterY != null) viewCenterY = state.viewCenterY;
    if (state.viewScale != null) viewScale = state.viewScale;
    if (state.dbhScale != null) dbhScale = state.dbhScale;
  }

  return {
    init, setData, render,
    setSelected, clearSelection, jumpToTree, autoFitView,
    setDbhScale, getViewState, setViewState,
    findTreeAt, screenToWorld,
    set showTreeLabels(v) { showTreeLabels = v; render(); },
    get showTreeLabels() { return showTreeLabels; },
    set showDbhLabels(v) { showDbhLabels = v; render(); },
    get showDbhLabels() { return showDbhLabels; },
    set showRealIdLabels(v) { showRealIdLabels = v; render(); },
    get showRealIdLabels() { return showRealIdLabels; },
    set rotationAngle(v) { rotationAngle = v; render(); },
    get rotationAngle() { return rotationAngle; },
    getRotatedPosition(x, y) {
      const bp = Array.isArray(boundaryPoints) ? boundaryPoints : [];
      const allPts = [...trees.map(t => ({ x: t.x, y: t.y })), ...bp];
      const { cx, cy } = Utils.centroid(allPts.length > 0 ? allPts : [{ id: 'dummy', x: 0, y: 0 }]);
      return Utils.rotatePoint(x, y, cx, cy, rotationAngle);
    },
    getOriginalPosition(rx, ry) {
      const bp = Array.isArray(boundaryPoints) ? boundaryPoints : [];
      const allPts = [...trees.map(t => ({ x: t.x, y: t.y })), ...bp];
      const { cx, cy } = Utils.centroid(allPts.length > 0 ? allPts : [{ id: 'dummy', x: 0, y: 0 }]);
      return Utils.rotatePoint(rx, ry, cx, cy, -rotationAngle);
    },
    set onTreeClick(v) { onTreeClick = v; },
    set onTreeAdd(v) { onTreeAdd = v; },
    setBoundary(pts) { boundaryPoints = Array.isArray(pts) ? pts : []; autoFitView(); render(); },
    clearBoundary() { boundaryPoints = []; render(); }
  };
})();
