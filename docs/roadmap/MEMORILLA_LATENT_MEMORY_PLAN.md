# Memorilla — latent semantic memory: research note and plan

**Status**: planning only. No code in this change.
**Added**: 2026-10-18
**Paper**: Fallahpour, Idehpour, Kothapalli, Mounier, Wu, Pardis, and Leskovec. *Memorilla: Latent Semantic Memory for LLMs*. arXiv:2610.21375, posted 15 Oct 2026. HTML full text including Appendices A–G: <https://arxiv.org/html/2610.21375>. Abstract: <https://arxiv.org/abs/2610.21375>. Workshop citation on the project site: COLM Workshop on Context Beyond the Window, 2026, <https://openreview.net/forum?id=VV0vvzL783>.
**Project site**: <https://memory.stanford.edu/>

This note records what the paper and its public artifacts actually say, then maps each idea onto MemoryJS. Effort labels (S / M / L) are estimates. Nothing here claims that a TypeScript analogue will reproduce the paper’s scores.

Sources read for this note:

- The arXiv HTML paper, including Appendices A (related work), B (data and training), C (baselines), D (benchmarks and token budgets), E (ablations), F (serving cost; the latency table is Appendix F’s Table 14), and G (TextWorld).
- The project website, for the mean score, the release links, and the “current limits” paragraph.
- The code repository README and training configs at <https://github.com/snap-stanford/memorilla> (Apache-2.0).
- The checkpoint card <https://huggingface.co/memorilla/Memorilla-Qwen3-8B> (Apache-2.0) and the dataset card <https://huggingface.co/datasets/memorilla/Memorilla-Data> (`memorilla/Memorilla` redirects there). PersonalizationV4: <https://huggingface.co/datasets/memorilla/PersonalizationV4>.

Figure images are not re-measured. Numbers below are the ones written in the prose, tables, or website. Where a figure’s per-bar values are not printed, this note says so.

---

## Recommendation

Ship the interface the paper argues for, and leave the 194M-parameter soft-token module outside this library.

Suggested order: **M0 → M1 → M2**, then **M3** only if M2 shows that extractive slots drop multi-fact questions, then **M4** only for a caller who already runs an open-weight model locally. M4 is gated. Do not start by injecting latent tokens.

The reason to sequence it this way is in the paper itself. Memorilla’s gain on FactKG and on “why” / “how” questions comes from a **query-conditioned read of the whole collection** (Section 2.2, Figure 4). A cosine top-16 readout with a matched parameter budget scores 33.86 on PersonaMem-v2 short-answer, against 44.04 for the learned slots, in the from-scratch 4B ablation (Table 13). Copying top-k retrieval into a shorter prompt will not be Memorilla. MemoryJS already has the other half of the paper’s suggested hybrid: verbatim retrieval, graph multi-hop, and a token budget. The missing half is a **fixed-budget, collection-wide, query-conditioned pack** with a reported compression ratio, plus an eval that scores fact composition and not only top-k hit rate.

Soft-token injection (Equation 6) needs the decoder’s input-embedding matrix. Hosted chat APIs do not accept that. The released checkpoint is a Qwen3-8B-specific `memory.pt` (194M parameters, 16 tokens, no document self-attention). A practical text analogue is a fixed number of short fact lines prepended to the prompt the caller already sends.

---

## 1. Paper summary

### 1.1 Problem and claim

A frozen LLM can use information outside its parameters only through its context (Section 1). Memorilla encodes a document collection once, then, per query, reads **every** stored embedding and emits a fixed number of soft tokens in that LLM’s input-embedding space (Section 2, Figure 2). The default budget is K = 16. Documents do not re-enter the decoder as text.

The HTML abstract says Memorilla “achieves the best average performance against baselines including Mem0 and MemoRAG”. Section 4 is more precise: it leads on five of eight benchmarks and is second on NarrativeQA and PersonalizationV4. The project site states a mean score of **49.68** on the eight primary metrics. That mean mixes accuracy, exact match, and ROUGE-L; the site says so. Recomputing the eight primary metrics in Table 11 gives (44.60 + 66.65 + 59.00 + 84.33 + 19.31 + 57.00 + 18.15 + 48.37) / 8 = 49.68.

### 1.2 Architecture

Three operations: encode, store, retrieve (Section 2).

**Encoding and storage (Section 2.1, Equation 1).** A frozen document encoder maps each chunk d_i to a vector z_i of dimension h_e. Stacking them gives a matrix Z_D of shape N × h_e. That matrix is query-independent, computed once, and reused. Only added or changed documents are re-encoded. A frozen query encoder maps the current query to z_q, which is not stored as long-term memory. In the experiments both encoders are **Qwen3-Embedding-4B**, mean-pooled per document, h_e = 2560 (Section 2.5, Table 3). The dataset card says vectors are unit-normalized, computed in vLLM without an instruction prefix, and stored as float16.

**Query-conditioned readout f_mem (Section 2.2, Equations 2–5).** A trainable module maps (Z_D, z_q) to K rows in the decoder’s input dimension h_L. Four stages:

1. **Slot init.** K learned vectors Q_0, Xavier uniform, shared across collections and queries (Table 3).
2. **Query conditioning (Equation 3).** Slots cross-attend to the single query vector, then a residual add and LayerNorm. The query is a shared update; the residual keeps the slots distinct.
3. **Document read (Equation 4).** L_ref = 2 Perceiver-style blocks (Jaegle et al., 2021). Each block is cross-attention from the slots onto **all** document embeddings, plus a two-layer GELU feed-forward. Eight heads. Dropout 0.1. Softmax over documents (Table 3). This is a continuous read, not a discrete top-k cut. The module does **not** use self-attention; the checkpoint card repeats “no document self-attention”.
4. **Projection (Equation 5).** LayerNorm then a learned linear map h_e → h_L. h_L = 4096 for the 8B decoder and 2560 for the 4B decoder (Table 3).

