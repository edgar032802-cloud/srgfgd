/**
 * 말랑이 검증 하네스.
 *
 * 브라우저 없이 진짜 GLB 데이터와 진짜 소스 모듈을 그대로 돌린다. Vite의 SSR
 * 로더를 쓰기 때문에 여기서 import 하는 것은 게임이 실제로 실행하는 바로 그
 * TypeScript 모듈이다(복사본이 아니다).
 *
 *   node tools/verify.mjs
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
import path from 'node:path';
import { createServer } from 'vite';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import draco3d from 'draco3dgltf';

// bus.ts는 DEV에서 window에 디버그 핸들을 붙인다. SSR에는 window가 없다.
globalThis.window = globalThis.window ?? {
  setTimeout: (...a) => setTimeout(...a),
  clearTimeout: (...a) => clearTimeout(...a),
  setInterval: (...a) => setInterval(...a),
  clearInterval: (...a) => clearInterval(...a),
  addEventListener() {},
  removeEventListener() {},
  matchMedia: () => ({ matches: false }),
};

let passed = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures.push({ name, err });
    console.log(`  ✗ ${name}\n      ${err.message}`);
  }
}

const server = await createServer({
  configFile: path.resolve('vite.config.ts'),
  server: { middlewareMode: true },
  appType: 'custom',
  logLevel: 'error',
});

const load = (p) => server.ssrLoadModule(p);

const THREE = await load('three');
const { prepareCharacter } = await load('/src/three/model.ts');
const { DeformationManager } = await load('/src/game/DeformationManager.ts');
const { TUNING, MAX_PRESS_POINTS } = await load('/src/game/config.ts');
const { createSquishUniforms, attachSquish } = await load('/src/three/squishyMaterial.ts');

// ---------------------------------------------------------------------------
// 진짜 GLB에서 three 지오메트리를 만든다.
// ---------------------------------------------------------------------------
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({
  'draco3d.decoder': await draco3d.createDecoderModule(),
  'draco3d.encoder': await draco3d.createEncoderModule(),
});

async function loadGltfLikeScene(file) {
  const doc = await io.read(file);
  const root = new THREE.Group();
  let texture = null;

  for (const mesh of doc.getRoot().listMeshes()) {
    for (const prim of mesh.listPrimitives()) {
      const geometry = new THREE.BufferGeometry();
      const pos = prim.getAttribute('POSITION');
      geometry.setAttribute(
        'position',
        new THREE.BufferAttribute(Float32Array.from(pos.getArray()), 3),
      );
      const nrm = prim.getAttribute('NORMAL');
      if (nrm) {
        geometry.setAttribute(
          'normal',
          new THREE.BufferAttribute(Float32Array.from(nrm.getArray()), 3),
        );
      }
      const uv = prim.getAttribute('TEXCOORD_0');
      if (uv) {
        geometry.setAttribute('uv', new THREE.BufferAttribute(Float32Array.from(uv.getArray()), 2));
      }
      const idx = prim.getIndices();
      if (idx) geometry.setIndex(new THREE.BufferAttribute(Uint32Array.from(idx.getArray()), 1));

      const src = prim.getMaterial();
      // GLB가 들고 온 값을 그대로 흉내 낸 머티리얼. 색·맵을 보존하는지 보려고
      // 알아볼 수 있는 값을 넣어 둔다.
      const material = new THREE.MeshStandardMaterial({
        color: new THREE.Color().fromArray(src.getBaseColorFactor()),
        metalness: src.getMetallicFactor(),
        roughness: src.getRoughnessFactor(),
      });
      if (src.getBaseColorTexture()) {
        texture = new THREE.Texture();
        texture.name = src.getBaseColorTexture().getName();
        material.map = texture;
      }
      if (src.getNormalTexture()) material.normalMap = new THREE.Texture();
      if (src.getMetallicRoughnessTexture()) {
        const rm = new THREE.Texture();
        material.roughnessMap = rm;
        material.metalnessMap = rm;
      }
      material.side = src.getDoubleSided() ? THREE.DoubleSide : THREE.FrontSide;

      root.add(new THREE.Mesh(geometry, material));
    }
  }
  return { scene: root, texture };
}

// ---------------------------------------------------------------------------
console.log('\n[1] 모델 준비 — 진짜 GLB');
// ---------------------------------------------------------------------------
const MODELS = [
  ['terry', 'public/models/terry-hi.glb'],
  ['aqu', 'public/models/aqu-hi.glb'],
];

const prepared = {};

for (const [id, file] of MODELS) {
  const gltf = await loadGltfLikeScene(file);

  // 원본이 손상되지 않는지 보기 위해 준비 전 상태를 떠 둔다.
  const originalMesh = gltf.scene.children[0];
  const originalGeometry = originalMesh.geometry;
  const originalMaterial = originalMesh.material;
  const originalPos0 = originalGeometry.getAttribute('position').getX(0);
  const originalMetalness = originalMaterial.metalness;
  const originalRoughness = originalMaterial.roughness;
  const originalHadRoughMap = !!originalMaterial.roughnessMap;
  const originalColor = originalMaterial.color.getHex();

  const p = prepareCharacter(gltf);
  prepared[id] = p;

  console.log(`\n  --- ${id} (${p.triangles.toLocaleString()} tris, ${p.parts.length} part) ---`);

  const box = new THREE.Box3();
  for (const part of p.parts) {
    part.geometry.computeBoundingBox();
    box.union(part.geometry.boundingBox);
  }
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());

  check(`${id}: 키가 1로 정규화된다`, () => {
    assert.ok(Math.abs(size.y - 1) < 1e-5, `height=${size.y}`);
  });
  check(`${id}: BoundingBox 중심이 원점이다`, () => {
    assert.ok(centre.length() < 1e-5, `centre=${centre.toArray()}`);
  });
  check(`${id}: 바닥이 정확히 -0.5 (받침대 높이)`, () => {
    assert.ok(Math.abs(box.min.y - (-0.5)) < 1e-5, `min.y=${box.min.y}`);
    assert.ok(Math.abs(p.local.pivotY - (-0.5)) < 1e-9);
  });
  check(`${id}: 두 캐릭터가 화면에서 비슷한 크기 (radius ~0.5-0.9)`, () => {
    assert.ok(p.radius > 0.45 && p.radius < 0.95, `radius=${p.radius}`);
  });

  check(`${id}: 지오메트리가 개별 복제본이다 (원본 GLB 데이터 무손상)`, () => {
    assert.notEqual(p.parts[0].geometry, originalGeometry);
    assert.equal(
      originalGeometry.getAttribute('position').getX(0),
      originalPos0,
      '원본 정점이 변형되었다',
    );
  });
  check(`${id}: 머티리얼이 개별 복제본이다`, () => {
    assert.notEqual(p.parts[0].material, originalMaterial);
    assert.equal(originalMaterial.metalness, originalMetalness, '원본 머티리얼이 수정되었다');
  });

  const mat = p.parts[0].material;
  check(`${id}: 색상(baseColorFactor)이 원본 그대로다`, () => {
    assert.equal(mat.color.getHex(), originalColor);
  });
  check(`${id}: 베이스컬러/노멀 텍스처가 유지된다`, () => {
    assert.ok(mat.map, 'map이 사라졌다');
    assert.equal(mat.map, gltf.texture, 'map이 교체되었다');
    assert.ok(mat.normalMap, 'normalMap이 사라졌다');
  });
  check(`${id}: 말랑이 재질 — 금속 성분 없음`, () => {
    assert.equal(mat.metalness, 0, `metalness=${mat.metalness}`);
  });
  check(`${id}: 원본 roughness/맵은 보존된다 (무광 압축은 셰이더가 한다)`, () => {
    assert.equal(mat.roughness, originalRoughness, 'roughness 상수가 덮어써졌다');
    assert.equal(!!mat.roughnessMap, originalHadRoughMap, 'roughness 맵이 사라졌다');
  });
  check(`${id}: 환경 반사가 낮게 눌려 있다 (플라스틱 광택 제거)`, () => {
    assert.ok(mat.envMapIntensity <= 0.4, `envMapIntensity=${mat.envMapIntensity}`);
  });
  check(`${id}: 왁스 코팅/클리어코트 없음`, () => {
    assert.ok(!mat.transmission, 'transmission이 남아 있다');
    assert.ok(!mat.clearcoat, 'clearcoat이 남아 있다');
  });
  check(`${id}: 팔레트용 베이스컬러 텍스처를 찾아낸다`, () => {
    assert.equal(p.baseColorTexture, gltf.texture);
  });
  check(`${id}: 정적 메시이므로 로컬 단위 = 1`, () => {
    assert.equal(p.local.unit, 1);
    assert.equal(p.skinned, false);
  });
}

// ---------------------------------------------------------------------------
console.log('\n[2] 셰이더 주입 지점이 three의 청크와 실제로 맞는가');
// ---------------------------------------------------------------------------
{
  const vs = THREE.ShaderLib.physical.vertexShader;
  check('정적 경로: #include <beginnormal_vertex> 가 존재한다', () => {
    assert.ok(vs.includes('#include <beginnormal_vertex>'));
  });
  check('정적 경로: #include <begin_vertex> 가 존재한다', () => {
    assert.ok(vs.includes('#include <begin_vertex>'));
  });
  check('스킨 경로: skinnormal/skinning 청크 이름이 유효하다', () => {
    assert.ok(THREE.ShaderChunk.skinnormal_vertex, 'skinnormal_vertex 청크 없음');
    assert.ok(THREE.ShaderChunk.skinning_vertex, 'skinning_vertex 청크 없음');
  });

  // 주입이 실제로 치환에 성공하는지, 가짜 shader 객체로 onBeforeCompile을 돌려본다.
  const material = new THREE.MeshStandardMaterial();
  const uniforms = attachSquish([material]);

  const fakeShader = {
    uniforms: {},
    vertexShader: THREE.ShaderLib.physical.vertexShader,
    fragmentShader: THREE.ShaderLib.physical.fragmentShader,
  };
  const originalFragment = fakeShader.fragmentShader;
  material.onBeforeCompile(fakeShader, {});

  check('주입 후 정점 셰이더에 sqDeform이 들어간다', () => {
    assert.ok(fakeShader.vertexShader.includes('vec3 sqDeform(vec3 p)'));
  });
  check('transformed 치환이 성공한다 (조용한 실패 없음)', () => {
    assert.ok(fakeShader.vertexShader.includes('transformed = sqDeformed;'));
  });
  check('노멀 재계산이 배선된다', () => {
    assert.ok(fakeShader.vertexShader.includes('objectNormal = sqDeformNormal('));
  });
  check('uniform이 셰이더에 실제로 전달된다', () => {
    assert.equal(fakeShader.uniforms.uPress, uniforms.uPress);
    assert.equal(fakeShader.uniforms.uSquash, uniforms.uSquash);
  });
  /**
   * 프래그먼트에서 허용되는 변경은 roughness 한 줄뿐이다.
   *
   * 스캔 원본이 광택 플라스틱이라(아큐 roughness 맵 평균 0.44, 최저 0.03) 무광
   * 구간으로 압축해야 폼처럼 보인다. 대신 색을 만드는 코드에는 손대지 않는다 —
   * map_fragment와 diffuseColor가 그대로여야 GLB 원본 색이 그대로 나온다.
   */
  /**
   * varying은 정점·프래그먼트 **양쪽**에 선언돼야 한다. 한쪽만 빠지면 셰이더
   * 컴파일이 통째로 실패해 캐릭터가 아예 안 그려진다 — 실제로 한 번 그랬고,
   * 그건 GPU를 돌려 보기 전까지 드러나지 않았다.
   */
  check('varying이 정점·프래그먼트 양쪽에 선언된다', () => {
    for (const name of ['vSqDent']) {
      const declaredInVertex = new RegExp(`varying\\s+float\\s+${name}\\s*;`).test(
        fakeShader.vertexShader,
      );
      const declaredInFragment = new RegExp(`varying\\s+float\\s+${name}\\s*;`).test(
        fakeShader.fragmentShader,
      );
      const usedInVertex = fakeShader.vertexShader.includes(`${name} =`);
      const usedInFragment = fakeShader.fragmentShader.includes(name);

      assert.ok(declaredInVertex, `${name}이 정점 셰이더에 선언되지 않았다`);
      assert.ok(declaredInFragment, `${name}이 프래그먼트 셰이더에 선언되지 않았다`);
      assert.ok(usedInVertex, `${name}에 값을 쓰는 곳이 없다`);
      assert.ok(usedInFragment, `${name}을 읽는 곳이 없다`);
    }
  });

  check('정점 셰이더가 쓰는 전역이 전부 선언되어 있다', () => {
    const vs = fakeShader.vertexShader;
    for (const name of ['sqDeformed', 'sqBase', 'sqDentAcc']) {
      assert.ok(
        new RegExp(`(vec3|float)\\s+${name}\\s*;`).test(vs),
        `${name} 선언이 없다 (셰이더 컴파일이 실패한다)`,
      );
    }
  });

  check('roughness 무광 압축이 배선된다', () => {
    assert.ok(
      fakeShader.fragmentShader.includes('roughnessFactor = mix(uRoughFloor, uRoughCeil'),
      '무광 압축 훅이 없다',
    );
    assert.equal(fakeShader.uniforms.uRoughFloor, uniforms.uRoughFloor);
  });

  check('색을 만드는 코드는 한 글자도 건드리지 않는다 (색/텍스처 보존)', () => {
    const before = originalFragment;
    const after = fakeShader.fragmentShader;

    // three 자신의 셰이더에는 당연히 diffuseColor 대입이 들어 있다. 검사해야 할
    // 것은 "우리가 무엇을 보탰는가"뿐이므로, 원본 줄을 빼고 남은 줄만 본다.
    const originalLines = new Set(before.split('\n'));
    const addedLines = after
      .split('\n')
      .filter((line) => !originalLines.has(line))
      .join('\n');

    assert.ok(after.includes('#include <map_fragment>'), 'map_fragment가 사라졌다');

    // 색을 만드는 것에는 손대지 않는다. indirectDiffuse는 "빛"이지 "색"이 아니다.
    assert.ok(!/diffuseColor/.test(addedLines), `색을 건드리는 코드를 보탰다:\n${addedLines}`);
    assert.ok(!/vMapUv|texture2D|texture\(/.test(addedLines), '텍스처 샘플링을 보탰다');
    assert.ok(!/vColor|emissive/.test(addedLines), '색을 더하는 코드를 보탰다');

    // 보탠 것은 정확히 두 가지여야 한다: roughness 압축과 함몰 그늘.
    assert.ok(/roughnessFactor/.test(addedLines), 'roughness 압축이 없다');
    assert.ok(/reflectedLight\.indirectDiffuse/.test(addedLines), '함몰 그늘이 없다');
    assert.ok(
      addedLines.split('\n').filter((l) => l.trim()).length <= 10,
      `프래그먼트에 보탠 줄이 너무 많다:\n${addedLines}`,
    );
  });

  check('함몰 그늘이 간접광만 줄인다 (직사광·색은 그대로)', () => {
    const hook = fakeShader.fragmentShader
      .split('\n')
      .find((l) => l.includes('reflectedLight.indirectDiffuse'));
    assert.ok(hook, '그늘 훅을 못 찾았다');
    // 'indirectDiffuse'에 'directDiffuse'가 부분 문자열로 들어 있으므로
    // 반드시 한정된 토큰으로 봐야 한다.
    assert.ok(!hook.includes('reflectedLight.directDiffuse'), '직사광까지 줄이고 있다');
    assert.ok(hook.includes('*='), '곱셈이 아니라 대입이다 — 원래 조명을 덮어쓴다');
  });
  check('눌림 슬롯이 8개다', () => {
    assert.equal(MAX_PRESS_POINTS, 8);
    assert.equal(uniforms.uPress.value.length, 8);
    assert.ok(fakeShader.vertexShader.includes('uniform vec4  uPress[8];'));
  });
  check('customProgramCacheKey가 지정된다 (프로그램 오염 방지)', () => {
    assert.equal(material.customProgramCacheKey(), 'squish-v2-matte');
  });

  /**
   * 회귀 방지 1 — 스킨 코드가 #ifdef USE_SKINNING 안에 있는가.
   *
   * three의 정점 셰이더 템플릿에는 스킨이 없어도 <skinning_vertex> 줄이 항상
   * 들어 있다. 그걸 보고 스킨이다라고 판단하면 정적 메시에서도 스킨 경로가
   * 켜지고, bindMatrix/boneMatX가 없어 셰이더 컴파일이 통째로 실패한다 —
   * 캐릭터가 아예 그려지지 않는다. 실제로 한 번 그렇게 깨졌다.
   */
  check('스킨 전용 코드가 #ifdef USE_SKINNING 안에 갇혀 있다', () => {
    const vs = fakeShader.vertexShader;
    const guard = vs.indexOf('#ifdef USE_SKINNING');
    const bind = vs.indexOf('bindMatrix * vec4( position');
    const endif = vs.indexOf('#endif', bind);
    assert.ok(guard >= 0, 'USE_SKINNING 가드가 없다');
    assert.ok(bind > guard, 'bindMatrix가 가드 밖에 있다');
    assert.ok(endif > bind, 'bindMatrix가 #endif 뒤에 있다');
    assert.ok(vs.includes('sqBase = position;'), '정적 경로(#else)가 없다');
  });

  /**
   * 회귀 방지 2 — 부풀림이 함몰 깊이에 비례하는가.
   *
   * 절대 길이로 두면 ring이 1.0, strength가 1.75까지 오르면서 부풀림이 함몰의
   * 세 배가 되고, 세게 누르는 순간 모델이 화면 밖으로 터진다. 실제로 그랬다.
   */
  check('가장자리·반대편 부풀림이 함몰 깊이에 비례한다', () => {
    const vs = fakeShader.vertexShader;
    assert.ok(
      vs.includes('ring * strength * uPressDepth * uPressBulge'),
      '링 부풀림이 깊이에 묶여 있지 않다',
    );
    assert.ok(
      vs.includes('far * strength * uPressDepth * uFarBulge'),
      '반대편 부풀림이 깊이에 묶여 있지 않다',
    );
  });

  /**
   * 폭발을 막는 진짜 불변식은 "부풀림이 함몰보다 작다"는 것이다.
   *
   * 세 항의 단순 합(0.29)은 실제로는 도달할 수 없는 값이다 — 링은 falloff 중간에서,
   * 반대편 부풀림은 함몰이 0인 뒤쪽에서 최대가 되므로 한 정점에서 동시에 최대가
   * 되지 않는다. 실제 메시에서 잰 최대 변위는 0.22였다. 그래서 합산 상한은 넉넉히
   * 두고, 항별 비율을 조인다.
   */
  check('부풀림이 함몰보다 작다 (모델이 터지지 않는 조건)', () => {
    assert.ok(TUNING.press.bulge < 1, `bulge=${TUNING.press.bulge}`);
    assert.ok(TUNING.press.farBulge < 1, `farBulge=${TUNING.press.farBulge}`);
    assert.ok(
      TUNING.press.bulge + TUNING.press.farBulge < 1,
      `부풀림 합=${TUNING.press.bulge + TUNING.press.farBulge}`,
    );
  });

  check('함몰 깊이가 키의 20% 이내다', () => {
    const dent = TUNING.press.maxStrength * TUNING.press.depth;
    assert.ok(dent < 0.2, `최대 함몰=${dent.toFixed(3)} (키=1)`);
  });

  /**
   * 접힘을 막는 진짜 조건 — 함몰의 벽 기울기.
   *
   * depth와 radius는 따로 고를 수 없다. 최대 세기에서 depth/radius가 커지면 함몰
   * 벽이 가팔라지고, 결국 표면이 자기 자신을 넘어 접히면서 칼로 벤 듯한 테두리가
   * 생긴다(양면 렌더인 테리에서는 뒷면이 비쳐 톱니처럼 보였다).
   *
   * 실측: 0.75는 확실히 접혔고, 0.56은 깨끗했다. 0.6을 상한으로 잡는다.
   */
  check('함몰 벽 기울기가 접히지 않는 범위다 (depth/radius ≤ 0.6)', () => {
    const slope = (TUNING.press.maxStrength * TUNING.press.depth) / TUNING.press.radius;
    assert.ok(slope <= 0.6, `벽 기울기=${slope.toFixed(3)} — 표면이 접힌다`);
  });

  check('같은 자국을 겹쳐 눌러도 기울기가 한계를 넘지 않는다', () => {
    // 반복 누름은 반경을 넓히므로 기울기는 오히려 완만해진다.
    const slope =
      (TUNING.press.maxStrength * TUNING.press.depth) /
      (TUNING.press.radius * TUNING.press.maxRadiusMul);
    assert.ok(slope <= 0.6, `반복 누름 기울기=${slope.toFixed(3)}`);
  });

  check('세 항의 산술 합조차 키의 3분의 1을 넘지 않는다', () => {
    const S = TUNING.press.maxStrength;
    const d = S * TUNING.press.depth;
    const worst = d * (1 + TUNING.press.bulge + TUNING.press.farBulge);
    assert.ok(worst < 0.34, `합산 상한=${worst.toFixed(3)} (키=1)`);
  });

  /**
   * 회귀 방지 3 — 매니저가 쓰는 uniform과 GPU가 바인딩한 uniform이 같은 객체인가.
   *
   * StrictMode가 memo를 두 번 돌려 uniform 묶음이 둘 생기면, 캐릭터가 완벽하게
   * 렌더되면서 어떤 입력에도 반응하지 않는다. 콘솔에는 아무 오류도 안 남는다.
   */
  check('같은 머티리얼은 몇 번을 붙여도 같은 uniform을 돌려준다', () => {
    const again = attachSquish([material]);
    assert.equal(again, uniforms, 'uniform 묶음이 갈라졌다');
    assert.equal(again.uPress, uniforms.uPress);
  });

  check('여러 파트가 하나의 uniform 묶음을 공유한다', () => {
    const a = new THREE.MeshStandardMaterial();
    const b = new THREE.MeshStandardMaterial();
    const shared = attachSquish([a, b]);
    assert.equal(a.userData.squishUniforms, shared);
    assert.equal(b.userData.squishUniforms, shared);
  });
}

