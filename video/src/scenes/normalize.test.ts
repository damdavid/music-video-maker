import { describe, expect, it } from "vitest";
import { legacyGender, resolveCharacter } from "./normalize";

const colors = { body: "#d9a37e", hair: "#2b1d14", top: "#c0392b", bottom: "#1f2a44", accent: "#f1c40f" };

describe("character gender", () => {
  it("uses the chosen gender over any guess", () => {
    expect(resolveCharacter({ id: "a", colors, gender: "male", hair: "long", outfit: "dress" }).gender).toBe("male");
    expect(resolveCharacter({ id: "a", colors, gender: "female", hair: "short", outfit: "tee" }).gender).toBe("female");
  });

  it("guesses for characters made before it was a choice", () => {
    expect(resolveCharacter({ id: "a", colors, hair: "long" }).gender).toBe("female");
    expect(resolveCharacter({ id: "a", colors, outfit: "dress" }).gender).toBe("female");
    expect(resolveCharacter({ id: "a", colors, hair: "hat", outfit: "coat" }).gender).toBe("male");
    expect(resolveCharacter({ id: "a", colors }).gender).toBe("male");
    expect(legacyGender("bun", "tee")).toBe("female");
  });
});
