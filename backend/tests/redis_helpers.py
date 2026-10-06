"""A TCP proxy in front of the real Redis that tests can break and mend."""

import asyncio
import threading

from sqlalchemy.engine import make_url


class FlakyRedis:
    """Listens on a local port and forwards to Redis, or stalls on request.

    In `stalled` mode a connection is accepted and then never answered, which is
    what a Redis that has hung looks like to a client. `refused` closes new
    connections at once. Switching back to `forwarding` mends it without any
    change on the client's side.
    """

    def __init__(self, redis_url: str) -> None:
        """Remember where the real Redis is; call `start` to listen."""
        url = make_url(redis_url)
        self._target = (url.host or "localhost", url.port or 6379)
        self.mode = "forwarding"
        self._open: set[asyncio.StreamWriter] = set()
        self.port = 0
        self._loop = asyncio.new_event_loop()
        self._ready = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)
        self._server: asyncio.Server | None = None

    def start(self) -> None:
        """Start listening on a free port."""
        self._thread.start()
        self._ready.wait(5)

    def stop(self) -> None:
        """Stop listening and drop every connection."""
        self._loop.call_soon_threadsafe(self._drop_connections)
        self._loop.call_soon_threadsafe(self._loop.stop)
        self._thread.join(5)

    def set_mode(self, mode: str) -> None:
        """Switch mode; connections open at the time are dropped."""
        self.mode = mode
        self._loop.call_soon_threadsafe(self._drop_connections)

    def _drop_connections(self) -> None:
        for writer in list(self._open):
            writer.close()
        self._open.clear()

    def url(self, database: int = 15) -> str:
        """Return the Redis URL of the proxy."""
        return f"redis://127.0.0.1:{self.port}/{database}"

    def _run(self) -> None:
        asyncio.set_event_loop(self._loop)
        self._server = self._loop.run_until_complete(
            asyncio.start_server(self._handle, "127.0.0.1", 0)
        )
        self.port = self._server.sockets[0].getsockname()[1]
        self._ready.set()
        self._loop.run_forever()
        self._server.close()

    async def _handle(
        self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter
    ) -> None:
        if self.mode == "refused":
            writer.close()
            return
        self._open.add(writer)
        if self.mode == "stalled":
            try:
                await asyncio.sleep(3600)
            finally:
                writer.close()
            return
        upstream_reader, upstream_writer = await asyncio.open_connection(*self._target)
        self._open.add(upstream_writer)

        async def pipe(src: asyncio.StreamReader, dst: asyncio.StreamWriter) -> None:
            try:
                while data := await src.read(65536):
                    dst.write(data)
                    await dst.drain()
            except (ConnectionError, asyncio.CancelledError):
                pass
            finally:
                dst.close()

        await asyncio.gather(
            pipe(reader, upstream_writer), pipe(upstream_reader, writer)
        )
