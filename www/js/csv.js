// csv.js — CSV 导入导出（支持中文编码 + 手动字段映射）

const CSV = (() => {

  /** 字段定义 */
  const FIELD_DEFS = [
    { key: 'id',            label: 'Lidar ID',      required: true },
    { key: 'x',             label: 'X (m)',          required: true },
    { key: 'y',             label: 'Y (m)',          required: true },
    { key: 'dbh',           label: 'DBH',           required: false, unit: true, defaultUnit: 'm' },
    { key: 'height',        label: 'Height',        required: false, unit: true, defaultUnit: 'm' },
    { key: 'branch_height', label: '枝下高',         required: false, unit: true, defaultUnit: 'm' },
    { key: 'window',        label: '生长窗口',         required: false },
    { key: 'real_id',       label: 'Real ID',        required: false },
    { key: 'notes',         label: 'Notes',          required: false },
  ];

  /** 各字段的匹配模式 */
  const MATCH_PATTERNS = {
    id:            ['lidar_id', 'tree_id', 'treeid', 'id', 'tree id'],
    x:             ['x', 'x_coord', 'xcoord', 'longitude', 'lon', 'lng', 'easting'],
    y:             ['y', 'y_coord', 'ycoord', 'latitude', 'lat', 'northing'],
    dbh:           ['dbh', 'diameter', 'dbh_cm', 'dbh (cm)'],
    height:        ['height', 'ht', 'height_m', 'height (m)', 'h'],
    branch_height: ['branch_height', 'branchheight', 'branch height', 'branch_ht'],
    window:        ['window', 'growth_window', 'growthwindow'],
    real_id:       ['real_id', 'realid', 'real id', 'field_id'],
    notes:         ['notes', 'note', 'remark', 'remarks', 'comment'],
  };

  // ====== 编码处理 ======

  function readFileAsText(file, encoding) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const bytes = new Uint8Array(reader.result);
          const decoder = new TextDecoder(encoding);
          resolve(decoder.decode(bytes));
        } catch (e) {
          const decoder = new TextDecoder('utf-8');
          resolve(decoder.decode(new Uint8Array(reader.result)));
        }
      };
      reader.onerror = () => reject(new Error((window.__lang && window.__lang()) === 'zh' ? '文件读取失败' : 'File read failed'));
      reader.readAsArrayBuffer(file);
    });
  }

  /** 从 Base64 字符串解码为文本（用于原生 APK 导入） */
  function readBase64AsText(base64, encoding) {
    const binaryStr = atob(base64);
    const bytes = new Uint8Array(binaryStr.length);
    for (let i = 0; i < binaryStr.length; i++) {
      bytes[i] = binaryStr.charCodeAt(i);
    }
    const decoder = new TextDecoder(encoding);
    return decoder.decode(bytes);
  }

  function parseCSVText(text) {
    return new Promise((resolve, reject) => {
      Papa.parse(text, {
        header: true,
        skipEmptyLines: true,
        complete(results) { resolve(results); },
        error(err) { reject(new Error(((window.__lang && window.__lang()) === 'zh' ? 'CSV 解析失败' : 'CSV parse failed') + ': ' + err.message)); }
      });
    });
  }

  // ====== 自动检测映射 ======

  function autoDetect(headers) {
    const lower = headers.map(h => String(h).toLowerCase().trim());
    const mapping = {};
    for (const def of FIELD_DEFS) {
      const pats = MATCH_PATTERNS[def.key] || [];
      for (const pat of pats) {
        const idx = lower.indexOf(pat);
        if (idx >= 0) { mapping[def.key] = headers[idx]; break; }
      }
    }
    return mapping;
  }

  // ====== 映射弹框 ======

  function showMappingDialog(file, allHeaders, allRows, encoding, callback) {
    const overlay   = document.getElementById('mapping-overlay');
    const table     = document.getElementById('mapping-table');
    const preview   = document.getElementById('mapping-preview-content');
    const encSel    = document.getElementById('mapping-encoding');
    const btnConfirm = document.getElementById('btn-mapping-confirm');
    const btnCancel  = document.getElementById('btn-mapping-cancel');
    const filenameEl = document.getElementById('mapping-filename');

    filenameEl.textContent = file.name;
    encSel.value = encoding || 'utf-8';

    const autoMap = autoDetect(allHeaders);
    const zh = (window.__lang && window.__lang()) === 'zh';
    const noneLabel = zh ? '-- 不映射 --' : '-- None --';
    const headerOpts = [noneLabel, ...allHeaders];

    function buildRows() {
      table.innerHTML = '';
      for (const def of FIELD_DEFS) {
        const row = document.createElement('div');
        row.className = 'mapping-row';

        const label = document.createElement('span');
        label.className = 'mapping-label' + (def.required ? ' required' : '');
        label.textContent = def.label;

        const select = document.createElement('select');
        select.className = 'mapping-select';
        select.dataset.key = def.key;
        for (let i = 0; i < headerOpts.length; i++) {
          const opt = document.createElement('option');
          opt.value = headerOpts[i];
          opt.textContent = headerOpts[i];
          select.appendChild(opt);
        }

        if (autoMap[def.key]) {
          select.value = autoMap[def.key];
          select.classList.add('matched');
        } else if (def.required) {
          select.classList.add('missing');
        }

        select.addEventListener('change', () => {
          select.classList.remove('matched', 'missing');
          if (select.value !== noneLabel) select.classList.add('matched');
          else if (def.required) select.classList.add('missing');
          updatePreview();
        });

        row.appendChild(label);
        row.appendChild(select);

        // 单位选择（数值字段）
        if (def.unit) {
          const unitSel = document.createElement('select');
          unitSel.className = 'mapping-unit';
          unitSel.dataset.key = def.key;
          const opts = ['m', 'cm'];
          for (const u of opts) {
            const opt = document.createElement('option');
            opt.value = u;
            opt.textContent = u;
            if (u === def.defaultUnit) opt.selected = true;
            unitSel.appendChild(opt);
          }
          row.appendChild(unitSel);
        }

        table.appendChild(row);
      }
    }

    function updatePreview() {
      const map = readMapping();
      const previewRows = allRows.slice(0, 5);
      const mappedHeaders = FIELD_DEFS.map(d => {
        const col = map[d.key];
        return col && col !== noneLabel ? d.label : null;
      });

      let html = '<table><thead><tr>';
      for (const h of mappedHeaders) { html += h ? `<th>${h}</th>` : ''; }
      html += '</tr></thead><tbody>';

      for (const row of previewRows) {
        html += '<tr>';
        for (let i = 0; i < FIELD_DEFS.length; i++) {
          const col = map[FIELD_DEFS[i].key];
          if (col && col !== noneLabel) {
            html += `<td>${String(row[col] || '').substring(0, 30)}</td>`;
          }
        }
        html += '</tr>';
      }
      html += '</tbody></table>';
      preview.innerHTML = html;
    }

    function readMapping() {
      const map = {};
      for (const def of FIELD_DEFS) {
        const sel = table.querySelector(`.mapping-select[data-key="${def.key}"]`);
        map[def.key] = (sel && sel.value !== noneLabel) ? sel.value : null;
        if (def.unit) {
          const unitSel = table.querySelector(`.mapping-unit[data-key="${def.key}"]`);
          map[def.key + '_unit'] = unitSel ? unitSel.value : def.defaultUnit;
        }
      }
      return map;
    }

    function cleanup() {
      btnConfirm.removeEventListener('click', onConfirm);
      btnCancel.removeEventListener('click', onCancel);
      encSel.removeEventListener('change', onEncChange);
    }

    function onConfirm() {
      const map = readMapping();
      for (const def of FIELD_DEFS) {
        if (def.required && !map[def.key]) {
          alert(((window.__lang && window.__lang()) === 'zh' ? '请映射必需字段: ' : 'Required field: ') + def.label);
          return;
        }
      }
      cleanup();
      overlay.style.display = 'none';
      callback({ mapping: map, encoding: encSel.value });
    }

    function onCancel() {
      cleanup();
      overlay.style.display = 'none';
      callback(null);
    }

    function onEncChange() {
      cleanup();
      overlay.style.display = 'none';
      callback({ reencode: encSel.value });
    }

    btnConfirm.addEventListener('click', onConfirm);
    btnCancel.addEventListener('click', onCancel);
    encSel.addEventListener('change', onEncChange);

    buildRows();
    updatePreview();
    overlay.style.display = 'flex';
  }

  // ====== 主导入流程 ======

  /** 原生 APK 导入（通过 Android ImportHelper） */
  function importFileNative() {
    return new Promise((resolve, reject) => {
      if (typeof ImportHelper === 'undefined' || !ImportHelper.pickCSV) {
        return reject(new Error((window.__lang && window.__lang()) === 'zh' ? '原生导入不可用' : 'Native import unavailable'));
      }

      // 全局回调：原生端选择文件后会调用
      window._onCSVFilePicked = (fileName, base64Content) => {
        delete window._onCSVFilePicked;
        delete window._onCSVFilePickedError;

        let encoding = 'utf-8';

        function tryParse() {
          let text;
          try {
            text = readBase64AsText(base64Content, encoding);
          } catch (e) {
            return reject(new Error((window.__lang && window.__lang()) === 'zh' ? '文件解码失败' : 'Decode failed'));
          }

          parseCSVText(text).then(results => {
            const allHeaders = results.meta.fields || [];
            const allRows = results.data;
            if (allHeaders.length === 0 || allRows.length === 0) {
              return reject(new Error((window.__lang && window.__lang()) === 'zh' ? 'CSV 文件为空或无法解析' : 'CSV is empty or unreadable'));
            }

            // 构造一个伪 File 对象用于映射弹框
            const pseudoFile = { name: fileName };
            showMappingDialog(pseudoFile, allHeaders, allRows, encoding, result => {
              if (!result) return reject(new Error((window.__lang && window.__lang()) === 'zh' ? '用户取消导入' : 'User cancelled'));
              if (result.reencode) {
                encoding = result.reencode;
                tryParse();
                return;
              }
              resolve(buildTrees(allRows, result.mapping));
            });
          }).catch(reject);
        }

        tryParse();
      };

      window._onCSVFilePickedError = (errMsg) => {
        delete window._onCSVFilePicked;
        delete window._onCSVFilePickedError;
        reject(new Error(errMsg));
      };

      ImportHelper.pickCSV();
    });
  }

  function importFile(file) {
    return new Promise((resolve, reject) => {
      let encoding = 'utf-8';

      function tryParse() {
        readFileAsText(file, encoding).then(text => {
          parseCSVText(text).then(results => {
            const allHeaders = results.meta.fields || [];
            const allRows = results.data;
            if (allHeaders.length === 0 || allRows.length === 0) {
              return reject(new Error((window.__lang && window.__lang()) === 'zh' ? 'CSV 文件为空或无法解析' : 'CSV is empty or unreadable'));
            }

            showMappingDialog(file, allHeaders, allRows, encoding, result => {
              if (!result) return reject(new Error((window.__lang && window.__lang()) === 'zh' ? '用户取消导入' : 'User cancelled'));
              if (result.reencode) {
                encoding = result.reencode;
                tryParse();
                return;
              }

              const map = result.mapping;
              resolve(buildTrees(allRows, map));
            });
          }).catch(reject);
        }).catch(reject);
      }

      tryParse();
    });
  }

  function buildTrees(allRows, map) {
    const trees = [];
    for (const row of allRows) {
      const idVal = String(row[map.id] || '').trim();
      const xVal = parseFloat(row[map.x]);
      const yVal = parseFloat(row[map.y]);
      if (!idVal || isNaN(xVal) || isNaN(yVal)) continue;

      const rawDbh = map.dbh ? parseNumOrNull(row[map.dbh]) : null;
      const rawHt  = map.height ? parseNumOrNull(row[map.height]) : null;
      const rawBh  = map.branch_height ? parseNumOrNull(row[map.branch_height]) : null;

      trees.push({
        id: idVal, x: xVal, y: yVal,
        dbh:           convertUnit(rawDbh, map.dbh_unit || 'm', 'cm'),
        height:        convertUnit(rawHt,  map.height_unit || 'm', 'm'),
        branch_height: convertUnit(rawBh,  map.branch_height_unit || 'm', 'm'),
        window:        map.window        ? String(row[map.window] || '').trim()   : '',
        real_id:       map.real_id       ? String(row[map.real_id] || '').trim()  : '',
        notes:         map.notes         ? String(row[map.notes] || '').trim()    : ''
      });
    }
    return trees;
  }

  function parseNumOrNull(val) {
    if (val === null || val === undefined || String(val).trim() === '') return null;
    const n = parseFloat(val);
    return isNaN(n) ? null : n;
  }

  /** 单位转换: fromUnit → toUnit */
  function convertUnit(val, from, to) {
    if (val == null) return null;
    if (from === to) return val;
    if (from === 'cm' && to === 'm') return val / 100;
    if (from === 'm' && to === 'cm') return val * 100;
    return val;
  }

  // ====== 导出 ======

  function exportCSV(trees) {
    const headers = ['lidar_id', 'real_id', 'x', 'y', 'x_shifted', 'y_shifted', 'dbh', 'height', 'branch_height', 'window', 'notes'];
    const lines = [headers.join(',')];
    for (const t of trees) {
      lines.push([
        t.id, t.real_id || '', t.x, t.y,
        t.x_shifted != null ? Math.round(t.x_shifted * 100) / 100 : '',
        t.y_shifted != null ? Math.round(t.y_shifted * 100) / 100 : '',
        t.dbh != null ? t.dbh : '', t.height != null ? t.height : '',
        t.branch_height != null ? t.branch_height : '', t.window || '',
        t.notes ? `"${t.notes.replace(/"/g, '""')}"` : ''
      ].join(','));
    }
    return lines.join('\n');
  }

  function downloadCSV(trees, filename) {
    const csvStr = exportCSV(trees);
    const content = '\uFEFF' + csvStr;

    // Android APK: 通过原生 Java 接口保存到 Downloads
    if (typeof ExportHelper !== 'undefined' && ExportHelper.saveCSV) {
      ExportHelper.saveCSV(content, filename);
      return;
    }

    // 浏览器回退: Blob 下载
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.style.display = 'none';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 500);
  }

  return { importFile, importFileNative, exportCSV, downloadCSV, readBase64AsText };
})();