**Injection (Section 2.3, Equation 6).** The K soft tokens are prepended to the query’s token embeddings. No decoder layer is modified. Rotary position embeddings run over the combined sequence in the usual way. The decoder attends to the memory through its existing self-attention.

**Objective (Section 2.4, Equation 7).** Negative log-likelihood of the **answer** tokens only. θ_mem is the memory module and the projection. Encoder and decoder stay frozen. Trainable size: **194,123,776** parameters with the 8B decoder, **190,190,080** with the 4B decoder (Table 3).

### 1.3 Training data and recipe

Three stages (Section 2.6, Tables 1, 4, and 5). All supervised runs: AdamW, weight decay 10^-2, bf16, seed 23, 4× H100 80GB. Document embeddings are precomputed.

| Stage | Data | Init | Epochs | Peak LR | Effective batch | Max decoder length |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 1,979,809 English Wikipedia paraphrase rows (chunked near 128 tokens, mean 1.73 documents per row) | random | 1 | 3×10^-4 | 128 | 1024 |
| 2 | 1,343,993 queries: SQuAD v2, DROP, CoQA, PubMedQA (900 train), QuAIL, PwC, CNN/DailyMail, SAMSum, DialogSum, MS MARCO | Stage 1 | 1 | 3×10^-4 | 128 | 1024 |
| 3 | Unified training splits of the eight eval benchmarks | Stage 2 | up to 5 | 1×10^-4 | 64 | 2048 |

Stage 3 warmup ratio is 0.1; Stages 1–2 use 0.03. One multi-task checkpoint is used directly for FactKG, TriviaQA, NarrativeQA, PubMedQA, LaMP-4, and LaMP-7. PersonaMem-v2 and PersonalizationV4 are each fine-tuned for 5 further epochs because their validation loss had not plateaued (Section 2.6, Table 5). The released training configs match that recipe: `configs/personalization_pv4.yaml` and `configs/personalization_pmv2.yaml` set `init_memory: runs/stage3/epoch-04`. The GitHub README checkpoint table and the Hugging Face model card instead label the released `pv4/` and `pmv2/` folders as “from Stage 1” via `configs/single_task.yaml` (that file inits from Stage 2 and defaults to LaMP-7). The weights were not downloaded for this note, so which description the files on disk follow is unresolved. The paper’s reported personalization numbers are the Stage-3-then-specialized recipe.

Chunk units (Table 2, Qwen3 tokenizer, mean / median tokens): PersonaMem-v2 one session 280 / 262; PersonalizationV4 one dialogue 252 / 224; PubMedQA one abstract section 84 / 78; TriviaQA sentence-greedy passages at 128 tokens, 70 / 77; NarrativeQA paragraphs split above ~256 tokens, 94 / 35; FactKG one triple 13 / 13; LaMP-4 one profile item 47 / 44; LaMP-7 one tweet 25 / 25.

Decoding for the supervised evals is greedy, temperature 0 (Section 3.3, Table 3). Short-answer generation is capped at 8 tokens for classification and 64 for QA and fact verification; LaMP-4 and LaMP-7 at 128.

### 1.4 Benchmarks and baselines

Eight supervised benchmarks in three groups (Section 3.2, Appendix D, Table 7). Means below are documents per query and source tokens per query on the evaluated split.

| Benchmark | Task | Docs / q | Source tokens / q | Evaluated split |
| --- | --- | --- | --- | --- |
| PersonaMem-v2 | Personalization, short answer | 116 | 31,618 | test, n = 5,000 |
| PersonalizationV4 | Personalization, short answer | 200 | 50,476 | test, n = 4,237 (30 held-out users) |
| LaMP-4 | Personalized headline | 172 | 7,638 | development, n = 1,925 |
| LaMP-7 | Personalized tweet paraphrase | 18 | 465 | development, n = 1,500 |
| NarrativeQA | Long-document generative QA | 1,420 | 76,225 | test, n = 10,557 |
| TriviaQA | Factoid QA | 164 | 11,861 | seed-23 subsample of validation, n = 500 (of 17,944) |
| FactKG | Claim supported / refuted from DBpedia triples | 129 | 1,665 | test, n = 9,041 |
| PubMedQA | Yes / no / maybe from an abstract | 4 | 324 | 100-example test portion of a 900/100 split of PQA-L |

Personalization users are disjoint between train and test (Appendix D). PersonalizationV4 is synthetic: GPT-5 personas and questions, GPT-5-mini dialogues, no real users (ethics statement, Appendix D.1). Short-answer accuracy embeds the generation with the frozen encoder and marks it correct when the gold answer is the nearest of the predefined choices (Section 3.3). FactKG choices are `True` / `False`.

Every baseline the authors ran uses frozen Qwen3-Embedding-4B and frozen Qwen3-8B, greedy (Section 3.1, Appendix C).

