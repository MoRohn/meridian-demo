import os

import envfile


def test_loads_missing_keys_ignores_comments_and_never_overrides_the_real_environment(tmp_path, monkeypatch):
    f = tmp_path / ".env"
    f.write_text("# comment\n\nOPENAI_API_KEY='sk-file'\nexport EVAL_JUDGE_MODEL=gpt-x\nBROKEN LINE\nEMPTY=\nKEEP=from-file\n")
    for k in ("OPENAI_API_KEY", "EVAL_JUDGE_MODEL", "EMPTY"):
        monkeypatch.delenv(k, raising=False)
    monkeypatch.setenv("KEEP", "from-env")
    loaded = envfile.load_env(f)
    assert os.environ["OPENAI_API_KEY"] == "sk-file" and os.environ["EVAL_JUDGE_MODEL"] == "gpt-x"
    assert os.environ["KEEP"] == "from-env"
    assert sorted(loaded) == ["EVAL_JUDGE_MODEL", "OPENAI_API_KEY"]
    assert "sk-file" not in " ".join(loaded)  # names only, never values
    monkeypatch.delenv("OPENAI_API_KEY"); monkeypatch.delenv("EVAL_JUDGE_MODEL")


def test_missing_file_is_a_no_op(tmp_path):
    assert envfile.load_env(tmp_path / "nope") == []
