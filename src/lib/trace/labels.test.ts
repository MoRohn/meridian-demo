import { describe, expect, it } from "vitest";
import { questionLabel } from "./labels";

describe("questionLabel", () => {
  it("uses the app's own labels for risk dimensions and compliance checks", () => {
    expect(questionLabel("liability_exposure")).toBe("Liability exposure");
    expect(questionLabel("missing_governing_law")).toBe("No governing law / jurisdiction clause");
    expect(questionLabel("auto_renewal_trap")).toBe("Auto-renewal without adequate notice");
  });
  it("makes any other id readable", () => {
    expect(questionLabel("contains_privileged_content")).toBe("Contains privileged content");
    expect(questionLabel("intent")).toBe("Intent");
    expect(questionLabel("is_injection_attempt")).toBe("Is injection attempt");
  });
  it("never returns an empty label", () => {
    expect(questionLabel("")).toBe("");
    expect(questionLabel("___")).toBe("___");
  });
});
