import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import CycloAgent from "./CycloAgent.jsx";

vi.stubGlobal("fetch", vi.fn());

describe("CycloAgent — základné UI", () => {
  it("zobrazí input a tlačidlo Hľadaj", () => {
    render(<CycloAgent />);
    expect(screen.getByPlaceholderText(/lokalitu/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /hľadaj/i })).toBeInTheDocument();
  });

  it("tlačidlo je vypnuté keď je input prázdny", () => {
    render(<CycloAgent />);
    expect(screen.getByRole("button", { name: /hľadaj/i })).toBeDisabled();
  });

  it("tlačidlo sa aktivuje po zadaní lokality", () => {
    render(<CycloAgent />);
    const input = screen.getByPlaceholderText(/lokalitu/i);
    fireEvent.change(input, { target: { value: "Banská Bystrica" } });
    expect(screen.getByRole("button", { name: /hľadaj/i })).not.toBeDisabled();
  });

  it("zobrazí idle stav s mapovou ikonou", () => {
    render(<CycloAgent />);
    expect(screen.getByText(/zadaj lokalitu/i)).toBeInTheDocument();
  });

  it("tlačidlo Nové hľadanie nie je viditeľné v idle stave", () => {
    render(<CycloAgent />);
    expect(screen.queryByText(/nové hľadanie/i)).not.toBeInTheDocument();
  });
});