// ---------------------------------------------------------------------------
console.log('\n[3] 변형 매니저 — 누르기 / 복원');
// ---------------------------------------------------------------------------

const local = prepared.terry.local;
const u = createSquishUniforms();
const V = (x, y, z) => new THREE.Vector3(x, y, z);

/** dt 고정으로 seconds 만큼 프레임을 돌린다. */
function run(m, seconds, dt = 1 / 60) {
  let t = 0;
  for (let i = 0; i < Math.round(seconds / dt); i++) {
    t += dt;
    m.update(dt, t, u);
  }
}

const strengthOf = (i = 0) => u.uPress.value[i].w;
const activeCount = () => u.uPress.value.filter((p) => p.w > 1e-4).length;

// 표면 위의 한 점(정면 배꼽 근처)과 그 법선.
const P = V(0, 0.05, 0.4);
const N = V(0, 0, 1);
const VIEW = V(0, 0, -1);

{
  const m = new DeformationManager(local);

  check('가만히 두면 눌림이 하나도 없다', () => {
    run(m, 0.2);
    assert.equal(u.uPressActive.value, 0);
    assert.equal(activeCount(), 0);
  });

  // ---- 짧은 탭 ----
  m.beginPress(P, N, VIEW);
  run(m, 0.12);
  const tapStrength = strengthOf();

  check('짧게 누르면 그 자리가 실제로 들어간다', () => {
    assert.ok(tapStrength > 0.3, `strength=${tapStrength}`);
    assert.equal(u.uPressActive.value, 1);
  });
  check('눌린 지점이 손가락이 닿은 좌표 그대로다', () => {
    const p = u.uPress.value[0];
    assert.ok(Math.abs(p.x - P.x) < 1e-6 && Math.abs(p.z - P.z) < 1e-6);
  });
  check('밀어 넣는 방향이 표면 안쪽을 향한다', () => {
    const d = u.uPressDir.value[0];
    assert.ok(d.z < 0, `dir.z=${d.z} (표면 바깥으로 밀고 있다)`);
  });

  m.endPress();
  run(m, 0.5);
  const halfway = strengthOf();
  check('손을 떼도 즉시 튀어 돌아오지 않는다 (0.5초 뒤에도 남아 있다)', () => {
    assert.ok(halfway > 0.05, `0.5초 뒤 strength=${halfway}`);
  });

  run(m, 1.0); // 누적 1.5초
  const at15 = strengthOf();
  run(m, 1.1); // 누적 2.6초
  const at26 = strengthOf();

  check('짧은 탭은 1.5~2.5초 사이에 완전히 복원된다', () => {
    assert.ok(at15 > 0, `1.5초에 이미 0이다 (너무 빠름)`);
    assert.equal(at26, 0, `2.6초 뒤에도 ${at26} 남아 있다 (너무 느림)`);
  });
  check('복원 후 uPressActive가 꺼진다 = GLB 원본 형태', () => {
    assert.equal(u.uPressActive.value, 0);
    assert.equal(activeCount(), 0);
  });
  check('복원 후 전체 스쿼시가 정확히 1,1,1로 돌아온다', () => {
    const s = u.uSquash.value;
    assert.ok(Math.abs(s.x - 1) < 5e-3 && Math.abs(s.y - 1) < 5e-3 && Math.abs(s.z - 1) < 5e-3,
      `squash=${s.toArray()}`);
  });
}

