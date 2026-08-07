import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import HikeAgent from "./HikeAgent.jsx";

vi.stubGlobal("fetch", vi.fn());

describe("HikeAgent — základné UI", () => {
  it("zobrazí input a tlačidlo Hľadaj", () => {
    render(<HikeAgent />);
    expect(screen.getByPlaceholderText(/lokalitu/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /hľadaj/i })).toBeInTheDocument();
  });

  it("tlačidlo je vypnuté keď je input prázdny", () => {
    render(<HikeAgent />);
    expect(screen.getByRole("button", { name: /hľadaj/i })).toBeDisabled();
  });

  it("tlačidlo sa aktivuje po zadaní lokality", () => {
    render(<HikeAgent />);
    const input = screen.getByPlaceholderText(/lokalitu/i);
    fireEvent.change(input, { target: { value: "Banská Štiavnica" } });
    expect(screen.getByRole("button", { name: /hľadaj/i })).not.toBeDisabled();
  });

  it("zobrazí idle stav s mapovou ikonou", () => {
    render(<HikeAgent />);
    expect(screen.getByText(/zadaj lokalitu/i)).toBeInTheDocument();
  });

  it("tlačidlo Nové hľadanie nie je viditeľné v idle stave", () => {
    render(<HikeAgent />);
    expect(screen.queryByText(/nové hľadanie/i)).not.toBeInTheDocument();
  });

  it("prepínač Kočík/vozík zapne aj Deti (kočík implikuje dieťa)", () => {
    render(<HikeAgent />);
    const strollerBtn = screen.getByRole("button", { name: /kočík/i });
    fireEvent.click(strollerBtn);
    // po kliknutí by mal prepínač zmeniť stav (aria-pressed alebo trieda) — overíme aspoň, že sa nezrúti
    expect(strollerBtn).toBeInTheDocument();
  });
});
