/* ============================================================
   store.js — 数据模型 / 本地持久化 / 三方核查状态机
   ------------------------------------------------------------
   本期数据边界（硬约束）：
     · 只存「与手术部位有关」的内容，不存任何患者身份信息；
     · 不存手术部位编码（不做编码映射）；
     · 不采集电子签名 —— 三方核查仅记录角色、时间与结论；
     · 不与手麻系统联动（无接口、无外部调用）。
   隐私约束由 privacyAudit() 在每次落盘前机械校验，命中即拒绝保存。
   ============================================================ */
(function () {
  const SMK = (window.SMK = window.SMK || {});
  const U = SMK.util;

  const STORAGE_KEY = 'smk.3dmarker.demo/1';
  const SCHEMA = 'smk-3dmarker-demo/1';

  /* ---------- 常量目录 ---------- */

  const MARKER_TYPES = {
    incision: { label: '切口', color: '#e5484d', shape: 'point' },
    resection: { label: '切除范围', color: '#f0930a', shape: 'region' },
    puncture: { label: '穿刺点', color: '#7c5cff', shape: 'point' },
    drainage: { label: '引流位置', color: '#0d9488', shape: 'point' },
    caution: { label: '注意 / 禁区', color: '#d6409f', shape: 'either' },
    other: { label: '其他标记', color: '#64748b', shape: 'either' }
  };

  const ROLES = [
    { key: 'orderer', name: '开单医生', duty: '开具手术单并完成 3D 标记', short: '开' },
    { key: 'surgeon', name: '主刀医生', duty: '术前核对标记部位', short: '主' },
    { key: 'nurse', name: '手术室护士', duty: '术前核对标记部位', short: '护' }
  ];

  const VERIFY_ITEMS = [
    { key: 'v1', text: '已查看 3D 模型上的全部标记，标记部位与拟施术式一致' },
    { key: 'v2', text: '手术侧别（左 / 右 / 双侧）与 3D 标记一致，无左右混淆' },
    { key: 'v3', text: '标记的数量与范围完整，无遗漏的手术部位' },
    { key: 'v4', text: '对标记部位理解一致，无待澄清的异议项' }
  ];

  const STATUS_TEXT = {
    draft: '草稿',
    pending: '待核查',
    frozen: '已核查通过（已冻结）',
    rejected: '核查未通过（已退回）'
  };

  const LATERALITY_TEXT = { left: '左侧', right: '右侧', bilateral: '双侧' };

  /* ---------- 隐私自检 ---------- */

  const FORBIDDEN_KEY_CN = /姓名|身份证|住院号|病案号|门诊号|医保|社保|联系方式|手机|电话|住址|家庭地址|出生日期|出生年月|患者|病人/;
  const FORBIDDEN_KEY_EN = /^(patient|patientname|patientid|patientno|idcard|idno|idnumber|mrn|inpatientno|outpatientno|admissionno|phone|mobile|telephone|tel|address|birthday|birthdate|ssn|insurance)$/i;
  // 说明：标记的 name 字段合法，故不将裸 name 列入禁用键。

  function privacyAudit(root) {
    const hits = [];
    const seen = new Set();
    (function walk(node, path) {
      if (!node || typeof node !== 'object') return;
      if (seen.has(node)) return;
      seen.add(node);
      Object.keys(node).forEach(function (k) {
        const p = path ? path + '.' + k : k;
        if (FORBIDDEN_KEY_CN.test(k) || FORBIDDEN_KEY_EN.test(k)) hits.push(p);
        const v = node[k];
        if (v && typeof v === 'object') walk(v, p);
      });
    })(root, '');
    return { ok: hits.length === 0, hits: hits };
  }

  /* ---------- 构造 ---------- */

  function newVerify() {
    const records = {};
    ROLES.forEach(function (r) {
      records[r.key] = { state: 'pending', items: {}, objection: '', at: null };
    });
    return { records: records, history: [] };
  }

  function newVersion(n) {
    const now = U.now();
    return {
      version: n,
      status: 'draft',
      laterality: null,
      note: '',
      markers: [],
      measurements: [],
      verify: newVerify(),
      frozenAt: null,
      checksum: null,
      createdAt: now,
      updatedAt: now
    };
  }

  function newCase() {
    const now = U.now();
    const d = new Date();
    const p = function (x) { return String(x).padStart(2, '0'); };
    return {
      schema: SCHEMA,
      caseId: 'DEMO-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + Math.random().toString(36).slice(2, 6).toUpperCase(),
      title: '',
      seeded: false,
      createdAt: now,
      updatedAt: now,
      activeVersion: 1,
      versions: [newVersion(1)]
    };
  }

  /* ---------- Store ---------- */

  const Store = {
    state: null,
    createdFresh: false,
    _listeners: [],
    storageAvailable: true,

    onChange: function (fn) { this._listeners.push(fn); },
    emit: function (evt) {
      this._listeners.forEach(function (fn) { fn(evt || {}); });
    },

    load: function () {
      let raw = null;
      try {
        raw = window.localStorage.getItem(STORAGE_KEY);
      } catch (e) {
        this.storageAvailable = false;
      }
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          if (parsed && parsed.schema === SCHEMA && Array.isArray(parsed.versions) && parsed.versions.length) {
            this.state = parsed;
            this.createdFresh = false;
            return this.state;
          }
        } catch (e) { /* 损坏则重建 */ }
      }
      this.state = newCase();
      this.createdFresh = true;
      return this.state;
    },

    save: function () {
      if (!this.state) return false;
      // 落盘前强制隐私自检
      const audit = privacyAudit(this.state);
      if (!audit.ok) {
        U.toast('检测到疑似患者身份字段，已阻止保存：' + audit.hits.join('、'), 'bad');
        return false;
      }
      this.state.updatedAt = U.now();
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify(this.state));
      } catch (e) {
        this.storageAvailable = false;
      }
      return true;
    },

    clearStorage: function () {
      try { window.localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
    },

    current: function () {
      const st = this.state;
      if (!st) return null;
      return st.versions.filter(function (v) { return v.version === st.activeVersion; })[0] || st.versions[st.versions.length - 1];
    },

    mutate: function (fn, evt) {
      const out = fn(this.state, this.current());
      this.save();
      this.emit(evt || {});
      return out;
    },

    /* ----- 版本 ----- */

    isEditable: function () {
      const v = this.current();
      return v && v.status === 'draft';
    },

    /** 冻结校验码：只覆盖与手术部位相关的字段 */
    computeChecksum: function (v) {
      return U.checksum({
        laterality: v.laterality,
        note: v.note,
        markers: v.markers.map(function (m) {
          return { id: m.id, kind: m.kind, type: m.type, name: m.name, laterality: m.laterality, region: m.regionName, anchors: m.anchors };
        })
      });
    },

    addRevision: function () {
      const st = this.state;
      const cur = this.current();
      const n = st.versions.reduce(function (a, v) { return Math.max(a, v.version); }, 0) + 1;
      const v = newVersion(n);
      v.laterality = cur.laterality;
      v.note = cur.note;
      v.markers = JSON.parse(JSON.stringify(cur.markers)).map(function (m) {
        m.id = U.uid('M');
        m.createdAt = U.now();
        m.updatedAt = U.now();
        return m;
      });
      v.measurements = [];
      v.verify.history.push({
        at: U.now(), role: 'system', action: 'revision',
        detail: '基于 v' + cur.version + '（' + STATUS_TEXT[cur.status] + '）新建修订版 v' + n
      });
      st.versions.push(v);
      st.activeVersion = n;
      this.save();
      this.emit({ type: 'version' });
      return v;
    },

    setActiveVersion: function (n) {
      this.state.activeVersion = n;
      this.save();
      this.emit({ type: 'version' });
    },

    /* ----- 标记 ----- */

    addMarker: function (data) {
      if (!this.isEditable()) { U.toast('当前版本不可编辑（' + STATUS_TEXT[this.current().status] + '）', 'warn'); return null; }
      const cur = this.current();
      const marker = {
        id: U.uid('M'),
        kind: data.kind,
        type: data.type || 'incision',
        name: data.name || '',
        laterality: data.laterality || null,
        regionName: data.regionName || '',
        partName: data.partName || '',
        anchors: data.anchors,
        note: '',
        createdAt: U.now(),
        updatedAt: U.now()
      };
      if (!marker.name) {
        const cat = MARKER_TYPES[marker.type];
        if (data.regionKey && data.regionName) {
          // 直接按解剖部位生成的标记，用部位名做默认名（如「右上腹（季肋区）」）
          marker.name = data.regionName;
        } else {
          marker.name = (marker.kind === 'region' ? '区域标记' : '标记点') + ' ' + (cur.markers.length + 1) + '（' + cat.label + '）';
        }
      }
      cur.markers.push(marker);
      cur.updatedAt = U.now();
      this.save();
      this.emit({ type: 'markers', markerId: marker.id });
      return marker;
    },

    updateMarker: function (id, patch, quiet) {
      if (!this.isEditable()) { U.toast('当前版本不可编辑', 'warn'); return; }
      const cur = this.current();
      const m = cur.markers.filter(function (x) { return x.id === id; })[0];
      if (!m) return;
      Object.keys(patch).forEach(function (k) { m[k] = patch[k]; });
      m.updatedAt = U.now();
      cur.updatedAt = U.now();
      this.save();
      // quiet = 输入过程中的静默保存，不触发面板重绘，避免打断输入
      this.emit(quiet ? { type: 'quiet' } : { type: 'markers', markerId: id });
    },

    removeMarker: function (id) {
      if (!this.isEditable()) { U.toast('当前版本不可编辑', 'warn'); return; }
      const cur = this.current();
      cur.markers = cur.markers.filter(function (x) { return x.id !== id; });
      cur.updatedAt = U.now();
      this.save();
      this.emit({ type: 'markers' });
    },

    clearMarkers: function () {
      if (!this.isEditable()) return;
      const cur = this.current();
      cur.markers = [];
      cur.measurements = [];
      this.save();
      this.emit({ type: 'markers' });
    },

    /* ----- 测量 ----- */

    addMeasurement: function (anchors, mm) {
      if (!this.isEditable()) { U.toast('当前版本不可编辑', 'warn'); return; }
      const cur = this.current();
      cur.measurements.push({ id: U.uid('D'), anchors: anchors, mm: mm, createdAt: U.now() });
      this.save();
      this.emit({ type: 'markers' });
    },

    removeMeasurement: function (id) {
      if (!this.isEditable()) return;
      const cur = this.current();
      cur.measurements = cur.measurements.filter(function (x) { return x.id !== id; });
      this.save();
      this.emit({ type: 'markers' });
    },

    /* ----- 三方核查 ----- */

    canSubmit: function () {
      const v = this.current();
      if (!v || v.status !== 'draft') return { ok: false, reason: '当前版本状态为「' + (v ? STATUS_TEXT[v.status] : '-') + '」，不可提交' };
      if (!v.laterality) return { ok: false, reason: '请先选择手术侧别' };
      if (!v.markers.length) return { ok: false, reason: '请至少添加 1 个标记' };
      return { ok: true, reason: '' };
    },

    submitToVerify: function () {
      const c = this.canSubmit();
      if (!c.ok) { U.toast(c.reason, 'warn'); return false; }
      const v = this.current();
      v.status = 'pending';
      const prevHistory = v.verify.history || [];
      v.verify = newVerify();
      v.verify.history = prevHistory; // 保留历次操作留痕
      v.verify.history.push({
        at: U.now(), role: 'orderer', action: 'submit',
        detail: '提交三方核查（' + v.markers.length + ' 个标记 / ' + LATERALITY_TEXT[v.laterality] + '）'
      });
      this.save();
      this.emit({ type: 'verify' });
      return true;
    },

    confirmRole: function (role, items) {
      const v = this.current();
      if (!v || v.status !== 'pending') { U.toast('当前不处于核查阶段', 'warn'); return false; }
      const rec = v.verify.records[role];
      rec.items = items;
      rec.state = 'confirmed';
      rec.objection = '';
      rec.at = U.now();
      const roleName = (ROLES.filter(function (r) { return r.key === role; })[0] || {}).name || role;
      v.verify.history.push({ at: rec.at, role: role, action: 'confirm', detail: roleName + ' 确认核查通过' });
      this._recompute();
      this.save();
      this.emit({ type: 'verify' });
      return true;
    },

    objectRole: function (role, reason) {
      const v = this.current();
      if (!v || v.status !== 'pending') { U.toast('当前不处于核查阶段', 'warn'); return false; }
      if (!reason || !reason.trim()) { U.toast('提出异议必须填写理由', 'warn'); return false; }
      const rec = v.verify.records[role];
      rec.state = 'objected';
      rec.objection = reason.trim();
      rec.at = U.now();
      const roleName = (ROLES.filter(function (r) { return r.key === role; })[0] || {}).name || role;
      v.verify.history.push({ at: rec.at, role: role, action: 'object', detail: roleName + ' 提出异议：' + rec.objection });
      this._recompute();
      this.save();
      this.emit({ type: 'verify' });
      return true;
    },

    _recompute: function () {
      const v = this.current();
      const recs = v.verify.records;
      const anyObjected = ROLES.some(function (r) { return recs[r.key].state === 'objected'; });
      if (anyObjected) {
        if (v.status !== 'rejected') {
          v.status = 'rejected';
          v.verify.history.push({ at: U.now(), role: 'system', action: 'rejected', detail: '存在异议，方案已退回开单医生' });
        }
        return;
      }
      const allConfirmed = ROLES.every(function (r) { return recs[r.key].state === 'confirmed'; });
      if (allConfirmed && v.status === 'pending') {
        v.status = 'frozen';
        v.frozenAt = U.now();
        v.checksum = this.computeChecksum(v);
        v.verify.history.push({
          at: v.frozenAt, role: 'system', action: 'frozen',
          detail: '三方核查一致通过，方案冻结为只读，校验码 ' + v.checksum
        });
      }
    },

    verifySummary: function () {
      const v = this.current();
      if (!v) return { state: 'idle', text: '' };
      const recs = v.verify.records;
      const roleName = function (k) { return ((ROLES.filter(function (r) { return r.key === k; })[0]) || {}).name || k; };
      const objected = ROLES.filter(function (r) { return recs[r.key].state === 'objected'; });
      const confirmed = ROLES.filter(function (r) { return recs[r.key].state === 'confirmed'; });
      const waiting = ROLES.filter(function (r) { return recs[r.key].state === 'pending'; });

      if (v.status === 'draft') return { state: 'idle', text: '方案处于草稿状态，尚未提交核查。' };
      if (v.status === 'rejected') {
        return { state: 'bad', text: roleName(objected[0].key) + ' 提出异议，方案已退回修改。异议：' + objected[0].objection };
      }
      if (v.status === 'frozen') {
        return { state: 'ok', text: '三方核查一致通过，方案已冻结（' + U.fmtTime(v.frozenAt) + '）。校验码 ' + v.checksum + '。' };
      }
      if (waiting.length === ROLES.length) return { state: 'wait', text: '已提交核查，等待三方分别核对确认。' };
      return { state: 'wait', text: '已确认 ' + confirmed.length + '/3 方：' + (confirmed.map(function (r) { return roleName(r.key); }).join('、') || '无') + '；待确认：' + waiting.map(function (r) { return roleName(r.key); }).join('、') + '。' };
    },

    /* ----- 导入导出 ----- */

    exportJson: function () {
      const audit = privacyAudit(this.state);
      if (!audit.ok) { U.toast('导出被阻止：检测到疑似患者字段', 'bad'); return; }
      U.download('手术标记方案_' + this.state.caseId + '.json', JSON.stringify(this.state, null, 2), 'application/json');
      U.toast('已导出 JSON（不含患者信息）', 'ok');
    },

    importJson: function (text) {
      let parsed;
      try { parsed = JSON.parse(text); } catch (e) { U.toast('JSON 解析失败', 'bad'); return false; }
      if (!parsed || parsed.schema !== SCHEMA || !Array.isArray(parsed.versions)) {
        U.toast('文件格式不匹配（需为本系统导出的方案 JSON）', 'bad');
        return false;
      }
      const audit = privacyAudit(parsed);
      if (!audit.ok) { U.toast('导入被阻止：文件含疑似患者字段 ' + audit.hits.join('、'), 'bad'); return false; }
      this.state = parsed;
      this.createdFresh = false;
      this.save();
      this.emit({ type: 'all' });
      U.toast('导入成功', 'ok');
      return true;
    }
  };

  SMK.store = Store;
  SMK.catalog = {
    MARKER_TYPES: MARKER_TYPES,
    ROLES: ROLES,
    VERIFY_ITEMS: VERIFY_ITEMS,
    STATUS_TEXT: STATUS_TEXT,
    LATERALITY_TEXT: LATERALITY_TEXT,
    privacyAudit: privacyAudit,
    STORAGE_KEY: STORAGE_KEY
  };
})();