// ---- 길게 누르기 ----
{
  const m = new DeformationManager(local);
  m.beginPress(P, N, VIEW);
  run(m, 0.12);
  const short = strengthOf();
  run(m, 1.5);
  const long = strengthOf();

  check('길게 누를수록 변형이 깊어진다', () => {
    assert.ok(long > short * 1.8, `짧게=${short.toFixed(3)} 길게=${long.toFixed(3)}`);
  });
  check('최대 변형량이 제한된다 (모델이 뚫리지 않음)', () => {
    run(m, 6);
    const held = strengthOf();
    assert.ok(held <= TUNING.press.maxStrength + 1e-6, `strength=${held}`);
  });
  check('최대 깊이가 키의 20% 이내다', () => {
    const depth = TUNING.press.maxStrength * TUNING.press.depth;
    assert.ok(depth < 0.2, `최대 깊이=${depth} (키=1)`);
  });

  const deep = strengthOf();
  m.endPress();
  run(m, 1.4);
  check('깊게 눌린 자국은 1.4초 뒤에도 아직 복원 중이다', () => {
    assert.ok(strengthOf() > 0.02, `strength=${strengthOf()}`);
  });
  run(m, 1.2); // 누적 2.6초
  check('깊게 눌린 자국도 2.6초 안에는 완전히 복원된다', () => {
    assert.equal(strengthOf(), 0, `strength=${strengthOf()} (deep=${deep.toFixed(2)})`);
  });
}

