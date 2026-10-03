
"""Antibody variable-domain embeddings for workbook ADCs (exploratory, not clinical evidence)."""
import csv, hashlib, json, datetime, sys
import numpy as np, torch
from transformers import AutoTokenizer, AutoModel
from sklearn.decomposition import PCA

MODEL = "facebook/esm2_t33_650M_UR50D"
REVISION = "08e4846e537177426273712802403f7ba8261b6c"
CSV = "therasabdab.csv"
SRC_URL = "https://opig.stats.ox.ac.uk/webapps/sabdab-sabpred/static/downloads/TheraSAbDab_SeqStruc_OnlineDownload.csv"
SNAP = "/home/ubuntu/repos/her2-agent/apps/api/src/workbook.snapshot.json"

csv_sha = hashlib.sha256(open(CSV, "rb").read()).hexdigest()
snap = json.load(open(SNAP))
rows = list(csv.DictReader(open(CSV, encoding="utf-8-sig")))
by_name = {r["Therapeutic"].lower(): r for r in rows}

records, unmatched = [], []
for rec in snap["records"]:
    antibody = next(c["value"] for c in rec["cells"] if c["field"] == "Antibody")
    stem = rec["name"].split()[0]
    hit, via = None, None
    for key, label in ((stem, "adc_name_first_word"), (antibody, "workbook_antibody_field")):
        if key and key.lower() in by_name:
            hit, via = by_name[key.lower()], label
            break
    if not hit or not hit["HeavySequence"] or not hit["LightSequence"] or hit["HeavySequence(ifbispec)"].strip() not in ("", "na"):
        unmatched.append({"id": rec["id"], "name": rec["name"], "antibody": antibody,
                          "reason": "no exact Thera-SAbDab name match" if not hit else "bispecific or missing chain"})
        continue
    records.append({"id": rec["id"], "name": rec["name"], "brand": rec.get("brand"), "target": rec["target"],
                    "payload": rec["payload"], "antibody_workbook": antibody, "therasabdab_name": hit["Therapeutic"],
                    "match_via": via, "vh": hit["HeavySequence"], "vl": hit["LightSequence"]})

tok = AutoTokenizer.from_pretrained(MODEL, revision=REVISION)
model = AutoModel.from_pretrained(MODEL, revision=REVISION).eval()
torch.set_num_threads(8)

def embed(seq):
    with torch.no_grad():
        enc = tok(seq, return_tensors="pt")
        h = model(**enc).last_hidden_state[0, 1:-1]  # drop CLS/EOS
        return h.mean(0).numpy()

cache = {}
vecs = []
for r in records:
    key = (r["vh"], r["vl"])
    if key not in cache:
        cache[key] = np.concatenate([embed(r["vh"]), embed(r["vl"])])
    vecs.append(cache[key])
X = np.stack(vecs)
Xn = X / np.linalg.norm(X, axis=1, keepdims=True)
cos = Xn @ Xn.T

def identity(a, b):
    # global alignment identity (Needleman-Wunsch, match 1, mismatch 0, gap -1), normalized by longer length
    n, m = len(a), len(b)
    D = np.zeros((n + 1, m + 1)); D[:, 0] = -np.arange(n + 1); D[0, :] = -np.arange(m + 1)
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            D[i, j] = max(D[i-1, j-1] + (a[i-1] == b[j-1]), D[i-1, j] - 1, D[i, j-1] - 1)
    i, j, same = n, m, 0
    while i > 0 and j > 0:
        if D[i, j] == D[i-1, j-1] + (a[i-1] == b[j-1]):
            same += a[i-1] == b[j-1]; i -= 1; j -= 1
        elif D[i, j] == D[i-1, j] - 1: i -= 1
        else: j -= 1
    return same / max(n, m)

N = len(records)
ident = np.eye(N)
for i in range(N):
    for j in range(i + 1, N):
        v = (identity(records[i]["vh"], records[j]["vh"]) + identity(records[i]["vl"], records[j]["vl"])) / 2
        ident[i, j] = ident[j, i] = v

iu = np.triu_indices(N, 1)
spearman = float(np.corrcoef(np.argsort(np.argsort(cos[iu])), np.argsort(np.argsort(ident[iu])))[0, 1])
pca = PCA(n_components=2, random_state=0).fit(Xn)
xy = pca.transform(Xn)

out = {
    "kind": "exploratory_sequence_embedding",
    "notice": "Sequence-similarity view of antibody variable domains. Not evidence of efficacy, safety or interchangeability.",
    "generated_at": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds"),
    "model": {"id": MODEL, "revision": REVISION, "pooling": "mean over residues, VH and VL embedded separately and concatenated (2x1280)", "device": "cpu"},
    "sequence_source": {"name": "Thera-SAbDab (OPIG, Oxford)", "url": SRC_URL, "sha256": csv_sha, "fields": ["HeavySequence", "LightSequence"], "note": "Variable domains only."},
    "workbook_sha256": snap["sha256"],
    "matched_count": N, "workbook_count": len(snap["records"]), "unmatched": unmatched,
    "pca_explained_variance": [round(float(v), 4) for v in pca.explained_variance_ratio_],
    "spearman_cosine_vs_identity": round(spearman, 4),
    "records": [{k: v for k, v in r.items() if k not in ("vh", "vl")} | {"vh_length": len(r["vh"]), "vl_length": len(r["vl"]),
                "pc1": round(float(xy[i, 0]), 5), "pc2": round(float(xy[i, 1]), 5)} for i, r in enumerate(records)],
    "cosine": [[round(float(v), 5) for v in row] for row in cos],
    "identity": [[round(float(v), 4) for v in row] for row in ident],
}
json.dump(out, open("antibody_embeddings.json", "w"), indent=1)
print("matched", N, "unmatched", [u["name"] for u in unmatched], "spearman", out["spearman_cosine_vs_identity"], "pca", out["pca_explained_variance"])
