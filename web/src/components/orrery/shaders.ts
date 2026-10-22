export const NOISE = /* glsl */ `
float hash(vec3 p){ p = fract(p*0.3183099 + .1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float vnoise(vec3 x){
  vec3 i = floor(x); vec3 f = fract(x); f = f*f*(3.0-2.0*f);
  return mix(mix(mix(hash(i+vec3(0,0,0)),hash(i+vec3(1,0,0)),f.x), mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x), mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y), f.z);
}
float fbm(vec3 p){ float a = 0.5, s = 0.0; for(int i=0;i<5;i++){ s += a*vnoise(p); p = p*2.03 + 1.7; a *= 0.5; } return s; }
`;

export const planetVertex = /* glsl */ `
varying vec3 vObj; varying vec3 vNormalW; varying vec3 vWorld;
void main(){
  vObj = normalize(position);
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

export const planetFragment = /* glsl */ `
uniform vec3 uColor; uniform float uTime; uniform int uSurface; uniform float uSeed; uniform float uHover;
varying vec3 vObj; varying vec3 vNormalW; varying vec3 vWorld;
${NOISE}
vec3 rotY(vec3 p, float a){ float c = cos(a), s = sin(a); return vec3(c*p.x + s*p.z, p.y, -s*p.x + c*p.z); }
void main(){
  vec3 p = rotY(vObj, uTime*0.12) + uSeed;
  vec3 c = uColor; vec3 col; vec3 glow = vec3(0.0);
  if (uSurface == 0) { // gas giant: soft bands with turbulence
    float t = fbm(p*2.2 + vec3(0.0, uTime*0.02, 0.0));
    float b = sin(vObj.y*11.0 + t*4.5);
    col = mix(c*0.5, mix(c*1.25, vec3(1.0,0.86,0.8), 0.18), b*0.5+0.5);
    float spot = smoothstep(0.22, 0.0, length(vec2(atan(p.z,p.x)*0.35 - 0.4, vObj.y + 0.25)));
    col = mix(col, vec3(1.0,0.7,0.6), spot*0.55);
  } else if (uSurface == 1) { // rocky with craters
    float n = fbm(p*3.2);
    col = mix(c*0.42, c*1.08 + 0.06, n);
    float cr = smoothstep(0.62, 0.66, vnoise(p*7.0));
    col *= 1.0 - cr*0.35;
  } else if (uSurface == 2) { // ice
    float n = fbm(p*2.6);
    col = mix(vec3(0.82,0.9,0.98), c*1.1, n*0.7);
    col = mix(col, vec3(1.0), smoothstep(0.65, 0.9, abs(vObj.y)));
  } else if (uSurface == 3) { // ocean world
    float n = fbm(p*2.4);
    float land = smoothstep(0.52, 0.56, n);
    vec3 sea = mix(c*0.35, c*0.75, fbm(p*6.0));
    vec3 ground = mix(vec3(0.55,0.78,0.6), vec3(0.95,0.88,0.75), fbm(p*5.0));
    col = mix(sea, ground, land);
    float cloud = smoothstep(0.55, 0.75, fbm(rotY(vObj, uTime*0.18)*3.0 + 9.0));
    col = mix(col, vec3(1.0), cloud*0.65);
  } else { // lava
    float n = fbm(p*3.6);
    col = mix(vec3(0.08,0.05,0.1), c*0.35, n);
    float crack = smoothstep(0.035, 0.0, abs(n - 0.5));
    glow = vec3(1.0,0.55,0.35) * crack * (0.8 + 0.2*sin(uTime*2.0 + n*20.0));
  }
  vec3 N = normalize(vNormalW);
  vec3 L = normalize(-vWorld);
  vec3 V = normalize(cameraPosition - vWorld);
  float diff = max(dot(N, L), 0.0);
  float wrap = max(dot(N, L)*0.5 + 0.5, 0.0);
  vec3 lit = col * (0.26 + 0.95*diff + 0.22*wrap);
  float rim = pow(1.0 - max(dot(N, V), 0.0), 3.0);
  vec3 atmo = mix(c, vec3(0.85,0.8,1.0), 0.5);
  lit += atmo * rim * (0.35 + 0.65*wrap) * (0.9 + uHover*0.8);
  gl_FragColor = vec4(lit + glow, 1.0);
}`;

export const atmoVertex = /* glsl */ `
varying vec3 vNormalW; varying vec3 vWorld;
void main(){
  vec4 w = modelMatrix * vec4(position, 1.0); vWorld = w.xyz;
  vNormalW = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

export const atmoFragment = /* glsl */ `
uniform vec3 uColor; uniform float uPower; uniform float uHover;
varying vec3 vNormalW; varying vec3 vWorld;
void main(){
  vec3 V = normalize(cameraPosition - vWorld);
  float f = pow(1.0 - abs(dot(normalize(vNormalW), V)), uPower);
  float lightSide = max(dot(normalize(vNormalW), normalize(-vWorld))*0.5+0.6, 0.0);
  gl_FragColor = vec4(uColor, f * lightSide * (0.75 + uHover*0.6));
}`;

export const sunFragment = /* glsl */ `
uniform float uTime; varying vec3 vObj; varying vec3 vNormalW; varying vec3 vWorld;
${NOISE}
void main(){
  vec3 p = vObj*3.0;
  float n = fbm(p + vec3(uTime*0.15, uTime*0.08, -uTime*0.1));
  float m = fbm(p*2.0 - vec3(uTime*0.2));
  vec3 hot = vec3(1.0, 0.97, 0.93);
  vec3 warm = vec3(1.0, 0.69, 0.6);
  vec3 col = mix(warm, hot, smoothstep(0.35, 0.75, n*0.7 + m*0.5));
  vec3 V = normalize(cameraPosition - vWorld);
  float limb = pow(max(dot(normalize(vNormalW), V), 0.0), 0.45);
  col *= 0.78 + 0.32*limb;
  gl_FragColor = vec4(col*1.15, 1.0);
}`;

export const glowFragment = /* glsl */ `
uniform float uTime; uniform vec3 uInner; uniform vec3 uOuter; varying vec2 vUv;
void main(){
  vec2 d = vUv - 0.5; float r = length(d)*2.0;
  float a = atan(d.y, d.x);
  float rays = 0.85 + 0.15*sin(a*9.0 + uTime*0.4) * sin(a*5.0 - uTime*0.25);
  float g = pow(max(1.0 - r, 0.0), 2.4) * rays;
  vec3 col = mix(uOuter, uInner, pow(max(1.0 - r, 0.0), 3.0));
  gl_FragColor = vec4(col, g);
}`;

export const uvVertex = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

export const nebulaFragment = /* glsl */ `
uniform float uTime; varying vec3 vObj;
${NOISE}
void main(){
  vec3 p = vObj*2.2;
  float a = fbm(p + vec3(uTime*0.004));
  float b = fbm(p*1.7 - 3.0 + vec3(0.0, uTime*0.003, 0.0));
  vec3 violet = vec3(0.36,0.25,0.77);
  vec3 blue = vec3(0.17,0.3,0.72);
  vec3 rose = vec3(0.76,0.33,0.48);
  vec3 col = violet * smoothstep(0.45, 0.85, a) * 0.55 + blue * smoothstep(0.5, 0.9, b) * 0.45 + rose * smoothstep(0.62, 0.95, a*b*1.6) * 0.35;
  col *= 0.55;
  gl_FragColor = vec4(col + vec3(0.039,0.039,0.1), 1.0);
}`;

export const ringFragment = /* glsl */ `
uniform vec3 uColor; varying vec2 vUv;
${NOISE}
void main(){
  float r = vUv.x;
  float bands = 0.55 + 0.45*sin(r*80.0) * vnoise(vec3(r*40.0, 0.0, 0.0));
  float edge = smoothstep(0.0, 0.08, r) * smoothstep(1.0, 0.85, r);
  gl_FragColor = vec4(mix(uColor, vec3(0.95,0.92,1.0), 0.45), bands * edge * 0.55);
}`;
