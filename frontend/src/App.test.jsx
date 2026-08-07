import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import App from "./App.jsx";

vi.stubGlobal("fetch", vi.fn());

beforeEach(() => {
  localStorage.clear();
});

describe("App — prepínač módov", () => {
  it("predvolene zobrazí Cyklistika (BikeAgent)", () => {
    render(<App />);
    expect(screen.getByText("🚴‍♀️")).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/Banská Bystrica/i)).toBeInTheDocument();
  });

  it("prepne na Turistika (HikeAgent) po kliku", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /turistika/i }));
    expect(screen.getByPlaceholderText(/Banská Štiavnica/i)).toBeInTheDocument();
  });

  it("uloží zvolený mód do localStorage", () => {
    render(<App />);
    fireEvent.click(screen.getByRole("button", { name: /turistika/i }));
    expect(localStorage.getItem("app-mode")).toBe("hike");
  });

  it("obnoví posledný zvolený mód z localStorage pri novom načítaní", () => {
    localStorage.setItem("app-mode", "hike");
    render(<App />);
    expect(screen.getByPlaceholderText(/Banská Štiavnica/i)).toBeInTheDocument();
  });
});
