/* ============================================================
   anchors.js — 标记锚定与几何构建（本系统最关键的部分）
   ------------------------------------------------------------
   为什么不能存屏幕坐标 / 世界坐标：
     屏幕坐标会随视角变化整体失效；世界坐标在模型被平移、旋转、
     缩放或替换后同样失效。唯一稳定的是「模型几何体自身」上的位置。

   本实现的锚定结构（单一权威表示）：
     { meshId, faceIndex, bary: [u, v, w] }
     —— meshId 定位到哪个部件，faceIndex 定位到哪个三角面，
     —— bary 是三角面内的重心坐标，三者共同锁定曲面上的一个点。
   渲染时始终由锚定结构反算世界位置，因此任何视角操作都不会漂移。
   ============================================================ */
(function () {
  const SMK = (window.SMK = window.SMK || {});
  const A = {};

  const _ray = new THREE.Raycaster();
  const _nm = new THREE.Matrix3();
  const _v0 = new THREE.Vector3();
  const _v1 = new THREE.Vector3();
  const _v2 = new THREE.Vector3();
  const _n0 = new THREE.Vector3();
  const _n1 = new THREE.Vector3();
  const _n2 = new THREE.Vector3();
  const _tmp = new THREE.Vector3();

  /* ---------- 1. 射线拾取 → 锚定结构 ---------- */

  function barycentric(p, a, b, c, out) {
    const v0 = _v0.subVectors(b, a);
    const v1 = _v1.subVectors(c, a);
    const v2 = _tmp.subVectors(p, a);
    const d00 = v0.dot(v0);
    const d01 = v0.dot(v1);
    const d11 = v1.dot(v1);
    const d20 = v2.dot(v0);
    const d21 = v2.dot(v1);
    const denom = d00 * d11 - d01 * d01;
    if (Math.abs(denom) < 1e-12) { out[0] = 1; out[1] = 0; out[2] = 0; return out; }
    const v = (d11 * d20 - d01 * d21) / denom;
    const w = (d00 * d21 - d01 * d20) / denom;
    out[0] = 1 - v - w;
    out[1] = v;
    out[2] = w;
    return out;
  }

  /**
   * 对模型做射线拾取，返回可直接持久化的锚点。
   * @param {THREE.Raycaster} raycaster
   * @param {THREE.Object3D[]} targets 参与拾取的 mesh 列表
   * @param {Function} resolveRegion 分区解析函数
   */
  A.pick = function (raycaster, targets, resolveRegion) {
    const hits = raycaster.intersectObjects(targets, false);
    if (!hits.length) return null;
    const hit = hits[0];
    const mesh = hit.object;
    const geo = mesh.geometry;
    const pos = geo.attributes.position;
    const nor = geo.attributes.normal;
    if (!hit.face) return null;

    const vi = [hit.face.a, hit.face.b, hit.face.c];
    const pLocal = mesh.worldToLocal(hit.point.clone());
    const a = _v0.clone().fromBufferAttribute(pos, vi[0]);
    const b = _v1.clone().fromBufferAttribute(pos, vi[1]);
    const c = _v2.clone().fromBufferAttribute(pos, vi[2]);
    const bary = barycentric(pLocal, a, b, c, [0, 0, 0]);

    // 顶点法线按重心权重插值 → 得到平滑法线（用于标记外偏移，避免 z-fighting）
    const nLocal = new THREE.Vector3();
    if (nor) {
      const na = _n0.fromBufferAttribute(nor, vi[0]);
      const nb = _n1.fromBufferAttribute(nor, vi[1]);
      const nc = _n2.fromBufferAttribute(nor, vi[2]);
      nLocal.set(
        na.x * bary[0] + nb.x * bary[1] + nc.x * bary[2],
        na.y * bary[0] + nb.y * bary[1] + nc.y * bary[2],
        na.z * bary[0] + nb.z * bary[1] + nc.z * bary[2]
      ).normalize();
    } else {
      nLocal.copy(hit.face.normal);
    }

    const region = resolveRegion(mesh.userData.meshId, pLocal, nLocal);

    return {
      anchor: {
        meshId: mesh.userData.meshId,
        faceIndex: hit.faceIndex,
        bary: [Number(bary[0].toFixed(6)), Number(bary[1].toFixed(6)), Number(bary[2].toFixed(6))]
      },
      worldPoint: hit.point.clone(),
      localNormal: nLocal.clone(),
      regionKey: region.regionKey,
      regionName: region.regionName,
      partName: region.partName,
      laterality: region.laterality,
      group: region.group,
      distance: hit.distance
    };
  };

  /* ---------- 2. 锚定结构 → 世界坐标（渲染时反算） ---------- */

  A.meshOf = function (anchor, root) {
    return root.getObjectByName(anchor.meshId) || null;
  };

  /** 取分区索引（挂在 bodyRoot.userData 上，由 Viewer 初始化时写入） */
  A.regionIndex = function (root) {
    return (root && root.userData && root.userData.regionIndex) || null;
  };

  A.regionOf = function (root, key) {
    const idx = A.regionIndex(root);
    return idx ? (idx.get(key) || null) : null;
  };

  /**
   * 由锚定结构反算当前世界位置与法线。
   * 只要模型几何未被重新拓扑（顶点顺序不变），位置永远贴合原处。
   *
   * 支持两种锚定形式：
   *   ① 点锚定 { meshId, faceIndex, bary } —— 锁定体表上的一个点；
   *   ② 部位锚定 { regionKey }             —— 锁定一个完整解剖部位，
   *      位置取该部位面片的质心，存储上只是一个标识符，天然不漂移。
   */
  A.resolve = function (anchor, root) {
    if (anchor && anchor.regionKey) {
      const r = A.regionOf(root, anchor.regionKey);
      if (!r) return null;
      const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert();
      return {
        world: r.centroid.clone().applyMatrix4(root.matrixWorld),
        worldNormal: r.normal.clone().transformDirection(root.matrixWorld).normalize(),
        position: r.centroid.clone(),
        normal: r.normal.clone(),
        mesh: null,
        region: r
      };
    }

    const mesh = A.meshOf(anchor, root);
    if (!mesh) return null;
    const pos = mesh.geometry.attributes.position;
    const nor = mesh.geometry.attributes.normal;
    const vi = faceVertices(mesh, anchor.faceIndex); // 三角面顶点索引由 faceIndex 反推
    if (!vi) return null;

    const u = anchor.bary[0], v = anchor.bary[1], w = anchor.bary[2];
    const pa = new THREE.Vector3().fromBufferAttribute(pos, vi[0]);
    const pb = new THREE.Vector3().fromBufferAttribute(pos, vi[1]);
    const pc = new THREE.Vector3().fromBufferAttribute(pos, vi[2]);
    const local = new THREE.Vector3(
      pa.x * u + pb.x * v + pc.x * w,
      pa.y * u + pb.y * v + pc.y * w,
      pa.z * u + pb.z * v + pc.z * w
    );

    const nLocal = new THREE.Vector3();
    if (nor) {
      const na = new THREE.Vector3().fromBufferAttribute(nor, vi[0]);
      const nb = new THREE.Vector3().fromBufferAttribute(nor, vi[1]);
      const nc = new THREE.Vector3().fromBufferAttribute(nor, vi[2]);
      nLocal.set(
        na.x * u + nb.x * v + nc.x * w,
        na.y * u + nb.y * v + nc.y * w,
        na.z * u + nb.z * v + nc.z * w
      ).normalize();
    }

    const world = local.clone();
    mesh.localToWorld(world);

    _nm.getNormalMatrix(mesh.matrixWorld);
    const worldNormal = nLocal.clone().applyMatrix3(_nm).normalize();

    const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert();
    return {
      world: world,
      worldNormal: worldNormal,
      position: world.clone().applyMatrix4(rootInv),          // root 局部坐标（用于挂在 root 下）
      normal: worldNormal.clone().transformDirection(rootInv), // root 局部方向
      mesh: mesh
    };
  };

  /** faceIndex → 三角面三个顶点索引（兼容 BufferGeometry 的 index） */
  function faceVertices(mesh, faceIndex) {
    const geo = mesh.geometry;
    if (!Number.isInteger(faceIndex) || faceIndex < 0) return null;
    if (geo.index) {
      const i = faceIndex * 3;
      if (i + 2 >= geo.index.count) return null;
      return [geo.index.getX(i), geo.index.getX(i + 1), geo.index.getX(i + 2)];
    }
    const i = faceIndex * 3;
    if (i + 2 >= geo.attributes.position.count) return null;
    return [i, i + 1, i + 2];
  }

  /* ---------- 3. 区域贴合面片 ---------- */

  /** 把任意点投影回模型表面（用于让区域面片贴合曲面，而不是张成平面） */
  function projectToBody(point, normal, bodyRoot) {
    const origin = point.clone().addScaledVector(normal, 0.30);
    _ray.set(origin, normal.clone().negate());
    _ray.near = 1e-4;
    _ray.far = 1.2;
    const hits = _ray.intersectObject(bodyRoot, true);
    if (hits.length) {
      const h = hits[0];
      let n = normal.clone();
      if (h.face) {
        _nm.getNormalMatrix(h.object.matrixWorld);
        n = h.face.normal.clone().applyMatrix3(_nm).normalize();
        if (n.dot(normal) < 0) n.negate();
      }
      return { p: h.point.clone().addScaledVector(n, 0.0035), n: n };
    }
    return { p: point.clone().addScaledVector(normal, 0.0035), n: normal.clone() };
  }

  function subdivide(verts, tris, levels, project) {
    for (let L = 0; L < levels; L++) {
      const cache = new Map();
      const out = [];
      const mid = function (i, j) {
        const key = i < j ? i + '|' + j : j + '|' + i;
        if (cache.has(key)) return cache.get(key);
        const a = verts[i], b = verts[j];
        const p = a.p.clone().add(b.p).multiplyScalar(0.5);
        const n = a.n.clone().add(b.n).multiplyScalar(0.5).normalize();
        const pr = project(p, n);
        verts.push(pr);
        const idx = verts.length - 1;
        cache.set(key, idx);
        return idx;
      };
      tris.forEach(function (t) {
        const ij = mid(t[0], t[1]);
        const jk = mid(t[1], t[2]);
        const ki = mid(t[2], t[0]);
        out.push([t[0], ij, ki], [ij, t[1], jk], [ki, jk, t[2]], [ij, jk, ki]);
      });
      tris = out;
    }
    return { verts: verts, tris: tris };
  }

  /**
   * 由若干锚点构建贴合体表的多边形面片（已减去中心点，避免内凹）
   * @returns {BufferGeometry|null}
   */
  A.buildRegionGeometry = function (anchors, root, bodyRoot) {
    // 部位锚定：直接复用分区索引中预建的共享几何（整块解剖部位 / 体表部位）
    if (anchors.length && anchors[0].regionKey) {
      const r = A.regionOf(root, anchors[0].regionKey);
      if (!r) return null;
      if (!r.geometry && root.userData.ensureGeometry) {
        r.geometry = root.userData.ensureGeometry(r);
      }
      return r.geometry || null;
    }

    const resolved = [];
    anchors.forEach(function (an) {
      const r = A.resolve(an, root);
      if (r) resolved.push({ p: r.world.clone(), n: r.worldNormal.clone() });
    });
    if (resolved.length < 3) return null;

    // 中心点：先取平均，再投影回体表
    const c = new THREE.Vector3();
    const cn = new THREE.Vector3();
    resolved.forEach(function (r) { c.add(r.p); cn.add(r.n); });
    c.multiplyScalar(1 / resolved.length);
    cn.normalize();
    const cpr = projectToBody(c, cn, bodyRoot);

    const verts = [cpr];
    const boundary = [];
    resolved.forEach(function (r) {
      const pr = projectToBody(r.p, r.n, bodyRoot);
      boundary.push(pr);
      verts.push(pr);
    });

    const tris = [];
    const n = boundary.length;
    for (let i = 0; i < n; i++) {
      tris.push([0, 1 + i, 1 + ((i + 1) % n)]);
    }

    const sub = subdivide(verts, tris, 2, function (p, nrm) { return projectToBody(p, nrm, bodyRoot); });

    const rootInv = new THREE.Matrix4().copy(root.matrixWorld).invert();
    const arr = new Float32Array(sub.verts.length * 3);
    sub.verts.forEach(function (v, i) {
      const lp = v.p.clone().applyMatrix4(rootInv);
      arr[i * 3] = lp.x; arr[i * 3 + 1] = lp.y; arr[i * 3 + 2] = lp.z;
    });
    const idx = [];
    sub.tris.forEach(function (t) { idx.push(t[0], t[1], t[2]); });

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    geo.userData.boundaryCount = boundary.length;
    geo.userData.starCount = 1;
    return geo;
  };

  /** 部位边界轮廓（LineSegments 几何，共享；返回 null 表示该部位内部无边界边） */
  A.buildPartOutline = function (regionKey, root) {
    const r = A.regionOf(root, regionKey);
    return r ? (r.outlineGeo || null) : null;
  };

  /** 区域边界线（root 局部坐标） */
  A.buildRegionOutline = function (anchors, root) {
    const pts = [];
    anchors.forEach(function (an) {
      const r = A.resolve(an, root);
      if (r) pts.push(r.position.clone().addScaledVector(r.normal, 0.006));
    });
    if (pts.length < 2) return null;
    pts.push(pts[0].clone());
    return pts;
  };

  SMK.anchors = A;
})();
