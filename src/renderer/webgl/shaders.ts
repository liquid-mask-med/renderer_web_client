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
uniform int maxSteps;
out vec4 color;
void main() {
  vec3 pos = volumePos;
  vec4 accumulatedColor = vec4(0.0);
  float eps = 1e-4;
  for (int i = 0; i < maxSteps; ++i) {
    vec3 coord = pos / volumePhysicalSize + vec3(0.5);
    
    if (any(lessThan(coord, vec3(-eps))) || any(greaterThan(coord, vec3(1.0 + eps)))) break;
    float sampledValue = texture(volumeTexture, coord).r;
    vec4 sampledColor = texture(volumeColor, vec2(sampledValue * 65535.0 / 4095.0, 0.5));
    float alpha = sampledColor.a;
    accumulatedColor.rgb += (1.0 - accumulatedColor.a) * sampledColor.rgb * alpha;
    accumulatedColor.a += (1.0 - accumulatedColor.a) * alpha;
    if (accumulatedColor.a > 0.98) break;
    pos += viewRay;
  }
  color = vec4(accumulatedColor.rgb, 1.0);
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
