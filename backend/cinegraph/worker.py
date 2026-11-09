"""Background worker (docker compose service `worker`):
- polls your public Letterboxd RSS feed every RSS_POLL_MINUTES
- retrains everything nightly at NIGHTLY_RETRAIN_HOUR (graph, embeddings, clusters, ALS, LTR)
- runs an incremental LTR retrain whenever enough new feedback has arrived
"""
from __future__ import annotations

import datetime as dt
import logging
import time

from . import db, services
from .config import get_settings

log = logging.getLogger("cinegraph.worker")


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    s = get_settings()
    db.init_schema()
    last_rss = 0.0
    while True:
        now = time.time()
        if now - last_rss >= s.rss_poll_minutes * 60:
            last_rss = now
            try:
                from .userdata.letterboxd_rss import poll

                log.info("rss: %s", poll())
            except Exception:  # noqa: BLE001
                log.exception("rss poll failed")
        today = dt.date.today().isoformat()
        st = db.get_job_state("nightly")
        if dt.datetime.now().hour == s.nightly_retrain_hour and st.get("date") != today:
            log.info("nightly retrain")
            db.set_job_state("nightly", {"date": today, "result": str(services.retrain_all())[:500]})
        try:
            services.maybe_retrain_async()
        except Exception:  # noqa: BLE001
            log.exception("incremental retrain check failed")
        time.sleep(60)


if __name__ == "__main__":
    main()
