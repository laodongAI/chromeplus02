# Security & Privacy Overview

## Manifest Permissions Review
- Active Permissions: tabs, activeTab, scripting, storage, sidePanel.
- Host Permissions: broad multi-platform + AI APIs + localhost.

### Risks
| Permission | Potential Risk | Mitigation |
|------------|----------------|-----------|
| tabs/activeTab | Access to any active URL | Restrict logic to supported site domains; audit tab usage |
| scripting | Arbitrary code injection | Only inject vetted files (no dynamic eval) |
| storage | Sensitive data persistence | Avoid storing API keys in plain text (consider encryption) |
| sidePanel | UI surface exploitation minimal | Ensure no untrusted HTML injection |
| host_permissions (wide) | Over-permission flag during review | Justify each domain; remove unused (weibo/xiaohongshu if idle) |

## Data Handling
- API Keys: stored in `config.aiModels[].apiKey` (plain). Target: secure storage or user prompt each session.
- Analysis Output: saved via MCP to local path; no external transmission beyond chosen AI provider.
- Personal Data: page extraction limited to publicly visible metadata; no login/session data collected.

## CSP
Current: `extension_pages`: `script-src 'self'; object-src 'self'` (MV3 default).
Target: Maintain; Vue build must avoid inline scripts & enable hashed styles if needed.

## Threat Surfaces
| Surface | Threat | Control |
|---------|--------|---------|
| Content Script | DOM selector changes / breakage | Adapter abstraction + resilience fallback |
| AI Proxy | API abuse / key leakage | Separate provider module, avoid logging full key |
| MCP Service | Local file write misuse | Path normalization + user-controlled baseDir |
| SidePanel | XSS via dynamic HTML | Use Vue templating; escape analysis text if provider returns HTML |

## Proposed Enhancements
1. Introduce `permissionsAudit.ts` to diff used domains vs manifest host list.
2. Add `sanitizeHtml` utility before rendering AI output.
3. Implement environment flag to disable MCP in production build.
4. Use structured error codes (e.g., AI_TIMEOUT, PERMISSION_DENIED) to avoid leaking stack traces.
5. Add rate limit for AI requests (e.g., max N/minute) configurable.

## Privacy Principles
- Data Minimization: Only store necessary site metadata & analysis results.
- User Control: Allow user to disable specific site extraction & AI models.
- Transparency: Document in README `docs/security.md` changes & permission rationale.

## Open Items
- Evaluate storing API keys via `chrome.storage.session` or prompting each use.
- Consider encryption with user-provided passphrase (low priority).
- Decide retention policy for saved analysis files (auto-clean optional).
