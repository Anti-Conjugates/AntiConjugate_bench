"""Generate a bounded research artifact. No clinical scoring or remote-code loading."""
import argparse
import datetime
import hashlib
import json
import platform
from pathlib import Path
from urllib.request import urlopen

import numpy as np
import rdkit
import torch
import transformers
from rdkit import Chem, RDLogger
from rdkit.Chem import Crippen, Descriptors, QED, rdMolDescriptors
from rdkit.Chem.Draw import rdMolDraw2D
from rdkit.Contrib.SA_Score import sascorer
from transformers import AutoModelForCausalLM, AutoTokenizer

ROOT = Path(__file__).resolve().parents[1]
MODEL = "jarod0411/linkerGPT"
REVISION = "3d1bab27707849cd8b6c0fe1cda9d6de48625b1d"
WEIGHTS_SHA = "2cb13f1561df5c89fb2e7f8d25f2280edae9b76430ab03d1a1d11dec1e6dc38d"
SEED = 41
COUNT = 12
MAX_TOKENS = 96
CONTROL_SMILES = [
    ("Two-handle PEG fragment", "[*:1]CCOCCOCC[*:2]"),
    ("Two-handle amide fragment", "[*:1]CCC(=O)NCCC[*:2]"),
    ("Single-handle control", "[*:1]CCOCC"),
    ("No-handle proxy control", "CCOC(=O)c1ccccc1"),
    ("Invalid SMILES control", "C1CC"),
    ("Disconnected control", "[*:1]CC.OCC[*:2]"),
    ("Repeated attachment-map control", "[*:1]CCOCC[*:1]"),
    ("Equivalent PEG representation", "[*:2]CCOCCOCC[*:1]"),
]


def sha(data):
    return hashlib.sha256(data).hexdigest()


def describe(smiles, identifier, name, origin, nll=None):
    mol = Chem.MolFromSmiles(smiles)
    result = dict(id=identifier, name=name, origin=origin, smiles=smiles,
                  adapter_trial=origin == "checkpoint_sample", completed_with_eos=None,
                  canonical_smiles=None, valid=False, connected=False,
                  attachment_points=0, has_two_mapped_attachments=False,
                  descriptors=None, mean_token_nll=nll, proxy_reward=None,
                  depiction_svg=None)
    if mol is None or mol.GetNumAtoms() == 0:
        return result
    wildcards = [a for a in mol.GetAtoms() if a.GetAtomicNum() == 0]
    connected = len(Chem.GetMolFrags(mol)) == 1
    mapped = (len(wildcards) == 2 and {a.GetAtomMapNum() for a in wildcards} == {1, 2}
              and all(a.GetDegree() == 1 for a in wildcards) and connected)
    capped = Chem.ReplaceSubstructs(mol, Chem.MolFromSmarts("[#0]"),
                                    Chem.MolFromSmiles("[H]"), replaceAll=True)[0]
    capped = Chem.RemoveHs(capped)
    Chem.SanitizeMol(capped)
    values = dict(molecular_weight=Descriptors.MolWt(capped),
                  logp=Crippen.MolLogP(capped), tpsa=rdMolDescriptors.CalcTPSA(capped),
                  qed=QED.qed(capped), sa_score=sascorer.calculateScore(capped))
    # Same clipped expression as the published RL script, applied to capped fragments.
    reward = float(np.clip(values["qed"] + 1 - values["sa_score"] / 10
                           - 0.1 * rdMolDescriptors.CalcNumRings(capped), 0, 1))
    drawer = rdMolDraw2D.MolDraw2DSVG(300, 170)
    drawer.DrawMolecule(mol)
    drawer.FinishDrawing()
    result.update(canonical_smiles=Chem.MolToSmiles(mol), valid=True,
                  connected=connected, attachment_points=len(wildcards),
                  has_two_mapped_attachments=mapped, descriptors=values,
                  proxy_reward=reward, depiction_svg=drawer.GetDrawingText())
    return result


