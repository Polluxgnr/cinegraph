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