- **Closed book.** Query only.
- **RAG-k.** Cosine top-k chunks, most similar first. Reported at k ∈ 1, 5, 50.
- **Full context.** Every chunk in stored order. The server enforces 32,768 decoder tokens and turns on YaRN (scale 4, window 131,072) past that. That covers part of PersonaMem-v2, TriviaQA, and NarrativeQA, and all of PersonalizationV4 (Table 10). For the 10.8% of evaluated NarrativeQA questions whose books still exceed the extended window, the earliest chunks are dropped.
- **LLMLingua-2.** Query-agnostic token deletion with the released XLM-RoBERTa-large classifier. The collection is compressed once. Absolute budgets 32, 64, 128, and 350; the best budget per metric is reported.
- **xRAG.** Reimplemented bridge: LayerNorm plus a two-layer GELU MLP, 27,276,288 parameters, mapping the **single** top chunk’s embedding to one soft token. Trained from scratch on each benchmark’s training split.
- **ComMer.** Not re-run. Table 12 quotes published LaMP-4 / LaMP-7 numbers from a Gemma-2b setup.
- **Mem0** (`mem0ai` 0.1.118) and **MemoRAG** (official repo). Both write memory with frozen Qwen3-4B-Instruct-2507. Retrieval depth is swept and the best depth per metric is reported (Table 6).

### 1.5 Main results

Table 11 is the full 8B comparison. Compression is full-context document tokens divided by 16 (Table 10). Document-token counts exclude the question, the answer-format instruction, the system prompt, and the chat template. Primary metric per benchmark:

| Benchmark | Metric | Closed book | RAG-50 | Full context | Strongest other | Memorilla | Vs full context |
| --- | --- | --- | --- | --- | --- | --- | --- |
| PersonaMem-v2 | short-answer acc. | 25.64 | 26.72 | 27.92 | xRAG 30.90 | **44.60** | 1,974× |
| PersonalizationV4 | short-answer acc. | 58.30 | 65.78 | 59.12 | MemoRAG **67.88** | 66.65 | 3,153× |
| PersonalizationV4 hard (n = 629) | short-answer acc. | 31.96 | 41.97 | 36.57 | MemoRAG **45.95** | 41.97 | — |
| PubMedQA | acc. | 21.00 | 67.00 | 67.00 | LLMLingua-2 **69.00** | 59.00 | 20× |
| NarrativeQA | ROUGE-L | 10.71 | 17.23 | 17.99 | MemoRAG **20.51** | 19.31 | 4,212× |
| TriviaQA | exact match | 36.00 | 55.60 | 52.60 | MemoRAG 56.60 | **57.00** | 743× |
| FactKG | acc. | 65.97 | 78.39 | 80.43 | MemoRAG 80.38 | **84.33** | 108× |
| LaMP-4 | ROUGE-L | 12.24 | 15.09 | 14.21 | xRAG 16.10 | **18.15** | 474× |
| LaMP-7 | ROUGE-L | 43.13 | 43.77 | 43.71 | xRAG 46.84 | **48.37** | 29× |

FactKG 84.33 against full context 80.43 at 108× fewer document tokens is Table 11, and it matches the abstract. The same row is 36× fewer tokens than MemoRAG (Table 10: full context 1,727 tokens, MemoRAG 573, Memorilla 16). On NarrativeQA, MemoRAG leads ROUGE-1 (21.80) and ROUGE-L (20.51); Memorilla leads F1 (16.56 against MemoRAG 15.03). On TriviaQA, Memorilla also leads F1 (60.60) and BLEU-1 (58.66).

Section 4: full context trails Memorilla on every benchmark except PubMedQA, and on 20 of the 21 metrics in Table 11. RAG-50 beats full context on 15 of those 21 metrics. The authors’ reading is that giving the decoder the entire collection often hurts.

Geometric-mean document tokens (Table 10): RAG-1 55, RAG-5 273, RAG-50 1,808, full context 6,301, LLMLingua-2 278, xRAG 1, Mem0 212, MemoRAG 784, Memorilla 16. Section 4 converts that to 394×, 113×, and 49× fewer document tokens than full context, RAG-50, and MemoRAG. Figure 1 puts Memorilla on the Pareto frontier of mean score against that geometric mean. Section 4 also quotes average scores of 41.92 (xRAG), 40.75 (LLMLingua-2), and 38.02 (Mem0) against 49.68.

Table 12, cross-paper and cross-model: ComMer at 128 tokens reports LaMP-4 ROUGE-L 17.50 and LaMP-7 45.00 on Gemma-2b. Memorilla at 16 tokens reports 17.72 / 47.04 with the 4B decoder and 18.15 / 48.37 with the 8B decoder.

**What the readout seems to learn (Section 5, Figure 4).** On NarrativeQA, Memorilla beats RAG-50 by 4.91 ROUGE-L on “why” and 7.02 on “how”. RAG-50 leads by 3.45 on “who” and 2.93 on “which”. On FactKG, the margin over RAG-50 grows from +4.23 points at one entity to +7.59 points at four or more. RAG-50 falls from 78.73 to 51.75 as composed facts go from 1 to 4; Memorilla stays in the 80–89 range. 73.5% of FactKG claims have more than 50 chunks, so part of the RAG-50 gap is evidence it never sees. Full context still trails Memorilla (80.43 against 84.33).

**Complementarity (Section 5, Figure 5).** On FactKG, 15.9% of questions are answered by Memorilla alone and 10.0% by RAG-50 alone. On PersonaMem-v2 short-answer the split is 27.1% against 9.2%. The union is an oracle upper bound, not a trained hybrid. The site plots that union (FactKG 94.3, PersonalizationV4 80.4, PubMedQA 80.0, TriviaQA 74.2, and lower on the ROUGE tasks). Those union percentages are website figures; the paper states the “alone” shares and that the union exceeds either method on every benchmark. For ROUGE tasks a question counts as answered at ROUGE-L at least max(0.20, m), where m is Memorilla’s median.

