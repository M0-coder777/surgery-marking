/* ============================================================
   app.js — 启动（异步模型加载）、示例数据播种
   ------------------------------------------------------------
   模型：models/organs-bones.glb（骨骼 + 脏器，734 个中文命名结构，
   由 Z-Anatomy 图谱提取，不含肌肉 / 血管神经 / 皮肤）。
   http(s) 环境自动加载；file:// 直开时浏览器禁止 fetch，
   降级为「选择 / 拖入模型文件」，解析结果完全一致。
   ============================================================ */
(function () {
  const SMK = window.SMK;
  const U = SMK.util;
  const Store = SMK.store;

  /* ---------------- 模型加载遮罩 ---------------- */

  const $ov = function () { return document.getElementById('modelOverlay'); };

  function showOverlay() {
    const ov = $ov();
    if (!ov) return;
    ov.classList.remove('hidden');
    ov.innerHTML =
      '<div class="mo-box">' +
      '<div class="mo-title">正在加载解剖模型</div>' +
      '<div class="mo-bar"><i id="moBar"></i></div>' +
      '<div class="mo-text" id="moText">准备中…</div>' +
      '</div>';
  }

  function setProgress(loaded, total) {
    const bar = document.getElementById('moBar');
    const txt = document.getElementById('moText');
    if (total) {
      const pct = Math.round(loaded / total * 100);
      if (bar) bar.style.width = pct + '%';
      if (txt) txt.textContent = '下载模型 ' + (loaded / 1048576).toFixed(1) + ' / ' + (total / 1048576).toFixed(1) + ' MB（' + pct + '%），随后解码…';
    }
  }

  function setText(t) {
    const txt = document.getElementById('moText');
    if (txt) txt.textContent = t;
  }

  function hideOverlay() {
    const ov = $ov();
    if (ov) ov.classList.add('hidden');
  }

  /** file:// 降级：请用户选择 / 拖入模型文件 */
  function showFilePicker() {
    const ov = $ov();
    ov.classList.remove('hidden');
    ov.innerHTML =
      '<div class="mo-box">' +
      '<div class="mo-title">选择解剖模型文件</div>' +
      '<div class="mo-text">当前是直接双击打开（file://）方式，浏览器不允许网页自动读取本地文件。<br>' +
      '请点击下方按钮选择 <b>organs-bones.glb</b>（位于应用的 models 文件夹），或将其拖入本页。</div>' +
      '<button class="btn btn-primary" id="moPick" style="margin-top:12px">选择 organs-bones.glb 文件</button>' +
      '<input type="file" id="moFile" accept=".glb,model/gltf-binary" hidden />' +
      '</div>';
    const file = document.getElementById('moFile');
    document.getElementById('moPick').addEventListener('click', function () { file.click(); });
    ov.addEventListener('dragover', function (e) { e.preventDefault(); });
    ov.addEventListener('drop', function (e) {
      e.preventDefault();
      if (e.dataTransfer.files && e.dataTransfer.files[0]) loadFromFile(e.dataTransfer.files[0]);
    });
    file.addEventListener('change', function () {
      if (file.files && file.files[0]) loadFromFile(file.files[0]);
    });
  }

  function loadFromFile(f) {
    setText('读取文件中…');
    const rd = new FileReader();
    rd.onload = function () {
      setText('解析模型中…（Draco 解码约需数秒）');
      SMK.modelLoader.parseBuffer(rd.result).then(function (gltf) {
        setup(gltf.scene, 'file');
      }).catch(function (err) {
        failOverlay('模型解析失败：' + err.message);
      });
    };
    rd.onerror = function () { failOverlay('文件读取失败'); };
    rd.readAsArrayBuffer(f);
  }

  function failOverlay(msg) {
    const ov = $ov();
    ov.classList.remove('hidden');
    ov.innerHTML =
      '<div class="mo-box">' +
      '<div class="mo-title" style="color:#f87171">模型加载失败</div>' +
      '<div class="mo-text">' + U.escapeHtml(msg) + '</div>' +
      '<button class="btn" id="moRetry" style="margin-top:12px">重试</button>' +
      '</div>';
    const b = document.getElementById('moRetry');
    if (b) b.addEventListener('click', function () { location.reload(); });
  }

  /* ---------------- 示例播种（打在真实结构上） ---------------- */

  /** 在给定近似位置沿法线方向向体表投射，得到真实锚点 */
  function pickAt(viewer, approx, dirArr) {
    const p = new THREE.Vector3().fromArray(approx);
    let d;
    if (dirArr) d = new THREE.Vector3().fromArray(dirArr).normalize();
    else {
      d = new THREE.Vector3(p.x, 0, p.z);
      if (d.lengthSq() < 1e-6) d.set(0, 0, 1);
      d.normalize();
    }
    const origin = p.clone().addScaledVector(d, 0.35);
    const rc = new THREE.Raycaster(origin, d.clone().negate(), 1e-4, 1.2);
    return SMK.anchors.pick(rc, viewer.bodyMeshes, viewer.body.resolveRegion);
  }

  /** 找一个结构：支持精确名 / 包含匹配；忽略重号后缀差异 */
  function findStructure(viewer, namePart, side, exact) {
    let found = null;
    viewer.regionIndex.forEach(function (st) {
      if (found) return;
      if (st.type === 'part' || st.type === 'subpart') return;
      if (exact) { if (st.name !== namePart && st.name !== namePart + '#' + 1) return; }
      else if (st.name.toLowerCase().indexOf(namePart.toLowerCase()) < 0) return;
      if (side && st.laterality !== side) return;
      found = st;
    });
    return found;
  }

  /** 在结构质心处落一个点标记（质心沿外向法线投射到自身表面） */
  function seedPointAt(viewer, st, name, type) {
    const hit = viewer.pickAtLocal(st.centroid, st.normal, st.mesh);
    if (!hit) return null;
    return Store.addMarker({
      kind: 'point', type: type, name: name,
      laterality: st.laterality || hit.laterality || null,
      regionName: st.name, partName: st.partName,
      anchors: [hit.anchor]
    });
  }

  function seedDemo() {
    const viewer = SMK.ui.viewer;
    if (!viewer || !Store.isEditable()) return;
    viewer.scene.updateMatrixWorld(true); // 拾取依赖世界矩阵，播种前强制同步

    const st = Store.state;
    st.title = '示例方案：右上腹手术部位标记';
    Store.current().laterality = 'right';

    // 1) 整块结构标记：胆囊切除范围（真实解剖范围）
    const gb = findStructure(viewer, '胆囊', 'right') || findStructure(viewer, '胆囊');
    if (gb) {
      Store.addMarker({
        kind: 'region', type: 'resection', name: '',
        laterality: gb.laterality || 'right',
        regionName: gb.name, partName: gb.partName,
        regionKey: gb.key,
        anchors: [{ regionKey: gb.key }]
      });
    }

    // 2) 点标记：切口起点（肝）
    const liver = findStructure(viewer, '肝', null, true) || findStructure(viewer, '肝', 'left');
    if (liver) seedPointAt(viewer, liver, '切口起点', 'incision');

    // 3) 点标记：穿刺点（脾）
    const spleen = findStructure(viewer, '脾', null, true) || findStructure(viewer, '脾');
    if (spleen) seedPointAt(viewer, spleen, '穿刺点', 'puncture');

    // 4) 体表部位标记：右季肋区（右上腹）—— 临床九分区整块选中
    const parts = viewer.body.bodyParts || [];
    const ru = parts.filter(function (p) { return p.code === 'abd.RU'; })[0];
    if (ru) {
      Store.addMarker({
        kind: 'region', type: 'resection', name: '',
        laterality: ru.laterality || 'right',
        regionName: ru.name, partName: ru.partName,
        regionKey: ru.key,
        anchors: [{ regionKey: ru.key }]
      });
    }

    // 5) 体表部位标记：左前臂 —— 展示全身分区（不止腹部），可作为手术入路区
    const fore = parts.filter(function (p) { return p.code === 'arm.L.fore'; })[0];
    if (fore) {
      Store.addMarker({
        kind: 'region', type: 'drainage', name: '',
        laterality: fore.laterality || 'left',
        regionName: fore.name, partName: fore.partName,
        regionKey: fore.key,
        anchors: [{ regionKey: fore.key }]
      });
    }

    // 示例测量：切口起点 → 穿刺点
    const ms = Store.current().markers;
    if (ms.length >= 3) {
      const mA = ms[1], mB = ms[2];
      const A = SMK.anchors.resolve(mA.anchors[0], viewer.bodyRoot);
      const B = SMK.anchors.resolve(mB.anchors[0], viewer.bodyRoot);
      if (A && B) {
        Store.addMeasurement([mA.anchors[0], mB.anchors[0]], Math.round(A.world.distanceTo(B.world) * 1000));
      }
    }

    Store.state.seeded = true;
    Store.save();
  }

  /* ---------------- 启动 ---------------- */

  function setup(gltfScene, regionScene, source) {
    try {
      const body = SMK.body.buildFromGLTF(gltfScene, regionScene);

      const viewer = new SMK.Viewer(
        document.getElementById('viewport'),
        document.getElementById('labelLayer'),
        body
      );
      SMK.ui.init(viewer);

      if (!Store.state.seeded) {
        seedDemo();
      }
      SMK.ui.refresh();
      hideOverlay();

      U.toast('模型已加载：' + body.structureCount + ' 个解剖结构 · ' +
        body.bodyParts.length + ' 个体表部位' +
        (source === 'file' ? '（本地文件）' : ''), 'ok');
    } catch (e) {
      failOverlay('初始化失败：' + (e.message || e));
    }
  }

  function boot() {
    if (!window.THREE || !THREE.GLTFLoader) {
      document.body.innerHTML = '<div style="padding:40px;font-family:sans-serif;color:#c0313a">' +
        '<h3>三维引擎或模型加载器未能加载</h3><p>请确认 vendor/three.min.js 与 vendor/three/anatomy-loaders.js 存在且未被拦截。</p></div>';
      return;
    }

    Store.load();
    showOverlay();

    // 脏器层必载；部位层加载失败也能降级运行（只是没有体表分区）
    const pOrgan = SMK.modelLoader.load({ url: 'models/organs-bones.glb', onProgress: setProgress });
    const pRegion = SMK.modelLoader.load({ url: 'models/body-regions.glb' })
      .catch(function () { return null; });

    Promise.all([pOrgan, pRegion]).then(function (rs) {
      setText('解码与建索引中…');
      // 让进度文字先渲染一帧
      setTimeout(function () { setup(rs[0].scene, rs[1] && rs[1].scene, rs[0].source); }, 30);
    }).catch(function (err) {
      if (err && err.code === 'FILE_PROTOCOL') {
        showFilePicker();
      } else {
        failOverlay((err && err.message) || String(err) + '<br>请确认通过本地服务访问（如 python -m http.server），或改用「选择文件」方式。');
      }
    });
  }

  SMK.app = { seedDemo: seedDemo, boot: boot };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
