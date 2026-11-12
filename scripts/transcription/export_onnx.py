"""Convert the ByteDance piano transcription model (Kong et al. 2021, MIT) to ONNX.

Run once at build time, in a throwaway environment with PyTorch (see
scripts/fetch-transcription-model.sh); the app then runs the .onnx file with
onnxruntime and never needs PyTorch.

The checkpoint is loaded with torch.load(weights_only=True): a downloaded file
may only contain tensors, never code to run.

The whole network is exported, spectrogram and log-mel front end included:
input  audio  float32 (batch, 160000) - 10 s at 16 kHz, mono
output the 7 frame-level maps of the original (batch, 1001, 88 or 1):
       reg_onset, reg_offset, frame, velocity, reg_pedal_onset,
       reg_pedal_offset, pedal_frame

Usage: python export_onnx.py CHECKPOINT.pth OUT.onnx
"""

import sys

import numpy as np
import torch
from piano_transcription_inference.models import Note_pedal

OUTPUTS = [
    "reg_onset_output",
    "reg_offset_output",
    "frame_output",
    "velocity_output",
    "reg_pedal_onset_output",
    "reg_pedal_offset_output",
    "pedal_frame_output",
]
SEGMENT = 16000 * 10


class Wrapper(torch.nn.Module):
    def __init__(self, model: torch.nn.Module) -> None:
        super().__init__()
        self.model = model

    def forward(self, audio: torch.Tensor):  # noqa: ANN201
        out = self.model(audio)
        return tuple(out[k] for k in OUTPUTS)


def main(checkpoint: str, out: str) -> None:
    model = Note_pedal(frames_per_second=100, classes_num=88)
    state = torch.load(checkpoint, map_location="cpu", weights_only=True)
    model.load_state_dict(state["model"], strict=False)
    model.eval()
    wrapper = Wrapper(model)
    rng = np.random.default_rng(0)
    dummy = torch.from_numpy((rng.standard_normal((1, SEGMENT)) * 0.1).astype(np.float32))
    with torch.no_grad():
        expected = [t.numpy() for t in wrapper(dummy)]
        torch.onnx.export(
            wrapper,
            (dummy,),
            out,
            input_names=["audio"],
            output_names=[k.removesuffix("_output") for k in OUTPUTS],
            dynamic_axes={
                "audio": {0: "batch"},
                **{k.removesuffix("_output"): {0: "batch"} for k in OUTPUTS},
            },
            opset_version=17,
            dynamo=False,
        )
    # The exported model must give the same maps as PyTorch.
    import onnxruntime as ort

    session = ort.InferenceSession(out, providers=["CPUExecutionProvider"])
    got = session.run(None, {"audio": dummy.numpy()})
    worst = max(float(np.max(np.abs(a - b))) for a, b in zip(expected, got, strict=True))
    print(f"exported {out}; max difference from PyTorch: {worst:.2e}", file=sys.stderr)
    if worst > 1e-3:
        raise SystemExit("ONNX output differs from PyTorch")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