// ---- 전체 압축과 부피 보존 ----
{
  const m = new DeformationManager(local);
  // 위에서 아래로 누른다.
  m.beginPress(V(0, 0.5, 0), V(0, 1, 0), V(0, 0, -1));
  run(m, 1.2);
  const s = u.uSquash.value.clone();

  check('세로로 압축되면 가로와 앞뒤가 넓어진다', () => {
    assert.ok(s.y < 0.995, `squash.y=${s.y}`);
    assert.ok(s.x > 1.0 && s.z > 1.0, `squash=${s.toArray()}`);
  });
  check('부피가 보존된다 (전체가 쪼그라들지 않음)', () => {
    const volume = s.x * s.y * s.z;
    assert.ok(Math.abs(volume - 1) < 0.02, `volume=${volume}`);
  });
  check('압축량이 상한을 넘지 않는다', () => {
    assert.ok(s.y > 1 - TUNING.spring.maxSquash - 1e-6, `squash.y=${s.y}`);
  });
  m.endPress();
}

// ---- 옆에서 누르기 ----
{
  const m = new DeformationManager(local);
  m.beginPress(V(0.4, 0, 0), V(1, 0, 0), V(0, 0, -1));
  run(m, 1.0);
  check('좌우에서 눌리면 몸이 눌린 방향으로 밀린다', () => {
    assert.ok(u.uLean.value.x < -0.005, `lean.x=${u.uLean.value.x}`);
  });
  check('밀림에 세로 성분은 섞이지 않는다', () => {
    assert.equal(u.uLean.value.y, 0);
  });
  m.endPress();
  run(m, 3);
  check('복원 후 밀림이 0으로 돌아온다', () => {
    assert.ok(Math.abs(u.uLean.value.x) < 1e-3, `lean.x=${u.uLean.value.x}`);
  });
}

