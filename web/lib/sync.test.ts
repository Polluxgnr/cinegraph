import { describe, expect, it } from "vitest";
import { emptyState, type Feedback, type State } from "./store";
import { merge } from "./sync";

const fb = (key: string, action: Feedback["action"], at: number): Feedback => ({ key, domain: "films", action, at });

function device(answers: Feedback[], updatedAt: number, extra: Partial<State> = {}): State {
  const s = emptyState();
  for (const f of answers) {
    s.feedback[f.key] = f;
    s.history.push(f);
  }
  return { ...s, updatedAt, ...extra };
}

describe("memory sync between devices", () => {
  it("keeps the swipes made on both the phone and the laptop", () => {
    const phone = device([fb("films:1", "loved", 100), fb("films:2", "never", 110)], 110);
    const laptop = device([fb("films:3", "liked", 50)], 50);
    const m = merge(laptop, phone);
    expect(Object.keys(m.feedback).sort()).toEqual(["films:1", "films:2", "films:3"]);
    expect(m.history.map((h) => h.key)).toEqual(["films:3", "films:1", "films:2"]); // ordered by time
  });

  it("lets the most recent answer win when both devices answered the same title", () => {
    const phone = device([fb("films:1", "disliked", 200)], 200);
    const laptop = device([fb("films:1", "loved", 100)], 100);
    expect(merge(laptop, phone).feedback["films:1"].action).toBe("disliked");
    expect(merge(phone, laptop).feedback["films:1"].action).toBe("disliked");
  });

  it("never duplicates history when the same memory is merged twice", () => {
    const a = device([fb("films:1", "loved", 100)], 100);
    const once = merge(a, a);
    expect(merge(once, a).history).toHaveLength(1);
  });

  it("keeps vault notes from both sides and this device's own settings", () => {
    const note = (id: string) => ({ id, title: id, tags: [], created: 1, kind: "link" }) as unknown as State["vault"][number];
    const phone = device([], 10, { vault: [note("a")] });
    const laptop = device([], 5, { vault: [note("b")] });
    laptop.settings = { ...laptop.settings, space: "music" };
    const m = merge(laptop, phone);
    expect(m.vault.map((v) => v.id).sort()).toEqual(["a", "b"]);
    expect(m.settings.space).toBe("music");
  });
});

describe("trip planning", () => {
  it("puts nearby spots on the same day and walks them in order", async () => {
    const { planDays } = await import("./spots");
    const west = [{ lat: 48.86, lon: 2.29 }, { lat: 48.861, lon: 2.295 }, { lat: 48.859, lon: 2.3 }];
    const east = [{ lat: 48.853, lon: 2.36 }, { lat: 48.855, lon: 2.365 }];
    const days = planDays([...west, ...east], 2);
    expect(days.map((d) => d.length)).toEqual([3, 2]);
    expect(new Set(days[0])).toEqual(new Set(west));
    expect(planDays([], 3)).toHaveLength(3);
  });
});

describe("deletions sync", () => {
  it("a list item removed on one device stays removed after merging", () => {
    const phone = device([], 200);
    phone.deleted = { "list:films:1": 150 };
    const laptop = device([], 100);
    laptop.lists["films:1"] = { key: "films:1", domain: "films", added: 50, status: "want" };
    expect(merge(laptop, phone).lists["films:1"]).toBeUndefined();
    expect(merge(phone, laptop).lists["films:1"]).toBeUndefined();
  });

  it("re-adding after the deletion wins", () => {
    const a = device([], 300);
    a.lists["films:1"] = { key: "films:1", domain: "films", added: 250, status: "want" };
    const b = device([], 200);
    b.deleted = { "list:films:1": 150 };
    expect(merge(b, a).lists["films:1"]?.added).toBe(250);
  });

  it("an undone answer doesn't come back from the other device", () => {
    const answered = device([fb("films:9", "loved", 100)], 100);
    const undone = device([], 120);
    undone.deleted = { "hist:films:9|100": 120 };
    const m = merge(answered, undone);
    expect(m.feedback["films:9"]).toBeUndefined();
    expect(m.history).toHaveLength(0);
  });

  it("keeps your own items from both devices", () => {
    const item = (id: string) => ({ id, domain: "brands", title: id, tags: [], created: 1, source: "manual" });
    const a = device([], 10, { custom: [item("brands:custom:a")] });
    const b = device([], 20, { custom: [item("brands:custom:b")] });
    expect(merge(a, b).custom.map((c) => c.id).sort()).toEqual(["brands:custom:a", "brands:custom:b"]);
  });
});
