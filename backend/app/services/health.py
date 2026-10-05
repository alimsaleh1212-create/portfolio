"""Health service: liveness and per-dependency readiness."""

import asyncio
from typing import Literal, Protocol

import structlog
from pydantic import BaseModel

logger = structlog.get_logger(__name__)

Status = Literal["ok", "fail"]


class Probe(Protocol):
    """Anything that can check one dependency."""

    async def ping(self) -> None:
        """Return normally if healthy, raise otherwise."""
        ...


class DependencyCheck(BaseModel):
    """Result of checking one dependency."""

    status: Status
    detail: str | None = None


class ReadinessReport(BaseModel):
    """Result of checking every dependency."""

    status: Status
    checks: dict[str, DependencyCheck]


class HealthService:
    """Runs the readiness probes concurrently, each with its own timeout."""

    def __init__(self, probes: dict[str, Probe], timeout_seconds: float) -> None:
        """Store the named probes and the per-probe timeout."""
        self._probes = probes
        self._timeout_seconds = timeout_seconds

    async def check_readiness(self) -> ReadinessReport:
        """Check every dependency and summarise.

        Returns:
            A report whose overall status is "ok" only if every check is.
        """
        results = await asyncio.gather(
            *(self._check(name, probe) for name, probe in self._probes.items())
        )
        checks = dict(results)
        overall: Status = (
            "ok" if all(c.status == "ok" for c in checks.values()) else "fail"
        )
        return ReadinessReport(status=overall, checks=checks)

    async def _check(self, name: str, probe: Probe) -> tuple[str, DependencyCheck]:
        try:
            await asyncio.wait_for(probe.ping(), timeout=self._timeout_seconds)
        except TimeoutError:
            logger.warning("readiness_check_failed", dependency=name, reason="timeout")
            return name, DependencyCheck(status="fail", detail="timed out")
        except Exception:
            # Any failure means the dependency is not ready. Full error goes to
            # the log; the response only says "unavailable".
            logger.exception("readiness_check_failed", dependency=name)
            return name, DependencyCheck(status="fail", detail="unavailable")
        return name, DependencyCheck(status="ok")