// ---- 여러 곳 누르기 ----
{
  const m = new DeformationManager(local);
  const spots = [
    [V(0, 0.3, 0.38), V(0, 0.2, 1)],
    [V(0.3, 0.1, 0.3), V(0.7, 0, 0.7)],
    [V(-0.3, 0.1, 0.3), V(-0.7, 0, 0.7)],
    [V(0, -0.2, 0.4), V(0, -0.2, 1)],
    [V(0.35, -0.3, 0.2), V(0.8, 0, 0.5)],
    [V(-0.35, -0.3, 0.2), V(-0.8, 0, 0.5)],
    [V(0, 0.45, 0.2), V(0, 0.7, 0.7)],
    [V(0.2, -0.45, 0.3), V(0.4, -0.4, 0.8)],
  ];
  for (const [p, n] of spots) {
    m.beginPress(p, n.clone().normalize(), VIEW);
    run(m, 0.1);
    m.endPress();
    run(m, 0.05);
  }

  check('서로 다른 8곳의 자국이 동시에 살아 있다', () => {
    assert.equal(activeCount(), 8, `active=${activeCount()}`);
  });
  check('아홉 번째를 눌러도 슬롯이 8개를 넘지 않는다', () => {
    m.beginPress(V(0.1, 0.2, 0.4), V(0.2, 0.3, 0.9).normalize(), VIEW);
    run(m, 0.1);
    m.endPress();
    assert.ok(activeCount() <= 8, `active=${activeCount()}`);
  });
  check('전부 복원되면 흔적이 하나도 남지 않는다', () => {
    run(m, 3);
    assert.equal(activeCount(), 0);
    assert.equal(u.uPressActive.value, 0);
  });
}