Questions both methods miss: on PersonalizationV4 they often require linking facts that each appear somewhere, so the residual error is combination. On FactKG both methods lean toward “false”: true claims are 89.5% of the claims both get wrong and 28.7% of the claims both get right (Section 5).

### 1.6 Ablations

All of Appendix E’s from-scratch numbers use Qwen3-4B-Instruct-2507 unless noted, and **are not comparable** to Table 11.

**Architecture (Table 13, PersonaMem-v2 short-answer, trained from scratch).** Query-independent pooling is weakest: global mean-pool 28.94 (6.6M params), segmented mean-pool 29.68, segmented at a matched budget 31.10 (190.1M). Cosine top-16 at a matched budget is 33.86. A documents-only Q-Former (no question) is 34.72 at 268.9M. A query-aware Q-Former is 43.34 at 268.9M. Memorilla is 44.04 at 190.2M. On FactKG the same from-scratch comparison is Memorilla 82.56, Q-Former 80.48, documents-only 78.72. Replacing document embeddings with Gaussian noise changes the documents-only FactKG score by +0.04 and drops Memorilla by 5.93 and the Q-Former by 5.11. The paper’s conclusion: the gain comes from conditioning the slots **before** they read the collection.

**Capacity (Section E.2, Figure 9).** Training at K = 128 instead of K = 16, from scratch, moves four of eight benchmarks by less than a point, and PersonaMem-v2 and PersonalizationV4 drop. Per-benchmark deltas are in the figure and are not printed. The paper fixes K = 16 for the supervised experiments.

**Inference budget (Section E.3, Figure 10).** Using the first K tokens of a checkpoint trained at 16, without retraining. PersonaMem-v2 stays near closed-book through K = 4 (26.58 against 25.64) and reaches 44.60 at K = 16. PersonalizationV4 starts at 57.66 against a closed-book 58.30, dips at K = 2 and K = 4, and reaches 66.65 at 16. FactKG, TriviaQA, and NarrativeQA rise at every doubling. PubMedQA and LaMP-4 improve from K = 8; LaMP-7 only from K = 16. The paper reads this as “required capacity tracks how much cross-document integration the task needs.” The curves are not saturation curves: training at 128 did not help.

**Frozen decoder vs LoRA (Section E.4, Figure 11).** Rank-130 LoRA on Qwen3-4B-Instruct-2507, 268.4M parameters, same per-task rows, **no documents**. Memorilla (8B decoder, 194.1M trainable) leads every primary metric. The PubMedQA and LaMP-7 gaps are described as within noise. Exact per-metric LoRA scores are in the figure and are not printed.

**Encoder size (Section E.5, Figure 12).** Swapping Qwen3-Embedding-4B for Qwen3-Embedding-8B, training from scratch, moves every score by at most 1.3 except PubMedQA (+3.00, three of 100 questions).

### 1.7 Cost and latency

Appendix F, Table 14. One H100 80GB, batch size 1, bf16, greedy, `max_new_tokens = 32`, 250-token documents, median of 5 timings after 2 warmups. Hugging Face `generate` **without** a paged KV cache. The paper says full-context latency therefore depends on the serving stack.

| Path | N = 1 | N = 512 |
| --- | --- | --- |
| Document encoding (once) | 22.92 ms | 2,588.84 ms |
| Storage per document | 5 KB | 5 KB |
| Memory-module forward | 2.01 ms | 1.96 ms |
| CPU → GPU transfer | 0.014 ms | 0.060 ms |
| Decoder context tokens | 16 | 16 |
| Memorilla end to end | 740 ms | 739 ms |
| Full context end to end | 749 ms | 19,932 ms |

At N = 512 the full-context prompt is 128,064 tokens, past 32,768, so it uses YaRN. The introduction’s “0.74 s against 19.9 s” and “27×” match 739 ms against 19,932 ms. Encoding cost is linear in N and is the same cost a dense index would pay. Read-path time stays flat. A 200-document collection is 1 MB. On PersonalizationV4 the embedding store is 7,266× smaller than the corresponding KV cache: 50,455 document tokens at 144 KiB per token for Qwen3-8B in bf16 is 6.9 GiB, against 200 embeddings of 2,560 bf16 values (Appendix F).

The code README says the three training stages take about 19 hours on 4× H100 and download about 310 GiB, and that evaluating one checkpoint on all eight benchmarks takes about 15 minutes on one GPU. Those are repository statements, not paper tables.

### 1.8 TextWorld: memory trained by reward

Section 6 and Appendix G. A frozen **Qwen3-4B-Instruct-2507** agent, frozen Qwen3-Embedding-4B encoder, memory module trained **from random initialization** with GRPO. The supervised checkpoint is not loaded (Table 15). K = 8, not 16. Eight heads, one self-attention layer over the trajectory documents, then the same two cross-attention layers.

The memory **supplements** the text history. Every condition keeps the full history under the same budget: 16,000 tokens in training, 4,096 in evaluation (Section 6.1, Equation 10). From the second turn, each completed turn is one document (observation truncated to 200 characters plus the action; 74 tokens on average). The query is the current observation. The 20 extreme / huge / long / mega test games instead embed one document per five turns, keep the last four documents, and use the mean document embedding as the query.

Reward is the TextWorld game score with no shaping. Most medium and hard games return 1 for a win and 0 otherwise. GRPO group size G = 16, PPO clip 0.2, token-mean loss, no critic, no KL, no entropy bonus. AdamW at 5×10^-4, no warmup (Table 15, Equations 8–9). Training: 800 prompts (202 medium, 558 hard, 10 from each longer tier), 4 prompts per step, up to 50 turns, up to 128 new tokens per turn, SkyRL. Eval: 40 held-out prompts (30 distinct games), three samples at temperature 0.6.

