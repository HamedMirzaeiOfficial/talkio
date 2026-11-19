# Example: Django host project

An existing project using the stock `django.contrib.auth.User`, adding chat with settings, one `include()` and the ASGI helper. `host_project/policies.py` restricts discovery to teammates (auth `Group`).

```bash
pip install -r requirements.txt
python manage.py migrate && python manage.py seed_example   # ann / ben, password example-pass
daphne -b 127.0.0.1 -p 4810 host_project.asgi:application
pytest
```
