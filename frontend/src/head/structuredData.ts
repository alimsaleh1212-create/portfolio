import type { Profile } from "../api/types";

/**
 * Ali as a schema.org Person. Only facts from the seeded profile: the name, the headline as
 * the job title and the three public links (the email address as `email`, LinkedIn and GitHub
 * as `sameAs`), plus the site's own address. No phone number, no location, nothing else.
 */
export function personData(profile: Profile, siteUrl: string): object {
  return {
    "@context": "https://schema.org",
    "@type": "Person",
    name: profile.name,
    jobTitle: profile.headline,
    url: siteUrl,
    email: `mailto:${profile.links.email}`,
    sameAs: [profile.links.linkedin, profile.links.github],
  };
}
