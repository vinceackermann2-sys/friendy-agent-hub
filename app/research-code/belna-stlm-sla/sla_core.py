import torch
import torch.nn as nn
import torch.nn.functional as F


class MiniSLA(nn.Module):
    """One Transformer layer, looped recurrently, wrapped around
    an explicit key-value memory with 10 entity slots and a
    symbolic negation router. No constraint injection needed."""

    def __init__(
        self,
        vocab,
        word_to_id,
        d_model=128,
        n_heads=8,
        max_len=96,
        recurrent_steps=4,
        num_entities=10,
    ):
        super().__init__()
        self.word_to_id = word_to_id
        self.recurrent_steps = recurrent_steps
        self.num_entities = num_entities
        self.token_emb = nn.Embedding(vocab, d_model)
        self.pos_emb = nn.Embedding(max_len, d_model)
        self.encoder_layer = nn.TransformerEncoderLayer(
            d_model, n_heads, dim_feedforward=d_model * 4, batch_first=True, dropout=0.1
        )
        self.q_proj = nn.Linear(d_model, num_entities)
        self.w_proj = nn.Linear(d_model, d_model)
        self.g_proj = nn.Linear(d_model, 1)
        self.mem_combine = nn.Linear(d_model, d_model)
        self.router = nn.Linear(d_model, 1)
        self.lm_head = nn.Linear(d_model, vocab)

    def forward(self, input_ids, return_debug=False):
        bsz, seqlen = input_ids.shape
        pos = torch.arange(seqlen, device=input_ids.device).unsqueeze(0)
        h = self.token_emb(input_ids) + self.pos_emb(pos)
        mask = torch.triu(
            torch.ones(seqlen, seqlen, device=input_ids.device) * float("-inf"),
            diagonal=1,
        )
        for _ in range(self.recurrent_steps):
            h = self.encoder_layer(h, src_mask=mask)
        memory = torch.zeros(
            bsz, self.num_entities, h.size(-1), device=input_ids.device
        )
        reads, routes = [], []
        for t in range(seqlen):
            h_t = h[:, t, :]
            probs = F.softmax(self.q_proj(h_t), dim=-1).unsqueeze(-1)
            read = (memory * probs).sum(dim=1)
            route = torch.sigmoid(self.router(h_t))
            routes.append(route)
            routed = (1.0 - route) * read + route * (-read)
            reads.append(routed)
            write = self.w_proj(h_t)
            gate = torch.sigmoid(self.g_proj(h_t)).unsqueeze(-1)
            memory = (1.0 - gate * probs) * memory + (gate * probs) * write.unsqueeze(1)
        combined = h + self.mem_combine(torch.stack(reads, dim=1))
        logits = self.lm_head(combined)
        if return_debug:
            return logits, memory, reads, routes
        return logits
