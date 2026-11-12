import { CheckCircle, WarningCircle } from "@phosphor-icons/react/dist/ssr";

export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="error-text" role="alert">
      <WarningCircle size={20} aria-hidden="true" style={{ flex: "none" }} />
      {message}
    </p>
  );
}

export function FormSuccess({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="success-text" role="status">
      <CheckCircle size={20} aria-hidden="true" style={{ flex: "none" }} />
      {message}
    </p>
  );
}