Results (Section 6.1, Figure 8): avg@3 rises from **0.186 to 0.242**, pass@3 from **0.250 to 0.375**, relative to full-history in-context learning. An untrained module of the same shape falls to avg@3 0.153 and pass@3 0.225, so the extra tokens alone do not explain the gain. In-context learning exhausts the 4,096-token budget on 71% of rollouts, Memorilla on 58%. The site restates the complement: episodes that end before the turn limit are 29% and 42%. History in medium and hard games grows from about 800 tokens to about 3,200 and then levels off; the median rollout ends at turn 33, and 5 of 40 reach turn 50. Remaining failures concentrate in the longest quests.

The RL code lives in `rl/` and depends on <https://github.com/Adibvafa/SkyRL-Memorilla>.

### 1.9 Limitations the authors state

Section 7, plus the website’s “Current limits” paragraph:

- Fine-grained facts, especially exact names, are dropped. The document encoder was never trained for compression. “Who” / “which” questions favor RAG; “why” / “how” favor the memory (Section 5).
- Short sources do not benefit. PubMedQA’s four abstracts are 324 tokens; LLMLingua-2 scores 69.00 and Memorilla 59.00 (Table 11).
- The readout writes into one LLM’s input embeddings, so it needs open weights and a module trained for that LLM. h_L differs between the 4B and 8B decoders (Table 3). The website states this limit directly.
- Experiments pair a Qwen encoder with a Qwen decoder. Cross-family transfer is untested. Coding is untested. Modalities other than text are untested. Science beyond the PubMedQA abstracts is untested.
- TextWorld is one game suite, episodes of at most 50 turns. The website says learning across environments and over long deployments is not shown.
- Embeddings can still carry sensitive user information. Deleting a user’s store does not require retraining the LLM, and the authors still require consent and protection (ethics statement).
- PersonalizationV4 is synthetic and follows one template.

Two further limits follow from the experimental design, even though they are not in the limitations paragraph:

- The headline numbers are **in-domain**: Stage 3 trains on the eight benchmarks’ training splits, and the two personalization sets are specialized further (Section 2.6). This is not a zero-shot memory module.
- TriviaQA is a 500-question validation subsample, LaMP-4 and LaMP-7 are development splits, and PubMedQA has 100 test questions (Table 5). ComMer is a different model family (Table 12). The 49.68 mean mixes metrics (project site).

### 1.10 What was released

Verified on 2026-10-18:

| Artifact | Where | License / note |
| --- | --- | --- |
| Training and eval code | <https://github.com/snap-stanford/memorilla> | Apache-2.0. Linux, CUDA, Python 3.11, uv. FlashAttention-2 is optional. |
| Memory-module checkpoints | <https://huggingface.co/memorilla/Memorilla-Qwen3-8B> | Apache-2.0. Folders `stage1/`, `stage2/`, `stage3/`, `pv4/`, `pmv2/`. Each has `memory.pt` (bfloat16, 194M) and `config.json`. The frozen Qwen3-8B and Qwen3-Embedding-4B weights are **not** in this repo; the card says to use the original Qwen checkpoints. The Hugging Face models API for org `memorilla` listed this as the only model. |
| Training and eval rows, plus precomputed Qwen3-Embedding-4B vectors | <https://huggingface.co/datasets/memorilla/Memorilla-Data> | Per-config license of the source dataset. Several are non-commercial (QuAIL, SAMSum, DialogSum, MS MARCO). FactKG’s own license is stated as “no license stated”; DBpedia triples are CC BY-SA 3.0. Embedding shards are large: FactKG 69.4 GiB, TriviaQA 124.6 GiB, MS MARCO 30.7 GiB, English Wikipedia 26.0 GiB (dataset card). |
| PersonalizationV4 | <https://huggingface.co/datasets/memorilla/PersonalizationV4> | CC BY 4.0. 149 fictional users. |
| TextWorld RL fork | <https://github.com/Adibvafa/SkyRL-Memorilla> | Linked from the Memorilla README. Not audited line by line for this note. |

The reproducibility statement says code, data with precomputed embeddings, and PersonalizationV4 are released on the project website. The website links the GitHub repository and the Hugging Face org.

---

## 2. Strengths and weaknesses

**Strengths, as evidenced.**

- The comparison holds the encoder and the decoder fixed, so method differences are in the memory interface (Section 3.1). Closed book, three RAG depths, full context, a text compressor, a one-token latent bridge, Mem0, and MemoRAG are all in Table 11.
- Beating full context on FactKG (84.33 vs 80.43) cannot be explained by dropping irrelevant documents, because full context receives every triple (Section 4). The multi-entity and multi-fact breakdowns (Figure 4) are the most useful result for a graph library: top-50 cosine retrieval degrades as facts are composed, and a read of the whole collection does not.
- The ablations separate “more parameters” and “query awareness” from the actual design. Matched-budget pooling and cosine top-16 do not close the gap; conditioning the slots before the read does (Table 13 and the noise test).
- Write-once embeddings make the store the same object as a dense index, so encoding is not an extra cost (Section 2.1, Appendix F). Serving cost stays flat from 1 to 512 documents in their stack, while full-context prefill does not (Table 14).
- On TextWorld the control is unusually tight: same history, same token budget, and an untrained module that gets worse (Section 6.1). The gain is learning a compact state, and the measured behavior change is fewer navigation loops.
- The store is per collection and external to the LLM, so a user’s embeddings can be deleted without a gradient step (Section 7, ethics statement). That matches how MemoryJS already treats storage.

