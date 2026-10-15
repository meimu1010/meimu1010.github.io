import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import * as ThreeVRM from '@pixiv/three-vrm';

const status = document.getElementById('status');
const fileInput = document.getElementById('file');
const physicsCheckbox = document.getElementById('physics');
const autoRotateCheckbox = document.getElementById('autoRotate');

const renderer = new THREE.WebGLRenderer({
  antialias: false,
  alpha: false,
  stencil: false,
  powerPreference: 'high-performance'
});

renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
scene.background = new THREE.Color(0xf0f0f0);

const camera = new THREE.PerspectiveCamera(
  45,
  window.innerWidth / window.innerHeight,
  0.01,
  1000
);

camera.position.set(0, 1.4, 2.5);

const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1, 0);
controls.enableDamping = true;
controls.dampingFactor = 0.08;

controls.mouseButtons = {
  LEFT: null,
  MIDDLE: THREE.MOUSE.DOLLY,
  RIGHT: THREE.MOUSE.ROTATE
};

controls.autoRotateSpeed = 1.2;
controls.update();

scene.add(new THREE.HemisphereLight(0xffffff, 0x555566, 1.1));

const dirLight = new THREE.DirectionalLight(0xffffff, 1.0);
dirLight.position.set(1, 2, 1);
scene.add(dirLight);

scene.add(new THREE.GridHelper(10, 20, 0x777777, 0x3a3f46));

const loader = new GLTFLoader();

if (ThreeVRM.VRMLoaderPlugin) {
  loader.register((parser) => new ThreeVRM.VRMLoaderPlugin(parser));
} else {
  setStatus('VRMLoaderPlugin が見つかりません。');
}

let mmdLoaderPromise = null;

function getMMDLoader() {
  if (!mmdLoaderPromise) {
    mmdLoaderPromise = import('three/examples/jsm/loaders/MMDLoader.js')
      .then((mod) => new mod.MMDLoader())
      .catch((err) => {
        console.warn('MMDLoader を読み込めませんでした', err);
        return null;
      });
  }
  return mmdLoaderPromise;
}

let currentVrm = null;
let currentRoot = null;
let skinnedMeshes = [];
const initialBoneQuats = new Map();

let physicsEnabled = true;
let isPointerDown = false;
let isGrabbing = false;
let longPressTimer = 0;
let pendingHit = null;
let grabbed = null;

let lastPointerX = 0;
let lastPointerY = 0;
let pointerDownX = 0;
let pointerDownY = 0;

const raycaster = new THREE.Raycaster();
const pointerNdc = new THREE.Vector2();

const LONG_PRESS_MS = 250;
const CANCEL_MOVE_PX = 6;
const DRAG_SPEED = 0.006;

const xAxis = new THREE.Vector3(1, 0, 0);
const yAxis = new THREE.Vector3(0, 1, 0);
const tmpQuat = new THREE.Quaternion();

fileInput.addEventListener('change', () => {
  const file = fileInput.files && fileInput.files[0];
  if (!file) return;

  loadModelFile(file);
  fileInput.value = '';
});

physicsCheckbox.addEventListener('change', () => {
  physicsEnabled = physicsCheckbox.checked;
  setStatus(
    physicsEnabled
      ? '物理演算: オン'
      : '物理演算: オフ'
  );
});

autoRotateCheckbox.addEventListener('change', () => {
  controls.autoRotate = autoRotateCheckbox.checked;
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'r' || event.key === 'R') {
    resetPose();
    setStatus('ポーズをリセットしました');
  }
});

renderer.domElement.addEventListener('contextmenu', (event) => {
  event.preventDefault();
});

renderer.domElement.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;

  lastPointerX = event.clientX;
  lastPointerY = event.clientY;
  pointerDownX = event.clientX;
  pointerDownY = event.clientY;

  setPointerNdc(event);
  const hit = raycastSkinnedMesh();

  if (!hit || !hit.face) return;

  isPointerDown = true;
  pendingHit = hit;

  clearTimeout(longPressTimer);

  longPressTimer = setTimeout(() => {
    if (!isPointerDown || !pendingHit) return;
    startGrab(pendingHit);
  }, LONG_PRESS_MS);
});

