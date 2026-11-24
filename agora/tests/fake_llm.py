"""A stand-in model for testing the pipeline and interface without a real LLM.
It answers each prompt type with fixed, well-formed JSON."""
import json
import re

from agora import pipeline, prompts
from agora.llm import LLM


class FakeLLM(LLM):
    def __init__(self):
        super().__init__("fake", {"model": "fake-model", "context_chars": 30_000})
        self.calls = []

    async def chat(self, system, user, max_tokens=8000, json_mode=False):
        self.calls.append((system[:40], len(user)))
        if system == prompts.CLARIFY:
            return json.dumps({"intent": "Find cliff jumping spots near Marseille that are still accessible",
                               "questions": [{"q": "How high do you jump?", "options": ["Under 5 m", "5-10 m", "10 m+"]},
                                             {"q": "When are you going?", "options": ["Summer", "Off-season"]}]})
        if system.startswith(prompts.PLAN[:40]):
            names = re.findall(r"^- (\w+):", user, re.M)
            return json.dumps({"format": "places", "queries": {n: ["cliff diving marseille", "calanques cliff jumping"] for n in names}})
        n = len(re.findall(r"^\[\d+\] ", user, re.M))
        return json.dumps({
            "tldr": f"Stand-in answer built from {n} sources [1][2].",
            "answer_md": "## Spots\n- **Sormiou**: popular, deep water [1]\n- **En-Vau**: higher jumps [2]\n\n| Spot | Height |\n|---|---|\n| Sormiou | 8 m [1] |",
            "warnings": ["Check depth at low tide [1]"],
            "consensus": ["Go early in summer, parking fills up [2]"],
            "disagreements": [{"topic": "Is En-Vau worth the hike?", "sides": ["Yes, best water [1]", "No, too crowded [2]"]}],
            "facts_vs_crowd": [{"official": "Calanques access restricted on high fire-risk days [1]", "crowd": "Rangers do turn people back [2]"}],
            "items": [],
            "places": [{"name": "Calanque de Sormiou", "area": "Marseille, France", "summary": "Deep water, 3-8 m rocks [1]",
                        "warnings": "", "status": "open", "last_mentioned": "2025-07-01", "sources": [1]},
                       {"name": "Calanque d'En-Vau", "area": "Cassis, France", "summary": "Up to 20 m [2]",
                        "warnings": "Long hike, no water on site", "status": "restricted", "last_mentioned": "2024-08-12", "sources": [2]}],
            "gaps": "No winter reports.",
            "followups": ["Which spots are reachable by bus from Marseille?"]})


def install(monkeypatch=None):
    fake = FakeLLM()
    if monkeypatch:
        monkeypatch.setattr(pipeline, "get_llm", lambda name=None: fake)
    else:
        pipeline.get_llm = lambda name=None: fake
    return fake
