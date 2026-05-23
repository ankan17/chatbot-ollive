import '@testing-library/jest-dom';

// jsdom: ResizeObserver not implemented — stub it out
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverStub;
