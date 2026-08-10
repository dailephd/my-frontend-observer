# Security

## Current controls

The current scaffold performs no browser navigation, page capture, network
requests, target interaction, or observation artifact writing. Its only runtime
bin behavior is a not-implemented message with failure status. No browser/network
security boundary is therefore implemented as product behavior.

## Required v0.1 boundary

Project Description, Milestone 1, and ROADMAP require a conservative local-first,
credential-free, non-destructive browser/network boundary. The historical
greenfield scaffold plan proposed credential-free HTTP(S) loopback targets,
redirect/final-URL and subresource validation, blocked external requests,
blocked service workers, and no downloads. These remain v0.1 planning inputs,
not current controls.

v0.1 planning must explicitly address schemes, local/remote targets, redirects,
timeouts, certificate failures, downloads, popups, permissions, unexpected
navigation, sensitive content/output, cleanup, and target immutability before
implementation.