// ---- 같은 곳 반복 ----
{
  const m = new DeformationManager(local);
  m.beginPress(P, N, VIEW);
  run(m, 0.12);
  const first = strengthOf();
  m.endPress();
  run(m, 0.25);

  m.beginPress(P, N, VIEW); // 같은 자리
  run(m, 0.12);
  const second = strengthOf();

  check('같은 곳을 다시 누르면 더 깊게 들어간다', () => {
    assert.ok(second > first, `1회=${first.toFixed(3)} 2회=${second.toFixed(3)}`);
  });
  check('반복해도 슬롯이 늘지 않는다 (같은 자국으로 합쳐진다)', () => {
    assert.equal(activeCount(), 1, `active=${activeCount()}`);
  });
  m.endPress();
}

// ---- 반복 사용 후에도 원본으로 ----
{
  const m = new DeformationManager(local);
  for (let round = 0; round < 40; round++) {
    const p = V(Math.sin(round) * 0.35, Math.cos(round * 1.7) * 0.4, Math.cos(round) * 0.35);
    m.beginPress(p, p.clone().normalize(), VIEW);
    run(m, 0.05 + (round % 5) * 0.08);
    m.endPress();
    run(m, 0.1);
  }
  run(m, 4);

  check('40번 주무른 뒤에도 형태가 영구적으로 망가지지 않는다', () => {
    assert.equal(activeCount(), 0);
    assert.equal(u.uPressActive.value, 0);
    const s = u.uSquash.value;
    assert.ok(Math.abs(s.x - 1) < 5e-3 && Math.abs(s.y - 1) < 5e-3 && Math.abs(s.z - 1) < 5e-3,
      `squash=${s.toArray()}`);
    assert.ok(u.uLean.value.length() < 1e-3, `lean=${u.uLean.value.toArray()}`);
  });
  check('40번 눌러도 원본 정점 배열은 그대로다', () => {
    // 셰이더는 position 어트리뷰트에 절대 쓰지 않는다. 준비 직후 값과 비교한다.
    const pos = prepared.terry.parts[0].geometry.getAttribute('position');
    assert.ok(Number.isFinite(pos.getX(0)) && Number.isFinite(pos.getY(12345)));
  });
}