def structure(metadata_file):
    raw = metadata_file.read_bytes()
    matches = [r for r in json.loads(raw) if r["uniprotAccession"] == "P04626"
               and r["entryId"] == "AF-P04626-F1" and r["latestVersion"] == 6]
    if len(matches) != 1:
        raise ValueError("Canonical HER2 structure identity mismatch")
    r = matches[0]
    url = "https://alphafold.ebi.ac.uk/files/AF-P04626-F1-confidence_v6.json"
    if r["plddtDocUrl"] != url or r["isComplex"]:
        raise ValueError("Unexpected structure source")
    confidence_file = metadata_file.with_name('her2_alphafold_confidence.json')
    if confidence_file.exists():
        confidence = confidence_file.read_bytes()
    else:
        confidence = urlopen(url, timeout=30).read()
        confidence_file.write_bytes(confidence)
    data = json.loads(confidence)
    scores = data["confidenceScore"]
    if (len(scores) != 1255 or len(r["sequence"]) != 1255
            or not all(isinstance(s, (float, int)) and np.isfinite(s) and 0 <= s <= 100 for s in scores)):
        raise ValueError("Invalid pLDDT values")
    return dict(provider="AlphaFold DB", method=r["toolUsed"], uniprot_id="P04626",
                entry_id="AF-P04626-F1", version=6, model_created_at=r["modelCreatedDate"],
                metadata_url="https://alphafold.ebi.ac.uk/api/prediction/P04626",
                confidence_url=url, metadata_sha256=sha(raw), confidence_sha256=sha(confidence),
                sequence_sha256=sha(r["sequence"].encode()), residue_count=1255,
                mean_plddt=float(np.mean(scores)), below_50_fraction=sum(s < 50 for s in scores) / 1255,
                plddt=scores, license="CC-BY-4.0", role="target_monomer_only")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--cache", type=Path, required=True, help="Pinned local HF snapshot directory")
    parser.add_argument("--structure-metadata", type=Path, default=ROOT / 'data/model_sources/her2_alphafold_metadata.json')
    parser.add_argument("--output", type=Path, default=ROOT / "data/model_observations.json")
    args = parser.parse_args()
    if sha((args.cache / "model.safetensors").read_bytes()) != WEIGHTS_SHA:
        raise ValueError("Model weights mismatch")
    torch.set_num_threads(4)
    torch.manual_seed(SEED)
    torch.use_deterministic_algorithms(True)
    RDLogger.DisableLog("rdApp.warning")
    RDLogger.DisableLog("rdApp.error")
    tokenizer = AutoTokenizer.from_pretrained(args.cache, local_files_only=True, trust_remote_code=False)
    if (len(tokenizer), tokenizer.bos_token_id, tokenizer.eos_token_id, tokenizer.pad_token_id) != (3154, 3152, 0, 3153):
        raise ValueError("Unexpected tokenizer")
    model = AutoModelForCausalLM.from_pretrained(args.cache, local_files_only=True,
                                                use_safetensors=True, trust_remote_code=False).eval()
    start = torch.full((COUNT, 1), tokenizer.bos_token_id, dtype=torch.long)
    with torch.inference_mode():
        tokens = model.generate(start, do_sample=True, max_new_tokens=MAX_TOKENS,
                                temperature=1.0, top_k=50, top_p=0.95,
                                bos_token_id=3152, eos_token_id=0, pad_token_id=3153,
                                suppress_tokens=list(range(len(tokenizer), model.config.vocab_size)))
    controls = [describe(s, f"control-{i:02}", n, "synthetic_control")
                for i, (n, s) in enumerate(CONTROL_SMILES, 1)]
    samples = []
    for i, row in enumerate(tokens, 1):
        smiles = tokenizer.decode(row[1:], skip_special_tokens=True).strip()
        if len(smiles) > 1024:
            raise ValueError("Generated sample exceeds limit")
        encoded = tokenizer(tokenizer.bos_token + smiles + tokenizer.eos_token, return_tensors="pt")
        with torch.inference_mode():
            nll = float(model(**encoded, labels=encoded.input_ids).loss)
        observation = describe(smiles, f"sample-{i:02}", f"Adapter trial {i}", "checkpoint_sample", nll)
        observation["completed_with_eos"] = 0 in row[1:].tolist()
        samples.append(observation)
    result = dict(version="conjugate-models-1", generated_at=datetime.datetime.now(datetime.timezone.utc).isoformat().replace("+00:00", "Z"),
                  generator_sha256=sha(Path(__file__).read_bytes()),
                  linker_model=dict(id=MODEL, revision=REVISION, weights_sha256=WEIGHTS_SHA,
                                    tokenizer_sha256=sha((args.cache / "tokenizer.json").read_bytes()),
                                    config_sha256=sha((args.cache / "config.json").read_bytes()),
                                    input_sha256=sha(json.dumps({"input_ids": start.tolist()}, separators=(',', ':')).encode()),
                                    dtype=str(next(model.parameters()).dtype).removeprefix('torch.'),
                                    license="not_declared", paper_checkpoint_equivalence="not_verified",
                                    device="cpu", invocation_kind="unconditioned_format_probe", seed=SEED, sample_count=COUNT, max_new_tokens=MAX_TOKENS,
                                    temperature=1, top_k=50, top_p=0.95, bos_token_id=3152, eos_token_id=0,
                                    pad_token_id=3153, suppressed_unmapped_tokens=True, provider_requests=0, retries=0),
                  tools=dict(python=platform.python_version(), torch=torch.__version__,
                             transformers=transformers.__version__, rdkit=rdkit.__version__, numpy=np.__version__),
                  molecules=controls + samples, structure=structure(args.structure_metadata))
    args.output.write_text(json.dumps(result, indent=2, allow_nan=False) + "\n")
    valid = sum(s["valid"] for s in samples)
    print(json.dumps(dict(samples=COUNT, valid=valid, invalid=COUNT-valid,
                         mapped_attachment_pass=sum(s["has_two_mapped_attachments"] for s in samples))))


if __name__ == "__main__":
    main()
