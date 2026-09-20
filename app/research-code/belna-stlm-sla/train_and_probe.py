import argparse
import math
import torch
import torch.nn as nn
import torch.nn.functional as F

from sla_core import MiniSLA
from stlm_core import STLMini


def train_loop(model, train_loader, val_loader, epochs, dev, kind):
    opt = torch.optim.AdamW(model.parameters(), lr=2e-4)
    for epoch in range(1, epochs + 1):
        model.train()
        for input_ids, labels in train_loader:
            input_ids = input_ids.to(dev)
            labels = labels.to(dev)
            logits = model(input_ids)
            loss = F.cross_entropy(
                logits.reshape(-1, logits.size(-1)),
                labels.reshape(-1),
                ignore_index=-100,
            )
            if kind == "stlm":
                loss = loss + 0.4 * model.topology_loss(input_ids)
            opt.zero_grad()
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 1.0)
            opt.step()
        val_nll = evaluate(model, val_loader, dev)
        print("epoch", epoch, "val_ppl", round(math.exp(val_nll), 2))


@torch.no_grad()
def evaluate(model, loader, dev):
    model.eval()
    total, n = 0.0, 0
    for input_ids, labels in loader:
        input_ids = input_ids.to(dev)
        labels = labels.to(dev)
        logits = model(input_ids)
        loss = F.cross_entropy(
            logits.reshape(-1, logits.size(-1)),
            labels.reshape(-1),
            ignore_index=-100,
            reduction="sum",
        )
        total += loss.item()
        n += (labels != -100).sum().item()
    return total / max(n, 1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", choices=["stlm", "sla"], required=True)
    ap.add_argument("--epochs", type=int, default=8)
    args = ap.parse_args()
    print("Wire your WikiText-2 loaders, then call train_loop.")
    print("Probes: 35 negation pairs, 50 grammar pairs, 30 meaning pairs.")
    print("Selected architecture:", args.model, "epochs", args.epochs)
    _ = (STLMini, MiniSLA)


if __name__ == "__main__":
    main()
