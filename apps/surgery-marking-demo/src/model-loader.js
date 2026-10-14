/* ============================================================
   model-loader.js — 解剖模型（GLB）加载
   ------------------------------------------------------------
   · Draco 压缩解码器已本地化（vendor/draco），无 CDN 依赖；
   · http(s) 下自动 fetch 加载；
   · file:// 直开时浏览器禁止 fetch，降级为「选择 / 拖入模型文件」，
     用 FileReader 读入后走 GLTFLoader.parse，功能完全一致。
   ============================================================ */
(function () {
  const SMK = (window.SMK = window.SMK || {});

  let _gltf = null;
  let _draco = null;

  function ensureLoaders() {
    if (_gltf) return;
    if (!THREE.GLTFLoader || !THREE.DRACOLoader) {
      throw new Error('加载器未就绪（vendor/three/anatomy-loaders.js）');
    }
    _draco = new THREE.DRACOLoader();
    _draco.setDecoderPath('vendor/draco/');
    _draco.setDecoderConfig({ type: 'wasm' });
    _gltf = new THREE.GLTFLoader();
    _gltf.setDRACOLoader(_draco);
  }

  function isFileProtocol() {
    return window.location.protocol === 'file:';
  }

  /** 从 URL 加载（http/https） */
  function loadFromURL(url, onProgress) {
    ensureLoaders();
    return new Promise(function (resolve, reject) {
      _gltf.load(url, function (gltf) { resolve(gltf); }, function (xhr) {
        if (onProgress && xhr.total) {
          onProgress(xhr.loaded, xhr.total);
        }
      }, function (err) {
        reject(normalizeError(err));
      });
    });
  }

  /** 从 ArrayBuffer 解析（file:// 降级路径） */
  function parseBuffer(buffer) {
    ensureLoaders();
    return new Promise(function (resolve, reject) {
      try {
        _gltf.parse(buffer, '', function (gltf) { resolve(gltf); }, function (err) {
          reject(normalizeError(err));
        });
      } catch (e) {
        reject(e);
      }
    });
  }

  function normalizeError(err) {
    const msg = (err && (err.message || err.statusText)) || String(err || '未知错误');
    return new Error(msg);
  }

  /**
   * 总入口：优先 fetch；file:// 下直接要求用户选择文件。
   * @returns Promise<{scene, source}>  source: 'url' | 'file'
   */
  function load(opts) {
    const o = opts || {};
    if (isFileProtocol()) {
      const e = new Error('FILE_PROTOCOL');
      e.code = 'FILE_PROTOCOL';
      throw e;
    }
    return loadFromURL(o.url || 'models/body.glb', o.onProgress).then(function (gltf) {
      return { scene: gltf.scene, source: 'url' };
    });
  }

  SMK.modelLoader = {
    load: load,
    parseBuffer: parseBuffer,
    isFileProtocol: isFileProtocol
  };
})();
