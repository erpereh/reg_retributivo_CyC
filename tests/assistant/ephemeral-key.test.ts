import { describe, expect, test } from "vitest";
import { createEphemeralKeyVault } from "@/lib/assistant/providers/ephemeralKeyVault";

describe("EphemeralKeyVault", () => {
  test("exposes only closure operations and never serializes the key", async () => {
    const vault = createEphemeralKeyVault();
    expect(Object.keys(vault).sort()).toEqual(["clearKey", "setKey", "withKey"]);
    const scope = { profileId: "profile-a", endpoint: "https://a.example/v1" };
    vault.setKey(scope, "sk-ultra-private");
    expect(JSON.stringify(vault)).not.toContain("sk-ultra-private");
    await expect(vault.withKey(scope, async (key) => key?.slice(0, 2))).resolves.toBe("sk");
  });

  test("clears on demand and does not leak the key through callback errors", async () => {
    const vault = createEphemeralKeyVault();
    const scope = { profileId: "profile-a", endpoint: "https://a.example/v1" };
    vault.setKey(scope, "manual-private-value");
    const error = await vault.withKey(scope, () => { throw new Error("provider failed"); }).catch((caught) => caught);
    expect(JSON.stringify(error)).not.toContain("manual-private-value");
    vault.clearKey();
    await expect(vault.withKey(scope, async (key) => key)).resolves.toBeUndefined();
  });

  test("never exposes profile A key to profile B or to a changed endpoint", async () => {
    const vault = createEphemeralKeyVault();
    const profileA = { profileId: "profile-a", endpoint: "https://a.example/v1" };
    vault.setKey(profileA, "profile-a-secret");
    await expect(vault.withKey({ profileId: "profile-b", endpoint: "https://b.example/v1" }, async (key) => key)).resolves.toBeUndefined();
    await expect(vault.withKey({ profileId: "profile-a", endpoint: "https://changed.example/v1" }, async (key) => key)).resolves.toBeUndefined();
    await expect(vault.withKey(profileA, async (key) => key)).resolves.toBe("profile-a-secret");
  });
});
