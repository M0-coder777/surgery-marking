/* ============================================================
   regions.js — 全身体表分区（部位层）归并表  V0.5
   ------------------------------------------------------------
   数据来源：models/body-regions.glb —— 由 Startup.glb（Z-Anatomy
   中文图谱）提取的 `人体分区.g` 子树，共 250 个真实解剖分区，
   全部中文命名、天然区分左右（.l / .r），皮肤体表几何。

   本文件做两件事：
   1) 把图谱 250 个细分分区「归并」为 34 个临床可用的大区；
   2) 保留图谱原始层级，供界面下钻（如 上肢 → 臂区 → 肱二头肌内侧沟）。

   大区命名口径：
   · 腹部 9 个沿用**临床九分法**（右季肋区 / 腹上区 / 左季肋区 /
     右腰区 / 脐区 / 左腰区 / 右髂区 / 腹下区 / 左髂区），映射到
     图谱的 季肋区 / 腹上区 / 脐·脐区 / 腹外侧区 / 腹下区 / 腹股沟区。
     其中「腰区 ≈ 腹外侧区」「髂区 ≈ 腹股沟区」为近似对应。
   · 其余按图谱一级系统归并，上肢 4 段（肩 / 上臂 / 前臂 / 手）、
     下肢 5 段（髋 / 大腿 / 膝 / 小腿 / 足）。

   方位约定：+Y 上，+Z 患者腹侧，+X 患者左侧（面对患者视角）。
   大区 key 一律以 `part:` 前缀，与结构键区分。
   ============================================================ */
