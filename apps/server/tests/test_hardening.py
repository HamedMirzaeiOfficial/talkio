from rest_framework.test import APIClient


def csrf_client(**extra):
    client = APIClient(enforce_csrf_checks=True, **extra)
    token = client.get("/api/auth/session/").json()["csrf_token"]
    client.credentials(HTTP_X_CSRFTOKEN=token)
    return client


def test_login_throttle_cannot_be_bypassed_with_spoofed_forwarded_for(db, settings):
    client = csrf_client()
    statuses = [
        client.post(
            "/api/auth/login/",
            {"identifier": "alice", "password": f"guess-{i}"},
            format="json",
            HTTP_X_FORWARDED_FOR=f"10.0.{i}.1",  # attacker-controlled header
        ).status_code
        for i in range(25)
    ]
    assert 429 in statuses, statuses


def test_behind_a_trusted_proxy_the_proxy_supplied_address_is_used(db, settings):
    settings.REST_FRAMEWORK = {**settings.REST_FRAMEWORK, "NUM_PROXIES": 1}
    from rest_framework.settings import api_settings

    api_settings.reload()
    try:
        client = csrf_client()
        # The proxy appends the real client address last; earlier entries are spoofable.
        statuses = [
            client.post(
                "/api/auth/login/",
                {"identifier": "alice", "password": "x"},
                format="json",
                HTTP_X_FORWARDED_FOR=f"6.6.{i}.6, 203.0.113.9",
            ).status_code
            for i in range(25)
        ]
        assert 429 in statuses
    finally:
        settings.REST_FRAMEWORK = {k: v for k, v in settings.REST_FRAMEWORK.items() if k != "NUM_PROXIES"}
        api_settings.reload()
