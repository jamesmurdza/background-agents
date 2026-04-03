// Catch-all route for repo URLs with branch: /:owner/:repo/:branch
// Branch names can contain slashes, so we use [...branch] to capture all segments
// This simply re-exports the Home component which handles URL parsing internally
export { default } from "@/app/page"