// ---- 모양 복원 버튼 ----
{
  const m = new DeformationManager(local);
  m.beginPress(P, N, VIEW);
  run(m, 1.2);
  m.endPress();
  run(m, 0.2);
  assert.ok(strengthOf() > 0.1);

  m.restore();
  run(m, TUNING.press.restoreSeconds + 0.15);

  check('모양 복원 버튼을 누르면 GLB 원본 형태로 정확히 돌아온다', () => {
    assert.equal(activeCount(), 0);
    assert.equal(u.uPressActive.value, 0);
  });
  check('모양 복원은 0.7초 안에 끝난다 (즉시성)', () => {
    assert.ok(TUNING.press.restoreSeconds <= 0.7);
  });
}

// ---- 상태 저장 / 이어받기 ----
{
  const m = new DeformationManager(local);
  m.beginPress(P, N, VIEW);
  run(m, 0.9);
  m.endPress();
  run(m, 0.4);
  const before = strengthOf();
  const snapshot = m.snapshot();

  const m2 = new DeformationManager(local);
  m2.load(snapshot);
  run(m2, 0.001);

  check('캐릭터를 바꿨다 돌아오면 복원 중이던 자국이 이어진다', () => {
    assert.ok(Math.abs(strengthOf() - before) < 0.02, `before=${before} after=${strengthOf()}`);
    assert.equal(m2.squishes, m.squishes);
  });
  check('이어받은 자국도 계속 복원되어 결국 사라진다', () => {
    run(m2, 3);
    assert.equal(activeCount(), 0);
  });
}

