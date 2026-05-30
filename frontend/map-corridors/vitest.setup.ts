// Global vitest setup — runs once before any test file. Loads jest-dom's
// custom matchers (toBeInTheDocument, toHaveClass, …) so RTL-based tests
// can use them without per-file imports. Mirrors photo-helper's setup.
import '@testing-library/jest-dom/vitest';
