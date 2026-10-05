---
status: accepted
---

# Visitors stay anonymous and no third party sees them

The site records every Visit and its Progress, but a Visitor is never identified: no cookies, no stored raw IP addresses, only a daily-rotating hash to count unique Visits. We chose this so the site needs no consent banner and so the visit data is ours alone, accepting that a Visitor cannot be recognised across days.

## Consequences

- No third-party analytics service. Visits, Progress and Expeditions are recorded by our own backend.
- The Video CV is served from our own storage, not embedded from YouTube, because a YouTube embed loads Google's tracking on page load.
- Expeditions are recorded against the anonymous Visit and shown only as totals. There are no player names and no leaderboard.
- An Expedition's saved progress lives in the Visitor's own browser, not on the server.
- Contact messages are the one place personal details are stored, and only because the Visitor typed them in to be contacted.
- Visitor country is not recorded.