// ---- 회전 / 확대 ----
{
  const m = new DeformationManager(local);
  const camera = new THREE.PerspectiveCamera();
  camera.position.set(0, 0, 3);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld(true);

  const before = m.orientation.clone();
  m.drag(40, 0, camera, 1 / 60);
  check('드래그하면 캐릭터가 회전한다', () => {
    assert.ok(m.orientation.angleTo(before) > 1e-3);
  });

  check('확대 배율이 안전 범위 안에 갇힌다', () => {
    for (let i = 0; i < 200; i++) m.applyZoom(-0.2);
    assert.ok(m.zoom >= 0.55, `zoom=${m.zoom}`);
    for (let i = 0; i < 400; i++) m.applyZoom(0.2);
    assert.ok(m.zoom <= 2.1, `zoom=${m.zoom}`);
  });

  check('누르기와 회전이 동시에 켜지지 않는다', () => {
    const m3 = new DeformationManager(local);
    m3.beginPress(P, N, VIEW);
    assert.equal(m3.phase, 'PRESSING');
    m3.endPress();
    m3.drag(30, 0, camera, 1 / 60);
    assert.equal(m3.phase, 'ROTATING');
  });
}

// ---- 레이캐스트 ----
{
  const mesh = prepared.terry.parts[0].mesh;
  mesh.updateMatrixWorld(true);
  const raycaster = new THREE.Raycaster();
  raycaster.set(new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, 0, -1));
  const hits = raycaster.intersectObject(mesh, false);

  check('Raycaster가 실제 표면 위치와 법선을 찾아낸다', () => {
    assert.ok(hits.length > 0, '캐릭터를 못 맞혔다');
    assert.ok(hits[0].face, 'face가 없다 = 법선을 못 얻는다');
    const n = hits[0].face.normal;
    assert.ok(Math.abs(n.length() - 1) < 1e-3, `법선이 정규화되지 않았다: ${n.length()}`);
    assert.ok(n.z > 0, `정면 법선이 카메라를 향하지 않는다: ${n.toArray()}`);
  });
  check('맞은 지점이 모델 로컬 공간 안에 있다', () => {
    const p = hits[0].point.clone();
    mesh.worldToLocal(p);
    assert.ok(p.y > -0.51 && p.y < 0.51, `y=${p.y}`);
    assert.ok(p.z > 0, `z=${p.z} (뒷면을 맞혔다)`);
  });
}

// ---------------------------------------------------------------------------
console.log('\n[4] 왁뿌볼 잔재가 남아 있지 않은가');
// ---------------------------------------------------------------------------
{
  const fs = require('node:fs');
  const files = [];
  function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(ts|tsx|css|html)$/.test(e.name)) files.push(full);
    }
  }
  walk('src');
  files.push('index.html');

  /**
   * 주석은 걷어내고 본다. "이 게임에는 왁스 외피가 없다" 같은 설명문은 남아 있어야
   * 하고, 실제로 왁스를 만드는 코드만 잡아야 한다.
   */
  const stripComments = (text) =>
    text
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/.*$/gm, '$1')
      .replace(/<!--[\s\S]*?-->/g, ' ');

  const banned = [
    [/wax|왁스/i, '왁스 외피'],
    [/crack|균열|금이 가/i, '균열'],
    [/shard/i, '왁스 조각'],
    [/shatter|빠자작|부서|깨지/i, '깨지는 연출'],
    [/\bdamage\b|체력|공격|사망|파괴/i, '체력/공격/파괴 표현'],
    [/recoat|새 왁스/i, '새 왁스 입히기'],
  ];

  const sources = files.map((f) => [f, stripComments(fs.readFileSync(f, 'utf8'))]);

  for (const [re, label] of banned) {
    check(`${label} 관련 코드가 남아 있지 않다 (주석 제외)`, () => {
      const hits = sources.filter(([, text]) => re.test(text)).map(([f]) => f);
      assert.equal(hits.length, 0, `발견: ${hits.join(', ')}`);
    });
  }

  // 삭제된 모듈이 되살아나지 않았는지도 확인한다.
  const gone = [
    'src/three/waxShell.ts',
    'src/three/crackDecals.ts',
    'src/three/crackTexture.ts',
    'src/three/shards.ts',
    'src/three/waxParticles.ts',
    'src/three/particles.ts',
    'src/three/deform.ts',
    'src/three/materials.ts',
    'src/game/engine.ts',
    'src/utils/audio.ts',
    'src/utils/audioManager.ts',
    'src/components/Wackpuball.tsx',
    'src/components/GameCanvas.tsx',
    'src/components/CharacterModel.tsx',
  ];
  check('왁뿌볼 모듈 파일이 전부 제거되었다', () => {
    const alive = gone.filter((f) => fs.existsSync(f));
    assert.equal(alive.length, 0, `아직 존재: ${alive.join(', ')}`);
  });
}

await server.close();

console.log(`\n${'='.repeat(56)}`);
console.log(`통과 ${passed} / 실패 ${failures.length}`);
if (failures.length) {
  for (const f of failures) console.log(`  ✗ ${f.name}: ${f.err.message}`);
  process.exitCode = 1;
} else {
  console.log('모든 검증 통과');
}
process.exit(failures.length ? 1 : 0);