renderer.domElement.addEventListener('pointermove', (event) => {
  lastPointerX = event.clientX;
  lastPointerY = event.clientY;

  if (isGrabbing && grabbed) {
    const dx = event.clientX - grabbed.lastX;
    const dy = event.clientY - grabbed.lastY;

    grabbed.lastX = event.clientX;
    grabbed.lastY = event.clientY;

    rotateBone(grabbed.bone, dx, dy);
    return;
  }

  if (isPointerDown && !isGrabbing) {
    const dx = event.clientX - pointerDownX;
    const dy = event.clientY - pointerDownY;

    if (Math.hypot(dx, dy) > CANCEL_MOVE_PX) {
      clearTimeout(longPressTimer);
      isPointerDown = false;
      pendingHit = null;
    }
  }
});

window.addEventListener('pointerup', endPointer);
window.addEventListener('pointercancel', endPointer);

function endPointer() {
  clearTimeout(longPressTimer);

  if (isGrabbing) {
    isGrabbing = false;
    grabbed = null;
    controls.enabled = true;
    setStatus('掴みを解除しました');
  }

  isPointerDown = false;
  pendingHit = null;
}

function loadModelFile(file) {
  const url = URL.createObjectURL(file);
  const ext = file.name.split('.').pop().toLowerCase();

  setStatus(`読み込み中: ${file.name}`);

  if (ext === 'vrm' || ext === 'glb' || ext === 'gltf') {
    loader.load(
      url,
      (gltf) => {
        URL.revokeObjectURL(url);
        setVRM(gltf, file.name);
      },
      undefined,
      (error) => {
        URL.revokeObjectURL(url);
        console.error(error);
        setStatus(`読み込み失敗: ${error && error.message ? error.message : error}`);
      }
    );
  } else if (ext === 'pmx') {
    getMMDLoader().then((mmdLoader) => {
      if (!mmdLoader) {
        URL.revokeObjectURL(url);
        setStatus('PMX 非対応: この three バージョンに MMDLoader がありません');
        return;
      }

      // 【修正】loadPMX は生データしか返さないため、
      // THREE.SkinnedMesh を生成する load() を使用します
      mmdLoader.load(
        url,
        (mesh) => {
          URL.revokeObjectURL(url);
          setPMX(mesh, file.name);
        },
        undefined,
        (error) => {
          URL.revokeObjectURL(url);
          console.error(error);
          setStatus(`読み込み失敗: ${error && error.message ? error.message : error}`);
        }
      );
    });
  } else {
    URL.revokeObjectURL(url);
    setStatus(`未対応の形式: ${ext}`);
  }
}

function setVRM(gltf, fileName) {
  clearCurrentModel();

  currentVrm =
    (gltf.userData && gltf.userData.vrm) ||
    gltf.vrm ||
    null;

  currentRoot = currentVrm ? currentVrm.scene : gltf.scene;

  if (!currentRoot) {
    setStatus('シーンが見つかりませんでした');
    return;
  }

  scene.add(currentRoot);

  try {
    if (currentVrm && ThreeVRM.VRMUtils && ThreeVRM.VRMUtils.rotateVRM0) {
      ThreeVRM.VRMUtils.rotateVRM0(currentVrm);
    }
  } catch (error) {
    console.warn('VRMUtils.rotateVRM0 をスキップしました', error);
  }

  collectSkinnedMeshes();
  cacheInitialPose();
  fitCameraToObject(currentRoot);

  setStatus(
    `読み込み完了: ${fileName}\n形式: VRM/GLB`
  );
}

function setPMX(mesh, fileName) {
  clearCurrentModel();

  currentVrm = null;
  currentRoot = mesh; // mesh は THREE.SkinnedMesh (Object3Dを継承)

  scene.add(currentRoot);

  collectSkinnedMeshes();
  cacheInitialPose();
  fitCameraToObject(currentRoot);

  setStatus(
    `読み込み完了: ${fileName}\n形式: PMX`
  );
}

function clearCurrentModel() {
  if (currentRoot) {
    scene.remove(currentRoot);
    disposeObject(currentRoot);
  }

  currentVrm = null;
  currentRoot = null;
  skinnedMeshes = [];
  initialBoneQuats.clear();

  endPointer();
}

function disposeObject(root) {
  root.traverse((obj) => {
    if (obj.geometry) {
      obj.geometry.dispose();
    }

    const materials = Array.isArray(obj.material)
      ? obj.material
      : obj.material
        ? [obj.material]
        : [];

    for (const material of materials) {
      if (!material) continue;

      for (const key of Object.keys(material)) {
        const value = material[key];
        if (value && value.isTexture) {
          value.dispose();
        }
      }

      material.dispose();
    }
  });
}

