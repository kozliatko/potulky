import { describe, it, expect } from "vitest";
import { calcCost, extractFirstJSON } from "./shared.jsx";

describe("calcCost", () => {
  it("vracia null bez usage", () => {
    expect(calcCost(null)).toBeNull();
    expect(calcCost(undefined)).toBeNull();
  });

  it("počíta cenu z input/output tokenov a počtu vyhľadávaní", () => {
    const cost = calcCost({ inputTokens: 1_000_000, outputTokens: 1_000_000, searchCount: 10 });
    expect(cost).toBeCloseTo(0.27 + 1.10 + 0.10, 5);
  });

  it("nulové usage vracia nulovú cenu", () => {
    expect(calcCost({ inputTokens: 0, outputTokens: 0, searchCount: 0 })).toBe(0);
  });
});

describe("extractFirstJSON", () => {
  it("extrahuje čistý JSON objekt", () => {
    const str = '{"a":1,"b":2}';
    expect(extractFirstJSON(str)).toBe(str);
  });

  it("extrahuje JSON aj keď je obalený textom pred/za", () => {
    const json = '{"summary":"test","routes":[]}';
    expect(extractFirstJSON(`Tu je odpoveď:\n${json}\nDúfam že pomôže.`)).toBe(json);
  });

  it("správne spracuje vnorené zložené zátvorky", () => {
    const json = '{"a":{"b":{"c":1}},"d":2}';
    expect(extractFirstJSON(json)).toBe(json);
  });

  it("ignoruje zložené zátvorky vo vnútri reťazcov", () => {
    const json = '{"text":"obsahuje } zátvorku"}';
    expect(extractFirstJSON(json)).toBe(json);
  });

  it("správne spracuje escapované úvodzovky v reťazcoch", () => {
    const json = '{"text":"má \\"úvodzovky\\" vo vnútri"}';
    expect(extractFirstJSON(json)).toBe(json);
  });

  it("vracia null keď reťazec neobsahuje žiadnu zloženú zátvorku", () => {
    expect(extractFirstJSON("žiadny JSON tu")).toBeNull();
  });

  it("vracia null pri nezavretej zloženej zátvorke", () => {
    expect(extractFirstJSON('{"a":1')).toBeNull();
  });

  it("extrahuje len PRVÝ kompletný JSON objekt, ignoruje ďalšie", () => {
    const first = '{"a":1}';
    expect(extractFirstJSON(`${first} a potom {"b":2}`)).toBe(first);
  });
});
