"""Minimal local tx-mining service for Hathor testnet-playground.

Speaks the same HTTP protocol as Hathor's tx-mining-service
(submit-job / job-status / health) so hathor-wallet-headless can use it
as HEADLESS_TX_MINING_URL. The playground network enforces
min_tx_weight=8 with coefficient 0, so PoW is ~256 sha256d hashes and
can be solved inline in Python.
"""
import json
import time
import uuid
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlparse, parse_qs

from hathorlib.base_transaction import tx_or_block_from_bytes

NODE_URL = "https://node1.playground.testnet.hathor.network/v1a"
TX_WEIGHT = 8.0  # network min_tx_weight, coefficient 0 => constant

JOBS = {}


def get_parents():
    req = urllib.request.Request(f"{NODE_URL}/tx_parents")
    with urllib.request.urlopen(req, timeout=15) as resp:
        data = json.loads(resp.read())
    if not data.get("success"):
        raise RuntimeError(f"tx_parents failed: {data}")
    return data["tx_parents"]


def mine(tx_hex: str, add_parents: bool) -> dict:
    tx = tx_or_block_from_bytes(bytes.fromhex(tx_hex))
    if add_parents and not tx.parents:
        tx.parents = [bytes.fromhex(h) for h in get_parents()]
    tx.timestamp = int(time.time())
    tx.weight = TX_WEIGHT
    target = tx.get_target()
    tx.nonce = 0
    part1 = tx.calculate_hash1()
    while True:
        h = tx.calculate_hash2(part1.copy())
        if int(h.hex(), 16) < target:
            break
        tx.nonce += 1
        if tx.nonce % 5_000_000 == 0:
            print(f"still mining... nonce={tx.nonce}")
    return {
        "nonce": f"{tx.nonce:08x}",
        "parents": [p.hex() for p in tx.parents],
        "timestamp": tx.timestamp,
        "weight": tx.weight,
    }


def job_payload(job):
    return {
        "job_id": job["id"],
        "status": job["status"],
        "message": job.get("message", ""),
        "created_at": job["created_at"],
        "tx": job["tx"],
        "timeout": 60,
        "submitted_at": job["created_at"],
        "total_time": job.get("total_time", 0),
        "expected_queue_time": 0,
        "expected_mining_time": 1,
        "expected_total_time": 1,
    }


class Handler(BaseHTTPRequestHandler):
    def send_json(self, obj, code=200):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path.rstrip("/").endswith("health"):
            self.send_json({"status": "pass"})
            return
        if parsed.path.rstrip("/").endswith("job-status"):
            qs = parse_qs(parsed.query)
            job_id = qs.get("job-id", [""])[0]
            job = JOBS.get(job_id)
            if job is None:
                self.send_json({"error": "job not found"}, 404)
                return
            self.send_json(job_payload(job))
            return
        self.send_json({"error": "not found"}, 404)

    def do_POST(self):
        parsed = urlparse(self.path)
        length = int(self.headers.get("Content-Length", 0))
        body = json.loads(self.rfile.read(length) or b"{}")
        if parsed.path.rstrip("/").endswith("submit-job"):
            job_id = uuid.uuid4().hex
            job = {
                "id": job_id,
                "status": "mining",
                "created_at": time.time(),
                "tx": {},
            }
            JOBS[job_id] = job
            start = time.time()
            try:
                job["tx"] = mine(body["tx"], body.get("add_parents", True))
                job["status"] = "done"
            except Exception as exc:  # noqa: BLE001
                print(f"mining failed: {exc}")
                job["status"] = "failed"
                job["message"] = str(exc)
            job["total_time"] = time.time() - start
            print(f"job {job_id}: {job['status']} in {job['total_time']:.2f}s "
                  f"nonce={job['tx'].get('nonce')}")
            self.send_json(job_payload(job))
            return
        if parsed.path.rstrip("/").endswith("cancel-job"):
            self.send_json({"success": True})
            return
        self.send_json({"error": "not found"}, 404)

    def log_message(self, fmt, *args):  # quiet default access logs
        pass


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", 8035), Handler)
    print("mini tx-mining service listening on http://127.0.0.1:8035")
    server.serve_forever()