function collectSkinnedMeshes() {
  skinnedMeshes = [];

  currentRoot.traverse((obj) => {
    if (obj.isSkinnedMesh) {
      obj.frustumCulled = false;
      skinnedMeshes.push(obj);
    }
  });
}

function cacheInitialPose() {
  initialBoneQuats.clear();

  const seen = new Set();

  for (const mesh of skinnedMeshes) {
    if (!mesh.skeleton) continue;

    for (const bone of mesh.skeleton.bones) {
      if (!seen.has(bone.uuid)) {
        seen.add(bone.uuid);
        initialBoneQuats.set(bone.uuid, bone.quaternion.clone());
      }
    }
  }
}

function resetPose() {
  for (const mesh of skinnedMeshes) {
    if (!mesh.skeleton) continue;

    for (const bone of mesh.skeleton.bones) {
      const q = initialBoneQuats.get(bone.uuid);
      if (q) bone.quaternion.copy(q);
    }
  }
}

function fitCameraToObject(object) {
  const box = new THREE.Box3().setFromObject(object);

  if (
    !Number.isFinite(box.min.x) ||
    !Number.isFinite(box.min.y) ||
    !Number.isFinite(box.min.z)
  ) {
    return;
  }

  const size = box.getSize(new THREE.Vector3()).length();
  const center = box.getCenter(new THREE.Vector3());

  if (!Number.isFinite(size) || size === 0) return;

  controls.target.copy(center);

  camera.position.set(
    center.x,
    center.y + size * 0.15,
    center.z + size * 0.85
  );

  camera.near = Math.max(size / 1000, 0.001);
  camera.far = Math.max(size * 100, 100);
  camera.updateProjectionMatrix();

  controls.update();
}

function setPointerNdc(event) {
  pointerNdc.x = (event.clientX / window.innerWidth) * 2 - 1;
  pointerNdc.y = -(event.clientY / window.innerHeight) * 2 + 1;
}

function raycastSkinnedMesh() {
  if (!skinnedMeshes.length) return null;

  raycaster.setFromCamera(pointerNdc, camera);

  const hits = raycaster.intersectObjects(skinnedMeshes, false);
  return hits[0] || null;
}

function getDominantBone(mesh, face) {
  const geometry = mesh.geometry;
  const skinIndex = geometry.getAttribute('skinIndex');
  const skinWeight = geometry.getAttribute('skinWeight');

  if (!skinIndex || !skinWeight || !mesh.skeleton || !face) return null;
  if (skinIndex.itemSize < 4 || skinWeight.itemSize < 4) return null;

  const indexArray = skinIndex.array;
  const weightArray = skinWeight.array;
  const candidates = [face.a, face.b, face.c];

  let bestIndex = -1;
  let bestWeight = -1;

  for (const vertexIndex of candidates) {
    const base = vertexIndex * skinIndex.itemSize;

    for (let j = 0; j < 4; j++) {
      const boneIndex = indexArray[base + j];
      const weight = weightArray[base + j];

      if (
        Number.isFinite(weight) &&
        weight > bestWeight &&
        boneIndex >= 0
      ) {
        bestWeight = weight;
        bestIndex = boneIndex;
      }
    }
  }

  if (bestIndex < 0) return null;

  return mesh.skeleton.bones[bestIndex] || null;
}

function startGrab(hit) {
  const bone = getDominantBone(hit.object, hit.face);

  if (!bone) {
    setStatus('この場所からボーンを特定できませんでした');
    return;
  }

  grabbed = {
    bone,
    lastX: lastPointerX,
    lastY: lastPointerY
  };

  isGrabbing = true;
  controls.enabled = false;

  setStatus(`掴んだ: ${bone.name || bone.uuid}`);
}

function rotateBone(bone, dx, dy) {
  if (!bone) return;

  if (dx !== 0) {
    tmpQuat.setFromAxisAngle(yAxis, dx * DRAG_SPEED);
    bone.quaternion.multiply(tmpQuat);
  }

  if (dy !== 0) {
    tmpQuat.setFromAxisAngle(xAxis, dy * DRAG_SPEED);
    bone.quaternion.multiply(tmpQuat);
  }
}

function setStatus(text) {
  status.textContent = text;
}

const clock = new THREE.Clock();

function animate() {
  requestAnimationFrame(animate);

  const delta = Math.min(clock.getDelta(), 0.05);

  if (
    currentVrm &&
    typeof currentVrm.update === 'function' &&
    physicsEnabled &&
    !isGrabbing
  ) {
    currentVrm.update(delta);
  }

  controls.update();
  renderer.render(scene, camera);
}

animate();
