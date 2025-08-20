
#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Instagram Prod Readiness Audit
Usage:
  python audit_instagram_prod_readiness.py /path/to/your/project

Outputs:
  - console summary
  - audit_report.json
  - audit_report.md
"""

import sys, json, re, os
from pathlib import Path
from typing import List, Dict, Any, Tuple

REQ_ENVS = [
    "META_APP_ID", "IG_APP_SECRET", "GRAPH_API_VERSION", "API_BASE_URL",
    "ENCRYPTION_KEY", "DATABASE_URL", "REDIS_URL", "OPENAI_API_KEY", "PORT",
    "IG_VERIFY_TOKEN", "REDIRECT_URI"
]

TEXT_EXTS = {".ts", ".tsx", ".js", ".jsx", ".json", ".yml", ".yaml", ".env", ".md", ".toml", ".sql", ".conf", ".dockerfile"}
ENV_LIKE = {".env", ".env.example", ".env.production", ".env.prod", ".env.sample"}

def read_text_safe(p: Path) -> str:
    try:
        return p.read_text(encoding="utf-8", errors="ignore")
    except Exception:
        try:
            return p.read_text(encoding="latin-1", errors="ignore")
        except Exception:
            return ""

def glob_files(root: Path, patterns: List[str]) -> List[Path]:
    out = []
    for pat in patterns:
        out.extend(root.rglob(pat))
    return out

def find_any(root: Path, names: List[str]) -> List[Path]:
    res = []
    for p in root.rglob("*"):
        if p.is_file() and p.name in names:
            res.append(p)
    return res

def summarize_ports(root: Path) -> Dict[str, Any]:
    ports = {"env": set(), "dockerfile": set(), "compose": set(), "health_targets": set(), "code": set()}
    # env files
    for p in find_any(root, [".env", ".env.production", ".env.example", ".env.sample"]):
        t = read_text_safe(p)
        for m in re.finditer(r"^\s*PORT\s*=\s*([0-9]+)", t, flags=re.M):
            ports["env"].add(m.group(1))

    # Dockerfile
    for p in list(root.rglob("Dockerfile")):
        t = read_text_safe(p)
        for m in re.finditer(r"EXPOSE\s+([0-9]+)", t):
            ports["dockerfile"].add(m.group(1))

    # docker-compose
    for p in list(root.rglob("docker-compose*.yml")) + list(root.rglob("docker-compose*.yaml")):
        t = read_text_safe(p)
        for m in re.finditer(r"ports:\s*\[([^\]]+)\]", t, flags=re.S):
            for pair in m.group(1).split(","):
                s = pair.strip().strip('"').strip("'")
                if ":" in s:
                    host, cont = s.split(":", 1)
                    ports["compose"].add(cont)
        for m in re.finditer(r"healthcheck:[\s\S]*?curl[^\n]*?http[s]?://[^\n]+?:(\d+)/health", t, flags=re.I):
            ports["health_targets"].add(m.group(1))

    # common code port usage
    for p in glob_files(root, ["*.ts", "*.js"]):
        t = read_text_safe(p)
        for m in re.finditer(r"process\.env\.PORT\s*\|\|\s*([0-9]+)", t):
            ports["code"].add(m.group(1))
        for m in re.finditer(r"\.listen\(\s*([0-9]{2,5})", t):
            ports["code"].add(m.group(1))
    return {k: sorted(v) for k, v in ports.items()}

def scan_env_validation(root: Path) -> Dict[str, Any]:
    res = {"file": None, "missing_checks": [], "placeholders_leaking": []}
    candidates = list(root.rglob("startup/validation.ts")) + list(root.rglob("config/environment.ts"))
    if not candidates:
        return {"file": None, "error": "validation file not found"}
    t = read_text_safe(candidates[0])
    res["file"] = str(candidates[0])
    for key in REQ_ENVS:
        if not re.search(rf"{key}", t):
            res["missing_checks"].append(key)
    # placeholder detection
    placeholder_patterns = [
        r"sk-your_", r"your_jwt_secret_here", r"your_instagram_app_id_here",
        r"ENCRYPTION_KEY=.*(key_here|1234)"
    ]
    env_files = [*find_any(root, [".env.example", ".env.sample"])]
    for ef in env_files:
        et = read_text_safe(ef)
        for pat in placeholder_patterns:
            if re.search(pat, et):
                res["placeholders_leaking"].append(f"{ef.name}:{pat}")
    return res

def search_patterns(root: Path, patterns: Dict[str, List[str]]) -> Dict[str, List[str]]:
    hits = {k: [] for k in patterns}
    for p in glob_files(root, ["*.ts", "*.js", "*.sql", "*.yml", "*.yaml"]):
        t = read_text_safe(p)
        for key, regs in patterns.items():
            for rx in regs:
                if re.search(rx, t, flags=re.I|re.M):
                    hits[key].append(str(p))
                    break
    return hits

def check_pkce(root: Path) -> Dict[str, Any]:
    pats = {
        "has_pkce_terms": [r"code_verifier", r"pkce"],
        "stores_in_redis": [r"pkce:.*state", r"setex|setEx\("],
        "callback_reads_verifier": [r"/callback", r"code_verifier", r"redis\.get"],
        "deletes_after_use": [r"redis\.(del|unlink)\("]
    }
    hits = search_patterns(root, pats)
    ok = all(hits[k] for k in hits)
    return {"ok": ok, "hits": hits}

def check_idempotency(root: Path) -> Dict[str, Any]:
    pats = {
        "hash_merchant_and_body": [r"createHash\(['\"]sha256['\"]\).*?update\(.+merchant.*raw", r"sha256\(.+merchant_id.+rawBody"],
        "db_unique": [r"UNIQUE\s*\(\s*merchant_id\s*,\s*event_id\s*\)", r"ADD CONSTRAINT .* UNIQUE .*merchant_id.*event_id"]
    }
    hits = search_patterns(root, pats)
    ok = bool(hits["hash_merchant_and_body"] or hits["db_unique"])
    return {"ok": ok, "hits": hits}

def check_redis_required(root: Path) -> Dict[str, Any]:
    pats = {
        "env_required": [r"REDIS_URL", r"throw new Error\(.+REDIS_URL.+required"],
        "fail_on_end": [r"redis\.on\(['\"]end['\"].+process\.exit"],
        "rediss_tls": [r"rediss://"]
    }
    hits = search_patterns(root, pats)
    ok = bool(hits["env_required"])  # minimal requirement
    return {"ok": ok, "hits": hits}

def check_rate_limiter(root: Path) -> Dict[str, Any]:
    pats = {
        "redis_window": [r"rl:.*merchant.*endpoint.*\d+", r"redis\.incr\(", r"redis\.expire\("],
    }
    hits = search_patterns(root, pats)
    ok = bool(hits["redis_window"])
    return {"ok": ok, "hits": hits}

def check_retry_backoff(root: Path) -> Dict[str, Any]:
    pats = {
        "handles_429_5xx": [r"429", r"502", r"503", r"504"],
        "exponential_backoff": [r"2\s*\*\*\s*i", r"exponential", r"backoff"],
        "jitter": [r"Math\.random\(\)"]
    }
    hits = search_patterns(root, pats)
    ok = bool(hits["handles_429_5xx"] and (hits["exponential_backoff"] or hits["jitter"]))
    return {"ok": ok, "hits": hits}

def check_dlq(root: Path) -> Dict[str, Any]:
    pats = {
        "queue_failed_handler": [r"\.on\(['\"]failed['\"]"],
        "push_dlq": [r"dlq", r"redis\.(lpush|rpush)\("]
    }
    hits = search_patterns(root, pats)
    ok = bool(hits["queue_failed_handler"] and hits["push_dlq"])
    return {"ok": ok, "hits": hits}

def check_token_renewal(root: Path) -> Dict[str, Any]:
    pats = {
        "renew_long_lived": [r"renew", r"long.*lived", r"refresh.*token"],
    }
    hits = search_patterns(root, pats)
    ok = bool(hits["renew_long_lived"])
    return {"ok": ok, "hits": hits}

def check_rls(root: Path) -> Dict[str, Any]:
    pats = {
        "policies": [r"CREATE POLICY", r"ALTER TABLE .* ENABLE ROW LEVEL SECURITY"],
        "context_fn": [r"set_merchant_context\(", r"current_merchant_id\("]
    }
    hits = search_patterns(root, pats)
    ok = bool(hits["policies"]) and bool(hits["context_fn"])
    return {"ok": ok, "hits": hits}

def check_mapping_table(root: Path) -> Dict[str, Any]:
    pats = {
        "composite_pk": [r"PRIMARY KEY\s*\(\s*merchant_id\s*,\s*instagram_page_id\s*\)"],
        "encrypted_token": [r"page_access_token_enc", r"encryp"]
    }
    hits = search_patterns(root, pats)
    ok = bool(hits["composite_pk"] and hits["encrypted_token"])
    return {"ok": ok, "hits": hits}

def check_hmac_rawbody(root: Path) -> Dict[str, Any]:
    pats = {
        "header_check": [r"X-Hub-Signature-256", r"x-hub-signature-256"],
        "raw_body_used": [r"rawBody", r"getRawBody", r"req\.raw"],
        "timing_safe_equal": [r"timingSafeEqual", r"crypto\.timingSafeEqual"]
    }
    hits = search_patterns(root, pats)
    ok = bool(hits["header_check"] and hits["raw_body_used"] and hits["timing_safe_equal"])
    return {"ok": ok, "hits": hits}

def check_openai_hardening(root: Path) -> Dict[str, Any]:
    pats = {
        "timeout": [r"timeout\s*:\s*\d+"],
        "json_parse_guard": [r"JSON\.parse\([^\)]*\)", r"try", r"catch"],
        "input_cap": [r"2KB|2048|<=\s*2000"]
    }
    hits = search_patterns(root, pats)
    ok = bool(hits["timeout"]) and bool(hits["json_parse_guard"])
    return {"ok": ok, "hits": hits}

def check_media_validation(root: Path) -> Dict[str, Any]:
    pats = {
        "size_type_checks": [r"mime", r"content[-_ ]type", r"file.*size", r"MB", r"8MB|10MB|1048576"]
    }
    hits = search_patterns(root, pats)
    ok = bool(hits["size_type_checks"])
    return {"ok": ok, "hits": hits}

def check_docker_multistage(root: Path) -> Dict[str, Any]:
    pats = {
        "has_build_stage": [r"FROM\s+node:.*AS\s+build"],
        "runtime_stage": [r"FROM\s+node:.*\n", r"EXPOSE\s+[0-9]+"],
    }
    hits = search_patterns(root, pats)
    ok = bool(hits["has_build_stage"] and hits["runtime_stage"])
    return {"ok": ok, "hits": hits}

def check_compose_ports(root: Path) -> Dict[str, Any]:
    targets = []
    for p in list(root.rglob("docker-compose*.yml")) + list(root.rglob("docker-compose*.yaml")):
        t = read_text_safe(p)
        for m in re.finditer(r"ports:\s*\[([^\]]+)\]", t, flags=re.S):
            for pair in m.group(1).split(","):
                pair = pair.strip().strip('"').strip("'")
                if ":" in pair:
                    host, cont = pair.split(":", 1)
                    targets.append((str(p), host, cont))
        # healthcheck urls
    return {"ports": targets}

def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: python audit_instagram_prod_readiness.py /path/to/project")
        return 2
    root = Path(sys.argv[1]).resolve()
    if not root.exists():
        print(f"Path not found: {root}")
        return 2

    report = {}
    report["ports_summary"] = summarize_ports(root)
    report["env_validation"] = scan_env_validation(root)
    report["pkce"] = check_pkce(root)
    report["idempotency"] = check_idempotency(root)
    report["redis_required"] = check_redis_required(root)
    report["rate_limiter"] = check_rate_limiter(root)
    report["retry_backoff"] = check_retry_backoff(root)
    report["dlq"] = check_dlq(root)
    report["token_renewal"] = check_token_renewal(root)
    report["rls"] = check_rls(root)
    report["mapping_table"] = check_mapping_table(root)
    report["hmac_rawbody"] = check_hmac_rawbody(root)
    report["openai_hardening"] = check_openai_hardening(root)
    report["media_validation"] = check_media_validation(root)
    report["docker_multistage"] = check_docker_multistage(root)
    report["compose_ports"] = check_compose_ports(root)

    # Score
    checks = ["pkce","idempotency","redis_required","rate_limiter","retry_backoff","dlq","token_renewal","rls","mapping_table","hmac_rawbody","openai_hardening","media_validation","docker_multistage"]
    score = sum(1 for c in checks if report.get(c,{}).get("ok"))
    report["score"] = {"passed": score, "total": len(checks)}

    # Save JSON
    (root / "audit_report.json").write_text(json.dumps(report, indent=2, ensure_ascii=False), encoding="utf-8")

    # Save Markdown
    md_lines = ["# Instagram Prod Readiness Audit\n"]
    md_lines.append(f"**Score:** {score}/{len(checks)} checks passed.\n")
    def add_section(name, data):
        ok = data.get("ok", False)
        md_lines.append(f"## {name} — {'✅ PASS' if ok else '❌ FAIL'}")
        for k,v in data.items():
            if k == "ok": continue
            md_lines.append(f"- **{k}**: {v}")
        md_lines.append("")
    add_section("Ports summary", {"ok": True, **report["ports_summary"]})
    add_section("Env validation", {"ok": "error" not in report["env_validation"] and not report['env_validation'].get("missing_checks"), **report["env_validation"]})
    for c in checks:
        add_section(c.upper(), report[c])
    (root / "audit_report.md").write_text("\n".join(md_lines), encoding="utf-8")

    # Console summary
    print(json.dumps(report["score"], ensure_ascii=False))
    print("Wrote:", root / "audit_report.json")
    print("Wrote:", root / "audit_report.md")
    return 0

if __name__ == "__main__":
    sys.exit(main())
