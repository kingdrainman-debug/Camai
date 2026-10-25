// Upload pass 1 — the 2006 web video's frame: one field thrown away and the
// rest boxed down to a small raster.

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_cap;
uniform vec4 u_map;     // x0, y0, width, height of the picture in DV pixels
uniform vec2 u_size;    // upload raster
uniform int u_par;

void main() {
  ivec2 P = ivec2(gl_FragCoord.xy);
  ivec2 sz = textureSize(u_cap, 0);
  vec3 acc = vec3(0.0);
  for (int j = 0; j < 4; j++) {
    for (int i = 0; i < 4; i++) {
      float sx = u_map.x + (float(P.x) + (float(i) + 0.5) / 4.0) / u_size.x * u_map.z;
      float sy = u_map.y + (float(P.y) + (float(j) + 0.5) / 4.0) / u_size.y * u_map.w;
      int k = int(floor((sy - float(u_par) - 0.5) * 0.5 + 0.5));
      int row = clamp(2 * k + u_par, 0, sz.y - 1);
      if ((row & 1) != u_par) row += row + 1 < sz.y ? 1 : -1;
      acc += fetch(u_cap, int(floor(sx)), row).xyz;
    }
  }
  fragColor = vec4(acc / 16.0, 1.0);
}
