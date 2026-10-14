/* ============================================================
   ui.js — 面板渲染与交互编排
   ------------------------------------------------------------
   角色权限（模拟登录身份）：
     开单医生   ：可新增 / 编辑 / 删除标记，可提交三方核查，可参与核查
     主刀医生   ：只读标记，只能参与核查
     手术室护士 ：只读标记，只能参与核查
   ============================================================ */
(function () {
  const SMK = (window.SMK = window.SMK || {});
  const U = SMK.util;
  const C = SMK.catalog;
  const Store = SMK.store;

  const UI = {
    viewer: null,
    role: 'orderer',
    tool: 'select',
    selectedMarkerId: null,
    newType: 'incision',
    regionDraft: [],
    measureDraft: [],
    partQuery: '',            // 按部位选择面板的搜索词
    activeRegionKey: null,    // 当前选中的解剖部位
    expandedParts: {},        // 体表部位清单里已展开下钻的项
    _viewerReady: false
  };

  const $ = function (id) { return document.getElementById(id); };
  const PERM_EDIT = function () { return UI.role === 'orderer' && Store.isEditable(); };

  /* ---------------- 初始化 ---------------- */

  UI.init = function (viewer) {
    this.viewer = viewer;
    this._bindTopbar();
    this._bindToolbar();
    this._bindLeftPanel();
    this._bindTabs();
    this._bindViewerEvents();
    this._bindKeys();
    Store.onChange(function (evt) { UI.refresh(evt); });
    this.refresh();
  };

  /* ---------------- 顶栏 ---------------- */

  UI._bindTopbar = function () {
    $('roleSelect').addEventListener('change', function (e) {
      UI.setRole(e.target.value);
    });
    $('btnExportJson').addEventListener('click', function () { Store.exportJson(); });
    $('btnImportJson').addEventListener('click', function () { $('fileInput').click(); });
    $('fileInput').addEventListener('change', function (e) {
      const f = e.target.files && e.target.files[0];
      if (!f) return;
      const rd = new FileReader();
      rd.onload = function () {
        Store.importJson(String(rd.result));
        UI.selectedMarkerId = null;
        UI.cancelDraft();
      };
      rd.readAsText(f, 'utf-8');
      e.target.value = '';
    });
    $('btnScreenshot').addEventListener('click', function () {
      const v = Store.current();
      const a1 = document.createElement('a');
      a1.href = UI.viewer.snapshot();
      a1.download = '手术标记_' + Store.state.caseId + '_v' + v.version + '.png';
      a1.click();
      U.toast('已导出当前视图截图', 'ok');
    });
    $('btnReset').addEventListener('click', function () {
      if (!window.confirm('将清空本机保存的演示数据并重新生成示例标记，是否继续？')) return;
      Store.clearStorage();
      Store.load();
      UI.selectedMarkerId = null;
      UI.cancelDraft();
      SMK.app.seedDemo();
      UI.refresh();
      U.toast('演示数据已重置', 'ok');
    });
  };

  UI.setRole = function (role) {
    this.role = role;
    if (!PERM_EDIT()) {
      this.cancelDraft();
      if (this.tool !== 'select') { this.setTool('select'); }
    }
    this.refresh();
    const r = C.ROLES.filter(function (x) { return x.key === role; })[0];
    U.toast('已切换为「' + r.name + '」视角', null);
  };

  /* ---------------- 工具栏与视角 ---------------- */

  UI._bindToolbar = function () {
    document.querySelectorAll('#toolRail .tool').forEach(function (btn) {
      btn.addEventListener('click', function () { UI.setTool(btn.dataset.tool); });
    });
    document.querySelectorAll('#viewBar .view-group button').forEach(function (btn) {
      btn.addEventListener('click', function () {
        document.querySelectorAll('#viewBar .view-group button').forEach(function (b) { b.classList.remove('active'); });
        btn.classList.add('active');
        UI.viewer.setView(btn.dataset.view);
      });
    });
    $('btnFit').addEventListener('click', function () { UI.viewer.fit(); });
    $('btnGhost').addEventListener('click', function () {
      const on = !UI.viewer.ghost;
      UI.viewer.setGhost(on);
      $('btnGhost').classList.toggle('active', on);
    });
    $('btnToggleMarkers').addEventListener('click', function () {
      const on = !UI.viewer.markersVisible;
      UI.viewer.setMarkerVisible(on);
      $('btnToggleMarkers').classList.toggle('active', on);
    });
    $('btnFinishRegion').addEventListener('click', function () { UI.finishRegion(); });
    $('btnCancelRegion').addEventListener('click', function () { UI.cancelDraft(); });
  };

  UI.setTool = function (tool) {
    if (tool !== 'select' && !PERM_EDIT()) {
      U.toast(this.role === 'orderer' ? '当前版本状态为「' + C.STATUS_TEXT[Store.current().status] + '」，不可编辑' : '当前身份无标记编辑权限（仅开单医生可标记）', 'warn');
      return;
    }
    if (tool !== this.tool) this.cancelDraft();
    this.tool = tool;
    document.querySelectorAll('#toolRail .tool').forEach(function (b) {
      b.classList.toggle('active', b.dataset.tool === tool);
    });
    const hints = {
      select: '拖拽旋转视角，滚轮缩放，右键 / 双指平移；单击标记可选中。',
      part: '在模型上单击任意位置，即整块选中该处所属的解剖结构（如肝、胆囊、股骨、髋骨），随后可一键标记。',
      point: '在模型表面单击，放置一个点标记。',
      region: '在模型表面依次单击取点（≥3 个），再点“闭合成区域”。也可改用「部位」工具直接选中整个解剖结构。',
      measure: '在模型表面单击两个点，即可测量两点间距。'
    };
    $('statusHint').textContent = hints[tool] || '';
    this.viewer.setInteractMode(tool);
    this.viewer.setHoverRegion(null);
    this._syncDraftBar();
  };

  /* ---------------- 左侧面板 ---------------- */

  UI._bindLeftPanel = function () {
    $('caseTitle').addEventListener('input', U.debounce(function (e) {
      Store.mutate(function (st) { st.title = e.target.value; }, { type: 'quiet' });
    }, 350));

    document.querySelectorAll('#lateralitySeg button').forEach(function (b) {
      b.addEventListener('click', function () {
        if (!PERM_EDIT()) { U.toast('无编辑权限或版本已锁定', 'warn'); return; }
        Store.mutate(function (st, v) { v.laterality = (v.laterality === b.dataset.v) ? null : b.dataset.v; }, { type: 'case' });
      });
    });

    $('caseNote').addEventListener('input', U.debounce(function (e) {
      if (!PERM_EDIT()) return;
      Store.mutate(function (st, v) { v.note = e.target.value; }, { type: 'quiet' });
    }, 350));

    $('btnNewRevision').addEventListener('click', function () {
      const v = Store.current();
      if (v.status === 'draft' && v.markers.length === 0) { U.toast('当前版本尚无内容，无需新建修订版', 'warn'); return; }
      if (!window.confirm('将基于 v' + v.version + ' 复制标记并生成新的草稿版本，是否继续？')) return;
      Store.addRevision();
      UI.selectedMarkerId = null;
      UI.cancelDraft();
      U.toast('已新建修订版', 'ok');
    });

    $('btnSubmitVerify').addEventListener('click', function () {
      const v = Store.current();
      // 被退回的版本不再接受直接提交，引导先建修订版
      if (v.status === 'rejected') {
        if (!window.confirm('当前版本已被退回。将基于其标记新建修订版（草稿），修改后可重新提交核查。是否继续？')) return;
        Store.addRevision();
        UI.selectedMarkerId = null;
        UI.cancelDraft();
        U.toast('已新建修订版，请核对标记后重新提交', 'ok');
        return;
      }
      if (UI.role !== 'orderer') { U.toast('仅开单医生可提交三方核查', 'warn'); return; }
      const c = Store.canSubmit();
      if (!c.ok) { U.toast(c.reason, 'warn'); return; }
      Store.submitToVerify();
      UI.cancelDraft();
      U.toast('已提交三方核查。请切换身份（主刀医生 / 手术室护士）完成核对。', 'ok');
      UI.switchTab('verify');
    });
  };

  /* ---------------- Tab ---------------- */

  UI._bindTabs = function () {
    document.querySelectorAll('.tabs .tab').forEach(function (t) {
      t.addEventListener('click', function () { UI.switchTab(t.dataset.tab); });
    });
  };

  UI.switchTab = function (name) {
    document.querySelectorAll('.tabs .tab').forEach(function (t) {
      t.classList.toggle('active', t.dataset.tab === name);
    });
    ['markers', 'parts', 'verify', 'range'].forEach(function (k) {
      $('pane-' + k).classList.toggle('hidden', k !== name);
    });
    if (name === 'parts') UI.renderParts();
  };

  /* ---------------- Viewer 事件 ---------------- */

  UI._bindViewerEvents = function () {
    this.viewer.onPick(function (ev) { UI.handlePick(ev); });
    this.viewer.onHover(function (info) {
      if (!info) {
        $('statusProbe').textContent = '指向模型可查看解剖结构';
        UI.viewer.setHoverRegion(null);
        return;
      }
      const lat = info.laterality ? ' · ' + C.LATERALITY_TEXT[info.laterality] : '';
      $('statusProbe').textContent = '结构：' + info.regionName + '（' + (info.partName || '') + '）' + lat +
        (UI.tool === 'part' ? '（单击即整块选中）' : '');
      // 指向哪里，就把该处的整个解剖结构淡淡点亮 ——
      // 让「我指的是哪块肌肉 / 哪块骨」一目了然。
      UI.viewer.setHoverRegion(info.regionKey || null);
    });
  };

  UI.handlePick = function (ev) {
    if (ev.type === 'marker') {
      this.selectedMarkerId = ev.markerId;
      this.viewer.setSelected(ev.markerId);
      this.renderMarkers();
      this.switchTab('markers');
      return;
    }
    if (ev.type !== 'body') return;

    // 部位工具：点哪里，就整块选中那一处所属的解剖部位
    if (this.tool === 'part') {
      this.selectRegion(ev.regionKey, { animate: true, focus: false });
      U.toast('已选中部位：' + ev.regionName +
        (ev.laterality ? '（' + C.LATERALITY_TEXT[ev.laterality] + '）' : ''), 'ok');
      return;
    }

    if (this.tool === 'point') {
      const m = Store.addMarker({
        kind: 'point', type: this.newType, name: '',
        laterality: ev.laterality || null,
        regionName: ev.regionName, partName: ev.partName,
        anchors: [ev.anchor]
      });
      if (m) {
        this.selectedMarkerId = m.id;
        U.toast('已添加点标记：' + ev.regionName, 'ok');
        this.setTool('select');
      }
      return;
    }

    if (this.tool === 'region') {
      // 区域面片需贴合同一解剖部件，跨部件会在凹陷处悬空
      if (this.regionDraft.length && ev.anchor.meshId !== this.regionDraft[0].anchor.meshId) {
        U.toast('区域标记需取在同一部件上（已从「' + this.regionDraft[0].partName + '」开始）。如需跨部位，请分成多个区域分别标记。', 'warn');
        return;
      }
      this.regionDraft.push({ anchor: ev.anchor, regionName: ev.regionName, partName: ev.partName, laterality: ev.laterality });
      this.viewer.setDraft(this.regionDraft);
      this._syncDraftBar();
      return;
    }

    if (this.tool === 'measure') {
      this.measureDraft.push({ anchor: ev.anchor, worldPoint: ev.worldPoint.clone() });
      this.viewer.setDraft(this.measureDraft);
      if (this.measureDraft.length === 2) {
        const a = SMK.anchors.resolve(this.measureDraft[0].anchor, this.viewer.bodyRoot);
        const b = SMK.anchors.resolve(this.measureDraft[1].anchor, this.viewer.bodyRoot);
        const mm = Math.round(a.world.distanceTo(b.world) * 1000);
        const anchors = [this.measureDraft[0].anchor, this.measureDraft[1].anchor];
        Store.addMeasurement(anchors, mm);
        this.measureDraft = [];
        this.viewer.setDraft([]);
        U.toast('两点间距 ≈ ' + mm + ' mm（按标准解剖模型真实尺寸测量，不代表患者个体尺寸）', 'ok');
      }
      return;
    }
  };

  UI.finishRegion = function () {
    if (this.regionDraft.length < 3) { U.toast('区域标记至少需要 3 个点', 'warn'); return; }
    const names = this.regionDraft.map(function (p) { return p.partName; });
    const main = names.sort(function (a, b) {
      return names.filter(function (x) { return x === b; }).length - names.filter(function (x) { return x === a; }).length;
    })[0];
    const lat = this.regionDraft[0].laterality;
    const m = Store.addMarker({
      kind: 'region',
      type: this.newType === 'incision' || this.newType === 'puncture' || this.newType === 'drainage' ? 'resection' : this.newType,
      name: '',
      laterality: lat || null,
      regionName: this.regionDraft.map(function (p) { return p.regionName; }).join(' / ').slice(0, 60),
      partName: main,
      anchors: this.regionDraft.map(function (p) { return p.anchor; })
    });
    const n = this.regionDraft.length;
    this.regionDraft = [];
    this.viewer.setDraft([]);
    this._syncDraftBar();
    this.setTool('select');
    if (m) {
      this.selectedMarkerId = m.id;
      U.toast('已添加区域标记（' + n + ' 个顶点）', 'ok');
    }
  };

  UI.cancelDraft = function () {
    this.regionDraft = [];
    this.measureDraft = [];
    if (this.viewer) this.viewer.setDraft([]);
    this._syncDraftBar();
  };

  UI._syncDraftBar = function () {
    const bar = $('draftBar');
    if (this.tool === 'region' && this.regionDraft.length) {
      bar.classList.remove('hidden');
      $('draftText').textContent = '区域标记：已取 ' + this.regionDraft.length + ' 个点（≥3 个可闭合）';
      $('btnFinishRegion').disabled = this.regionDraft.length < 3;
    } else if (this.tool === 'measure' && this.measureDraft.length) {
      bar.classList.remove('hidden');
      $('draftText').textContent = '测量：已取 ' + this.measureDraft.length + ' 个点，再取 1 个点完成';
      $('btnFinishRegion').disabled = true;
    } else {
      bar.classList.add('hidden');
    }
  };

  UI._bindKeys = function () {
    window.addEventListener('keydown', function (e) {
      const tag = (e.target.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      const k = e.key.toLowerCase();
      if (k === 'v') UI.setTool('select');
      else if (k === 'b') UI.setTool('part');
      else if (k === 'p') UI.setTool('point');
      else if (k === 'r') UI.setTool('region');
      else if (k === 'm') UI.setTool('measure');
      else if (k === 'escape') UI.cancelDraft();
      else if (e.key === 'Delete' && UI.selectedMarkerId) {
        if (!PERM_EDIT()) return;
        Store.removeMarker(UI.selectedMarkerId);
        UI.selectedMarkerId = null;
        U.toast('已删除标记', 'ok');
      }
    });
  };

  /* ---------------- 总刷新 ---------------- */

  UI.refresh = function (evt) {
    if (evt && evt.type === 'quiet') {
      // 静默更新（输入中），只同步三维标签文字，避免打断输入
      return;
    }
    this.renderCase();
    this.renderMarkers();
    this.renderVerify();
    this.renderRange();
    this.syncViewer();
    this.renderLegend();
    // 按部位面板上的「已标记」徽标需随标记变化同步
    const pp = $('pane-parts');
    if (pp && !pp.classList.contains('hidden')) this._renderPartList();
  };

  UI.syncViewer = function () {
    const v = Store.current();
    if (!v) return;
    if (this.selectedMarkerId && !v.markers.some(function (m) { return m.id === this.selectedMarkerId; }, this)) {
      this.selectedMarkerId = null;
    }
    this.viewer.buildMarkers(v.markers, v.measurements, this.selectedMarkerId);
    this.viewer.setMarkerVisible($('btnToggleMarkers').classList.contains('active'));
  };

  /* ---------------- 左栏渲染 ---------------- */

  UI.renderCase = function () {
    const st = Store.state;
    const v = Store.current();
    const editable = Store.isEditable();

    $('caseId').textContent = st.caseId;
    const titleEl = $('caseTitle');
    if (document.activeElement !== titleEl) titleEl.value = st.title || '';
    titleEl.disabled = !PERM_EDIT();
    titleEl.placeholder = '如：左肺上叶切除方案';

    // 隐私自检
    const audit = C.privacyAudit(st);
    const pc = $('privacyCheck');
    pc.innerHTML = '隐私字段自检：<b class="' + (audit.ok ? 'ok' : 'bad') + '">' +
      (audit.ok ? '通过（未发现患者身份字段）' : '发现 ' + audit.hits.length + ' 项：' + U.escapeHtml(audit.hits.join('、'))) + '</b>';

    // 侧别
    document.querySelectorAll('#lateralitySeg button').forEach(function (b) {
      b.classList.toggle('active', v.laterality === b.dataset.v);
      b.disabled = !PERM_EDIT();
    });
    const lh = $('lateralityHint');
    if (v.laterality) {
      lh.textContent = '已选：' + C.LATERALITY_TEXT[v.laterality] + '。' +
        (editable ? '如需修改，可再次点击取消后重选。' : '当前版本已锁定。');
      lh.classList.remove('warn');
    } else {
      lh.textContent = '未选择侧别，无法提交核查。';
      lh.classList.add('warn');
    }

    const noteEl = $('caseNote');
    if (document.activeElement !== noteEl) noteEl.value = v.note || '';
    noteEl.disabled = !PERM_EDIT();

    // 版本列表
    const ul = $('versionList');
    ul.innerHTML = st.versions.map(function (x) {
      const active = x.version === st.activeVersion ? ' active' : '';
      return '<li class="version-item' + active + '" data-v="' + x.version + '">' +
        '<span class="vnum">v' + x.version + '</span>' +
        '<span class="status-chip st-' + x.status + '">' + C.STATUS_TEXT[x.status] + '</span>' +
        '<span class="vmeta">' + x.markers.length + ' 标记</span>' +
        '</li>';
    }).join('');
    ul.querySelectorAll('.version-item').forEach(function (li) {
      li.addEventListener('click', function () {
        Store.setActiveVersion(Number(li.dataset.v));
        UI.selectedMarkerId = null;
      });
    });

    // 流程
    const stepState = function (n) {
      // 1 创建方案 · 2 提交核查 · 3 三方核对 · 4 冻结归档
      if (v.status === 'draft') return n === 1 ? 'done' : n === 2 ? 'current' : '';
      if (v.status === 'pending') return n <= 2 ? 'done' : n === 3 ? 'current' : '';
      if (v.status === 'rejected') return n === 1 ? 'done' : n === 2 ? 'current' : n === 3 ? 'bad' : '';
      return 'done';
    };
    const mark = function (n) { return stepState(n) === 'done' ? '✓' : stepState(n) === 'bad' ? '!' : n; };
    $('flowState').innerHTML = [[1, '创建标记方案'], [2, '提交三方核查'], [3, '三方核对确认'], [4, '冻结归档']]
      .map(function (s) {
        return '<div class="flow-step ' + stepState(s[0]) + '"><span class="dotmark">' + mark(s[0]) + '</span>' + s[1] + '</div>';
      }).join('');

    // 提交按钮
    const can = Store.canSubmit();
    const btn = $('btnSubmitVerify');
    if (v.status === 'rejected') {
      btn.disabled = UI.role !== 'orderer';
      btn.textContent = '按异议新建修订版';
      $('submitHint').textContent = '存在异议，方案已退回。点击将基于本版本新建修订版，修改后可重新提交。';
    } else if (v.status === 'draft') {
      btn.disabled = !(UI.role === 'orderer' && can.ok);
      btn.textContent = '提交三方核查';
      $('submitHint').textContent = can.ok ? '条件已满足，可提交。' : can.reason + '。';
    } else if (v.status === 'frozen') {
      btn.disabled = true;
      btn.textContent = '已冻结（只读）';
      $('submitHint').textContent = '已冻结，如需调整请新建修订版。校验码 ' + v.checksum;
    } else {
      btn.disabled = true;
      btn.textContent = '核查进行中';
      $('submitHint').textContent = Store.verifySummary().text;
    }
  };

  /* ---------------- 标记清单 ---------------- */

  UI.renderLegend = function () {
    $('legend').innerHTML = Object.keys(C.MARKER_TYPES).map(function (k) {
      const t = C.MARKER_TYPES[k];
      return '<span class="legend-item"><span class="legend-swatch" style="background:' + t.color + '"></span>' + t.label + '</span>';
    }).join('') + '<span class="legend-item"><span class="legend-swatch" style="background:#38bdf8"></span>测量线</span>';
  };

  UI.renderMarkers = function () {
    const v = Store.current();
    $('markerCount').textContent = String(v.markers.length);

    const typeChips = '<div class="card" style="margin-bottom:10px">' +
      '<h3 class="card-title">新增标记类型</h3>' +
      '<div class="chips" id="typeChips">' + Object.keys(C.MARKER_TYPES).map(function (k) {
        const t = C.MARKER_TYPES[k];
        return '<button class="chip' + (UI.newType === k ? ' active' : '') + '" data-type="' + k + '" style="--c:' + t.color + '">' +
          '<i style="background:' + t.color + '"></i>' + t.label + '</button>';
      }).join('') + '</div>' +
      '<p class="hint-text">选择类型后，用工具栏的「点标记 / 区域标记」在模型上取点。</p></div>';

    const edit = PERM_EDIT();
    let html = typeChips;

    if (!v.markers.length) {
      html += '<div class="mk-empty">当前版本还没有标记。<br>用左侧「点标记」或「区域标记」在模型表面取点。</div>';
    } else {
      html += v.markers.map(function (m, i) {
        const meta = C.MARKER_TYPES[m.type] || C.MARKER_TYPES.other;
        const sel = m.id === UI.selectedMarkerId;
        const latTxt = m.laterality ? ' · ' + C.LATERALITY_TEXT[m.laterality] : '';
        let body = '';
        if (sel) {
          body = '<div class="mk-body">' +
            '<span class="sub-label">标记名称</span>' +
            '<input class="inline-input" data-role="name" value="' + U.escapeHtml(m.name) + '"' + (edit ? '' : ' disabled') + ' />' +
            '<div class="mk-row" style="margin-top:6px">' +
            '<div><span class="sub-label">类型</span><select class="inline-select" data-role="type"' + (edit ? '' : ' disabled') + '>' +
            Object.keys(C.MARKER_TYPES).map(function (k) {
              return '<option value="' + k + '"' + (k === m.type ? ' selected' : '') + '>' + C.MARKER_TYPES[k].label + '</option>';
            }).join('') + '</select></div>' +
            '<div><span class="sub-label">侧别</span><select class="inline-select" data-role="laterality"' + (edit ? '' : ' disabled') + '>' +
            '<option value="">未指定</option>' +
            ['left', 'right', 'bilateral'].map(function (k) {
              return '<option value="' + k + '"' + (k === m.laterality ? ' selected' : '') + '>' + C.LATERALITY_TEXT[k] + '</option>';
            }).join('') + '</select></div>' +
            '</div>' +
            '<span class="sub-label" style="margin-top:6px">系统解析部位（自动，不可改）</span>' +
            '<div class="mk-region" style="font-size:11.5px;color:#4a5568;background:#fff;border:1px solid #dde3ec;border-radius:5px;padding:6px 8px;line-height:1.6">' +
            U.escapeHtml(m.partName || '—') + ' · ' + U.escapeHtml(m.regionName || '—') + '<br>' +
            '<span style="color:#8b95a7;font-family:ui-monospace,Consolas,monospace">' +
            (m.anchors[0].regionKey
              ? '结构锚定 ' + U.escapeHtml(m.anchors[0].regionKey)
              : '锚定 ' + U.escapeHtml(m.anchors[0].meshId) + ' / face #' + m.anchors[0].faceIndex) +
            (m.kind === 'region' && m.anchors.length > 1 ? ' / ' + m.anchors.length + ' 顶点' : '') + '</span>' +
            '</div>' +
            '<span class="sub-label" style="margin-top:6px">备注</span>' +
            '<input class="inline-input" data-role="note" value="' + U.escapeHtml(m.note || '') + '"' + (edit ? '' : ' disabled') + ' />' +
            '<div class="mk-actions">' +
            '<button class="btn" data-act="focus">定位</button>' +
            (edit ? '<button class="btn" data-act="delete" style="color:#c0313a;border-color:#eec3c6">删除</button>' : '') +
            '</div></div>';
        }
        return '<div class="mk-item' + (sel ? ' selected' : '') + '" data-id="' + m.id + '">' +
          '<div class="mk-head">' +
          '<span class="mk-dot" style="background:' + meta.color + '"></span>' +
          '<span class="mk-title">' + (i + 1) + '. ' + U.escapeHtml(m.name) + '</span>' +
          '<span class="mk-sub">' + U.escapeHtml(m.regionName || m.partName || '') + latTxt + '</span>' +
          '</div>' + body + '</div>';
      }).join('');
    }

    if (v.measurements.length) {
      html += '<div class="card" style="margin-top:10px"><h3 class="card-title">测量记录</h3>' +
        v.measurements.map(function (d) {
          return '<div style="display:flex;align-items:center;gap:8px;padding:5px 0;border-bottom:1px dashed #dde3ec;font-size:12px">' +
            '<span style="font-family:ui-monospace,Consolas,monospace;font-weight:700">' + d.mm + ' mm</span>' +
            '<span style="color:#8b95a7;margin-left:auto">' + U.fmtTimeShort(d.createdAt) + '</span>' +
            (edit ? '<button class="btn btn-mini" data-del-measure="' + d.id + '">移除</button>' : '') +
            '</div>';
        }).join('') +
        '<p class="hint-text">按标准解剖模型的真实尺寸测量（模型身高约 1.70 m），不代表患者个体解剖尺寸。</p></div>';
    }

    const pane = $('markerList');
    pane.innerHTML = html;

    pane.querySelectorAll('#typeChips .chip').forEach(function (b) {
      b.addEventListener('click', function () {
        UI.newType = b.dataset.type;
        pane.querySelectorAll('#typeChips .chip').forEach(function (x) { x.classList.remove('active'); });
        b.classList.add('active');
      });
    });

    pane.querySelectorAll('.mk-item').forEach(function (item) {
      const id = item.dataset.id;
      item.querySelector('.mk-head').addEventListener('click', function () {
        UI.selectedMarkerId = (UI.selectedMarkerId === id) ? null : id;
        UI.viewer.setSelected(UI.selectedMarkerId);
        UI.renderMarkers();
      });
      const focusBtn = item.querySelector('[data-act="focus"]');
      if (focusBtn) focusBtn.addEventListener('click', function () {
        UI.viewer.focusMarker(id);
        UI.setTool('select');
      });
      const delBtn = item.querySelector('[data-act="delete"]');
      if (delBtn) delBtn.addEventListener('click', function () {
        UI.selectedMarkerId = null;
        Store.removeMarker(id);
        U.toast('已删除标记', 'ok');
      });
      const nameI = item.querySelector('[data-role="name"]');
      if (nameI) {
        nameI.addEventListener('input', U.debounce(function () {
          Store.updateMarker(id, { name: nameI.value }, true);
          UI._patchLabel(id, nameI.value);
        }, 320));
      }
      const noteI = item.querySelector('[data-role="note"]');
      if (noteI) {
        noteI.addEventListener('input', U.debounce(function () {
          Store.updateMarker(id, { note: noteI.value }, true);
        }, 320));
      }
      const typeS = item.querySelector('[data-role="type"]');
      if (typeS) typeS.addEventListener('change', function () { Store.updateMarker(id, { type: typeS.value }); });
      const latS = item.querySelector('[data-role="laterality"]');
      if (latS) latS.addEventListener('change', function () { Store.updateMarker(id, { laterality: latS.value || null }); });
    });

    pane.querySelectorAll('[data-del-measure]').forEach(function (b) {
      b.addEventListener('click', function () { Store.removeMeasurement(b.dataset.delMeasure); });
    });
  };

  UI._patchLabel = function (markerId, name) {
    const el = this.viewer._labelMap.get(markerId);
    if (!el) return;
    const mn = el.querySelector('.mname');
    if (mn) mn.textContent = name || '(未命名)';
  };

  /* ============================================================
     按部位选择
     ------------------------------------------------------------
     医生是按「部位」思考的（右上腹部、左胸部），不是按坐标。
     本面板把模型上的解剖分区列成清单：
       · 搜索 —— 支持「右上腹」这类「侧别 + 部位」的组合写法；
       · 悬停 —— 在模型上整块预览，先看清范围再决定；
       · 单击 —— 整块选中并自动正对该部位；
       · 一键 —— 把整个部位标记为区域，或取其中心生成点标记。
     ============================================================ */

  /** 搜索匹配：支持「左 femur」「胸」这类「侧别 + 关键词」组合 */
  function matchRegion(r, q) {
    const s = (q || '').trim();
    if (!s) return true;
    let lat = null, rest = s;
    const m = s.match(/^(左|右|双侧)\s*(.*)$/);
    if (m) {
      lat = m[1] === '左' ? 'left' : m[1] === '右' ? 'right' : 'bilateral';
      rest = m[2].trim();
    }
    if (lat && r.laterality !== lat && !(lat === 'bilateral' && !r.laterality)) return false;
    if (!rest) return true;
    const hay = (r.name + ' ' + (r.alias || '') + ' ' + r.partName + ' ' + r.group + ' ' +
      (r.subgroup || '') + ' ' + (r.baseName || '') + ' ' +
      ((r.subNames || []).join(' '))).toLowerCase();
    return hay.indexOf(rest.toLowerCase()) >= 0;
  }

  UI.selectRegion = function (key, opt) {
    const o = opt || {};
    if (!this.viewer) return;
    if (!key) {
      this.activeRegionKey = null;
      this.viewer.setActiveRegion(null);
      this._renderPartList();
      return;
    }
    this.activeRegionKey = key;
    this.viewer.setActiveRegion(key);
    if (o.focus !== false) this.viewer.focusRegion(key, o.animate !== false);
    this._renderPartList();
    const el = $('partsPane').querySelector('.part-item.active');
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
  };

  /** 把当前选中部位生成标记：part = 整块区域；center = 部位中心点 */
  UI.markRegion = function (mode) {
    const key = this.activeRegionKey;
    if (!key) { U.toast('请先选择一个部位', 'warn'); return; }
    if (!PERM_EDIT()) {
      U.toast(this.role === 'orderer'
        ? '当前版本状态为「' + C.STATUS_TEXT[Store.current().status] + '」，不可编辑'
        : '仅开单医生可添加标记', 'warn');
      return;
    }
    const r = this.viewer.regionIndex.get(key);
    if (!r) return;

    if (mode === 'center') {
      // 结构质心向体外投射 → 标准点锚定。
      // 体表部位没有单一 mesh，不锁定目标表面（r.mesh 为 null 时通用投射）
      const hit = this.viewer.pickAtLocal(r.centroid, r.normal, r.mesh);
      if (!hit) { U.toast('该处中心无法投射到体表，请改用「标记整个部位」', 'warn'); return; }
      const m = Store.addMarker({
        kind: 'point', type: this.newType, name: '',
        laterality: r.laterality || hit.laterality || null,
        regionName: r.name, partName: r.partName,
        regionKey: r.key,
        anchors: [hit.anchor]
      });
      if (m) {
        this.selectedMarkerId = m.id;
        U.toast('已在「' + r.name + '」中心放置点标记', 'ok');
      }
    } else {
      const type = (this.newType === 'incision' || this.newType === 'puncture' || this.newType === 'drainage')
        ? 'resection' : this.newType;
      const m = Store.addMarker({
        kind: 'region', type: type, name: '',
        laterality: r.laterality || null,
        regionName: r.name, partName: r.partName,
        regionKey: key,
        anchors: [{ regionKey: key }]
      });
      if (m) {
        this.selectedMarkerId = m.id;
        U.toast('已把整个「' + r.name + '」标记为区域（' + r.triCount + ' 个面片' +
          (r.members ? '，含 ' + r.members.length + ' 个结构' : '') + '）', 'ok');
      }
    }
    this.viewer.setSelected(this.selectedMarkerId);
  };

  /** 面板静态部分：搜索框与说明 */
  UI.renderParts = function () {
    const pane = $('partsPane');
    if (!pane) return;
    const idx = this.viewer && this.viewer.regionIndex;
    if (!idx) { pane.innerHTML = '<p class="hint-text">解剖结构索引尚未就绪。</p>'; return; }

    const all = Array.from(idx.values());
    const structs = all.filter(function (r) { return r.type !== 'part' && r.type !== 'subpart'; });
    const parts = all.filter(function (r) { return r.type === 'part'; });
    const subs = all.filter(function (r) { return r.type === 'subpart'; });
    const totalTri = structs.reduce(function (a, r) { return a + r.triCount; }, 0);
    const cats = ((this.viewer.body && this.viewer.body.categories) || [])
      .filter(function (c) { return c.key !== 'other' && c.count > 0; });
    const vis = this.viewer.catVisible || {};
    const mode = this.viewer.layerMode || 'both';
    const layerBtn = function (v, label, hint) {
      return '<button class="layer-chip' + (mode === v ? ' on' : '') + '" data-layer="' + v + '" title="' + hint + '">' + label + '</button>';
    };

    pane.innerHTML =
      '<div class="card" style="margin-bottom:10px">' +
      '<h3 class="card-title">显示层级 <em class="req">部位 / 脏器</em></h3>' +
      '<div class="layer-row" id="layerRow">' +
      layerBtn('both', '全部', '体表部位与脏器骨骼同时显示') +
      layerBtn('regionOnly', '仅部位', '只显示体表分区（人形色块），点模型即选分区') +
      layerBtn('organOnly', '仅脏器', '只显示脏器与骨骼，点模型即选结构') +
      '</div>' +
      '<h3 class="card-title" style="margin-top:14px">按解剖结构选择 <em class="req">整块选中</em></h3>' +
      (cats.length
        ? '<div class="cat-row" id="catRow">' + cats.map(function (c) {
          const on = vis[c.key] !== false;
          return '<button class="cat-chip' + (on ? ' on' : '') + '" data-cat="' + c.key + '">' +
            '<i class="cat-dot dot-' + c.key + '"></i>' + c.label +
            '<em>' + c.count + '</em></button>';
        }).join('') + '</div>'
        : '') +
      '<input class="inline-input" id="partSearch" type="search" placeholder="搜索，如「肝」「股骨」「右上腹」「前臂前区」" value="' +
      U.escapeHtml(this.partQuery || '') + '" />' +
      '<p class="hint-text">模型含 <b>' + structs.length + '</b> 个具名解剖结构（骨骼 / 脏器 / 脑与神经，不含肌肉）、' +
      '<b>' + parts.length + '</b> 个体表部位（全身分区，含腹部九分区），' +
      '部位下可继续下钻到图谱的 <b>' + subs.length + '</b> 个细分分区。共 ' + totalTri.toLocaleString() +
      ' 个面片。悬停可在模型上预览整块范围，单击选中；也可用「部位」工具直接在模型上点选。</p>' +
      '</div>' +
      '<div id="partListWrap"></div>';

    const lr = $('layerRow');
    if (lr) {
      lr.querySelectorAll('.layer-chip').forEach(function (b) {
        b.addEventListener('click', function () {
          UI.viewer.setLayerMode(b.dataset.layer);
          UI.renderParts();
          UI.refreshHud && UI.refreshHud();
        });
      });
    }

    const cr = $('catRow');
    if (cr) {
      cr.querySelectorAll('.cat-chip').forEach(function (b) {
        b.addEventListener('click', function () {
          const t = b.dataset.cat;
          const cur = UI.viewer.catVisible[t] !== false;
          UI.viewer.setCategoryVisible(t, !cur);
          b.classList.toggle('on', !cur);
        });
      });
    }

    const box = $('partSearch');
    box.addEventListener('input', U.debounce(function () {
      UI.partQuery = box.value;
      UI._renderPartList();
    }, 180));
    box.addEventListener('keydown', function (e) { e.stopPropagation(); });

    this._renderPartList();
  };

  /** 面板动态部分：分组清单 + 选中部位的操作条 */
  UI._renderPartList = function () {
    const wrap = $('partListWrap');
    if (!wrap) return;
    const idx = this.viewer.regionIndex;

    const used = {};
    Store.current().markers.forEach(function (m) {
      const a = m.anchors[0];
      if (a && a.regionKey) { used[a.regionKey] = (used[a.regionKey] || 0) + 1; return; }
      // 点标记的 meshId 即结构 id
      if (a && a.meshId) { used[a.meshId] = (used[a.meshId] || 0) + 1; }
    });

    const q = (UI.partQuery || '').trim();
    const hit = Array.from(idx.values()).filter(function (r) { return matchRegion(r, UI.partQuery); });

    const latRank = function (r) { return r.laterality === 'left' ? 0 : r.laterality === null ? 1 : 2; };
    const latTag = function (r) {
      return r.laterality ? '<span class="part-lat lat-' + r.laterality + '">' +
        (r.laterality === 'left' ? '左' : '右') + '</span>' : '';
    };
    const itemHtml = function (r, extraClass) {
      const isActive = r.key === UI.activeRegionKey;
      const u = used[r.key] || 0;
      return '<div class="part-item' + (isActive ? ' active' : '') + (extraClass || '') + '" data-key="' + r.key + '">' +
        latTag(r) +
        '<span class="part-name">' + U.escapeHtml(r.name) +
        (r.alias ? '<em class="part-alias">' + U.escapeHtml(r.alias) + '</em>' : '') + '</span>' +
        (u ? '<span class="part-used" title="该处已有 ' + u + ' 个标记">' + u + '</span>' : '') +
        '<span class="part-meta">' + r.partName + '</span>' +
        '</div>';
    };

    const partHits = hit.filter(function (r) { return r.type === 'part'; });
    const subHits = hit.filter(function (r) { return r.type === 'subpart'; });
    const structHits = hit.filter(function (r) { return r.type !== 'part' && r.type !== 'subpart'; });

    let html = '';
    if (!hit.length) {
      html = '<div class="mk-empty">没有匹配的结构或部位。<br>试试「肝」「股骨」「右上腹」「前臂前区」这类关键词。</div>';
    } else {
      /* —— ① 体表部位（34 大区，按身体大组排列，可下钻图谱细分）—— */
      if (partHits.length) {
        const bySub = new Map();
        partHits.forEach(function (p) {
          if (!bySub.has(p.subgroup)) bySub.set(p.subgroup, []);
          bySub.get(p.subgroup).push(p);
        });
        const subOrder = SMK.regions.GROUP_ORDER.filter(function (g) { return bySub.has(g); });
        html += '<div class="part-group"><div class="part-group-head"><span>体表部位</span><em>' + partHits.length + '</em></div>';
        subOrder.forEach(function (g) {
          const arr = bySub.get(g);
          html += '<div class="part-subhead">' + U.escapeHtml(g) + '<em>' + arr.length + '</em></div>';
          arr.forEach(function (p) {
            const open = !!UI.expandedParts[p.key];
            html += '<div class="part-row">' + itemHtml(p, ' is-bodypart') +
              '<button class="part-drill" data-drill="' + p.key + '" title="展开图谱细分分区">' +
              (open ? '▾' : '▸') + ' ' + p.subCount + '</button></div>';
            if (open) {
              const subs = (p.atlasKeys || []).map(function (k) { return idx.get(k); }).filter(Boolean);
              html += '<div class="sub-list">' + subs.map(function (s) {
                return '<div class="sub-item' + (s.key === UI.activeRegionKey ? ' active' : '') + '" data-sub="' + s.key + '">' +
                  latTag(s) + '<span>' + U.escapeHtml(s.name) + '</span>' +
                  '<em>' + U.escapeHtml(s.subgroup || '') + '</em></div>';
              }).join('') + '</div>';
            }
          });
        });
        html += '</div>';
      }

      /* —— ② 图谱细分分区（仅在搜索时单独列出）—— */
      if (q && subHits.length) {
        const arr = subHits.slice().sort(function (a, b) {
          const d = latRank(a) - latRank(b);
          return d !== 0 ? d : a.name.localeCompare(b.name, 'zh');
        });
        html += '<div class="part-group"><div class="part-group-head"><span>图谱细分分区</span><em>' + arr.length + '</em></div>' +
          arr.map(function (r) { return itemHtml(r, ' is-subpart'); }).join('') + '</div>';
      }

      /* —— ③ 解剖结构（骨骼 / 脏器 / 脑与神经）—— */
      if (structHits.length) {
        const groups = new Map();
        structHits.forEach(function (r) {
          if (!groups.has(r.group)) groups.set(r.group, []);
          groups.get(r.group).push(r);
        });
        const order = SMK.body.REGION_ORDER.filter(function (g) { return groups.has(g); });
        groups.forEach(function (_v, g) { if (order.indexOf(g) < 0) order.push(g); });
        order.forEach(function (g) {
          const arr = groups.get(g).slice().sort(function (a, b) {
            const d = latRank(a) - latRank(b);
            return d !== 0 ? d : a.name.localeCompare(b.name, 'zh');
          });
          html += '<div class="part-group">' +
            '<div class="part-group-head"><span>' + U.escapeHtml(g) + '</span><em>' + arr.length + '</em></div>' +
            arr.map(function (r) { return itemHtml(r, ''); }).join('') + '</div>';
        });
      }
    }

    // 选中部位的操作条
    const r = UI.activeRegionKey ? idx.get(UI.activeRegionKey) : null;
    if (r) {
      const editable = PERM_EDIT();
      const isPart = r.type === 'part';
      const isSub = r.type === 'subpart';
      const noun = isPart ? '体表部位' : isSub ? '图谱分区' : '结构';
      const sizeText = isPart
        ? ' · 图谱分区 ' + r.subCount + ' 个 · ' + r.triCount + ' 个面片'
        : ' · ' + r.triCount + ' 个面片';
      html += '<div class="part-action">' +
        '<div class="pa-title">已选' + (isPart ? '部位' : isSub ? '分区' : '结构') + '：<b>' + U.escapeHtml(r.name) + '</b></div>' +
        '<div class="pa-meta">' + U.escapeHtml(r.partName) + ' · ' +
        (r.laterality ? C.LATERALITY_TEXT[r.laterality] : '中轴') + ' · ' +
        U.escapeHtml(isPart ? (r.subgroup + ' · 体表部位') : r.group) + sizeText +
        (isPart && r.organMembers && r.organMembers.length
          ? ' · 区内结构 ' + r.organMembers.length + ' 个' : '') +
        (used[r.key] ? ' · 已标记 ' + used[r.key] + ' 次' : '') + '</div>' +
        (isPart && r.organMembers && r.organMembers.length
          ? '<div class="pa-organs">区内结构：' +
          r.organMembers.slice(0, 12).map(function (s) { return U.escapeHtml(s.name); }).join('、') +
          (r.organMembers.length > 12 ? ' 等 ' + r.organMembers.length + ' 个' : '') + '</div>'
          : '') +
        '<div class="pa-row">' +
        '<select class="inline-select" data-role="partType">' +
        Object.keys(C.MARKER_TYPES).map(function (k) {
          return '<option value="' + k + '"' + (k === UI.newType ? ' selected' : '') + '>' + C.MARKER_TYPES[k].label + '</option>';
        }).join('') + '</select>' +
        '<button class="btn btn-primary" data-act="mark-part"' + (editable ? '' : ' disabled') + '>标记整个' + (isPart ? '部位' : isSub ? '分区' : '结构') + '</button>' +
        '<button class="btn" data-act="mark-center"' + (editable ? '' : ' disabled') + '>标记' + (isPart ? '部位' : isSub ? '分区' : '结构') + '中心</button>' +
        '</div>' +
        '<p class="hint-text">' + (isPart
          ? '「标记整个部位」把该体表分区的完整皮面作为一个区域标记（范围即该区在体表的真实边界）；「标记部位中心」只落一个点。'
          : isSub
            ? '图谱细分分区来自解剖图谱的原始分区定义（如「前臂前区」「腘窝」「鼻烟壶」），单独选中即可精确到该小区的皮面。'
            : '「标记整个结构」把该解剖结构的全部面片作为一个区域标记（范围即真实解剖范围）；「标记结构中心」只落一个点。') +
        (editable ? '' : '当前身份 / 版本状态不可编辑。') + '</p>' +
        '<button class="btn btn-mini btn-ghost" data-act="clear-part">取消选中</button>' +
        '</div>';
    } else {
      html += '<p class="hint-text" style="margin-top:10px">尚未选择结构或部位。悬停清单项可预览，单击即整块选中。</p>';
    }

    wrap.innerHTML = html;

    wrap.querySelectorAll('.part-item').forEach(function (el) {
      const key = el.dataset.key;
      el.addEventListener('mouseenter', function () { UI.viewer.setHoverRegion(key); });
      el.addEventListener('mouseleave', function () { UI.viewer.setHoverRegion(null); });
      el.addEventListener('click', function () { UI.selectRegion(key, { animate: true }); });
    });
    wrap.querySelectorAll('.sub-item').forEach(function (el) {
      const key = el.dataset.sub;
      el.addEventListener('mouseenter', function () { UI.viewer.setHoverRegion(key); });
      el.addEventListener('mouseleave', function () { UI.viewer.setHoverRegion(null); });
      el.addEventListener('click', function (e) { e.stopPropagation(); UI.selectRegion(key, { animate: true }); });
    });
    wrap.querySelectorAll('.part-drill').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.stopPropagation();
        const k = el.dataset.drill;
        UI.expandedParts[k] = !UI.expandedParts[k];
        UI._renderPartList();
      });
    });
    const sel = wrap.querySelector('[data-role="partType"]');
    if (sel) sel.addEventListener('change', function () { UI.newType = sel.value; });
    const bp = wrap.querySelector('[data-act="mark-part"]');
    if (bp) bp.addEventListener('click', function () { UI.markRegion('part'); });
    const bc = wrap.querySelector('[data-act="mark-center"]');
    if (bc) bc.addEventListener('click', function () { UI.markRegion('center'); });
    const bcl = wrap.querySelector('[data-act="clear-part"]');
    if (bcl) bcl.addEventListener('click', function () {
      UI.selectRegion(null);
      UI.viewer.setHoverRegion(null);
    });
  };

  /* ---------------- 三方核查 ---------------- */

  UI.renderVerify = function () {
    const v = Store.current();
    const s = Store.verifySummary();
    const cls = { ok: 'vs-ok', wait: 'vs-wait', bad: 'vs-bad', idle: 'vs-idle' }[s.state] || 'vs-idle';

    let html = '<div class="verify-summary ' + cls + '"><b>核查状态</b><br>' + U.escapeHtml(s.text) + '</div>';

    if (v.status === 'draft') {
      html += '<p class="hint-text">本版本采用「三方核查」：开单医生、主刀医生、手术室护士分别独立核对。三方全部确认一致后方案自动冻结；任一方提出异议即退回修改。</p>' +
        '<p class="hint-text">注意：本阶段不采集电子签名，核查仅记录角色、时间与结论，不构成法定电子签名。</p>';
    }

    const recs = v.verify.records;
    html += C.ROLES.map(function (r) {
      const rec = recs[r.key];
      const isMe = UI.role === r.key;
      const chip = rec.state === 'confirmed' ? '<span class="status-chip st-frozen">已确认</span>'
        : rec.state === 'objected' ? '<span class="status-chip st-rejected">有异议</span>'
          : '<span class="status-chip st-pending">待核对</span>';

      let body = '';
      if (v.status === 'pending' && isMe) {
        body = C.VERIFY_ITEMS.map(function (it) {
          const ck = rec.items[it.key] ? ' checked' : '';
          return '<label class="chk-item"><input type="checkbox" data-item="' + it.key + '"' + ck + ' />' +
            '<span>' + U.escapeHtml(it.text) + '</span></label>';
        }).join('');
        body += '<span class="sub-label" style="margin-top:6px">异议理由（提出异议时必填）</span>' +
          '<textarea class="inline-input" data-obj="1" rows="2" placeholder="请具体说明不一致之处">' + U.escapeHtml(rec.objection || '') + '</textarea>' +
          '<div class="role-actions">' +
          '<button class="btn btn-primary" data-act="confirm">确认无误</button>' +
          '<button class="btn" data-act="object" style="color:#c0313a;border-color:#eec3c6">提出异议</button>' +
          '</div>' +
          '<p class="role-note">请逐项核对无误后点击「确认无误」。确认后本角色的核查结论将被记录。</p>';
      } else {
        body = C.VERIFY_ITEMS.map(function (it) {
          const st = rec.items[it.key];
          const icon = rec.state === 'pending' ? '○' : (st ? '✓' : '✗');
          const color = rec.state === 'pending' ? '#8b95a7' : (st ? '#12805c' : '#c0313a');
          return '<div class="chk-item"><span style="color:' + color + ';font-weight:700">' + icon + '</span><span>' + U.escapeHtml(it.text) + '</span></div>';
        }).join('');
        if (rec.objection) body += '<div class="obj-box notice" style="background:#fdecec;color:#8c2028"><b>异议内容</b><span>' + U.escapeHtml(rec.objection) + '</span></div>';
        body += '<p class="role-note">' + (rec.at ? '操作时间：' + U.fmtTime(rec.at) : (v.status === 'pending' ? '等待该角色核对。' : '—')) + '</p>';
      }

      return '<div class="role-card' + (isMe ? ' me' : '') + '" data-role="' + r.key + '">' +
        '<div class="role-head">' +
        '<span class="role-avatar">' + r.short + '</span>' +
        '<div><div class="role-name">' + r.name + (isMe ? '（我）' : '') + '</div><div class="role-role">' + r.duty + '</div></div>' +
        '<span class="role-state">' + chip + '</span>' +
        '</div><div class="role-body">' + body + '</div></div>';
    }).join('');

    if (v.verify.history.length) {
      html += '<h3 class="card-title" style="margin-top:12px">核查与操作留痕</h3><div class="timeline">' +
        v.verify.history.slice().reverse().map(function (h) {
          return '<div class="tl-item"><span class="tl-time">' + U.fmtTime(h.at) + '</span><span class="tl-text">' + U.escapeHtml(h.detail) + '</span></div>';
        }).join('') + '</div>';
      html += '<p class="hint-text">留痕仅记录角色与时间，用于流程追溯；因本期不含电子签名，不作为法律意义上的签名凭证。</p>';
    }

    const pane = $('verifyPane');
    pane.innerHTML = html;

    pane.querySelectorAll('input[type="checkbox"][data-item]').forEach(function (cb) {
      cb.addEventListener('change', function () {
        const card = cb.closest('.role-card');
        const role = card.dataset.role;
        const rec = Store.current().verify.records[role];
        rec.items[cb.dataset.item] = cb.checked;
        Store.save();
      });
    });
    pane.querySelectorAll('[data-act="confirm"]').forEach(function (b) {
      b.addEventListener('click', function () {
        const role = b.closest('.role-card').dataset.role;
        const rec = Store.current().verify.records[role];
        const missing = C.VERIFY_ITEMS.filter(function (it) { return !rec.items[it.key]; });
        if (missing.length) { U.toast('还有 ' + missing.length + ' 项未勾选确认，请逐项核对', 'warn'); return; }
        Store.confirmRole(role, rec.items);
        const rest = C.ROLES.filter(function (r) { return Store.current().verify.records[r.key].state === 'pending'; });
        if (Store.current().status === 'frozen') {
          U.toast('三方核查一致通过，方案已冻结', 'ok');
        } else {
          U.toast('已记录您的核查结论。剩余待核对：' + rest.map(function (r) { return r.name; }).join('、'), 'ok');
        }
      });
    });
    pane.querySelectorAll('[data-act="object"]').forEach(function (b) {
      b.addEventListener('click', function () {
        const card = b.closest('.role-card');
        const role = card.dataset.role;
        const ta = card.querySelector('[data-obj="1"]');
        Store.objectRole(role, ta ? ta.value : '');
      });
    });

    const dot = $('verifyDot');
    if (v.status === 'pending') dot.classList.remove('hidden'); else dot.classList.add('hidden');
  };

  /* ---------------- 范围说明 ---------------- */

  UI.renderRange = function () {
    const inc = [
      '<b>真实解剖模型（脏器层）</b>：内置骨骼与脏器解剖模型（organs-bones.glb，1148 个可标记结构：骨骼 626 / 脏器 137 / 脑与神经 385，约 161 万三角面），由 Z-Anatomy 开源解剖图谱提取，<b>不含肌肉</b>。',
      '<b>体表部位层（全身）</b>：内置独立分区模型（body-regions.glb，250 个体表分区，取自图谱自带「人体分区」体系，含真实体表曲面几何），按 <b>34 个体表部位</b>归并成一键整块选中单元，<b>全身覆盖并区分左右</b>：头颈 2 · 胸 2 · 腹 9 · 背 2 · 会阴 1 · 上肢 8 · 下肢 10。腹部沿用<b>临床九分区</b>口径（右季肋区 / 腹上区 / 左季肋区 / 右腰区 / 脐区 / 左腰区 / 右髂区 / 腹下区 / 左髂区），其余部位按解剖分区命名。',
      '<b>下钻到图谱细分分区</b>：每个体表部位可展开查看其包含的图谱细分分区（如「左上臂」= 臂区 + 肘区 等多个分区，左右各自成条），细分分区同样可整块选中与标记。',
      '<b>三态层级切换</b>：<b>全部</b>（部位 + 脏器同屏，部位为半透明外壳） / <b>仅部位</b>（只看体表分区，便于按部位选点） / <b>仅脏器</b>（只看深层结构），切换后拾取目标、高亮与标记显隐同步联动。',
      '<b>类别显隐</b>：骨骼 / 脏器 / 脑与神经三类可独立显示与隐藏（默认隐藏脑与神经），体表部位层另有独立开关，便于看清深层脏器（如隐藏骨骼与部位层看腹腔）；隐藏类别的标记一并隐藏。',
      '<b>结构级整块选中</b>：点击模型任意位置即选中该处所属的解剖结构或体表分区；悬停清单可整块预览；面板支持中文搜索（可搜结构名、部位名与图谱细分分区名）。',
      '<b>点标记</b>：单击取点，支持类型（切口 / 切除 / 穿刺 / 引流 / 注意 / 其他）、侧别、备注。',
      '<b>区域标记</b>：既可在体表连续取点闭合成贴合曲面的面片，也可一键把整个解剖结构或体表部位标记为区域（范围即该结构 / 部位的真实几何范围）。',
      '<b>防漂移锚定</b>：标记以「结构 id + 面索引 + 面内重心坐标」或「区域键 regionKey」锚定于模型几何体，位置取分区质心，旋转、缩放、平移视角与切换层级均不漂移。',
      '<b>距离测量</b>：两点间距（模型为真实米制尺寸，单位 mm）。',
      '<b>方案版本管理</b>：草稿 / 待核查 / 已冻结 / 已退回，冻结后只读，修改须新建修订版。',
      '<b>三方核查流程</b>：开单医生、主刀医生、手术室护士分别独立核对四项核查点，可提出异议；三方一致即冻结，任一异议即退回。',
      '<b>操作留痕</b>：记录操作角色、时间与动作，可追溯。',
      '<b>本地存储与 JSON 导入导出</b>：数据仅存于本机浏览器，可导出查看与再导入。',
      '<b>隐私字段自检</b>：每次落盘与导出前机械校验，命中患者身份字段即阻断。'
    ];
    const out = [
      '<b>患者身份信息</b>：不采集姓名、住院号、身份证、联系方式等任何身份字段，界面与数据结构中均无对应位置。',
      '<b>HIS 对接</b>：本期不调用 HIS，不拉取患者信息、手术申请与排程数据。',
      '<b>手术部位与编码映射</b>：不做手术部位名称与 ICD-9-CM-3 等操作编码的对照与校验。',
      '<b>电子签名</b>：不采集签名，核查结论仅记录角色与时间。',
      '<b>手麻系统联动</b>：不与麻醉 / 手术信息管理系统交互，不生成核对任务、不回写状态。',
      '<b>患者个体化解剖</b>：标记打在标准解剖模型上，不等同于患者真实解剖定位（无 CT / MRI 重建）。',
      '<b>肌肉 / 血管神经 / 皮肤被盖</b>：脏器层（organs-bones.glb）只含骨骼、脏器与脑脊髓，不含肌肉、血管神经主干与淋巴。部位层（body-regions.glb）提供的是<b>体表分区皮面</b>（图谱用于标注体表分区的曲面），<b>不是解剖学意义上的皮肤被盖</b>，也未细分到真皮 / 皮下层次。',
      '<b>解剖命名来源</b>：结构名、体表分区名与体区分组取自 Z-Anatomy 开源解剖图谱的中文命名；「部位归并表」（34 大区）的映射关系与腹部临床九分区口径由本项目定义，可供医学审校后接入正式术语编码。'
    ];
    $('rangePane').innerHTML =
      '<div class="notice" style="background:#e8f0fd;color:#1a4a99;margin-bottom:12px"><b>本页为功能验证版本的范围边界</b>' +
      '<span>目标是验证 3D 标记的展示效果与三方核查交互，不是可上线的临床系统。</span></div>' +
      '<div class="range-sec"><h4>本期包含 <span class="pill pill-in">IN</span></h4><ul class="range-list in">' +
      inc.map(function (t) { return '<li>' + t + '</li>'; }).join('') + '</ul></div>' +
      '<div class="range-sec"><h4>本期不含 <span class="pill pill-out">OUT</span></h4><ul class="range-list out">' +
      out.map(function (t) { return '<li>' + t + '</li>'; }).join('') + '</ul></div>' +
      '<div class="range-sec"><h4>后续接入路径</h4><ul class="range-list in">' +
      [
        '<b>接 HIS</b>：在「登录鉴权 → 待标记列表 → 方案详情 → 提交前复核 → 状态回写」等时序点接入，仅取患者基本信息、手术申请、人员科室字典与排程，本模型只需新增字段映射层，标记数据结构无需改动。',
        '<b>接编码映射</b>：在标记类型与部位之外增加编码字段，并把「部位—编码」一致性校验接入提交前检查。',
        '<b>接电子签名</b>：把当前的角色确认记录替换为带证书的签名对象，冻结校验码升级为签名摘要。',
        '<b>接手麻系统</b>：把核查任务的下发与状态回写对接到手麻系统，麻醉医师作为第四方角色加入（数据结构已预留）。',
        '<b>接真实影像</b>：用 CT / MRI 分割重建替换标准模型，锚定算法不变（仅要求重建后顶点顺序稳定或建立版本映射）。'
      ].map(function (t) { return '<li>' + t + '</li>'; }).join('') + '</ul></div>';
  };

  SMK.ui = UI;
})();
