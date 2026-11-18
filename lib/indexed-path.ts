export function isSafeIndexedPath(value: string) {
  if (!value || value.length > 500 || /[\u0000-\u001f\u007f]/.test(value)) return false;
  if (value.startsWith("/") || value.startsWith("\\") || value.includes("\\") || /^[a-zA-Z]:/.test(value)) return false;
  const segments = value.split("/");
  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
}

export function validateIndexedPath(value: string) {
  if (!isSafeIndexedPath(value)) throw new Error("file_path must be a safe relative indexed path.");
  return value;
}
