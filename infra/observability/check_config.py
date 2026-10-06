"""Static checks of the observability profile. They need no running stack.

Run from the repository root:
    uv run --project backend python infra/observability/check_config.py

Checks:
- the Compose file is valid with the profile on and off, the profile adds
  services, every one of them pins an image version and has a memory limit,
  and only Grafana is published, on localhost;
- every provisioning, Prometheus, Loki, Tempo and Alloy file parses;
- every dashboard parses, and every panel, query and variable refers to a data
  source that provisioning creates, of the right type;
- every query on the Visits and Progress dashboard follows its time range.
"""

import json
import subprocess
import sys
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parents[2]
OBS = ROOT / "infra" / "observability"
PROFILE = "observability"
VISITS_DASHBOARD = "visits-progress"

errors: list[str] = []


def fail(message: str) -> None:
    """Record a problem."""
    errors.append(message)


def compose_config(*extra: str) -> dict[str, Any]:
    """Return the resolved Compose model as a dict."""
    command = ["docker", "compose", "--env-file", ".env.example", *extra]
    result = subprocess.run(  # noqa: S603
        [*command, "config", "--format", "json"],
        cwd=ROOT,
        capture_output=True,
        text=True,
        check=False,
    )
    if result.returncode != 0:
        fail(f"docker compose {' '.join(extra)} config failed:\n{result.stderr}")
        return {"services": {}}
    return json.loads(result.stdout)


def check_compose() -> None:
    """Validate the Compose file with the profile off and on."""
    off = compose_config()["services"]
    on = compose_config("--profile", PROFILE)["services"]
    added = sorted(set(on) - set(off))
    expected = {"prometheus", "loki", "tempo", "collector", "grafana", "grafana-setup"}
    if not expected <= set(added):
        fail(f"profile should add {sorted(expected)}, adds {added}")
    for name in added:
        service = on[name]
        image = service.get("image", "")
        tag = image.rsplit(":", 1)[-1] if ":" in image.split("/")[-1] else ""
        if not tag or tag == "latest":
            fail(f"{name}: image {image!r} is not pinned to a version")
        if not service.get("mem_limit"):
            fail(f"{name}: no memory limit")
        for port in service.get("ports", []):
            if name != "grafana" or port.get("host_ip") != "127.0.0.1":
                fail(f"{name}: publishes a port beyond Grafana on localhost: {port}")
    if "ports" in on.get("caddy", {}) and len(on["caddy"]["ports"]) != 1:
        fail("caddy must stay the only other published service")
    grafana_env = on.get("grafana", {}).get("environment", {})
    if grafana_env.get("GF_AUTH_ANONYMOUS_ENABLED") != "false":
        fail("grafana: anonymous access must be off")
    if grafana_env.get("GF_USERS_ALLOW_SIGN_UP") != "false":
        fail("grafana: sign-up must be off")
    if "grafana-setup" not in on.get("grafana", {}).get("depends_on", {}):
        fail("grafana must wait for grafana-setup, which checks the passwords")
    api_env = off.get("api", {}).get("environment", {})
    if api_env.get("OTEL_EXPORTER_OTLP_ENDPOINT") not in ("", None):
        fail("with the profile off, the API must have no trace endpoint")


def load_yaml(path: Path) -> Any:
    """Parse a YAML file, recording a failure instead of raising."""
    try:
        return yaml.safe_load(path.read_text())
    except yaml.YAMLError as exc:
        fail(f"{path.relative_to(ROOT)}: not valid YAML: {exc}")
        return None


def check_config_files() -> dict[str, str]:
    """Parse the service configs; return {data source uid: type}."""
    for relative in (
        "prometheus/prometheus.yml",
        "loki/loki.yaml",
        "tempo/tempo.yaml",
        "grafana/provisioning/dashboards/dashboards.yaml",
    ):
        if not (OBS / relative).is_file() or load_yaml(OBS / relative) is None:
            fail(f"{relative}: missing or empty")
    if not (OBS / "alloy" / "config.alloy").read_text().strip():
        fail("alloy/config.alloy is empty")
    sources = load_yaml(OBS / "grafana/provisioning/datasources/datasources.yaml")
    uids: dict[str, str] = {}
    for source in (sources or {}).get("datasources", []):
        uids[source["uid"]] = source["type"]
    for needed in ("prometheus", "loki", "tempo", "postgres"):
        if needed not in uids:
            fail(f"data source {needed!r} is not provisioned")
    return uids


def datasource_refs(node: Any, path: str = "") -> list[tuple[str, dict[str, Any]]]:
    """Find every `datasource` object in a dashboard, with where it was found."""
    found: list[tuple[str, dict[str, Any]]] = []
    if isinstance(node, dict):
        for key, value in node.items():
            here = f"{path}/{key}"
            if key == "datasource":
                found.append((here, value))
            else:
                found.extend(datasource_refs(value, here))
    elif isinstance(node, list):
        for index, value in enumerate(node):
            found.extend(datasource_refs(value, f"{path}[{index}]"))
    return found


def all_panels(dashboard: dict[str, Any]) -> list[dict[str, Any]]:
    """Return the dashboard's panels, including those inside rows."""
    panels: list[dict[str, Any]] = []
    for panel in dashboard.get("panels", []):
        panels.append(panel)
        panels.extend(panel.get("panels", []))
    return panels


def check_dashboards(uids: dict[str, str]) -> None:
    """Check every dashboard's data sources and the Visits time range rule."""
    files = sorted((OBS / "grafana" / "dashboards").glob("*.json"))
    titles: set[str] = set()
    if len(files) < 2:
        fail("expected two dashboards")
    for path in files:
        name = path.name
        try:
            dashboard = json.loads(path.read_text())
        except json.JSONDecodeError as exc:
            fail(f"{name}: not valid JSON: {exc}")
            continue
        titles.add(dashboard.get("title", ""))
        if not dashboard.get("uid"):
            fail(f"{name}: no uid")
        for where, ref in datasource_refs(dashboard):
            if not isinstance(ref, dict) or ref.get("uid") not in uids:
                fail(f"{name}{where}: data source {ref!r} is not provisioned")
            elif ref.get("type") != uids[ref["uid"]]:
                fail(f"{name}{where}: {ref!r} has the wrong type")
        for panel in all_panels(dashboard):
            if panel.get("type") == "row":
                continue
            title = panel.get("title", "?")
            if not panel.get("datasource"):
                fail(f"{name}: panel {title!r} has no data source")
            if not panel.get("targets"):
                fail(f"{name}: panel {title!r} has no query")
            for target in panel.get("targets", []):
                if "datasource" not in target:
                    fail(f"{name}: a query of {title!r} has no data source")
                if dashboard.get("uid") == VISITS_DASHBOARD:
                    sql = target.get("rawSql", "")
                    if "$__timeFilter(" not in sql:
                        fail(f"{name}: {title!r} ignores the dashboard's time range")
    if titles != {"Visits and Progress", "Application health"}:
        fail(f"unexpected dashboard titles: {sorted(titles)}")


def main() -> int:
    """Run every check; return the process exit code."""
    check_compose()
    uids = check_config_files()
    check_dashboards(uids)
    if errors:
        print("Observability config checks failed:", file=sys.stderr)  # noqa: T201
        for message in errors:
            print(f"- {message}", file=sys.stderr)  # noqa: T201
        return 1
    print("Observability config checks passed.")  # noqa: T201
    return 0


if __name__ == "__main__":
    sys.exit(main())
