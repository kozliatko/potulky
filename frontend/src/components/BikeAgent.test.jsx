import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import BikeAgent from "./BikeAgent.jsx";

vi.stubGlobal("fetch", vi.fn());

describe("BikeAgent — základné UI", () => {
  it("zobrazí input a tlačidlo Hľadaj", () => {
    render(<BikeAgent />);
    expect(screen.getByPlaceholderText(/lokalitu/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /hľadaj/i })).toBeInTheDocument();
  });

  it("tlačidlo je vypnuté keď je input prázdny", () => {
    render(<BikeAgent />);
    expect(screen.getByRole("button", { name: /hľadaj/i })).toBeDisabled();
  });

  it("tlačidlo sa aktivuje po zadaní lokality", () => {
    render(<BikeAgent />);
    const input = screen.getByPlaceholderText(/lokalitu/i);
    fireEvent.change(input, { target: { value: "Banská Bystrica" } });
    expect(screen.getByRole("button", { name: /hľadaj/i })).not.toBeDisabled();
  });

  it("zobrazí idle stav s mapovou ikonou", () => {
    render(<BikeAgent />);
    expect(screen.getByText(/zadaj lokalitu/i)).toBeInTheDocument();
  });

  it("tlačidlo Nové hľadanie nie je viditeľné v idle stave", () => {
    render(<BikeAgent />);
    expect(screen.queryByText(/nové hľadanie/i)).not.toBeInTheDocument();
  });
});