**Weaknesses and limits on what we should copy.**

- The supervised module is trained on the evaluation domains. Treating 84.33 or 44.60 as a target for an untrained library feature would misread Section 2.6.
- Exact entity strings are the failure mode (Section 5). Any plan that replaces verbatim graph edges with a summary will lose the questions MemoryJS is already good at.
- PubMedQA shows a floor: when the source already fits, compression lowers accuracy (Table 11, 59.00 vs 67–69). A fixed budget should be allowed to fall back to the raw text when the raw text is smaller.
- The 27× latency claim is one stack, one GPU, 32 new tokens, no paged cache, and a 128k-token YaRN baseline (Table 14). It is not a general serving law. The memory forward itself is about 2 ms; decoding dominates.
- Soft tokens are tied to one decoder’s h_L (Table 3). The embedding store is portable across queries; the readout is not portable across model families, and the paper does not test that transfer (Section 7).
- TextWorld uses K = 8, a different architecture (an added self-attention layer), a smaller decoder, and reward training from scratch. It does not show that the FactKG checkpoint is an agent memory.
- Untrained memory tokens hurt (avg@3 0.153 vs 0.186). Shipping a random or heuristic “latent” channel and expecting the TextWorld lift would contradict Section 6.1.
- The mean 49.68 averages different metrics, and several splits are development sets or subsamples (Table 5, project site). ComMer is not a controlled comparison (Table 12).

---

## 3. Mapping onto MemoryJS

MemoryJS is a TypeScript library (Node ≥ 18, Bun for development) with JSONL and SQLite storage, entity / relation / observation graphs, and an optional embedding provider. It does not own model weights. Callers pass text to whatever LLM they use. That boundary decides which Memorilla ideas belong in this repo.

| Memorilla idea | Where it lives in the paper | What MemoryJS has today | Feasible here? |
| --- | --- | --- | --- |
| Write-once document embeddings, re-encode only changes | §2.1, Eq. 1, Appendix F | `EmbeddingService` (`OpenAI`, `LlamaCpp`, `Local`) and `SQLiteVectorStore` persist **entity** vectors. There is no collection-scoped chunk matrix that survives across queries as its own store. | **Yes.** A collection store beside the entity index. Reuse the existing embedding provider. No new required dependency. |
| Query-conditioned read of **all** stored vectors, fixed K | §2.2, Eq. 3–4, Table 13 | `HybridSearchManager` is a weighted mix of semantic, lexical, symbolic, and optional PageRank. It returns a ranked subset. `compressForContext` abbreviates repeated substrings with a `§` legend and is not query-conditioned. `TrajectoryCompressor.distill` keeps high-overlap observations. `IDistillationPolicy` filters candidates before salience scoring. | **The fixed budget and the query are feasible. The learned all-pairs read is not, inside this process.** Top-k cosine is the ablation that lost (Table 13). A faithful stand-in for a graph library is: traverse or diversify across the whole collection, then emit a fixed number of text slots. |
| Inject K vectors into the frozen LLM’s input embeddings | §2.3, Eq. 6 | No decoder, no embedding-table access. Optional `LLMProvider` is a text API, used by ingest and by `LLMQueryPlanner`. | **No for hosted APIs.** Needs open weights and a module trained per h_L (Table 3, website limits). Text analogue: prepend K short fact lines to the prompt the caller already builds. Optional later: an out-of-process adapter that returns floats for a local model the caller runs. |
| Answer-token NLL, three-stage curriculum, ~194M parameters | §2.4–2.6, Tables 1, 3, 4 | No training loop, and the dependency policy rejects a PyTorch runtime for a core feature. | **Out of core.** Training stays in the Python repo. MemoryJS can load nothing from `memory.pt` until M4, and only behind an explicit local-model adapter. |
| Token accounting that makes compression visible | Table 10, Table 11 “Compression” column | `ContextCompressionResult.stats` (`originalTokens`, `compressedTokens`, `savedTokens`, `savedPercent`), `TokenBreakdown` inside context retrieval, and `IngestTokenUsage` on `IOManager.ingest`. None of these report “document tokens handed to the caller ÷ tokens in the whole collection”. | **Yes.** Add that ratio on the new readout. Reuse the existing token estimator rather than inventing a second one. |
| Hybrid of latent memory and verbatim retrieval | §5, Figure 5; §7 future work | Hybrid search, graph traversal, and `CausalReasoner` already return structured evidence. They do not sit beside a compressed pack with an oracle-style overlap report. | **Yes, and this is the highest-leverage idea.** The paper’s union is an upper bound, not a system. MemoryJS can actually return both: a graph path or verbatim chunks, and a short synthesis, with provenance. |
| FactKG-style multi-hop fact verification | §4–5, Figure 4, Table 2 | Relations are first-class. FactKG chunks are single triples (13 tokens). A claim that composes facts is a graph question. | **Do not route this through latent tokens first.** Render the multi-hop chain into the fixed text budget. Latent compression is what you need when the consumer can only read a prompt; MemoryJS can read the edges. |
| Continual agent memory trained by reward | §6, Appendix G, Eq. 8–10 | `MemoryEngine.addTurn`, episodic and working memory, decay, consolidation, `TrajectoryCompressor`. No environment reward, no GRPO. | **The write pattern is feasible** (append each turn once). **The GRPO training is out of scope.** The paper’s control says the summary must supplement recent history, not replace it, and that an untrained extra channel can hurt. |
| Per-user store that can be deleted | §7 ethics statement | `projectId`, `SemanticForget`, governance audit, entity delete. | **Yes.** Delete-by-collection must drop vectors and audit the deletion. |
| Same embedding store, many decoders | §7 last paragraph | Embeddings are already provider-scoped (`SQLiteVectorStore` takes an embedding model name). | **Store yes, readout no**, until someone trains a projection per decoder. Do not pretend one text summary is that projection. |
| Eval on FactKG and an agent task, with a token budget in the score | Tables 7, 10, 11; §6 | Tests are unit and integration tests of the library. There is no fact-verification or trajectory-success harness. | **Yes, at fixture scale.** Do not download the 69.4 GiB FactKG embedding shard or claim a leaderboard number. |

