/* ============================================================
   anatomy.js — 真实解剖模型（GLB）→ 可标记结构 的适配层  V0.4
   ------------------------------------------------------------
   模型：models/organs-bones.glb —— 由 Startup.glb（Z-Anatomy
   中文解剖图谱）提取的「骨骼 + 脏器」子集，无肌肉、无血管神经、
   无皮肤与标签。734 个具名中文结构，1.70 m 标准人体。

   · 分类（type）由提取器写入节点 extras：bone / viscera / brain
   · 体区分组：模型自带完整中文解剖分类树（骨骼系统.g → 胸廓 /
     脊柱 / 颅…；内脏系统.g → 消化 / 呼吸 / 泌尿…），本文件按
     「祖先链 + 结构名」规则映射为体区，几何兜底；
   · 体表部位（右上腹 / 左下腹…）：以剑突、耻骨联合等骨性标志
     划出腹部九分区，每个部位是该分区内所有结构的一个聚合体，
     注入结构索引后与普通结构同样可悬停预览 / 整块选中 / 标记；
   · 方位约定：+Y 上，+Z 患者腹侧，+X 患者左侧。
   ============================================================ */
(function () {
  const SMK = (window.SMK = window.SMK || {});

  const TYPE_LABEL = { bone: '骨骼', viscera: '脏器', brain: '脑与神经', other: '其他' };
  const TYPE_ORDER = { bone: 0, viscera: 1, brain: 2, other: 3 };

  /* 面板分组与排序（「体表部位」置顶，是医生最常用的入口） */
  const REGION_ORDER = ['体表部位', '头部', '脑与神经', '颈部', '胸部', '腹部',
    '盆部与会阴', '脊柱', '左上肢', '右上肢', '左下肢', '右下肢', '其他'];

  /* ============================================================
     体区判定规则：用「祖先分组链 + 结构名」顺序匹配，命中即归组。
     模型的分类树是中文的（如 骨骼系统.g|胸廓|胸骨），规则写得
     越靠前优先级越高 —— 具体（膀胱 / 直肠）先于宽泛（泌尿 / 肠）。
     ============================================================ */
  const CHAIN_RULES = [
    [/牙|唾液腺|腮腺|下颌下腺|舌下腺|口腔|口\.g|舌|腭|扁桃体|鼻/, '头部'],
    [/眼|耳|听小骨|眶|泪/, '头部'],
    [/脊髓|脊柱|脊椎|尾骨|骶骨|脊神经/, '脊柱'],
    [/肩带|upper limb|上肢骨|上肢关节|自由上肢/, '上肢'],
    [/下肢骨|下肢关节|盆带|自由下肢|lower limb/, '下肢'],
    [/胸廓|肋|胸骨/, '胸部'],
    [/颅|颅骨连结|颅外头骨/, '头部'],
    [/垂体|松果体|脑|脑脊膜|脑神经|中枢神经|周围神经/, '脑与神经'],
    [/甲状腺|甲状旁腺|咽|喉|环状|杓状|会厌|舌骨/, '颈部'],
    [/肺|支气管|气管|食管|心|心包|胸腺|膈/, '胸部'],
    [/直肠|肛管|膀胱|尿道|前列腺|精囊|睾丸|附睾|输精管|阴茎|阴囊|子宫|卵巢|输卵管|生殖/, '盆部与会阴'],
    [/泌尿|肾|肾上腺|输尿管|脾|消化|肝|胆囊|胆管|胰|胃|肠|阑尾|腹腔|腹膜|网膜|系膜/, '腹部']
  ];

  /** 体区归组：先按分类树规则，未命中再按几何位置兜底 */
  function classify(structure, chain, LM) {
    const hay = chain + '|' + structure.name;
    let g = null;
    for (let i = 0; i < CHAIN_RULES.length; i++) {
      if (CHAIN_RULES[i][0].test(hay)) { g = CHAIN_RULES[i][1]; break; }
    }
    /* 上下肢加侧别前缀（规则只产出中性名，侧别由结构重心推断）。
       中轴骨（耻骨联合 / 耻骨间盘）重心落在正中，无法判侧别，
       但解剖上属于骨盆，归入「盆部与会阴」而不是裸的「下肢」。 */
    if (g === '上肢' || g === '下肢') {
      const lat = structure.laterality;
      if (lat) return (lat === 'left' ? '左' : '右') + g;
      return g === '下肢' ? '盆部与会阴' : '胸部';
    }
    if (g) return g;
    /* 几何兜底：仅处理分类树之外的少数结构（如睑板软骨） */
    const c = structure.centroid;
    const lat = structure.laterality;
    if (LM) {
      if (LM.yJaw != null && c.y > LM.yJaw) return '头部';
      if (LM.ySterTop != null && c.y > LM.ySterTop) return '颈部';
      if (LM.yXiph != null && c.y > LM.yXiph) return '胸部';
      if (LM.yPubis != null && c.y > LM.yPubis - 0.03) return '腹部';
      if (Math.abs(c.x) > 0.10 && c.y > LM.yPubis - 0.05) return '盆部与会阴';
      if (Math.abs(c.x) > 0.13) return lat ? (lat === 'left' ? '左上肢' : '右上肢') : '上肢';
      return lat ? (lat === 'left' ? '左下肢' : '右下肢') : '盆部与会阴';
    }
    const ax = Math.abs(c.x);
    if (ax > 0.13 && c.y > 0.30) return lat ? (lat === 'left' ? '左上肢' : '右上肢') : '上肢';
    if (c.y > 1.45) return '头部';
    if (c.y > 1.36) return '颈部';
    if (c.y > 0.92) return '胸部';
    if (c.y > 0.72) return '腹部';
    return lat ? (lat === 'left' ? '左下肢' : '右下肢') : '盆部与会阴';
  }

  /* ============================================================
     腹部九分区（临床「九分法」）
     ------------------------------------------------------------
     两条横线（人体测量学标定，以耻骨联合上缘为基准）：
       上 = 肋下平面  yPubis + 0.159·H   （≈ L1/L3 水平）
       下 = 结节间平面 yPubis + 0.056·H   （≈ L5 水平）
     两条竖线：左右锁骨中线，x = ±0.028·H（本模型 ≈ ±4.8 cm）
     患者左 = +x，因此「右季肋区」在 -x 一侧。
     成员只取脏器（骨骼另行选择），归属按结构包围盒与分区盒的
     重叠面积占比取最大者 —— 避免跨区结构因质心略偏而归错。
     ============================================================ */
  const BODY_PARTS = [
    { key: 'part:abd.RU', code: 'abd.RU', name: '右季肋区', alias: '右上腹', lat: 'right' },
    { key: 'part:abd.EP', code: 'abd.EP', name: '腹上区', alias: '上腹部', lat: null },
    { key: 'part:abd.LU', code: 'abd.LU', name: '左季肋区', alias: '左上腹', lat: 'left' },
    { key: 'part:abd.RL', code: 'abd.RL', name: '右腰区', alias: '右侧腹', lat: 'right' },
    { key: 'part:abd.UM', code: 'abd.UM', name: '脐区', alias: '脐周', lat: null },
    { key: 'part:abd.LL', code: 'abd.LL', name: '左腰区', alias: '左侧腹', lat: 'left' },
    { key: 'part:abd.RI', code: 'abd.RI', name: '右髂区', alias: '右下腹', lat: 'right' },
    { key: 'part:abd.HY', code: 'abd.HY', name: '腹下区', alias: '下腹部', lat: null },
    { key: 'part:abd.LI', code: 'abd.LI', name: '左髂区', alias: '左下腹', lat: 'left' }
  ];

  /** 在结构索引里找骨性标志（真实几何包围盒，非访问器声明值）。
      模型命名中英混排（中文图谱 + Blender 英文骨名），两套关键词都要给。 */
  function findLandmarks(map) {
    const pick = function (pred) {
      let out = null;
      map.forEach(function (s) { if (!out && pred(s)) out = s; });
      return out;
    };
    const xiph = pick(function (s) { return s.type === 'bone' && /剑突|xiphoid/i.test(s.name); });
    const pubis = pick(function (s) { return s.type === 'bone' && /耻骨联合|耻骨间盘|pubic symphysis/i.test(s.name); });
    const jaw = pick(function (s) { return s.type === 'bone' && /下颌骨|mandible/i.test(s.name); });
    const sternum = pick(function (s) { return s.type === 'bone' && /胸骨体|body of sternum|(^|[^a-z])sternum/i.test(s.name); });
    const LM = {};
    if (xiph) LM.yXiph = xiph.bbox.min.y;
    if (pubis) LM.yPubis = pubis.bbox.max.y;
    if (jaw) LM.yJaw = jaw.bbox.min.y;
    if (sternum) LM.ySterTop = sternum.bbox.max.y;
    LM.src = {
      xiph: xiph && xiph.name, pubis: pubis && pubis.name,
      jaw: jaw && jaw.name, sternum: sternum && sternum.name
    };
    return LM;
  }

  /** 九分区：成员为该分区内（按重叠占比归属）的腹盆腔脏器 */
  function buildBodyParts(map, LM, H) {
    if (LM.yPubis == null) return [];                    // 缺标志点则不给部位
    const yTop = LM.yPubis + 0.159 * H;
    const yBot = LM.yPubis + 0.056 * H;
    const xLine = 0.028 * H;
    const xLimit = 0.22;                                  // 躯干半宽上限（排除上肢）
    // 候选结构：腹部 / 盆部与会阴 两组中的脏器（排除外生殖器，
    // 否则胸腔支气管、头部泪囊等会因「y 高于上横线」被误圈进上腹部）
    const CAND = /腹部|盆部与会阴/;
    const NOT_CAND = /阴茎|阴囊|睾丸|附睾|阴蒂|外阴|精索静脉/;
    // 归属判据（一个脏器可同时属于多个分区 —— 九分区之间本就没有
    // 解剖隔膜，肝、结肠、肾都天然跨区）：
    //   ① 与分区盒的重叠面积占比最大者 —— 必纳入（保证每个分区
    //      至少有一个「代表结构」，分区不因判据偏严而整体消失）；
    //   ② 重叠占比 ≥ SHARE_MIN 的分区 —— 一并纳入。
    // 单属（只取最大者）会让「左髂区（左下腹）」成为空集：该区在
    // 本模型里没有以它为主属的脏器，但降结肠末段、输精管确实经过。
    const SHARE_MIN = 0.15;

    const rows = [
      { yMin: yTop, yMax: 1e9 },
      { yMin: yBot, yMax: yTop },
      { yMin: -1e9, yMax: yBot }
    ];
    const boxes = BODY_PARTS.map(function (p, i) {
      const row = rows[Math.floor(i / 3)];
      return {
        def: p,
        xMin: p.lat === 'right' ? -xLimit : p.lat === 'left' ? xLine : -xLine,
        xMax: p.lat === 'right' ? -xLine : p.lat === 'left' ? xLimit : xLine,
        yMin: row.yMin, yMax: row.yMax,
        members: []
      };
    });
    map.forEach(function (s) {
      if (s.type !== 'viscera') return;                   // 部位只聚合脏器
      if (!CAND.test(s.group) || NOT_CAND.test(s.name)) return;
      const a = s.bbox;
      const w = Math.max(1e-6, a.max.x - a.min.x);
      const h = Math.max(1e-6, a.max.y - a.min.y);
      const area = w * h;
      const share = boxes.map(function (b) {
        const ox = Math.min(a.max.x, b.xMax) - Math.max(a.min.x, b.xMin);
        const oy = Math.min(a.max.y, b.yMax) - Math.max(a.min.y, b.yMin);
        if (ox <= 0 || oy <= 0) return 0;
        return (ox * oy) / area;
      });
      let best = 0;
      for (let i = 1; i < share.length; i++) if (share[i] > share[best]) best = i;
      boxes.forEach(function (b, i) {
        if (i === best || share[i] >= SHARE_MIN) b.members.push(s);
      });
    });
    /* 兜底：极端情况下若仍有空分区，取重叠占比最高者，保证 9 个分区齐全 */
    boxes.forEach(function (b) {
      if (b.members.length) return;
      let pick = null, bestF = 0;
      map.forEach(function (s) {
        if (s.type !== 'viscera') return;
        if (!CAND.test(s.group) || NOT_CAND.test(s.name)) return;
        const a = s.bbox;
        const w = Math.max(1e-6, a.max.x - a.min.x);
        const h = Math.max(1e-6, a.max.y - a.min.y);
        const ox = Math.min(a.max.x, b.xMax) - Math.max(a.min.x, b.xMin);
        const oy = Math.min(a.max.y, b.yMax) - Math.max(a.min.y, b.yMin);
        if (ox <= 0 || oy <= 0) return;
        const f = (ox * oy) / (w * h);
        if (f > bestF) { bestF = f; pick = s; }
      });
      if (pick) b.members.push(pick);
    });
    const out = [];
    boxes.forEach(function (b) {
      if (!b.members.length) return;
      const p = b.def;
      const c = new THREE.Vector3();
      let r = 0, tri = 0;
      const bb = { min: new THREE.Vector3(1e9, 1e9, 1e9), max: new THREE.Vector3(-1e9, -1e9, -1e9) };
      b.members.forEach(function (s) {
        c.add(s.centroid); r += s.radius; tri += s.triCount;
        bb.min.min(s.bbox.min); bb.max.max(s.bbox.max);
      });
      c.multiplyScalar(1 / b.members.length);
      const n = new THREE.Vector3(c.x, 0, c.z);
      if (n.lengthSq() < 1e-6) n.set(0, 0, 1);
      out.push({
        key: p.key, code: p.code, name: p.name, alias: p.alias, baseName: p.name,
        partName: '部位', type: 'part', group: '体表部位',
        laterality: p.lat,
        centroid: c, normal: n.normalize(), radius: Math.max(0.05, r / b.members.length),
        bbox: bb, triCount: tri, members: b.members, mesh: null, geometry: null
      });
    });
    return out;
  }

  /* ============================================================
     结构索引构建
     ============================================================ */
  function buildStructureIndex(bodyRoot, meshes) {
    bodyRoot.updateMatrixWorld(true);
    const rootInv = new THREE.Matrix4().copy(bodyRoot.matrixWorld).invert();
    const map = new Map();
    const usedNames = new Map();
    const box = new THREE.Box3();
    const HL_OFFSET = 0.0016;

    /** 祖先分组链（模型自带中文解剖分类树） */
    function chainOf(mesh) {
      const out = [];
      let o = mesh.parent;
      while (o) { if (o.name) out.push(o.name); o = o.parent; }
      return out.join('|');
    }

    meshes.forEach(function (mesh) {
      // 多图元节点：GLTFLoader 会把节点拆成多个 THREE.Mesh 并把 extras
      // 挂在父 Group 上，因此节点自身无 type 时需沿父链向上取
      let meta = mesh.userData || {};
      if (!meta.type) {
        let p = mesh.parent;
        while (p && !(p.userData && p.userData.type)) p = p.parent;
        if (p) meta = p.userData;
      }
      const ex = meta;
      const rawName = mesh.name || '(未命名)';
      let id = rawName;
      if (usedNames.has(id)) {
        const k = usedNames.get(id) + 1;
        usedNames.set(rawName, k);
        id = rawName + '#' + k;
      } else {
        usedNames.set(rawName, 1);
      }
      // 模型的原始名左右成对重名（输尿管.l / 输尿管.r、脑沟 *.l / *.r），
      // 场景里必须唯一，否则 anchors 用 getObjectByName 反查会命中另一侧。
      mesh.userData.meshId = id;
      mesh.name = id;

      const type = ex.type === 'bone' || ex.type === 'viscera' || ex.type === 'brain'
        ? ex.type : 'other';
      // 提取器已把清理过的中文名写进 extras.cn（去 .l/.r/.001 后缀）
      const displayName = (ex.cn || rawName).replace(/_/g, ' ').trim() || rawName;

      mesh.geometry.computeBoundingBox();
      box.copy(mesh.geometry.boundingBox).applyMatrix4(mesh.matrixWorld);
      const min = box.min.clone().applyMatrix4(rootInv);
      const max = box.max.clone().applyMatrix4(rootInv);
      const centroid = min.clone().add(max).multiplyScalar(0.5);
      const size = max.clone().sub(min);
      const radius = size.length() * 0.5;

      const laterality = centroid.x > 0.008 ? 'left' : centroid.x < -0.008 ? 'right' : null;

      const st = {
        key: id,
        baseName: displayName,
        name: displayName,
        partName: TYPE_LABEL[type],
        type: type,
        laterality: laterality,
        centroid: centroid,
        normal: null,
        radius: radius,
        bbox: { min: min, max: max },
        triCount: mesh.geometry.index
          ? Math.floor(mesh.geometry.index.count / 3)
          : Math.floor(mesh.geometry.attributes.position.count / 3),
        mesh: mesh,
        geometry: null
      };
      st._chain = chainOf(mesh);
      mesh.userData.smkType = type;
      st.group = classify(st, st._chain, null);   // 先用规则，标志点算完后会重算
      const n = new THREE.Vector3(centroid.x, 0, centroid.z);
      if (n.lengthSq() < 1e-6) n.set(0, 0, 1);
      st.normal = n.normalize();
      map.set(id, st);
    });

    /* —— 标志点 → 重算几何兜底分组 + 九分区 —— */
    const LM = findLandmarks(map);
    let ymin = 1e9, ymax = -1e9;
    map.forEach(function (s) { ymin = Math.min(ymin, s.bbox.min.y); ymax = Math.max(ymax, s.bbox.max.y); });
    const H = ymax - ymin;
    map.forEach(function (s) {
      if (!CHAIN_RULES.some(function (r) { return r[0].test(s._chain + '|' + s.name); })) {
        s.group = classify(s, s._chain, LM);
      }
    });
    /* 部位（体表分区）改由图谱分区层提供，见 attachRegionLayer；
       这里只算出腹部九分区的「区内结构」归属，供信息展示。 */

    /* —— 高亮几何懒建：网格几何变换到 root 局部并沿法线微外扩 —— */
    const pos = new THREE.Vector3();
    const nor = new THREE.Vector3();
    const meshGeoCache = new Map();          // mesh → 外扩后的 root 局部几何（跨条目共享）

    function geometryOfMesh(mesh) {
      if (meshGeoCache.has(mesh)) return meshGeoCache.get(mesh);
      const g = mesh.geometry;
      const src = g.attributes.position;
      const nrm = g.attributes.normal;
      const idx = g.index;
      const out = new Float32Array(src.count * 3);
      for (let i = 0; i < src.count; i++) {
        pos.fromBufferAttribute(src, i).applyMatrix4(mesh.matrixWorld);
        if (nrm) {
          nor.fromBufferAttribute(nrm, i).transformDirection(mesh.matrixWorld);
          pos.addScaledVector(nor, HL_OFFSET);
        }
        pos.applyMatrix4(rootInv);
        out[i * 3] = pos.x; out[i * 3 + 1] = pos.y; out[i * 3 + 2] = pos.z;
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(out, 3));
      if (idx) geo.setIndex(Array.from(idx.array));
      geo.userData.shared = true;
      meshGeoCache.set(mesh, geo);
      return geo;
    }

    /** 结构条目 / 部位条目 → 高亮几何（按条目缓存，复用网格级缓存） */
    function ensureGeometry(entry) {
      if (entry.geometry) return entry.geometry;
      if (entry.members) return ensurePartGeometry(entry);
      entry.geometry = geometryOfMesh(entry.mesh);
      return entry.geometry;
    }

    /** 部位 = 成员几何的合并。成员可以是结构条目，也可以是体表分区网格 */
    function ensurePartGeometry(entry) {
      const geos = [];
      let total = 0, idxTotal = 0;
      entry.members.forEach(function (s) {
        const mesh = s.isMesh ? s : s.mesh;
        if (!mesh || !mesh.visible) return;              // 隐藏的类别不参与部位高亮
        const g = s.isMesh ? geometryOfMesh(s) : ensureGeometry(s);
        if (!g) return;
        geos.push(g);
        total += g.attributes.position.count;
        idxTotal += g.index ? g.index.count : 0;
      });
      if (!geos.length) return null;
      const arr = new Float32Array(total * 3);
      let o = 0;
      const index = idxTotal ? new Uint32Array(idxTotal) : null;
      let io = 0, base = 0;
      geos.forEach(function (g) {
        arr.set(g.attributes.position.array, o * 3);
        if (index) {
          const gi = g.index.array;
          for (let i = 0; i < gi.length; i++) index[io++] = gi[i] + base;
        }
        base += g.attributes.position.count;
        o += g.attributes.position.count;
      });
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
      if (index) geo.setIndex(new THREE.BufferAttribute(index, 1));
      geo.userData.shared = true;
      entry.geometry = geo;
      return geo;
    }

    return {
      map: map, ensureGeometry: ensureGeometry, landmarks: LM,
      abdomenParts: buildBodyParts(map, LM, H),      // 仅供「区内结构」信息用，不注入索引
      bodyHeight: H
    };
  }

  /* ============================================================
     部位层（体表分区）
     ------------------------------------------------------------
     模型：models/body-regions.glb —— 图谱 `人体分区.g` 子树，
     250 个真实解剖分区（图层次），本层按 regions.js 的归并表
     折叠为 34 个临床大区；图谱原始层级保留在 atlas 里供下钻。
     · 体表分区用一份统一的中性半透明材质，读起来是一个「人形」；
     · 每个分区网格带 userData.majorKey，点模型即整块选中该区；
     · 与脏器层共用 bodyRoot 局部坐标系（同源提取，已实测对齐）。
     ============================================================ */
  function attachRegionLayer(root, regionScene, built) {
    regionScene.name = 'RegionLayer';
    root.add(regionScene);
    root.updateMatrixWorld(true);
    const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert();

    const shellMat = new THREE.MeshStandardMaterial({
      color: 0xd6dae0, roughness: 0.94, metalness: 0.0,
      transparent: true, opacity: 0.24, side: THREE.DoubleSide, depthWrite: false
    });
    shellMat.name = 'RegionShell';

    const meshes = [];
    regionScene.traverse(function (o) { if (o.isMesh) meshes.push(o); });
    const used = new Map();
    meshes.forEach(function (m) {
      m.material = shellMat;
      m.renderOrder = -2;
      let id = m.name || 'region';
      if (used.has(id)) { const k = used.get(id) + 1; used.set(id, k); id = id + '#' + k; }
      else used.set(id, 1);
      m.name = id;
      m.userData.meshId = id;
      m.userData.smkType = 'part';
    });

    /* 归组到「图谱分区节点」：多图元节点被 GLTFLoader 拆成多个 Mesh，
       extras 挂在父 Group 上，故沿父链上溯到 type === 'region' 的节点 */
    function ownerOf(m) {
      let o = m;
      while (o) {
        if (o.userData && o.userData.type === 'region') return o;
        o = o.parent;
      }
      return null;
    }
    const nodeMap = new Map();
    meshes.forEach(function (m) {
      const own = ownerOf(m);
      if (!own) return;
      if (!nodeMap.has(own)) nodeMap.set(own, []);
      nodeMap.get(own).push(m);
    });

    const regionNodes = [];
    nodeMap.forEach(function (ms, owner) {
      const e = owner.userData || {};
      const anc = [];
      let p = owner.parent;
      while (p && p !== regionScene) {
        const pu = p.userData || {};
        if (pu.type === 'regionGroup' && pu.cn && pu.cn !== '人体分区') anc.unshift(pu.cn);
        p = p.parent;
      }
      const bb = { min: new THREE.Vector3(1e9, 1e9, 1e9), max: new THREE.Vector3(-1e9, -1e9, -1e9) };
      ms.forEach(function (m) {
        m.geometry.computeBoundingBox();
        const b = new THREE.Box3().copy(m.geometry.boundingBox)
          .applyMatrix4(m.matrixWorld).applyMatrix4(rootInv);
        bb.min.min(b.min); bb.max.max(b.max);
      });
      regionNodes.push({
        cn: e.cn || owner.name, side: e.side || '', sys: e.sys || '',
        ancestors: anc, path: anc.join(' › '),
        meshes: ms, bbox: bb
      });
    });

    const merged = SMK.regions.buildParts(regionNodes, built.map);

    /* 腹部九分区：补「区内结构」信息（沿用器官包围盒与临床分区盒的重叠归属） */
    const abdOrgans = {};
    (built.abdomenParts || []).forEach(function (p) { abdOrgans[p.code] = p.members || []; });
    merged.parts.forEach(function (p) { if (abdOrgans[p.code]) p.organMembers = abdOrgans[p.code]; });

    /* 分区网格 → 大区（拾取时反查） */
    const meshIndex = new Map();
    merged.parts.forEach(function (p) {
      p.members.forEach(function (m) {
        meshIndex.set(m.userData.meshId, {
          partKey: p.key, name: p.name, side: p.laterality, group: '体表部位'
        });
      });
    });

    return {
      group: regionScene,
      material: shellMat,
      meshes: meshes,
      parts: merged.parts,
      subEntries: merged.subEntries,
      atlas: merged.atlas,
      unmatched: merged.unmatched,
      meshIndex: meshIndex,
      nodeCount: regionNodes.length
    };
  }

  /* ============================================================
     buildFromGLTF —— Viewer 的模型来源
     @param gltfScene   脏器 / 骨骼层（models/organs-bones.glb）
     @param regionScene 部位层（models/body-regions.glb，可选）
     ============================================================ */
  function buildFromGLTF(gltfScene, regionScene) {
    const group = gltfScene;
    group.name = 'BodyRoot';

    const meshes = [];
    let deleted = 0;
    const removeList = [];
    group.traverse(function (o) {
      if (o.isMesh) meshes.push(o);
      if (!o.isMesh && !o.isGroup && o !== group && o.children.length === 0) removeList.push(o);
    });
    removeList.forEach(function (o) { o.parent && o.parent.remove(o); deleted++; });

    const mats = new Set();
    meshes.forEach(function (m) {
      (Array.isArray(m.material) ? m.material : [m.material]).forEach(function (mt) { if (mt) mats.add(mt); });
    });
    mats.forEach(function (mt) { mt.side = THREE.DoubleSide; });

    const built = buildStructureIndex(group, meshes);

    /* —— 部位层 —— */
    const regionLayer = regionScene ? attachRegionLayer(group, regionScene, built) : null;
    const parts = regionLayer ? regionLayer.parts : (built.abdomenParts || []);
    parts.forEach(function (p) { built.map.set(p.key, p); });
    if (regionLayer) regionLayer.subEntries.forEach(function (p) { built.map.set(p.key, p); });

    function resolveRegion(meshId) {
      const st = built.map.get(meshId);
      if (st) {
        return {
          regionKey: st.key,
          regionName: st.name,
          partName: st.partName,
          laterality: st.laterality,
          group: st.group
        };
      }
      const rg = regionLayer && regionLayer.meshIndex.get(meshId);
      if (rg) {
        return {
          regionKey: rg.partKey, regionName: rg.name, partName: '部位',
          laterality: rg.side, group: '体表部位'
        };
      }
      return { regionKey: 'unknown', regionName: '未识别结构', partName: '—', laterality: null, group: '其他' };
    }

    const categories = [];
    ['bone', 'viscera', 'brain', 'other'].forEach(function (t) {
      let n = 0;
      built.map.forEach(function (s) { if (s.type === t) n++; });
      if (n) categories.push({ key: t, label: TYPE_LABEL[t], count: n });
    });

    let structCount = 0;
    built.map.forEach(function (s) { if (s.type !== 'part' && s.type !== 'subpart') structCount++; });

    return {
      group: group,
      meshes: meshes,
      pickTargets: meshes,
      regionLayer: regionLayer,
      regionMeshes: regionLayer ? regionLayer.meshes : [],
      atlasRegions: regionLayer ? regionLayer.atlas : [],
      subEntries: regionLayer ? regionLayer.subEntries : [],
      regionUnmatched: regionLayer ? regionLayer.unmatched : [],
      regionNodeCount: regionLayer ? regionLayer.nodeCount : 0,
      resolveRegion: resolveRegion,
      structureIndex: built.map,
      ensureGeometry: built.ensureGeometry,
      REGION_ORDER: REGION_ORDER,
      structureCount: structCount,
      categories: categories,
      landmarks: built.landmarks,
      bodyParts: parts,
      bodyHeight: built.bodyHeight,
      removedHelpers: deleted
    };
  }

  SMK.body = {
    buildFromGLTF: buildFromGLTF,
    REGION_ORDER: REGION_ORDER,
    TYPE_LABEL: TYPE_LABEL,
    TYPE_ORDER: TYPE_ORDER,
    BODY_PARTS: BODY_PARTS
  };
})();
