import argparse
import json
import math
from pathlib import Path


def load_nll(path):
    p = Path(path)
    metrics = p / "metrics.json"
    if metrics.exists():
        data = json.loads(metrics.read_text())
        return float(data["nll"])
    log = p / "train.log"
    if log.exists():
        last = [ln for ln in log.read_text().splitlines() if "NLL" in ln][-1]
        return float(last.split("NLL")[1].split()[0])
    raise SystemExit(f"no metrics.json or train.log in {path}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--a", required=True)
    ap.add_argument("--b", required=True)
    args = ap.parse_args()
    a, b = load_nll(args.a), load_nll(args.b)
    print(f"{args.a}  NLL {a:.4f}  PPL {math.exp(a):.2f}")
    print(f"{args.b}  NLL {b:.4f}  PPL {math.exp(b):.2f}")
    winner = args.a if a < b else args.b
    print(f"lower NLL: {winner}")


if __name__ == "__main__":
    main()
