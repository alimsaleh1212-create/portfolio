/** "https://linkedin.com/in/x" becomes "linkedin.com/in/x". */
export function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}
