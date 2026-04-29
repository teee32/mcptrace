import { RiskFlag, RiskSeverity } from "./types.js";

interface RiskRule {
  code: string;
  severity: RiskSeverity;
  pattern: RegExp;
  message: (match: string) => string;
}

const RULES: RiskRule[] = [
  // Sensitive files
  {
    code: "sensitive_file",
    severity: "high",
    pattern: /(^|[\s"'/=:,(\\])(\.env(\.[a-z0-9_-]+)?)(\b|$)/i,
    message: (m) => `Accessed possible sensitive file: ${m.trim()}`,
  },
  {
    code: "sensitive_file",
    severity: "high",
    pattern: /\b(id_rsa|id_ed25519|id_ecdsa|id_dsa)\b/,
    message: (m) => `Accessed possible SSH private key: ${m}`,
  },
  {
    code: "sensitive_file",
    severity: "high",
    pattern: /\bprivate_key\b/i,
    message: () => "Reference to private_key",
  },
  {
    code: "sensitive_file",
    severity: "high",
    pattern: /\bcredentials?\b/i,
    message: () => "Reference to credentials",
  },
  {
    code: "sensitive_file",
    severity: "high",
    pattern: /\bsecrets?\b/i,
    message: () => "Reference to secrets",
  },
  {
    code: "sensitive_file",
    severity: "high",
    pattern: /\.npmrc\b/i,
    message: () => "Accessed possible sensitive file: .npmrc",
  },
  {
    code: "sensitive_file",
    severity: "high",
    pattern: /\.pypirc\b/i,
    message: () => "Accessed possible sensitive file: .pypirc",
  },

  // Dangerous shell
  {
    code: "dangerous_shell",
    severity: "high",
    pattern: /\brm\s+-rf?\b/i,
    message: () => "Detected destructive shell command: rm -rf",
  },
  {
    code: "dangerous_shell",
    severity: "high",
    pattern: /\bcurl\b[^|]*\|\s*(bash|sh|zsh)\b/i,
    message: () => "Detected pipe-to-shell pattern: curl | bash",
  },
  {
    code: "dangerous_shell",
    severity: "high",
    pattern: /\bwget\b[^|]*\|\s*(bash|sh|zsh)\b/i,
    message: () => "Detected pipe-to-shell pattern: wget | sh",
  },
  {
    code: "dangerous_shell",
    severity: "medium",
    pattern: /\bchmod\s+777\b/,
    message: () => "Detected overly-permissive chmod 777",
  },
  {
    code: "dangerous_shell",
    severity: "medium",
    pattern: /\bsudo\b/,
    message: () => "Detected sudo invocation",
  },

  // Database
  {
    code: "dangerous_sql",
    severity: "high",
    pattern: /\bDROP\s+TABLE\b/i,
    message: () => "Detected SQL: DROP TABLE",
  },
  {
    code: "dangerous_sql",
    severity: "high",
    pattern: /\bDELETE\s+FROM\b/i,
    message: () => "Detected SQL: DELETE FROM",
  },
  {
    code: "dangerous_sql",
    severity: "high",
    pattern: /\bTRUNCATE\b/i,
    message: () => "Detected SQL: TRUNCATE",
  },
  {
    code: "sensitive_sql",
    severity: "medium",
    pattern: /\bSELECT\s+\*\s+FROM\s+users\b/i,
    message: () => "Detected SQL: SELECT * FROM users",
  },

  // Dependency / config changes
  {
    code: "dependency_change",
    severity: "medium",
    pattern: /\bpackage\.json\b/,
    message: () => "Touched package.json",
  },
  {
    code: "dependency_change",
    severity: "medium",
    pattern: /\bpackage-lock\.json\b/,
    message: () => "Touched package-lock.json",
  },
  {
    code: "dependency_change",
    severity: "medium",
    pattern: /\bpnpm-lock\.yaml\b/,
    message: () => "Touched pnpm-lock.yaml",
  },
  {
    code: "dependency_change",
    severity: "medium",
    pattern: /\byarn\.lock\b/,
    message: () => "Touched yarn.lock",
  },
  {
    code: "dependency_change",
    severity: "medium",
    pattern: /\bpyproject\.toml\b/,
    message: () => "Touched pyproject.toml",
  },
  {
    code: "dependency_change",
    severity: "medium",
    pattern: /\brequirements\.txt\b/,
    message: () => "Touched requirements.txt",
  },

  // Outbound network
  {
    code: "network_egress",
    severity: "low",
    pattern: /\bhttps?:\/\/[^\s"']+/i,
    message: (m) => `Outbound URL referenced: ${m}`,
  },
  {
    code: "network_egress",
    severity: "low",
    pattern: /(^|\s|"|')curl(\s|"|'|$)/,
    message: () => "curl referenced",
  },
  {
    code: "network_egress",
    severity: "low",
    pattern: /(^|\s|"|')wget(\s|"|'|$)/,
    message: () => "wget referenced",
  },
];

/**
 * Scan a JSON-like value for known risk patterns.
 *
 * Each rule fires at most once per scan to avoid noisy reports.
 */
export function detectRisks(value: unknown): RiskFlag[] {
  if (value === undefined || value === null) return [];
  let text: string;
  try {
    text = typeof value === "string" ? value : JSON.stringify(value);
  } catch {
    return [];
  }
  if (!text) return [];

  const flags: RiskFlag[] = [];
  const seen = new Set<string>();

  for (const rule of RULES) {
    const match = text.match(rule.pattern);
    if (!match) continue;
    const sample = (match[0] || "").slice(0, 120);
    const key = `${rule.code}:${sample}`;
    if (seen.has(key)) continue;
    seen.add(key);
    flags.push({
      code: rule.code,
      severity: rule.severity,
      message: rule.message(sample),
    });
  }

  return flags;
}

export function mergeRiskFlags(...lists: RiskFlag[][]): RiskFlag[] {
  const out: RiskFlag[] = [];
  const seen = new Set<string>();
  for (const list of lists) {
    for (const f of list) {
      const key = `${f.code}:${f.message}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(f);
    }
  }
  return out;
}
