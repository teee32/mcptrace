# Security Policy

MCPTrace records MCP traffic, which can include prompts, file contents, tokens,
and other private data. Treat trace JSON, HTML reports, diffs, and replay logs as
sensitive unless you created them with the default redaction behavior and have
reviewed the output.

## Reporting a Vulnerability

Please report vulnerabilities privately through GitHub Security Advisories for
`teee32/mcp-flight-recorder`.

Do not attach raw traces or reports to public issues. If a reproduction requires
traffic data, prefer a redacted trace or a minimal synthetic fixture.
