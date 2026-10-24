// Pass 2 — phosphor persistence.
//
// A phosphor keeps emitting after the beam has passed, decaying roughly
// exponentially. The emitted light is therefore the maximum of "what the beam
// just deposited" and "what is left over from before", not a sum — a decaying
// trail must never make a moving highlight brighter than the highlight itself.
//
// P22 phosphors do not decay together. The green (P22-GR, zinc silicate family)
// outlasts the blue by a wide margin, which is why motion trails on a consumer
// television skew green.

in vec2 v_uv;
out vec4 fragColor;

uniform sampler2D u_cur;
uniform sampler2D u_prev;
uniform float u_persistence;
uniform float u_tilt;     // -1 blue-biased .. +1 green-biased
uniform float u_dt;       // seconds since the previous field

void main() {
  vec4 cur = texture(u_cur, v_uv);
  vec3 prev = texture(u_prev, v_uv).rgb;

  if (u_persistence <= 0.0005) {
    fragColor = cur;
    return;
  }

  // Turn the 0..1 control into a half-life, then into a per-field factor, so
  // the trail length is the same whatever the frame rate is.
  float halfLife = mix(0.004, 0.42, pow(u_persistence, 1.6));
  vec3 bias = vec3(1.0 - max(u_tilt, 0.0) * 0.45,
                   1.0 + abs(u_tilt) * 0.55,
                   1.0 - max(-u_tilt, 0.0) * 0.45);
  vec3 decay = exp2(-vec3(u_dt) / max(halfLife * bias, vec3(1e-4)));

  fragColor = vec4(max(cur.rgb, prev * decay), cur.a);
}