---

## 4. Proposed work

### 4.1 Goals

1. Persist a document collection’s embeddings once, and skip re-encoding unchanged chunks.
2. For a query, produce a **text** pack whose estimated token count is at most a caller-set budget, defaulting to a small fixed slot count in the spirit of K = 16 text lines (not 16 hidden vectors).
3. Let that pack see more of the collection than a single top-k list: diversified chunks, and, when the collection has been written into the graph, a multi-hop chain.
4. Report source tokens, emitted tokens, and the ratio, in the sense of Table 10.
5. Keep verbatim evidence addressable. Every emitted slot cites the chunk or edge it came from.
6. Evaluate on a tiny FactKG-shaped claim set and a tiny growing-trajectory set. Publish the token ratio next to the score.
7. Leave soft-token injection and GRPO outside the default install.

### 4.2 Design sketch

```
write path (once per chunk)
  chunks ── EmbeddingService (existing) ──► DocumentCollectionStore
                                              SQLite blob, keyed by
                                              (collectionId, chunkId, embeddingModel)
                                              unchanged chunkId + content hash ⇒ no re-encode

read path (every query)
  query ── embed ──► rank / diversify over the WHOLE collection
                 └─► optional graph expansion (existing traversal) when edges exist
                          │
                          ▼
                    slot filler, at most B tokens
                      • extractive: short verbatim spans (default, no LLM)
                      • summary: optional LLMProvider writes B tokens of fact lines
                          │
                          ▼
                    MemoryReadout { text, slots, token stats, provenance }
                          │
                          ▼
                    caller prepends `text` to the prompt it already sends

fallback
  if sourceTokens <= budget, return the source text and set compressionRatio = 1
  (PubMedQA lesson: do not compress a collection that already fits)
```

The extractive filler is a **baseline**, corresponding to the paper’s cosine top-16 arm, not to Memorilla. M2 exists to measure how far that baseline is from “read the whole collection” on composed facts. If the fixture shows the same collapse Figure 4(c) shows for RAG-50, M3 adds a query-conditioned summary over a **larger** candidate set than the slots themselves (the summary may read 50 chunks and emit 16 lines). That is still text. It is the closest behaviour this library can offer a hosted model.

M4, if it is ever built, is a separate process. MemoryJS would pass embeddings out and receive K × h_L floats back. Injection stays in the caller’s model runner (the Python repo’s `MemoryVLLM` does this today). This package would not link PyTorch.

### 4.3 API changes (proposed, `@experimental`)

New types, new lazy getter. No change to `Entity`, `Relation`, search ranking, or the JSONL format.

```typescript
/** One persisted chunk. `contentHash` is SHA-256 of `text`. */
interface DocumentChunk {
  collectionId: string;
  chunkId: string;
  text: string;
  contentHash: string;
  embeddingModel: string;
}

interface UpsertChunksResult {
  written: number;
  unchanged: number; // hash hit, embedding reused
  reembedded: number;
}

interface MemoryReadout {
  /** Prompt fragment the caller prepends. Empty when the collection is empty. */
  text: string;
  /** Individual slots, length <= maxSlots. */
  slots: ReadonlyArray<{ text: string; sourceChunkIds: string[] }>;
  sourceTokens: number;
  emittedTokens: number;
  /** sourceTokens / emittedTokens. 1 when the source already fit. */
  compressionRatio: number;
  /** 'passthrough' | 'extractive' | 'summary' */
  mode: string;
  truncated: boolean;
}

interface DocumentMemory {
  upsertChunks(chunks: ReadonlyArray<Omit<DocumentChunk, 'contentHash' | 'embeddingModel'> & {
    embedding?: Float32Array;
  }>): Promise<UpsertChunksResult>;
  deleteCollection(collectionId: string): Promise<void>;
  readout(request: {
    collectionId: string;
    query: string;
    maxSlots?: number;      // default 16 text slots
    budgetTokens?: number;  // hard cap; estimator is the existing one
    mode?: 'auto' | 'extractive' | 'summary';
    includeGraphPaths?: boolean; // default true when relations exist for the collection
  }): Promise<MemoryReadout>;
}
```

Wiring: `ctx.documentMemory` on `ManagerContext`, created on first access, `@experimental`. `summary` mode requires an `LLMProvider` already passed into context; without one it throws a typed error that names the missing provider, and `auto` falls back to `extractive`. Graph paths reuse `GraphTraversal` / the existing causal helpers when the caller has also stored the chunks as entities and relations. The readout does not create those edges by itself.

Optional and not part of M0–M3:

```typescript
/** Out of process. MemoryJS does not inject these into a model. */
interface LatentReadoutAdapter {
  readonly decoderId: string; // e.g. 'Qwen/Qwen3-8B'
  readonly slots: number;     // 16 in the released supervised checkpoint
  read(input: {
    documentEmbeddings: Float32Array; // N * h_e
    queryEmbedding: Float32Array;     // h_e
  }): Promise<Float32Array>;          // K * h_L
}
```

