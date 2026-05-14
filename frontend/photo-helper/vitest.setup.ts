// Global vitest setup — runs once before any test file. Loads jest-dom's
// custom matchers (toBeInTheDocument, toHaveTextContent, …) so RTL-based
// tests can use them without per-file imports.
import '@testing-library/jest-dom/vitest';
