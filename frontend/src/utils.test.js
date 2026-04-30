import { describe, it, expect } from "vitest";
import { weatherInfo } from "./utils.js";

describe("weatherInfo", () => {
  it("kód 0 — jasno", () => {
    expect(weatherInfo(0)).toEqual({ icon: "☀️", label: "Jasno" });
  });

  it("kódy 1–3 — polojasno", () => {
    expect(weatherInfo(1).label).toBe("Polojasno");
    expect(weatherInfo(3).label).toBe("Polojasno");
  });

  it("kódy 4–48 — hmla", () => {
    expect(weatherInfo(4).label).toBe("Hmla");
    expect(weatherInfo(48).label).toBe("Hmla");
  });

  it("kódy 49–55 — mrholenie", () => {
    expect(weatherInfo(51).label).toBe("Mrholenie");
    expect(weatherInfo(55).label).toBe("Mrholenie");
  });

  it("kódy 56–65 — dážď", () => {
    expect(weatherInfo(61).label).toBe("Dážď");
    expect(weatherInfo(65).label).toBe("Dážď");
  });

  it("kódy 66–77 — sneh", () => {
    expect(weatherInfo(71).label).toBe("Sneh");
    expect(weatherInfo(77).label).toBe("Sneh");
  });

  it("kódy 78–82 — prehánky", () => {
    expect(weatherInfo(80).label).toBe("Prehánky");
    expect(weatherInfo(82).label).toBe("Prehánky");
  });

  it("kódy 83–86 — snehové prehánky", () => {
    expect(weatherInfo(85).label).toBe("Snehové prehánky");
    expect(weatherInfo(86).label).toBe("Snehové prehánky");
  });

  it("kód 95+ — búrka", () => {
    expect(weatherInfo(95)).toEqual({ icon: "⛈️", label: "Búrka" });
    expect(weatherInfo(99).label).toBe("Búrka");
  });

  it("každý kód vracia objekt s icon a label", () => {
    [0, 1, 10, 51, 61, 71, 80, 85, 95].forEach(code => {
      const result = weatherInfo(code);
      expect(result).toHaveProperty("icon");
      expect(result).toHaveProperty("label");
      expect(typeof result.label).toBe("string");
    });
  });
});
