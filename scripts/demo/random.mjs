// Deterministic pseudo-random numbers: the same seed anchor always produces the same demo data.

function hashString(value) {
  let h = 1779033703 ^ value.length;
  for (let i = 0; i < value.length; i += 1) {
    h = Math.imul(h ^ value.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return h >>> 0;
}

export function createRandom(seedText) {
  let state = hashString(seedText);

  // mulberry32
  function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  const random = {
    next,
    chance: (probability) => next() < probability,
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    float: (min, max) => min + next() * (max - min),
    pick: (items) => items[Math.floor(next() * items.length)],
    // weights: [[value, weight], ...]
    weighted(weights) {
      const total = weights.reduce((sum, [, weight]) => sum + weight, 0);
      let roll = next() * total;
      for (const [value, weight] of weights) {
        roll -= weight;
        if (roll < 0) return value;
      }
      return weights[weights.length - 1][0];
    },
    uuid() {
      const hex = Array.from({ length: 32 }, () => Math.floor(next() * 16).toString(16));
      hex[12] = "4";
      hex[16] = ((parseInt(hex[16], 16) & 0x3) | 0x8).toString(16);
      const s = hex.join("");
      return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
    },
  };
  return random;
}
