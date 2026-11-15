import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// Remove the page drawn by each test so the next test starts clean
afterEach(() => cleanup());

// The test browser has no real canvas; our map layers check for this and simply draw nothing
HTMLCanvasElement.prototype.getContext = () => null;
