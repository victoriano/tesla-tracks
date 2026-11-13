"""Long-running ingester: ZMQ subscriber -> raw Parquet, plus periodic processing, compaction and mirroring."""

from __future__ import annotations

import logging
import signal
import threading
import time
from datetime import UTC, datetime

import zmq

from . import process
from .decode import decode_message
from .objectstore import Mirror
from .settings import Settings
from .storage import RawWriter, compact

log = logging.getLogger("tesla_tracks.ingest")


def run(settings: Settings) -> None:
    writer = RawWriter(settings.raw_dir, settings.state_dir)
    mirror = Mirror.from_env(settings.data_dir)
    stop = threading.Event()
    dirty = threading.Event()  # new raw data since the last processing run

    def housekeeping() -> None:
        last_process = last_compact_day = 0.0
        while not stop.wait(settings.flush_seconds):
            try:
                if writer.flush():
                    dirty.set()
                now = time.time()
                if dirty.is_set() and now - last_process >= settings.process_seconds:
                    dirty.clear()
                    counts = process.run(settings.data_dir)
                    last_process = now
                    log.info("processed %s", counts)
                today = datetime.now(UTC).strftime("%Y-%m-%d")
                if now - last_compact_day >= 3600:
                    if compact(settings.raw_dir, keep_today=today):
                        log.info("compacted raw files")
                    last_compact_day = now
                if mirror:
                    result = mirror.sync()
                    if result["uploaded"] or result["deleted"]:
                        log.info("object store sync %s", result)
            except Exception:  # keep ingesting even if a maintenance step fails
                log.exception("housekeeping failed")

    ctx = zmq.Context.instance()
    sock = ctx.socket(zmq.SUB)
    sock.setsockopt(zmq.SUBSCRIBE, b"")
    sock.setsockopt(zmq.RCVTIMEO, 1000)
    sock.connect(settings.zmq_endpoint)
    log.info("subscribed to %s, writing to %s", settings.zmq_endpoint, settings.data_dir)

    def _stop(*_):
        stop.set()

    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)
    worker = threading.Thread(target=housekeeping, daemon=True)
    worker.start()

    received = 0
    while not stop.is_set():
        try:
            frames = sock.recv_multipart()
        except zmq.Again:
            continue
        if len(frames) < 2:
            continue
        topic = frames[0].decode(errors="replace")
        try:
            table, rows = decode_message(topic, frames[-1], datetime.now(UTC))
        except Exception:
            log.exception("could not decode message on %s", topic)
            continue
        writer.add(table, rows)
        received += 1
        if received % 500 == 0:
            log.info("received %d records", received)

    log.info("stopping: flushing buffers")
    writer.close()
    dirty.set()
    try:
        process.run(settings.data_dir)
        if mirror:
            mirror.sync()
    finally:
        sock.close(0)
