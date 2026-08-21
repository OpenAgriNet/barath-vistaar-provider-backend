import { AifSessionStore } from "./aif-session.store";

describe("AifSessionStore", () => {
  let store: AifSessionStore;

  const session = {
    token: "tok",
    beneficiaryId: "106545",
    expiresIn: 3600,
  };

  beforeEach(() => {
    jest.useFakeTimers();
    store = new AifSessionStore();
  });

  afterEach(() => jest.useRealTimers());

  it("returns a session that is still valid", () => {
    store.set("txn-1", session);

    expect(store.get("txn-1")).toMatchObject({
      token: "tok",
      beneficiaryId: "106545",
    });
  });

  it("returns undefined for an unknown transaction", () => {
    expect(store.get("nope")).toBeUndefined();
  });

  it("expires the session once the AIF token lifetime has passed", () => {
    store.set("txn-1", session);

    jest.advanceTimersByTime(3600 * 1000);

    expect(store.get("txn-1")).toBeUndefined();
  });

  it("expires one minute early, so a token cannot lapse mid-call", () => {
    store.set("txn-1", session);

    // 59s before the real expiry the safety margin has already kicked in.
    jest.advanceTimersByTime((3600 - 59) * 1000);

    expect(store.get("txn-1")).toBeUndefined();
  });

  it("keeps the session just before the safety margin", () => {
    store.set("txn-1", session);

    jest.advanceTimersByTime((3600 - 61) * 1000);

    expect(store.get("txn-1")).toBeDefined();
  });

  it("drops expired sessions on prune so the map cannot grow unbounded", () => {
    store.set("old", session);
    jest.advanceTimersByTime(3600 * 1000);
    store.set("fresh", session);

    store.prune();

    expect((store as any).sessions.has("old")).toBe(false);
    expect((store as any).sessions.has("fresh")).toBe(true);
  });
});