(function () {
  const SMK = (window.SMK = window.SMK || {});

  /* ------------------------------------------------------------
     34 个大区定义
     group 决定界面分组顺序；side 为 '' 表示不分侧（中轴区）
     ------------------------------------------------------------ */
  const MAJOR = [
    /* 头颈部（2） */
    { key: 'part:head', code: 'head', name: '头部', alias: '头颅 · 面部 · 耳廓', side: '', group: '头颈部' },
    { key: 'part:neck', code: 'neck', name: '颈部', alias: '颈前 · 颈后 · 颈外侧 · 锁上区', side: '', group: '头颈部' },

    /* 胸部（2） */
    { key: 'part:chest.R', code: 'chest.R', name: '右胸', alias: '右前胸壁', side: 'right', group: '胸部' },
    { key: 'part:chest.L', code: 'chest.L', name: '左胸', alias: '左前胸壁', side: 'left', group: '胸部' },

    /* 腹部 · 临床九分区（9） */
    { key: 'part:abd.RU', code: 'abd.RU', name: '右季肋区', alias: '右上腹', side: 'right', group: '腹部' },
    { key: 'part:abd.EP', code: 'abd.EP', name: '腹上区', alias: '上腹部 · 心窝部', side: '', group: '腹部' },
    { key: 'part:abd.LU', code: 'abd.LU', name: '左季肋区', alias: '左上腹', side: 'left', group: '腹部' },
    { key: 'part:abd.RL', code: 'abd.RL', name: '右腰区', alias: '右侧腹', side: 'right', group: '腹部' },
    { key: 'part:abd.UM', code: 'abd.UM', name: '脐区', alias: '脐周', side: '', group: '腹部' },
    { key: 'part:abd.LL', code: 'abd.LL', name: '左腰区', alias: '左侧腹', side: 'left', group: '腹部' },
    { key: 'part:abd.RI', code: 'abd.RI', name: '右髂区', alias: '右下腹', side: 'right', group: '腹部' },
    { key: 'part:abd.HY', code: 'abd.HY', name: '腹下区', alias: '下腹部', side: '', group: '腹部' },
    { key: 'part:abd.LI', code: 'abd.LI', name: '左髂区', alias: '左下腹', side: 'left', group: '腹部' },

    /* 背部（2） */
    { key: 'part:back.R', code: 'back.R', name: '右背', alias: '右背部 · 右肩胛区', side: 'right', group: '背部' },
    { key: 'part:back.L', code: 'back.L', name: '左背', alias: '左背部 · 左肩胛区', side: 'left', group: '背部' },

    /* 会阴部（1） */
    { key: 'part:perineum', code: 'perineum', name: '会阴部', alias: '肛门区 · 尿生殖区', side: '', group: '会阴部' },

    /* 上肢（8） */
    { key: 'part:arm.R.shoulder', code: 'arm.R.shoulder', name: '右肩', alias: '三角肌区', side: 'right', group: '上肢' },
    { key: 'part:arm.R.upper', code: 'arm.R.upper', name: '右上臂', alias: '臂前区 · 臂后区 · 肘', side: 'right', group: '上肢' },
    { key: 'part:arm.R.fore', code: 'arm.R.fore', name: '右前臂', alias: '前臂前区 · 前臂后区 · 腕', side: 'right', group: '上肢' },
    { key: 'part:arm.R.hand', code: 'arm.R.hand', name: '右手', alias: '手掌 · 手背 · 手指', side: 'right', group: '上肢' },
    { key: 'part:arm.L.shoulder', code: 'arm.L.shoulder', name: '左肩', alias: '三角肌区', side: 'left', group: '上肢' },
    { key: 'part:arm.L.upper', code: 'arm.L.upper', name: '左上臂', alias: '臂前区 · 臂后区 · 肘', side: 'left', group: '上肢' },
    { key: 'part:arm.L.fore', code: 'arm.L.fore', name: '左前臂', alias: '前臂前区 · 前臂后区 · 腕', side: 'left', group: '上肢' },
    { key: 'part:arm.L.hand', code: 'arm.L.hand', name: '左手', alias: '手掌 · 手背 · 手指', side: 'left', group: '上肢' },

    /* 下肢（10） */
    { key: 'part:leg.R.hip', code: 'leg.R.hip', name: '右髋', alias: '髋区 · 臀区', side: 'right', group: '下肢' },
    { key: 'part:leg.R.thigh', code: 'leg.R.thigh', name: '右大腿', alias: '股前区 · 股后区 · 股三角', side: 'right', group: '下肢' },
    { key: 'part:leg.R.knee', code: 'leg.R.knee', name: '右膝', alias: '膝前区 · 膝后区 · 腘窝', side: 'right', group: '下肢' },
    { key: 'part:leg.R.shin', code: 'leg.R.shin', name: '右小腿', alias: '小腿前区 · 小腿后区', side: 'right', group: '下肢' },
    { key: 'part:leg.R.foot', code: 'leg.R.foot', name: '右足', alias: '踝 · 足背 · 足底 · 足趾', side: 'right', group: '下肢' },
    { key: 'part:leg.L.hip', code: 'leg.L.hip', name: '左髋', alias: '髋区 · 臀区', side: 'left', group: '下肢' },
    { key: 'part:leg.L.thigh', code: 'leg.L.thigh', name: '左大腿', alias: '股前区 · 股后区 · 股三角', side: 'left', group: '下肢' },
    { key: 'part:leg.L.knee', code: 'leg.L.knee', name: '左膝', alias: '膝前区 · 膝后区 · 腘窝', side: 'left', group: '下肢' },
    { key: 'part:leg.L.shin', code: 'leg.L.shin', name: '左小腿', alias: '小腿前区 · 小腿后区', side: 'left', group: '下肢' },
    { key: 'part:leg.L.foot', code: 'leg.L.foot', name: '左足', alias: '踝 · 足背 · 足底 · 足趾', side: 'left', group: '下肢' }
  ];

  const GROUP_ORDER = ['头颈部', '胸部', '腹部', '背部', '会阴部', '上肢', '下肢'];

  /* ------------------------------------------------------------
     归并规则（有序，首个命中生效）
     · sys      图谱一级系统名（人体分区.g 的直接子节点）
     · cn       图谱分区名（精确匹配，可给数组）
     · side     'left' | 'right'，省略表示不限
     · under    祖先分组名（任一命中即可），用于按子系统整段归并
     · exclude  排除的分区名
     ------------------------------------------------------------ */
  const RULES = [
    /* 头颈 */
    { key: 'part:head', sys: '头部分区' },
    { key: 'part:neck', sys: '颈部分区' },

    /* 胸 */
    { key: 'part:chest.R', sys: '胸部分区', side: 'right' },
    { key: 'part:chest.L', sys: '胸部分区', side: 'left' },

    /* 腹 · 临床九分区 */
    { key: 'part:abd.RU', sys: '腹部分区', cn: '季肋区', side: 'right' },
    { key: 'part:abd.LU', sys: '腹部分区', cn: '季肋区', side: 'left' },
    { key: 'part:abd.EP', sys: '腹部分区', cn: '腹上区' },
    { key: 'part:abd.UM', sys: '腹部分区', cn: ['脐', '脐区'] },
    { key: 'part:abd.HY', sys: '腹部分区', cn: '腹下区' },
    { key: 'part:abd.RL', sys: '腹部分区', cn: '腹外侧区', side: 'right' },
    { key: 'part:abd.LL', sys: '腹部分区', cn: '腹外侧区', side: 'left' },
    { key: 'part:abd.RI', sys: '腹部分区', cn: '腹股沟区', side: 'right' },
    { key: 'part:abd.LI', sys: '腹部分区', cn: '腹股沟区', side: 'left' },

    /* 背 */
    { key: 'part:back.R', sys: '背部分区', side: 'right' },
    { key: 'part:back.L', sys: '背部分区', side: 'left' },

    /* 会阴 */
    { key: 'part:perineum', sys: '会阴部分区' },

    /* 上肢 · 右 */
    { key: 'part:arm.R.shoulder', sys: '上肢分区', side: 'right', cn: '三角肌区' },
    { key: 'part:arm.R.upper', sys: '上肢分区', side: 'right', under: ['臂区', '肘区'] },
    { key: 'part:arm.R.fore', sys: '上肢分区', side: 'right', under: ['前臂区', '腕区'] },
    { key: 'part:arm.R.hand', sys: '上肢分区', side: 'right', under: ['手部分区'] },
    /* 上肢 · 左 */
    { key: 'part:arm.L.shoulder', sys: '上肢分区', side: 'left', cn: '三角肌区' },
    { key: 'part:arm.L.upper', sys: '上肢分区', side: 'left', under: ['臂区', '肘区'] },
    { key: 'part:arm.L.fore', sys: '上肢分区', side: 'left', under: ['前臂区', '腕区'] },
    { key: 'part:arm.L.hand', sys: '上肢分区', side: 'left', under: ['手部分区'] },

    /* 下肢 · 右 */
    { key: 'part:leg.R.hip', sys: '下肢分区', side: 'right', cn: '髋区' },
    { key: 'part:leg.R.hip', sys: '下肢分区', side: 'right', under: ['臀区'] },
    { key: 'part:leg.R.thigh', sys: '下肢分区', side: 'right', under: ['股区'] },
    { key: 'part:leg.R.knee', sys: '下肢分区', side: 'right', under: ['膝区'] },
    { key: 'part:leg.R.shin', sys: '下肢分区', side: 'right', under: ['小腿区'] },
    { key: 'part:leg.R.foot', sys: '下肢分区', side: 'right', under: ['踝区', '足部分区'] },
    /* 下肢 · 左 */
    { key: 'part:leg.L.hip', sys: '下肢分区', side: 'left', cn: '髋区' },
    { key: 'part:leg.L.hip', sys: '下肢分区', side: 'left', under: ['臀区'] },
    { key: 'part:leg.L.thigh', sys: '下肢分区', side: 'left', under: ['股区'] },
    { key: 'part:leg.L.knee', sys: '下肢分区', side: 'left', under: ['膝区'] },
    { key: 'part:leg.L.shin', sys: '下肢分区', side: 'left', under: ['小腿区'] },
    { key: 'part:leg.L.foot', sys: '下肢分区', side: 'left', under: ['踝区', '足部分区'] }
  ];

  const byKey = {};
  MAJOR.forEach(function (m) { byKey[m.key] = m; });

  function has(list, v) {
    if (list == null) return true;                      // 未指定 = 不限
    return (Object.prototype.toString.call(list) === '[object Array]' ? list : [list]).indexOf(v) >= 0;
  }

  /** 由图谱分区元数据求所属大区 key；无匹配返回 null（会被统计上报） */
  function majorOf(meta) {
    for (let i = 0; i < RULES.length; i++) {
      const r = RULES[i];
      if (!has(r.sys, meta.sys)) continue;
      if (!has(r.side, meta.side || '')) continue;
      if (r.cn !== undefined && !has(r.cn, meta.cn)) continue;
      if (r.exclude !== undefined && has(r.exclude, meta.cn)) continue;
      if (r.under !== undefined) {
        const anc = meta.ancestors || [];
        let ok = false;
        for (let j = 0; j < anc.length && !ok; j++) if (has(r.under, anc[j])) ok = true;
        if (!ok) continue;
      }
      return r.key;
    }
    return null;
  }

  /* ------------------------------------------------------------
     由「图谱分区网格」构建大区条目
     @param regionNodes  [{ mesh, cn, side, sys, ancestors, path }]
     @param organMap    脏器结构索引（用于腹部大区补充「区内结构」信息）
     @param landmarks   骨性标志点（用于腹部区内的脏器归属判定）
     @param bodyHeight  身高
     ------------------------------------------------------------ */
  function buildParts(regionNodes, organMap) {
    const buckets = {};      // majorKey -> [regionNode]
    const atlas = [];        // 图谱细分分区条目
    const unmatched = [];
    const meshToMajor = new Map();

    regionNodes.forEach(function (rn) {
      const key = majorOf(rn);
      if (!key || !byKey[key]) { unmatched.push(rn.sys + ' · ' + rn.cn); return; }
      (buckets[key] = buckets[key] || []).push(rn);
      rn.meshes.forEach(function (m) { meshToMajor.set(m, key); });
      atlas.push({
        key: 'rg:' + rn.sys + '/' + rn.cn + (rn.side ? '.' + rn.side.charAt(0) : ''),
        name: rn.cn,
        full: rn.path ? rn.path + ' › ' + rn.cn : rn.cn,
        path: rn.path || '',
        side: rn.side || '',
        sys: rn.sys,
        majorKey: key,
        meshes: rn.meshes,
        node: rn
      });
    });

    const parts = [];
    MAJOR.forEach(function (def) {
      const list = buckets[def.key];
      if (!list || !list.length) return;                 // 空大区不产出
      const bb = { min: new THREE.Vector3(1e9, 1e9, 1e9), max: new THREE.Vector3(-1e9, -1e9, -1e9) };
      let tri = 0;
      const meshes = [];
      const subNames = [];
      list.forEach(function (rn) {
        subNames.push(rn.cn);
        rn.meshes.forEach(function (m) {
          m.userData.majorKey = def.key;
          meshes.push(m);
          tri += m.geometry.index
            ? Math.floor(m.geometry.index.count / 3)
            : Math.floor(m.geometry.attributes.position.count / 3);
        });
        if (rn.bbox) { bb.min.min(rn.bbox.min); bb.max.max(rn.bbox.max); }
      });
      const centroid = bb.min.clone().add(bb.max).multiplyScalar(0.5);
      const radius = bb.max.clone().sub(bb.min).length() * 0.5;
      const n = new THREE.Vector3(centroid.x, 0, centroid.z);
      if (n.lengthSq() < 1e-6) n.set(0, 0, 1);
      parts.push({
        key: def.key, code: def.code, name: def.name, alias: def.alias,
        baseName: def.name, partName: '部位', type: 'part',
        group: '体表部位', subgroup: def.group,
        laterality: def.side || null,
        centroid: centroid, normal: n.normalize(), radius: Math.max(0.05, radius),
        bbox: bb, triCount: tri,
        members: meshes,          // 体表分区几何（高亮据此合并）
        organMembers: [],         // 腹部：区内脏器（信息展示）
        subNames: subNames,       // 图谱细分名（供搜索）
        subCount: list.length,
        atlasKeys: list.map(function (rn) { return 'rg:' + rn.sys + '/' + rn.cn + (rn.side ? '.' + rn.side.charAt(0) : ''); }),
        mesh: null, geometry: null
      });
    });

    /* 图谱细分分区：与部位同构的条目，可单独选中 / 标记 / 高亮（下钻用） */
    const subEntries = atlas.map(function (a) {
      const rn = a.node;
      const bb = rn.bbox || { min: new THREE.Vector3(), max: new THREE.Vector3() };
      const centroid = bb.min.clone().add(bb.max).multiplyScalar(0.5);
      const n = new THREE.Vector3(centroid.x, 0, centroid.z);
      if (n.lengthSq() < 1e-6) n.set(0, 0, 1);
      let tri = 0;
      a.meshes.forEach(function (m) {
        tri += m.geometry.index
          ? Math.floor(m.geometry.index.count / 3)
          : Math.floor(m.geometry.attributes.position.count / 3);
      });
      return {
        key: a.key, code: a.key, name: a.name, alias: a.path, baseName: a.name,
        partName: '图谱分区', type: 'subpart', group: '图谱分区', subgroup: a.sys,
        parentKey: a.majorKey, laterality: a.side || null,
        centroid: centroid, normal: n.normalize(),
        radius: Math.max(0.03, bb.max.clone().sub(bb.min).length() * 0.5),
        bbox: bb, triCount: tri, members: a.meshes,
        organMembers: [], subNames: [a.name], subCount: 1,
        mesh: null, geometry: null
      };
    });

    return {
      parts: parts, atlas: atlas, subEntries: subEntries,
      unmatched: unmatched, meshToMajor: meshToMajor
    };
  }

  SMK.regions = {
    MAJOR: MAJOR,
    GROUP_ORDER: GROUP_ORDER,
    RULES: RULES,
    majorOf: majorOf,
    byKey: byKey,
    buildParts: buildParts
  };
})();
