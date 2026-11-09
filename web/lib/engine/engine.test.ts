import { describe, expect, it } from "vitest";
import { type DomainData, filmEntity, QMatrix } from "../data";
import { emptyState, type State } from "../store";
import { normTitle } from "../text";
import type { Film } from "../types";
import { nextCard } from "./active";
import { inverseSPD, sampleBeta, solveSPD } from "./linalg";
import { buildProfile } from "./profile";
import { ruleParse } from "./query";
import { recommend, scoreOne } from "./recommend";
import { DEFAULT_W, FEATURES, predict, sgdStep } from "./score";

// ------------------------------------------------------------------ fixtures
function rng(seed = 1) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

/** Two taste clusters (crime vs romance) in a tiny embedding space, int8-quantised like the real export. */
function world(n = 120, dim = 16): DomainData & { films: Film[] } {
  const r = rng(7);
  const crime = Array.from({ length: dim }, () => r() - 0.5);
  const romance = Array.from({ length: dim }, () => r() - 0.5);
  const films: Film[] = [];
  const q = new Int8Array(n * dim);
  const scale = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const isCrime = i % 2 === 0;
    const base = isCrime ? crime : romance;
    const v = base.map((b) => b + 0.15 * (r() - 0.5));
    const mx = Math.max(...v.map(Math.abs));
    scale[i] = mx / 127;
    v.forEach((x, j) => (q[i * dim + j] = Math.round(x / scale[i])));
    films.push({ id: i + 1, k: i % 4 < 2 ? "movie" : "tv", t: `Title ${i}`, y: 1990 + (i % 30), g: [isCrime ? "Crime" : "Drama"],
      kw: [isCrime ? "heist" : "love"], vc: 1000 - i * 5, pop: 50 - i / 3, rt: 90 + (i % 60), dir: [isCrime ? 1 : 2] });
  }
  const emb = new QMatrix(q, scale, dim);
  const entities = films.map(filmEntity);
  const norms = new Float32Array(n).map((_, i) => emb.norm(i));
  return { name: "films", label: "Films", entities, index: new Map(entities.map((e, i) => [e.key, i])), emb, norms,
    films, people: ["?", "Crime Director", "Romance Director"], collections: [], collectionOf: new Map(), cf: null, cfIndex: new Map() } as DomainData & { films: Film[] };
}

function withAnswers(answers: [number, "loved" | "liked" | "disliked" | "unknown"][]): State {
  const s = emptyState();
  s.settings.hideBlocked = false;
  answers.forEach(([i, action], k) => {
    const key = `films:${i + 1}`;
    s.feedback[key] = { key, domain: "films", action, at: k };
    s.history.push(s.feedback[key]);
  });
  return s;
}

// ------------------------------------------------------------------ tests
describe("linear algebra", () => {
  it("solves SPD systems and inverts", () => {
    const A = new Float64Array([4, 1, 1, 3]);
    const x = solveSPD(A, new Float64Array([1, 2]), 2);
    expect(4 * x[0] + x[1]).toBeCloseTo(1, 9);
    expect(x[0] + 3 * x[1]).toBeCloseTo(2, 9);
    const inv = inverseSPD(A, 2);
    expect(4 * inv[0] + 1 * inv[2]).toBeCloseTo(1, 9);
  });
  it("samples Beta with the right mean", () => {
    const r = rng(3);
    let m = 0;
    for (let i = 0; i < 4000; i++) m += sampleBeta(8, 2, r);
    expect(m / 4000).toBeCloseTo(0.8, 1);
  });
});

describe("int8 matrices", () => {
  it("dequantises to unit vectors with correct dot products", () => {
    const d = world(10, 8);
    const v = d.emb!.row(0);
    expect(Math.hypot(...v)).toBeCloseTo(1, 5);
    expect(d.emb!.dot(0, v) / d.norms[0]).toBeCloseTo(1, 4);
  });
});

describe("taste profile and ranking", () => {
  it("ranks the liked cluster first and explains it", () => {
    const d = world();
    const s = withAnswers([[0, "loved"], [2, "loved"], [4, "liked"], [1, "disliked"], [3, "disliked"]]);
    const p = buildProfile(d, s);
    expect(p.pos.length).toBe(3);
    expect(p.tagAff.get("crime")!).toBeGreaterThan(0);
    expect(p.tagAff.get("drama")!).toBeLessThan(0);
    const recs = recommend(d, s, { n: 10, explore: 0 });
    const crimeShare = recs.filter((r) => r.entity.film!.g![0] === "Crime").length / recs.length;
    expect(crimeShare).toBeGreaterThanOrEqual(0.8);
    expect(recs.every((r) => !s.feedback[r.entity.key])).toBe(true);
    expect(recs[0].why).toMatch(/Crime Director|Title|crime|tone/i);
  });

  it("predicts a higher match for the liked side", () => {
    const d = world();
    const s = withAnswers([[0, "loved"], [2, "loved"], [1, "disliked"]]);
    expect(scoreOne(d, s, 10).p).toBeGreaterThan(scoreOne(d, s, 11).p);
  });

  it("online learning moves the weights towards the answer", () => {
    const x = new Float32Array(FEATURES.length).fill(0.5);
    const before = predict(DEFAULT_W, x);
    let w = DEFAULT_W;
    for (let i = 0; i < 20; i++) w = sgdStep(w, x, 1, i);
    expect(predict(w, x)).toBeGreaterThan(before);
  });

  it("'no idea' answers carry no taste signal", () => {
    const d = world();
    const p = buildProfile(d, withAnswers([[0, "unknown"], [1, "unknown"]]));
    expect(p.anchors.length).toBe(0);
    expect(p.answered.size).toBe(2);
  });
});

describe("active learning deck", () => {
  it("never repeats an answered card and alternates films / series", () => {
    const d = world();
    const s = withAnswers([[0, "loved"], [1, "liked"]]); // both films
    const card = nextCard(d, s, new Set(), rng(5))!;
    expect(s.feedback[card.rec.entity.key]).toBeUndefined();
    expect(card.rec.entity.film!.k).toBe("tv");
  });

  it("explores the unvisited cluster early on", () => {
    const d = world();
    const s = withAnswers([[0, "loved"], [2, "loved"], [4, "liked"], [6, "loved"], [8, "liked"]]); // all crime
    let romance = 0;
    for (let i = 0; i < 10; i++) if (nextCard(d, s, new Set(), rng(i + 1))!.rec.entity.film!.g![0] === "Drama") romance++;
    expect(romance).toBeGreaterThanOrEqual(5);
  });
});

describe("text & query parsing", () => {
  it("normalises titles exactly like the Python pipeline", () => {
    expect(normTitle("L'Histoire de Souleymane")).toBe("histoire de souleymane");
    expect(normTitle("LOL : Qui rit sort !")).toBe("lol qui rit sort");
    expect(normTitle("I, Robot")).toBe("i robot");
    expect(normTitle("Rocky II")).toBe("rocky 2");
  });
  it("parses a natural-language request", () => {
    const it2 = ruleParse("like Fauda but funnier, under 2h, on Netflix");
    expect(it2.anchors).toEqual(["Fauda"]);
    expect(it2.mood).toBe("laugh");
    expect(it2.maxRuntime).toBe(120);
    expect(it2.platforms).toEqual(["Netflix"]);
    expect(ruleParse("une série coréenne après 2015").kind).toBe("tv");
    expect(ruleParse("une série coréenne après 2015").language).toBe("ko");
    expect(ruleParse("film under 95 min").maxRuntime).toBe(95);
  });
});
