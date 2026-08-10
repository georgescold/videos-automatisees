"""
Synthese XTTS-v2 (Coqui) : la meilleure qualite TTS locale, francais inclus.
Appele en sous-processus par xtts.mjs.

Sorties : ecrit un WAV a --out. Lit le texte depuis --text-file (UTF-8).
Deux modes de voix :
  --speaker "Nom"     -> voix studio integree a XTTS
  --clone ref.wav     -> clone la voix de l'echantillon fourni

Licence du modele : Coqui Public Model License (non-commercial). L'utilisateur
a ete averti et l'a acceptee via COQUI_TOS_AGREED=1.
"""
import argparse
import os
import sys

os.environ.setdefault("COQUI_TOS_AGREED", "1")


def log(msg):
    print(msg, file=sys.stderr, flush=True)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--text-file", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--language", default="fr")
    ap.add_argument("--speaker", default=None)
    ap.add_argument("--clone", default=None)
    ap.add_argument("--list-speakers", action="store_true")
    # Reglages de naturel (defauts affines vs valeurs par defaut du modele).
    ap.add_argument("--temperature", type=float, default=0.75)
    ap.add_argument("--repetition-penalty", type=float, default=5.0)
    ap.add_argument("--length-penalty", type=float, default=1.0)
    ap.add_argument("--top-k", type=int, default=50)
    ap.add_argument("--top-p", type=float, default=0.85)
    ap.add_argument("--speed", type=float, default=1.0)
    args = ap.parse_args()

    import torch
    from TTS.api import TTS

    device = "cuda" if torch.cuda.is_available() else "cpu"
    log(f"[xtts] device={device}")

    tts = TTS("tts_models/multilingual/multi-dataset/xtts_v2").to(device)

    if args.list_speakers:
        speakers = getattr(tts, "speakers", None) or []
        print("\n".join(speakers))
        return

    with open(args.text_file, "r", encoding="utf-8") as f:
        text = f.read().strip()

    # split_sentences gere les textes longs (decoupage automatique).
    # Les parametres d'echantillonnage adoucissent la prosodie et reduisent
    # le rendu "robotique" (repetition_penalty haut, temperature moderee).
    kwargs = {
        "text": text,
        "file_path": args.out,
        "language": args.language,
        "split_sentences": True,
        "temperature": args.temperature,
        "repetition_penalty": args.repetition_penalty,
        "length_penalty": args.length_penalty,
        "top_k": args.top_k,
        "top_p": args.top_p,
        "speed": args.speed,
    }

    if args.clone:
        kwargs["speaker_wav"] = args.clone
    else:
        available = getattr(tts, "speakers", None) or []
        wanted = args.speaker or "Daisy Studious"
        if available and wanted not in available:
            log(f"[xtts] voix '{wanted}' absente, repli sur '{available[0]}'")
            wanted = available[0]
        kwargs["speaker"] = wanted

    log("[xtts] synthese en cours...")
    tts.tts_to_file(**kwargs)
    log("[xtts] termine")


if __name__ == "__main__":
    main()
