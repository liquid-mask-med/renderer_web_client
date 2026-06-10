export const volumeShader = `
struct VolumeUniforms {
  model: mat4x4<f32>,
  view: mat4x4<f32>,
  projection: mat4x4<f32>,
  physicalSize: vec4<f32>,
  viewRay: vec4<f32>,
  maxSteps: vec4<u32>,
}

@group(0) @binding(0) var<uniform> uniforms: VolumeUniforms;
@group(0) @binding(1) var volumeTexture: texture_3d<u32>;
@group(0) @binding(2) var colorTexture: texture_2d<f32>;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) volumePos: vec3<f32>,
}

@vertex
fn vertexMain(@location(0) position: vec3<f32>) -> VertexOutput {
  var output: VertexOutput;
  output.volumePos = position;
  output.position = uniforms.projection * uniforms.view * uniforms.model * vec4<f32>(position, 1.0);
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  var pos = input.volumePos;
  var accumulated = vec4<f32>(0.0);
  let integerDimensions = vec3<i32>(textureDimensions(volumeTexture));
  let dimensions = vec3<f32>(integerDimensions);
  let eps = 1e-4;
  var step = 0u;
  loop {
    if (step >= uniforms.maxSteps.x) { break; }
    let coord = pos / uniforms.physicalSize.xyz + vec3<f32>(0.5);
    if (any(coord < vec3<f32>(-eps)) || any(coord > vec3<f32>(1.0 + eps))) { break; }
    let voxel = clamp(vec3<i32>(coord * dimensions), vec3<i32>(0), integerDimensions - vec3<i32>(1));
    let value = min(textureLoad(volumeTexture, voxel, 0).r, 4095u);
    let sampled = textureLoad(colorTexture, vec2<i32>(i32(value), 0), 0);
    let nextRgb = accumulated.rgb + (1.0 - accumulated.a) * sampled.rgb * sampled.a;
    let nextAlpha = accumulated.a + (1.0 - accumulated.a) * sampled.a;
    accumulated = vec4<f32>(nextRgb, nextAlpha);
    if (accumulated.a > 0.98) { break; }
    pos += uniforms.viewRay.xyz;
    step += 1u;
  }
  return vec4<f32>(accumulated.rgb, 1.0);
}`

export const clearShader = `
@vertex
fn vertexMain(@builtin(vertex_index) index: u32) -> @builtin(position) vec4<f32> {
  let positions = array<vec2<f32>, 3>(
    vec2<f32>(-1.0, -1.0),
    vec2<f32>(3.0, -1.0),
    vec2<f32>(-1.0, 3.0)
  );
  return vec4<f32>(positions[index], 0.0, 1.0);
}

@fragment
fn fragmentMain() -> @location(0) vec4<f32> {
  return vec4<f32>(0.0, 0.0, 0.0, 1.0);
}`

export const mprShader = `
struct SliceUniforms {
  origin: vec4<f32>,
  axisU: vec4<f32>,
  axisV: vec4<f32>,
  uvMin: vec4<f32>,
  uvMax: vec4<f32>,
  volumeSize: vec4<f32>,
  params: vec4<f32>,
}

@group(0) @binding(0) var<uniform> uniforms: SliceUniforms;
@group(0) @binding(1) var volumeTexture: texture_3d<u32>;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
}

@vertex
fn vertexMain(@builtin(vertex_index) index: u32) -> VertexOutput {
  let positions = array<vec2<f32>, 6>(
    vec2<f32>(-1.0, 1.0), vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, 1.0),
    vec2<f32>(1.0, 1.0), vec2<f32>(-1.0, -1.0), vec2<f32>(1.0, -1.0)
  );
  var output: VertexOutput;
  output.position = vec4<f32>(positions[index], 0.0, 1.0);
  output.uv = positions[index] * 0.5 + vec2<f32>(0.5);
  return output;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  let viewportAspect = uniforms.params.z / uniforms.params.w;
  let centerU = (uniforms.uvMax.x + uniforms.uvMin.x) * 0.5;
  let centerV = (uniforms.uvMax.y + uniforms.uvMin.y) * 0.5;
  var halfU = max((uniforms.uvMax.x - uniforms.uvMin.x) * 0.5, 1e-5);
  var halfV = max((uniforms.uvMax.y - uniforms.uvMin.y) * 0.5, 1e-5);
  if (viewportAspect > halfU / halfV) { halfU = halfV * viewportAspect; }
  else { halfV = halfU / viewportAspect; }
  let uOffset = centerU + (input.uv.x - 0.5) * 2.0 * halfU;
  let vOffset = centerV + (input.uv.y - 0.5) * 2.0 * halfV;
  let worldPos = uniforms.origin.xyz + uniforms.axisU.xyz * uOffset + uniforms.axisV.xyz * vOffset;
  let coord = worldPos / uniforms.volumeSize.xyz + vec3<f32>(0.5);
  if (any(coord <= vec3<f32>(0.0)) || any(coord >= vec3<f32>(1.0))) { discard; }
  let dimensions = vec3<f32>(textureDimensions(volumeTexture));
  let value = i32(textureLoad(volumeTexture, vec3<i32>(coord * dimensions), 0).r) - 1024;
  let windowMin = i32(uniforms.params.x) - i32(uniforms.params.y) / 2;
  let finalValue = clamp(f32(value - windowMin) / uniforms.params.y, 0.0, 1.0);
  return vec4<f32>(vec3<f32>(finalValue), 1.0);
}`
