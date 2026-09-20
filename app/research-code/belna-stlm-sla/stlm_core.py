import torch
import torch.nn as nn
import torch.nn.functional as F


class STLMini(nn.Module):
    """Baseline Transformer core plus meaning coordinates:
    one axis per topology, one classifier and one
    coordinate per vocabulary word."""

    def __init__(
        self,
        vocab,
        word_to_id,
        topologies,
        d_model=128,
        n_layers=4,
        n_heads=8,
        max_len=96,
        constraint_strength=0.35,
    ):
        super().__init__()
        self.word_to_id = word_to_id
        self.topo_to_id = {n: i for i, n in enumerate(topologies)}
        self.token_emb = nn.Embedding(vocab, d_model)
        self.pos_emb = nn.Embedding(max_len, d_model)
        layer = nn.TransformerEncoderLayer(
            d_model, n_heads, dim_feedforward=d_model * 4, batch_first=True, dropout=0.1
        )
        self.encoder = nn.TransformerEncoder(layer, n_layers)
        self.lm_head = nn.Linear(d_model, vocab)
        self.topology_coord = nn.Embedding(len(topologies), 1)
        self.concept_topo = nn.Embedding(vocab, len(topologies))
        self.concept_coord = nn.Embedding(vocab, 1)
        self.strength = constraint_strength

    def forward(self, input_ids, constraint_bonus=None):
        seqlen = input_ids.size(1)
        pos = torch.arange(seqlen, device=input_ids.device).unsqueeze(0)
        x = self.token_emb(input_ids) + self.pos_emb(pos)
        mask = torch.triu(
            torch.ones(seqlen, seqlen, device=input_ids.device) * float("-inf"),
            diagonal=1,
        )
        logits = self.lm_head(self.encoder(x, mask=mask))
        if constraint_bonus is not None:
            bonus = constraint_bonus
            if bonus.dim() == 1:
                bonus = bonus.unsqueeze(0)
            logits = logits + self.strength * bonus.unsqueeze(1)
        return logits

    def topology_loss(self, input_ids):
        """Pull each token coordinate toward its topology axis."""
        probs = F.softmax(self.concept_topo(input_ids), dim=-1)
        coords = self.concept_coord(input_ids).squeeze(-1)
        axis = self.topology_coord.weight.squeeze(-1)
        target = torch.matmul(probs, axis)
        return F.mse_loss(coords, target)


# Joint training loss (baseline uses plain lm_loss only):
# loss = lm_loss + 0.4 * model.topology_loss(x) + seed_coord_loss
