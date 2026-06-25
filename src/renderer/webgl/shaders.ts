export const mainVertexShader = `#version 300 es
in vec3 position;
uniform mat4 modelMatrix;
uniform mat4 projectMatrix;
uniform mat4 viewMatrix;
out vec3 volumePos;
void main() {
  volumePos = position;
  gl_Position = projectMatrix * viewMatrix * modelMatrix * vec4(position, 1.0);
}`

export const mainFragmentShader = `#version 300 es
precision highp float;
precision highp sampler3D;
in vec3 volumePos;
uniform sampler3D volumeTexture;
uniform sampler2D volumeColor;
uniform vec3 viewRay;
uniform vec3 volumePhysicalSize;
uniform vec3 volumePixelSize;
uniform float stepSize;
uniform int maxSteps;
out vec4 color;
vec3 GetGradient(vec3 coord);
float InterleavedGradientNoise(vec2 pixel);
void main() {
  vec3 rayStep = viewRay * stepSize;
  vec3 pos = volumePos + rayStep * InterleavedGradientNoise(gl_FragCoord.xy);
  vec4 accumulatedColor = vec4(0.0);
  float eps = 1e-4;
  for (int i = 0; i < maxSteps; ++i) {
    vec3 coord = pos / volumePhysicalSize + vec3(0.5);
    // coord.z = 1.0 - coord.z;

    if (any(lessThan(coord, vec3(-eps))) || any(greaterThan(coord, vec3(1.0 + eps)))) break;
    float sampledValue = texture(volumeTexture, coord).r;
    vec4 sampledColor = texture(volumeColor, vec2(sampledValue * 65535.0 / 4095.0, 0.5));
    float alpha = 1.0 - pow(max(1.0 - sampledColor.a, 0.0), stepSize);
    if (alpha > 0.001) {
      vec3 N = -GetGradient(coord);
      // N.z = -N.z;
      vec3 L = normalize(-viewRay);
      float ndotl = max(dot(N, L), 0.0);
      sampledColor.rgb *= 0.2 + 1.0 * ndotl;
    }
    accumulatedColor.rgb += (1.0 - accumulatedColor.a) * sampledColor.rgb * alpha;
    accumulatedColor.a += (1.0 - accumulatedColor.a) * alpha;
    if (accumulatedColor.a > 0.98) break;
    pos += rayStep;
  }
  // vec3 bgColor = vec3(0.55, 0.58, 0.78);
  vec3 bgColor = vec3(0);
  vec3 finalRgb = accumulatedColor.rgb + (1.0 - accumulatedColor.a) * bgColor;
  color = vec4(finalRgb, 1.0);
}

float InterleavedGradientNoise(vec2 pixel) {
  return fract(52.9829189 * fract(dot(pixel, vec2(0.06711056, 0.00583715))));
}

vec3 GetGradient(vec3 coord) {
  vec3 cellStep = 1.0 / volumePixelSize;

  float xp = texture(volumeTexture, coord + vec3(cellStep.x, 0.0, 0.0)).r * 65535.0;
  float xm = texture(volumeTexture, coord - vec3(cellStep.x, 0.0, 0.0)).r * 65535.0;

  float yp = texture(volumeTexture, coord + vec3(0.0, cellStep.y, 0.0)).r * 65535.0;
  float ym = texture(volumeTexture, coord - vec3(0.0, cellStep.y, 0.0)).r * 65535.0;

  float zp = texture(volumeTexture, coord + vec3(0.0, 0.0, cellStep.z)).r * 65535.0;
  float zm = texture(volumeTexture, coord - vec3(0.0, 0.0, cellStep.z)).r * 65535.0;

  vec3 spacing = volumePhysicalSize / volumePixelSize;
  vec3 grad = vec3(
    (xp - xm) / spacing.x,
    (yp - ym) / spacing.y,
    (zp - zm) / spacing.z
  );

  float len = length(grad);
  return len > 0.0 ? grad / len : vec3(0.0);
}`

export const mprVertexShader = `#version 300 es
in vec3 position;
out vec2 uv;
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
  uv = position.xy * 0.5 + 0.5;
}`

export const mprFragmentShader = `#version 300 es
precision highp float;
precision highp sampler3D;
in vec2 uv;
uniform sampler3D volumeTexture;
uniform vec3 origin;
uniform vec3 axisU;
uniform vec3 axisV;
uniform vec2 centerUV;
uniform vec2 halfUV;
uniform int windowCenter;
uniform int windowWidth;
uniform vec3 volumeSize;
uniform int width;
uniform int height;
out vec4 color;
void main() {
  float uOffset = centerUV.x + (uv.x - 0.5) * 2.0 * halfUV.x;
  float vOffset = centerUV.y + (uv.y - 0.5) * 2.0 * halfUV.y;
  vec3 worldPos = origin + axisU * uOffset + axisV * vOffset;
  vec3 coord = worldPos / volumeSize + vec3(0.5);
  if (any(lessThanEqual(coord, vec3(0.0))) || any(greaterThanEqual(coord, vec3(1.0)))) discard;
  int i16 = int(round(texture(volumeTexture, coord).r * 65535.0));
  int hu = i16 - 1024;
  int windowMin = windowCenter - windowWidth / 2;
  float finalVal = clamp(float(hu - windowMin) / float(windowWidth), 0.0, 1.0);
  color = vec4(vec3(finalVal), 1.0);
}`
