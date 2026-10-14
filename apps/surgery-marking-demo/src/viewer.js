/* ============================================================
   viewer.js — 三维阅片区（场景 / 相机 / 交互 / 标记渲染）
   ------------------------------------------------------------
   交互约定（面向触屏与鼠标，均可用）：
     单指 / 左键拖拽 = 旋转视角；双指捏合 / 滚轮 = 缩放
     双指拖动 / 右键拖拽 = 平移；单击（不拖动）= 在体表取点
   所有标记位置均由 anchor 实时反算，任何视角操作都不改变标记位置。
   ============================================================ */
(function () {
  const SMK = (window.SMK = window.SMK || {});
  const U = SMK.util;

  /* ---------------- 相机轨道控制（自实现，避免额外依赖） ---------------- */
  function OrbitCam(camera, dom, target) {
    this.camera = camera;
    this.dom = dom;
    this.target = target || new THREE.Vector3(0, 0.95, 0);
    this.radius = 3.3;
    this.theta = 0;          // 方位角：0 = 正前方
    this.phi = Math.PI / 2;  // 极角：π/2 = 水平
    this.minR = 0.55;
    this.maxR = 9;
    this.minPhi = 0.06;
    this.maxPhi = Math.PI - 0.06;
    this.enabled = true;
    this.tween = null;
    this._ptrs = new Map();
    this._mode = null;
    this._last = null;
    this._pinch = 0;
    this._bind();
    this.apply();
  }

  OrbitCam.prototype._bind = function () {
    const self = this;
    const dom = this.dom;

    dom.addEventListener('pointerdown', function (e) {
      if (!self.enabled) return;
      try { dom.setPointerCapture && dom.setPointerCapture(e.pointerId); } catch (err) { /* 指针已释放时忽略 */ }
      self._ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      self.tween = null;
      if (self._ptrs.size === 1) {
        self._mode = (e.button === 2 || e.shiftKey) ? 'pan' : 'rotate';
        self._last = { x: e.clientX, y: e.clientY };
      } else if (self._ptrs.size === 2) {
        self._mode = 'pinch';
        const p = Array.from(self._ptrs.values());
        self._pinch = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
        self._last = { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2 };
      }
    });

    dom.addEventListener('pointermove', function (e) {
      if (!self.enabled || !self._ptrs.has(e.pointerId)) return;
      self._ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
      const pts = Array.from(self._ptrs.values());

      if (self._mode === 'pinch' && pts.length >= 2) {
        const d = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
        const cx = (pts[0].x + pts[1].x) / 2;
        const cy = (pts[0].y + pts[1].y) / 2;
        if (self._pinch > 0) self._zoom(self._pinch / d);
        self._pan(cx - self._last.x, cy - self._last.y);
        self._pinch = d;
        self._last = { x: cx, y: cy };
        self.apply();
        return;
      }

      const dx = e.clientX - self._last.x;
      const dy = e.clientY - self._last.y;
      self._last = { x: e.clientX, y: e.clientY };

      if (self._mode === 'pan') { self._pan(dx, dy); }
      else {
        self.theta -= dx * 0.0062;
        self.phi = U.clamp(self.phi - dy * 0.0062, self.minPhi, self.maxPhi);
      }
      self.apply();
    });

    const up = function (e) {
      self._ptrs.delete(e.pointerId);
      if (self._ptrs.size === 0) { self._mode = null; self._last = null; }
      else if (self._ptrs.size === 1) {
        const p = Array.from(self._ptrs.values())[0];
        self._mode = 'rotate';
        self._last = { x: p.x, y: p.y };
      }
    };
    dom.addEventListener('pointerup', up);
    dom.addEventListener('pointercancel', up);
    dom.addEventListener('contextmenu', function (e) { e.preventDefault(); });

    dom.addEventListener('wheel', function (e) {
      if (!self.enabled) return;
      e.preventDefault();
      self._zoom(Math.exp(e.deltaY * 0.0011));
      self.apply();
    }, { passive: false });
  };

  OrbitCam.prototype._zoom = function (k) {
    this.radius = U.clamp(this.radius * k, this.minR, this.maxR);
  };

  OrbitCam.prototype._pan = function (dx, dy) {
    const h = this.dom.clientHeight || 1;
    const k = (2 * this.radius * Math.tan((this.camera.fov * Math.PI / 180) / 2)) / h;
    const right = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(this.camera.matrix, 1);
    this.target.addScaledVector(right, -dx * k);
    this.target.addScaledVector(up, dy * k);
    this.target.y = U.clamp(this.target.y, -0.4, 2.4);
  };

  OrbitCam.prototype.apply = function () {
    const sp = new THREE.Spherical(this.radius, this.phi, this.theta);
    this.camera.position.setFromSpherical(sp).add(this.target);
    this.camera.lookAt(this.target);
    this.camera.updateMatrixWorld();
  };

  OrbitCam.prototype.goto = function (theta, phi, radius, targetY, animate) {
    const norm = function (t) { // 取最短角路径
      let d = t - this.theta;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      return this.theta + d;
    }.bind(this);
    const to = {
      theta: norm(theta),
      phi: phi,
      radius: radius == null ? this.radius : radius,
      targetY: targetY == null ? this.target.y : targetY
    };
    if (animate === false) {
      this.theta = to.theta; this.phi = to.phi; this.radius = to.radius; this.target.y = to.targetY;
      this.apply();
      return;
    }
    this.tween = {
      t0: performance.now(), dur: 480,
      from: { theta: this.theta, phi: this.phi, radius: this.radius, targetY: this.target.y },
      to: to
    };
  };

  OrbitCam.prototype.update = function (now) {
    if (!this.tween) return false;
    const t = U.clamp((now - this.tween.t0) / this.tween.dur, 0, 1);
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    const f = this.tween.from, to = this.tween.to;
    this.theta = f.theta + (to.theta - f.theta) * e;
    this.phi = f.phi + (to.phi - f.phi) * e;
    this.radius = f.radius + (to.radius - f.radius) * e;
    this.target.y = f.targetY + (to.targetY - f.targetY) * e;
    this.apply();
    if (t >= 1) this.tween = null;
    return true;
  };

  /* ---------------- 文字精灵（地面方位标识） ---------------- */
  function textSprite(text, color) {
    const c = document.createElement('canvas');
    c.width = 160; c.height = 80;
    const g = c.getContext('2d');
    g.clearRect(0, 0, c.width, c.height);
    g.font = 'bold 44px "Microsoft YaHei", sans-serif';
    g.fillStyle = color || '#5f6d82';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(text, c.width / 2, c.height / 2);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.55 }));
    sp.scale.set(0.22, 0.11, 1);
    return sp;
  }

  /* ---------------- Viewer ---------------- */
  /**
   * @param body 由外部异步加载并构建好的模型（SMK.body.buildFromGLTF 的返回值）。
   *             模型加载是异步的，因此 Viewer 不再自己构建模型。
   */
  function Viewer(container, labelLayer, body) {
    this.container = container;
    this.labelLayer = labelLayer;
    this.body = body;
    this.markers = [];
    this.measurements = [];
    this.selectedId = null;
    this.interactMode = 'select';
    this.markersVisible = true;
    this.ghost = false;
    this.draftPoints = [];
    this._pickCbs = [];
    this._hoverCbs = [];
    this._markerPickables = [];
    this._draftGroup = new THREE.Group();
    this._measureGroup = new THREE.Group();
    this._regionLayer = new THREE.Group();   // 整块部位高亮层（预览 / 选中）
    this._regionLayer.name = 'RegionHighlight';
    this.hoverRegionKey = null;              // 悬停预览的部位
    this.activeRegionKey = null;             // 已选中的部位
    this._labelMap = new Map();
    this._markerGroups = new Map();

    this._initScene();
    this._bindInput();
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  Viewer.prototype._initScene = function () {
    const w = this.container.clientWidth || 800;
    const h = this.container.clientHeight || 600;

    this.camera = new THREE.PerspectiveCamera(38, w / h, 0.02, 60);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true, alpha: true, preserveDrawingBuffer: true
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.06;
    this.container.appendChild(this.renderer.domElement);

    this.scene = new THREE.Scene();

    this.camera.position.set(0, 0.95, 3.3);
    this.camera.lookAt(0, 0.95, 0);
    this.controls = new OrbitCam(this.camera, this.renderer.domElement, new THREE.Vector3(0, 0.95, 0));

    /* 灯光：三点布光，保证体表曲面明暗关系可读 */
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.52));
    const hemi = new THREE.HemisphereLight(0xdfe9ff, 0x1b2130, 0.85);
    this.scene.add(hemi);
    const key = new THREE.DirectionalLight(0xffffff, 1.75);
    key.position.set(2.4, 3.4, 3.2);
    this.scene.add(key);
    const fill = new THREE.DirectionalLight(0xbcd2ff, 0.6);
    fill.position.set(-3, 1.6, -2.4);
    this.scene.add(fill);
    const rim = new THREE.DirectionalLight(0xffffff, 0.35);
    rim.position.set(0, -2, -1);
    this.scene.add(rim);

    /* 地面网格 + 方位标识 */
    const grid = new THREE.GridHelper(3.2, 16, 0x35415a, 0x212938);
    grid.position.y = 0.002;
    grid.material.transparent = true;
    grid.material.opacity = 0.7;
    this.scene.add(grid);

    const fr = 1.28;
    const f1 = textSprite('前'); f1.position.set(0, 0.012, fr); f1.scale.set(0.16, 0.08, 1); this.scene.add(f1);
    const f2 = textSprite('后'); f2.position.set(0, 0.012, -fr); f2.scale.set(0.16, 0.08, 1); this.scene.add(f2);
    const f3 = textSprite('患者左'); f3.position.set(fr, 0.012, 0); f3.scale.set(0.30, 0.085, 1); this.scene.add(f3);
    const f4 = textSprite('患者右'); f4.position.set(-fr, 0.012, 0); f4.scale.set(0.30, 0.085, 1); this.scene.add(f4);

    /* 人体模型：由外部加载的真实解剖模型（肌骨系统，826 个具名结构） */
    this.bodyRoot = this.body.group;
    this.bodyMeshes = this.body.meshes;
    this.scene.add(this.bodyRoot);
    this.bodyRoot.add(this._draftGroup);
    this.bodyRoot.add(this._measureGroup);
    this.bodyRoot.add(this._regionLayer);

    // 立即同步世界矩阵：射线拾取依赖 matrixWorld，
    // 否则在首帧渲染前调用拾取（例如播种示例标记）会全部落空。
    this.scene.updateMatrixWorld(true);

    /* 结构索引：每个解剖结构 = 一个可整块选中的「部位」。
       接口与原分区索引同构（key/name/centroid/normal/geometry），消费方无感。 */
    this.regionIndex = this.body.structureIndex;
    this.bodyRoot.userData.regionIndex = this.regionIndex;
    this.bodyRoot.userData.ensureGeometry = this.body.ensureGeometry;

    /* 类别显隐：骨骼 / 脏器 / 脑与神经（默认脑隐藏，避免颅内结构喧宾夺主） */
    this.catVisible = { bone: true, viscera: true, brain: false, other: true };
    const self2 = this;
    this.bodyMeshes.forEach(function (m) {
      m.visible = self2.catVisible[m.userData.smkType || 'other'] !== false;
    });

    /* 层模式：部位层与脏器层如何共存
       both       —— 两层都显示；点模型选结构，「部位」工具下优先选体表分区
       regionOnly —— 只看体表分区（人形色块），点模型即选分区
       organOnly  —— 只看脏器 / 骨骼，点模型即选结构                              */
    this.layerMode = 'both';
    this.regionMeshes = this.body.regionMeshes || [];
    this.updatePickTargets();

    const self = this;
    if (window.ResizeObserver) {
      this._ro = new ResizeObserver(function () { self.resize(); });
      this._ro.observe(this.container);
    }
    window.addEventListener('resize', function () { self.resize(); });
  };

  Viewer.prototype.resize = function () {
    const w = this.container.clientWidth || 800;
    const h = this.container.clientHeight || 600;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  /* ---------------- 输入：单击取点 / 悬停探查 ---------------- */

  Viewer.prototype._bindInput = function () {
    const self = this;
    const dom = this.renderer.domElement;
    let down = null;

    dom.addEventListener('pointerdown', function (e) {
      down = { x: e.clientX, y: e.clientY, t: performance.now(), moved: false };
    });
    dom.addEventListener('pointermove', function (e) {
      if (down && (Math.abs(e.clientX - down.x) > 5 || Math.abs(e.clientY - down.y) > 5)) down.moved = true;
      self._hover(e);
    });
    dom.addEventListener('pointerup', function (e) {
      if (!down) return;
      const isClick = !down.moved && performance.now() - down.t < 600;
      down = null;
      if (isClick) self._click(e);
    });
    dom.addEventListener('pointerleave', function () { self._emitHover(null); });
  };

  Viewer.prototype._ndc = function (e) {
    const r = this.renderer.domElement.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * 2 - 1, y: -((e.clientY - r.top) / r.height) * 2 + 1 };
  };

  Viewer.prototype._ray = function (e) {
    const ndc = this._ndc(e);
    const rc = new THREE.Raycaster();
    rc.setFromCamera(new THREE.Vector2(ndc.x, ndc.y), this.camera);
    return { rc: rc, ndc: ndc };
  };

  Viewer.prototype._click = function (e) {
    const r = this._ray(e);

    // 仅在选择模式下把点击让给已有标记（取点/测量/区域模式需连续取点，不受已有标记干扰）
    if (this.interactMode === 'select') {
      const markerHits = r.rc.intersectObjects(this._markerPickables, false);
      if (markerHits.length) {
        const id = markerHits[0].object.userData.markerId;
        this._pickCbs.forEach(function (cb) { cb({ type: 'marker', markerId: id, ndc: r.ndc }); });
        return;
      }
    }

    const hit = SMK.anchors.pick(r.rc, this._pickMeshes, this.body.resolveRegion);
    if (hit) {
      this._pickCbs.forEach(function (cb) {
        cb({
          type: 'body', anchor: hit.anchor, worldPoint: hit.worldPoint,
          regionKey: hit.regionKey, regionName: hit.regionName,
          partName: hit.partName, laterality: hit.laterality, ndc: r.ndc
        });
      });
    } else {
      this._pickCbs.forEach(function (cb) { cb({ type: 'empty', ndc: r.ndc }); });
    }
  };

  const _hoverRC = new THREE.Raycaster();
  const _hoverNdc = new THREE.Vector2();
  // 826 个结构的拾取比原 24 部件重，悬停探针限频（约 22 次/秒），肉眼无感
  let _lastHover = 0;
  Viewer.prototype._hover = function (e) {
    if (!this._hoverCbs.length) return;
    const now = performance.now();
    if (now - _lastHover < 45) return;
    _lastHover = now;
    const co = this._ndc(e);
    _hoverNdc.set(co.x, co.y);
    _hoverRC.setFromCamera(_hoverNdc, this.camera);
    const hit = SMK.anchors.pick(_hoverRC, this._pickMeshes, this.body.resolveRegion);
    this._emitHover(hit ? { regionKey: hit.regionKey, regionName: hit.regionName, partName: hit.partName, laterality: hit.laterality, group: hit.group, worldPoint: hit.worldPoint } : null);
  };

  Viewer.prototype._emitHover = function (info) {
    this._hoverCbs.forEach(function (cb) { cb(info); });
  };

  Viewer.prototype.onPick = function (fn) { this._pickCbs.push(fn); };
  Viewer.prototype.onHover = function (fn) { this._hoverCbs.push(fn); };

  /* ---------------- 视图预设 ---------------- */

  Viewer.prototype.setView = function (name, animate) {
    const P = {
      front: [0, Math.PI / 2],
      back: [Math.PI, Math.PI / 2],
      left: [Math.PI / 2, Math.PI / 2],
      right: [-Math.PI / 2, Math.PI / 2],
      top: [this.controls.theta, 0.1]
    };
    const p = P[name];
    if (!p) return;
    this.controls.goto(p[0], p[1], name === 'top' ? 3.0 : this.controls.radius, 0.95, animate !== false);
  };

  Viewer.prototype.fit = function () {
    this.controls.goto(this.controls.theta, this.controls.phi, 3.3, 0.95, true);
  };

  /* ---------------- 模型显示 ---------------- */

  Viewer.prototype.setGhost = function (on) {
    this.ghost = !!on;
    // GLTF 材质在结构间共享（骨骼/肌肉各一种），逐 mesh 设置幂等且安全
    this.bodyMeshes.forEach(function (m) {
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      mats.forEach(function (mt) {
        if (!mt) return;
        mt.transparent = this.ghost;
        mt.opacity = this.ghost ? 0.34 : 1;
        mt.depthWrite = !this.ghost;
        mt.needsUpdate = true;
      }, this);
    }, this);
  };

  Viewer.prototype.setMarkerVisible = function (on) {
    this.markersVisible = !!on;
    this._markerGroups.forEach(function (g) { g.visible = this.markersVisible; }, this);
    this._measureGroup.visible = this.markersVisible;
    this._labelMap.forEach(function (el) {
      el.style.display = this.markersVisible ? '' : 'none';
    }, this);
  };

  /* ---------------- 草稿点（区域标记 / 测量取点） ---------------- */

  Viewer.prototype.setDraft = function (points) {
    this.draftPoints = points || [];
    while (this._draftGroup.children.length) {
      const c = this._draftGroup.children.pop();
      this._draftGroup.remove(c);
      c.geometry && c.geometry.dispose();
      c.material && c.material.dispose();
    }
    const self = this;
    this.draftPoints.forEach(function (p) {
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(0.009, 12, 10),
        new THREE.MeshBasicMaterial({ color: 0x38bdf8 })
      );
      const r = SMK.anchors.resolve(p.anchor, self.bodyRoot);
      m.position.copy(r.position).addScaledVector(r.normal, 0.006);
      self._draftGroup.add(m);
    });
    if (this.draftPoints.length >= 2) {
      const pts = this.draftPoints.map(function (p) {
        const r = SMK.anchors.resolve(p.anchor, self.bodyRoot);
        return r.position.clone().addScaledVector(r.normal, 0.006);
      });
      const g = new THREE.BufferGeometry().setFromPoints(pts);
      this._draftGroup.add(new THREE.Line(g, new THREE.LineBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.8 })));
    }
  };

  /* ============================================================
     整块解剖部位：高亮、聚焦、取点
     ------------------------------------------------------------
     高亮分两级：
       悬停预览（hover）—— 指针指向哪里，就把该点所属部位整块淡淡点亮，
                           回答「我指的到底是哪个部位」；
       选中（active）    —— 从部位列表选中，或用「部位」工具点击模型，
                           整块实色高亮并描出解剖边界，保持到切换为止。
     ============================================================ */

  const HL_ACTIVE = { color: 0x2f7cf6, opacity: 0.36, outline: 0xffffff, outlineOpacity: 0.9 };
  const HL_HOVER = { color: 0x38bdf8, opacity: 0.18 };

  Viewer.prototype.setHoverRegion = function (key) {
    const k = key || null;
    if (k === this.hoverRegionKey) return;
    this.hoverRegionKey = k;
    this._rebuildRegionHighlight();
  };

  Viewer.prototype.setActiveRegion = function (key) {
    const k = key || null;
    if (k === this.activeRegionKey) return;
    this.activeRegionKey = k;
    this._rebuildRegionHighlight();
  };

  Viewer.prototype.clearRegions = function () {
    if (!this.hoverRegionKey && !this.activeRegionKey) return;
    this.hoverRegionKey = null;
    this.activeRegionKey = null;
    this._rebuildRegionHighlight();
  };

  Viewer.prototype._rebuildRegionHighlight = function () {
    const layer = this._regionLayer;
    while (layer.children.length) {
      const c = layer.children.pop();
      layer.remove(c);
      if (c.material) c.material.dispose();   // 几何来自分区索引，是共享的，绝不可 dispose
    }
    const idx = this.regionIndex;
    if (!idx) return;

    const add = function (key, style) {
      const r = idx.get(key);
      if (!r) return;
      // 该类结构被类别显隐关掉时，连同它的高亮一起撤掉
      if (!this.isStructureVisible(key)) return;
      // 结构高亮几何懒建并缓存（共享，勿 dispose）
      const geo = r.geometry || (this.body.ensureGeometry ? this.body.ensureGeometry(r) : null);
      if (!geo) return;
      const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
        color: style.color, transparent: true, opacity: style.opacity,
        side: THREE.DoubleSide, depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4
      }));
      mesh.renderOrder = 3;
      layer.add(mesh);
      if (style.outline && r.outlineGeo) {
        const ln = new THREE.LineSegments(r.outlineGeo, new THREE.LineBasicMaterial({
          color: style.outline, transparent: true, opacity: style.outlineOpacity
        }));
        ln.renderOrder = 4;
        layer.add(ln);
      }
    }.bind(this);

    if (this.activeRegionKey) add(this.activeRegionKey, HL_ACTIVE);
    if (this.hoverRegionKey && this.hoverRegionKey !== this.activeRegionKey) add(this.hoverRegionKey, HL_HOVER);
  };

  /** 相机正对该部位：方位由该部位的平均法线决定，距离按其尺寸自适应 */
  Viewer.prototype.focusRegion = function (key, animate) {
    const r = this.regionIndex && this.regionIndex.get(key);
    if (!r) return;
    const c = r.centroid.clone();
    this.bodyRoot.localToWorld(c);
    const n = r.normal.clone().transformDirection(this.bodyRoot.matrixWorld).normalize();
    const theta = Math.atan2(n.x, n.z);
    const phi = Math.acos(U.clamp(n.y, -1, 1));
    // 体表分区是一层「皮面」，半径小但属于躯干局部，凑太近反而看不清方位，
    // 因此部位 / 图谱分区用更大的最近距离兜底
    const isPart = r.type === 'part' || r.type === 'subpart';
    const minD = isPart ? 1.05 : 0.62;
    const dist = U.clamp(Math.max(minD, r.radius * 3.2), minD, 3.2);
    this.controls.target.set(c.x, c.y, c.z);
    this.controls.goto(theta, U.clamp(phi, 0.22, Math.PI - 0.22), dist, c.y, animate !== false);
  };

  /**
   * 由 root 局部坐标（通常取部位质心）+ 指向体外的法线，向体表投射，
   * 得到标准点锚定 —— 用于「标记部位中心」这类操作。
   * 质心本身在体表曲面包围之内，直接向外投射即可命中；
   * 三角形正面朝外，从内向外命中需临时允许双面拾取。
   * 长骨一类包围盒中心可能落在骨体之外（如股骨颈与骨干之间的凹陷），
   * 单方向射线会整个落空，因此最后用 6 个轴向兜底再找一次。
   * @param {THREE.Mesh} [filterMesh] 指定时，优先取属于该网格的命中点
   *                  （质心外投可能先穿过浅层结构，须锁定目标结构自身的表面）
   */
  Viewer.prototype.pickAtLocal = function (point, normal, filterMesh) {
    const pw = point.clone().applyMatrix4(this.bodyRoot.matrixWorld);
    const nw = (normal || new THREE.Vector3(0, 0, 1)).clone()
      .transformDirection(this.bodyRoot.matrixWorld).normalize();
    const saved = this.bodyMeshes.map(function (m) { return m.material.side; });
    this.bodyMeshes.forEach(function (m) { m.material.side = THREE.DoubleSide; });
    const cast = function (dir, only) {
      const rc = new THREE.Raycaster(pw, dir, 1e-4, 1.4);
      const targets = only ? [filterMesh] : this._pickMeshes;
      if (only && !rc.intersectObject(filterMesh, false).length) return null;
      return SMK.anchors.pick(rc, targets, this.body.resolveRegion);
    }.bind(this);
    // 指定了目标结构：只接受落在该结构上的命中（打不到就如实返回 null，
    // 绝不改锚到旁边的结构上 —— 否则标记名与实际位置会对不上）
    let hit = cast(nw, !!filterMesh);
    if (!hit && filterMesh) {
      const dirs = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
      for (let i = 0; i < dirs.length && !hit; i++) {
        hit = cast(new THREE.Vector3(dirs[i][0], dirs[i][1], dirs[i][2]).normalize(), true);
      }
    }
    if (!hit && !filterMesh) hit = cast(nw, false);
    this.bodyMeshes.forEach(function (m, i) { m.material.side = saved[i]; });
    return hit;
  };

  /* ---------------- 层模式（仅部位 / 仅脏器 / 全部） ---------------- */

  /** 按当前层模式与工具，决定射线拾取的目标集合 */
  Viewer.prototype.updatePickTargets = function () {
    const organ = this.bodyMeshes.filter(function (m) { return m.visible; });
    const region = this.regionMeshes.filter(function (m) { return m.visible; });
    this._organPickMeshes = organ;
    this._regionPickMeshes = region;
    const mode = this.layerMode;
    if (mode === 'organOnly') this._pickMeshes = organ;
    else if (mode === 'regionOnly') this._pickMeshes = region;
    else this._pickMeshes = (this.interactMode === 'part') ? region.concat(organ) : organ;
  };

  /**
   * 切换层模式：把「仅部位 / 仅脏器 / 全部」落到可见性与拾取列表上，
   * 并联动部位高亮缓存、标记显隐。
   */
  Viewer.prototype.setLayerMode = function (mode) {
    if (['both', 'regionOnly', 'organOnly'].indexOf(mode) < 0) return;
    this.layerMode = mode;
    const showRegion = mode !== 'organOnly';
    const showOrgan = mode !== 'regionOnly';
    if (this.body.regionLayer) this.body.regionLayer.group.visible = showRegion;
    const self = this;
    this.bodyMeshes.forEach(function (m) {
      m.visible = showOrgan && self.catVisible[m.userData.smkType || 'other'] !== false;
    });
    this.updatePickTargets();
    // 部位高亮是成员几何的合并缓存，成员可见性变了必须重建
    this.regionIndex.forEach(function (s) { if (s.members) s.geometry = null; });
    this._rebuildRegionHighlight();
    if (this.markers) this.buildMarkers(this.markers, this.measurements, this.selectedId);
    this.renderOnce && this.renderOnce();
  };

  Viewer.prototype.getLayerMode = function () { return this.layerMode; };

  /* ---------------- 类别显隐（骨骼 / 脏器 / 脑与神经） ---------------- */

  /** 显隐一类结构：联动拾取列表、部位高亮缓存与标记可见性 */
  Viewer.prototype.setCategoryVisible = function (type, on) {
    if (!(type in this.catVisible)) return;
    const v = !!on;
    if (this.catVisible[type] === v) return;
    this.catVisible[type] = v;
    const showOrgan = this.layerMode !== 'regionOnly';
    this.bodyMeshes.forEach(function (m) {
      if ((m.userData.smkType || 'other') === type) m.visible = v && showOrgan;
    });
    this.updatePickTargets();
    // 部位高亮是成员几何的合并缓存，成员可见性变了必须重建
    this.regionIndex.forEach(function (s) {
      if (s.members) s.geometry = null;
    });
    this._rebuildRegionHighlight();
    if (this.markers) this.buildMarkers(this.markers, this.measurements, this.selectedId);
    this.renderOnce && this.renderOnce();
  };

  /** 结构当前是否可见（用于标记联动显隐） */
  Viewer.prototype.isStructureVisible = function (key) {
    const s = this.regionIndex && this.regionIndex.get(key);
    if (!s) return true;
    // 部位 / 图谱细分分区归属「部位层」：该层被层级切换隐藏时，
    // 挂在其上的标记必须一并隐藏，否则会出现悬空的部位标记。
    if (s.type === 'part' || s.type === 'subpart') {
      const layer = this.body && this.body.regionLayer;
      if (layer && layer.group && layer.group.visible === false) return false;
    }
    if (s.members) {
      return s.members.some(function (m) {
        const mesh = m.isMesh ? m : m.mesh;             // 部位层成员是原始分区网格
        return !!mesh && mesh.visible;
      });
    }
    if (s.mesh) return s.mesh.visible;
    return true;
  };

  /* ---------------- 标记渲染 ---------------- */

  Viewer.prototype.buildMarkers = function (markers, measurements, selectedId) {
    this.markers = markers || [];
    this.measurements = measurements || [];
    this.selectedId = selectedId || null;

    // 清空旧内容
    this._markerPickables = [];
    this._markerGroups.forEach(function (g) {
      g.parent && g.parent.remove(g);
      g.traverse(function (o) {
        // 分区索引里的几何是共享的（多个标记可能指向同一部位），不可销毁
        if (o.geometry && !o.geometry.userData.shared) o.geometry.dispose();
        if (o.material) { (Array.isArray(o.material) ? o.material : [o.material]).forEach(function (mm) { mm.dispose(); }); }
      });
    });
    this._markerGroups = new Map();
    this.labelLayer.innerHTML = '';
    this._labelMap = new Map();

    while (this._measureGroup.children.length) {
      const c = this._measureGroup.children.pop();
      this._measureGroup.remove(c);
      c.geometry && c.geometry.dispose();
      c.material && c.material.dispose();
    }

    const self = this;
    const cat = SMK.catalog.MARKER_TYPES;

    this.markers.forEach(function (m, i) {
      // 结构被隐藏（类别显隐）时其标记一并隐藏，避免"悬空标记"
      const a0 = m.anchors[0] || {};
      const sk = a0.regionKey || a0.meshId;
      if (sk && !self.isStructureVisible(sk)) return;

      const meta = cat[m.type] || cat.other;
      const color = new THREE.Color(meta.color);
      const g = new THREE.Group();
      g.userData.markerId = m.id;
      g.visible = self.markersVisible;
      let labelPos = null;

      if (m.kind === 'region') {
        // 区域标记有两种锚定：① 手工圈选的多边形（anchors 为点集）
        //                   ② 直接选中的完整解剖部位（anchors = [{ regionKey }]）
        const isPart = !!(m.anchors[0] && m.anchors[0].regionKey);
        const geo = SMK.anchors.buildRegionGeometry(m.anchors, self.bodyRoot, self.bodyRoot);
        if (geo) {
          const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
            color: color, transparent: true, opacity: isPart ? 0.30 : 0.32,
            side: THREE.DoubleSide, depthWrite: false,
            polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3
          }));
          mesh.userData.markerId = m.id;
          g.add(mesh);
          g.userData.regionMesh = mesh;
          self._markerPickables.push(mesh);
        }
        if (isPart) {
          // 部位边界（只被一个面使用的边），让整块选中看起来有明确解剖范围
          const og = SMK.anchors.buildPartOutline(m.anchors[0].regionKey, self.bodyRoot);
          if (og) {
            g.add(new THREE.LineSegments(og, new THREE.LineBasicMaterial({ color: color, transparent: true, opacity: 0.95 })));
          }
        } else {
          const pts = SMK.anchors.buildRegionOutline(m.anchors, self.bodyRoot);
          if (pts) {
            const lg = new THREE.BufferGeometry().setFromPoints(pts);
            g.add(new THREE.Line(lg, new THREE.LineBasicMaterial({ color: color, transparent: true, opacity: 0.95 })));
          }
        }
        // 区域中心用于放置标签与拾取
        const sum = new THREE.Vector3();
        let sn = new THREE.Vector3();
        let n = 0;
        m.anchors.forEach(function (a) {
          const r = SMK.anchors.resolve(a, self.bodyRoot);
          if (r) { sum.add(r.position); sn.add(r.normal); n++; }
        });
        if (n) {
          sum.multiplyScalar(1 / n);
          sn.normalize();
          labelPos = sum.clone().addScaledVector(sn, 0.05);
          g.userData.center = sum.clone();
          g.userData.normal = sn.clone();
          const pickS = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), new THREE.MeshBasicMaterial({ visible: false }));
          pickS.position.copy(sum);
          pickS.userData.markerId = m.id;
          g.add(pickS);
          self._markerPickables.push(pickS);
          // 中心小球，强化区域位置感
          const core = new THREE.Mesh(new THREE.SphereGeometry(0.008, 10, 8), new THREE.MeshBasicMaterial({ color: color }));
          core.position.copy(sum);
          g.add(core);
        }
      } else {
        const r = SMK.anchors.resolve(m.anchors[0], self.bodyRoot);
        if (r) {
          const p = r.position.clone().addScaledVector(r.normal, 0.005);
          const nrm = r.normal.clone().normalize();
          const sphere = new THREE.Mesh(
            new THREE.SphereGeometry(0.0125, 18, 14),
            new THREE.MeshBasicMaterial({ color: color })
          );
          sphere.position.copy(p);
          g.add(sphere);

          const ring = new THREE.Mesh(
            new THREE.RingGeometry(0.020, 0.0285, 30),
            new THREE.MeshBasicMaterial({ color: color, side: THREE.DoubleSide, transparent: true, opacity: 0.92, depthWrite: false })
          );
          ring.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), nrm);
          ring.position.copy(p.clone().addScaledVector(nrm, 0.0016));
          g.add(ring);

          const stem = new THREE.Mesh(
            new THREE.CylinderGeometry(0.0016, 0.0016, 0.03, 6),
            new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.8 })
          );
          stem.position.copy(p.clone().addScaledVector(nrm, 0.02));
          stem.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), nrm);
          g.add(stem);

          labelPos = p.clone().addScaledVector(nrm, 0.05);
          g.userData.center = p.clone();
          g.userData.normal = nrm;
          g.userData.sphere = sphere;
          g.userData.ring = ring;

          const pickS = new THREE.Mesh(new THREE.SphereGeometry(0.036, 10, 8), new THREE.MeshBasicMaterial({ visible: false }));
          pickS.position.copy(p);
          pickS.userData.markerId = m.id;
          g.add(pickS);
          self._markerPickables.push(pickS);
        }
      }

      self.bodyRoot.add(g);
      self._markerGroups.set(m.id, g);
      g.userData.labelPos = labelPos;

      // HTML 标签
      if (labelPos) {
        const el = document.createElement('div');
        el.className = 'marker-label';
        el.style.color = meta.color;
        el.dataset.markerId = m.id;
        el.innerHTML = '<span class="idx">' + (i + 1) + '</span><span class="mname">' + U.escapeHtml(m.name) + '</span>';
        el.title = m.name + ' · ' + (m.regionName || '') + (m.laterality ? ' · ' + SMK.catalog.LATERALITY_TEXT[m.laterality] : '');
        el.addEventListener('click', function (ev) {
          ev.stopPropagation();
          self._pickCbs.forEach(function (cb) { cb({ type: 'marker', markerId: m.id, from: 'label' }); });
        });
        self.labelLayer.appendChild(el);
        self._labelMap.set(m.id, el);
      }
    });

    /* 测量线 */
    this.measurements.forEach(function (dm) {
      const a = SMK.anchors.resolve(dm.anchors[0], self.bodyRoot);
      const b = SMK.anchors.resolve(dm.anchors[1], self.bodyRoot);
      if (!a || !b) return;
      const pa = a.position.clone().addScaledVector(a.normal, 0.006);
      const pb = b.position.clone().addScaledVector(b.normal, 0.006);
      const geo = new THREE.BufferGeometry().setFromPoints([pa, pb]);
      const mat = new THREE.LineDashedMaterial({ color: 0x38bdf8, dashSize: 0.012, gapSize: 0.008, transparent: true, opacity: 0.9 });
      const line = new THREE.Line(geo, mat);
      line.computeLineDistances();
      self._measureGroup.add(line);
      [pa, pb].forEach(function (p) {
        const s = new THREE.Mesh(new THREE.SphereGeometry(0.006, 10, 8), new THREE.MeshBasicMaterial({ color: 0x38bdf8 }));
        s.position.copy(p);
        self._measureGroup.add(s);
      });
      const mid = pa.clone().add(pb).multiplyScalar(0.5);
      const el = document.createElement('div');
      el.className = 'measure-label';
      el.dataset.measureId = dm.id;
      el.textContent = dm.mm + ' mm';
      self.labelLayer.appendChild(el);
      self._labelMap.set('D:' + dm.id, el);
      self._measureGroup.userData['pos:' + dm.id] = mid;
    });

    this._applySelection();
  };

  Viewer.prototype._applySelection = function () {
    const cat = SMK.catalog.MARKER_TYPES;
    const typeOf = {};
    this.markers.forEach(function (m) { typeOf[m.id] = m.type; });
    this._markerGroups.forEach(function (g, id) {
      const sel = id === this.selectedId;
      const sp = g.userData.sphere, ring = g.userData.ring;
      if (sp) sp.scale.setScalar(sel ? 1.18 : 1);
      if (ring) {
        ring.scale.setScalar(sel ? 1.34 : 1);
        const meta = cat[typeOf[id]] || cat.other;
        ring.material.color.set(sel ? 0xffffff : new THREE.Color(meta.color));
      }
      // 区域标记（含整块部位标记）没有小球，用面片浓度表达选中
      const rm = g.userData.regionMesh;
      if (rm) rm.material.opacity = sel ? 0.58 : 0.30;
      const el = this._labelMap.get(id);
      if (el) el.classList.toggle('selected', sel);
    }, this);
  };

  Viewer.prototype.setInteractMode = function (m) {
    this.interactMode = m || 'select';
    this.updatePickTargets();      // 部位工具下拾取目标优先体表分区
  };

  Viewer.prototype.setSelected = function (id) {
    this.selectedId = id;
    this._applySelection();
  };

  Viewer.prototype.focusMarker = function (id) {
    const g = this._markerGroups.get(id);
    if (!g || !g.userData.center) return;
    const c = g.userData.center.clone();
    this.bodyRoot.localToWorld(c);
    this.controls.target.set(c.x, c.y, c.z);
    this.controls.goto(this.controls.theta, this.controls.phi, Math.max(0.95, Math.min(this.controls.radius, 1.5)), c.y, true);
  };

  /* ---------------- 标签跟随 ---------------- */

  const _p = new THREE.Vector3();
  Viewer.prototype._syncLabels = function () {
    if (!this.markersVisible) return;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    const self = this;
    const entries = [];

    this._markerGroups.forEach(function (g, id) {
      const el = this._labelMap.get(id);
      if (!el) return;
      const lp = g.userData.labelPos;
      if (!lp) { el.style.display = 'none'; return; }
      entries.push({ el: el, pos: lp, nrm: g.userData.normal });
    }, this);

    this.measurements.forEach(function (dm) {
      const el = self._labelMap.get('D:' + dm.id);
      const mid = self._measureGroup.userData['pos:' + dm.id];
      if (!el) return;
      if (!mid) { el.style.display = 'none'; return; }
      entries.push({ el: el, pos: mid, nrm: null });
    });

    const placed = [];
    const GAP = 25;
    entries.forEach(function (e) {
      _p.copy(e.pos);
      self.bodyRoot.localToWorld(_p);
      const world = _p.clone();
      const proj = _p.project(self.camera);
      const x = (proj.x * 0.5 + 0.5) * w;
      const y = (-proj.y * 0.5 + 0.5) * h;
      const onScreen = proj.z < 1 && x > -70 && x < w + 70 && y > -34 && y < h + 34;
      if (!onScreen) { e.el.style.display = 'none'; return; }

      let facing = 1;
      if (e.nrm) {
        const camDir = world.clone().sub(self.camera.position).normalize();
        facing = -e.nrm.clone().transformDirection(self.bodyRoot.matrixWorld).dot(camDir);
      }
      if (facing < -0.05) { e.el.style.display = 'none'; return; }
      e.el.style.display = '';
      e.el.classList.toggle('dim', facing <= 0.16);

      // 防重叠：与已放置标签过近时向下避让
      let py = y;
      for (let k = 0; k < 10; k++) {
        const clash = placed.some(function (p) { return Math.abs(p[0] - x) < 92 && Math.abs(p[1] - py) < GAP; });
        if (!clash) break;
        py += GAP;
      }
      placed.push([x, py]);
      e.el.style.transform = 'translate(-50%,-50%) translate(' + x.toFixed(1) + 'px,' + py.toFixed(1) + 'px)';
    });
  };

  /* ---------------- 渲染循环 ---------------- */

  /** 暂停/恢复持续渲染（静止省电，对平板与笔记本有意义） */
  Viewer.prototype.setPaused = function (on) { this._paused = !!on; };

  Viewer.prototype.renderOnce = function () {
    this.controls.update(performance.now());
    this.renderer.render(this.scene, this.camera);
    this._syncLabels();
  };

  Viewer.prototype._loop = function (now) {
    if (this._paused) { requestAnimationFrame(this._loop); return; }
    this.controls.update(now);
    this.renderer.render(this.scene, this.camera);
    this._syncLabels();
    requestAnimationFrame(this._loop);
  };

  /** 导出截图：把透明画布合成到深色底上 */
  Viewer.prototype.snapshot = function () {
    const src = this.renderer.domElement;
    const out = document.createElement('canvas');
    out.width = src.width;
    out.height = src.height;
    const g = out.getContext('2d');
    const grd = g.createRadialGradient(out.width / 2, out.height * 0.4, 10, out.width / 2, out.height * 0.4, Math.max(out.width, out.height) * 0.75);
    grd.addColorStop(0, '#1a2029');
    grd.addColorStop(1, '#0e1218');
    g.fillStyle = grd;
    g.fillRect(0, 0, out.width, out.height);
    g.drawImage(src, 0, 0, out.width, out.height);
    return out.toDataURL('image/png');
  };

  SMK.Viewer = Viewer;
})();
