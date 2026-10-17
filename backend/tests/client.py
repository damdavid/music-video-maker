from fastapi.testclient import TestClient

from app import main

TEST_KEY = "sk-ant-test"


def make_client(**kw) -> TestClient:
    """Talks to the app the way the web app does: a loopback Host, the client header and the user's API key on every request."""
    return TestClient(main.app, base_url="http://localhost", headers={"X-MVM-Client": "web", "X-Anthropic-Key": TEST_KEY}, **kw)
