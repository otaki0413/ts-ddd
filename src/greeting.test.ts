import { describe, expect, it } from "vitest";

import { createGreeting } from "./greeting.js";

describe("createGreeting", () => {
  it("creates a greeting for the given name", () => {
    expect(createGreeting("TypeScript")).toBe("Hello, TypeScript!");
  });
});