Token-budget fields on `MemoryReadout` are the acceptance surface for “we measured compression”. They are estimates from the same character-based estimator `ContextWindowManager` already uses, so they will not match the Qwen3 tokenizer counts in Table 10. The eval report must say which estimator it used.

### 4.4 Phases

#### M0 — collection store (estimate: S)

Persist chunks and embeddings in SQLite (and a JSONL sidecar when the active backend is JSONL, same dual-backend rule as the rest of the library). `upsertChunks` re-embeds only when `chunkId` is new or the content hash differs. `deleteCollection` removes vectors and writes an audit record when governance is already enabled.

**Done when:** a unit test writes three chunks, repeats the upsert, and observes `unchanged: 3` and zero embedding-provider calls on the second call; deleting the collection leaves no rows; the JSONL and SQLite backends both round-trip.

**Risk:** embedding dimension differs across providers. Key the row by `embeddingModel` and refuse to mix dimensions in one readout. Estimated cost is one new table, no new dependency.

#### M1 — extractive fixed-budget readout (estimate: M)

`readout` in `extractive` / `auto`. Rank chunks with the existing embedding similarity. Fill slots with a diversity constraint so sixteen slots are not sixteen sentences from the same document (the FactKG failure mode is evidence spread across documents, Section 5). If a graph path is available, reserve some slots for the path’s edge labels, verbatim. If `sourceTokens <= budgetTokens`, return the source unchanged.

**Done when:** on a fixture of 40 short documents, the emitted estimate is ≤ the budget; every slot’s `sourceChunkIds` resolve; a query whose relevant sentences share no tokens with the query still surfaces them when their embeddings are close (provider stubbed with hand-built vectors); passthrough triggers on a 4-chunk collection under the budget.

**Risk:** this is the Table 13 cosine arm. It will look like RAG. That is acceptable for M1 because M2 is what tells us the gap. Do not describe M1 as Memorilla in the API docs.

#### M2 — fixture eval (estimate: M)

Two fixtures, checked in, no network, no Hugging Face download.

- **Composed facts.** About 30 claims over a toy triple set. Include claims that need 1, 2, and 4 triples, mirroring Figure 4(c)’s axis. Score exact support / refute. Report extractive-readout accuracy and full-collection-text accuracy beside `compressionRatio`. The full-collection arm is the control, not a leaderboard.
- **Growing trajectory.** A scripted 20-step “room” log. At each step the store appends one turn and the readout must mention a room already visited, within a fixed budget, while the caller also receives the last 4 turns verbatim (Section 6.1: memory supplements history). Score whether the pack still names the visited room at step 20.

**Done when:** `bunx vitest run` on the new file passes offline; the report object includes both accuracies and the token ratio; the test does not fetch `memorilla/Memorilla-Data`.

**Risk:** a toy graph can be solved by traversal alone, which would make the extractive text pack look redundant. That result is worth having. If graph-path slots score the composed-fact fixture and extractive cosine slots do not, the write-up should say so and M3 should summarize the **path**, not the top cosine chunks.

#### M3 — query-conditioned text summary (estimate: M, after M2)

`mode: 'summary'` calls the existing `LLMProvider` with the query plus a candidate set larger than `maxSlots`, and asks for at most `maxSlots` fact lines. Cache by `(collectionId, collectionVersion, queryHash, budgetTokens)`. Extractive mode remains the default. Summary text still carries `sourceChunkIds`; a line that cites nothing is dropped.

**Done when:** with a stub provider, the readout contains only lines the stub returned and only citations that exist; a missing provider on `mode: 'summary'` throws the typed error; `auto` without a provider stays extractive; the M2 fixture records a third column for the stubbed summary.

**Risk:** the provider can hallucinate a fact that was not in the candidates. The citation filter is the mitigation. This will not reproduce Equation 7, because we cannot backpropagate into the summary through a hosted API.

#### M4 — local latent adapter (estimate: L, gated)

Only if a caller asks to run the released Qwen checkpoint. An optional package or a documented subprocess wraps `snap-stanford/memorilla` and implements `LatentReadoutAdapter`. MemoryJS never decodes the floats. Documentation states the hosted-API limit in the same paragraph as the API.

**Done when:** a contract test with a fake adapter checks shapes N × h_e in and K × h_L out, and the core `bun run test` suite passes with the adapter unset. No `torch`, `transformers`, or `better-sqlite3`-level native build is added to the core package.

**Risk:** the checkpoint is decoder-specific, the personalization folders’ init is inconsistently described (Section 1.3), and the paper does not show cross-family transfer. Shipping M4 as a default would violate the minimal-dependency rule and still fail closed for API-only users.

### 4.5 What this plan explicitly leaves out

- Training a memory module, or a GRPO loop, inside MemoryJS.
- Vendoring FactKG, TriviaQA, NarrativeQA, or the precomputed embedding shards. Licenses differ by config, and the shards are tens of gigabytes (dataset card).
- Replacing `HybridSearchManager`, `compressForContext`, or `MemoryEngine` dedup. Those stay. The new readout is another way to **render** a collection for a prompt.
- Claiming the paper’s 84.33, 44.60, 24.2%, or 27× figures for any MemoryJS build. Those numbers belong to the frozen Qwen stack in Tables 11 and 14 and Section 6.1.

### 4.6 Sequencing

M0 and M1 are useful even if M2’s extractive arm loses on composed facts, because the store and the token ratio are the substrate for M3. M2 is the decision gate for M3: if graph-path slots already solve the fixture, M3 should compress paths, and a general abstractive summary is optional. M4 waits on a concrete caller with a local open-weight decoder. Until that caller exists, the text pack is the product.
