import type { Children } from "@b9g/crank";

export function Spinner() {
  return <span class="spinner" aria-hidden="true" />;
}

export function LoadingState({ children }: { children?: Children }) {
  return (
    <p class="empty-state" role="status">
      <Spinner />
      {children}
    </p>
  );
}
