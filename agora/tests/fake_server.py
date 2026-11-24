"""Run the interface with the stand-in model: python tests/fake_server.py"""
import sys
from pathlib import Path

sys.path[:0] = [str(Path(__file__).parent.parent), str(Path(__file__).parent)]
import fake_llm  # noqa: E402
from agora.server import serve  # noqa: E402

fake_llm.install()
serve(port=8766, open_browser=False)
